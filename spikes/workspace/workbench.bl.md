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
