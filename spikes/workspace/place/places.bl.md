# Place management slice

One bl-ed package (`place/main.bl`, name `places`); host model/providers are in
`place/model.bl` and `place/server.bl`. See [schema](../schema.bl.md).

Places and subplaces are durable facts. The tree, parent links, physical folder
contents, descendant tasks, home and effective settings are editor documents.
`g p` visits the parent; RET enters a typed place/file/folder. Alt+h/l continues
to focus panes through the separate workspace layer.

Use the palette or Lisp console:

```clojure
(ed/cmd "places/attach")
(ed/cmd "places/task")
```

The first opens a minibuffer accepting a plain map. The second starts work in
the selected/current place with a scratch home. Existing task blocks can use
`:cwd @place-id` to keep their home elsewhere.

Proof gate: `test/place_test.bl` (22 assertions) and
`test/place-drive.test.mjs` (5 editor tests). Real-browser proof recorded on 2026-10-07 at offline port 8798:
`python3 spikes/workspace/test/browser.py --port 8798 --session omega-workspace-tour --slice places` drives
attachment, parent navigation, inherited settings and unload, writing screenshots
05–07.

Screenshots: [place used](../proof/05-places-used.png),
[subplace created](../proof/06-subplace-created.png),
[package unloaded](../proof/07-places-unused.png). The unchanged presentation-equivalence checker
and available vendor drive tests are recorded in the workspace report.
