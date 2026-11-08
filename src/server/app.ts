// HTTP API for the web UI. A thin layer over the service: parse the request, call one service
// method, map the result to a status code. All rules live in core; all judgment in the judge.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Graph, GraphNode, NodeId, Result } from "../core/index.js";
import type { ChatRequest } from "../claude/headless.js";
import { sideSystem, tutorSystem, withHistory } from "../chat/prompts.js";
import { MODELS, isModelId } from "../claude/models.js";
import type { ChatStore, GraphStore, SettingsStore } from "../persistence/index.js";
import { describeServiceError, type Service, type ServiceError } from "../service/index.js";

export interface ClaudeBridge {
  status(): Promise<{ loggedIn: boolean; error?: string }>;
  streamChat(req: ChatRequest, onDelta: (text: string) => void): Promise<{ sessionId: string }>;
}

export interface AppDeps {
  service: Service;
  store: GraphStore;
  chats: ChatStore;
  settings: SettingsStore;
  claude: ClaudeBridge;
  /** Folder with index.html. Defaults to <repo>/web. */
  webRoot?: string;
}

const DEFAULT_WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web");

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }

function statusFor(e: ServiceError): number {
  switch (e.kind) {
    case "domain": return e.error.code === "EMPTY_FIELD" ? 400 : e.error.code === "NODE_NOT_FOUND" ? 404 : 409;
    case "store": return e.error.code === "NOT_FOUND" ? 404 : 500;
    case "rejected": return 422;
    case "judge-unavailable": return 503;
    case "no-active-task": return 404;
  }
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let s = "";
  for await (const c of req) { s += c; if (s.length > 1_000_000) throw new HttpError(413, "Request too large."); }
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error();
    return v;
  } catch { throw new HttpError(400, "Request body must be a JSON object."); }
}

const str = (b: Record<string, unknown>, k: string): string => (typeof b[k] === "string" ? (b[k] as string) : "");
const optStr = (b: Record<string, unknown>, k: string): string | undefined => (typeof b[k] === "string" ? (b[k] as string) : undefined);

