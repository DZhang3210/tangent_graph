import { describe, expect, it } from "vitest";
import {
  abandon, addNote, complete, continueBranch, defer, fork, getNode, isLocked, merge, openBranchOf,
} from "../../src/core/index.js";
import { branchInput, chain, expectError, newGraph, unwrap } from "./helpers.js";

const summary = "Learned enough.";

describe("a parent can't be edited while a branch is unresolved", () => {
  it("marks a node with an open branch as locked", () => {
    const { g, root, a, b } = chain();
    expect(isLocked(g, root)).toBe(true);
    expect(isLocked(g, a)).toBe(true);
    expect(isLocked(g, b)).toBe(false);
    expect(openBranchOf(g, a)).toBe(b);
  });

  it("rejects every structural action on a locked node, naming the open branch", () => {
    const { g, ctx, a, b } = chain();
    const attempts = [
      fork(g, { from: a, ...branchInput("x") }, ctx),
      merge(g, { nodeId: a, summary }, ctx),
      abandon(g, { nodeId: a, summary }, ctx),
      defer(g, { nodeId: a, summary }, ctx),
      continueBranch(g, { from: a, source: b, scope: "s", justification: "j" }, ctx),
    ];
    for (const r of attempts) expect(expectError(r, "NODE_LOCKED")).toMatchObject({ nodeId: a, openBranchId: b });
  });

  it("rejects closing the main task while any branch is open", () => {
    const { g, ctx, root } = chain();
    expectError(complete(g, { nodeId: root, summary }, ctx), "NODE_LOCKED");
    expectError(abandon(g, { nodeId: root, summary }, ctx), "NODE_LOCKED");
  });

  it("still allows notes on a locked node", () => {
    const { g, ctx, root } = chain();
    const g2 = unwrap(addNote(g, { nodeId: root, text: "Idea for the opener." }, ctx));
    expect(getNode(g2, root)!.notes).toHaveLength(1);
  });

  it("unlocks the parent once the branch is resolved", () => {
    const { g, ctx, a, b } = chain();
    const g2 = unwrap(merge(g, { nodeId: b, summary }, ctx));
    expect(isLocked(g2, a)).toBe(false);
    expect(openBranchOf(g2, a)).toBeUndefined();
  });

  it("allows only one open branch per node", () => {
    const { g, ctx, root } = newGraph();
    const g2 = unwrap(fork(g, { from: root, ...branchInput("first") }, ctx));
    // The root now has an open branch, so a second fork from it is refused.
    expectError(fork(g2, { from: root, ...branchInput("second") }, ctx), "NODE_LOCKED");
  });
});

describe("you can't navigate past an unresolved branch", () => {
  it("can't resolve a node while it has an open branch", () => {
    const { g, ctx, a } = chain();
    expectError(merge(g, { nodeId: a, summary }, ctx), "NODE_LOCKED");
  });

  it("resolving moves the cursor up exactly one level", () => {
    const { g, ctx, a, b } = chain();
    expect(g.cursor).toBe(b);
    const g2 = unwrap(merge(g, { nodeId: b, summary }, ctx));
    expect(g2.cursor).toBe(a);
  });

  it("getting from a deep branch back to the root means resolving every level in between", () => {
    const { g, ctx, root, a, b } = chain();
    const g2 = unwrap(defer(g, { nodeId: b, summary: "Out of time; stopped at step 2." }, ctx));
    expect(g2.cursor).toBe(a);
    const g3 = unwrap(abandon(g2, { nodeId: a, summary: "Went too deep for a cover letter." }, ctx));
    expect(g3.cursor).toBe(root);
  });

  it("structural actions only apply to the cursor", () => {
    const { g, ctx, root } = newGraph();
    const g2 = unwrap(fork(g, { from: root, ...branchInput("a") }, ctx));
    const a = g2.cursor;
    const g3 = unwrap(merge(g2, { nodeId: a, summary }, ctx));
    const g4 = unwrap(fork(g3, { from: root, ...branchInput("b") }, ctx));
    // a is resolved; b is the cursor. Acting on the root (locked) or a (resolved) is refused.
    expectError(merge(g4, { nodeId: a, summary }, ctx), "ALREADY_RESOLVED");
    expectError(complete(g4, { nodeId: root, summary }, ctx), "NODE_LOCKED");
  });
});
