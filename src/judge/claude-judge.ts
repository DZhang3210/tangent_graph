// A Judge backed by Claude Code in headless mode. Prompts live here; the Claude call is injected
// so tests can swap in a fake.

import { askJson } from "../claude/headless.js";
import type { ModelId } from "../claude/models.js";
import type { Judge, JustificationReview, SummaryReview, TangentCheck, TangentDraft, Verdict } from "./judge.js";

export type Ask = <T>(req: { system: string; prompt: string; schema: object; model?: ModelId }) => Promise<T>;

const VERDICT_SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" }, feedback: { type: "string" } },
  required: ["ok", "feedback"],
};

export const JUSTIFICATION_SYSTEM = `You review "tangents" in a learning tool that stops people from rabbit-holing.
A tangent is a side question the learner wants to branch into, away from a parent goal.
Approve only if the justification names a concrete change in what the learner will do for the
parent goal, depending on the answer. Curiosity, "it's interesting", or being on the same topic
is NOT enough. Also check that the scope says what "done" looks like.
Feedback: one or two short sentences, addressed to the learner as "you". If you reject, say what's missing.`;

export const SUMMARY_SYSTEM = `You review the summary a learner writes when ending a branch of their learning.
- merge: must say what was actually learned that's useful for the parent goal. Reject vague
  summaries like "learned a lot" or "done".
- abandon: must say why the tangent went too deep or off-purpose.
- defer: must say where the learner stopped and why.
- complete: must say what was achieved for the main task.
Be lenient with short summaries that are specific. Reject only empty-of-content ones.
Feedback: one short sentence, addressed to the learner as "you". If you reject, say what to add.`;

const TANGENT_SCHEMA = {
  type: "object",
  properties: { tangent: { type: "boolean" }, title: { type: "string" }, scope: { type: "string" }, justification: { type: "string" } },
  required: ["tangent", "title", "scope", "justification"],
};

export const TANGENT_SYSTEM = `You watch a learner's chat in a learning tool that stops people from rabbit-holing.
Each session has one purpose, its scope. Learners are bad at noticing when they drift, so that's your job.
Decide if the learner's NEW message is a tangent: a question OUTSIDE this session's scope that needs
more than a quick answer.

Not tangents: anything that serves the scope (new subtopics included), follow-ups and clarifications
of what the tutor just said, quick facts that take a sentence to answer, instructions or chit-chat.
When unsure, it's not a tangent.

If it is one, draft a branch, written for the learner:
- title: the question in a few words (at most 8), in the learner's terms.
- scope: what "done" looks like for the branch. Small and concrete.
- justification: how the answer changes what the learner does for THIS session's goal. Be concrete
  and honest; if the only link is curiosity, say so plainly.
If it isn't one: tangent false and empty strings.`;

const clip = (t: string) => (t.length > 600 ? t.slice(0, 600) + "…" : t);

const toVerdict = (v: { ok: boolean; feedback: string }): Verdict =>
  v.ok ? { ok: true, feedback: v.feedback } : { ok: false, feedback: v.feedback || "Not specific enough." };

/** `model` is read on every check, so changing the setting applies right away. */
export function createClaudeJudge(ask: Ask = askJson, model: () => Promise<ModelId> | ModelId = () => "auto"): Judge {
  return {
    async reviewJustification(r: JustificationReview) {
      const prompt = [
        `Parent: ${r.parentTitle}`,
        `Parent goal: ${r.parentGoal}`,
        `Tangent: ${r.title}`,
        `Scope: ${r.scope}`,
        `Justification: ${r.justification}`,
      ].join("\n");
      return toVerdict(await ask({ system: JUSTIFICATION_SYSTEM, prompt, schema: VERDICT_SCHEMA, model: await model() }));
    },
    async spotTangent(r: TangentCheck): Promise<TangentDraft | null> {
      const prompt = [
        ...(r.above.length ? ["Sessions above this one, main task first:", ...r.above.map(a => `- ${a}`), ""] : []),
        `Current session: ${r.title}`,
        `Scope: ${r.scope}`,
        `Why it matters: ${r.why}`,
        ...(r.recent.length ? ["", "Recent chat:", ...r.recent.map(m => `${m.role === "user" ? "Learner" : "Tutor"}: ${clip(m.text)}`)] : []),
        "", `New message from the learner: ${r.message}`,
      ].join("\n");
      const v = await ask<{ tangent: boolean; title: string; scope: string; justification: string }>(
        { system: TANGENT_SYSTEM, prompt, schema: TANGENT_SCHEMA, model: await model() });
      return v.tangent && v.title.trim() && v.scope.trim() && v.justification.trim()
        ? { title: v.title.trim(), scope: v.scope.trim(), justification: v.justification.trim() } : null;
    },
    async reviewSummary(r: SummaryReview) {
      const prompt = [`Action: ${r.kind}`, `Branch: ${r.title}`, `Scope: ${r.scope}`, `Summary: ${r.summary}`].join("\n");
      return toVerdict(await ask({ system: SUMMARY_SYSTEM, prompt, schema: VERDICT_SCHEMA, model: await model() }));
    },
  };
}
