# Scroll and type: the conversation and the one-screen overview

*Design, 2026-10-04. Follows [`presentation-pipeline.bl.md`](presentation-pipeline.bl.md) (the
machinery) with what it should DRAW. Mock: `spikes/present/web/mock.html` (plain DOM over the same
`/api`, real tasks). Screenshots: `spikes/present/proof/11–14`. Plan: PLAN-004 waves W9–W12.*

## 1. What is wrong today (OBSERVED)

**The task view treats every line alike.** `* you · 7` and `* model · 8` are the same size, weight
and face. A 40-line tool dump weighs the same as the one sentence you typed. Scrolling a task means
reading everything to find anything. Your questions are the table of contents of a task, and they
are invisible.

**The overview is a dead end.** Reaching what a task said takes three screens and four decisions:
`omega:overview` → (RET goes to the task's *home* cell in `omega:scratch`, `t` goes to the
livebook; the hint line has to tell you which) → `task:t-1` → scroll. Coming back is `C-o`, and
then the same trip again for the next task. The overview row shows a slug
(`omega-task-id-t-1-goal-17072422`) and the first words of the last answer, cut mid-sentence. There
is no selection that carries meaning, no preview, no filter, and empty groups (`Running (0)`,
`Stale (0)`) take as much space as full ones (`11-today-overview.png`).

## 2. The models, and what each changes

