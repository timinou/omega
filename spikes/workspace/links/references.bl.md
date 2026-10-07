# Explicit references slice

One bl-ed package (`links/main.bl`, name `references`), with an extra-schema
model and host provider/intents. See [schema](../schema.bl.md).

`g r` visits references for the current place or selected task. Each row is a
typed object; RET uses the places/workspace layer to visit its target and
optional exact source block. The `links/add` and `links/remove` commands use
ordinary minibuffer prompts. Links are declared relationships, not edit logs.

Proof gate: `test/links_test.bl` (8 assertions) and
`test/links-drive.test.mjs` (2 editor tests). Real-browser proof is pending:
`python3 spikes/workspace/test/browser.py --port 8794 --slice references` drives
an anchored visit, creation, removal and package unload, writing screenshots
08–10. No screenshots are claimed until that command actually passes.

The prior verification session denied socket creation and Git index writes.
Browser proof remains pending; later commits do not establish that proof.
