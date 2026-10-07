# Workspace schema: consolidated package-owned families

2026-10-07. The initial cwd/home slice is committed in `592224d`. The extensions
below are implemented in source, but their browser proof and commits are pending
because the current execution sandbox denies sockets and Git writes.

## Core task additions

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `:task/place` | ref | yes | Organizing place, independent of ownership, cwd, home and dependencies. Children inherit it unless explicitly overridden. |
| `:task/cwd` | string | yes | Absolute expanded directory fixed when the task opens. File, shell, eval and child task context use it. |
| `:task/home-path` | string | yes | Originating document address, e.g. `work:omega/plan.bl.org`. |
| `:task/home-block` | string | no | Complete stable block ID in that document, resolved against current source. |

All are single-valued and additive. Legacy tasks fall back to the world root;
legacy `homes.edn` entries remain readable, but new homes are task facts.

Prelude-generated file claims use absolute expanded `:trace/subject` paths.
Its type/cardinality is unchanged. Old relative claims are not rewritten.
Expansion is lexical, not symlink/inode identity. Scope remains a declared
footprint, and no new scope semantics or permissions are inferred from places.

## Place package — one family for places and subplaces

Declared in `place/model.bl`, installed through `env/open` extra schema:

| Attribute | Type | Properties |
|---|---|---|
| `:place/id` | string | unique identity; explicit stable address token |
| `:place/name` | string | renameable display name |
| `:place/parent` | ref | indexed; one primary parent |
| `:place/root` | string | absolute directory, or relative to rooted ancestry |
| `:place/home` | open value | `{:path … :block …}` location; block optional |
| `:place/config` | open value | plain map of local conventions |

Subplaces are place entities with a parent. No `:subplace/*`, `:folder/*`,
`:mount/*`, `:context/*`, or `:environment/*` family is introduced. A place
without its own root inherits its ancestor's directory; an unrooted logical
place remains browsable but cannot provide an execution directory.

```clojure
{:id "editor" :name "Editor" :parent "omega" :root "vendor/bl-ed"
 :home {:path "README.bl.org"}
 :config {:test-command "…"}}
```

Package verbs validate cycles, missing parents and resolved directories,
including descendants affected by a root change. Reparenting requires
`:directory :preserve` or `:adopt`. Preserve pins the previous resolved directory;
adopt resolves the retained relative root against the new ancestry. Neither
moves files. Clearing an optional field uses nil.

Settings inherit from root to leaf; the closest definition replaces a key.
The effective view retains `{:value v :from place-id}` for every setting.
`:cwd` supplies the default task directory, relative to the selected place's
root; a task block's explicit cwd overrides it. Other keys are visible data
for packages to consume, not arbitrary automatic command execution.

`places:` shows the containment tree. `place:<id>` shows parent, subplaces,
physical files, tasks in the place and descendants, and effective settings.
`folder:<id>/<relative-directory>` remains physical traversal. `work:<id>/<path>`
resolves a file through the place. IDs are opaque tokens without `/`, `:` or
spaces; nesting comes from the parent ref, not the ID spelling.

Task cwd remains recorded even when place roots change. Homes and file links
resolve through the current place; this slice does not promise stable document
identity across a root change or external file rename.

## Reference package — explicit relationships

Declared in `links/model.bl`:

| Attribute | Type | Properties |
|---|---|---|
| `:link/id` | string | unique identity; caller supplies stable ID |
| `:link/from` | ref | indexed; an existing task or place |
| `:link/to` | open value | entity or document/anchor location |
| `:link/kind` | keyword | indexed; `:input`, `:output`, `:context` |
| `:link/at` | long | latest attachment/update time, milliseconds |

```clojure
{:id "navigation-plan"
 :from {:place "editor"}
 :kind :context
 :to {:place "omega" :path "plan.bl.org" :block "navigation"}}
```

Targets can be `{:task id}`, `{:place id}`, `{:path address :block optional}`,
or `{:place id :path relative-file :block optional}`. Updating the same link
ID changes the relationship; removing it retracts the entity. Declared links
are never presented as evidence of an actual edit.

Documents and anchors remain location values. There is no document/anchor
entity family and no second task-specific reference family.

## Buffer package — buffers and accepted operations

Declared in `buffer/model.bl`, alongside tasks in the same env:

- `:buf/path`: unique string identity, absolute expanded file path.
- `:buf/text`: current accepted text, string.
- `:buf/rev`: monotonic accepted-operation revision, long.
- `:buf/publish-pending`: boolean; accepted text still needs projection to disk.
- `:op/id`: unique string, `<absolute-path>@<revision>`.
- `:op/buf`: indexed ref to the buffer.
- `:op/rev`, `:op/base`: result/base revision, longs.
- `:op/actor`: indexed string identifying the publisher/agent.
- `:op/task`: indexed task ref, when a task made the edit.
- `:op/cell`: indexed string, when eval supplied a cell.
- `:op/kind`: keyword (`:edit`, `:write`, `:publish`, `:resolve`, `:adopt`, `:undo`).
- `:op/span`: open `[from to]` offset value in the preceding text.
- `:op/old`, `:op/new`: replaced/replacement strings.
- `:op/before`, `:op/after`: full snapshots for this slice's base lookup and undo.
- `:op/reverts`: ref to a reverted operation, when applicable.
- `:op/at`: long, milliseconds.

`:op/*` describes addressable accepted changes and belongs to the buffer
package. It is not a universal action log. Human publication attribution names
the publishing client; it does not reconstruct every origin inside pasted or
automatically generated text.

A BEAM manager serializes requests. Provider base tokens are monotonic buffer revisions, so returning to equal text does not alias an earlier revision. Current text and accepted operations are
durable; unpublished drafts and request sequences are transient process state.
The default disk file port remains unchanged; the demo installs the buffer port.

The merge policy accepts disjoint contiguous changes and refuses overlap,
same-point insertions and ambiguous boundaries. It is conservative, not a
claim of arbitrary concurrent-edit convergence. Agents see compatible drafts
on read; accepted agent edits publish only their own changes. Overlapping agent
edits return an error asking for the draft to be published or revised. They are
not yet parked as interactive suggestions.

Manual conflict resolution requires an explicit confirmation and the exact chosen remote revision; a newer revision refuses the attempt.

Undo applies an inverse through the same overlap checks and appends an operation
referencing the original. Later independent work remains. Snapshot storage is
intentionally simple and grows with edits; compaction and delta-only storage
are future work. File publication and the fact transaction are not one atomic
filesystem transaction. Acceptance marks publication pending in the same fact transaction. A failed disk write retains the accepted revision and operation; the next buffer access retries publication, including after reopening the world. It never reuses the accepted operation ID or adopts the old disk contents over the accepted text.

## Editor state and composition

Pane focus, layouts, cursor positions, command drafts, folds and presentation
state remain editor/frame/package values. Plans, boards and saved query text
remain documents. No pane, view, execution-attempt, or configuration-binding
entity family is added.

```clojure
(env/open {:path "/tmp/my-world/.omega/db"
           :schema (vec (concat place/schema links/schema buffer/schema))})
```

Packages own schema definitions and host verbs; generic bl-ed only knows
layouts, document events, effects and optional cleanup hooks.
