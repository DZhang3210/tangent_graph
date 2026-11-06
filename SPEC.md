# Tangent Graph: domain spec

Tangent Graph tracks learning as a branching graph so side questions stay on purpose.
This file is the source of truth for the domain rules. Code and tests follow it; if they
disagree, fix one of them on purpose.

## Terms

| Term | Meaning |
| --- | --- |
| **Main task** | One thing you're trying to get done. Each main task is its own **graph**. |
| **Node** | One learning session with one purpose. The first node of a graph is the **root**. |
| **Branch** | Any non-root node. Also called a **tangent** (the idea) or a **fork** (the action that makes one). |
| **Scope** | What "done" looks like for a node, and what it serves. Fixed when the node is created. |
| **Justification** | Why resolving a branch changes what you do for its parent's goal. Branches only. |
| **Motivation** | Why the main task matters right now. Root only. |
| **Cursor** | The node you're working in. Exactly one per graph. |
| **View** | The node you're looking at. A UI concern only; it never changes the graph. |
| **Resolve** | End a branch: **merge**, **abandon** or **defer**. |
| **Close** | End the root: **complete** or **abandon**. Closes the whole graph. |

A node is one *purpose*, not one question. Follow-up questions that serve the node's scope
are notes or chat inside the same node. Only a question outside the scope becomes a branch.

## Node fields

| Field | Root | Branch | Notes |
| --- | --- | --- | --- |
| `id` | ✓ | ✓ | Unique within the graph. |
| `parentId` | `null` | ✓ | |
| `title` | ✓ | ✓ | Non-empty. |
| `scope` | ✓ | ✓ | Non-empty. Frozen. |
| `motivation` | ✓ | – | Non-empty. Frozen. |
| `justification` | – | ✓ | Non-empty. Frozen. |
| `status` | `active` / `completed` / `abandoned` | `active` / `merged` / `abandoned` / `deferred` | |
| `createdAt` | ✓ | ✓ | ISO 8601. |
| `resolution` | when closed | when resolved | `{ kind, summary, at }`. Frozen once set. |
| `notes` | ✓ | ✓ | Add-only list. See **Notes**. |
| `continuesFrom` | – | optional | Id of the resolved branch this one continues. |
| `seq` | – | optional | 2, 3, … for continuations (`Newton #2`). |

"Frozen" means no operation can change it after it's set.

## Rules

### 1. Creating a main task
- Needs a title, a scope and a motivation. All three must be non-empty after trimming whitespace.
- Creates a graph with one active root node. The cursor starts on the root.

### 2. Forking a branch
- You can fork only **from the cursor**.
- Needs a title, a scope and a justification, all non-empty after trimming.
- The justification must say how the answer changes what you do for the parent's goal.
  Topical relatedness isn't enough. Local code only checks it's non-empty; whether it's
  *good enough* is a judgment made by the **judge** (see below), before the fork is applied.
- The new branch is `active`, becomes a child of the cursor, and the cursor moves into it.
- The parent is now **locked** (rule 5).

### 3. Navigation is a stack (LIFO)
- The cursor moves only by **fork** (down into a new branch), **continue** (down into a new
  linked branch) and **resolve** (back up to the parent).
- There is no free "up" or "jump": to get back to a parent you must resolve the branch you're in.
  So you can never leave a deep branch for the root without resolving everything in between.
- A node can have at most **one unresolved branch** at a time. This follows from the rules above
  and is also enforced directly.
- The **view** can move anywhere at any time and never moves the cursor.

### 4. Resolving a branch
Applies to the cursor only, and never to the root.

| Action | Summary must say | Status after |
| --- | --- | --- |
| **merge** | what was usefully learned, for the parent | `merged` |
| **abandon** | why the tangent went too deep or off-purpose | `abandoned` |
| **defer** | where you stopped and why | `deferred` |

- The summary is required and must be non-empty after trimming. It can't be skipped.
- Whether a summary is *substantive* is a judgment made by the judge before the action is applied.
- Resolving records `{ kind, summary, at }` on the branch and moves the cursor to the parent
  in the same step.
- The parent's **findings** are the summaries of its merged branches. Its abandoned and
  deferred branches are listed with their summaries too. These are read from the children;
  nothing is copied onto the parent.

### 5. Locks
- A node is **locked** while it has an unresolved (`active`) branch.
- A locked node rejects every **structural** action: fork, continue, merge, abandon, defer, complete.
- Reading is always allowed. **Adding notes and chatting are always allowed**, on any node,
  locked or not, resolved or not, even in a closed graph.

### 6. Resolved nodes never change
- Once a branch is merged, abandoned or deferred, its fields and resolution are frozen.
  (Notes can still be added and struck; see rule 8.)
- To revisit one, **continue** it (rule 7). Nothing ever "reopens".

