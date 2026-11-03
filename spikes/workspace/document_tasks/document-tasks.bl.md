# Work from any Org document

This prototype follows [PLAN-025](../../../!tasks/plans/PLAN-025-consolidated-document-serving.bl.org).
Saving dossier answers remains a file save. Task creation is a separate action
for any source part, selected passage, Org subtree or whole document.

The reader's task icon opens the existing task composer with three compact
context choices. A collapsed preview shows what the task receives. The origin
is a starting reference, never an execution restriction. The ordinary Work card
has a small source link; its Files reference also returns to that source.

`document-tasks.main/bl-package` is a removable, pure editor package. It emits
`document/context`, then the existing `task/open` intent. Its three commands work
in the source editor independently of dossier rendering through the existing command palette.
Existing navigation keys keep their meanings. It owns its prompt through the normal package lifecycle.
The phone host uses that same context service and ordinary task composer.

`omega.document-source` derives scopes from the shared `bl.doc.spans` partition.
`dossier.org` preserves source ranges through prose and component rendering; the
DOM bridge passes those ranges rather than matching selected strings. It works
with repeated text and arbitrary/unknown blocks. A selection spanning rendered
units captures those complete units, visible in the preview.

Anchors honor Org heading `ID`/`CUSTOM_ID`, named blocks (`#+NAME:`), and existing
Beam Lisp `:id` attributes. This follows [Org's linking conventions](https://orgmode.org/manual/Handling-Links.html).
No reading or task-start action inserts IDs into the source. When no stable ID
exists, exact captured text and its containing heading provide recovery with
explicit ambiguity handling.

Origins are stored with the task before its executor starts, and also exposed
as normal input references. Document admission lives in the world's fact store.
Org file IDs survive rename; without one, recovery requires a uniquely unchanged
file in the attached project or original parent directory. A bounded search
skips hidden/build/dependency trees and directory symlinks. A missing or
ambiguous passage exposes the saved snapshot instead of choosing another match.

The private trial has a durable database under its temporary document root.
It uses the configured Omega model service by default. Set
`OMEGA_DOCUMENTS_OFFLINE=1` for deterministic acceptance. No existing live world,
original dossier or standalone service is changed; authentication and service
migration are deferred as requested.

The source demo is [ordinary Org](demo.bl.org): prose, nested sections, named
unknown components and independent answer blocks. `bin/omega-documents` copies
it as `work-from-anywhere.bl.org` alongside the existing dossier demos.

Checks and screenshots are recorded under [proof](../dossier/proof/). The
backend scope/origin tests are `../dossier/test/task_context_test.bl`; the package
contract is `drive.test.mjs`. Browser acceptance exercises actual mobile and
desktop task creation and return navigation. The default-presentation checker
remains unchanged.


## Recorded acceptance

The [phone/desktop walkthrough](../dossier/proof/document-tasks-browser.json)
passes seven checks: independent saves, all three scopes, normal Work tasks,
precise source return, no repeated scroll jump, duplicate prose mapping and
package unload. These are actual browser actions with zero page errors.

- [Phone composer](../dossier/proof/task-01-mobile-composer.png)
- [Source link in Work](../dossier/proof/task-02-mobile-work.png)
- [Returning to the component](../dossier/proof/task-03-mobile-source.png)
- [Desktop composer](../dossier/proof/task-04-desktop-composer.png)
- [Reader after package unload](../dossier/proof/task-05-package-unused.png)
- [Completed real model task](../dossier/proof/task-06-real-model.png)

[Backend checks](../dossier/proof/document-task-backend.log): 38 source/origin,
16 document-owner/buffer, 122 renderer, and 37 task assertions pass. The existing
workspace, place, buffer and desk checks also pass. The shared editor drive
has 48 passing checks; the final package/mobile drive has 21 and verifies that
existing navigation keys keep their meanings. The unchanged presentation
checker has no bad variants (9 generic demo, 53 real dossier).

The [real model check](../dossier/proof/document-task-real-model.json) started
through the public trial UI, edited only the disposable verification file and
finished. Its task, captured source and document identity
[survive restart](../dossier/proof/document-task-restart.json). Canonical aliases
produce one Files entry and one changed-file entry for that file.

The trial uses Work's existing `http://127.0.0.1:18080/anthropic` gateway, including
its configured fallback. The older configured proxy reported exhausted quota;
no live account configuration was changed. `OMEGA_DOCUMENTS_BASE_URL` overrides
the trial route, and `OMEGA_DOCUMENTS_OFFLINE=1` selects scripted acceptance.

## Builds and runtime boundaries

`bin/omega-build`, used by both frontend launchers, forces `--max-jobs 0`.
Future build instructions in the repository require this too. The full graph
and the final package module were compiled on Build through Nix with the same
pinned compiler; the package-only refresh leaves existing navigation bindings
intact. [Build identity](../dossier/proof/document-task-build.json).
The resulting output is a private prototype, without a managed-release marker.

The hands-on trial is `omega-dossier-trial`, separate from the live
`work-omega.service` in `/home/othman/projects/omega`. The latter still uses the
old uncapped HTTP pool. A read-only [memory audit](../dossier/proof/live-memory-audit.json)
records the user's reported PID and the distinction. This session did not start,
stop or restart that live service. Owned disposable browser hosts were stopped;
the hands-on trial remains available.
