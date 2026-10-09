# Wayland / release boundary review

The current proof uses private headless Sway + wayvnc and native Wayland Chromium.
Xwayland is disabled. The primary real.json and editor.json describe that path;
x11/ contains the explicit compatibility run. The original X11-only proof was
superseded after the requested platform review.

Local performance samples under concurrent host load:

| Operation | Duration | Scope |
| --- | ---: | --- |
| Wayland browser startup | 3,102 ms | helper launch through usable CDP connection |
| Wayland input | 519 ms | click, physically type 12 characters, verify through CDP |
| Editor handoff | 644 ms | control click through rendered agent state; same iframe document |
| X11 startup | 5,870 ms | explicit compatibility run |
| X11 input | 1,049 ms | same synthetic phrase verification |

These are individual samples, not a statistically controlled comparison, p95
latencies or production SLAs. The streamed desktop is damage-driven at up to
30 fps. Native handoff no longer destroys/reconnects the viewer. Hidden panes
detach it. The off-host test uses an import-denying loader to prove neither
Playwright/native nor the cloud SDK/provider is loaded.

Release boundary: upstream moved the feature to optional/browser-port, outside
priv/ and the automatic native/* crate scan. Default Cargo features are empty,
all native dependencies optional, and the binary requires native-browser.
packaging-tests.txt proves a default Cargo build resolves no dependencies and
creates no executable; off.test.mjs additionally checks disabled launch without
profile creation and refusal of X11 in the Wayland-only build. Both Rust feature
configurations pass (4 Wayland-only checks; 3 with explicit X11 compatibility).
BEAM-port tests pass 10 assertions including the runtime off gate. The Node
suite passes 46 tests with no skips using the Wayland-only vendored helper.

Full production release construction was not repeated. The regression gate
checks the actual build/release input boundaries, and the release packer was
reviewed: core release copies ebin/priv, while native discovery scans native/*.
Applications must explicitly add the optional BL source path, import browser.port,
and package their helper/runtime. An import never starts/downloads Chromium.
