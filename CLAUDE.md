# Tangent Graph

A local-first tool that tracks learning sessions as a branching graph, so side questions
("tangents") have to justify themselves and get resolved before you return to the main task.

**Read `SPEC.md` before changing behavior.** It is the source of truth for the domain rules.
If a rule there is ambiguous, ask instead of inventing behavior.

## Layout

```
src/
  core/         Pure domain logic. Types, operations, typed errors. No I/O.
  judge/        Judge interface for reasoning checks: StubJudge (always approves) and
                the Claude-backed judge.
  claude/       The only code that runs Claude Code (`claude -p`, headless, no tools).
  chat/         Chat prompts: what Claude is told about a node. Pure.
  persistence/  Graphs (data/graphs/), the active task (data/active.json) and chat
                transcripts (data/chats/). The only code that reads or writes data/.
  service/      Wires it together: load → core op → judge → save.
  server/       Local HTTP API + static UI. `npm run dev`.
  cli/          Tiny command-line front end over the service.
web/            The UI: one HTML file, no build step. Talks only to src/server.
desktop/        The Electron app: starts the server, shows web/ in its own window, tray,
                Ctrl+Alt+T to show/hide, and snaps the window for full/half/quarter page.
tests/          Vitest tests, mirroring src/.
data/           Your graphs and chats (git-ignored).
```

Dependencies only point inward: `server, cli → service → (core, judge, persistence)`;
`desktop` runs the server as a child process and talks to it over HTTP only;
`judge, server → claude`; everything else → `core` for types.
**`core` imports nothing outside `core`.**

## The core must stay pure

`src/core` is plain functions over plain data:

- No file system, network, process, console, `Date.now()`, `Math.random()` or `crypto` in core.
  Time and ids come in through the `Ctx` argument (`{ now, newId }`).
- Operations never mutate their input. They return a new graph.
- Rule violations are **returned**, never thrown: every operation returns
  `Result<Graph, DomainError>`. Throwing is only for programmer bugs.
- Every rule in `SPEC.md` has a test in `tests/core/`. New rule → test first, then code.

Reasoning-heavy judgments (is this justification good enough? is this summary substantive?)
never live in core. They go through the `Judge` interface, which the service calls *after*
core validation passes. Fast checks (navigation, locks, non-empty fields) stay in core.

## Conventions

- TypeScript strict mode, ES modules, Node 24. Import local files with the `.js` extension
  (NodeNext resolution), e.g. `import { fork } from "./operations.js"`.
- Prefer small named functions and discriminated unions over classes and flags.
- Error codes are `UPPER_SNAKE` string literals (see `SPEC.md` → Errors).
- Timestamps are ISO 8601 strings. Ids are opaque strings.
- Saved files carry `schemaVersion`. Bump it and add a migration if the shape changes.
- Comments explain *why*, briefly. Don't narrate the code.

## Commands

```bash
npm test              # run all tests once (Vitest)
npm run test:watch    # re-run on change
npm run typecheck     # tsc --noEmit
npm run check         # typecheck + tests; run before every commit
npm run dev           # the web app at http://localhost:5179
npm run tg -- <cmd>   # the CLI, e.g. npm run tg -- status
npm run app           # the desktop app (reuses a running dev server, or starts its own)
npm run shortcuts     # add Start menu (with Ctrl+Alt+T) and desktop shortcuts
```

The desktop app's server writes to `data/server.log`. Closing the window hides it to the tray;
quit from the tray menu.

Environment variables (server and CLI):

| Variable | Default | Meaning |
| --- | --- | --- |
| `TANGENT_DATA` | `./data` | Where graphs and chats are saved. |
| `TANGENT_JUDGE` | `claude` | `stub` approves everything without calling Claude (server only; the CLI always uses the stub). |
| `PORT` | `5179` | Web server port. |
| `CLAUDE_BIN` | auto | Path to the Claude Code executable, if it isn't found automatically. |

## Working rules

- Small, focused commits with clear messages.
- Run `npm run check` after every change. Nothing is done while tests or types fail.
- Don't change `SPEC.md` rules silently. If code needs a rule to change, say so and update the
  spec in the same commit.

## Claude

Chat, side questions and the judge run Claude Code in headless mode through `src/claude/`.
It must be installed and signed in (`claude auth login`). Calls run with no tools, in an
empty temp folder, without user customizations, and without inheriting another Claude
session's environment. If the judge can't reach Claude, the change is blocked
(`judge-unavailable`), never silently allowed.

In tests, nothing calls Claude: the judge's Claude call and the server's chat bridge are
injected fakes.
