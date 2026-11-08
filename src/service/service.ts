// Wires core, judge and store together. Every change follows the same steps:
//   load the active graph → apply the pure core operation (all local rules)
//   → if it needs judgment, ask the judge → save → return the new graph.
// Local rules run first, so the judge only sees input that is already valid,
// and a rejection leaves the saved graph untouched.

import {
  abandon, addNote, complete, continueBranch, createGraph, defer, err, fork, merge, strikeNote, undoBranch,
  describeError, isClosed, pathTo,
  type ContinueInput, type CreateGraphInput, type Ctx, type DomainError, type ForkInput, type Graph,
  type GraphId, type NodeId, type NoteId, type Result,
} from "../core/index.js";
import type { Judge, TangentCheck, Verdict } from "../judge/index.js";
import { describeStoreError, type GraphStore, type GraphSummary, type StoreError } from "../persistence/index.js";

export type ServiceError =
  | { readonly kind: "domain"; readonly error: DomainError }
  | { readonly kind: "store"; readonly error: StoreError }
  | { readonly kind: "rejected"; readonly feedback: string }
  | { readonly kind: "judge-unavailable"; readonly message: string }
  | { readonly kind: "no-active-task" };

export function describeServiceError(e: ServiceError): string {
  switch (e.kind) {
    case "domain": return describeError(e.error);
    case "store": return describeStoreError(e.error);
    case "rejected": return `Not accepted: ${e.feedback}`;
    case "judge-unavailable": return `Couldn't check this with Claude, so nothing was changed: ${e.message}`;
    case "no-active-task": return "There's no active main task. Start one with `init`.";
  }
}

type Out = Promise<Result<Graph, ServiceError>>;

/** What happened when a chat message was checked for a tangent. */
export type TangentOutcome =
  | { readonly branched: true; readonly graph: Graph }
  | { readonly branched: false; readonly feedback?: string };
type Review = (before: Graph, after: Graph) => Promise<Verdict>;

export interface Service {
  startTask(input: CreateGraphInput): Out;
  current(): Out;
  listTasks(): Promise<GraphSummary[]>;
  switchTask(id: GraphId): Out;
  fork(input: Omit<ForkInput, "from">): Out;
  continueBranch(input: Omit<ContinueInput, "from">): Out;
  merge(summary: string): Out;
  abandon(summary: string): Out;
  defer(summary: string): Out;
  complete(summary: string): Out;
  /** Adds a note to `nodeId`, or to the cursor if omitted. */
  note(text: string, nodeId?: NodeId): Out;
  /** Strikes a note anywhere in the graph by its id. */
  strike(noteId: NoteId, reason?: string): Out;
  /** Removes the empty branch at the cursor (SPEC rule 11). */
  undo(): Out;
  /**
   * Asks the judge whether a message sent at the cursor is a tangent, and if so forks it
   * (through the usual justification check). Never blocks: any failure means "answer here".
   */
  branchIfTangent(message: string, recent: TangentCheck["recent"]): Promise<TangentOutcome>;
}

export function createService(deps: { store: GraphStore; judge: Judge; ctx: Ctx }): Service {
  const { store, judge, ctx } = deps;

  async function current(): Out {
    const id = await store.getActive();
    if (!id) return err({ kind: "no-active-task" });
    const r = await store.load(id);
    return r.ok ? r : err({ kind: "store", error: r.error });
  }

  async function change(apply: (g: Graph) => Result<Graph, DomainError>, review?: Review): Out {
    const g = await current();
    if (!g.ok) return g;
    const next = apply(g.value);
    if (!next.ok) return err({ kind: "domain", error: next.error });
    if (review) {
      // A judge that can't answer blocks the change: never skip a check silently.
      let v: Verdict;
      try { v = await review(g.value, next.value); }
      catch (e) { return err({ kind: "judge-unavailable", message: (e as Error).message }); }
      if (!v.ok) return err({ kind: "rejected", feedback: v.feedback });
    }
    await store.save(next.value);
    return next;
  }

  // The new branch is the new cursor; its parent is the old cursor.
  const reviewNewBranch: Review = (before, after) => {
    const parent = before.nodes[before.cursor]!, branch = after.nodes[after.cursor]!;
    if (branch.parentId === null) throw new Error("expected a branch at the cursor");
    return judge.reviewJustification({
      parentTitle: parent.title, parentGoal: parent.scope,
      title: branch.title, scope: branch.scope, justification: branch.justification,
    });
  };

  // The node that was just resolved is the old cursor.
  const reviewSummary: Review = (before, after) => {
    const node = after.nodes[before.cursor]!;
    return judge.reviewSummary({ kind: node.resolution!.kind, title: node.title, scope: node.scope, summary: node.resolution!.summary });
  };

  const resolveWith = (op: typeof merge) => (summary: string) =>
    change(g => op(g, { nodeId: g.cursor, summary }, ctx), reviewSummary);

  const forkAtCursor: Service["fork"] = input => change(g => fork(g, { ...input, from: g.cursor }, ctx), reviewNewBranch);

  return {
    current,

    async startTask(input) {
      const g = createGraph(input, ctx);
      if (!g.ok) return err({ kind: "domain", error: g.error });
      await store.save(g.value);
      await store.setActive(g.value.id);
      return g;
    },

    listTasks: () => store.list(),

    async switchTask(id) {
      const r = await store.load(id);
      if (!r.ok) return err({ kind: "store", error: r.error });
      await store.setActive(id);
      return r;
    },

    fork: forkAtCursor,
    continueBranch: input => change(g => continueBranch(g, { ...input, from: g.cursor }, ctx), reviewNewBranch),
    merge: resolveWith(merge),
    abandon: resolveWith(abandon),
    defer: resolveWith(defer),
    complete: resolveWith(complete),

    note: (text, nodeId) => change(g => addNote(g, { nodeId: nodeId ?? g.cursor, text }, ctx)),

    undo: () => change(g => undoBranch(g, { nodeId: g.cursor }, ctx)),

    async branchIfTangent(message, recent) {
      const g = await current();
      if (!g.ok || isClosed(g.value)) return { branched: false };
      const path = pathTo(g.value, g.value.cursor), n = path.at(-1)!;
      let draft;
      try {
        draft = await judge.spotTangent({
          title: n.title, scope: n.scope, why: n.parentId === null ? n.motivation : n.justification,
          above: path.slice(0, -1).map(p => `${p.title}: ${p.scope}`), recent, message,
        });
      } catch { return { branched: false }; }
      if (!draft) return { branched: false };
      const r = await forkAtCursor(draft);
      if (r.ok) return { branched: true, graph: r.value };
      return { branched: false, feedback: `Looked like a tangent ("${draft.title}"), so it wasn't branched: ${describeServiceError(r.error)}` };
    },

    strike: (noteId, reason) => change(g => {
      const owner = Object.values(g.nodes).find(n => n.notes.some(x => x.id === noteId));
      return strikeNote(g, { nodeId: owner?.id ?? g.cursor, noteId, ...(reason !== undefined ? { reason } : {}) }, ctx);
    }),
  };
}
