import { describe, expect, it } from "vitest";
import {
  abandon, addNote, complete, continueBranch, defer, fork, getNode, isClosed, merge, strikeNote, undoBranch,
} from "../../src/core/index.js";
import { branchInput, chain, expectError, newGraph, unwrap } from "./helpers.js";

describe("notes", () => {
  it("adds a trimmed, timestamped note", () => {
    const { g, ctx, root } = newGraph();
    const g2 = unwrap(addNote(g, { nodeId: root, text: "  Open with the moon question.  " }, ctx));
    const [note] = getNode(g2, root)!.notes;
    expect(note).toMatchObject({ text: "Open with the moon question." });
    expect(note!.createdAt).toEqual(expect.any(String));
    expect(note!.struck).toBeUndefined();
  });

  it("rejects an empty or whitespace-only note", () => {
    const { g, ctx, root } = newGraph();
    for (const text of ["", "  ", "\n"]) {
      expect(expectError(addNote(g, { nodeId: root, text }, ctx), "EMPTY_FIELD")).toMatchObject({ field: "text" });
    }
  });

  it("can be added to any node: locked, resolved, or in a closed graph", () => {
    const { g, ctx, root, a, b } = chain();
    unwrap(addNote(g, { nodeId: a, text: "locked" }, ctx));
    const g2 = unwrap(merge(g, { nodeId: b, summary: "done" }, ctx));
    unwrap(addNote(g2, { nodeId: b, text: "resolved" }, ctx));
    const g3 = unwrap(merge(g2, { nodeId: a, summary: "done" }, ctx));
    const closed = unwrap(complete(g3, { nodeId: root, summary: "Sent it." }, ctx));
    unwrap(addNote(closed, { nodeId: root, text: "closed" }, ctx));
  });

  it("rejects an unknown node", () => {
    const { g, ctx } = newGraph();
    expectError(addNote(g, { nodeId: "nope", text: "x" }, ctx), "NODE_NOT_FOUND");
  });

  it("can be struck out, stays visible, and can't be struck twice", () => {
    const { g, ctx, root } = newGraph();
    const g2 = unwrap(addNote(g, { nodeId: root, text: "Air resistance is the only difference." }, ctx));
    const noteId = getNode(g2, root)!.notes[0]!.id;
    const g3 = unwrap(strikeNote(g2, { nodeId: root, noteId, reason: "Too vague." }, ctx));
    const [note] = getNode(g3, root)!.notes;
    expect(note!.text).toBe("Air resistance is the only difference.");
    expect(note!.struck).toMatchObject({ reason: "Too vague." });
    expectError(strikeNote(g3, { nodeId: root, noteId }, ctx), "NOTE_ALREADY_STRUCK");
  });

  it("strike reason is optional, and blank reasons are dropped", () => {
    const { g, ctx, root } = newGraph();
    const g2 = unwrap(addNote(g, { nodeId: root, text: "x" }, ctx));
    const noteId = getNode(g2, root)!.notes[0]!.id;
    const g3 = unwrap(strikeNote(g2, { nodeId: root, noteId, reason: "   " }, ctx));
    expect(getNode(g3, root)!.notes[0]!.struck).not.toHaveProperty("reason");
  });

  it("rejects striking a note that doesn't exist", () => {
    const { g, ctx, root } = newGraph();
    expectError(strikeNote(g, { nodeId: root, noteId: "nope" }, ctx), "NOTE_NOT_FOUND");
  });
});

