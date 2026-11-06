// Chat transcripts, kept apart from the graph (chat isn't a domain rule, just a record).
// data/chats/<graphId>/<nodeId>.json → { sessionId?, messages[] }

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { GraphId, NodeId } from "../core/index.js";

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly at: string;
}

export interface ChatLog {
  /** The Claude Code session that holds this conversation, once one exists. */
  readonly sessionId?: string;
  readonly messages: readonly ChatMessage[];
}

export interface ChatStore {
  load(graphId: GraphId, nodeId: NodeId): Promise<ChatLog>;
  save(graphId: GraphId, nodeId: NodeId, log: ChatLog): Promise<void>;
  /** Every node's log in a graph, for search. */
  all(graphId: GraphId): Promise<Record<NodeId, ChatLog>>;
}

const EMPTY: ChatLog = { messages: [] };
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");

export function jsonChatStore(dataDir: string): ChatStore {
  const dirOf = (g: GraphId) => path.join(dataDir, "chats", safe(g));
  const fileOf = (g: GraphId, n: NodeId) => path.join(dirOf(g), `${safe(n)}.json`);

  async function read(file: string): Promise<ChatLog> {
    try {
      const data = JSON.parse(await readFile(file, "utf8"));
      return Array.isArray(data?.messages) ? data : EMPTY;
    } catch { return EMPTY; } // missing or damaged: start fresh rather than block the chat
  }

  return {
    load: (g, n) => read(fileOf(g, n)),
    async save(g, n, log) {
      await mkdir(dirOf(g), { recursive: true });
      const file = fileOf(g, n), tmp = `${file}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify(log, null, 2) + "\n", "utf8");
      await rename(tmp, file);
    },
    async all(g) {
      let files: string[];
      try { files = await readdir(dirOf(g)); } catch { return {}; }
      const out: Record<NodeId, ChatLog> = {};
      for (const f of files.filter(f => f.endsWith(".json"))) out[f.slice(0, -5)] = await read(path.join(dirOf(g), f));
      return out;
    },
  };
}

export function memoryChatStore(): ChatStore {
  const logs = new Map<string, ChatLog>();
  const key = (g: GraphId, n: NodeId) => `${g}/${n}`;
  return {
    load: async (g, n) => structuredClone(logs.get(key(g, n)) ?? EMPTY),
    save: async (g, n, log) => { logs.set(key(g, n), structuredClone(log)); },
    all: async g => Object.fromEntries([...logs].filter(([k]) => k.startsWith(`${g}/`)).map(([k, v]) => [k.slice(g.length + 1), v])),
  };
}
