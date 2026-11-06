// What Claude is told about the node you're chatting in. Pure: graph in, text out.

import { pathTo, type Graph, type NodeId } from "../core/index.js";
import type { ChatMessage } from "../persistence/index.js";

export function tutorSystem(g: Graph, nodeId: NodeId): string {
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

How to answer:
- Answer directly and concisely. Short paragraphs; use lists only when they help.
- Stay inside this session's scope. If a question drifts outside it, say so in one sentence and suggest forking it as a tangent instead of answering at length.
- When the scope looks satisfied, say so briefly so the learner can merge.`;
}

export function sideSystem(g: Graph, nodeId: NodeId, quote?: string): string {
  const n = g.nodes[nodeId]!;
  return `You answer quick side questions inside Tangent Graph, a learning tool. These are throwaway:
answer in a few sentences, directly, without drifting into a lesson.

Context: the learner is in the session "${n.title}" (scope: ${n.scope}).` +
    (quote ? `\n\nThey highlighted this passage and are asking about it:\n"""\n${quote}\n"""` : "");
}

/** First message of a Claude session that doesn't know the earlier conversation yet. */
export function withHistory(earlier: readonly ChatMessage[], message: string): string {
  if (!earlier.length) return message;
  const t = earlier.map(m => `${m.role === "user" ? "Learner" : "Tutor"}: ${m.text}`).join("\n\n");
  return `Earlier in this session:\n\n${t}\n\nNew message from the learner:\n${message}`;
}
