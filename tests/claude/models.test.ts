import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isModelId, modelArgs } from "../../src/claude/models.js";
import { jsonSettingsStore } from "../../src/persistence/index.js";

describe("models", () => {
  it("passes --model only for a specific model", () => {
    expect(modelArgs("auto")).toEqual([]);
    expect(modelArgs(undefined)).toEqual([]);
    expect(modelArgs("claude-opus-5-5")).toEqual(["--model", "claude-opus-5-5"]);
  });

  it("only accepts models on the list", () => {
    expect(isModelId("claude-sonnet-5-5")).toBe(true);
    expect(isModelId("--dangerously-skip-permissions")).toBe(false);
  });
});

describe("settings store", () => {
  it("defaults to auto, saves a choice, and ignores junk on disk", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tg-settings-"));
    try {
      const s = jsonSettingsStore(dir);
      expect(await s.get()).toEqual({ model: "auto" });
      await s.update({ model: "claude-haiku-5-5" });
      expect(await jsonSettingsStore(dir).get()).toEqual({ model: "claude-haiku-5-5" });
      await writeFile(path.join(dir, "settings.json"), '{"model":"nope"}');
      expect(await s.get()).toEqual({ model: "auto" });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
