// The CLI as a function, so tests can drive it without spawning a process.

import { parseArgs } from "node:util";
import type { Ctx, Graph } from "../core/index.js";
import { stubJudge, type Judge } from "../judge/index.js";
import { jsonStore } from "../persistence/index.js";
import { createService, describeServiceError, systemCtx, type ServiceError } from "../service/index.js";
import { renderNode, renderStatus, renderTaskList, renderTree } from "./render.js";

export interface RunOptions {
  dataDir: string;
  out?: (s: string) => void;
  errOut?: (s: string) => void;
  ctx?: Ctx;
  judge?: Judge;
}

export const HELP = `Tangent Graph: keep learning tangents on purpose.

Main tasks
  init <title> --scope <text> --motivation <text>     Start a main task (and make it active)
  list                                                All main tasks
  switch <task-id>                                    Make another main task active

Branches (always at the cursor)
  fork <title> --scope <text> --justification <text>  Start a tangent; the cursor moves into it
  continue <branch-id> --scope <text> --justification <text> [--title <text>]
                                                      Revisit a resolved branch as #2, #3, …
  merge <summary>       What you learned, for the parent    } each one ends the branch
  abandon <summary>     Why it went off-purpose             } and moves the cursor up
  defer <summary>       Where you stopped and why           }
  complete <summary>    Finish the main task (at the root; abandon there closes it too)
  undo                  Remove the branch you're in, if it's still empty (no notes or branches)

Notes (any node, any time)
  note <text> [--node <id>]                           Add a note (to the cursor by default)
  strike <note-id> [--reason <text>]                  Strike a note out (it stays visible)

Looking around
  status                Where you are and what's next
  tree                  The whole graph (> = cursor)
  view <id>             One node in full

Ids are shown after a "·". Data lives in ./data (override with TANGENT_DATA).`;

export async function run(argv: string[], opts: RunOptions): Promise<number> {
  const out = opts.out ?? (s => process.stdout.write(s + "\n"));
  const errOut = opts.errOut ?? (s => process.stderr.write(s + "\n"));
  const store = jsonStore(opts.dataDir);
  const svc = createService({ store, judge: opts.judge ?? stubJudge, ctx: opts.ctx ?? systemCtx });

  let parsed;
  try {
    parsed = parseArgs({
      args: argv, allowPositionals: true, strict: true,
      options: {
        scope: { type: "string" }, motivation: { type: "string" }, justification: { type: "string" },
        title: { type: "string" }, node: { type: "string" }, reason: { type: "string" }, help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    errOut(`${(e as Error).message}\nRun with --help to see the commands.`);
    return 2;
  }
  const { values: o, positionals } = parsed;
  const [cmd, ...rest] = positionals;
  const text = rest.join(" "); // lets you skip quotes around multi-word text

  if (!cmd || o.help || cmd === "help") { out(HELP); return 0; }

  // Prints the result: the new state on success, a clear reason on failure.
  const show = async (r: Promise<{ ok: true; value: Graph } | { ok: false; error: ServiceError }>, view: (g: Graph) => string = renderStatus) => {
    const res = await r;
    if (!res.ok) { errOut(describeServiceError(res.error)); return 1; }
    out(view(res.value));
    return 0;
  };
  const need = (...pairs: [string, string | undefined][]) => {
    const missing = pairs.filter(([, v]) => v === undefined).map(([k]) => k);
    if (missing.length) { errOut(`Missing ${missing.join(", ")}. Run with --help for usage.`); return false; }
    return true;
  };

  switch (cmd) {
    case "init":
      if (!need(["<title>", text || undefined], ["--scope", o.scope], ["--motivation", o.motivation])) return 2;
      return show(svc.startTask({ title: text, scope: o.scope!, motivation: o.motivation! }));
    case "list":
      out(renderTaskList(await svc.listTasks(), await store.getActive()));
      return 0;
    case "switch":
      if (!need(["<task-id>", rest[0]])) return 2;
      return show(svc.switchTask(rest[0]!));
    case "fork":
      if (!need(["<title>", text || undefined], ["--scope", o.scope], ["--justification", o.justification])) return 2;
      return show(svc.fork({ title: text, scope: o.scope!, justification: o.justification! }));
    case "continue":
      if (!need(["<branch-id>", rest[0]], ["--scope", o.scope], ["--justification", o.justification])) return 2;
      return show(svc.continueBranch({ source: rest[0]!, scope: o.scope!, justification: o.justification!, ...(o.title !== undefined ? { title: o.title } : {}) }));
    case "merge": case "abandon": case "defer": case "complete":
      // An empty summary is passed through on purpose: core rejects it with a clear error.
      return show(svc[cmd](text));
    case "undo":
      return show(svc.undo());
    case "note":
      return show(svc.note(text, o.node), g => renderNode(g, o.node ?? g.cursor));
    case "strike":
      if (!need(["<note-id>", rest[0]])) return 2;
      return show(svc.strike(rest[0]!, o.reason), g => {
        const owner = Object.values(g.nodes).find(n => n.notes.some(x => x.id === rest[0]))!;
        return renderNode(g, owner.id);
      });
    case "status":
      return show(svc.current());
    case "tree":
      return show(svc.current(), renderTree);
    case "view": {
      if (!need(["<id>", rest[0]])) return 2;
      const id = rest[0]!;
      return show(svc.current(), g => (g.nodes[id] ? renderNode(g, id) : `There's no node "${id}". Run \`tree\` to see ids.`));
    }
    default:
      errOut(`Unknown command "${cmd}". Run with --help to see the commands.`);
      return 2;
  }
}
