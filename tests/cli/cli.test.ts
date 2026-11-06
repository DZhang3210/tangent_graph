import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../../src/cli/run.js";
import { makeCtx } from "../core/helpers.js";

let dataDir: string, out: string[], errs: string[], ctx: ReturnType<typeof makeCtx>;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "tg-cli-"));
  out = []; errs = []; ctx = makeCtx();
});
afterEach(() => rm(dataDir, { recursive: true, force: true }));

const tg = (...argv: string[]) => run(argv, { dataDir, ctx, out: s => out.push(s), errOut: s => errs.push(s) });
const last = () => out.at(-1) ?? "";

describe("cli", () => {
  it("walks through a whole main task by hand", async () => {
    expect(await tg("init", "Cover letter", "--scope", "One page, sent Friday.", "--motivation", "Deadline Friday.")).toBe(0);
    expect(await tg("fork", "Their", "backend", "tools", "--scope", "2-3 tools.", "--justification", "Changes my opener.")).toBe(0);
    expect(last()).toContain("You're at: Cover letter / Their backend tools");
    expect(await tg("note", "They", "blog", "about", "Kafka")).toBe(0);
    expect(await tg("merge", "Go,", "Postgres,", "Kafka.")).toBe(0);
    expect(last()).toContain("Findings:\n  - Go, Postgres, Kafka.");
    expect(await tg("tree")).toBe(0);
    expect(last()).toMatch(/> Cover letter .*\n {2}└─ Their backend tools \[MRG\]/);
    expect(await tg("complete", "Sent", "it.")).toBe(0);
    expect(last()).toContain("(completed)");
  });

  it("explains rule violations and exits with code 1", async () => {
    await tg("init", "Task", "--scope", "s", "--motivation", "m");
    expect(await tg("merge", "   ")).toBe(1);
    expect(errs.at(-1)).toMatch(/can't be merged or deferred/);
    await tg("fork", "A", "--scope", "s", "--justification", "j");
    expect(await tg("merge")).toBe(1);
    expect(errs.at(-1)).toBe("summary can't be empty.");
  });

  it("refuses commands with missing options", async () => {
    expect(await tg("init", "Task", "--scope", "s")).toBe(2);
    expect(errs.at(-1)).toContain("--motivation");
  });

  it("says when there's no main task yet", async () => {
    expect(await tg("status")).toBe(1);
    expect(errs.at(-1)).toContain("no active main task");
  });

  it("prints help", async () => {
    expect(await tg("--help")).toBe(0);
    expect(last()).toContain("fork <title>");
  });
});
