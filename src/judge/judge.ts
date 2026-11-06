// Reasoning-heavy checks live behind this interface, never in core.
// Milestone 1 ships StubJudge (always approves). A later milestone adds a Claude Code
// headless implementation (see prototype/server.mjs for a working sketch).

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

export interface Judge {
  reviewJustification(r: JustificationReview): Promise<Verdict>;
  reviewSummary(r: SummaryReview): Promise<Verdict>;
}

/** Approves everything. Placeholder until the Claude-backed judge exists. */
export const stubJudge: Judge = {
  reviewJustification: async () => ({ ok: true }),
  reviewSummary: async () => ({ ok: true }),
};
