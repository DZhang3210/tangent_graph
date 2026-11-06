// Domain types. Plain data only: no classes, no methods, safe to JSON round-trip.

export type NodeId = string;
export type NoteId = string;
export type GraphId = string;
/** ISO 8601 timestamp. */
export type Timestamp = string;

export type BranchStatus = "active" | "merged" | "abandoned" | "deferred";
export type RootStatus = "active" | "completed" | "abandoned";
export type NodeStatus = BranchStatus | RootStatus;

/** How a branch was resolved, or how the root was closed. */
export type ResolutionKind = "merge" | "abandon" | "defer" | "complete";

export interface Resolution {
  readonly kind: ResolutionKind;
  readonly summary: string;
  readonly at: Timestamp;
}

export interface Note {
  readonly id: NoteId;
  readonly text: string;
  readonly createdAt: Timestamp;
  /** Set once when struck out. Struck notes stay visible. */
  readonly struck?: { readonly at: Timestamp; readonly reason?: string };
}

interface NodeBase {
  readonly id: NodeId;
  readonly title: string;
  /** What "done" looks like for this node. Frozen. */
  readonly scope: string;
  readonly createdAt: Timestamp;
  readonly notes: readonly Note[];
  readonly resolution?: Resolution;
}

export interface RootNode extends NodeBase {
  readonly parentId: null;
  readonly status: RootStatus;
  /** Why the main task matters right now. Frozen. */
  readonly motivation: string;
}

export interface BranchNode extends NodeBase {
  readonly parentId: NodeId;
  readonly status: BranchStatus;
  /** Why resolving this changes what you do for the parent's goal. Frozen. */
  readonly justification: string;
  /** The resolved branch this one continues, if any. */
  readonly continuesFrom?: NodeId;
  /** 2, 3, … for continuations. */
  readonly seq?: number;
}

export type GraphNode = RootNode | BranchNode;

export const SCHEMA_VERSION = 1;

/** One main task. */
export interface Graph {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly id: GraphId;
  readonly rootId: NodeId;
  /** The node you're working in. Moves only by fork, continue and resolve. */
  readonly cursor: NodeId;
  readonly nodes: Readonly<Record<NodeId, GraphNode>>;
  readonly createdAt: Timestamp;
}

/** Everything impure that core needs, passed in so core stays deterministic. */
export interface Ctx {
  /** Current time as an ISO 8601 string. */
  readonly now: () => Timestamp;
  /** A new unique id. */
  readonly newId: () => string;
}
