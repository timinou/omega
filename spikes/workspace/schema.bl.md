# Workspace slice: schema and location contracts

2026-10-07. Implemented attributes are in `src/omega/schema.bl`; future attributes below are proposals, not installed schema.

## Installed task attributes

All three use the normal single-valued datom cardinality. They are additive: existing worlds open with the new schema without rewriting old task entities.

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `:task/cwd` | string | yes | Absolute expanded working directory, recorded before the executor starts. Shell, file port and eval context use it. Children inherit the owner's directory. |
| `:task/home-path` | string | yes | Document address of the originating task block. Independent of working directory. A file address or provider address, e.g. `work:omega/plan.bl.org`. |
| `:task/home-block` | string | no | Exact stable `:id` in that document. Navigation searches current source for the complete ID, not a substring or saved row number. |

Example entity (existing attributes omitted):

```clojure
{:task/id "t-41"
 :task/cwd "/tmp/omega-workspace-slice/beam-lisp"
 :task/home-path "work:omega/plan.bl.org"
 :task/home-block "beam-board"}
```

No cwd mutation verb is supplied in this slice. Existing task status, goal, ownership, waits and scope attributes keep their types and cardinalities. Scope remains a declared footprint, not a working directory or a lock; relative scope entries should be interpreted against the task's cwd.

Legacy tasks without cwd use the world's root. Legacy `homes.edn` entries remain readable. New homes are datom facts; the side file no longer receives new entries. Facts take precedence over legacy entries. API-created homeless tasks retain the existing scratch home.

The existing `:trace/subject` string attribute is unchanged in type and cardinality. Prelude-generated file claims now use absolute expanded paths. Thus `a/board.bl.org` and `b/board.bl.org` are distinct claim subjects; `board.bl.org` and its absolute spelling in the same directory identify the same claim. This is lexical expansion, not symlink/inode identity. Old relative claim facts are not rewritten by this slice.

## Values that do not need database attributes

Attached places are explicit host configuration:

```clojure
{"omega" "/tmp/omega-workspace-slice/omega"
 "beam-lisp" "/tmp/omega-workspace-slice/beam-lisp"}
```

The provider schemes are `places:`, `folder:<alias>/<relative-directory>`, and `work:<alias>/<relative-file>`. Aliases are stable within the configured host. The same relative basename in two places has two document addresses. These directories are execution/navigation context, not a new sandbox policy.

A home/location value is ordinary data:

```clojure
{:path "work:omega/plan.bl.org" :block "beam-board"}
```

The frame layout, pane focus, editor draft, DWIM goal columns, selections, folds, and reading positions stay in editor/frame/package state. Nothing here requires `:place/*`, `:folder/*`, `:buffer/*`, or `:pane/*` entities. The task's home and cwd are durable; the user's current attention is not a task fact.

## Next schema proposal: explicit references

When arbitrary file/section references are added, use relation entities rather than a `:task/files` bag that conflates input, output, scope and changes:

```clojure
[{:db/ident :task.link/id :db/valueType :db.type/string :db/unique :db.unique/identity}
 {:db/ident :task.link/task :db/valueType :db.type/ref :db/index true}
 {:db/ident :task.link/path :db/valueType :db.type/string :db/index true}
 {:db/ident :task.link/block :db/valueType :db.type/string}
 {:db/ident :task.link/kind :db/valueType :db.type/keyword :db/index true}
 {:db/ident :task.link/at :db/valueType :db.type/long}]
```

`kind` describes the declared relationship (`:input`, `:output`, `:context`). Each link can identify an entire document or an anchored section. Multiple notes can reference the same task without changing its originating home. These definitions should belong to the task-reference package and be passed through `env/open`'s existing extra-schema contract.

Actual edits should come from the buffer/change operation log described in `research/domain/interface/bl-ed.bl.md`, with task, cell, document, base/new revisions and time. They should not be inferred from declared links or copied into `:task/scope`. A query can derive “tasks that changed this file” from those operations. Shared-buffer edit attribution and that operation schema are outside this slice.
