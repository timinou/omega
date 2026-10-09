# Native browser port, vendored

Source: beam-lisp, branch `feat/native-browser-port-pr`, commit
`b4d2dbfb` (native/browser_port and priv/lib/browser/port.bl).
The source checkout commits are 51fff8a7, 9fe38795, d13c4f80 and 88127970;
the publication branch contains only these changes on upstream origin/main.
License: Eclipse Public License 2.0, copied as LICENSE.

Cargo manifests, Rust source, Nix flake/lock, README and opt-in tests are copied
unchanged from native/browser_port. The Beam Lisp client is copied unchanged
from priv/lib/browser/port.bl to bl/browser/port.bl. VENDOR.md and the license
copy are packaging additions. Build artifacts belong in spikes/browser/.native,
not in this directory. Upstream's runtime flake pins Chromium/Xvfb/x11vnc;
Docker, Podman and NixOS are not requirements.

Omega's Node browser host owns this executable through port.mjs and adds the
local noVNC bridge, capability/origin checks and server-side input gating.
The upstream BEAM client talks to the same packet-4 protocol; it is not a NIF.
Scenario-runner reuse is tracked in !tasks/follow-ups/native-browser-scenario-runner.org.
