// Models you can pick in the app. "auto" means: don't pass --model, let Claude Code decide.
// Only ids on this list are ever passed to the CLI.

export const MODELS = [
  { id: "auto", label: "Auto", hint: "Claude Code's default" },
  { id: "claude-opus-5-5", label: "Opus 5.5", hint: "Most capable" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "Fast and capable" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", hint: "Fastest" },
  { id: "claude-fable-5-1", label: "Fable 5.1", hint: "" },
] as const;

export type ModelId = (typeof MODELS)[number]["id"];

export const isModelId = (x: unknown): x is ModelId => MODELS.some(m => m.id === x);

/** CLI arguments for a model choice: nothing for "auto". */
export const modelArgs = (model?: ModelId): string[] => (model && model !== "auto" ? ["--model", model] : []);
