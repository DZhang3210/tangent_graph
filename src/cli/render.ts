// Plain-text views of a graph for the CLI. Pure: graph in, string out.

import {
  branchesOf, depthOf, findingsOf, isClosed, isLocked, openBranchOf, pathTo,
  type Graph, type GraphNode, type NodeId,
} from "../core/index.js";
import type { GraphSummary } from "../persistence/index.js";

const TAG: Record<string, string> = { merged: "MRG", abandoned: "ABD", deferred: "DEF", completed: "DONE" };
const label = (n: GraphNode) => n.title + (n.parentId !== null && n.seq ? ` #${n.seq}` : "");
const tag = (n: GraphNode) => (TAG[n.status] ? ` [${TAG[n.status]}]` : "");

/** The whole graph as an indented tree. `>` marks the cursor, `(locked)` an open parent. */
export function renderTree(g: Graph): string {
  const lines: string[] = [];
  const walk = (id: NodeId, prefix: string, last: boolean, top: boolean) => {
    const n = g.nodes[id]!;
    const mark = g.cursor === id && !isClosed(g) ? "> " : "  ";
    const branch = top ? "" : prefix + (last ? "└─ " : "├─ ");
    lines.push(`${mark}${branch}${label(n)}${tag(n)}${isLocked(g, id) ? " (locked)" : ""}  ·${id}`);
    const kids = branchesOf(g, id);
    kids.forEach((k, i) => walk(k.id, top ? "" : prefix + (last ? "   " : "│  "), i === kids.length - 1, false));
  };
  walk(g.rootId, "", true, true);
  return lines.join("\n");
}

/** Where you are and what you can do next. */
export function renderStatus(g: Graph): string {
  const root = g.nodes[g.rootId]!;
  if (isClosed(g)) {
    return [`Main task: ${root.title} (${root.status})`, `Summary: ${root.resolution?.summary ?? ""}`, `Only notes can be added now.`].join("\n");
  }
  const cur = g.nodes[g.cursor]!;
  const path = pathTo(g, g.cursor).map(label).join(" / ");
  const out = [
    `Main task: ${root.title}`,
    `You're at: ${path}  (level ${depthOf(g, g.cursor)})`,
    ``,
    `Scope: ${cur.scope}`,
    cur.parentId === null ? `Motivation: ${cur.motivation}` : `Justification: ${cur.justification}`,
  ];
  const findings = findingsOf(g, cur.id);
  if (findings.length) out.push(``, `Findings:`, ...findings.map(f => `  - ${f.summary}`));
  const deferred = branchesOf(g, cur.id, "deferred");
  if (deferred.length) out.push(``, `Deferred:`, ...deferred.map(d => `  - ${label(d)} ·${d.id}: ${d.resolution!.summary}`));
  out.push(``, cur.parentId === null
    ? `Next: fork a tangent, or complete / abandon the main task.`
    : `Next: fork a tangent, or merge / abandon / defer this branch to go back up.`);
  return out.join("\n");
}

/** Everything about one node. */
export function renderNode(g: Graph, id: NodeId): string {
  const n = g.nodes[id]!;
  const out = [
    `${label(n)}${tag(n)}  ·${n.id}`,
    `Status: ${n.status}${g.cursor === id ? " (cursor)" : ""}${isLocked(g, id) ? `, locked by ·${openBranchOf(g, id)}` : ""}`,
    `Path: ${pathTo(g, id).map(label).join(" / ")}`,
    `Scope: ${n.scope}`,
    n.parentId === null ? `Motivation: ${n.motivation}` : `Justification: ${n.justification}`,
  ];
  if (n.parentId !== null && n.continuesFrom) out.push(`Continues: ·${n.continuesFrom}`);
  if (n.resolution) out.push(`${n.resolution.kind}: ${n.resolution.summary}`);
  if (n.notes.length) {
    out.push(``, `Notes:`);
    for (const note of n.notes) {
      out.push(note.struck
        ? `  ~ ${note.text}  [struck${note.struck.reason ? `: ${note.struck.reason}` : ""}]  ·${note.id}`
        : `  - ${note.text}  ·${note.id}`);
    }
  }
  const kids = branchesOf(g, id);
  if (kids.length) out.push(``, `Branches:`, ...kids.map(k => `  - ${label(k)}${tag(k)}  ·${k.id}${k.resolution ? `: ${k.resolution.summary}` : ""}`));
  return out.join("\n");
}

export function renderTaskList(tasks: GraphSummary[], activeId: string | null): string {
  if (!tasks.length) return "No main tasks yet. Start one with `init`.";
  return tasks.map(t => `${t.id === activeId ? "> " : "  "}${t.title}  (${t.status}, ${t.nodeCount} nodes)  ·${t.id}`).join("\n");
}
