# Explicit references slice

One bl-ed package (`links/main.bl`, name `references`), with an extra-schema
model and host provider/intents. See [schema](../schema.bl.md).

`g r` visits references for the current place or selected task. Each row is a
typed object; RET uses the places/workspace layer to visit its target and
optional exact source block. The `links/add` and `links/remove` commands use
ordinary minibuffer prompts. Links are declared relationships, not edit logs.

Proof gate: `test/links_test.bl` (10 assertions) and
`test/links-drive.test.mjs` (2 editor tests). Real-browser proof recorded on 2026-10-07 at offline port 8798:
`python3 spikes/workspace/test/browser.py --port 8798 --session omega-workspace-tour --slice references` drives
an anchored visit, creation, removal and package unload, writing screenshots
08–10.

Screenshots: [references used](../proof/08-references-used.png),
[reference created](../proof/09-reference-created.png),
[anchored plan](../proof/14-anchored-plan.png),
[package unloaded](../proof/10-references-unused.png).
