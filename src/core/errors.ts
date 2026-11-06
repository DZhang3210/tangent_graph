import type { NodeId, NodeStatus, NoteId } from "./types.js";

/** Every way a domain rule can reject an action. See SPEC.md → Errors. */
export type DomainError =
  | { readonly code: "EMPTY_FIELD"; readonly field: string }
  | { readonly code: "NODE_NOT_FOUND"; readonly nodeId: NodeId }
  | { readonly code: "NODE_LOCKED"; readonly nodeId: NodeId; readonly openBranchId: NodeId }
  | { readonly code: "NOT_AT_CURSOR"; readonly nodeId: NodeId; readonly cursor: NodeId }
  | { readonly code: "ALREADY_RESOLVED"; readonly nodeId: NodeId; readonly status: NodeStatus }
  | { readonly code: "ROOT_CANT_RESOLVE"; readonly nodeId: NodeId }
  | { readonly code: "NOT_ROOT"; readonly nodeId: NodeId }
  | { readonly code: "GRAPH_CLOSED" }
  | { readonly code: "NOT_CONTINUABLE"; readonly nodeId: NodeId; readonly reason: NotContinuableReason }
  | { readonly code: "NOTE_NOT_FOUND"; readonly nodeId: NodeId; readonly noteId: NoteId }
  | { readonly code: "NOTE_ALREADY_STRUCK"; readonly nodeId: NodeId; readonly noteId: NoteId };

export type DomainErrorCode = DomainError["code"];

export type NotContinuableReason =
  | { readonly why: "is-root" }
  | { readonly why: "still-active" }
  | { readonly why: "not-a-child-of-cursor" };

/** A one-line, human-readable explanation of an error. */
export function describeError(e: DomainError): string {
  switch (e.code) {
    case "EMPTY_FIELD": return `${e.field} can't be empty.`;
    case "NODE_NOT_FOUND": return `There's no node "${e.nodeId}".`;
    case "NODE_LOCKED": return `"${e.nodeId}" is locked until its open branch "${e.openBranchId}" is resolved.`;
    case "NOT_AT_CURSOR": return `"${e.nodeId}" isn't where you're working. Structural actions only apply to the cursor ("${e.cursor}").`;
    case "ALREADY_RESOLVED": return `"${e.nodeId}" is already ${e.status}. Resolved nodes never change; continue it instead.`;
    case "ROOT_CANT_RESOLVE": return `The main task can't be merged or deferred. Complete or abandon it instead.`;
    case "NOT_ROOT": return `Only the main task can be completed. Merge, abandon or defer a branch instead.`;
    case "GRAPH_CLOSED": return `This main task is closed. Only notes can be added.`;
    case "NOT_CONTINUABLE": return `"${e.nodeId}" can't be continued: ${describeNotContinuable(e.reason)}.`;
    case "NOTE_NOT_FOUND": return `There's no note "${e.noteId}" on "${e.nodeId}".`;
    case "NOTE_ALREADY_STRUCK": return `Note "${e.noteId}" is already struck out.`;
  }
}

function describeNotContinuable(r: NotContinuableReason): string {
  switch (r.why) {
    case "is-root": return "it's the main task";
    case "still-active": return "it isn't resolved yet";
    case "not-a-child-of-cursor": return "you can only continue a branch of the node you're working in";
  }
}
