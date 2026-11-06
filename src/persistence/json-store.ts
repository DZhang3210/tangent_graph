// Saves each graph as data/graphs/<id>.json and remembers the active one in data/active.json.
// This is the only module (besides the CLI's own output) that touches the disk.

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { err, ok, type Graph, type GraphId, type Result, type RootStatus } from "../core/index.js";
import { checkGraph } from "./validate.js";

export type StoreError =
  | { readonly code: "NOT_FOUND"; readonly graphId: GraphId }
  | { readonly code: "CORRUPT"; readonly file: string; readonly detail: string }
  | { readonly code: "UNSUPPORTED_VERSION"; readonly file: string; readonly version: unknown };

export interface GraphSummary {
  readonly id: GraphId;
  readonly title: string;
  readonly status: RootStatus;
  readonly nodeCount: number;
  readonly createdAt: string;
}

export interface GraphStore {
  load(id: GraphId): Promise<Result<Graph, StoreError>>;
  save(graph: Graph): Promise<void>;
  /** Every readable graph. Unreadable files are skipped, not fatal. */
  list(): Promise<GraphSummary[]>;
  getActive(): Promise<GraphId | null>;
  setActive(id: GraphId): Promise<void>;
}

export function describeStoreError(e: StoreError): string {
  switch (e.code) {
    case "NOT_FOUND": return `There's no saved main task "${e.graphId}".`;
    case "CORRUPT": return `${e.file} is damaged and wasn't loaded (${e.detail}).`;
    case "UNSUPPORTED_VERSION": return `${e.file} was saved by an unknown version (${String(e.version)}) and wasn't loaded.`;
  }
}

export function jsonStore(dataDir: string): GraphStore {
  const graphsDir = path.join(dataDir, "graphs");
  const fileOf = (id: GraphId) => path.join(graphsDir, `${safeName(id)}.json`);
  const activeFile = path.join(dataDir, "active.json");

  async function load(id: GraphId): Promise<Result<Graph, StoreError>> {
    const file = fileOf(id);
    let text: string;
    try { text = await readFile(file, "utf8"); }
    catch (e) { if (isMissing(e)) return err({ code: "NOT_FOUND", graphId: id }); throw e; }
    let data: unknown;
    try { data = JSON.parse(text); }
    catch { return err({ code: "CORRUPT", file, detail: "not valid JSON" }); }
    const check = checkGraph(data);
    if (check.ok) return ok(check.graph);
    return check.problem === "version"
      ? err({ code: "UNSUPPORTED_VERSION", file, version: check.version })
      : err({ code: "CORRUPT", file, detail: check.detail });
  }

  return {
    load,
    save: g => writeAtomic(fileOf(g.id), JSON.stringify(g, null, 2) + "\n"),

    async list() {
      let files: string[];
      try { files = await readdir(graphsDir); } catch (e) { if (isMissing(e)) return []; throw e; }
      const out: GraphSummary[] = [];
      for (const f of files.filter(f => f.endsWith(".json"))) {
        const r = await load(f.slice(0, -".json".length));
        if (!r.ok) continue;
        const g = r.value, root = g.nodes[g.rootId]!;
        out.push({ id: g.id, title: root.title, status: root.status as RootStatus, nodeCount: Object.keys(g.nodes).length, createdAt: g.createdAt });
      }
      return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async getActive() {
      try {
        const data: unknown = JSON.parse(await readFile(activeFile, "utf8"));
        return typeof data === "object" && data && typeof (data as { graphId?: unknown }).graphId === "string"
          ? (data as { graphId: string }).graphId : null;
      } catch { return null; }
    },

    setActive: id => writeAtomic(activeFile, JSON.stringify({ graphId: id }) + "\n"),
  };
}

/** Write to a temp file, then rename over the target, so a crash never leaves half a file. */
async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}

const isMissing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";

/** Ids come from our own generator, but never let one escape the data folder. */
const safeName = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "_");
