# Live procurement research slice

This extends `spikes/browser`, using the same `browser` BL package and real editor.
The source instructions are `procurement/instructions.bl.org`; the company brief,
search functions and findings are deliberately absent from that seed. Omega must
write them after browsing. The final run uses `omega.task`, `omega.loop` and the
normal `omega.codemode/eval` tool. Codex supplies infrastructure and instructions,
then audits the result rather than writing the company's search functions.

## Run

```sh
spikes/browser/build.sh
BROWSER_LIVE=1 BROWSER_OPENAI=1 BROWSER_PROVIDER=deepseek \
  BROWSER_CREDENTIAL_FILE="$PWD/.local/browser-credentials.json" \
  BROWSER_DEMO_ROOT="$PWD/.local/browser-deepseek-run" spikes/browser/run.sh
```

Open `http://127.0.0.1:8797/?file=demo.bl.org&use=present,browser`, put the cursor
in the task block and press C-Enter. `BROWSER_OPENAI=1` selects the spike-local
model adapter on port 8808. DeepSeek uses `deepseek-v4-pro` by default, overridable
with `BROWSER_MODEL`, and reads its key from the explicit ignored credential file.
The optional OpenAI mode uses `gpt-5.4` and an existing `OPENAI_API_KEY`. Without that switch, live mode uses Omega's normal
Anthropic configuration. Without `BROWSER_LIVE=1`, the original scripted demo
remains available. Never use the running world at 8790 for tests.

The generated report's first eight lines may contain:

```org
#+BROWSER_LAYOUT: procurement-review
```

The package adopts this declarative layout request when that file is loaded.
The layout shows `company.bl.org`, the current report, and `search.bl.org`.
It runs no executable file content on load. Unuse removes the layout in every
pane; ordinary documents retain their previous behavior.

## Transport and accountability

`browser-tool.mjs` derives its task identity from Omega's existing shell process
tag. It exposes model-driven open, snapshot, link extraction, DOM evaluation,
click, fill, get and scroll operations through the same task-owned session manager.
The human can pause the browser; model operations then refuse with an explicit
handoff message. The model chooses sources and writes its own reusable functions.
The helper is infrastructure, not an authored procurement search strategy.

`model-adapter.mjs` only translates wire formats. It preserves tool-call IDs and
reasoning items; Omega executes tools and owns turns, files and completion. The
adapter records provider response IDs and raw token usage in `provider-usage.jsonl`.
Cached input is subtracted from Anthropic-shaped `input_tokens` and separately
reported as `cache_read_input_tokens`, so Omega's normalizer does not double count.
No API key is written into artifacts. The adapter currently buffers each response;
token streaming is not implemented in this slice.

