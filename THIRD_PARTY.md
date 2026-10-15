# Licensing and third-party material

Omega is Copyright (C) 2026 Othman Benkiran, distributed under the GNU General
Public License, version 3 or (at your option) any later version
(`GPL-3.0-or-later`). See [LICENSE](LICENSE). This is the default license for
author-owned code, experiments, documentation and assets throughout this
repository, including the author-owned vendored editor, native browser port and
Relay-derived usage module. Those components were relicensed by their copyright
holder for this distribution on 2026-10-15.

Third-party material retains its own copyright and license. The repository-wide
GPL declaration does not replace the notices listed below or grant rights to
externally sourced data, screenshots, artwork or samples.

| Material | Origin / revision | License and notices |
|---|---|---|
| `vendor/bl-ed/` | Beam Lisp `apps/bl-ed`, `55f0a2af`, plus recorded Omega changes | GPL-3.0-or-later for this owner-authorized distribution; see its `LICENSE` and `VENDOR.md`. Upstream was EPL-2.0. |
| `vendor/browser-port/` | Beam Lisp `optional/browser-port`, `4f38ef95` | GPL-3.0-or-later for this owner-authorized distribution; original EPL-2.0 text retained as `LICENSE.upstream`; see `VENDOR.md`. |
| `src/omega/llm/usage.bl` | `ora/relay`, `b00c467`, namespace adapted | GPL-3.0-or-later, owner-authorized; origin remains in the file header. |
| `research/vendor/impeccable/` | `pbakaus/impeccable`, `c74755d920985f7a92cef691ca970ba95f90126e` | Apache-2.0; retain `LICENSE`, `NOTICE.md` and its provenance README. |
| `spikes/pelagic/vendor/overtone/` | `overtone/overtone`, `eb531784b32737b90a44576b169934c3553d817d` | MIT for the project; retain `LICENSE` and contributor notices. The cheatsheet's `.tex` source explicitly declares EPL-1.0. Sample modules describe separately licensed downloads, including CC-BY and CC-BY-NC samples; the audio samples are not vendored. |
| `spikes/pelagic/vendor/shadertone/` | `overtone/shadertone`, `eac82509601621fa788550c6548409fdf845b965` | MIT, with LWJGL notices in `LICENSE`. Buddha textures are CC-BY-3.0 by Emil Persson, adapted by Roger Allen; retain `textures/buddha_readme.txt`. Example shaders retain their source attributions, including Shadertoy references. |
| Browser JavaScript dependencies | `spikes/browser/package-lock.json` | noVNC: MPL-2.0; Kernel SDK and Playwright: Apache-2.0; ws and esbuild: MIT. Preserve installed dependency notices when redistributing bundles. |
| Mobile JavaScript dependencies | `spikes/mobile/package-lock.json` | Playwright: Apache-2.0. |
| Native and Android dependencies | `vendor/browser-port/Cargo.lock`, `flake.lock`, `spikes/mobile/android/bl.lock` | Each dependency retains its upstream license. These lockfiles identify inputs; they are not replacement license notices. |
| Public research captures | Atlas API responses, design reference screenshots and other cited research | Source attribution is recorded alongside the captures. Public availability is not a GPL grant; retain attribution and check redistribution rights for any publication containing these materials. |

The Overtone/Shadertone top-level MIT declarations are not a claim that every
reference asset has that license. These research checkouts are retained in
place; they are not the JVM backend of PELAGIC. The shipped PELAGIC fragment is
original, as documented in `spikes/pelagic/research.bl.md`.

The Beam Lisp compiler/runtime is pinned by `env.bl` and fetched separately.
The optional Pi research clone is not tracked; its revision is documented in
`research/vendor/pi.lock.md`. Include the actual runtime/dependency notices and
matching source information when distributing compiled demos or Android APKs.
