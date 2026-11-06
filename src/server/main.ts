// Starts the local web app: `npm run dev`, then open http://localhost:5179.
//   TANGENT_DATA   where graphs and chats are saved (default ./data)
//   TANGENT_JUDGE  "claude" (default) or "stub" (approve everything, no Claude calls)
//   PORT           default 5179

import http from "node:http";
import path from "node:path";
import { askJson, claudeStatus, findClaude, streamChat } from "../claude/headless.js";
import { createClaudeJudge, stubJudge } from "../judge/index.js";
import { jsonChatStore, jsonSettingsStore, jsonStore } from "../persistence/index.js";
import { createService, systemCtx } from "../service/index.js";
import { createApp } from "./app.js";

const dataDir = process.env.TANGENT_DATA ?? path.resolve("data");
const port = Number(process.env.PORT) || 5179;
const useStub = process.env.TANGENT_JUDGE === "stub";

const store = jsonStore(dataDir);
const settings = jsonSettingsStore(dataDir);
const judge = useStub ? stubJudge : createClaudeJudge(askJson, async () => (await settings.get()).model);
const app = createApp({
  service: createService({ store, judge, ctx: systemCtx }),
  store,
  chats: jsonChatStore(dataDir),
  settings,
  claude: { status: claudeStatus, streamChat },
});

http.createServer(app).listen(port, "127.0.0.1", () => {
  console.log(`Tangent Graph: http://localhost:${port}`);
  console.log(`Data: ${dataDir}`);
  console.log(`Judge: ${useStub ? "stub (approves everything)" : "Claude Code"} · Claude at: ${findClaude()}`);
});
