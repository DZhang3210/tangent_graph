import { describe, expect, it } from "vitest";
import {
  abandon, branchesOf, defer, findingsOf, fork, getNode, merge, type Ctx, type Graph,
} from "../../src/core/index.js";
import { branchInput, chain, expectError, newGraph, unwrap } from "./helpers.js";

type Resolver = (g: Graph, input: { nodeId: string; summary: string }, ctx: Ctx) => ReturnType<typeof merge>;
const resolvers: [string, Resolver, string][] = [
  ["merge", merge, "merged"],
  ["abandon", abandon, "abandoned"],
  ["defer", defer, "deferred"],
];

describe.each(resolvers)("%s", (kind, resolve, status) => {
  it("rejects an empty or whitespace-only summary", () => {
    const { g, ctx, b } = chain();
    for (const summary of ["", " ", "   ", "\n", "\t \n"]) {
      expect(expectError(resolve(g, { nodeId: b, summary }, ctx), "EMPTY_FIELD")).toMatchObject({ field: "summary" });
    }
  });

  it(`records the summary, sets status to ${status} and moves the cursor to the parent`, () => {
    const { g, ctx, a, b } = chain();
    const g2 = unwrap(resolve(g, { nodeId: b, summary: "  Useful result.  " }, ctx));
    const node = getNode(g2, b)!;
    expect(node.status).toBe(status);
    expect(node.resolution).toMatchObject({ kind, summary: "Useful result." });
    expect(node.resolution!.at).toEqual(expect.any(String));
    expect(g2.cursor).toBe(a);
  });

  it("refuses to resolve an already-resolved branch", () => {
    const { g, ctx, b } = chain();
    const g2 = unwrap(resolve(g, { nodeId: b, summary: "Done." }, ctx));
    expect(expectError(resolve(g2, { nodeId: b, summary: "Again." }, ctx), "ALREADY_RESOLVED")).toMatchObject({ nodeId: b, status });
  });

  it("refuses a node that isn't the cursor", () => {
    // The rules never leave an unlocked, active node off the cursor, so build that state by hand
    // to check the guard itself.
    const { g, ctx, b } = chain();
    const moved: Graph = { ...g, cursor: g.rootId };
    expect(expectError(resolve(moved, { nodeId: b, summary: "x" }, ctx), "NOT_AT_CURSOR")).toMatchObject({ nodeId: b, cursor: g.rootId });
  });
});

describe("the root", () => {
  it("can't be merged or deferred", () => {
    const { g, ctx, root } = newGraph();
    expectError(merge(g, { nodeId: root, summary: "x" }, ctx), "ROOT_CANT_RESOLVE");
    expectError(defer(g, { nodeId: root, summary: "x" }, ctx), "ROOT_CANT_RESOLVE");
  });
});

describe("what the parent sees", () => {
  it("lists merged branches as findings and every resolved branch with its summary", () => {
    const { g, ctx, root } = newGraph();
    let x = g;
    const take = (title: string, how: Resolver, summary: string) => {
      x = unwrap(fork(x, { from: root, ...branchInput(title) }, ctx));
      x = unwrap(how(x, { nodeId: x.cursor, summary }, ctx));
    };
    take("tools", merge, "Go and Postgres; open with the billing project.");
    take("history", abandon, "Company history doesn't change the letter.");
    take("salary", defer, "Need recruiter call first.");

    expect(findingsOf(x, root).map(f => f.summary)).toEqual(["Go and Postgres; open with the billing project."]);
    expect(branchesOf(x, root, "abandoned").map(n => n.resolution!.summary)).toEqual(["Company history doesn't change the letter."]);
    expect(branchesOf(x, root, "deferred").map(n => n.title)).toEqual(["salary"]);
    expect(branchesOf(x, root).map(n => n.title)).toEqual(["tools", "history", "salary"]);
  });
});
