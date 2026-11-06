// Entry point: `npm run tg -- <command>`.
import path from "node:path";
import { run } from "./run.js";

const dataDir = process.env.TANGENT_DATA ?? path.resolve("data");
process.exitCode = await run(process.argv.slice(2), { dataDir });
