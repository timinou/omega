# `bl:<ns>` — a namespace as the live image holds it

*Provider design. The protocol is in [`README.bl.md`](README.bl.md). Item: FEAT-020. Sources:*
- *`checkpoints-and-the-live-image.bl.md`;*
- *`spikes/live-image.bl.md`;*
- *beam-lisp `priv/std/reload.bl` (`namespaces`, `drift`, `journal`, `inspect`), present on main
  and on omega's pin.*

## 1. Purpose

The question a Lisp machine always answers: *what is this image running, right now, and is it
what the files say?*
- `bl:` shows a namespace as live vars, each with its state against its source.
- `bl:` alone lists every application namespace.

It is the human side of the checkpoint doc's Situation B (beam-lisp projects): drift, reload and
the `:image` part.

## 2. What it looks like

```org
#+TITLE: bl:shop.cart · 14 vars · drift: tree (1 ns) · image started 09:12
source: src/shop/cart.bl · reload: manual · last commit 10:41 :applied

* vars
- add-item       ✓ matches source
- total          ✎ source changed after the image read it  (r reload this ns)
- discount       ⚠ live only: defined by eval at 10:52, not in the file  (w write back · x undefine)
- cart-server    ● defserver · running · state kept across 2 reloads

* journal
- 10:41 :applied shop.cart, shop.price
- 10:30 :held shop.cart — dangling ref shop.price/round-to
```

| row | type | keys |
|---|---|---|
| a var | `:bl/var` | `RET` visits the source file at the definition · `C-Enter` evaluates a form against it in the ns (drift recorded) · `w` writes a live-only var back to the file · `x` undefines it |
| the title | `:bl/ns` | `r` reload through `reload/commit` (its coherence gate) · `RET` visits the file |
| `bl:` rows | `:bl/ns` | `RET` visits `bl:<ns>` |

## 3. Data, and what each piece costs

| field | source | exists? |
|---|---|---|
| namespaces and their vars | `reload/namespaces` | ✓ main and pin |
| drift class (`:none` / `:tree` / `:toolchain`), per namespace | `reload/drift` (stat first; the closure hash only on candidates) | ✓ |
| commit history (`:applied` / `:held` + why) | `reload/journal` | ✓ |
| **per-var** "matches / changed / live-only" | hashes of each var's position-stripped reader form, against the file's forms (live-image spike finding 1); live-only = `Env/own_names` minus the file's defs (finding 2) | spike-proven; a ~40-line fn to write |
| a defserver's run state | the registry (`proc.reg`) | ✓ |

The per-var hash is the **only new code**. It is the same function as the checkpoint doc's
`:image` part, so the provider and FEAT-005 share it rather than each owning one.

## 4. Where it runs

| image | host |
|---|---|
| bl-ed's own VM (main) | `serve.bl`'s local provider table entry. Useful at once for hacking bl-ed and beam-lisp |
| a beam-lisp project's target VM (CP-Q1 (ii)) | `{:forward <target VM's provider URL>}`. The same provider code runs in the target, and realm's member route carries it |
| omega's own world (the pin) | the bridge. Lets you inspect omega while it runs |

**The provider code is one namespace with no omega dependency**
(`bl-ed.providers.bl` in `vendor/bl-ed`), so it runs in any of the three.

## 5. Provider

| op | does |
|---|---|
| `:read` | the §3 data → pure `render-ns` / `render-index` |
| `:rev` | the max of the source files' mtimes, the journal length and the `own_names` count: three cheap reads, no hashing. Hashes run only in `:read` |
| `:eval` | `C-Enter` on a var row: eval in the ns, then record a drift fact (checkpoint doc: `:source :eval`). On bl-ed's VM, an ordinary eval plus a recorded entry |
| actions | `r` → `reload/commit` (its gate decides, and the journal shows `:held` with the reason) · `w` → write the live form's source back into the file at the var's position, or append it · `x` → `undefine_var` |

## 6. Efficiency

- `drift` is stat-first by design: settled files cost a `stat`, and only candidates are hashed.
- Per-var hashing reads the source file once per `:read`, not once per var.
- **Measured** (live-image spike): whole-namespace eval is superlinear (4.2 s at 100 fns). So `r`
  is the only action that evaluates a whole namespace. `C-Enter` and `x` touch one var each
  (25–200 ms).

## 7. Acceptance

- `bl:` lists bl-ed's own namespaces when served by main.
- Editing `ed/motion.bl` on disk makes `bl:ed.motion` show `✎` on the changed var within one rev.
- An eval of a new fn into a namespace shows `⚠ live only`; `w` writes it into the file; the next
  rev shows `✓`.
- `r` on a namespace with a dangling reference shows `:held` with the reason, and the image is
  unchanged.
