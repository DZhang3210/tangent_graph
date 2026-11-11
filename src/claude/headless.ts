// Runs Claude Code in headless mode (`claude -p`). The only module that spawns Claude.
// Every call: no tools (pure conversation), no user customizations, an empty working folder.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { modelArgs, type ModelId } from "./models.js";

const RUN_DIR = path.join(os.tmpdir(), "tangent-graph-claude");
const TIMEOUT_MS = 180_000;
const BASE_ARGS = ["-p", "--tools", "", "--safe-mode"];

/**
 * Usual install spots, checked before PATH. Apps started from the Start menu or the Dock
 * don't always get the PATH a terminal has (on Mac they never do).
 */
export function claudeCandidates(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): string[] {
  if (platform === "win32") {
    const p = path.win32;
    return [
      p.join(home, ".local", "bin", "claude.exe"),
      p.join(env.APPDATA ?? "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
    ];
  }
  const p = path.posix;
  return [p.join(home, ".local", "bin", "claude"), p.join(home, ".claude", "local", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
}

/** Where Claude Code is installed. Override with CLAUDE_BIN. */
export function findClaude(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  for (const exe of claudeCandidates(process.platform, os.homedir(), process.env)) if (existsSync(exe)) return exe;
  return "claude"; // on PATH; Node finds claude.exe without a shell
}

/**
 * The parent's environment minus another Claude session's settings. If this server was started
 * from inside Claude Code (or the desktop app), those settings would make the CLI expect the host
 * to handle sign-in. We want it to behave exactly like `claude` typed in a terminal.
 */
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env)
    .filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_)/.test(k)));
}

interface RunResult { code: number | null; out: string; err: string }

function run(args: string[], stdin: string, opts: { onLine?: (line: string) => void; signal?: AbortSignal } = {}): Promise<RunResult> {
  mkdirSync(RUN_DIR, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(findClaude(), args, { cwd: RUN_DIR, env: cleanEnv(), windowsHide: true });
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    opts.signal?.addEventListener("abort", () => child.kill());
    let out = "", err = "", buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      if (!opts.onLine) return;
      buf += chunk;
      for (let i; (i = buf.indexOf("\n")) >= 0;) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) opts.onLine(line);
      }
    });
    child.stderr.on("data", c => { err += c; });
    child.on("error", e => { clearTimeout(timer); reject(e); });
    child.on("close", code => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.end(stdin);
  });
}

/** Is the CLI installed and signed in? */
export async function claudeStatus(): Promise<{ loggedIn: boolean; error?: string }> {
  try {
    const { out } = await run(["auth", "status"], "");
    return { loggedIn: !!JSON.parse(out.slice(out.indexOf("{"))).loggedIn };
  } catch (e) {
    return { loggedIn: false, error: `Couldn't run Claude Code (${(e as Error).message})` };
  }
}

export interface ChatRequest {
  system: string;
  message: string;
  /** Continue this Claude session; omit to start a new one. */
  sessionId?: string;
  /** Which model to use; "auto" or omitted lets Claude Code decide. */
  model?: ModelId;
  signal?: AbortSignal;
}

/** Streams a reply. Calls onDelta with text as it arrives. Resolves with the session id to reuse. */
export async function streamChat(req: ChatRequest, onDelta: (text: string) => void): Promise<{ sessionId: string }> {
  const id = req.sessionId ?? randomUUID();
  const args = [...BASE_ARGS, ...modelArgs(req.model), "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--system-prompt", req.system, ...(req.sessionId ? ["--resume", id] : ["--session-id", id])];
  let error: string | null = null, gotText = false;
  const { code, err } = await run(args, req.message, {
    ...(req.signal ? { signal: req.signal } : {}),
    onLine(line) {
      let m: any;
      try { m = JSON.parse(line); } catch { return; }
      if (m.type === "stream_event" && m.event?.type === "content_block_delta" && m.event.delta?.type === "text_delta") {
        gotText = true;
        onDelta(m.event.delta.text);
      } else if (m.type === "result") {
        if (m.is_error) error = m.result || "Claude returned an error";
        else if (!gotText && m.result) onDelta(m.result); // in case partial messages weren't sent
      }
    },
  });
  if (!error && code !== 0) error = err.trim() || `Claude exited with code ${code}`;
  if (error) throw new Error(error);
  return { sessionId: id };
}

/** One structured answer, validated by Claude Code against `schema`. Not saved as a session. */
export async function askJson<T>(req: { system: string; prompt: string; schema: object; model?: ModelId }): Promise<T> {
  const { out } = await run([...BASE_ARGS, ...modelArgs(req.model), "--output-format", "json", "--no-session-persistence",
    "--system-prompt", req.system, "--json-schema", JSON.stringify(req.schema)], req.prompt);
  let r: any;
  try { r = JSON.parse(out); } catch { throw new Error("Claude's reply wasn't readable."); }
  if (r.is_error) throw new Error(r.result || "Claude returned an error");
  return (r.structured_output ?? JSON.parse(r.result)) as T;
}
