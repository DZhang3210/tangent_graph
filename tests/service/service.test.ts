import { describe, expect, it, vi } from "vitest";
import type { Graph } from "../../src/core/index.js";
import { stubJudge, type Judge } from "../../src/judge/index.js";
import { memoryStore } from "../../src/persistence/index.js";
import { createService, type ServiceError } from "../../src/service/index.js";
import { branchInput, makeCtx, rootInput } from "../core/helpers.js";

function setup(judge: Judge = stubJudge) {
  const store = memoryStore();
  const spy = {
    reviewJustification: vi.fn(judge.reviewJustification),
    reviewSummary: vi.fn(judge.reviewSummary),
    spotTangent: vi.fn(judge.spotTangent),
  };
  return { store, judge: spy, svc: createService({ store, judge: spy, ctx: makeCtx() }) };
}

const rejecting: Judge = {
  reviewJustification: async () => ({ ok: false, feedback: "That's curiosity, not a reason." }),
  reviewSummary: async () => ({ ok: false, feedback: "Say what you actually learned." }),
  spotTangent: async () => null,
};

function val<T>(r: { ok: true; value: T } | { ok: false; error: ServiceError }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

describe("service", () => {
  it("starts a main task, saves it, and makes it active", async () => {
    const { svc, store } = setup();
    const g = val(await svc.startTask(rootInput));
    expect(await store.getActive()).toBe(g.id);
    expect(val(await svc.current()).id).toBe(g.id);
  });

  it("reports when there's no active main task", async () => {
    const { svc } = setup();
    expect(await svc.current()).toMatchObject({ ok: false, error: { kind: "no-active-task" } });
  });

  it("forks from the cursor after the judge approves, and saves", async () => {
    const { svc, judge, store } = setup();
    val(await svc.startTask(rootInput));
    const savesBefore = store.saves;
    const g = val(await svc.fork(branchInput()));
    expect(g.nodes[g.cursor]).toMatchObject({ status: "active", ...branchInput() });
    expect(judge.reviewJustification).toHaveBeenCalledWith(expect.objectContaining({
      parentGoal: rootInput.scope, justification: branchInput().justification,
    }));
    expect(store.saves).toBe(savesBefore + 1);
  });

  it("doesn't save anything when the judge rejects, and passes on its feedback", async () => {
    const { svc, store } = setup(rejecting);
    const start = val(await svc.startTask(rootInput));
    const savesBefore = store.saves;
    const r = await svc.fork(branchInput());
    expect(r).toMatchObject({ ok: false, error: { kind: "rejected", feedback: "That's curiosity, not a reason." } });
    expect(store.saves).toBe(savesBefore);
    expect(val(await svc.current())).toEqual(start);
  });

  it("blocks the change when the judge can't be reached", async () => {
    const down: Judge = { ...stubJudge, reviewJustification: async () => { throw new Error("not signed in"); } };
    const { svc, store } = setup(down);
    val(await svc.startTask(rootInput));
    const savesBefore = store.saves;
    expect(await svc.fork(branchInput())).toMatchObject({ ok: false, error: { kind: "judge-unavailable", message: "not signed in" } });
    expect(store.saves).toBe(savesBefore);
  });

  it("checks local rules before asking the judge", async () => {
    const { svc, judge } = setup();
    val(await svc.startTask(rootInput));
    const r = await svc.fork({ ...branchInput(), justification: "   " });
    expect(r).toMatchObject({ ok: false, error: { kind: "domain", error: { code: "EMPTY_FIELD", field: "justification" } } });
    expect(judge.reviewJustification).not.toHaveBeenCalled();
  });

  it("asks the judge about merge summaries and blocks on rejection", async () => {
    const ok = setup();
    val(await ok.svc.startTask(rootInput));
    val(await ok.svc.fork(branchInput()));
    const g = val(await ok.svc.merge("Go and Postgres; open with billing."));
    expect(g.cursor).toBe(g.rootId);
    expect(ok.judge.reviewSummary).toHaveBeenCalledWith(expect.objectContaining({ kind: "merge", summary: "Go and Postgres; open with billing." }));

    const no = setup({ ...stubJudge, reviewSummary: rejecting.reviewSummary });
    val(await no.svc.startTask(rootInput));
    const forked = val(await no.svc.fork(branchInput()));
    expect(await no.svc.merge("stuff")).toMatchObject({ ok: false, error: { kind: "rejected" } });
    expect(val(await no.svc.current())).toEqual(forked);
  });

  it("never calls the judge for notes", async () => {
    const { svc, judge } = setup(rejecting);
    val(await svc.startTask(rootInput));
    const g = val(await svc.note("Open with the moon question."));
    expect(g.nodes[g.rootId]!.notes).toHaveLength(1);
    expect(judge.reviewJustification).not.toHaveBeenCalled();
    expect(judge.reviewSummary).not.toHaveBeenCalled();
  });

  it("strikes a note by id without needing the node", async () => {
    const { svc } = setup();
    val(await svc.startTask(rootInput));
    const g = val(await svc.note("Too vague."));
    const noteId = g.nodes[g.rootId]!.notes[0]!.id;
    const g2 = val(await svc.strike(noteId, "Replaced."));
    expect(g2.nodes[g2.rootId]!.notes[0]!.struck).toMatchObject({ reason: "Replaced." });
  });

  it("switches between main tasks", async () => {
    const { svc } = setup();
    const a = val(await svc.startTask(rootInput));
    const b = val(await svc.startTask({ ...rootInput, title: "SQL joins" }));
    expect(val(await svc.current()).id).toBe(b.id);
    val(await svc.switchTask(a.id));
    expect(val(await svc.current()).id).toBe(a.id);
    expect((await svc.listTasks()).map(t => t.title).sort()).toEqual(["Cover letter for a backend role", "SQL joins"]);
    expect(await svc.switchTask("nope")).toMatchObject({ ok: false, error: { kind: "store", error: { code: "NOT_FOUND" } } });
  });

  it("closes the main task when abandoning at the root", async () => {
    const { svc } = setup();
    val(await svc.startTask(rootInput));
    const g: Graph = val(await svc.abandon("Role was filled."));
    expect(g.nodes[g.rootId]!.status).toBe("abandoned");
  });
});

describe("spotting tangents in chat", () => {
  const draft = { title: "Lisbon tram passes", scope: "Pick a pass.", justification: "Changes my daily budget." };
  const recent = [{ role: "user" as const, text: "Day 1?" }, { role: "assistant" as const, text: "Alfama." }];

  it("forks the drafted branch through the justification check", async () => {
    const { svc, judge } = setup({ ...stubJudge, spotTangent: async () => draft });
    const g0 = val(await svc.startTask(rootInput));
    const out = await svc.branchIfTangent("Which tram pass should I get?", recent);
    expect(out.branched).toBe(true);
    if (!out.branched) return;
    expect(out.graph.nodes[out.graph.cursor]).toMatchObject({ ...draft, parentId: g0.rootId });
    expect(judge.spotTangent).toHaveBeenCalledWith(expect.objectContaining({
      title: rootInput.title, scope: rootInput.scope, why: rootInput.motivation, above: [], recent, message: "Which tram pass should I get?",
    }));
    expect(judge.reviewJustification).toHaveBeenCalledOnce();
    expect(val(await svc.current()).cursor).toBe(out.graph.cursor);
  });

  it("passes the sessions above the cursor", async () => {
    const { svc, judge } = setup();
    await svc.startTask(rootInput);
    await svc.fork(branchInput("a"));
    await svc.branchIfTangent("q", []);
    expect(judge.spotTangent.mock.calls[0]![0]).toMatchObject({ title: "a", above: [`${rootInput.title}: ${rootInput.scope}`] });
  });

  it("doesn't branch when it isn't a tangent, or the spotter fails", async () => {
    const { svc } = setup();
    const g0 = val(await svc.startTask(rootInput));
    expect(await svc.branchIfTangent("q", [])).toEqual({ branched: false });
    const down = setup({ ...stubJudge, spotTangent: async () => { throw new Error("not signed in"); } });
    await down.svc.startTask(rootInput);
    expect(await down.svc.branchIfTangent("q", [])).toEqual({ branched: false });
    expect(val(await svc.current())).toEqual(g0);
  });

  it("explains, and changes nothing, when the judge rejects the draft", async () => {
    const { svc } = setup({ ...rejecting, spotTangent: async () => draft });
    const g0 = val(await svc.startTask(rootInput));
    const out = await svc.branchIfTangent("q", []);
    expect(out).toEqual({ branched: false, rejected: { title: draft.title, feedback: "That's curiosity, not a reason." } });
    expect(val(await svc.current())).toEqual(g0);
  });

  it("never asks in a closed graph", async () => {
    const { svc, judge } = setup();
    await svc.startTask(rootInput);
    await svc.complete("Sent it.");
    expect(await svc.branchIfTangent("q", [])).toEqual({ branched: false });
    expect(judge.spotTangent).not.toHaveBeenCalled();
  });
});

describe("undo", () => {
  it("removes the empty branch at the cursor and saves", async () => {
    const { svc } = setup();
    const g0 = val(await svc.startTask(rootInput));
    val(await svc.fork(branchInput()));
    const g = val(await svc.undo());
    expect(g.cursor).toBe(g0.rootId);
    expect(val(await svc.current())).toEqual(g);
    expect(await svc.undo()).toMatchObject({ ok: false, error: { kind: "domain", error: { code: "NOT_UNDOABLE" } } });
  });
});
