import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QUICK_SYSTEM, sideSystem, TEACHING_RULES, tutorSystem, withHistory } from "../../src/chat/prompts.js";
import { merge } from "../../src/core/index.js";
import { jsonChatStore } from "../../src/persistence/index.js";
import { chain, unwrap } from "../core/helpers.js";

describe("chat prompts", () => {
  it("tell Claude the session, its scope and the chain of goals above it", () => {
    const { g, b } = chain();
    const s = tutorSystem(g, b);
    expect(s).toContain("Session: b");
    expect(s).toContain(`Scope (what "done" looks like): ${g.nodes[b]!.scope}`);
    expect(s).toMatch(/- Cover letter for a backend role: .*\n {2}- a: .*\n {4}- b: /);
  });

  it("tell Claude to answer only what was asked, and to start big topics with a plain overview", () => {
    const { g, b } = chain();
    const s = tutorSystem(g, b);
    expect(s).toContain(TEACHING_RULES);
    expect(TEACHING_RULES).toMatch(/direct question gets a direct answer/);
    expect(TEACHING_RULES).toMatch(/at most one short follow-up/);
    expect(TEACHING_RULES).toMatch(/short overview of only the key ideas/);
    expect(sideSystem(g, b)).toMatch(/answer exactly what was asked/);
    expect(QUICK_SYSTEM).toContain(TEACHING_RULES);
  });

  it("keep an off-topic message that wasn't branched to a short answer", () => {
    const { g, b } = chain();
    expect(tutorSystem(g, b)).not.toContain("off-topic for this session");
    expect(tutorSystem(g, b, "Golden visas")).toMatch(/off-topic for this session \("Golden visas"\)[\s\S]*Don't refuse/);
  });

  it("mention when a session is already resolved", () => {
    const { g, ctx, b } = chain();
    const g2 = unwrap(merge(g, { nodeId: b, summary: "Go and Postgres." }, ctx));
    expect(tutorSystem(g2, b)).toContain(`This session is merged ("Go and Postgres.")`);
  });

  it("include a highlighted passage in side questions", () => {
    const { g, b } = chain();
    expect(sideSystem(g, b, "the spin flings you outward")).toContain('"""\nthe spin flings you outward\n"""');
    expect(sideSystem(g, b)).not.toContain('"""');
  });

  it("fold earlier messages into the first message of a new Claude session", () => {
    expect(withHistory([], "hi")).toBe("hi");
    const m = withHistory([{ role: "user", text: "Q1", at: "" }, { role: "assistant", text: "A1", at: "" }], "Q2");
    expect(m).toBe("Earlier in this session:\n\nLearner: Q1\n\nTutor: A1\n\nNew message from the learner:\nQ2");
  });
});

describe("json chat store", () => {
  it("saves and loads a node's log, and lists every log in a graph", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tg-chat-"));
    try {
      const store = jsonChatStore(dir);
      expect(await store.load("g1", "n1")).toEqual({ messages: [] });
      const log = { sessionId: "s1", messages: [{ role: "user" as const, text: "hi", at: "t" }] };
      await store.save("g1", "n1", log);
      expect(await store.load("g1", "n1")).toEqual(log);
      expect(await store.all("g1")).toEqual({ n1: log });
      expect(await store.all("other")).toEqual({});
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
