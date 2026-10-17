# Native browser port, vendored

Source: beam-lisp `optional/browser-port`, branch `feat/native-browser-port-pr`,
commit `4f38ef95`. Contribution: https://github.com/timinou/beam-lisp/pull/1.
License in Omega: GNU GPL version 3 or later, relicensed by copyright holder
Othman Benkiran on 2026-10-15. `LICENSE` contains the GPL; `LICENSE.upstream`
preserves the original upstream EPL-2.0 text for provenance.

Cargo manifests, Rust source, optional Beam Lisp client under bl/, Nix flake/lock,
README and opt-in tests are copied unchanged. VENDOR.md and the license files are
packaging additions; Cargo.toml declares the GPL license for this distribution. Artifacts belong in spikes/browser/.native, not here.

The upstream package is outside both priv/ (core release source) and native/*
(automatic NIF build discovery). Cargo defaults build no executable and resolve
no browser dependencies. Applications explicitly add the client source path,
require browser.port, and package a helper built with native-browser plus their
chosen runtime. Namespace imports never spawn/download a browser.

Wayland is the default: headless Sway, wayvnc, Chromium Ozone Wayland, no Xwayland.
X11 requires the x11 Cargo feature and explicit displayBackend selection. Nix
runtime-wayland/runtime-x11 outputs are separate; there is no default package
and the development shell contains Rust tools only. No containers or NixOS are
required. BL_BROWSER_ENABLED=0 refuses new ports/launches before profile creation.

Omega's host owns the packet-4 process, adds the noVNC viewer, checks Origin and
per-browser capabilities, and gates input on the server. Native control handoff
keeps the viewer connected. BROWSER_BACKEND=off skips loading both providers.
Scenario-runner reuse remains in !tasks/follow-ups/native-browser-scenario-runner.org.
