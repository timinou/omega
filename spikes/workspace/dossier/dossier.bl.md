# Consolidated dossiers prototype

This is the first working slice of [PLAN-025](../../../!tasks/plans/PLAN-025-consolidated-document-serving.bl.org).
It keeps Omega's existing places, Open, document pane, Edit and Publish. The
original dossier presentation runs inside that pane, including its section
navigation, feedback, recorded cells, design blocks and evidence views.

One account host resolves `project:<place>/<path>`, existing `work:` addresses,
absolute host paths and `file:///absolute/path`. They share a canonical file and
Omega's buffer owner. Opening one full file does not attach its parent directory.
Project paths resolve symlinks before the attached-root check. Answers use the
buffer's revision check, draft merge and publication rather than the kit's
independent read/patch/rename writer. Reading never evaluates document cells.

The package is `dossier.main/bl-package`, declared in `packages/dossier.edn`.
Provider suggestions use the normal package loader and explicit unuse suppression.
The Pocket package requires that same package. Its existing reader paints the
provider's dossier URL and retains the iframe while editing source. The desktop
source editor can switch with `g D`; `:(ed/unuse "dossier")` restores its ordinary
presentation. The package adds no layout or shared editor tables.

The renderer snapshot comes from
`/home/othman/projects/enchanted-skills/bl-org-dossier/kit`, captured 2026-11-03.
[Source hashes](proof/renderer-source.json) identify that baseline. The small
`ensemble` dependency retains its own [provenance](../ensemble/VENDORED).
The renderer's existing tests are copied here. Omega changes the feedback button
copy to describe saving; it does not claim an agent has received the answer.

## Try it privately

`bin/omega-documents` uses the verified cached frontend, or builds it through Nix on Build, then copies the demo
and the real build-unification dossier into a new temporary directory, and
starts an offline memory world on port 8792. It prints the ordinary Omega URL.
Use an unused port; another port can be passed as its first argument. Ctrl-C
stops this foreground prototype. The live world and original dossier are untouched.

Inside the existing Open action, try `project:project/review.bl.org` or the full
file address printed by the launcher. Choose an option to expose its note field.
Open the same document in a second browser/phone, submit there, and check that
an unsent note stays in the first browser. Edit and Publish source, then return
to Read. The demo links to the copied unification dossier in the same pane.

The listener stays on loopback. `:document-owner` optionally enforces an expected
Tailscale login for every route. The deployed trial currently leaves it unset;
its named-service URL is tailnet reachable, without an app owner restriction.
See the authentication audit below. No existing dossier service is migrated. Admitted documents, the bounded
projection cache (16 entries), and the 256-document limit belong to this host.

