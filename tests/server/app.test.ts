import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stubJudge, type Judge } from "../../src/judge/index.js";
import { memoryChatStore, memoryStore } from "../../src/persistence/index.js";
import { createApp, type ClaudeBridge } from "../../src/server/app.js";
import { createService } from "../../src/service/index.js";
import { branchInput, makeCtx, rootInput } from "../core/helpers.js";

let server: http.Server, base: string, calls: { system: string; message: string; sessionId?: string }[];

function start(judge: Judge = stubJudge) {
  const store = memoryStore(), chats = memoryChatStore();
  calls = [];
  const claude: ClaudeBridge = {
    status: async () => ({ loggedIn: true }),
    streamChat: async (req, onDelta) => {
      calls.push({ system: req.system, message: req.message, ...(req.sessionId ? { sessionId: req.sessionId } : {}) });
      onDelta("Hello ");
      onDelta("there.");
      return { sessionId: req.sessionId ?? "session-1" };
    },
  };
  const app = createApp({ service: createService({ store, judge, ctx: makeCtx() }), store, chats, claude });
  server = http.createServer(app);
  return new Promise<void>(r => server.listen(0, "127.0.0.1", () => {
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    r();
  }));
}

beforeEach(() => start());
afterEach(() => new Promise<void>(r => server.close(() => r())));

const post = (p: string, body: unknown = {}) =>
  fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const get = (p: string) => fetch(base + p);
// Response bodies are untyped JSON in these tests.
const any = (x: unknown): any => x;

async function sse(res: Response) {
  const text = await res.text();
  return text.trim().split("\n\n").map(block => ({
    event: /^event: (.+)$/m.exec(block)![1],
    data: JSON.parse(/^data: (.*)$/m.exec(block)![1]!),
  }));
}

describe("server", () => {
  it("creates a main task and returns the active graph", async () => {
    const created = await post("/api/tasks", rootInput);
    expect(created.status).toBe(200);
    const { graph } = await created.json().then(any);
    const res = await (await get("/api/graph")).json().then(any);
    expect(res.graph.id).toBe(graph.id);
  });

  it("returns 404 with a message when there's no main task", async () => {
    const res = await get("/api/graph");
    expect(res.status).toBe(404);
    expect((await res.json().then(any)).message).toContain("no active main task");
  });

  it("forks, merges and reports rule violations with useful status codes", async () => {
    await post("/api/tasks", rootInput);
    const forked = await (await post("/api/graph/fork", branchInput())).json().then(any);
    expect(forked.graph.nodes[forked.graph.cursor].title).toBe(branchInput().title);

    const empty = await post("/api/graph/merge", { summary: "  " });
    expect(empty.status).toBe(400);
    expect(await empty.json().then(any)).toMatchObject({ error: { kind: "domain", error: { code: "EMPTY_FIELD", field: "summary" } }, message: "summary can't be empty." });

    const merged = await (await post("/api/graph/merge", { summary: "Go and Postgres." })).json().then(any);
    expect(merged.graph.cursor).toBe(merged.graph.rootId);

    const rootMerge = await post("/api/graph/merge", { summary: "x" });
    expect(rootMerge.status).toBe(409);
  });

  it("returns 422 with the judge's feedback when it rejects", async () => {
    await new Promise<void>(r => server.close(() => r()));
    await start({ ...stubJudge, reviewJustification: async () => ({ ok: false, feedback: "Curiosity isn't a reason." }) });
    await post("/api/tasks", rootInput);
    const res = await post("/api/graph/fork", branchInput());
    expect(res.status).toBe(422);
    expect((await res.json().then(any)).error).toEqual({ kind: "rejected", feedback: "Curiosity isn't a reason." });
  });

  it("adds and strikes notes", async () => {
    const { graph } = await (await post("/api/tasks", rootInput)).json().then(any);
    const noted = await (await post("/api/graph/note", { text: "Idea", nodeId: graph.rootId })).json().then(any);
    const noteId = noted.graph.nodes[graph.rootId].notes[0].id;
    const struck = await (await post("/api/graph/strike", { noteId, reason: "Old" })).json().then(any);
    expect(struck.graph.nodes[graph.rootId].notes[0].struck.reason).toBe("Old");
  });

  it("lists main tasks with where you left off", async () => {
    await post("/api/tasks", rootInput);
    await post("/api/graph/fork", branchInput());
    const { tasks, activeId } = await (await get("/api/tasks")).json().then(any);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: activeId, title: rootInput.title, cursorTitle: branchInput().title, counts: { active: 1 } });
  });

  it("streams a chat reply, then saves the transcript and session for the node", async () => {
    const { graph } = await (await post("/api/tasks", rootInput)).json().then(any);
    const events = await sse(await post(`/api/chat/${graph.rootId}`, { message: "First question" }));
    expect(events.filter(e => e.event === "delta").map(e => e.data.text).join("")).toBe("Hello there.");
    expect(events.at(-1)!.event).toBe("done");
    expect(calls[0]!.system).toContain(`Session: ${rootInput.title}`);

    const log = await (await get(`/api/chat/${graph.rootId}`)).json().then(any);
    expect(log).toMatchObject({ sessionId: "session-1", messages: [{ role: "user", text: "First question" }, { role: "assistant", text: "Hello there." }] });

    await sse(await post(`/api/chat/${graph.rootId}`, { message: "Follow-up" }));
    expect(calls[1]).toMatchObject({ sessionId: "session-1", message: "Follow-up" });
  });

  it("answers side questions without saving them", async () => {
    const { graph } = await (await post("/api/tasks", rootInput)).json().then(any);
    const events = await sse(await post("/api/side", { nodeId: graph.rootId, quote: "a passage", message: "What?" }));
    expect(events.at(-1)).toEqual({ event: "done", data: { sessionId: "session-1" } });
    expect(calls[0]!.system).toContain("a passage");
    expect((await (await get(`/api/chat/${graph.rootId}`)).json().then(any)).messages).toEqual([]);
  });

  it("searches node text, notes and chats across every main task", async () => {
    const { graph } = await (await post("/api/tasks", rootInput)).json().then(any);
    await post("/api/graph/note", { text: "Mention .subscribe() pattern" });
    await sse(await post(`/api/chat/${graph.rootId}`, { message: "what about .subscribe?" }));
    const { results } = await (await get("/api/search?q=.subscribe")).json().then(any);
    expect(results.map((r: { src: string }) => r.src).sort()).toEqual(["Note", "You"]);
    expect(results[0]).toMatchObject({ graphId: graph.id, nodeId: graph.rootId });
  });

  it("rejects unknown routes and bad JSON", async () => {
    expect((await get("/api/nope")).status).toBe(404);
    const bad = await fetch(base + "/api/tasks", { method: "POST", body: "{nope" });
    expect(bad.status).toBe(400);
  });
});
