# Working places, task homes, and navigation

Runnable first slice, 2026-10-07. Schema: [schema.bl.md](schema.bl.md).

## Experience

One real bl-ed frame: **places/files → editable `.bl.org` plan → linked task**.

- DWIM supplies visible `h/j/k/l` movement, counts and heading traversal.
- `Alt+h/l` focuses editor panes spatially, skips passive views and clamps at the edges. Insert text and composer/command drafts remain in their pane.
- `g f` visits the containing folder, `g t` visits the task reference at the cursor, and `g H` visits the task's home at its exact current block ID. `C-o` retains the editor's existing document-back behavior. The broader DWIM attention trail is not implemented here.
- Selecting a file in the places pane visits it in the document pane. Selecting a task reference in the document visits its conversation in the task pane. These are layout links, not direct mutations of another editor.
- `C-Enter` on a task block uses its `:cwd` header. `@omega` and `@beam-lisp` select attached places; a relative directory resolves from the home document's containing directory.
- The task can have its home in one directory and execute in another. `pwd`, read, edit, write and child tasks use recorded task context.
- A folder is a read-only org document containing typed file/directory objects and tasks whose cwd equals that folder. Files are writable documents with revision-checked saves.

The demonstration's plan owns two task blocks. Both tasks address `board.bl.org`; each reads and edits the board in its own directory. Answer yes to change its TODO to DONE, or no to keep it unchanged. The plan and boards remain ordinary editable text.

## Run

```sh
spikes/dwim/build.sh
spikes/present/build.sh pkg
spikes/workspace/build.sh
spikes/workspace/demo.sh /tmp/omega-workspace-slice
```

Open the printed URL. Default port: **8792**, offline scripted models and an in-memory task store. If another offline test owns that port, pass an unused port as the second argument (proof used **8793**). Port 8790 is refused. Demo files are only created under its explicit `/tmp` root. Existing fixture files are retained so saved edits survive restarting the demo; task facts in this demonstration are memory-only.

Select `omega/plan.bl.org` in the left pane. `Alt+l` focuses it. Move onto the first `#+begin_task` and press `C-Enter`, save with `C-s`, then move onto its result reference. The task pane shows the conversation. Repeat for the second task block. `Alt+l` enters the conversation pane; contextual question commands are `y/n/a`. `g H` visits its home. A file or directory object's `Enter` opens it in the current pane.

To remove the package:

```text
:(ed/unuse "workspace")
```

The package's keys, commands, selection contribution and layout disappear. The focused editor survives as a single pane with its text, cursor and draft. DWIM/present remain separately loaded and can be removed separately. Using/unusing the package without interaction is exact; unloading does not reverse the user's edits, visits or navigation.

## Construction

- `ws/main.bl`: one `bl-package`; pure named commands, layered keys and a provided layout. No private page, drawing loop, IO or user-table mutation.
- `ws/server.bl`: host-side providers for configured places, folder documents and writable files. The cwd resolver connects mounted document addresses to task creation.
- `ws/demo.bl`: isolated offline world and two sample working places. Both branches of the scripted question are real omega message/turn/eval flows.
- Core: three additive task attributes; executor eval/prelude/model context reads cwd from facts, so recovery and human cell evaluation retain it. Home facts are recorded at task creation for document-backed tasks.
- Generic editor extensions: `:frame-focus` effects, package-provided selection resolution for links, and `:goto {:block id}` arrival. Generic code knows no task, place or cwd vocabulary.

## Limits

This is a configured, runnable slice, not the complete workspace manager. There is no add-place dialog, general task switcher, persistent workspace configuration, peek/forward attention history, file-reference relation UI, or universal inspector yet. Task homes use the existing single-token task-header IDs/cwd syntax; directories with spaces can be provided through the host/task APIs.

Agent file operations still use omega's disk file port. A clean displayed file refreshes when its revision changes; dirty text is retained and mounted saves check the loaded revision. Shared buffer servers, interleaved edit merging, and per-operation attribution remain the next editor-cooperation slice. The code does not claim that an agent's edit already lands in an unsaved human buffer.

## Proof and validation

The proof uses `npx agent-browser` against the real editor, offline on 8793, and records package use, two task contexts, board editing and package unload. Recorded screenshots:

- [Package used: two homes and two working directories](proof/01-two-tasks.png).
- [Home navigation: the current exact task block](proof/02-task-home.png).
- [Task conversation after answering yes](proof/03-task-edited-board.png).
- [Package unused: focused document restored to one pane](proof/04-unloaded.png).

Browser drive: opened both blocks with C-Enter, saved their source references, followed the second reference into its conversation, moved between panes with a Lisp command draft intact, returned home and back, and answered the question on its typed question row. The Beam Lisp board became DONE while the omega board remained TODO. All writes were in `/tmp/omega-workspace-slice`; the live world was untouched.

Validation: 126/126 Node drive tests pass (workspace 8, DWIM 40, present scroll 12, vendor 66). The unchanged presentation equivalence checker passes all 36 variants across four documents. The BEAM suite's 18 unaffected files passed; corrected codemode expectations and the final workspace backend test then passed separately (13 and 24 assertions). `git diff --check` passes.

```sh
bin/bl test test/ spikes/workspace/test/backend_test.bl -p spikes/workspace
BLED_OUT=vendor/bl-ed/web/out BLED_ROOT=/home/user/.cache/bl/build-trees/b4861edf5db1 node --test spikes/workspace/test/drive.test.mjs \
  spikes/dwim/test/drive.test.mjs vendor/bl-ed/test/*.test.mjs \
  spikes/present/test/scroll.test.mjs
PP_OUT=vendor/bl-ed/web/out node spikes/present/test/check.mjs \
  spikes/dwim/test/outline.bl.org vendor/bl-ed/web/welcome.bl.org \
  vendor/bl-ed/web/split-demo.bl.org spikes/present/web/welcome.bl.org
```

The default-presentation checker is not modified by this slice.
