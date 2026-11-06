import { expect } from "vitest";
import {
  createGraph, fork,
  type Ctx, type DomainError, type DomainErrorCode, type Graph, type NodeId, type Result,
} from "../../src/core/index.js";

/** Deterministic ids ("id1", "id2", …) and timestamps one minute apart. */
export function makeCtx(): Ctx {
  let n = 0, t = Date.parse("2026-11-01T09:00:00Z");
  return {
    newId: () => `id${++n}`,
    now: () => new Date((t += 60_000)).toISOString(),
  };
}

export function unwrap<T>(r: Result<T, DomainError>): T {
  if (!r.ok) throw new Error(`Expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

export function expectError<T>(r: Result<T, DomainError>, code: DomainErrorCode): DomainError {
  expect(r.ok, `expected ${code}, got ok`).toBe(false);
  if (r.ok) throw new Error("unreachable");
  expect(r.error.code).toBe(code);
  return r.error;
}

export const rootInput = {
  title: "Cover letter for a backend role",
  scope: "A one-page cover letter for this role, sent by Friday.",
  motivation: "Applications close Friday, and this is the job I want most.",
};

export const branchInput = (title = "Which tools does their backend team use?") => ({
  title,
  scope: "Find 2-3 tools from their job posts, and note which ones I've used.",
  justification: "If I've used their tools I open with that project; if not, I lead with how fast I learn.",
});

/** A fresh graph with just the root. */
export function newGraph(ctx = makeCtx()): { g: Graph; ctx: Ctx; root: NodeId } {
  const g = unwrap(createGraph(rootInput, ctx));
  return { g, ctx, root: g.rootId };
}

/** root → a → b, cursor on b. */
export function chain(ctx = makeCtx()) {
  const { g: g0, root } = newGraph(ctx);
  const g1 = unwrap(fork(g0, { from: root, ...branchInput("a") }, ctx));
  const a = g1.cursor;
  const g2 = unwrap(fork(g1, { from: a, ...branchInput("b") }, ctx));
  const b = g2.cursor;
  return { g: g2, ctx, root, a, b };
}
