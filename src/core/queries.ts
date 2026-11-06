// Read-only questions about a graph. Never fail, never change anything.

import type { BranchNode, BranchStatus, Graph, GraphNode, NodeId, Resolution } from "./types.js";

export const getNode = (g: Graph, id: NodeId): GraphNode | undefined => g.nodes[id];

export const isRoot = (n: GraphNode): boolean => n.parentId === null;

/** A completed or abandoned main task. */
export const isClosed = (g: Graph): boolean => g.nodes[g.rootId]?.status !== "active";

/** Branches of a node, oldest first, optionally filtered by status. */
export function branchesOf(g: Graph, id: NodeId, status?: BranchStatus): BranchNode[] {
  return Object.values(g.nodes)
    .filter((n): n is BranchNode => n.parentId === id && (!status || n.status === status))
    .sort((x, y) => x.createdAt.localeCompare(y.createdAt));
}

/** The node's unresolved branch, if any. There is at most one. */
export const openBranchOf = (g: Graph, id: NodeId): NodeId | undefined =>
  branchesOf(g, id, "active")[0]?.id;

/** Locked = has an unresolved branch. Locked nodes reject structural actions. */
export const isLocked = (g: Graph, id: NodeId): boolean => openBranchOf(g, id) !== undefined;

/** What merged branches brought back to this node. */
export const findingsOf = (g: Graph, id: NodeId): (Resolution & { from: NodeId })[] =>
  branchesOf(g, id, "merged").map(n => ({ ...n.resolution!, from: n.id }));

/** Root first, ending at `id`. Empty if `id` isn't in the graph. */
export function pathTo(g: Graph, id: NodeId): GraphNode[] {
  const path: GraphNode[] = [];
  for (let n = g.nodes[id]; n; n = n.parentId === null ? undefined : g.nodes[n.parentId]) path.unshift(n);
  return path;
}

/** Number of levels below the root (root = 0). */
export const depthOf = (g: Graph, id: NodeId): number => Math.max(0, pathTo(g, id).length - 1);
