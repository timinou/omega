# Presented workbench

An experience package, `ws/desk.bl` (`workbench`), composed with `present`,
`dwim`, `workspace`, places, references and shared buffers. Host projections are
in `ws/desk_server.bl`. Existing schema families remain unchanged.

## Slice 1 — work before folders

The two-pane `desk` layout presents a scoped task rail and a conversation.
`present` supplies the mark/card/layout pipeline; workbench presenters extend it
with typed scope rows and attention-oriented task cards. This package does not
set or own `:presentation`, overwrite user keys, or run a private page. Its
render and navigation providers are removable layers.

- j/k browse visible task and place objects; selection previews a task.
- Enter focuses the selected conversation or scopes the rail to a place.
- n asks for a goal in the selected/current place; no schema map is required.
- Alt+h/l moves focus, including while a prompt is open.
- g v inspects the underlying source.
- `:(ed/unuse "workbench")` removes its keys, rendering, prompts and layout.

The initial welcome offers concrete next actions instead of an empty pane.
The demonstration seeds two real tasks with distinct cwd and anchored homes.
A scoped rail includes tasks in descendant places; it does not alter the store.
The model remains an offline scripted demonstration, not a production adapter.

Proof on offline port 8801, isolated root `/tmp/omega-workbench-slice1`, with
`npx agent-browser`:

- [Welcome](proof/16-workbench-welcome.png).
- [Task rail and live conversation](proof/17-task-rail-conversation.png).
- [Place-scoped tasks](proof/18-place-scoped-rail.png).
- [Goal-only task creation](proof/19-new-task-goal.png).
- [Package unloaded](proof/20-workbench-unloaded.png).

`test/desk-browser.py --port 8801 --slice 1` passes with no browser errors.
`test/desk-drive.test.mjs` passes 6 editor tests; `test/desk_test.bl` passes 4
backend assertions and the existing demo recovery tests pass 12. All 67 vendor
tests, including cold HTTP startup, pass; the unchanged presentation checker
passes 36 variants.

```sh
spikes/workspace/build.sh
spikes/workspace/desk.sh /tmp/omega-workbench-demo 8801
# Open the printed URL. In another terminal:
python3 spikes/workspace/test/desk-browser.py --port 8801 --slice 1
```

New work uses the existing place defaults. For production work, replace the
host model's :step function; the presentation package requires no model-specific
rendering code. The underlying schemas and links remain inspectable data.

## Slice 2 — the task beside its actual text

`ws/views.bl` extends present's readtables, presenter tables and CLOS-style around
advice. Conversations keep present's threads and docked composer, with task
identity, place and artifact shortcuts. Org files present checklist headings,
editable prose, task blocks and task-result references. Changes present attributed
operations. Every mark retains a source row; source inspection remains `g v`.

`g b` opens the primary linked output; `g H` opens the anchored home. The
`desk-artifact` layout retains the rail and the existing conversation editor,
including its reply draft, while adding an editable file pane. `g t` returns to
two panes and refuses to drop unpublished file text or a reply draft. This uses
the generic frame transition contract, not another application render loop.

The host attaches task context derived from durable tasks and links. Its revision
includes that context. A working file is a relationship, independently of cwd and
home; the demo seeds output links rather than hard-coding file visits in the UI.
Task creation now accepts an optional readable title through the existing intent.
There are no new schema families or attributes in this slice.

Proof: offline port 8802, `/tmp/omega-workbench-slice2c`, driven by
`npx agent-browser`, `test/desk-browser.py --port 8802 --slice 2`:

- [Working file, retained reply draft](proof/21-working-file-and-retained-reply.png).
- [Agent edit merged with an unpublished human paragraph](proof/22-presented-shared-edit.png).
- [Attributed changes](proof/23-presented-changes.png).
- [Selective undo retains the human edit](proof/24-presented-selective-undo.png).
- [Home lands on the exact plan task block](proof/25-plan-task-presentation.png).
- [Underlying org source](proof/26-plan-source-inspection.png).
- [Package removed from the real editor](proof/27-artifact-package-unloaded.png).

The tour checks actual published HTTP documents, isolated working directories,
real typing, draft retention, selective undo and empty browser error output.
It also caught and verifies the host's input-focus fix after moving pane DOM.
The package drive suite passes 8 tests; backend workbench assertions pass 8 and
core editor backend assertions pass 67. Vendor drive tests pass (including cold
startup); the unchanged default-presentation checker passes all 36 variants.

## Slice 3 — commands you can discover and compose

The interaction remains editor commands. `?` (normal mode), `Alt+/` (including
while composing) and the visible Actions buttons open a contextual menu. Letters
or pointer activation invoke the same named commands. Loaded packages contribute
`[:provides :actions]`, a function of the current editor returning action maps;
later contributions override a command while unloading restores the prior list.
There is no second command registry or reader.

References use guided relationship/target prompts. Relative filenames resolve in
the owning place; `@place/file`, task and place addresses work too. Reference
cards show the relationship and destination; removal requires confirmation.
Subplaces ask for a name and an optional directory. Blank inherits the parent's
root; a task created in that place receives its resolved cwd. Folder providers
also carry their actual directory so starting a task in a nested folder retains
that cwd. Place inspection from the rail opens beside it, preserving task scope.
Cancellation requires confirmation. A finished task's explicit follow-up action
retains its place and cwd instead of falling back to the host's root.

The generic host accepts named command segments and action overlays; activation
uses the normal command lookup and read-only guard. Package functions supply the
policy. Header/thread/composer advice wraps headings in narrow panes. The file
and conversation receive equal room when expanded. Keyboard checklist toggles
enter the ordinary command pipeline so buffers can transport their draft.

Proof: `npx agent-browser` on offline port 8803, root
`/tmp/omega-workbench-slice3`. `test/desk-browser.py --port 8803 --slice 3` passed
with no browser errors; the compact screenshot was repeated after waiting for
its file to finish loading.

- [Contextual command menu](proof/28-contextual-actions.png).
- [Typed input and output references](proof/29-presented-input-output-references.png).
- [Place, files and inherited settings](proof/30-place-files-and-inheritance.png).
- [Guided subplace creation](proof/31-guided-inherited-subplace.png).
- [Cross-place context](proof/32-cross-place-context-reference.png).
- [Reference opens its working text](proof/33-reference-opens-working-text.png).
- [Task uses its inherited directory](proof/34-task-in-inherited-directory.png).
- [Follow-up uses the task's place](proof/35-follow-up-keeps-task-place.png).
- [Narrower desktop](proof/36-compact-workbench.png).
- [Package unloaded](proof/37-actions-package-unloaded.png).

Backend suites pass 8 workbench, 24 place, 10 link, 48 buffer, 24 workspace and
67 core editor assertions. Workbench drive tests pass 13, including contribution
replacement/removal, protected prompts, cwd transport, width-sensitive layout
and nested checklist draft transport. The default-presentation checker remains
unchanged and passes 36 variants. All vendor drive tests are green.
