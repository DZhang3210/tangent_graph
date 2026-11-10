// What Claude is told about the node you're chatting in. Pure: graph in, text out.

import { pathTo, type Graph, type NodeId } from "../core/index.js";
import type { ChatMessage } from "../persistence/index.js";

/** `offTopic`: the new message was spotted as a tangent that wasn't worth its own branch. */
export function tutorSystem(g: Graph, nodeId: NodeId, offTopic?: string): string {
  const n = g.nodes[nodeId]!;
  const chain = pathTo(g, nodeId).map((p, i) => `${"  ".repeat(i)}- ${p.title}: ${p.scope}`).join("\n");
  const why = n.parentId === null ? n.motivation : n.justification;
  const state = n.status === "active" ? "" : `\nThis session is ${n.status}${n.resolution ? ` ("${n.resolution.summary}")` : ""}. Answer, but keep it brief.\n`;
  return `You are the tutor inside Tangent Graph, a learning tool that keeps people from rabbit-holing.

The learner is in this session:
Session: ${n.title}
Scope (what "done" looks like): ${n.scope}
Why it matters: ${why}
${state}
How it fits, main task first:
${chain}

${TEACHING_RULES}
- Stay inside this session's scope. A quick off-topic fact just gets its answer, with no comment. Real tangents are spotted and branched off before they reach you.
- If a question belongs to a session above this one, answer it briefly and say it's for that session: end this one to get back to it.
- When the scope looks satisfied, say so briefly so the learner can merge.` + (offTopic ? `

The learner's new message is off-topic for this session ("${offTopic}"), and it wasn't worth its own branch.
Don't refuse: give the gist in one or two plain sentences, then point them back to the scope in one short line.` : "");
}

/**
 * How the tutor teaches. The learner leads; the tutor gives the smallest useful answer.
 * Exported so tests can check every chat prompt includes it.
 */
export const TEACHING_RULES = `How to answer:
- A direct question gets a direct answer: the answer itself, in as few words as it takes. Nothing they didn't ask for: no caveats, edge cases, background or "but actually". "What's 2 + 2?" gets "4."
- If something beyond the answer would really help, don't explain it. End with at most one short follow-up they could ask, e.g. "Want to know why?". The learner decides where to go next.
- When a topic is too big to explain in one go, don't start technical or mid-level. First give a short overview of only the key ideas: 3-5 bullets, plain words, no jargon. Losing detail is fine; the goal is a baseline that's easy to understand and easy to ask good questions on top of. Then stop and let the learner pick what to go deeper on.
- Short paragraphs. Use lists only when they help.`;

export function sideSystem(g: Graph, nodeId: NodeId, quote?: string): string {
  const n = g.nodes[nodeId]!;
  return `You answer quick side questions inside Tangent Graph, a learning tool. These are throwaway:
answer exactly what was asked, as briefly as possible, without drifting into a lesson.
No unrequested caveats or background. If a follow-up would really help, offer it as one short question instead of answering it.

Context: the learner is in the session "${n.title}" (scope: ${n.scope}).` +
    (quote ? `\n\nThey highlighted this passage and are asking about it:\n"""\n${quote}\n"""` : "");
}

/**
 * Quarter-page quick ask: a talking search box. On purpose it knows nothing about the
 * learner's task, so it can't pull them back into it either.
 */
export const QUICK_SYSTEM = `You're a quick-answer box, like a search engine that talks. You know nothing about what the
person is working on, and you don't ask. Answer the question itself.

${TEACHING_RULES}`;

/** First message of a Claude session that doesn't know the earlier conversation yet. */
export function withHistory(earlier: readonly ChatMessage[], message: string): string {
  if (!earlier.length) return message;
  const t = earlier.map(m => `${m.role === "user" ? "Learner" : "Tutor"}: ${m.text}`).join("\n\n");
  return `Earlier in this session:\n\n${t}\n\nNew message from the learner:\n${message}`;
}
