// Every operation that changes a graph. Pure: (graph, input, ctx) → Result<new graph, DomainError>.
// The input graph is never mutated. See SPEC.md for the rules each one enforces.

import type { DomainError } from "./errors.js";
import { err, ok, type Result } from "./result.js";
import { branchesOf, getNode, isClosed, isRoot, openBranchOf } from "./queries.js";
import {
  SCHEMA_VERSION,
  type BranchNode, type Ctx, type Graph, type GraphNode, type NodeId, type Note, type NoteId,
  type ResolutionKind, type RootNode,
} from "./types.js";

type Outcome = Result<Graph, DomainError>;

// ---------- small helpers ----------

/** Trims every field and returns the first one that's empty, in the order given. */
function requireText<K extends string>(fields: [K, string][]): Result<Record<K, string>, DomainError> {
  const out = {} as Record<K, string>;
  for (const [name, value] of fields) {
    const t = value.trim();
    if (!t) return err({ code: "EMPTY_FIELD", field: name });
    out[name] = t;
  }
  return ok(out);
}

const withNode = (g: Graph, node: GraphNode, extra: Partial<Graph> = {}): Graph =>
  ({ ...g, ...extra, nodes: { ...g.nodes, [node.id]: node } });

/**
 * Guards shared by every structural action, in the precedence SPEC.md defines:
 * GRAPH_CLOSED → NODE_NOT_FOUND → ALREADY_RESOLVED → NODE_LOCKED → NOT_AT_CURSOR.
 */
function structural(g: Graph, id: NodeId): Result<GraphNode, DomainError> {
  if (isClosed(g)) return err({ code: "GRAPH_CLOSED" });
  const node = getNode(g, id);
  if (!node) return err({ code: "NODE_NOT_FOUND", nodeId: id });
  if (node.status !== "active") return err({ code: "ALREADY_RESOLVED", nodeId: id, status: node.status });
  const open = openBranchOf(g, id);
  if (open) return err({ code: "NODE_LOCKED", nodeId: id, openBranchId: open });
  if (g.cursor !== id) return err({ code: "NOT_AT_CURSOR", nodeId: id, cursor: g.cursor });
  return ok(node);
}

// ---------- creating ----------

export interface CreateGraphInput { title: string; scope: string; motivation: string }

/** Starts a main task: a graph with one active root, cursor on it. */
export function createGraph(input: CreateGraphInput, ctx: Ctx): Outcome {
  const t = requireText([["title", input.title], ["scope", input.scope], ["motivation", input.motivation]]);
  if (!t.ok) return t;
  const at = ctx.now();
  const root: RootNode = { id: ctx.newId(), parentId: null, status: "active", createdAt: at, notes: [], ...t.value };
  return ok({ schemaVersion: SCHEMA_VERSION, id: ctx.newId(), rootId: root.id, cursor: root.id, nodes: { [root.id]: root }, createdAt: at });
}

// ---------- forking ----------

export interface ForkInput { from: NodeId; title: string; scope: string; justification: string }

/** New active branch under the cursor; the cursor moves into it. */
export function fork(g: Graph, input: ForkInput, ctx: Ctx): Outcome {
  const from = structural(g, input.from);
  if (!from.ok) return from;
  const t = requireText([["title", input.title], ["scope", input.scope], ["justification", input.justification]]);
  if (!t.ok) return t;
  return ok(addBranch(g, from.value.id, t.value, ctx));
}

function addBranch(g: Graph, parentId: NodeId, fields: Pick<BranchNode, "title" | "scope" | "justification" | "continuesFrom" | "seq">, ctx: Ctx): Graph {
  const branch: BranchNode = { id: ctx.newId(), parentId, status: "active", createdAt: ctx.now(), notes: [], ...fields };
  return withNode(g, branch, { cursor: branch.id });
}

export interface ContinueInput { from: NodeId; source: NodeId; scope: string; justification: string; title?: string }

/** Revisit a resolved branch of the cursor as a new, linked branch (#2, #3, …). */
export function continueBranch(g: Graph, input: ContinueInput, ctx: Ctx): Outcome {
  const from = structural(g, input.from);
  if (!from.ok) return from;
  const source = getNode(g, input.source);
  if (!source) return err({ code: "NODE_NOT_FOUND", nodeId: input.source });
  if (source.parentId === null) return err({ code: "NOT_CONTINUABLE", nodeId: source.id, reason: { why: "is-root" } });
  if (source.status === "active") return err({ code: "NOT_CONTINUABLE", nodeId: source.id, reason: { why: "still-active" } });
  if (source.parentId !== from.value.id) return err({ code: "NOT_CONTINUABLE", nodeId: source.id, reason: { why: "not-a-child-of-cursor" } });
  const t = requireText([["title", input.title ?? source.title], ["scope", input.scope], ["justification", input.justification]]);
  if (!t.ok) return t;
  return ok(addBranch(g, from.value.id, { ...t.value, continuesFrom: source.id, seq: (source.seq ?? 1) + 1 }, ctx));
}