| model | what it does well | what it changes here |
|---|---|---|
| **Mail clients (Mail.app, Superhuman, mutt)**: list + preview | moving the selection IS reading; no "open" step; `j/k` triage at keyboard speed | **the overview and the task are ONE screen**: a rail of tasks and a pane that follows the selection. `j/k` in the rail, the pane updates; no RET, no `C-o`. Superhuman's lesson: the inbox is the home, every action is a key, and the next item comes up by itself after you act |
| **Slack/Zulip threads; Zulip topics** | a message is a headline; replies hang under it | **a thread = one thing you said + all the model's turns until you speak again.** Your words are the headline (large, sans); the model's turns are follow-ups (indented, smaller, reading face). Zulip's lesson: a topic is a title you can scan |
| **Hacker News / Reddit comment trees** | indentation is hierarchy; collapse a whole subtree | tool calls are depth 2 under the answer, collapsed to one line `⌁ (sh "git log …") ⇒ 13 lines`; opened with RET or a click |
| **Medium / Substack / long-form reading (Butterick's *Practical Typography*)** | a 60–75 character measure; a serif for long reading; a clear type scale | the model's ANSWER is set in IBM Plex Serif at ~66ch with 1.68 leading; markdown is drawn (bold, lists, `code`, section labels), not printed. Asides (the model talking between tool calls) are smaller and quieter |
| **iOS / CSS sticky section headers** | the header of the section you are in stays on screen | **your question sticks to the top while you read its answer** (`14-…png`); scroll past it and the next question replaces it. You always know what an answer is answering |
| **Notion / docs outline; IDE minimap; scroll-spy** | a map of the document highlights where you are | **the question index** (right column): every thing you said, numbered, with the current one highlighted while you scroll. Click or `J/K` to jump. It is the outline of a task, built from your words |
| **ChatGPT / Claude.ai** | the composer is always at the bottom; the latest answer is in view | the composer is a fixed bar under the pane, addressed to the selected task (`say to t-1 ▸`, `new task ▸` when finished); `i` focuses it. Combined with spike `follow`: a new answer scrolls in only if you were at the end |
| **Linear / Things / Todoist** | sections with counts; empty sections disappear; triage by keys | rail groups are `NEEDS YOU · RUNNING · WAITING · FINISHED`, **only when non-empty**; the ask count is in the title bar; `y/n` answer the selected task's question without opening anything |
| **Gmail / Apple Mail snippets** | sender + subject + two lines of preview | a rail row is three lines: `t-1 · 1h` (mono, quiet), the goal **as words** (bold), two lines of the latest answer with markdown stripped (clamped, not cut mid-word) |
| **GitHub PR timeline** | events (commits, reviews, CI) interleaved with conversation, collapsible | the "N steps of work" block per thread is the timeline of what the model did. Effects (files written) go here as events too (FEAT-021 v1) |
| **Raycast / Spotlight / fzf** | type to filter, anywhere | `/` filters the rail live on id, goal and answer. Later: the same filter over turns ("which task touched README.md?") |
| **Emacs `follow-mode`, `which-key`; Genera's mouse-doc line** | the editor tells you what the keys do *here* | the title bar's key hints change with focus (rail / pane / composer), instead of a fixed hint line printed into the document |

## 3. The conversation, specified

**Type scale** (16px base):
- task title (your first words) 30px/650 sans
- your later questions 21px/600 sans, **sticky**
- answer 16.3px Plex Serif, leading 1.68, measure ≤ 46rem
- asides 14.4px sans, muted
- tools 13px mono, one line each
- labels 11.5px mono, uppercase, tracked

**Hierarchy by indentation and colour, never by boxes:**
- your words sit at the left margin
- the model's follow-ups hang 1.4rem in, behind a 2px rule
- a question waiting for you is the only filled block (rose)

**Reading what you said:** a handed-over task (`: #omega/task {:id "t-1" :goal "…"}`) reads as
`task t-1: 170724224`, not as edn. The mock found this on `t-5`.

**Motion:**
- `J/K` question to question; `space` pages; `g/G` start/end
- RET on a tool line opens it
- `c` on an open tool copies its cell to scratch (unchanged)

## 4. The overview as one screen, specified

```
┌ omega · 3 tasks · 3 need you ───────────── / filter ── j k task · J K question · i write · y n ┐
│ NEEDS YOU            3 │ t-1 · ◆ your turn · 1h                          │ 1 can you tell me… │
│ t-5                 1h │ can you tell me more about this repo?            │ 2 where did we stop │
│ task t-1: 170724224    │   2 STEPS OF WORK                                │                    │
│ I found little that…   │   ⌁ (ls ".") · (sh "git log…")      ⇒ 13 lines  │                    │
│▌t-1                 1h │   omega is a minimal coding-agent harness…       │                    │
│▌can you tell me more…  │ ── where did we stop then ────────── (sticky) ── │                    │
│ t-15               37m │   WHAT IS STILL OPEN                             │                    │
│ make me dream          │   1. UX-Q4: decide whether bin/bl-ed …           │                    │
├────────────────────────┴──────────────────────────────────────────────────┴────────────────────┤
│ say to t-1 ▸ [ i to write — Enter sends · Esc leaves                                         ] │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **The timeline is 0 screens away:** the selection is the open task.
- **Triage without leaving:** `y/n` answer the selected task's question; `x` cancels; after an
  action the selection moves to the next task that needs you (Superhuman).
- **Home cells** (where a task was started) are an attribute, not the RET target: the pane header
  carries `home: scratch` as a link (`gh` follows it).
- **Effects** are a tab of the pane, not another document (`e` switches the pane, `e` again back).
- **Bigger worlds** (100+ tasks): the rail virtualises; FINISHED collapses to its count with the
  last 5 shown; `/` searches everything.

Ideas worth trying next (not in the mock):
- **Activity river** (Twitter/Mastodon timeline): a third rail mode that interleaves every task's
  new turns by time, as "what happened while I was away". Each item is a follow-up line; `j/k` walks
  it; selecting one opens its thread at that point.
- **Swimlanes by home** (Kanban/Trello): columns per home document (scratch, a plan file, a repo);
  a task card moves as its state changes.
- **Peek** (macOS Quick Look, `space`): in any document, `space` on a reference row (`#omega/task`)
  shows its conversation in a popover without leaving.
- **Digest on return** (Slack's "catch up"): when you come back after N minutes, the title bar says
  `4 new answers · 1 question` and `J` walks exactly those.
- **Semantic zoom** (Pad++, Google Maps): the rail, the thread list and the full answer are three
  zoom levels of the same object; `z`/`Z` instead of three screens.

## 5. What this asks of the presentation pipeline (→ PLAN-004)

The mock is plain DOM on purpose: it answers "what should it look like" without being limited by
what bl-ed draws today. To get it inside bl-ed (one renderer, org underneath), the pipeline needs:

| need | pipeline piece | PLAN-004 wave |
|---|---|---|
| proportional prose (serif answers, sans questions) | `:flow` marks: the host lays out and measures; heights return as an event | W4 |
| sticky question headers | `:sticky` marks generalised: pinned to the TOP while their section is on screen (the composer is the bottom case, already built) | W9 |
| a type scale | a mark carries `:role` (`:title :question :answer :aside :tool :label`); the theme maps role → face/size; the grid becomes "rows of varying height", measured | W4 + W9 |
| the rail + pane screen | nested panes: the root presentation lays out `[rail pane index]`; the pane presents the selected task (a document) | W8 → W10 |
| selection drives the pane | a mode: `:on-event` sees the rail's object at the cursor change → loads `task:<id>` into the pane (one rev watch per pane) | W10 |
| question index / scroll-spy | chrome as presenters: the index is a presentation of the same object tree (threads), highlighted by the pane's top slot | W5 → W11 |
| triage keys on the rail | readtable `:keys` on `:omega/task` rows (already in the spike's model) | W1 |
| composer addressed to the selection | the spike's type-to-compose, with the target taken from the pane, not the cursor row | W12 |

**Caret and editing stay row-based inside code and org text**: the varying-height rows are
measured from the DOM, as `xOf` already does for columns. This is the only real risk. W4 must show
caret, selections and click-to-position staying exact over mixed-height rows before W9+ build on it.
