// App preferences, saved in data/settings.json. Unknown or damaged values fall back to defaults.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { isModelId, type ModelId } from "../claude/models.js";

export interface Settings {
  /** Model for chat, side questions and the judge. */
  readonly model: ModelId;
}

export const DEFAULT_SETTINGS: Settings = { model: "auto" };

export interface SettingsStore {
  get(): Promise<Settings>;
  update(patch: Partial<Settings>): Promise<Settings>;
}

const clean = (data: unknown): Settings => {
  const d = (typeof data === "object" && data ? data : {}) as Record<string, unknown>;
  return { model: isModelId(d.model) ? d.model : DEFAULT_SETTINGS.model };
};

export function jsonSettingsStore(dataDir: string): SettingsStore {
  const file = path.join(dataDir, "settings.json");
  const get = async () => {
    try { return clean(JSON.parse(await readFile(file, "utf8"))); } catch { return DEFAULT_SETTINGS; }
  };
  return {
    get,
    async update(patch) {
      const next = clean({ ...(await get()), ...patch });
      await mkdir(dataDir, { recursive: true });
      const tmp = `${file}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
      await rename(tmp, file);
      return next;
    },
  };
}

export function memorySettingsStore(initial: Settings = DEFAULT_SETTINGS): SettingsStore {
  let s = initial;
  return { get: async () => s, update: async patch => (s = clean({ ...s, ...patch })) };
}
