# Shared buffer slice

One bl-ed package (`buffer/main.bl`, name `buffers`). `buffer/model.bl` supplies
a serialized BEAM buffer authority and the task file port; `buffer/server.bl`
supplies writable work documents, change documents and intents. See
[schema and limitations](../schema.bl.md).

Human typing travels as unpublished draft effects. Agents read compatible
human drafts. Disjoint agent edits update published text and disk, while the
client merges the update into its draft. C-s publishes the human change against
its actual base; overlap never switches to forced overwrite. Reads adopt
external disk changes when compatible. Accepted changes survive world reopen. If disk publication fails, a durable pending flag preserves the accepted text and operation; the next buffer access retries the write. Draft release still works while publication is failing.

`g c` opens attributed changes. `u` on an operation attempts selective undo;
later independent work remains, while overlap is refused. Package unload and
page leave release pending draft resources through pure hooks and host effects.
Drafts themselves are transient and should be published before closing/restarting.

Proof gate: `test/buffer_test.bl` (48 assertions) and
`test/buffer-drive.test.mjs` (12 editor tests). Real-browser proof recorded on 2026-10-07 at offline port 8798:
`python3 spikes/workspace/test/browser.py --port 8798 --session omega-workspace-tour --slice buffers` drives
unpublished typing, an agent edit, publication, attribution, selective undo and
unload, writing screenshots 11–13. It verifies the other place's board remains
untouched. Run against a fresh demo root.

This is conservative cooperation, not the full attention/suggestion or general
concurrent operation-transform system. Overlapping drafts stay local and require
resolution; no automatic overwrite is offered by this package. After manually
resolving the text, run `buffers/resolve` and type `resolved` to confirm the
chosen remote revision. If it moved again, publication is refused.

Screenshots: [shared draft and agent edit](../proof/11-shared-draft-and-agent.png),
[attributed changes](../proof/12-attributed-changes.png),
[selective undo](../proof/15-selective-undo.png),
[package unloaded](../proof/13-buffers-unused.png).