describe("continuing a resolved branch", () => {
  const again = { scope: "Finish the apple-to-moon step.", justification: "The opener needs the missing step." };

  it("creates a new linked branch, numbered #2, and moves the cursor into it", () => {
    const { g, ctx, a, b } = chain();
    const g2 = unwrap(defer(g, { nodeId: b, summary: "Stopped at step 2." }, ctx));
    const g3 = unwrap(continueBranch(g2, { from: a, source: b, ...again }, ctx));
    const next = getNode(g3, g3.cursor)!;
    expect(next).toMatchObject({ parentId: a, status: "active", title: "b", continuesFrom: b, seq: 2, ...again });
    expect(getNode(g3, b)!.status).toBe("deferred"); // the source never changes
  });

  it("keeps counting when continuing a continuation", () => {
    const { g, ctx, a, b } = chain();
    let x = unwrap(merge(g, { nodeId: b, summary: "done" }, ctx));
    x = unwrap(continueBranch(x, { from: a, source: b, ...again }, ctx));
    const b2 = x.cursor;
    x = unwrap(merge(x, { nodeId: b2, summary: "done" }, ctx));
    x = unwrap(continueBranch(x, { from: a, source: b2, ...again, title: "b, final pass" }, ctx));
    expect(getNode(x, x.cursor)).toMatchObject({ seq: 3, continuesFrom: b2, title: "b, final pass" });
  });

  it("works for merged, abandoned and deferred branches", () => {
    for (const resolve of [merge, abandon, defer]) {
      const { g, ctx, a, b } = chain();
      const g2 = unwrap(resolve(g, { nodeId: b, summary: "done" }, ctx));
      unwrap(continueBranch(g2, { from: a, source: b, ...again }, ctx));
    }
  });

  it("requires its own scope and justification", () => {
    const { g, ctx, a, b } = chain();
    const g2 = unwrap(merge(g, { nodeId: b, summary: "done" }, ctx));
    expect(expectError(continueBranch(g2, { from: a, source: b, ...again, scope: " " }, ctx), "EMPTY_FIELD")).toMatchObject({ field: "scope" });
    expect(expectError(continueBranch(g2, { from: a, source: b, ...again, justification: "" }, ctx), "EMPTY_FIELD")).toMatchObject({ field: "justification" });
  });

  it("refuses an active branch, the root, or a branch that isn't a child of the cursor", () => {
    const { g, ctx, root, a, b } = chain();
    // still active (b is the cursor itself, and a's open branch)
    expect(expectError(continueBranch(g, { from: b, source: b, ...again }, ctx), "NOT_CONTINUABLE")).toMatchObject({ reason: { why: "still-active" } });
    const g2 = unwrap(merge(g, { nodeId: b, summary: "done" }, ctx));
    const g3 = unwrap(merge(g2, { nodeId: a, summary: "done" }, ctx));
    // b is a grandchild of the root now
    expect(expectError(continueBranch(g3, { from: root, source: b, ...again }, ctx), "NOT_CONTINUABLE")).toMatchObject({ reason: { why: "not-a-child-of-cursor" } });
    expect(expectError(continueBranch(g3, { from: root, source: root, ...again }, ctx), "NOT_CONTINUABLE")).toMatchObject({ reason: { why: "is-root" } });
    expectError(continueBranch(g3, { from: root, source: "nope", ...again }, ctx), "NODE_NOT_FOUND");
  });
});

