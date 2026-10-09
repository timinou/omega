# Harness fixes found while building the travel desk

Authorised by the user ("You're allowed to fix stuff like this BTW, just commit and lmk"). Narrow fixes only; structural work is deferred.
No live world (8790) was written.

## 1. `eval` called with `{}` (nil code) and large replies

**Evidence.** Many large-output turns produced an `eval` tool call with an empty input. `omega.codemode` then ran `nil` as code: only the
prelude ran, and the cell registered its own task id, so the model got a silent task id back and no error. The default `max-tokens` is 8000;
the external harness raised it to 32000 and small-chunk writes progressed.
**Hypothesis, not proven.** That an output cut-off (`stop_reason: max_tokens`) truncated the tool JSON. Supporting: the SSE folder
would have seen unfinished `input_json_delta`. Not observed: no raw response with `max_tokens` and an empty input was captured. The fixes below
are correct whatever the cause.

**Fixes.**
- `omega.codemode/bad-code` (pure) and `run-eval`: a missing, non-string or blank `code` returns `{:error ...}` BEFORE the task namespace, prelude
  or any id is registered. The tool wrapper also tolerates a non-map input. The message says nothing was run and to retry with a smaller program.
- `omega.llm.sse/response`: unfinished tool JSON now yields an empty input instead of throwing inside the stream decoder.
- `omega.loop/turn!`: if a response stops with `:max-tokens` and contains tool calls, NO call runs (the input may be incomplete). Each call is
  answered with a "NOT RUN ... retry with smaller chunks ... OMEGA_MAX_TOKENS" error, so the history stays paired and the model can retry.
- `OMEGA_MAX_TOKENS` (`omega.llm/parse-max-tokens`, read in `from-env` like `OMEGA_MODEL`/`OMEGA_BASE_URL`, `.env` or environment). Default
  stays 8000, deliberately: a higher default raises cost and latency for every reply. Valid: whole number 1..128000. Invalid values throw a
  startup error naming the variable and rule, never echoing the value (so a mistaken secret paste is not leaked). For travel construction use
  `OMEGA_MAX_TOKENS=32000` in omega's `.env` together with small-chunk writes.

## 2. SIGTERM between a persisted `tool_use` and its `tool_result`

**Cause (proven by the new test).** `turn!` appends the assistant turn before running tools. A kill in between leaves a durable orphan.
`recover!` + `say!` then built a request whose assistant message had `tool_use` ids without a `tool_result` directly after, which Anthropic rejects
with 400. The history is provider-neutral, so the fix is not in the Anthropic HTTP code.

**Fixes** (`src/omega/loop.bl`, `src/omega/task.bl`).
- `repair-messages` (pure): for each assistant message, ids with no result in the run of user messages right after it get an explicit
  `:tool-result` `{:error? true}` ("INTERRUPTED ... NOT re-run ... effect UNKNOWN ... inspect before retrying"), put first in the following user
  message, or in a new user message when none follows. Handles several calls, partial results, a user text arriving after the orphan, orphans mid-history,
  duplicate ids, idempotence. A healthy list is returned equal. `messages` applies it to every request for every provider.
- `orphaned-results` / `repair-tail!` persist the missing results for the last assistant turn as a `:tool` turn; `task/recover!` calls it for each live
  task before executors start. Completed turns are not touched, and no tool is ever executed on recovery.

**Proof.** `test/interrupted_test.bl` `sigterm-between-tool-use-and-result-recovers-without-re-running-the-tool`: a durable env, a scripted model
that runs one completed `fast` call and then two `slow` calls, stopped while the slow tool runs; reopen, `recover!`, `say!`. Asserts the first four
turns are identical, the two missing ids are answered once as errors, a second repair is a no-op, the resumed model's request pairs every `tool_use`,
and the effects log is unchanged (nothing re-run). Plus a healthy-history-left-alone test and pure-helper cases.

## 3. Transient 503 failing a UI task

Not changed. The existing policy (3 retries for 429/5xx/transport, 1/2/4 s) is kept; no unbounded retries. Documented in README Requirements.
After the retries a turn fails and the task is `failed` (terminal); open a new task.

## Tests
- `bin/bl test` (whole suite, written to a file, exit code recorded, not piped through tail): 21 files passed, 0 failed, 0 incoherent, `EXIT 0`.
  New: `test/interrupted_test.bl` 76 assertions; `test/llm_test.bl` 48 assertions (16 before; adds max-tokens parsing, `from-env` default/override/invalid, cut-off SSE input).
- Travel: `node --test spikes/travel/test/service.test.mjs spikes/travel/test/package.test.mjs` 35 pass.