/** Opens a Server-Sent Events stream. */
function sse(res: ServerResponse) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  return (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function createApp(deps: AppDeps) {
  const { service, store, chats, settings, claude } = deps;
  const webRoot = deps.webRoot ?? DEFAULT_WEB;

  const reply = async (res: ServerResponse, r: Promise<Result<Graph, ServiceError>>) => {
    const out = await r;
    if (out.ok) json(res, 200, { graph: out.value });
    else json(res, statusFor(out.error), { error: out.error, message: describeServiceError(out.error) });
  };

  async function activeGraph(): Promise<Graph> {
    const r = await service.current();
    if (!r.ok) throw new HttpError(statusFor(r.error), describeServiceError(r.error));
    return r.value;
  }

  async function taskSummaries() {
    const activeId = await store.getActive();
    const tasks = [];
    for (const s of await service.listTasks()) {
      const r = await store.load(s.id);
      if (!r.ok) continue;
      const g = r.value, branches = Object.values(g.nodes).filter(n => n.parentId !== null);
      const count = (st: string) => branches.filter(n => n.status === st).length;
      tasks.push({
        ...s, cursorTitle: g.nodes[g.cursor]!.title, cursorIsRoot: g.cursor === g.rootId, goal: g.nodes[g.rootId]!.scope,
        counts: { active: count("active"), merged: count("merged"), deferred: count("deferred"), abandoned: count("abandoned") },
        updatedAt: latest(g),
      });
    }
    return { tasks, activeId };
  }

  async function search(q: string) {
    const needle = q.toLowerCase(), results = [];
    if (q.length < 2) return { results: [] };
    for (const s of await service.listTasks()) {
      const r = await store.load(s.id);
      if (!r.ok) continue;
      const g = r.value, logs = await chats.all(g.id);
      for (const n of Object.values(g.nodes)) {
        const sources: { src: string; text: string; msg?: number }[] = [
          ...(logs[n.id]?.messages ?? []).map((m, i) => ({ src: m.role === "user" ? "You" : "Claude", text: m.text, msg: i })),
          ...n.notes.map(x => ({ src: "Note", text: x.text })),
          { src: n.parentId === null ? "Goal" : "Scope", text: n.scope },
          { src: n.parentId === null ? "Motivation" : "Justification", text: n.parentId === null ? n.motivation : n.justification },
          ...(n.resolution ? [{ src: n.resolution.kind, text: n.resolution.summary }] : []),
        ];
        for (const x of sources) {
          const at = x.text.toLowerCase().indexOf(needle);
          if (at < 0) continue;
          results.push({ graphId: g.id, graphTitle: g.nodes[g.rootId]!.title, nodeId: n.id, nodeTitle: n.title, status: n.status, ...x, at });
          if (results.length >= 80) return { results };
        }
      }
    }
    return { results };
  }

  async function chat(req: IncomingMessage, res: ServerResponse, nodeId: NodeId) {
    const message = str(await body(req), "message").trim();
    if (!message) throw new HttpError(400, "message can't be empty.");
    let g = await activeGraph();
    if (!g.nodes[nodeId]) throw new HttpError(404, `There's no node "${nodeId}".`);
    let log = await chats.load(g.id, nodeId);
    const emit = sse(res);
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    let text = "";
    try {
      // Only the cursor can fork, so only messages sent there are checked for tangents.
      if (nodeId === g.cursor) {
        emit("status", { text: "Checking scope…" });
        const t = await service.branchIfTangent(message, log.messages.slice(-6).map(m => ({ role: m.role, text: m.text })));
        if (abort.signal.aborted) return void res.end();
        if (t.branched) {
          g = t.graph; nodeId = g.cursor; log = await chats.load(g.id, nodeId);
          emit("branched", { graph: g, nodeId });
        } else if (t.feedback) emit("notice", { text: t.feedback });
      }
      const r = await claude.streamChat({
        system: tutorSystem(g, nodeId),
        message: log.sessionId ? message : withHistory(log.messages, message),
        ...(log.sessionId ? { sessionId: log.sessionId } : {}),
        model: (await settings.get()).model,
        signal: abort.signal,
      }, t => { text += t; emit("delta", { text: t }); });
      const at = new Date().toISOString();
      const next = { sessionId: r.sessionId, messages: [...log.messages, { role: "user" as const, text: message, at }, { role: "assistant" as const, text, at }] };
      await chats.save(g.id, nodeId, next);
      emit("done", { sessionId: r.sessionId, nodeId });
    } catch (e) {
      emit("error", { message: (e as Error).message });
    }
    res.end();
  }

  /** Undo the empty branch at the cursor, and move its chat back to the parent. */
  async function undo(res: ServerResponse) {
    const before = await activeGraph(), id = before.cursor, parentId = before.nodes[id]!.parentId;
    const r = await service.undo();
    if (r.ok && parentId !== null) {
      const moved = await chats.load(before.id, id);
      if (moved.messages.length) {
        const parent = await chats.load(before.id, parentId);
        // No session id: the parent's Claude session never saw these messages, so the next
        // message re-sends the whole transcript.
        await chats.save(before.id, parentId, { messages: [...parent.messages, ...moved.messages] });
      }
      await chats.remove(before.id, id);
    }
    return reply(res, Promise.resolve(r));
  }

  async function side(req: IncomingMessage, res: ServerResponse) {
    const b = await body(req);
    const message = str(b, "message").trim(), nodeId = str(b, "nodeId"), sessionId = optStr(b, "sessionId"), quote = optStr(b, "quote");
    if (!message) throw new HttpError(400, "message can't be empty.");
    const g = await activeGraph();
    if (!g.nodes[nodeId]) throw new HttpError(404, `There's no node "${nodeId}".`);
    const emit = sse(res);
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    try {
      const r = await claude.streamChat({ system: sideSystem(g, nodeId, quote), message, ...(sessionId ? { sessionId } : {}), model: (await settings.get()).model, signal: abort.signal },
        t => emit("delta", { text: t }));
      emit("done", { sessionId: r.sessionId });
    } catch (e) { emit("error", { message: (e as Error).message }); }
    res.end();
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const p = url.pathname, m = req.method;

      if (m === "GET" && (p === "/" || p === "/index.html")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(await readFile(path.join(webRoot, "index.html")));
      }
      if (m === "GET" && p === "/api/health") return json(res, 200, { claude: await claude.status() });
      if (m === "GET" && p === "/api/settings") return json(res, 200, { settings: await settings.get(), models: MODELS });
      if (m === "POST" && p === "/api/settings") {
        const b = await body(req);
        if (b.model !== undefined && !isModelId(b.model)) throw new HttpError(400, `Unknown model "${String(b.model)}".`);
        return json(res, 200, { settings: await settings.update(isModelId(b.model) ? { model: b.model } : {}), models: MODELS });
      }
      if (m === "GET" && p === "/api/tasks") return json(res, 200, await taskSummaries());
      if (m === "POST" && p === "/api/tasks") {
        const b = await body(req);
        return reply(res, service.startTask({ title: str(b, "title"), scope: str(b, "scope"), motivation: str(b, "motivation") }));
      }
      const activate = /^\/api\/tasks\/([^/]+)\/activate$/.exec(p);
      if (m === "POST" && activate) return reply(res, service.switchTask(decodeURIComponent(activate[1]!)));
      if (m === "GET" && p === "/api/graph") return reply(res, service.current());
      if (m === "GET" && p === "/api/search") return json(res, 200, await search(url.searchParams.get("q") ?? ""));

      const action = /^\/api\/graph\/(fork|continue|merge|abandon|defer|complete|note|strike)$/.exec(p);
      if (m === "POST" && action) {
        const b = await body(req);
        switch (action[1]) {
          case "fork": return reply(res, service.fork({ title: str(b, "title"), scope: str(b, "scope"), justification: str(b, "justification") }));
          case "continue": {
            const title = optStr(b, "title");
            return reply(res, service.continueBranch({ source: str(b, "source"), scope: str(b, "scope"), justification: str(b, "justification"), ...(title !== undefined ? { title } : {}) }));
          }
          case "merge": return reply(res, service.merge(str(b, "summary")));
          case "abandon": return reply(res, service.abandon(str(b, "summary")));
          case "defer": return reply(res, service.defer(str(b, "summary")));
          case "complete": return reply(res, service.complete(str(b, "summary")));
          case "note": return reply(res, service.note(str(b, "text"), optStr(b, "nodeId")));
          case "strike": return reply(res, service.strike(str(b, "noteId"), optStr(b, "reason")));
        }
      }

      const chatPath = /^\/api\/chat\/([^/]+)$/.exec(p);
      if (chatPath && m === "GET") {
        const g = await activeGraph();
        return json(res, 200, await chats.load(g.id, decodeURIComponent(chatPath[1]!)));
      }
      if (chatPath && m === "POST") return await chat(req, res, decodeURIComponent(chatPath[1]!));
      if (m === "POST" && p === "/api/side") return await side(req, res);
      if (m === "POST" && p === "/api/graph/undo") return await undo(res);

      json(res, 404, { message: "Not found." });
    } catch (e) {
      if (res.headersSent) return void res.end();
      if (e instanceof HttpError) return json(res, e.status, { message: e.message });
      json(res, 500, { message: (e as Error).message });
    }
  };
}

/** Most recent timestamp anywhere in the graph: a cheap "last updated". */
function latest(g: Graph): string {
  let t = g.createdAt;
  const bump = (x?: string) => { if (x && x > t) t = x; };
  for (const n of Object.values(g.nodes) as GraphNode[]) {
    bump(n.createdAt); bump(n.resolution?.at);
    for (const note of n.notes) { bump(note.createdAt); bump(note.struck?.at); }
  }
  return t;
}