The running private trial is [Omega dossier trial](https://work.tailcb5318.ts.net:18061/?use=home&layout=home&file=workspace%3Aall).
In Places, enter `omega-documents-try` and open `review.bl.org`. It links to the
copied real dossier. Stop this trial with `work stop omega-dossier-trial`.
The existing `omega` and `omega-documents` services were not changed.

The compiled graph is the full Nix `.#frontend` output recorded below. A small
Nix asset derivation (`nix/dossier-assets.nix`) refreshes the reader host over that
graph, so explicit dossier unload also restores Pocket's ordinary reader. That
private output deliberately drops the managed-release marker; it does not alter
the account's configured live frontend. All compilation and asset assembly ran on Build.

## Scope

Implemented: project/full-file opening, original dossier reading, guarded
feedback, ordinary source editing, live source/evidence refresh, private explicit
assets, and retaining local answer input and reader position.

Still planned: title-based project-wide discovery, Needs you projection,
explicit block/task links with recoverable answer delivery, durable document
admission/rename recovery, and production gateway acceptance. Answers currently
save to the source document; they do not resume an Omega task. No existing
standalone service has been retired. Video range streaming and asset-only cache
invalidation beyond recorded film metadata need further work before broad cutover.

## Checks

The backend/kit suite is:

```sh
bin/bl --cold test spikes/workspace/dossier/test/documents_test.bl spikes/workspace/dossier/test/kit_test.bl
```

The package drive and browser acceptance tests are under `test/`. Browser scripts
resolve `playwright-core`, or `PLAYWRIGHT_MODULE` for an explicit installed module;
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects a browser binary. They use only
an offline host and temporary document copies. Evidence is recorded in `proof/`.
The default-presentation checker stays unchanged; the existing
`spikes/mobile/test/presentation-check.mjs` supplies its historical `core.pr_str`
export alias for the published actor graph.

Current recorded checks: 16 backend assertions, 122 renderer assertions, 48
editor/host checks and the package drive test pass. Desktop and phone browser
walkthroughs pass both directly and inside the original Home chrome, with zero
page errors. Presentation equivalence has no bad variants (7 demo, 53 real dossier).

- [Home on desktop with the package](proof/05-home-desktop.png)
- [Home on phone with the package](proof/05-home-phone.png)
- [Two clients with an unsent desktop draft](proof/01-used-desktop.png)
- [The real dossier opened by a relative link](proof/03-real-dossier.png)
- [Ordinary editor after unuse](proof/04-unused-editor.png)
- [Browser results](proof/browser.json), [Home results](proof/home.json), [reader controls](proof/controls.json), [HTTP policy fixture](proof/http.json)
- [Backend log](proof/backend.log), [editor log](proof/editor.log), [package drive](proof/drive.log), [equivalence](proof/equivalence.log)
- [Compiled frontend identity](proof/frontend.json)

Existing workspace/place and buffer regressions also pass: 26 + 48 assertions.

The retained reader controls are also verified: Outline, Find, source-anchored Ask,
source switching, failed-refresh draft retention and explicit package unload.
The real dossier projection returns HTTP 200 and renders its full heading/body.


## Trial failure and repair

The first handed-off service was killed at its 4 GB cgroup limit. The pinned
web listener's default pool created hundreds of processes holding large copies
of the application's BL callback context. `bl-ed.http` now sets four acceptors
while retaining the original scoped callbacks and supervised lifetime. The full
trial uses about 400 MB idle; its public eight-client/64-read check passes,
with a measured service peak below 800 MB. The service has on-failure recovery.
A bare root URL now opens Home directly, and the trial supplies the launch
identity provider needed by Pocket's navigation/restore code.

The replacement acceptance run uses actual public browser clicks through Places,
Files, the dossier, answering and Edit/Publish; it uses an explicit disposable
acceptance file rather than changing the user's review file. Results are in
[public journey](proof/public-journey.json), [load check](proof/recovery-load.json),
and [cold listener regression](proof/cold-server-after-fix.log).


## Authentication audit, 2026-11-03

The intended flow is a user-owned Tailscale device → Serve HTTPS → trusted
identity/owner authorization → the account's Omega host → its admitted document.
Serve supplies `Tailscale-User-Login`, removing a client-supplied copy. The device's
Tailscale owner is the identity, rather than a separate browser login; tagged
devices do not supply a human identity. A copied document link must grant no
additional access. See [Tailscale's identity-header contract](https://tailscale.com/docs/features/tailscale-serve#identity-headers).

The running trial does **not yet meet the owner-only requirement**. Read-only
inspection of the installed Work endpoint helper and Serve configuration found:

- Named `work serve` services proxy directly to their loopback backend. The
  trial's public port 18061 points directly to port 8792.
- Work's opened-port gate is a different path: it checks that the peer is
  tailscaled, maps the login to a Unix account, applies owner/admin/share policy,
  then removes Tailscale headers before forwarding. A named service does not
  automatically inherit that gate. Its `shared: false` metadata does not prove
  that the direct named-service URL checks the viewer.
- The trial process has no `OMEGA_DOCUMENT_OWNER`; the app's optional owner
  check is therefore off. Access currently depends on tailnet reachability
  rules. Another permitted tailnet user is not refused by this app.
- `proof/http.json` tests configured app middleware using synthetic headers on
  an isolated fixture. It is not evidence of a real second-account denial.

Before using original private documents, put the host behind a verified owner
gate, establish a trusted identity handoff (the opened-port gate strips those
headers), close local-user bypasses, and run actual owner/other-account checks
for reads, writes, observation, assets and task actions. Setting the header check
alone does not authenticate arbitrary local callers. Production acceptance and
service migration remain unchecked in PLAN-025. This audit changed no live auth
settings. [Sanitized deployment observations](proof/auth-audit.json).

## Starting work from the document

The existing editor already supports executable task blocks:

```org
#+begin_task :id implement-next-step :cwd "@project"
Implement the next agreed step in this dossier. Run its checks and update the
evidence. Ask me before taking an unresolved decision.
#+end_task
```

Use an attached place ID after `@`; `@project` is the trial's place. In the
ordinary desktop bl-ed source editor, put the cursor inside the block and
press Ctrl+Enter (or `space e`). Omega opens a task using the body as its goal, with the document
path/block as its home and the explicit place as its working directory. The
editor inserts a `#+RESULTS:` / `#omega/task` reference; save it with the normal
save command. The same unchanged block keeps its live task; changing its body
refines it; a finished task can produce a new reference linked to the previous
one. Explicit `:cwd` avoids relying on working-directory inference for full-file
or canonical `document:` addresses.

Selecting prose in Read and using the existing Ask action reaches the ordinary
source-anchored task composer. The host validates the captured revision and
passage before task creation. The rendered dossier has no new inline Start card. Home/Pocket's Edit textarea
does not implement that desktop task-block shortcut; use its Read → select
passage → Ask flow today. The trial's model is scripted/offline: it exercises the task machinery but does
not run a real model against the requested implementation.

What remains is the document/task decision loop: an explicit question links to
a specific task, Needs you exposes it in Pocket, and accepting an answer both
saves the source and records recoverable delivery to that same task. Delivery
must survive a restart without resuming work twice. `Save answer` currently
performs only the source-saving part. The existing task-message answer action
already works separately; bridging it to dossier decisions is the next slice.

The existing task-block editor contract (12 tests) and task/workspace backend
checks were rerun for this review; see [editor results](proof/task-editor.log)
and [backend results](proof/task-backend.log). They use private scripted worlds.
