// In-memory GraphStore for tests and experiments. Stores deep copies, like a real disk would.

import { err, ok, type Graph, type GraphId, type RootStatus } from "../core/index.js";
import type { GraphStore } from "./json-store.js";

export function memoryStore(): GraphStore & { saves: number } {
  const graphs = new Map<GraphId, Graph>();
  let active: GraphId | null = null;
  const store = {
    saves: 0,
    async load(id: GraphId) {
      const g = graphs.get(id);
      return g ? ok(structuredClone(g)) : err({ code: "NOT_FOUND" as const, graphId: id });
    },
    async save(g: Graph) { store.saves++; graphs.set(g.id, structuredClone(g)); },
    async list() {
      return [...graphs.values()].map(g => {
        const root = g.nodes[g.rootId]!;
        return { id: g.id, title: root.title, status: root.status as RootStatus, nodeCount: Object.keys(g.nodes).length, createdAt: g.createdAt };
      });
    },
    async getActive() { return active; },
    async setActive(id: GraphId) { active = id; },
  };
  return store;
}