export interface UndoInput { nodeId: NodeId }

/** Removes an empty branch at the cursor, as if it was never forked. */
export function undoBranch(g: Graph, input: UndoInput, _ctx: Ctx): Outcome {
  const n = structural(g, input.nodeId);
  if (!n.ok) return n;
  const node = n.value, id = node.id;
  if (node.parentId === null) return err({ code: "NOT_UNDOABLE", nodeId: id, reason: "is-root" });
  if (node.notes.length) return err({ code: "NOT_UNDOABLE", nodeId: id, reason: "has-notes" });
  if (branchesOf(g, id).length) return err({ code: "NOT_UNDOABLE", nodeId: id, reason: "has-branches" });
  const { [id]: _gone, ...nodes } = g.nodes;
  return ok({ ...g, nodes, cursor: node.parentId });
}

// ---------- resolving and closing ----------

export interface ResolveInput { nodeId: NodeId; summary: string }

function resolveBranch(g: Graph, input: ResolveInput, kind: "merge" | "abandon" | "defer", ctx: Ctx): Outcome {
  const n = structural(g, input.nodeId);
  if (!n.ok) return n;
  if (n.value.parentId === null) return err({ code: "ROOT_CANT_RESOLVE", nodeId: n.value.id });
  const t = requireText([["summary", input.summary]]);
  if (!t.ok) return t;
  const status = ({ merge: "merged", abandon: "abandoned", defer: "deferred" } as const)[kind];
  const node: BranchNode = { ...n.value, status, resolution: { kind, summary: t.value.summary, at: ctx.now() } };
  return ok(withNode(g, node, { cursor: n.value.parentId }));
}

function closeRoot(g: Graph, input: ResolveInput, kind: "complete" | "abandon", ctx: Ctx): Outcome {
  const n = structural(g, input.nodeId);
  if (!n.ok) return n;
  if (n.value.parentId !== null) return err({ code: "NOT_ROOT", nodeId: n.value.id });
  const t = requireText([["summary", input.summary]]);
  if (!t.ok) return t;
  const resolution: { kind: ResolutionKind; summary: string; at: string } = { kind, summary: t.value.summary, at: ctx.now() };
  const node: RootNode = { ...n.value, status: kind === "complete" ? "completed" : "abandoned", resolution };
  return ok(withNode(g, node));
}

/** Merge the cursor branch: what was usefully learned, for the parent. */
export const merge = (g: Graph, input: ResolveInput, ctx: Ctx): Outcome => resolveBranch(g, input, "merge", ctx);

/** Defer the cursor branch: where you stopped and why. */
export const defer = (g: Graph, input: ResolveInput, ctx: Ctx): Outcome => resolveBranch(g, input, "defer", ctx);

/** Abandon the cursor: a branch (why it went off-purpose) or, on the root, the whole main task. */
export function abandon(g: Graph, input: ResolveInput, ctx: Ctx): Outcome {
  const node = getNode(g, input.nodeId);
  return node && isRoot(node) ? closeRoot(g, input, "abandon", ctx) : resolveBranch(g, input, "abandon", ctx);
}

/** Complete the main task. Root only, with every branch resolved. */
export const complete = (g: Graph, input: ResolveInput, ctx: Ctx): Outcome => closeRoot(g, input, "complete", ctx);

// ---------- notes (allowed on any node, any time) ----------

export interface AddNoteInput { nodeId: NodeId; text: string }

export function addNote(g: Graph, input: AddNoteInput, ctx: Ctx): Outcome {
  const node = getNode(g, input.nodeId);
  if (!node) return err({ code: "NODE_NOT_FOUND", nodeId: input.nodeId });
  const t = requireText([["text", input.text]]);
  if (!t.ok) return t;
  const note: Note = { id: ctx.newId(), text: t.value.text, createdAt: ctx.now() };
  return ok(withNode(g, { ...node, notes: [...node.notes, note] }));
}

export interface StrikeNoteInput { nodeId: NodeId; noteId: NoteId; reason?: string }

/** Marks a note struck. It stays visible; it can't be un-struck or struck again. */
export function strikeNote(g: Graph, input: StrikeNoteInput, ctx: Ctx): Outcome {
  const node = getNode(g, input.nodeId);
  if (!node) return err({ code: "NODE_NOT_FOUND", nodeId: input.nodeId });
  const note = node.notes.find(n => n.id === input.noteId);
  if (!note) return err({ code: "NOTE_NOT_FOUND", nodeId: node.id, noteId: input.noteId });
  if (note.struck) return err({ code: "NOTE_ALREADY_STRUCK", nodeId: node.id, noteId: note.id });
  const reason = input.reason?.trim();
  const struck = reason ? { at: ctx.now(), reason } : { at: ctx.now() };
  return ok(withNode(g, { ...node, notes: node.notes.map(n => (n.id === note.id ? { ...n, struck } : n)) }));
}
