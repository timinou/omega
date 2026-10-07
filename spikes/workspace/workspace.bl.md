# Working places, task homes, and navigation

Initial slice committed as `592224d`; place/reference/buffer extensions are implemented but awaiting browser proof and commits. 2026-10-07. Schema: [schema.bl.md](schema.bl.md).

## Experience

One real bl-ed frame: **places/files → editable `.bl.org` plan → linked task**.

- DWIM supplies visible `h/j/k/l` movement, counts and heading traversal.
- `Alt+h/l` focuses editor panes spatially, skips passive views and clamps at the edges. Insert text and composer/command drafts remain in their pane.
- `g f` visits the containing folder, `g t` visits the task reference at the cursor, and `g H` visits the task's home at its exact current block ID. `C-o` retains the editor's existing document-back behavior. The broader DWIM attention trail is not implemented here.
- Selecting a file in the places pane visits it in the document pane. Selecting a task reference in the document visits its conversation in the task pane. These are layout links, not direct mutations of another editor.
- `C-Enter` on a task block uses its `:cwd` header. `@omega` and `@beam-lisp` select attached places; a relative directory resolves from the home document's containing directory.
- The task can have its home in one directory and execute in another. `pwd`, read, edit, write and child tasks use recorded task context.
- `g p` visits a place parent; `g r` opens explicit references; `g c` opens a shared file’s changes. Place attachment and new work use `places/attach` and `places/task`.
- A folder is a read-only org document containing typed file/directory objects and tasks whose cwd equals that folder. Files are writable documents with revision-checked saves.

The demonstration's plan owns two task blocks. Both tasks address `board.bl.org`; each reads and edits the board in its own directory. Answer yes to change its TODO to DONE, or no to keep it unchanged. The plan and boards remain ordinary editable text.

## Run

```sh
spikes/dwim/build.sh
spikes/present/build.sh pkg
spikes/workspace/build.sh
spikes/workspace/demo.sh /tmp/omega-workspace-demo 8794
```

Open the printed URL. Default port: **8792**, an offline conversation-derived demonstration model and a durable task/place/link/buffer store. If another offline test owns that port, pass an unused port as the second argument (proof used **8793**). Port 8790 is refused. Demo files are only created under its explicit `/tmp` root. Existing fixture files are retained so saved edits survive restarting the demo; facts persist under `<demo-root>/.omega/db`; restarting reattaches unfinished tasks. Unpublished drafts are transient and should be published before closing.

Enter the omega place in the left pane, then select its `plan.bl.org` file. `Alt+l` focuses it. Move onto the first `#+begin_task` and press `C-Enter`, save with `C-s`, then move onto its result reference. The task pane shows the conversation. Repeat for the second task block. `Alt+l` enters the conversation pane; contextual question commands are `y/n/a`. `g H` visits its home. A file or directory object's `Enter` opens it in the current pane.

To remove the package:

```text
:(ed/unuse "workspace")
```

The package's keys, commands, selection contribution and layout disappear. The focused editor survives as a single pane with its text, cursor and draft. DWIM/present remain separately loaded and can be removed separately. Using/unusing the package without interaction is exact; unloading does not reverse the user's edits, visits or navigation.

## Construction

- `ws/main.bl`: one `bl-package`; pure named commands, layered keys and a provided layout. No private page, drawing loop, IO or user-table mutation.
- `ws/server.bl`: host-side providers for configured places, folder documents and writable files. The cwd resolver connects mounted document addresses to task creation.
- `ws/demo.bl`: isolated offline world and two sample working places. Both branches of the scripted question are real omega message/turn/eval flows.
- `place/*`: the place-management package, durable hierarchy and inherited conventions.
- `links/*`: the reference package and explicit relationship provider.
- `buffer/*`: shared text, draft transport, accepted operations and guarded undo.
- Core: four additive task attributes; executor eval/prelude/model context reads cwd from facts, so recovery and human cell evaluation retain it. Home facts are recorded at task creation for document-backed tasks.
- Generic editor extensions: `:frame-focus` effects, package-provided selection resolution for links, and `:goto {:block id}` arrival. Generic code knows no task, place or cwd vocabulary.

## Limits

This is an experimental package-based workspace, not the complete manager. There is no general task switcher, saved frame configuration, forward attention history or universal inspector yet. Task header IDs/cwd remain single-token syntax; use place aliases for paths with spaces.

Shared editing conservatively merges disjoint contiguous changes. Overlap and ambiguous boundaries are refused, not transformed or parked as suggestions. After resolving a conflict manually, `buffers/resolve` explicitly confirms the chosen remote revision; another intervening edit refuses the publish. Drafts are visible to agents and kept off disk until publication; accepted agent changes publish independently. Change inspection and guarded selective undo use the operation log. Full snapshots in the operation log need future compaction, and disk publication is not atomic with the fact transaction; a durable pending flag makes failed publication retryable without losing the accepted operation. See [buffer contract](buffer/buffers.bl.md).

## Customize

Run `:(ed/cmd "places/attach")`, then enter a map such as:

```clojure
{:id "notes" :name "Notes" :parent "omega"
 :config {:test-command "printf notes"}}
```

Add `:root "relative/subdirectory"` for an existing subdirectory, or an absolute root to attach another existing directory. Without a root, the subplace inherits its parent's directory. These mappings persist. Update by the same ID; clearing optional fields uses nil. Reparent with an explicit `:directory :preserve` or `:adopt`; neither moves files.

Task blocks can use `:cwd @notes`; the task still returns to its source block in the plan. A place config's `:cwd` supplies a default directory relative to that place. Other configuration keys remain inspectable conventions for packages to consume.

Run `:(ed/cmd "links/add")`, then enter:

```clojure
{:id "notes-plan" :from {:place "notes"} :kind :context
 :to {:place "omega" :path "plan.bl.org" :block "beam-board"}}
```

For task-specific input/output references, use `:from {:task "t-…"}`. Commands are available in the palette; `:(ed/doc "places/attach")` describes one. The demo model recognizes only its two board goals. For real work, replace the host's `:step` with your model adapter while retaining schema composition, providers, intents and the buffer file port in `ws/demo.bl`.

Unload layers separately with `(ed/unuse "places")`, `"references"`, `"buffers"`, or `"workspace"`. Published text and durable facts remain; buffers release their transient drafts.

## Extension validation status

The latest place backend has 20 passing assertions; links has 8; buffers has 48. The full BEAM suite passed 24 files; the seven affected backend/core files were then rerun with the final publication-recovery changes and all passed. The demo has 12 passing assertions exercising duplicate goals and recovery. The extension editor suite includes 27 tests; vendor drive tests not requiring sockets pass 65/65; DWIM 40/40 and present scrolling 12/12 pass. The unchanged presentation checker passes 36 variants.

Required **new browser screenshots remain pending**. In the prior verification session, `npx agent-browser` failed to start because the sandbox denied socket creation; Git metadata was also read-only. The cold HTTP test was blocked by the same socket restriction. Later commits do not establish these passing gates.

To complete the remaining verification, run:

```sh
spikes/workspace/test/verify.sh
# In another terminal, against a fresh root:
spikes/workspace/demo.sh /tmp/omega-workspace-proof 8794
python3 spikes/workspace/test/browser.py --port 8794 --slice all
```

The browser drive tests places, references and buffers in sequence and records package-used/unloaded screenshots for each. Run against a fresh root because it asserts initial TODO board contents. The script accepts `--slice places`, `references`, or `buffers` to drive one slice.

## Initial committed slice: historical proof

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
