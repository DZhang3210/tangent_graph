// Checks that parsed JSON really is a Graph before anything trusts it.
// Hand-written on purpose: the shape is small and this keeps the project dependency-free.

import { SCHEMA_VERSION, type Graph } from "../core/index.js";

export type GraphCheck =
  | { ok: true; graph: Graph }
  | { ok: false; problem: "version"; version: unknown }
  | { ok: false; problem: "shape"; detail: string };

const BRANCH_STATUSES = ["active", "merged", "abandoned", "deferred"];
const ROOT_STATUSES = ["active", "completed", "abandoned"];
const KINDS = ["merge", "abandon", "defer", "complete"];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";

export function checkGraph(data: unknown): GraphCheck {
  if (!isObj(data)) return bad("not an object");
  if (data.schemaVersion !== SCHEMA_VERSION) return { ok: false, problem: "version", version: data.schemaVersion };
  for (const k of ["id", "rootId", "cursor", "createdAt"]) if (!isStr(data[k])) return bad(`"${k}" must be a string`);
  if (!isObj(data.nodes)) return bad(`"nodes" must be an object`);
  const nodes = data.nodes;
  if (!isObj(nodes[data.rootId as string])) return bad("root node is missing");
  if (!isObj(nodes[data.cursor as string])) return bad("cursor points to a missing node");

  for (const [id, n] of Object.entries(nodes)) {
    const where = `node "${id}"`;
    if (!isObj(n)) return bad(`${where} is not an object`);
    if (n.id !== id) return bad(`${where} has a mismatched id`);
    for (const k of ["title", "scope", "createdAt", "status"]) if (!isStr(n[k])) return bad(`${where}: "${k}" must be a string`);
    if (!Array.isArray(n.notes)) return bad(`${where}: "notes" must be a list`);
    for (const note of n.notes) {
      if (!isObj(note) || !isStr(note.id) || !isStr(note.text) || !isStr(note.createdAt)) return bad(`${where}: malformed note`);
    }
    if (n.resolution !== undefined) {
      const r = n.resolution;
      if (!isObj(r) || !KINDS.includes(r.kind as string) || !isStr(r.summary) || !isStr(r.at)) return bad(`${where}: malformed resolution`);
    }
    if (id === data.rootId) {
      if (n.parentId !== null) return bad(`${where}: root must have no parent`);
      if (!isStr(n.motivation)) return bad(`${where}: root needs a motivation`);
      if (!ROOT_STATUSES.includes(n.status as string)) return bad(`${where}: unknown status "${String(n.status)}"`);
    } else {
      if (!isStr(n.parentId) || !isObj(nodes[n.parentId])) return bad(`${where}: parent is missing`);
      if (!isStr(n.justification)) return bad(`${where}: branch needs a justification`);
      if (!BRANCH_STATUSES.includes(n.status as string)) return bad(`${where}: unknown status "${String(n.status)}"`);
    }
  }
  return { ok: true, graph: data as unknown as Graph };
}

const bad = (detail: string): GraphCheck => ({ ok: false, problem: "shape", detail });