describe("closing the main task", () => {
  it("completes the root with a summary and closes the graph", () => {
    const { g, ctx, root } = newGraph();
    const g2 = unwrap(complete(g, { nodeId: root, summary: "Sent the letter Thursday." }, ctx));
    expect(getNode(g2, root)).toMatchObject({ status: "completed", resolution: { kind: "complete", summary: "Sent the letter Thursday." } });
    expect(isClosed(g2)).toBe(true);
  });

  it("can abandon the root instead", () => {
    const { g, ctx, root } = newGraph();
    const g2 = unwrap(abandon(g, { nodeId: root, summary: "Role was filled." }, ctx));
    expect(getNode(g2, root)!.status).toBe("abandoned");
    expect(isClosed(g2)).toBe(true);
  });

  it("requires a non-empty summary", () => {
    const { g, ctx, root } = newGraph();
    expectError(complete(g, { nodeId: root, summary: "  " }, ctx), "EMPTY_FIELD");
    expectError(abandon(g, { nodeId: root, summary: "" }, ctx), "EMPTY_FIELD");
  });

  it("only applies to the root", () => {
    const { g, ctx, b } = chain();
    expectError(complete(g, { nodeId: b, summary: "x" }, ctx), "NOT_ROOT");
  });

  it("makes every structural action fail with GRAPH_CLOSED, but notes still work", () => {
    const { g, ctx, root } = newGraph();
    const closed = unwrap(complete(g, { nodeId: root, summary: "Done." }, ctx));
    expectError(fork(closed, { from: root, ...branchInput() }, ctx), "GRAPH_CLOSED");
    expectError(complete(closed, { nodeId: root, summary: "Again." }, ctx), "GRAPH_CLOSED");
    expectError(abandon(closed, { nodeId: root, summary: "Again." }, ctx), "GRAPH_CLOSED");
    unwrap(addNote(closed, { nodeId: root, text: "Got the interview." }, ctx));
  });
});

describe("error precedence", () => {
  it("reports GRAPH_CLOSED before anything else", () => {
    const { g, ctx, root } = newGraph();
    const closed = unwrap(complete(g, { nodeId: root, summary: "Done." }, ctx));
    expectError(fork(closed, { from: "nope", ...branchInput(), scope: "" }, ctx), "GRAPH_CLOSED");
  });

  it("reports a lock before an empty field", () => {
    const { g, ctx, a } = chain();
    expectError(merge(g, { nodeId: a, summary: "" }, ctx), "NODE_LOCKED");
  });
});

describe("undo", () => {
  it("removes an empty branch and moves the cursor back to its parent", () => {
    const { g, ctx, a, b } = chain();
    const g2 = unwrap(undoBranch(g, { nodeId: b }, ctx));
    expect(g2.nodes[b]).toBeUndefined();
    expect(g2.cursor).toBe(a);
    expect(g.nodes[b]).toBeDefined(); // input untouched
    unwrap(fork(g2, { from: a, ...branchInput("c") }, ctx)); // the parent is unlocked
  });

  it("only applies to the cursor", () => {
    const { g, ctx, a } = chain();
    expectError(undoBranch(g, { nodeId: a }, ctx), "NODE_LOCKED");
    expectError(undoBranch(g, { nodeId: "nope" }, ctx), "NODE_NOT_FOUND");
  });

  it("refuses the root, and a branch with notes or resolved branches", () => {
    const fresh = newGraph();
    expect(expectError(undoBranch(fresh.g, { nodeId: fresh.root }, fresh.ctx), "NOT_UNDOABLE"))
      .toMatchObject({ reason: "is-root" });
    const { g, ctx, a, b } = chain();
    const noted = unwrap(addNote(g, { nodeId: b, text: "keep this" }, ctx));
    expect(expectError(undoBranch(noted, { nodeId: b }, ctx), "NOT_UNDOABLE")).toMatchObject({ reason: "has-notes" });
    const merged = unwrap(merge(g, { nodeId: b, summary: "done" }, ctx));
    expect(expectError(undoBranch(merged, { nodeId: a }, ctx), "NOT_UNDOABLE")).toMatchObject({ reason: "has-branches" });
  });

  it("refuses a resolved branch or a closed graph", () => {
    const { g, ctx, root } = newGraph();
    const g1 = unwrap(fork(g, { from: root, ...branchInput() }, ctx));
    const b = g1.cursor;
    const g2 = unwrap(merge(g1, { nodeId: b, summary: "done" }, ctx));
    expectError(undoBranch(g2, { nodeId: b }, ctx), "ALREADY_RESOLVED");
    const closed = unwrap(complete(g2, { nodeId: root, summary: "Sent." }, ctx));
    expectError(undoBranch(closed, { nodeId: b }, ctx), "GRAPH_CLOSED");
  });
});