### 7. Continuing a resolved branch
- Picks a resolved (`merged` / `abandoned` / `deferred`) **child of the cursor**.
- Creates a **new** branch under the cursor, linked with `continuesFrom` and numbered with `seq`
  (the source's `seq`, or 1, plus one). Title defaults to the source's title.
- Needs its own scope and justification: you're making a new case for going back.
- Otherwise behaves exactly like a fork (cursor moves in, parent locks).

### 8. Notes
- Plain text, non-empty after trimming, with a `createdAt` timestamp.
- **Add-only.** Notes can't be edited or deleted.
- A note can be **struck out**: it stays visible, marked struck with a timestamp and an optional
  reason. A struck note can't be un-struck or struck again.
- Allowed on any node at any time (rule 5).

### 9. Closing the main task
- Applies to the root only, and only when the cursor is on the root (so every branch is resolved).
- **complete** (status `completed`) or **abandon** (status `abandoned`), with a required,
  non-empty summary.
- A closed graph is read-only for every structural action. Notes are still allowed.

### 10. Several main tasks
- Each main task is its own graph, saved in its own file. One is marked **active**.
- Switching the active graph doesn't change any graph.

## Errors

Every rule violation returns a typed error. Nothing fails silently and nothing throws for an
expected rule violation.

| Code | When |
| --- | --- |
| `EMPTY_FIELD` | A required text field is empty or whitespace-only. Names the field. |
| `NODE_NOT_FOUND` | The node id isn't in the graph. |
| `NODE_LOCKED` | A structural action targets a node with an unresolved branch. Names that branch. |
| `NOT_AT_CURSOR` | A structural action targets a node that isn't the cursor. |
| `ALREADY_RESOLVED` | A structural action targets a resolved branch. |
| `ROOT_CANT_RESOLVE` | merge or defer on the root (use complete or abandon). |
| `NOT_ROOT` | complete on a branch. |
| `GRAPH_CLOSED` | A structural action on a completed or abandoned graph. |
| `NOT_CONTINUABLE` | continue on a node that isn't a resolved child of the cursor. |
| `NOTE_NOT_FOUND` | Striking a note id that doesn't exist on that node. |
| `NOTE_ALREADY_STRUCK` | Striking a note twice. |

When several rules fail at once, the error reported follows this order:
`GRAPH_CLOSED` → `NODE_NOT_FOUND` → `ALREADY_RESOLVED` → `NODE_LOCKED` → `NOT_AT_CURSOR` →
action-specific checks (`ROOT_CANT_RESOLVE`, `NOT_ROOT`, `NOT_CONTINUABLE`) → `EMPTY_FIELD`.
This puts the most useful explanation first: "this node is locked by X" says more than
"you're not at the cursor".

## Judgments

Two checks need reasoning and are made by a **judge**, not by local code:
1. Is this justification good enough to fork (or continue)?
2. Is this merge / abandon / defer / close summary substantive?

- The judge is an interface with two implementations: a stub that always approves, and one
  backed by Claude Code in headless mode (`claude -p`), used by the web app.
- If the judge can't answer (Claude not installed, not signed in, network down), the change
  is **blocked** with `judge-unavailable`. A missing check is never treated as approval.
- Local validation (non-empty, locks, cursor) runs **first**. The judge is only asked about
  input that already passes every local rule, so a slow or failing judge can never let a
  rule violation through.
- A rejection returns the judge's feedback; nothing is changed.
- Fast operations (navigation, locks, validation) never call the judge.

## Edge cases

- **Whitespace:** `"   "`, `"\n\t"` and `""` are all empty. Text is stored trimmed.
- **Fork from a locked node:** impossible through the cursor (the cursor is never locked), but a
  direct call targeting a locked ancestor returns `NODE_LOCKED`.
- **Resolve the root:** merge/defer → `ROOT_CANT_RESOLVE`. Use complete or abandon.
- **Close the root with an open branch:** `NODE_LOCKED` (and the cursor wouldn't be on the root).
- **Act on a resolved node:** `ALREADY_RESOLVED`, even though notes are still allowed on it.
- **Continue a branch that's still active:** `NOT_CONTINUABLE`.
- **Continue a resolved grandchild:** `NOT_CONTINUABLE`; continue only from its own parent.
- **Continue a continuation:** allowed; `seq` keeps counting (`#2` → `#3`).
- **Continue the same branch twice:** allowed, as long as each new branch is resolved first
  (only one open branch per parent). Each gets the next `seq` for that source.
- **Deep chains:** no depth limit in milestone 1.
- **Ids:** generated by an injected id source, so core logic stays deterministic in tests.
- **Time:** comes from an injected clock, never `Date.now()` inside core logic.
- **Corrupt or unknown save files:** the store rejects them with a typed error instead of
  loading partial data. Unknown `schemaVersion` is rejected, not guessed at.
- **Concurrent writes:** not handled in milestone 1 (single local user, single process).
  Saves are atomic (write a temp file, then rename) so a crash can't leave half a file.

## Open questions

1. **Defer and the parent's lock.** A deferred branch counts as resolved, so the parent unlocks.
   Should deferred branches nag you later (e.g. block completing the main task until each is
   continued or abandoned)? Currently: no, they're just listed.
2. **Closing with deferred branches.** Related: can a main task be **completed** while it has
   deferred branches? Currently: yes.
3. **Abandoned summaries on the parent.** We show them on the parent. Should they also feed the
   judge as "dead ends" when you try to fork something similar later?
4. **Strike reasons.** Optional for now. Required, like resolution summaries?
5. **Judge strictness.** When the judge rejects, is there ever an override ("fork anyway")?
   Currently: no override; you rewrite and ask again.
6. ~~**Chat history.**~~ Decided in milestone 2: each node's transcript and its Claude session id
   are saved in `data/chats/<graph>/<node>.json`, apart from the graph. Chat isn't a domain rule,
   so it stays out of core. Side questions are never saved.
7. **Depth or time limits.** Should a branch warn when it's N levels deep or open for N hours?
8. **Merge summary vs. scope.** Should merging require the judge to confirm the scope was
   actually met, or only that the summary is substantive?
