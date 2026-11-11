import { describe, expect, it } from "vitest";
import { claudeCandidates } from "../../src/claude/headless.js";

describe("finding Claude Code", () => {
  it("checks the Windows install locations", () => {
    expect(claudeCandidates("win32", "C:\\Users\\a", { APPDATA: "C:\\Users\\a\\AppData\\Roaming" }).map(p => p.replaceAll("\\", "/"))).toEqual([
      "C:/Users/a/.local/bin/claude.exe",
      "C:/Users/a/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe",
    ]);
  });

  // Mac apps opened from the Dock don't get the shell's PATH, so the usual spots are listed.
  it("checks the native, local, Homebrew and /usr/local installs on Mac", () => {
    expect(claudeCandidates("darwin", "/Users/a", {})).toEqual([
      "/Users/a/.local/bin/claude",
      "/Users/a/.claude/local/claude",
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
    ]);
  });
});
