import { describe, expect, it } from "vitest";
import { createGraph, fork, getNode } from "../../src/core/index.js";
import { branchInput, expectError, makeCtx, newGraph, rootInput, unwrap } from "./helpers.js";

describe("creating a main task", () => {
  it("creates a graph with an active root and the cursor on it", () => {
    const g = unwrap(createGraph(rootInput, makeCtx()));
    const root = getNode(g, g.rootId)!;
    expect(root.parentId).toBeNull();
    expect(root.status).toBe("active");
    expect(g.cursor).toBe(g.rootId);
    expect(root).toMatchObject(rootInput);
  });

  it.each(["title", "scope", "motivation"] as const)("requires a non-empty %s", field => {
    for (const blank of ["", "   ", "\n\t "]) {
      const e = expectError(createGraph({ ...rootInput, [field]: blank }, makeCtx()), "EMPTY_FIELD");
      expect(e).toMatchObject({ field });
    }
  });

  it("stores text trimmed", () => {
    const g = unwrap(createGraph({ ...rootInput, title: "  Padded  " }, makeCtx()));
    expect(getNode(g, g.rootId)!.title).toBe("Padded");
  });
});

describe("forking", () => {
  it("creates an active branch under the cursor and moves the cursor into it", () => {
    const { g, ctx, root } = newGraph();
    const g2 = unwrap(fork(g, { from: root, ...branchInput() }, ctx));
    const branch = getNode(g2, g2.cursor)!;
    expect(branch.parentId).toBe(root);
    expect(branch.status).toBe("active");
    expect(branch).toMatchObject(branchInput());
  });

  it("requires a scope", () => {
    const { g, ctx, root } = newGraph();
    for (const scope of ["", "  ", "\n"]) {
      expect(expectError(fork(g, { from: root, ...branchInput(), scope }, ctx), "EMPTY_FIELD")).toMatchObject({ field: "scope" });
    }
  });

  it("requires a justification", () => {
    const { g, ctx, root } = newGraph();
    for (const justification of ["", "  ", "\t"]) {
      expect(expectError(fork(g, { from: root, ...branchInput(), justification }, ctx), "EMPTY_FIELD"))
        .toMatchObject({ field: "justification" });
    }
  });

  it("requires a title", () => {
    const { g, ctx, root } = newGraph();
    expect(expectError(fork(g, { from: root, ...branchInput(), title: " " }, ctx), "EMPTY_FIELD")).toMatchObject({ field: "title" });
  });

  it("only works from the cursor", () => {
    const { g, ctx, root } = newGraph();
    const g2 = unwrap(fork(g, { from: root, ...branchInput("a") }, ctx));
    const a = g2.cursor;
    const g3 = unwrap(fork(g2, { from: a, ...branchInput("b") }, ctx));
    // Cursor is on b; a is locked by b, so that's the reported reason.
    expectError(fork(g3, { from: a, ...branchInput("c") }, ctx), "NODE_LOCKED");
  });

  it("rejects an unknown node", () => {
    const { g, ctx } = newGraph();
    expectError(fork(g, { from: "nope", ...branchInput() }, ctx), "NODE_NOT_FOUND");
  });

  it("doesn't change the graph it was given", () => {
    const { g, ctx, root } = newGraph();
    const before = structuredClone(g);
    unwrap(fork(g, { from: root, ...branchInput() }, ctx));
    expect(g).toEqual(before);
  });

  it("leaves the graph unchanged when it fails", () => {
    const { g, ctx, root } = newGraph();
    const before = structuredClone(g);
    expectError(fork(g, { from: root, ...branchInput(), justification: "" }, ctx), "EMPTY_FIELD");
    expect(g).toEqual(before);
  });
});