Tool conversion follows [official OpenAI function calling documentation](https://developers.openai.com/api/docs/guides/function-calling).

DeepSeek uses its documented Chat Completions tool format, retaining tool-call IDs
and reasoning content across rounds, with reported cache-hit tokens mapped to
Omega's cache-read accounting. See [DeepSeek's official API reference](https://api-docs.deepseek.com/api/create-chat-completion/).
The local credential copy is mode 0600 under `.local`, which is Git ignored.
It is outside the served run root; no key or auth database is committed.

## Audit

The first real attempt used the configured Sonnet model through the direct
Anthropic API. It failed before any model response because the account had
insufficient credit. The failed task and absent usage are retained in
`proof/live/anthropic-failed.json`. This is not counted as a successful live run.
The successful funded run and its original instructions, full Omega turns,
provider usage and generated public deliverables are retained in `proof/live`. A successful HTTP model-list request is not proof of generation.

The direct OpenAI attempt also failed for exhausted account credit, before any
model response (`proof/live/openai-credit-failed.json`). The final task uses the
funded DeepSeek credential supplied by the user. Failed API requests are kept
separate from successful, reported usage; no synthetic token counts are used.


## What the real run showed

Omega, using `deepseek-v4-pro`, authored the company brief and curated functions,
executed them through its own eval/sh tools, and wrote the report. Codex supplied
the generic browser transport, infrastructure fixes and explicit operator steers;
this was an assisted run, not a demonstration of unattended reliability.

The original research hit the 25-step guard before finishing its artifacts and
needed a continuation. A second task read the four original notice pages and
corrected the ranking and verification claims. A third task chose Ireland's
official eTenders portal as an alternative to blocked TED and read original
notices. Full turns preserve these interventions and function authorship.

Concrete instruction/result discrepancies:

- The model browsed before saving reusable functions despite steering. The helper
  now requires the search artifacts once the company brief exists, before more
  browsing. This is a slice-specific checkpoint, not a generic language feature.
- It guessed unavailable JS/Java helpers in BEAM, and repeatedly broke shell
  quoting. Literal argument files and readable browser output fixed the transport
  friction; Omega repaired its functions afterward.
- Its first report treated listing evidence as verified originals and prioritized
  infrastructure procurement outside Ora's demonstrated services. The explicit
  verification pass corrected both, and retained eligibility unknowns.
- TED country-filter documentation disagreed with the actual query. Omega removed
  that mismatch. TED's WAF remains a coverage gap; national coverage is not a claim
  of comprehensive EU discovery.
- The bounded Ireland pass exceeded the preferred ten model steps. Saving output
  and fixing generated UI instructions also needed steering. Browser block syntax
  and source synchronization are audited rather than assumed correct.
- Consultation documents were not downloaded or read. The output is an actionable
  qualification shortlist, not a recommendation that Ora is eligible to bid.

UX repairs stay within the browser package: loading a report directive chooses
three panes; C-Enter on a generated search source launches an Omega task rather
than trying to evaluate BEAM functions in the editor's JS runtime; `space b e`
launches the same refresh. C-Enter on a browser declaration opens its observation
layout. `space b p/r` hands control between human and agent, `space b h/l` switches
mode while restoring saved state, and `space b x/f` closes or forgets auth state.
The session buffer retains events and immutable capture artifacts. Credentials,
cookies and browser storage remain outside the public deliverable archive.

The generated file selects a package-provided layout; it does not generate or run
arbitrary layout code on load. Local execution is demonstrated; the Kernel-style
remote adapter remains the earlier architecture proposal. Images are captures,
not a live video stream. Scratch argument files assume serial task execution in
this run root. No registrations, applications, purchases or messages were sent.

## Mini tour and proof

- [Company brief](proof/live/results/company.bl.org),
  [generated search](proof/live/results/search.bl.org) and
  [executable functions](proof/live/results/search.bl).
- [Opportunity report](proof/live/results/opportunities.bl.org),
  [original-page verification](proof/live/results/verification.bl.org),
  [Europe coverage](proof/live/results/europe-coverage.bl.org) and
  [model's run review](proof/live/results/run-review.bl.org).
- Original [instructions used](proof/live/instructions-used.bl.org) and full turns:
  [research](proof/live/research-task-initial.json),
  [verification](proof/live/verification-task.json),
  [Ireland and final repairs](proof/live/europe-task.json).
- [Usage audit](proof/live/usage-summary.json) and raw provider responses
  [usage](proof/live/provider-usage.jsonl); failed quota requests remain separate.
- [Automatic report layout](proof/live/05-opportunity-layout.png),
  [generated source](proof/live/04-generated-functions.png),
  [completed live task inbox](proof/live/08-completed-task-inbox.png),
  [notice observation](proof/live/06-notice-observation.png),
  [package removed](proof/live/07-report-unuse.png).
- [Package tests](proof/live/contract-tests.txt),
  [vendor tests](proof/live/vendor-tests.txt) and unchanged
  [default-presentation equivalence](proof/live/equivalence.txt).


Final usage: **104 successful DeepSeek responses**, **123,882 uncached input**,
**3,383,680 cached input**, and **75,001 output tokens**. Inclusive input is
3,507,562 tokens; the provider total is 3,582,563. These are cumulative across
three completed Omega tasks, including continuations, verification and repairs.
Per-task accounting sums exactly to the provider audit. This was considerably
more expensive in steps than the requested bounded discovery. No dollar cost is
estimated. The final model-generated source blocks match `search.bl` exactly.

A final formatting repair briefly prefixed the report layout directive with
repeated dash characters. The audit caught this; Omega restored the exact first
line before completion. This is preserved in the recorded turns. Side panes
still clip long company/search lines: open those files full-width to read them.
That remaining friction is visible in the screenshots rather than hidden.

Final checks: browser contract/session/transport **16/16**, vendor **68/68**, and
unchanged default-presentation equivalence on the welcome file and final generated
company/search/opportunity/Europe files. All three tasks report `done`.
