import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addNote, createGraph, fork, type Graph } from "../../src/core/index.js";
import { jsonStore, type GraphStore } from "../../src/persistence/index.js";
import { branchInput, makeCtx, rootInput, unwrap } from "../core/helpers.js";

let dir: string, store: GraphStore;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tg-store-"));
  store = jsonStore(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function sampleGraph(): Graph {
  const ctx = makeCtx();
  const g = unwrap(createGraph(rootInput, ctx));
  const g2 = unwrap(fork(g, { from: g.rootId, ...branchInput() }, ctx));
  return unwrap(addNote(g2, { nodeId: g2.rootId, text: "a note" }, ctx));
}

describe("json store", () => {
  it("saves and loads a graph unchanged", async () => {
    const g = sampleGraph();
    await store.save(g);
    expect(unwrap2(await store.load(g.id))).toEqual(g);
  });

  it("writes one readable JSON file per graph, with no temp files left behind", async () => {
    const g = sampleGraph();
    await store.save(g);
    await store.save(g);
    const files = await readdir(path.join(dir, "graphs"));
    expect(files).toEqual([`${g.id}.json`]);
    expect(JSON.parse(await readFile(path.join(dir, "graphs", files[0]!), "utf8")).schemaVersion).toBe(1);
  });

  it("reports a missing graph", async () => {
    expect(await store.load("nope")).toMatchObject({ ok: false, error: { code: "NOT_FOUND", graphId: "nope" } });
  });

  it("rejects a file that isn't valid JSON", async () => {
    await mkdir(path.join(dir, "graphs"), { recursive: true });
    await writeFile(path.join(dir, "graphs", "bad.json"), "{ not json");
    expect(await store.load("bad")).toMatchObject({ ok: false, error: { code: "CORRUPT" } });
  });

  it("rejects an unknown schema version instead of guessing", async () => {
    const g = { ...sampleGraph(), schemaVersion: 99 };
    await mkdir(path.join(dir, "graphs"), { recursive: true });
    await writeFile(path.join(dir, "graphs", `${g.id}.json`), JSON.stringify(g));
    expect(await store.load(g.id)).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_VERSION", version: 99 } });
  });

  it.each([
    ["the root is missing", (g: Graph) => ({ ...g, rootId: "ghost" })],
    ["the cursor points nowhere", (g: Graph) => ({ ...g, cursor: "ghost" })],
    ["a node has no title", (g: Graph) => ({ ...g, nodes: { ...g.nodes, [g.rootId]: { ...g.nodes[g.rootId]!, title: 7 } } })],
    ["a branch's parent is missing", (g: Graph) => ({ ...g, nodes: { ...g.nodes, [g.cursor]: { ...g.nodes[g.cursor]!, parentId: "ghost" } } })],
    ["a status is unknown", (g: Graph) => ({ ...g, nodes: { ...g.nodes, [g.cursor]: { ...g.nodes[g.cursor]!, status: "paused" } } })],
  ])("rejects a graph where %s", async (_, breakIt) => {
    const g = breakIt(sampleGraph());
    await mkdir(path.join(dir, "graphs"), { recursive: true });
    await writeFile(path.join(dir, "graphs", `${g.id}.json`), JSON.stringify(g));
    expect(await store.load(g.id)).toMatchObject({ ok: false, error: { code: "CORRUPT" } });
  });

  it("lists saved graphs with their titles", async () => {
    const a = sampleGraph();
    const b = unwrap(createGraph({ ...rootInput, title: "SQL joins" }, { ...makeCtx(), newId: (() => { let n = 0; return () => `b${++n}`; })() }));
    await store.save(a);
    await store.save(b);
    const list = await store.list();
    expect(list.map(s => s.title).sort()).toEqual(["Cover letter for a backend role", "SQL joins"]);
    expect(list.find(s => s.id === a.id)).toMatchObject({ status: "active", nodeCount: 2 });
  });

  it("remembers which graph is active", async () => {
    expect(await store.getActive()).toBeNull();
    await store.setActive("g1");
    expect(await store.getActive()).toBe("g1");
    expect(await jsonStore(dir).getActive()).toBe("g1"); // survives a new store instance
  });
});

function unwrap2<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}
