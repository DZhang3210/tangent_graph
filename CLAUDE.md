# Tangent Graph

A local-first tool that tracks learning sessions as a branching graph, so side questions
("tangents") have to justify themselves and get resolved before you return to the main task.

**Read `SPEC.md` before changing behavior.** It is the source of truth for the domain rules.
If a rule there is ambiguous, ask instead of inventing behavior.

## Layout

```
src/
  core/         Pure domain logic. Types, operations, typed errors. No I/O.
  judge/        Judge interface for reasoning checks + StubJudge (always approves).
  persistence/  Load/save graphs as JSON files in data/. The only code that touches disk.
  service/      Wires it together: load → validate → judge → apply → save.
  cli/          Tiny command-line front end over the service.
tests/          Vitest tests, mirroring src/.
prototype/      UI prototype (single HTML file) + a local server bridging to Claude Code.
                Not part of the core build; kept as the reference for milestone 2.
data/           Your graphs (git-ignored).
```

Dependencies only point inward: `cli → service → (core, judge, persistence)`, and
`persistence → core` for types. **`core` imports nothing outside `core`.**

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
npm run tg -- <cmd>   # the CLI, e.g. npm run tg -- status
```

## Working rules

- Small, focused commits with clear messages.
- Run `npm run check` after every change. Nothing is done while tests or types fail.
- Don't change `SPEC.md` rules silently. If code needs a rule to change, say so and update the
  spec in the same commit.

## Running the prototype

```bash
node prototype/server.mjs   # then open http://localhost:5179
```

It needs Claude Code installed and signed in (`claude auth login`). Opened directly as a file,
the page runs in offline demo mode.
