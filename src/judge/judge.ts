// Reasoning-heavy checks live behind this interface, never in core.
// Two implementations: stubJudge (approves everything, spots nothing) and the Claude-backed one.

import type { ResolutionKind } from "../core/index.js";

export type Verdict =
  | { readonly ok: true; readonly feedback?: string }
  | { readonly ok: false; readonly feedback: string };

/** "Is this justification good enough to fork (or continue)?" */
export interface JustificationReview {
  readonly parentTitle: string;
  readonly parentGoal: string;
  readonly title: string;
  readonly scope: string;
  readonly justification: string;
}

/** "Is this merge / abandon / defer / complete summary substantive?" */
export interface SummaryReview {
  readonly kind: ResolutionKind;
  readonly title: string;
  readonly scope: string;
  readonly summary: string;
}

/** "Is this chat message a tangent from the session it was sent in?" */
export interface TangentCheck {
  readonly title: string;
  readonly scope: string;
  /** The session's motivation (root) or justification (branch). */
  readonly why: string;
  /** "title: scope" for each session above this one, main task first. */
  readonly above: readonly string[];
  /** The last few chat messages, oldest first. */
  readonly recent: readonly { readonly role: "user" | "assistant"; readonly text: string }[];
  readonly message: string;
}

/** A tangent, drafted as a branch. Still goes through reviewJustification like any fork. */
export interface TangentDraft { readonly title: string; readonly scope: string; readonly justification: string }

export interface Judge {
  reviewJustification(r: JustificationReview): Promise<Verdict>;
  reviewSummary(r: SummaryReview): Promise<Verdict>;
  /** A draft if the message is a tangent, otherwise null. */
  spotTangent(r: TangentCheck): Promise<TangentDraft | null>;
}

/** Approves everything and never spots a tangent. For the CLI and tests. */
export const stubJudge: Judge = {
  reviewJustification: async () => ({ ok: true }),
  reviewSummary: async () => ({ ok: true }),
  spotTangent: async () => null,
};
