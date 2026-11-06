import { describe, expect, it, vi } from "vitest";
import { createClaudeJudge, type Ask } from "../../src/judge/index.js";

const review = {
  parentTitle: "Cover letter", parentGoal: "One page, sent Friday.",
  title: "Their tools", scope: "2-3 tools.", justification: "Changes my opening paragraph.",
};

describe("Claude judge", () => {
  it("sends the full context and maps an approval", async () => {
    const ask = vi.fn(async () => ({ ok: true, feedback: "Clear link." })) as unknown as Ask;
    const v = await createClaudeJudge(ask).reviewJustification(review);
    expect(v).toEqual({ ok: true, feedback: "Clear link." });
    const req = (ask as any).mock.calls[0][0];
    expect(req.prompt).toContain("Parent goal: One page, sent Friday.");
    expect(req.prompt).toContain("Justification: Changes my opening paragraph.");
    expect(req.schema.required).toEqual(["ok", "feedback"]);
  });

  it("maps a rejection, with a fallback message if feedback is blank", async () => {
    const ask = (async () => ({ ok: false, feedback: "" })) as unknown as Ask;
    expect(await createClaudeJudge(ask).reviewSummary({ kind: "merge", title: "t", scope: "s", summary: "done" }))
      .toEqual({ ok: false, feedback: "Not specific enough." });
  });

  it("says which action a summary is for", async () => {
    const ask = vi.fn(async () => ({ ok: true, feedback: "" })) as unknown as Ask;
    await createClaudeJudge(ask).reviewSummary({ kind: "defer", title: "t", scope: "s", summary: "Stopped at step 2." });
    expect((ask as any).mock.calls[0][0].prompt).toContain("Action: defer");
  });

  it("asks with the currently chosen model", async () => {
    const ask = vi.fn(async () => ({ ok: true, feedback: "" })) as unknown as Ask;
    let model: "auto" | "claude-haiku-5-5" = "auto";
    const judge = createClaudeJudge(ask, () => model);
    await judge.reviewJustification(review);
    model = "claude-haiku-5-5";
    await judge.reviewJustification(review);
    expect((ask as any).mock.calls.map((c: any[]) => c[0].model)).toEqual(["auto", "claude-haiku-5-5"]);
  });

  it("lets a failed Claude call surface as an error, not a verdict", async () => {
    const ask = (async () => { throw new Error("not signed in"); }) as unknown as Ask;
    await expect(createClaudeJudge(ask).reviewJustification(review)).rejects.toThrow("not signed in");
  });
});
