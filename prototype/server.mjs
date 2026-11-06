// Tangent Graph prototype server.
// Serves index.html and bridges the page to Claude Code in headless mode (`claude -p`).
// Zero dependencies. Listens on localhost only.
//
//   node prototype/server.mjs          → http://localhost:5179
//
// Endpoints:
//   GET  /api/health   → { loggedIn, version } from `claude auth status`
//   POST /api/chat     → streams a reply (Server-Sent Events). Body: { system, message, sessionId? }
//                        Reuses the Claude session per node via --session-id / --resume.
//   POST /api/judge    → { ok, feedback } for a fork's justification (structured output).

import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 5179;
const HERE = path.dirname(fileURLToPath(import.meta.url));
// Claude runs in its own empty folder so it never picks up this project's files or CLAUDE.md.
const RUN_DIR = path.join(os.tmpdir(), "tangent-graph-claude");
const TIMEOUT_MS = 180_000;

// Find the Claude Code binary. On Windows the npm shim is a .cmd, which can't be spawned
// without a shell, so go straight to the bundled claude.exe.
function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  if (process.platform === "win32") {
    const candidates = [
      path.join(os.homedir(), ".local", "bin", "claude.exe"), // official native installer
      path.join(process.env.APPDATA || "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"), // npm install -g
    ];
    for (const exe of candidates) if (existsSync(exe)) return exe;
  }
  return "claude"; // on PATH (Node finds claude.exe without needing a shell)
}
const CLAUDE = findClaude();

// Same options for every call: no tools (pure conversation), no user customizations.
const BASE_ARGS = ["-p", "--tools", "", "--safe-mode"];

function runClaude(args, stdinText, { onLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    // Start from a clean environment: if this server was launched from inside another Claude
    // session (e.g. the desktop app), its CLAUDE_* settings would make the CLI expect the host
    // to handle sign-in. We want it to behave exactly like running `claude` in a terminal.
    const env = Object.fromEntries(Object.entries(process.env)
      .filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_)/.test(k)));
    const child = spawn(CLAUDE, args, { cwd: RUN_DIR, env, windowsHide: true });
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    signal?.addEventListener("abort", () => child.kill());
    let out = "", err = "", buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      out += chunk;
      if (!onLine) return;
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) onLine(line);
      }
    });
    child.stderr.on("data", c => { err += c; });
    child.on("error", e => { clearTimeout(timer); reject(e); });
    child.on("close", code => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.end(stdinText);
  });
}

async function readBody(req) {
  let s = "";
  for await (const c of req) { s += c; if (s.length > 1e6) throw new Error("Body too large"); }
  return s ? JSON.parse(s) : {};
}

const send = (res, status, obj) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};

async function health(res) {
  try {
    const { out } = await runClaude(["auth", "status"], "");
    const status = JSON.parse(out.slice(out.indexOf("{")));
    send(res, 200, { loggedIn: !!status.loggedIn, method: status.authMethod });
  } catch (e) {
    send(res, 200, { loggedIn: false, error: `Couldn't run Claude Code (${e.message})` });
  }
}

// Streams Claude's reply as SSE: event "delta" {text}, then "done" {sessionId} or "error" {message}.
async function chat(req, res) {
  const { system, message, sessionId } = await readBody(req);
  if (!message?.trim()) return send(res, 400, { error: "Empty message" });
  const id = sessionId || randomUUID();
  const args = [...BASE_ARGS, "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--system-prompt", system || "", ...(sessionId ? ["--resume", id] : ["--session-id", id])];

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  let finalError = null, gotText = false;
  try {
    const { code, err } = await runClaude(args, message, {
      signal: abort.signal,
      onLine(line) {
        let m; try { m = JSON.parse(line); } catch { return; }
        if (m.type === "stream_event" && m.event?.type === "content_block_delta" && m.event.delta?.type === "text_delta") {
          gotText = true; emit("delta", { text: m.event.delta.text });
        } else if (m.type === "result" && m.is_error) {
          finalError = m.result || "Claude returned an error";
        } else if (m.type === "result" && !gotText && m.result) {
          emit("delta", { text: m.result }); // fallback if partial messages weren't sent
        }
      },
    });
    if (!finalError && code !== 0) finalError = err.trim() || `Claude exited with code ${code}`;
  } catch (e) { finalError = e.message; }
  finalError ? emit("error", { message: finalError }) : emit("done", { sessionId: id });
  res.end();
}

const JUDGE_SYSTEM = `You review "tangents" in a learning tool that stops people from rabbit-holing.
A tangent is a side question the learner wants to branch into, away from a parent goal.
Approve it only if the justification names a concrete change in what the learner will do for the parent goal,
depending on the answer. Topical relatedness, curiosity, or "it's interesting" is NOT enough.
Also check that the scope says what "done" looks like.
Feedback: one or two short sentences, addressed to the learner as "you". If you reject, say what's missing.`;

async function judge(req, res) {
  const { parentGoal, title, scope, justification } = await readBody(req);
  const schema = { type: "object", properties: { ok: { type: "boolean" }, feedback: { type: "string" } }, required: ["ok", "feedback"] };
  const prompt = `Parent goal: ${parentGoal}\nTangent: ${title}\nScope: ${scope}\nJustification: ${justification}`;
  try {
    const { out, err, code } = await runClaude([...BASE_ARGS, "--output-format", "json", "--no-session-persistence",
      "--system-prompt", JUDGE_SYSTEM, "--json-schema", JSON.stringify(schema)], prompt);
    const r = JSON.parse(out);
    if (r.is_error) return send(res, 502, { error: r.result || "Claude returned an error" });
    const v = r.structured_output ?? JSON.parse(r.result);
    send(res, 200, { ok: !!v.ok, feedback: String(v.feedback || "") });
  } catch (e) {
    send(res, 502, { error: e.message });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(await readFile(path.join(HERE, "index.html")));
    }
    if (req.method === "GET" && url.pathname === "/api/health") return health(res);
    if (req.method === "POST" && url.pathname === "/api/chat") return chat(req, res);
    if (req.method === "POST" && url.pathname === "/api/judge") return judge(req, res);
    send(res, 404, { error: "Not found" });
  } catch (e) {
    if (!res.headersSent) send(res, 500, { error: e.message });
    else res.end();
  }
});

await mkdir(RUN_DIR, { recursive: true });
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Tangent Graph prototype: http://localhost:${PORT}`);
  console.log(`Using Claude Code at: ${CLAUDE}`);
});
