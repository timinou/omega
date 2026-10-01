Title: The missing design vocabulary for agents.

URL Source: https://impeccable.style/changelog

Markdown Content:
## Changelog

New possibilities. Thoughtful refinements. All in one place.

Update your skill

## Transparent assets. Faster comps.

Featured release[v4.3.0](https://impeccable.style/changelog#v4.3.0)September 8, 2026

Artwork that belongs on your page. Generate illustrations and objects with transparent backgrounds, ready for your own colors and textures.

![Image 1: The same transparent camellias on a dark background, showing fine petal and leaf edges.](https://impeccable.style/assets/changelog/botanical.png)One image. Your background.

Actual GPT Image 2.5 output. Switch backgrounds to inspect the edges.

66 releases

Skill[v4.4.0](https://impeccable.style/changelog#v4.4.0)September 25, 2026

### You approve the parts before the page.

When a build starts from an approved comp, Impeccable now stops and shows you every component before it assembles the page. You decide what ships.

*   **Review the component kit in your browser.** Each illustration, photo and rendered component sits next to its crop of the comp. Approve it, or say what needs fixing and the agent repairs it for the next round. Repeated pieces, like a row of cards, are reviewed together. Approvals carry over between rounds, and a component whose files change is reviewed again.
*   **Then check the first screen.** Once the page is assembled, you review the first viewport against the comp. Accepting it closes review for that build; the agent finishes the rest in the same direction. When nobody is at the keyboard, the review waits for you instead of approving itself.
*   **Variants on request.** The new `/impeccable generate` command takes one sentence, like “generate 3 bold variants of the pricing cards”, finds the element on your open page and has the variants cycling in your browser within about a minute. Accept one and it becomes source code.
*   **Findings you can trust.** Line length, padding and three other rendered checks now measure the lines and boxes the browser actually draws, and each finding names the screen width it fired at. Pale placeholder text is caught. Colors defined in your `DESIGN.md` are no longer flagged as a generic AI palette, and Tailwind spinners no longer count as accent borders.
*   **Touch gets tested by touch.**`adapt`, `audit` and `harden` now exercise each control’s primary gesture instead of accepting a resized screenshot as proof.
*   **No false update notices.** Current installs stop reporting that an update is available.

Skill[v4.3.1](https://impeccable.style/changelog#v4.3.1)September 8, 2026

### Clearer setup failures.

When first-run setup is blocked, Impeccable now explains what failed and how to recover.

*   **Useful errors instead of silent exits.** Blocked cache writes and failed engine downloads now identify the required engine version, cache location, and recovery steps. Automatic first-use downloads and reuse of the cached engine are preserved.
*   **Windows setup stops cleanly.** Unwritable download locations report an error instead of leaving the launcher waiting for input.

Skill[v4.3.0](https://impeccable.style/changelog#v4.3.0)September 8, 2026

### Transparent assets. Faster comps.

Generate assets with transparent backgrounds, and spend less time waiting for your next design comp.

*   **Artwork that fits your page.** Generate illustrations and objects with transparent backgrounds, ready to place over your own colors and textures. Photos and full-frame artwork keep their backgrounds.![Image 2: The same transparent camellias on a dark background, showing fine petal and leaf edges.](https://impeccable.style/assets/changelog/botanical.png)On paper

![Image 3: The same transparent camellias on a dark background, showing fine petal and leaf edges.](https://impeccable.style/assets/changelog/botanical.png)On ink 

One transparent PNG, two backgrounds. White petals and the gaps between leaves stay intact. [Open the original image](https://impeccable.style/assets/changelog/botanical.png)

*   **Faster generation and reference edits.** GPT Image 2.5 Flare now powers generation when Impeccable uses your OpenAI key. Your agent’s native image tool remains the first choice.
*   **More iterations, less waiting.** In our 24-image comparison, median generation time fell from 88 seconds to 18, with approximately 73% lower estimated cost. Results vary by prompt.
*   **Cleaner cutout edges.** Asset production checks white details, fine edges and gaps on light and dark backgrounds, then refines visible problems. Comp comparisons also account for the background behind transparent images.

Skill[v4.2.3](https://impeccable.style/changelog#v4.2.3)September 8, 2026

### Design hooks that understand your project.

Design checks follow the app you’re working in. Windows updates are more reliable, and GitHub Copilot gets a Marketplace install.

*   **Each app keeps its own design rules.** In a repository with multiple apps, design checks use the current app’s `DESIGN.md`, falling back to the repository’s rules when needed. A sibling app’s rules no longer leak into your work. Thanks to @tylerjryan for the report and proposed approach.**Storefront**`apps/store/DESIGN.md`Rules for the storefront

**Dashboard**`apps/admin/DESIGN.md`Rules for the dashboard 

Example: two apps in one repository. Each uses its own design rules; the root `DESIGN.md` is the fallback.

*   **Know which findings came from your edit.** End-of-task checks distinguish new design issues from existing ones when a reliable before-edit snapshot is available. If the comparison is uncertain, the report says so.
*   **Smoother Windows and workplace setups.** Updates can ask for confirmation normally, live mode finds page security policies more reliably, and network requests accept certificates installed by your organization.
*   **A clearer path when commands are blocked.** If the launcher cannot run, the agent uses readable guidance and tells you which checks it could not perform. Separate surfaces also keep their own briefs when long folder names share a prefix.
*   **Design decisions survive the handoff.** New designs and approved system changes save both the design guidance and its machine-readable tokens. Small additions preserve the existing design system.
*   **Install from the VS Code Marketplace.** GitHub Copilot users can install the [Impeccable skill extension](https://marketplace.visualstudio.com/items?itemName=renaissance-geek.impeccable) without copying files. This installs the skill; automatic design hooks remain a separate setup.

CLI[v4.1.0](https://impeccable.style/changelog#cli-v4.1.0)September 8, 2026

### Image generation gets native transparency.

Generate transparent assets from the command line, with GPT Image 2.5 Flare as the default model.

*   **Choose the background you need.**`generate-image` accepts `--background transparent`, `opaque` or `auto` for new images and reference edits. Use `--model` to choose a different supported model.`npx impeccable generate-image --prompt "A botanical illustration" --background transparent --out botanical.png` 
*   **Keep the image and its generation settings together.** Generated PNGs retain their transparency when the prompt is embedded. Background settings are recorded with the image, and invalid output paths are caught before generation starts.
*   **Install paths can contain spaces.** Comp workflows now handle quoted launcher paths correctly, including commands that start with `npx impeccable`.

CLI[v4.0.5](https://impeccable.style/changelog#cli-v4.0.5)September 8, 2026

### Windows updates and managed certificates.

Windows updates can ask for confirmation again, and HTTPS requests work with your organization’s installed certificates.

*   **Update from a Windows terminal.** Confirmation prompts now work without raw terminal mode. You still decide whether to accept the update.
*   **Use your organization’s trusted certificates.** HTTPS requests honor the operating system’s certificate store while keeping certificate verification enabled.
*   **More reliable checks in complex projects.** Live mode recognizes Windows page-policy paths, and design checks use each app’s own rules in multi-app repositories. End-of-task reports separate new findings from existing ones when a reliable comparison is available.

Skill[v4.2.2](https://impeccable.style/changelog#v4.2.2)September 6, 2026

### A new home in DeepSeek Harness.

Use Impeccable in DeepSeek Harness, with a lighter design picker and clearer guidance when a command cannot run.

*   **DeepSeek Harness is supported.** Install the skill for one project or globally. Project installs use `.dsh/skills`. Thanks to @sheecegardezi for the contribution.
*   **A picker with fewer dependencies.** The design picker uses local system fonts and a built-in logo, so it no longer requests external fonts. It also adopts a light theme.
*   **Blocked commands get an honest fallback.** When the engine cannot run, the agent uses readable guidance and identifies the checks it could not complete. Claude plugin installs also locate the launcher reliably.

CLI[v4.0.4](https://impeccable.style/changelog#cli-v4.0.4)September 6, 2026

### DeepSeek Harness, from the command line.

Install Impeccable in DeepSeek Harness and use the lighter design picker.

*   **Install for DeepSeek Harness.** Choose `--providers=dsh` for a project or global install. Custom `DSH_HOME` locations and Windows paths are supported.
*   **No external font requests in the picker.** System fonts and a built-in logo keep the light-themed picker self-contained.

Skill[v4.2.1](https://impeccable.style/changelog#v4.2.1)September 5, 2026

### Signed downloads. Smoother starts.

Signed Windows downloads and a more reliable start in Claude Code.

*   **Signed Windows engines.** New installs download an engine signed by Renaissance Geek, Inc. A timestamped signature identifies the publisher and lets Windows verify the file. It does not guarantee acceptance by every antivirus product.
*   **Useful errors when a download goes wrong.** Download failures distinguish missing or removed files from checksum mismatches, including cases where antivirus removes a file from the cache.
*   **Impeccable is easier for Claude to discover.** Non-interactive Claude sessions can find the skill, command entry points are clearer, and advice-only requests stay read-only.

CLI[v4.0.3](https://impeccable.style/changelog#cli-v4.0.3)September 5, 2026

### Signed Windows engines, ready to install.

The CLI now installs the signed Windows engine.

*   **Verify the Windows engine’s publisher.** Downloads use the engine signed by Renaissance Geek, Inc., matching the skill’s Windows distribution.

Skill[v4.2.0](https://impeccable.style/changelog#v4.2.0)September 4, 2026

### One engine. Everywhere you work.

One self-contained engine replaces the Node runtime. Design checks start faster and follow the same rules across your tools.

*   **No Node setup for the skill.** The skill’s launcher finds or downloads one native engine for your platform. Windows includes its own launcher, so it does not need a Unix shell. The npm CLI remains an optional way to install and run Impeccable.
*   **Less waiting after each edit.** On the same corpus and machine, the design hook ran in 10.6 ms instead of 46.9 ms. A scan of 110 files took 132 ms instead of 282 ms. URL scans still spend most of their time starting a browser.
*   **Consistent checks wherever you work.** The CLI, browser extension and live overlay share the same rule engine. A rule fix reaches every surface, and the engine is open source under Apache-2.0.
*   **Live previews finish loading reliably.** When several variants arrive together, the loading state now clears as soon as they mount. Discarding a session also restores every affected wrapper.

CLI[v4.0.2](https://impeccable.style/changelog#cli-v4.0.2)September 4, 2026

### Verify the download before it installs.

Skill downloads are verified before extraction.

*   **Signed installs and updates.** The CLI checks each downloaded skill bundle against a trusted release-signing key before extracting it. Missing signatures or altered downloads stop the operation without replacing installed skills.

CLI[v4.0.1](https://impeccable.style/changelog#cli-v4.0.1)September 4, 2026

### --version reports the package version.

--version reports the package version. npx impeccable --version printed the engine's baked-in 3.6.0 after the 4.0.0 release; the shim now answers --version and -v itself from its own package.json, without locating or downloading a binary.

*   **`--version` reports the package version.**`npx impeccable --version` printed the engine's baked-in 3.6.0 after the 4.0.0 release; the shim now answers `--version` and `-v` itself from its own package.json, without locating or downloading a binary.

CLI[v4.0.0](https://impeccable.style/changelog#cli-v4.0.0)September 4, 2026

### npx impeccable runs the binary.

The npm package becomes a thin shim over the Rust engine.

*   **`npx impeccable` runs the binary.** The package resolves a platform package (`@impeccable/cli-<os>-<arch>`) installed as an optional dependency, then the user cache, then a checksum-verified download of the pinned engine release. A download without a verifiable checksum is refused rather than run.
*   **The JavaScript detector API is gone.** The package no longer exports a `detect` function; the same rules are available as a WebAssembly module for hosts that cannot run the binary. Every documented command (`detect`, `ignores`, `install`, `update`, `check`, `link`) keeps its name, flags, and output.

Extension[v1.4.0](https://impeccable.style/changelog#ext-v1.4.0)September 4, 2026

### One rule engine, now in your browser.

Run design checks on pages with strict security policies, using the same rules as the CLI and live mode.

*   **Check pages that previously blocked the detector.** The extension evaluates a snapshot of the page in its own offscreen document. The page’s Content Security Policy no longer determines whether checks can run.
*   **The same rules across your tools.** The extension shares the rule engine used by the CLI and live mode.
*   **A new permission, explained.** Chrome’s `offscreen` permission enables those checks. It does not expand which pages the extension can access.

Skill[v4.1.3](https://impeccable.style/changelog#v4.1.3)September 1, 2026

### A closer match from comp to code.

The comp-to-code handoff gets measurable gates, while installs and live workflows get much harder to break.

*   **Comps become executable contracts.** New phase gates measure structure, typography, material, assets, and responsive fidelity before a build can claim the approved direction is shipped.
*   **Harness installs line up.** Codex reads spec-compliant version metadata, OpenCode gets its slash-command bridge, Veto installs natively, Hermes is documented, and scripts resolve correctly through symlinks, plugin roots, and paths with spaces.
*   **Live mode survives framework churn.** HMR cleanup races no longer tear down active work, encoded script responses stay intact, and the fallback path can never inject raw JSX into a page.
*   **Direction work stays grounded.** Incumbent evidence is explicit, the winning direction absorbs the best rival ideas, PRODUCT.md keeps its schema, and internal direction contracts stay out of production output.
*   **Detection gets quieter and truer.** Flat type hierarchies, Roboto inside system stacks, and radius variables stop producing false alarms, while live waivers and ignore scopes apply to the surfaces that actually earned them.
*   **Cleanup means cleanup.** Hook reset removes installed manifest entries, critique snapshots close reliably, and review artifacts stay out of source-control suggestions.

CLI[v3.6.1](https://impeccable.style/changelog#cli-v3.6.1)September 1, 2026

### Bundle downloads follow the whole redirect chain.

Install and update work again against the production download chain.

*   **Bundle downloads follow the whole redirect chain.** Both `install` and `update` now follow bounded HTTPS redirects to whichever GitHub asset host serves the release, validate the final response, and clean up partial files instead of passing an empty redirect body to the ZIP reader.

Skill[v4.1.2](https://impeccable.style/changelog#v4.1.2)August 26, 2026

### Better context for bigger projects.

Monorepo-aware setup, sturdier installs, and a quieter detector.

*   **Monorepos find the right DESIGN.md.** Nested packages own their surfaces, explicit project roots win over guessing, and parent design systems apply only where they belong.
*   **Hooks and installs repair cleanly.** Grok Build, Claude subagents, Codex blocking, home-scoped updates, and Windows migration all recover without stale or duplicated state.
*   **The detector loses more false alarms.** Dashed rules, comments, oklch colors, color-mix values, and root-relative stylesheets are parsed in their real context.
*   **Live and comp flows hold their ground.** Preview serving closes traversal and input-trust gaps, re-rolls no longer hang, Windows setup output drains fully, and ground-color drift is caught across palettes.

Skill[v4.1.1](https://impeccable.style/changelog#v4.1.1)August 14, 2026

### A more discerning finish review.

Stricter quality control at the finish review.

*   **The review no longer passes on bad screenshots.** Broken or missing captures get retaken and the review runs again on real evidence.
*   **Pushing back works.** Show a finished build a screenshot of what looks wrong and the whole review reruns against it.
*   **No more fake cutouts.** Circle masks pretending a photo was cut out are refused in favor of real cut-out assets.

Skill[v4.1.0](https://impeccable.style/changelog#v4.1.0)August 14, 2026

### A better way to choose a direction.

Choosing a direction stopped being a menu and became a design review: the roll argues with itself in front of you, and what it shows you are pages you could ship rather than mood boards. Native apps got a verification pipeline that stops pretending they are websites, Windows works, and the build path is finally yours to set.

Choosing a direction

*   **The roll argues with itself, in front of you.** Every dealt world now carries a verdict, and the direction you are handed has already taken what the losing worlds did better. You choose from a hand that has been fought over.
*   **What you approve looks like a page.** Full-fidelity comps replaced the old sketches, which came back too rough to decide from. Generation costs the same at any fidelity, so the draft quality was buying nothing.
*   **Steer the next hand instead of re-rolling blind.** Safer and bolder aim the roll along the familiar-to-bold axis, and IMPECCABLE'S PICK shows the model's own favourite when the dice chose otherwise.
*   **The deck reads as a gradient of standing.** Contenders, then the category standard, then the demoted row last. Stacked raise callouts became a compact cycler, so the assigned card stopped towering over its neighbours.
*   **Adding a page keeps the world you already have.** Once identity is settled, cards differ in composition rather than character, and each comp anchors on a screenshot of a page you already shipped.
*   **The board still works with no image generation.** A text-only card keeps its full read on the front, and art that fails to load collapses to a field painted from the card's own palette instead of a dark void.

Native apps stop being treated as websites

*   **Verification knows what platform it is on.** The comp side of the system was platform-aware while everything that checked the work assumed a browser. The verify-and-review pipeline now has a native leg, so an iOS or Android build is reviewed as an app.
*   **Polish gathers native evidence.** Its classify, triage, and verify steps map per platform instead of asking for browser evidence that a native app cannot produce.
*   **The detector stops contradicting itself.** Web-only checks no longer fire against native surfaces they were never written for.

The build path

*   **Comp-first or code-first is your call now.** Comp-first buys bolder composition for time; code-first is leaner and writes the ambition into the contract instead. `init` asks once, with the trade stated.
*   **Change your mind mid-round.** Every board carries the toggle: flip it and the open cards start generating comps without closing the round, flip back and anything already rendered stays.
*   **Existing projects never re-run setup.** On a project that has recorded nothing, the first flip asks whether to keep it. One machine can differ from the team in `.impeccable/config.local.json`.

It runs where you run it

*   **Windows works.** Installs no longer trip the POSIX hook guard, the runtime probe survives `cmd.exe` metacharacters, the decision page opens in your browser, and a successful roll stops aborting on the way out.
*   **Plugin subagents actually load.** Marketplace installs shipped four subagents that Claude Code silently never loaded, because the generated manifest carried a key that suppressed them.
*   **Two more harnesses.** Hermes Agent and Google Antigravity install and run natively, and pinned skills read correctly on Codex.

Fixed

*   **Critique tells you what it found.** The report is spoken to you rather than written into a file you never open, and the closing question comes last instead of swallowing the report.
*   **Live mode reaches the dev hosts it used to refuse.** ddev, Valet, and any named host authorize by session token.
*   **Svelte variants render again.** A printer upstream had been turning the type annotation in every generated variant into invalid JavaScript, so nothing mounted.
*   **The design hook stopped nagging.** Agents record confident ignores themselves, waivers scope to the element that earned them, and files outside your project are left alone.
*   **Copy edits survive the trip.** Live mode's copy-edit prompt is bounded so long pages stop overflowing it, and the Claude transport delivers what it was given.
*   **Motion guidance is back.** Reduced-motion direction returned to the animation reference after going missing, and DESIGN.md's Layout and Shapes sections parse again.

CLI[v3.6.0](https://impeccable.style/changelog#cli-v3.6.0)August 14, 2026

### Contrast findings stop assuming white.

The detector stops assuming white when it cannot read a background, waivers get a scope, and two more harnesses install natively.

*   **Contrast findings stop assuming white.** Text over a gradient, over an image, or under something else was scored against an assumed white ground, which manufactured low-contrast findings on perfectly legible pages. The engine now measures the real gradient body ground, accounts for image-backed text and for elements occluded by what sits above them, and declines to guess at all when a background genuinely cannot be read.
*   **Waivers you can scope.**`data-impeccable-ignore` silences the element that carries it rather than a whole rule across the file, and `ignore-file` honors the scope flags you pass it.
*   **Two more providers.** Hermes Agent and Google Antigravity install like the rest.
*   **Fewer false positives elsewhere.** Quoted transition values in JSX no longer read as layout transitions, documented sidecar shadow colors are allowed inside shadow contexts, and broken-image findings stop firing on commented-out source.
*   **Installs and scans that behave.** Explicitly selected providers install without `--force`, the post-install next step points at your agent chat instead of the terminal, Windows installs skip the POSIX hook guard, Blade files turn up in directory scans, and a missing static-HTML parser dependency warns instead of quietly scanning nothing.
*   **Paths with quotes or spaces stop breaking commands.** Four places built shell commands by wrapping values in double quotes, which is not shell quoting. They now quote properly.
*   **DESIGN.md frontmatter reads correctly.** Quote escapes in YAML scalars are unescaped, so a design system carrying quoted values parses instead of losing them.

Extension[v1.3.2](https://impeccable.style/changelog#ext-v1.3.2)August 14, 2026

### The quieter detector, in your browser.

The quieter detector, in your browser. Ships the engine that measures real gradient and image-backed grounds instead of assuming white, accounts for elements hidden behind what sits above them, and stops flagging quoted JSX transition values and documented shadow tokens. The same 59 rules, with materially fewer false positives. Chrome and Firefox.

*   **The quieter detector, in your browser.** Ships the engine that measures real gradient and image-backed grounds instead of assuming white, accounts for elements hidden behind what sits above them, and stops flagging quoted JSX transition values and documented shadow tokens. The same 59 rules, with materially fewer false positives. Chrome and Firefox.

Skill[v4.0.4](https://impeccable.style/changelog#v4.0.4)July 29, 2026

### The finish review grew a spine.

A week of adversarial evaluation rebuilt the weakest stretch of the pipeline: the road from an approved comp to a shipped page.

The finish

*   **The finish review grew a spine.** It opens with a derived verdict, rebuild, fix, or ship, computed from its fidelity matrix rather than felt, and the build thread must report that word verbatim.
*   **It reviews the page, not the claims.** The reviewer spawns fresh rather than inheriting the build thread's optimism, scores recaptured screenshots only, and re-reads the craft floor so a banned element is a finding even when the comp contains nothing like it.
*   **The comp survives translation.** A photographic hero used to be written down as "silhouette in SVG". The implementation inventory now gates on medium: figures, objects, and lit material are raster whatever the stack, while geometry and motion stay vector.
*   **Three more refusals on the craft floor.** A system display face as a page's display voice, unicode glyphs standing in for an icon system, and hard offset shadows outside a world that is actually neobrutalist.

Comps and approval

*   **Comps are pages, not vignettes.** Prompts lead with the surface's real structure, so the model designs the fish market's website instead of painting the fish market.
*   **The prompt travels with the asset.** Generated images carry their own prompt in metadata, so an image moved between machines can still say what it is and why it exists.
*   **Approval is part of the record.** The chosen comp's sidecar carries `approved: true`, so the pick survives sessions and machines. A build with comps and no recorded pick is a material finding.
*   **The surface owns its aspect.** Native and mobile-first surfaces comp portrait at device viewport, desktop web comps landscape, and the decision board adapts to either.

The roll

*   **The direction can no longer be silently lost.** Some build tools strip a component's leading comment, taking the contract with it. It now lives as the first child of the root layout's body, and the built output is checked for the seed key.
*   **Compositions leave the deal, for now.** The surface roll still assigns which of your structures gets built, but the composition challengers are withdrawn until their catalog grows real axes.
*   **Sharper dice.** Staging deals honour approval ratings the way world challengers do, so small per-surface pools stop repeating their weakest option.

Setup and harnesses

*   **Native subagents on GitHub Copilot and Cursor.** All four shipped roles emit in each harness's own custom-agent format from one source, with the reviewer correctly read-only on Cursor.
*   **The stack is your decision.** On a greenfield project, `init` asks once: plain HTML/CSS, a named framework, or delegated, recorded in PRODUCT.md so later work can prove the choice was offered.
*   **The decision board survives sandboxes.** A sandboxed session's permission error used to read as the server dying, which read as you closing the board. Liveness now leads with the page's own heartbeat.

CLI[v3.5.0](https://impeccable.style/changelog#cli-v3.5.0)July 29, 2026

### Documentation stops flagging itself.

The detector learns the difference between CSS and writing about CSS, stops going blind on versioned stylesheets, retires a rule that punished good typography, and the installer places the new native agents.

*   **Documentation stops flagging itself.** Fifteen page-level checks used to scan raw source, so prose about CSS, code samples, and comments could trip rules like gradient-text on sites that write about design. Each check is now scoped to what it actually means: real style carriers, class attributes, or rendered text. A changelog documenting a detector rule no longer triggers it, in the CLI and the browser paths both.
*   **Versioned stylesheets no longer blind the scan.** A page linking `styles.css?v=3` resolved the query string as part of the file path, so the lookup failed silently and every element-level check ran against unstyled markup: one finding on a page that carries eighteen. Stylesheet hrefs now strip query and hash before resolving.
*   **The kicker net catches standard tracking.** The most common authored kicker, uppercase at 12px with 0.08em letter-spacing, computes to a fraction under the rule's old 1px tracking floor and slipped through. The floor is now proportional to font size, and the exact shape that escaped is pinned in the fixture suite.
*   **Retired: `single-font`.** One family with weight and size contrast carrying the hierarchy is a legitimate type system, and in practice the rule mostly flagged pages that were doing exactly that. Configs that ignore it will surface as stale via `doctor`.
*   **Installs place the Copilot and Cursor agents.** Project installs write `.github/agents/` and `.cursor/agents/`; user-level installs go to `~/.copilot/agents/` and `~/.cursor/agents/`, with a warning where Copilot's user-level copies would shadow a project's newer ones.

Extension[v1.3.1](https://impeccable.style/changelog#ext-v1.3.1)July 29, 2026

### The detector sees whole pages again.

The detector sees whole pages again. Ships the engine that resolves versioned stylesheet links (styles.css?v=3) instead of going blind on them, catches standard-tracked kickers that slipped under the old 1px tracking floor, and retires the single-font rule.

*   **The detector sees whole pages again.** Ships the engine that resolves versioned stylesheet links (`styles.css?v=3`) instead of going blind on them, catches standard-tracked kickers that slipped under the old 1px tracking floor, and retires the `single-font` rule.

Skill[v4.0.3](https://impeccable.style/changelog#v4.0.3)July 27, 2026

### The decision page grew up.

A weekend of live runs, transcript against transcript. The direction choice became a real design surface, and the finish ends on a verdict.

*   **The decision page grew up.** Every direction card shares one anatomy: thesis, palette, materials, first viewport, honest risk, with the longer read behind a Details flip.
*   **Sketches stream in while you read.** The page serves instantly and each card's sketch lands as it finishes, rendered through one deliberately unfinished shared frame.
*   **A sketch cannot invent facts.** Only the product name and one real headline are legible; every other text region is greeked, so no sketch invents specs, prices, or dates.
*   **Catalog inspirations stay labeled.** They ride picture-in-picture as inspiration and take over the frame on hover, rather than posing as your future design.
*   **The finish ends on a verdict.** Every fix is scored resolved, partial, or unresolved against a same-viewport recapture. Open items earn one more round, and the final table reaches you as it stands.
*   **The review got eyes for style.** Display lettering of a different character fails however well the layout matches, and flat CSS standing in for painted artwork fails regardless of placement.
*   **Kickers are banned.** The eyebrow label above a heading leaves the craft floor entirely. The heading carries its own weight.
*   **DESIGN.md is written from the built page.** A dedicated documenter subagent records what shipped rather than what was intended.
*   **Sturdier machinery.** The concept roll survives output truncation and comment-stripping build pipelines, catalog challengers carry a breadth axis, and a failed decision-page start says why.

CLI[v3.4.0](https://impeccable.style/changelog#cli-v3.4.0)July 27, 2026

### Kickers are banned.

The kicker ban lands in the detector, a new glow rule, and scans that skip what they should.

*   **Kickers are banned.** New `kicker-above-heading` rule flags the first eyebrow label above any heading, replacing the old advisory that waited for three repeats. Breadcrumbs, datelines, card metadata, form labels, and document numbering all stay exempt.
*   **New rule: `radial-spotlight-glow`.** The soft chromatic glow fading to transparent behind content, a favorite AI default, is now a named finding, distinct from the existing halo rule.
*   **Stripes hiding in stylesheets.** Pseudo-element stripe patterns are now caught in standalone CSS files and style blocks, not just inline styles, and findings carry their source lines.
*   **Scans skip what they should.** Hidden directories and vendored paths are out of the walk, while conventional UI source dirs like `.vuepress` stay in; scans get faster and quieter at once.
*   **Fewer false positives.** Forms whose `id` shadows the DOM API no longer crash element checks, `background-clip: text` gradients stop tripping contrast, and non-rendered text is excluded from tiny-text findings.
*   **OpenCode installs land where OpenCode looks.** Global skill installs write to the config directory OpenCode actually reads, with the legacy location migrated safely.

Extension[v1.3.0](https://impeccable.style/changelog#ext-v1.3.0)July 27, 2026

### The updated detector, in your browser.

The updated detector, in your browser. The extension ships the current rule engine: the new kicker-above-heading ban, the radial-spotlight-glow rule, stylesheet stripe scanning, and the latest false-positive hardening for shadowed form ids, clipped-text gradients, and non-rendered text.

*   **The updated detector, in your browser.** The extension ships the current rule engine: the new `kicker-above-heading` ban, the `radial-spotlight-glow` rule, stylesheet stripe scanning, and the latest false-positive hardening for shadowed form ids, clipped-text gradients, and non-rendered text.

Skill[v4.0.2](https://impeccable.style/changelog#v4.0.2)July 23, 2026

### Security.

Security hardening, a live mode that stopped fighting its own frameworks, and TanStack support. Most of this release traces to user reports filed in the last two days; thank you.

*   **Security.** The live helper no longer serves its bearer token to any page that asks: loopback-only CORS and a token-gated script (#304). The `/source` route can no longer read sibling directories whose names extend the project root (#401).
*   **Live mode, unregressed.** One atomic source write per cycle again, so React and Vite apps stop reload-storming mid-generation; progressive injection no longer races React ownership; the progress bar never moves backward; a dropped tab resumes instead of ending the session; and variant cycles skip redundant per-variant QA.
*   **TanStack, first class.** TanStack Router works on the standard Vite path, and TanStack Start gets a real SSR adapter, both covered by e2e fixtures.
*   **Hooks behave.** The Stop hook honors `stop_hook_active`, so a declined finding can never re-block your turn twenty times (#400). The doctor no longer reports a correctly installed hook as missing (#402).
*   **Sharper flows.** The finish review runs as a shipped subagent with clear authorization on gated harnesses; quality-bar cards download into the workspace so sandboxed viewers can open them; and under hard turn caps the shipped page outranks optional imagery.

Skill[v4.0.1](https://impeccable.style/changelog#v4.0.1)July 22, 2026

### Play it straight.

A day of live testing against v4.0 turned up the places where the interactive spine could be skipped, and v4.0.1 closes them. The flow now holds its shape on every harness, and the craft machinery gained teeth.

*   **Play it straight.** Every direction round now carries a quiet standing exit to the category standard. Pick it and the skill asks which products yours should sit alongside, then executes the canon at their craft level. It is your door; the model never recommends it.
*   **Three comps before code.** Visualizing the locked direction is now canonical for every provider with image generation: three compositional options, rendered and put in front of you for approval before anything is built.
*   **Two shipped subagents.** The new finish reviewer audits persistence, the quality-bar ceiling, and the direction contract from outside the build thread, and the asset producer now ships beyond codex.
*   **The roll waits for truth.** Concept dealing refuses to run before PRODUCT.md exists, and a new world must write DESIGN.md before the first build edit lands.
*   **The interview survives autonomy mode.** Some harnesses inject a standing claim that the user is unreachable; the skill now treats that as a default to verify, probes once, and keeps the ask rounds alive.
*   **Decision page fixes.** Directions without a rendered card show as clean text cards, svg imagery renders, and the chosen world's board and hero open automatically at the moment you pick.

CLI[v3.3.1](https://impeccable.style/changelog#cli-v3.3.1)July 22, 2026

### CLI v3.3.1

A hotfix for global installs, plus a gentler em dash rule.

*   User-level installs no longer write project-relative hook paths that crash every turn in other projects; hooks are guarded so a missing file exits quietly instead of breaking your session.
*   `skills update` names the install it is about to touch, honors `--user` and `--project`, and asks instead of silently picking when both exist.
*   The em dash rule is now advisory: reported separately, never counted as a failure, skipped by hooks by default, and it only fires on genuine saturation. It also counts HTML entities, so encoded dashes no longer slip past.
*   New rule: undersized-ui-text flags functional text below an 11px floor, even when the size is on the documented ramp. 59 rules total.
*   `detect` resolves DESIGN.md from each scan target's own project, not the directory you ran it from.

Skill[v4.0.0](https://impeccable.style/changelog#v4.0.0)July 21, 2026

### A world beyond the first idea.

Ask a coding model to be creative and it builds its favorite idea, every run. A campaign of measurement showed that is not a shortage of creativity but a shortage of variance, and v4 is the fix: the direction now gets rolled from outside the model's own ranking, so greenfield builds, redesigns, and extensions land somewhere it would not have reached alone.

![Image 4: A world card rendered as a dark hero page: cream and red hand-drawn charts, a spiral labor diagram, and the headline See history as data.](https://impeccable.style/worlds/cards/dubois-data-portraits-hero.webp)Dubois Data Portraits

![Image 5: A world card rendered as a hero page built from a split-flap departure board, with amber status rows over a photograph of a station concourse.](https://impeccable.style/worlds/cards/signals-instruments-split-flap-concourse-hero.webp)Split Flap Concourse

![Image 6: A world card rendered as a hero page in cut-paper style: an orange field, a black reaching hand, and the headline Stories move people.](https://impeccable.style/worlds/cards/posters-covers-sleeves-saul-bass-title-hero.webp)Saul Bass Title

Three worlds from one roll. They are challengers, not templates: they enter the shortlist against the directions the model derives from your own product, and they only take the build when they beat them. The deck holds 188 approved worlds, dealt live by the same roll API the skill calls.

![Image 7: The system board for the Memphis Showroom Morning world: pink, mint, lilac and yellow swatches with terrazzo and squiggle laminates, a heavy display typeface, buttons, inputs, cards, and a nav bar.](https://impeccable.style/worlds/cards/design-canon-memphis-showroom-morning.webp)Face one · system board

![Image 8: The same world as a full desktop hero for a furniture shop, with cut-paper headline blocks over a photographed pink and mint showroom.](https://impeccable.style/worlds/cards/design-canon-memphis-showroom-morning-hero.webp)Face two · hero

A fourth world, Memphis Showroom Morning, in both of the faces every card carries: a board that fixes palette, type, and component character, and a hero at a real viewport. The agent studies both before it writes a line.

30 / 35 answers that came back as the identical concept when we asked for creativity sixteen different ways

188 worlds approved into the deck, out of 360 reviewed by hand

58 deterministic slop and quality rules the detector now enforces

From the v4 one-shot campaign: roughly 30 skill iterations, 200 sampled concepts, and $2,600 of evals. [Read the research](https://impeccable.style/research).

Creativity you can get out of a model

*   **Direction by dice, not by taste.** The model no longer picks its own favorite. An outside seed names which of its grounded directions must be taken seriously and deals six challenger worlds beside it, so the same brief stops landing on the same three fonts over a cream background. Every roll prints a key that reproduces it, and a re-roll clears the table rather than rewording what you turned down.
*   **188 reviewed worlds, dealt as challengers.** These are not templates. A world competes against the directions the model derived from your product and wins only on merit, which is how it behaves in practice: strong cultural material beats the deck, thin categories lose to it. Ratings weight the draw, the category default never enters it, and the pool is served by a public roll API.
*   **No command to pick. Just say what you want.** Impeccable now works out what kind of job it is on its own: a blank slate, a whole new page inside an existing product, a section added to a page that already works, a redesign, or a scoped refinement. Each one gets a different amount of freedom, which is the part that used to go wrong. A redesign treats the old look as evidence and replaces it, rather than polishing what you asked to be rid of. An addition inherits the surrounding page's world and decides only what it actually introduces, rather than quietly restyling your product around a new idea. `/impeccable craft` is deprecated because of this: describing the surface does the same thing, and it no longer matters whether you knew the command existed.
*   **Decide the direction in your browser.** In an attended session Impeccable opens a decision page: the assigned direction leading, the dealt challengers as alternates with their quality-bar cards, and re-roll plus a one-line steer. It presents one committed direction rather than a ranked menu, because a lineup invites the safest card. You re-roll freely; the agent may only re-roll on named factual grounds, and a direction you pinned always wins.
*   **See it rendered before it is built.** The chosen direction gets drawn as a design-system board and a first-surface mock, then the build is corrected against it. This no longer needs a harness with a native image tool: set `OPENAI_API_KEY` and the skill renders through gpt-image-2 instead, telling you it bills your own key before the first image.
*   **The build states its intent, then gets checked against it.** Before code, the agent writes a five-block contract into the artifact's opening comment, 150 words at most: thesis, own world, story, first viewport, and form with the seed key. If a block reads like a mood, the direction is not decided yet. The finishing review then audits the render against it promise by promise, in its own agent where the harness allows.

iOS and Android, in alpha

*   **Native projects get native guidance.** One of the most requested features. Impeccable works out the platform from the project during `init` and only asks when the evidence is ambiguous, so there is normally nothing to configure. On an iOS, Android, or cross-platform codebase it loads the Apple HIG or Material 3 rulebook on top of the design guidance, and runs `audit` and `adapt` as native passes covering VoiceOver, TalkBack, touch targets, and platform conformance instead of CSS.
*   **What native does not cover yet.** Live mode, the detector, and the design hook all read a browser or parse HTML, so they sit out on native projects. Web projects are unaffected.

Rebuilt for current models

*   **A much leaner core, on purpose.** Fable 5 and GPT-5.6 follow short, well-structured instruction better than long insistent prose, and repeating a rule three ways now costs more than it buys. So the skill was restructured rather than extended: the always-loaded core is a fraction of its old length, several references were consolidated or rewritten around it, and depth loads only when the work calls for it. Scoped work stops detouring, so asking to polish one button no longer triggers a full product interview.
*   **Four visitor modes replace brand and product.** A surface is now Persuade, Operate, Read, or Experience, chosen from what the visitor came to do rather than from what the company sells. A tool's landing page is still Persuade; a fashion house's documentation is still Read. The mode is decided per surface, so one project can hold all four.
*   **Surfaces remember their strategy.** Page-level decisions (audience, proof sequence, selected direction, what is still open) persist to `.impeccable/surfaces/`, so a later session continues that page's argument instead of inventing a new one. PRODUCT.md gained positioning, evidence on hand, and brand commitments.
*   **The design hook got two speeds.** Being nagged on every edit measurably made models play safe, so per-edit checks now surface only what is objectively broken: contrast failures, overflowing text, broken images, glow, and drift from your own design system. Everything else waits for one full pass across every UI file you touched, run when the work is done.

Keeping an older project current

*   **Impeccable tells you when your project has fallen behind it.** v4 changed what PRODUCT.md holds and retired the brand-or-product register field, so a project set up under v3 carries answers the current version no longer reads. Impeccable now checks its own files when a session starts and says so once: a product record written before v4, a design sidecar older than the DESIGN.md it extends, a config key that is a near-miss of a real one and has therefore never applied to anything. The most valuable catch is a native project being handed web guidance, because that costs you quality quietly rather than failing loudly. None of it blocks the work you asked for, a given finding is raised at most once a week, and `"stalenessCheck": false` turns the whole thing off.
*   **`/impeccable doctor` when you want the full picture.** Ask what is out of date and you get the deep pass rather than the cheap subset: how much interface work has shipped since DESIGN.md was last touched, ignored detector rules that no longer exist, a design hook whose script path stopped resolving and has been scanning nothing while still looking installed. It repairs the mechanical drift itself and hands the rest to `init` or `document` with the specific gap named, because a document that has drifted from the code is a conversation, not a migration.
*   **Monorepos stop inheriting the wrong answer in silence.** An app that ships to iOS or Android while inheriting a root product record saying web used to get web guidance for its entire life and never load the native rulebook. That combination is now reported by name, as are workspace globs in your config that match no directory and have therefore been leaving the repo root standing in for the app you meant. `doctor` prints a table of which apps carry their own context and which inherit the root's.

Detector, Live mode, and harnesses

*   **Twelve new detector rules, 58 in total.** Radial glow halos and accent spotlights, marquee scrollers, blinking terminal cursors, decorative dot and grid fields, text sitting under an overlay, first-viewport content that overflows its column, and hero art assembled from stock geometric shapes. Several were widened rather than added: hover-state contrast, nav CTA contrast, chip contrast, and side-edge stripes painted with an inset shadow.
*   **The detector reads your templates.** Name your server-side template extensions in config and Blade, ERB, and Twig projects get the same checks as JSX.
*   **Live mode is quicker and safer.** The helper prepares the wrap before the agent hears about your click, which takes a round trip out of every variant. Accepts hold a real lock, so two writers can never land on the same file, Vue directives survive a round trip intact, and Elixir templates and server-rendered pages accept cleanly.
*   **Two more harnesses, thirteen supported tools.** Grok Build and Mistral Vibe both join as compiled builds, each with its own hook manifest. `npx impeccable install` detects them like the rest and installs the version tuned for that tool.

CLI[v3.3.0](https://impeccable.style/changelog#cli-v3.3.0)July 21, 2026

### A dozen new anti-pattern rules.

The detector reaches 58 rules and learns where each product lives.

*   **A dozen new anti-pattern rules.** The deterministic set now flags soft radial glow halos and accent spotlights, marquee scrollers, blinking terminal cursors, decorative dot and grid fields, text sitting under an overlay, first-viewport content that overflows its column, and hero art assembled from stock geometric shapes. That brings the count to 58.
*   **Context roots live in config, not your package manager.** Declare where each product's `PRODUCT.md` and `DESIGN.md` sit in `.impeccable/config.json`, so detection and setup work in repos that are not laid out as package workspaces.
*   **Scope one rule to one file.**`impeccable ignores` can now waive a rule for a single file with a wildcard value, so a domain-appropriate pattern in one component stops being reported without silencing the rule everywhere.
*   **Nested products honor `--target`.** Scans of a nested app inside a non-monorepo repo now resolve the right context and source, instead of falling back to the repository root.

CLI[v3.2.1](https://impeccable.style/changelog#cli-v3.2.1)July 9, 2026

### Node 22 and 23 install cleanly again.

A compatibility release for Node 22/23 that also ships the detector and installer fixes already waiting on main.

*   **Node 22 and 23 install cleanly again.** The CLI now declares `"node": ">=22.12.0"` and CI runs the main test/build lane on Node 22.12 and Node 24. The ZIP installer has used `fflate` since v3.0.2, so the old `extract-zip` stream bug no longer requires avoiding Node 22/23.
*   **`npx` no longer falls back to stale 2.x on modern LTS Node.** Because current releases are engine-compatible with Node 22.12+, `npx impeccable install` stays on the latest CLI instead of selecting an older Node-18-compatible release that does not understand the top-level `install` command.
*   **Detector pre-scans can target typography or layout.**`impeccable detect --scope type` and `--scope layout` narrow findings to the design domain a command is about to edit, and the new `design-system-font-size` rule flags literal sizes outside the `DESIGN.md` typography ramp. Brings the deterministic rule set to 46.
*   **Google Fonts and detector ignores are sharper.**`fonts.googleapis.com/css2` URLs with multiple families, axes, and encoded names now feed the overused-font and single-font checks correctly, and file-scoped wildcard ignores now suppress findings that do not carry a value, such as side tabs.
*   **Pi global installs land in the right directory.** User-scope installs, updates, and checks now use `~/.pi/agent/skills` while project installs continue to use `.pi/skills`, so Pi users get the same install/update behavior as the other harnesses.

Skill[v3.9.1](https://impeccable.style/changelog#v3.9.1)July 1, 2026

### Codex loads the plugin design hook again.

A packaging fix so the design hook loads in Codex.

*   **Codex loads the plugin design hook again.** The plugin-packaged hook manifest carried a top-level `description` field that Codex's strict hook parser rejected, so the post-edit design check failed to register. That field is gone from the plugin artifact, and the hook now loads cleanly on Codex while staying identical for Claude Code.

Skill[v3.9.0](https://impeccable.style/changelog#v3.9.0)July 1, 2026

### Decorative grid backgrounds are now a named tell.

A new anti-slop rule for Codex-style grid backgrounds, a bolder pass that respects your design system, and critique that stays independent across more harnesses.

*   **Decorative grid backgrounds are now a named tell.** Impeccable refuses the two-axis CSS grid overlay built from hairline gradient lines and a repeating `background-size`, the pattern Codex reaches for on almost any empty surface. Actual canvases, maps, blueprints, and measurement tools still get their grid; everything else gets real product structure or a plain surface.
*   **`/impeccable bolder` stays inside your design system.** When a project has a `DESIGN.md`, tokens, or established component styles, a bolder pass now makes the existing language more decisive through hierarchy, proportion, density, and copy instead of inventing new colors, gradients, or effects. If the system genuinely cannot express the direction, it names the exact additions and asks before expanding.
*   **Critique holds its independence on more harnesses.** On harnesses other than Claude and Codex, the critique pass now runs in its own sub-agent more often, so the review reads the design with fresh eyes instead of inheriting the editing context that produced it.
*   **Bundled helpers run under strict-permission harnesses.** The skill's bundled Node helpers now execute on harnesses that lock permissions down, so setup and detection work without extra approval prompts.
*   **Codex hook manifest fixed.** Corrected the Codex hook manifest schema so the post-edit design check registers cleanly.

CLI[v3.2.0](https://impeccable.style/changelog#cli-v3.2.0)July 1, 2026

### New rule: Codex grid-line backgrounds.

New rule: Codex grid-line backgrounds. The detector flags the two-axis grid overlay drawn from hairline gradients plus a repeating background-size, and it counts only hairline gradients inside the background so a stray mask-image line does not trip it. It originally shipped behind --gpt; provider gates were later removed and the rule now runs by default. Brings the deterministic rule set to 45.

*   **New rule: Codex grid-line backgrounds.** The detector flags the two-axis grid overlay drawn from hairline gradients plus a repeating `background-size`, and it counts only hairline gradients inside the background so a stray `mask-image` line does not trip it. It originally shipped behind `--gpt`; provider gates were later removed and the rule now runs by default. Brings the deterministic rule set to 45.
*   **First install preserves an external skills symlink.** Installing into a project whose `~/.claude/skills` points at an external directory no longer overwrites that symlink on the first install, so shared skill setups stay intact.

Skill[v3.8.0](https://impeccable.style/changelog#v3.8.0)June 22, 2026

### Design hooks for GitHub Copilot.

Impeccable reaches across more of your workflow: the design hook now runs in GitHub Copilot, and project context understands monorepos.

*   **Design hooks for GitHub Copilot.** Installing the skill adds a `.github/hooks/impeccable.json` hook that runs the detector after Copilot edits a UI file and feeds the findings back as a focused design reminder. It covers both the Copilot CLI and the cloud agent, and recognizes every edit path Copilot uses, including `apply_patch`.
*   **Monorepo-aware context.** Open the repo root and Impeccable resolves `PRODUCT.md` and `DESIGN.md` per app: each child app uses its own context files and falls back to the root files for anything it does not define. `/impeccable live` detects multiple apps, asks which one to work on, and then runs and stores live state inside that app.

CLI[v3.1.0](https://impeccable.style/changelog#cli-v3.1.0)June 22, 2026

### Inline ignore comments.

Inline ignore comments. Waive a detector finding with an in-file comment that travels with the file, for exported or standalone documents where .impeccable/config.json is not present. impeccable-disable <rule> covers the whole file; impeccable-disable-line and impeccable-disable-next-line scope to one line. The marker works in any comment syntax, takes an optional reason, and is bypassed with --no-inline-ignores.

*   **Inline ignore comments.** Waive a detector finding with an in-file comment that travels with the file, for exported or standalone documents where `.impeccable/config.json` is not present. `impeccable-disable <rule>` covers the whole file; `impeccable-disable-line` and `impeccable-disable-next-line` scope to one line. The marker works in any comment syntax, takes an optional reason, and is bypassed with `--no-inline-ignores`.
*   **Clearer errors on unknown commands.** An unrecognized subcommand now fails loudly with a usage hint instead of silently doing nothing.

Extension[v1.2.1](https://impeccable.style/changelog#ext-v1.2.1)June 18, 2026

### The toolbar badge count matches the popup and panel.

The toolbar badge count matches the popup and panel. The browser-action badge counted flagged elements while the popup and DevTools panel counted anti-pattern findings, so the same scan showed two numbers (for example 21 vs 34). One element can carry several findings; the badge now counts findings too, so every surface agrees. Reported in #262.

*   **The toolbar badge count matches the popup and panel.** The browser-action badge counted flagged elements while the popup and DevTools panel counted anti-pattern findings, so the same scan showed two numbers (for example 21 vs 34). One element can carry several findings; the badge now counts findings too, so every surface agrees. Reported in [#262](https://github.com/pbakaus/impeccable/issues/262).
*   **Local file scans report why they fail.** Scanning a `file://` page with file-URL access off used to leave the popup stuck on "Scanning…" forever. The popup now shows the real reason, with a permission hint for local files, and clears it on the next scan. Reported in [#258](https://github.com/pbakaus/impeccable/issues/258).
*   **Popup matches the Kinpaku design system.** The toolbar popup picks up the canonical carved-tile mark and light/dark theming that follows your system preference. Reported in [#260](https://github.com/pbakaus/impeccable/issues/260).

CLI[v3.0.3](https://impeccable.style/changelog#cli-v3.0.3)June 17, 2026

### Existing installs now pick up script-only skill fixes.

Existing installs now pick up script-only skill fixes. impeccable update compares the complete bundled skill tree instead of just SKILL.md, so fixes in bundled scripts are detected. Running impeccable install on an already-installed project also refreshes stale skill files instead of stopping at "already installed."

*   **Existing installs now pick up script-only skill fixes.**`impeccable update` compares the complete bundled skill tree instead of just `SKILL.md`, so fixes in bundled scripts are detected. Running `impeccable install` on an already-installed project also refreshes stale skill files instead of stopping at "already installed."
*   **Codex installs report the skill version.** The `.agents` and `.codex` builds now include the same `version` frontmatter as the other harnesses, so check/update output can show the installed skill version consistently.

Skill[v3.7.1](https://impeccable.style/changelog#v3.7.1)June 16, 2026

### /impeccable critique works again.

A packaging fix so the bundled detector runs everywhere.

*   **`/impeccable critique` works again.** The bundled detector was missing a config module it needed and crashed on startup. The build now ships that file with the skill, so critique and other detector-backed commands run cleanly.

Skill[v3.7.0](https://impeccable.style/changelog#v3.7.0)June 16, 2026

### Design-aware hook detections.

Impeccable now carries project design context into hooks, the detector, and docs. The agent can compare edits against your actual typography, color, and radius system instead of only using global anti-pattern rules.

*   **Design-aware hook detections.** When a project has `DESIGN.md`, hooks and `impeccable detect` load the local design system and flag font, color, and radius drift against the documented palette, typography stacks, rounded scale, and sidecar tonal ramps.
*   **Ignores now work across hooks and the CLI.** Detector exceptions moved into shared config, and `impeccable ignores` can list, add, and remove rule, file, and value ignores without hand-editing JSON.
*   **Docs cover the full project context path.** New reference pages explain hooks, the detector, configuration, and Design Context, including how `PRODUCT.md`, `DESIGN.md`, and `.impeccable/design.json` are loaded and kept current.
*   **Docs code blocks now use the Impeccable palette.** Shiki syntax highlighting uses design-system colors in both light and dark mode, with contrast tests so examples stay readable and do not trigger design-system color drift.

CLI[v3.0.2](https://impeccable.style/changelog#cli-v3.0.2)June 16, 2026

### impeccable detect now understands your design system.

impeccable detect now understands your design system. When a project has DESIGN.md, CLI scans load the same context as hooks and flag font, color, and radius drift against documented typography, palette, rounded scale, and sidecar tonal ramps. Pass --no-design-system when you want the global detector only.

*   **`impeccable detect` now understands your design system.** When a project has `DESIGN.md`, CLI scans load the same context as hooks and flag font, color, and radius drift against documented typography, palette, rounded scale, and sidecar tonal ramps. Pass `--no-design-system` when you want the global detector only.
*   **Ignore management is now a first-class CLI workflow.**`impeccable ignores` can list, add, and remove rule, file, and value exceptions in the shared detector config, so teams no longer have to hand-edit `.impeccable/config.json`. Hooks and manual CLI scans honor the same exceptions.
*   **Install no longer fails silently on newer Node.** On Node v24.16.0 and v26.1.0+, `impeccable install` could print "Downloading impeccable skills...", exit 0, and write nothing. ZIP extraction now uses pure-JS `fflate`, avoiding the destroyed-stream stall behind [nodejs/node#63487](https://github.com/nodejs/node/issues/63487) while preserving the Windows install fix. Reported by [@kenryu42](https://github.com/kenryu42) in [#250](https://github.com/pbakaus/impeccable/issues/250).

CLI[v3.0.1](https://impeccable.style/changelog#cli-v3.0.1)June 15, 2026

### Exact motion findings.

Exact motion findings. bounce-easing now reports the concrete animation token, Tailwind class, or overshooting cubic-bezier value instead of a generic bounce label. Intentional motion can be kept or ignored at the narrow value level.

*   **Exact motion findings.**`bounce-easing` now reports the concrete animation token, Tailwind class, or overshooting cubic-bezier value instead of a generic `bounce` label. Intentional motion can be kept or ignored at the narrow value level.
*   **Hook guidance favors design judgment.** Project hook output now asks agents to classify each finding before editing: fix true design problems, leave intentional demos or domain-appropriate motion alone, and explain the decision.

Skill[v3.6.0](https://impeccable.style/changelog#v3.6.0)June 14, 2026

### Ablation-tested skill core.

Impeccable now helps while the agent is editing, and the core skill is leaner: ablation-tested guidance, project hooks, sharper detector signal, and Live Mode support for Svelte and manual browser edits.

*   **Ablation-tested skill core.** The main skill got leaner after rule-level evals across three providers and four niches. Redundant typography and copy guidance moved out of the always-on prompt, rules with no measurable lift were cut, and examples that primed models to repeat the exact pattern being banned were rewritten. The result is a smaller prompt that spends attention on guidance proven to move design output.
*   **Design hooks for real editing sessions.**`/impeccable hooks` wires the detector into Claude, Codex, and Cursor projects. Claude and Codex get focused design reminders after UI file edits, Cursor can review proposed writes before they land, and `/impeccable hooks on` handles manifest setup, repair, and consent for you.
*   **Findings stay reviewable.** Hook runs distinguish new findings, already-seen findings, and clean scans, so the agent gets useful pressure without repeated walls of output. Confirmed exceptions can be saved through `ignore-value`, `ignore-file`, and `ignore-rule` in `.impeccable` config files instead of source comments.
*   **The detector now tracks visible design problems more closely.** The 41-rule engine skips hidden elements and screen-reader-only text, understands OKLCH alpha and Sass-like inputs, reports exact motion tokens for bounce or elastic easing, and tightens repeated kickers, oversized H1s, clipped overflow, transparent border/shadow, numbered marker, and cramped-padding checks.
*   **Svelte-native Live Mode.** Svelte and SvelteKit variants preview as temporary framework components with params stored in `params.json`, then accept back into the selected source component. Stateful pages stay closer to their real shape and avoid the HMR resets caused by string-injected previews.
*   **Live Mode accepts more real-world edits cleanly.** Manual text edits now have dedicated evidence, apply, and discard routes. Insertions preserve their anchors, accepted variants clean up mapped lists and JSX slots more reliably, and SvelteKit projects get a framework-aware live adapter that leaves `src/app.html` alone.

CLI[v3.0.0](https://impeccable.style/changelog#cli-v3.0.0)June 14, 2026

### Breaking: Node 24 minimum.

Breaking: Node 24 minimum. The CLI now declares "node": ">=24". Upgrade Node before installing or running this version.

*   **Breaking: Node 24 minimum.** The CLI now declares `"node": ">=24"`. Upgrade Node before installing or running this version.
*   **Shorter commands.**`impeccable install`, `impeccable update`, `impeccable link`, and `impeccable check` are now the primary command shape. The old `impeccable skills ...` namespace still works for existing scripts.
*   **Installer choices match your machine.**`impeccable install` shows the harnesses it detects, defaults to that set, lets you customize providers through a searchable picker, and asks whether to install into the current project or globally. Project installs are the default unless real global skills already exist.
*   **Hooks install with the skill when you opt in.**`impeccable install` and `impeccable update` can prompt once for hook consent, persist the local answer, and install or repair the Claude, Codex, and Cursor hook manifests. Teams that only want the skill can still pass `--no-hooks`.
*   **Local and submodule installs are safer.**`impeccable link --source=.impeccable` supports repo-local development, symlink-safe updates avoid clobbering linked installs, provider aliases include Codex and Rovo Dev names, local bundle overrides are explicit, and ZIP extraction is safer on Windows.
*   **Detector output is more precise.** CLI scans pick up the same accuracy work as the skill hooks: hidden-element skips, sr-only text handling, tighter repeated kicker and oversized-H1 heuristics, OKLCH alpha, Sass-like CSS inputs, transparent-border handling, and page-level numbered-marker checks that stay out of implementation literals.

Extension[v1.2.0](https://impeccable.style/changelog#ext-v1.2.0)June 14, 2026

### Firefox support.

Firefox support. The same detector, popup, DevTools panel, and per-rule toggles now ship as a Firefox add-on. The Firefox package declares what the extension already does: scans run in the page, and nothing leaves your machine.

*   **Firefox support.** The same detector, popup, DevTools panel, and per-rule toggles now ship as a Firefox add-on. The Firefox package declares what the extension already does: scans run in the page, and nothing leaves your machine.
*   **The overlay matches the 41-rule engine.** Browser scans pick up the latest detector improvements, including hidden-element skips, sr-only text-overflow handling, tighter repeated kicker, oversized-H1, clipped-overflow, OKLCH alpha, Sass-adjacent CSS parsing, transparent-border handling, and exact animation values for bounce or elastic motion.
*   **DevTools opens reliably in packaged builds.** Firefox panel and sidebar URLs are now root-relative, scan responses echo their scan IDs, and the icon set plus store metadata match the current detector.

CLI[v2.3.2](https://impeccable.style/changelog#cli-v2.3.2)May 29, 2026

### The i- command prefix is gone.

The i- command prefix is gone. Opting into a prefix at install time was a holdover from when every command was its own skill. With a single impeccable skill it only ever renamed that one skill to i-impeccable, while the install message wrongly promised /i-audit style commands that never existed, and the rename could clobber unrelated third-party skills in the same harness folder. The flag and the prompt are removed.

*   **The `i-` command prefix is gone.** Opting into a prefix at install time was a holdover from when every command was its own skill. With a single `impeccable` skill it only ever renamed that one skill to `i-impeccable`, while the install message wrongly promised `/i-audit` style commands that never existed, and the rename could clobber unrelated third-party skills in the same harness folder. The flag and the prompt are removed.
*   **Existing prefixed installs heal themselves.**`skills install` and `skills update` now rename any old `i-impeccable` (or custom-prefixed) skill back to the canonical `impeccable`, scoped by name so a third-party skill that happens to start with `i-` is left untouched. Want a short top-level command? `/impeccable pin audit` still makes `/audit` a standalone shortcut.

Skill[v3.5.0](https://impeccable.style/changelog#v3.5.0)May 28, 2026

### Better design, measured in the work.

The biggest release yet. Per-provider rules that lift GPT-5.5 and Codex most, a skill that adapts to new versus existing projects, and Live Mode in Beta.

Before![Image 9: GPT-5.5 without Impeccable: a cream background, an abstract vector hero, and an oversized serif headline overflowing its column.](https://impeccable.style/assets/changelog/luxury-hotel-gpt55-before.jpg)

After![Image 10: GPT-5.5 with Impeccable: a full-bleed photograph of a cliffside village, an editorial headline, and warm first-person copy.](https://impeccable.style/assets/changelog/luxury-hotel-gpt55-after.jpg)

GPT-5.5, same luxury-hotel brief. Without Impeccable: the cream AI background, an abstract vector hero, and a headline that overflows its column. With Impeccable: real photography, an editorial layout, and copy with a human voice.

74%of GPT-5.5 pages used the cream / beige AI-default background

76%reached for extreme negative letter-spacing on tech briefs

90%+shipped body text below the WCAG contrast floor

Measured across ~190 samples, skill off. Each rate traced to a line in the skill, then fixed.

*   **Dramatically better in GPT and Codex.** Impeccable now compiles harness-specific rules into the skill at build time. Codex and GPT-5.5 get rules written for the exact defects they produce, that no other harness ever sees. No other design skill does this; everyone else ships one generic file to every model.
*   **Far less AI-default slop.** Bias mining against ~190 samples found the skill's own lines were causing defects, and cut them. The cream / beige background tell (74% on GPT) is banned across the warm-neutral band. Category-to-aesthetic recipes that drove extreme letter-spacing and italic-serif heroes are gone: the shape depends on the brand, not its category. New bans cover all-caps eyebrows, numbered section markers, more than three fonts, and a hard contrast floor.
*   **It treats a new project differently from an existing one.** On an existing codebase the skill reads your tokens, theme, and components first and works within them: preserving your identity wins over imposing a fresh look. On a blank slate it draws a single seed color from 129 hand-curated anchors, each carrying a mood and a composition strategy, then builds the full palette around it by hand. One seed becomes a dark jazz club or a light hospitality brand depending on the brief. Either way it ends the cold-start drift toward the same safe palette every time.
*   **Live Mode is Beta.** Out of alpha, and it now works at two scales. Type a direction into the new Steer bar, or speak it, and the agent reads the whole page and edits it in place, no element selected and no variant cycling. Or pick a single element, steer it in plain language, and accept the variant straight back to source. You can also edit copy in place: change an element's text right in the browser, and on Apply a subagent rewrites the real source it renders from and repairs anything wired to it, like card labels that double as image keys. Insert mode scaffolds brand-new elements between the ones already there. Recovery survives HMR, hidden heroes, and dev-tool overlays, and an experimental streaming poll mode cuts pickup from seconds to sub-second.
*   **`/impeccable teach` is now `/impeccable init`.** Renamed to match what it does: one command to set up a project. From a single codebase scan it writes PRODUCT.md, offers a DESIGN.md, configures Live Mode so it just works the first time you run it, then points you at the best command to start with. The old name still works as an alias.
*   **A bare `/impeccable` recommends your next move.** Run it with no command and, instead of a static menu, it reads the project, your dirty git tree, and your latest critique, then leads with the two or three highest-value commands and why (no DESIGN.md yet, run document; unresolved findings in the files you're editing, run polish). It always asks before running anything, and the full menu is still right below.
*   **A faster detector with no jsdom.** The HTML/CSS engine was rebuilt from the ground up on `htmlparser2` and a real CSS cascade resolver, replacing jsdom. On the same 160-file HTML corpus it runs about 20x faster under Node: 0.34s where the old jsdom engine took 6.8s, roughly 2 ms per file instead of 43 ms. Dependency-free and small enough to bundle straight into the skill and run inline, not just in the CLI and the extension.
*   **Detector: 14 new rules.**`cream-palette`, `em-dash-overuse`, `marketing-buzzword`, `numbered-section-markers`, `aphoristic-cadence`, `theater-slop-phrase`, `oversized-h1`, `extreme-negative-tracking`, `gpt-thin-border-wide-shadow`, `repeating-stripes-gradient`, `image-hover-transform`, `broken-image`, `text-overflow`, and `clipped-overflow-container`. 41 deterministic rules total, one canonical registry feeding the CLI, the browser extension, critique, and the evals.
*   **The skill keeps itself current.** On the first session of the day, Impeccable quietly checks whether a newer version shipped. If one has, it offers to run `npx impeccable update` for you. It always asks first, never nags about a version you declined, and never interrupts the task you're on. Set `IMPECCABLE_NO_UPDATE_CHECK=1` to turn it off.
*   **Sharper craft under the hood.** Beyond the bans, the craft itself got tighter. Small defaults landed where they pay off, like `text-wrap: balance` on headings, which cleaned up ragged hero type across the ablation runs. And the instructions themselves got leaner: orphan reference files folded into their commands, context loading simplified, and a new LLM-backed test suite that catches instruction-following regressions across three providers on every change. Plus dedicated [/changelog](https://impeccable.style/changelog) and [/faq](https://impeccable.style/faq) pages.

CLI[v2.3.1](https://impeccable.style/changelog#cli-v2.3.1)May 28, 2026

### Codex agent delivery simplified.

Codex agent delivery simplified. Codex auto-discovers subagents bundled inside an installed skill's own agents/ folder, so skills install and skills update no longer write a separate .codex/agents/*.toml sidecar. The nested in-skill agent is the whole delivery now: one fewer file to install and heal, and nothing left behind in non-Codex projects.

*   **Codex agent delivery simplified.** Codex auto-discovers subagents bundled inside an installed skill's own `agents/` folder, so `skills install` and `skills update` no longer write a separate `.codex/agents/*.toml` sidecar. The nested in-skill agent is the whole delivery now: one fewer file to install and heal, and nothing left behind in non-Codex projects.
*   **`--fast` deprecated.** Since the jsdom removal the full static scan runs at about 4 ms per file and covers every rule, so the regex-only `--fast` path only lost coverage (about 10 of 41 rules) for no real speed gain, and a `--fast` run could read "clean" because most rules silently never ran. The flag is still accepted so existing CI scripts keep working, but it is ignored with a one-line notice and the full scan always runs.

CLI[v2.3.0](https://impeccable.style/changelog#cli-v2.3.0)May 28, 2026

### Codex subagent delivery.

Codex subagent delivery. skills install and skills update now write .codex/agents/impeccable_asset_producer.toml alongside the skill for Codex projects, detected from a .agents target or a global ~/.codex install. Update heals the file when an older install left it out, and non-Codex projects stay untouched.

*   **Codex subagent delivery.**`skills install` and `skills update` now write `.codex/agents/impeccable_asset_producer.toml` alongside the skill for Codex projects, detected from a `.agents` target or a global `~/.codex` install. Update heals the file when an older install left it out, and non-Codex projects stay untouched.

CLI[v2.2.0](https://impeccable.style/changelog#cli-v2.2.0)May 28, 2026

### Static engine, no jsdom.

Static engine, no jsdom. Detection was rebuilt on htmlparser2 and a real CSS cascade resolver, replacing jsdom. About 20x faster on large HTML scans (a 160-file corpus drops from 6.8s to 0.34s under Node), dependency-free, and small enough to bundle, with no change to the rules themselves.

*   **Static engine, no jsdom.** Detection was rebuilt on `htmlparser2` and a real CSS cascade resolver, replacing jsdom. About 20x faster on large HTML scans (a 160-file corpus drops from 6.8s to 0.34s under Node), dependency-free, and small enough to bundle, with no change to the rules themselves.
*   **14 new detection rules.**`cream-palette` (warm off-white "claude beige" backgrounds, including Tailwind warm-light utilities), `em-dash-overuse`, `marketing-buzzword`, `numbered-section-markers`, `aphoristic-cadence`, `theater-slop-phrase`, `oversized-h1`, `extreme-negative-tracking`, `gpt-thin-border-wide-shadow`, `repeating-stripes-gradient`, `image-hover-transform`, `broken-image`, `text-overflow`, and `clipped-overflow-container`. 41 deterministic rules total.
*   **everything-centered removed.** Dropped from the registry, the regex analyzer, and the layout checks: the rule caught too many legitimately centered layouts to earn its place.
*   **One canonical registry.** Eval-side detection logic folded back into the shared engine, so the CLI, the browser extension, the critique skill, and the evals all run the exact same checks.

Extension[v1.1.0](https://impeccable.style/changelog#ext-v1.1.0)May 28, 2026

### The new detection rules flag in the overlay.

The new detection rules flag in the overlay. cream-palette, em-dash-overuse, marketing-buzzword, numbered-section-markers, aphoristic-cadence, theater-slop-phrase, oversized-h1, broken-image, text-overflow, and the rest now light up on any page you scan, same engine as the CLI.

*   **The new detection rules flag in the overlay.** cream-palette, em-dash-overuse, marketing-buzzword, numbered-section-markers, aphoristic-cadence, theater-slop-phrase, oversized-h1, broken-image, text-overflow, and the rest now light up on any page you scan, same engine as the CLI.
*   **Per-rule toggles in settings.** Every rule, including the new ones, has an on/off switch grouped by AI tells and Quality. Toggle state syncs across your browsers and the scan honors it immediately.

Skill[v3.1.1](https://impeccable.style/changelog#v3.1.1)May 14, 2026

### /impeccable critique works on Windows.

/impeccable critique works on Windows. The CLI entry-point check in critique-storage.mjs compared import.meta.url against a hand-built file:// string, which silently failed on Windows because Node returns forward slashes in import.meta.url but backslashes in process.argv[1]. The script exited 0 with no output and the snapshot save was skipped. Switched to pathToFileURL, the standard cross-platform pattern. Reported by @Genmutant in #155.

*   **`/impeccable critique` works on Windows.** The CLI entry-point check in `critique-storage.mjs` compared `import.meta.url` against a hand-built `file://` string, which silently failed on Windows because Node returns forward slashes in `import.meta.url` but backslashes in `process.argv[1]`. The script exited 0 with no output and the snapshot save was skipped. Switched to `pathToFileURL`, the standard cross-platform pattern. Reported by [@Genmutant](https://github.com/Genmutant) in [#155](https://github.com/pbakaus/impeccable/issues/155).

Skill[v3.1.0](https://impeccable.style/changelog#v3.1.0)May 13, 2026

### Codex asset producer agent.

Codex asset producer agent. A native Codex subagent that produces clean, reusable raster assets from approved Impeccable mock references without redesigning the direction. Preserves silhouette, palette, lighting, and material; strips baked-in UI text and presentation chrome that CSS should own. Codex-only because Codex is the harness with native image generation today.

*   **Codex asset producer agent.** A native Codex subagent that produces clean, reusable raster assets from approved Impeccable mock references without redesigning the direction. Preserves silhouette, palette, lighting, and material; strips baked-in UI text and presentation chrome that CSS should own. Codex-only because Codex is the harness with native image generation today.
*   **Critique persistence.** Each `/impeccable critique` run now writes a per-target snapshot to `.impeccable/critique/<timestamp>__<slug>.md` with score, P0/P1 counts, and full report. `/impeccable polish` reads the latest matching snapshot as additional signal when invoked on the same target. `ignore.md` at the same path is user-curated; lines there are designer-intended deviations that critique won't re-raise.
*   **Codex-specific image flow extracted.** The mock-and-palette workflow lives in `reference/codex.md` with a palette-first gate (lock the palette before any mocks, so generated comps stop drifting). Craft.md is shorter and cleaner for every non-Codex harness.
*   **Detector: new rule + false-positive fixes.**`body-text-viewport-edge` catches body text running to the absolute viewport edge. OKLCH and CSS-var resolution improvements remove a class of false positives in modern token-based codebases.
*   **Brand register sharpened.** An "inverse test" question now sits up front: describe your page the way a competitor would describe theirs; if that sentence fits the modal landing page in the category, restart. A cultural-symbol palette guardrail catches the lazy pull.
*   **Shape and craft gates strengthened.** Image-gen skips are announced in one line. Brief confirmation is explicit, not assumed. When the harness has native image generation, craft now names the four user gates between shape and code (direction questions, palette generation, mock generation, mock approval) with explicit STOP markers at each.
*   **Skill prose, image discipline, and detector counts kept honest.** A skill-side prose validator catches em dashes and AI tells in reference instructions. Craft step 3 reads the screenshot back into context after capture. Build validator now ignores changelog history when checking detector counts.

Skill[v3.0.7](https://impeccable.style/changelog#v3.0.7)May 4, 2026

### Detector flags italic-serif display heroes.

Detector flags italic-serif display heroes. Oversized italic serif (Fraunces, Recoleta, Newsreader, Playfair, Cormorant, Tiempos) running as the primary hero h1 is now caught as a structural fingerprint of late-2025 and early-2026 AI-generated marketing pages. Editorial surfaces that legitimately want the pattern can ignore the rule. Contributed by @vinaypokharkar in #129.

*   **Detector flags italic-serif display heroes.** Oversized italic serif (Fraunces, Recoleta, Newsreader, Playfair, Cormorant, Tiempos) running as the primary hero h1 is now caught as a structural fingerprint of late-2025 and early-2026 AI-generated marketing pages. Editorial surfaces that legitimately want the pattern can ignore the rule. Contributed by [@vinaypokharkar](https://github.com/vinaypokharkar) in [#129](https://github.com/pbakaus/impeccable/pull/129).
*   **Detector flags hero eyebrow chips.** The uppercase letter-spaced label sitting directly above a hero h1 now fires, including the pill-chip variant (background plus 999px border-radius). Bounded to short labels at small sizes so editorial captions don't false-positive. Also in [#129](https://github.com/pbakaus/impeccable/pull/129).
*   **Detector flags the new font monoculture.** The overused-font rule now catches Fraunces, Geist, Mona Sans, Plus Jakarta Sans, Space Grotesk, Recoleta, and Instrument Sans alongside Inter and the older defaults. Contrast checks also run on styled `<a>` and `<button>` elements (a "Get started" pill with charcoal text on near-black no longer reads as fine). Brand exceptions for Vercel, Next.js, and GitHub on their own domains.
*   **Live mode survives disconnects.** A durable session journal records every event, so an agent crash, a network blip, or a browser refresh no longer loses the session. Three new sub-commands: `live status`, `live resume`, and `live complete`. Contributed by [@nqh-packages](https://github.com/nqh-packages) in [#125](https://github.com/pbakaus/impeccable/pull/125).
*   **Reference files stripped of repetitive scaffolding.** SKILL.md and 33 sub-command files lost the "Remember:" closer chants, the brochure-style openers on 12 older commands, and 419 em-dashes that obscured the choice between colon, semicolon, period, or parens.

Skill[v3.0.6](https://impeccable.style/changelog#v3.0.6)April 30, 2026

### Live mode preserves identity by default.

Live mode preserves identity by default. Variants now stay on-brand for the existing surface (same palette, type pairing, visual rhetoric) and explore different expression axes within that identity. Departure from the existing aesthetic only triggers when PRODUCT.md anti-references explicitly call out the current surface, or the user asks for it.

*   **Live mode preserves identity by default.** Variants now stay on-brand for the existing surface (same palette, type pairing, visual rhetoric) and explore different expression axes within that identity. Departure from the existing aesthetic only triggers when PRODUCT.md anti-references explicitly call out the current surface, or the user asks for it.
*   **Departure mode derives from brand voice, not a fixed catalog.** The old lane list (Swiss-grid, Terminal, Industrial-signage) caused the model to converge on the same three directions every time. Replaced with a brand-voice derivation: read personality words, imagine physical experiences, derive visual directions.
*   **Parameters ship consistently on large surfaces.** Planning params is part of variant planning. The freeform bias aligns with the budget table: 2-3 knobs per variant for heroes and sections, with 0-param heroes flagged as mistakes rather than judgment calls.
*   **Reflex-reject aesthetic lanes.** Parallel to the font reflex-reject list. Editorial-typographic is the first entry, catching the second-order training reflex where every departure from SaaS-cream defaults to magazine-cover aesthetics.

Skill[v3.0.5](https://impeccable.style/changelog#v3.0.5)April 28, 2026

### Live mode lands valid TSX through the wrap → preview → accept → carbonize loop on Vite/Next React/TSX projects.

Live mode lands valid TSX through the wrap → preview → accept → carbonize loop on Vite/Next React/TSX projects. The wrapper now keeps a single JSX-slot child instead of three adjacent siblings, so it round-trips cleanly inside return (...), array .map(...), and asChild parents. Closes #114, with thanks to @dergachoff.

*   **Live mode lands valid TSX through the wrap → preview → accept → carbonize loop on Vite/Next React/TSX projects.** The wrapper now keeps a single JSX-slot child instead of three adjacent siblings, so it round-trips cleanly inside `return (...)`, array `.map(...)`, and `asChild` parents. Closes [#114](https://github.com/pbakaus/impeccable/issues/114), with thanks to [@dergachoff](https://github.com/dergachoff).
*   **Wrap correctly disambiguates repeated identical-class siblings.** A list of `<Card className="card">` rendered three times used to land on the first one regardless of which the user picked. `live-wrap.mjs` now accepts `--text TEXT` (the picked element's `textContent`) and narrows candidates accordingly.
*   **`live-inject` CSP-meta unwrap now byte-for-byte preserves self-closing tag whitespace.** Common Vite shapes that ship a CSP meta now round-trip cleanly.

Skill[v3.0.4](https://impeccable.style/changelog#v3.0.4)April 28, 2026

### /impeccable craft now treats approved mocks as visual contracts.

/impeccable craft now treats approved mocks as visual contracts. The craft flow requires a mock fidelity inventory before build, maps major visible ingredients to code or assets, and flags missing hero objects, imagery, section structure, nav/CTA treatment, and distinctive motifs as blocking defects unless the user accepted the deviation.

*   **`/impeccable craft` now treats approved mocks as visual contracts.** The craft flow requires a mock fidelity inventory before build, maps major visible ingredients to code or assets, and flags missing hero objects, imagery, section structure, nav/CTA treatment, and distinctive motifs as blocking defects unless the user accepted the deviation.
*   **Image-led brand surfaces can no longer degrade into abstract panels.** Travel, editorial, portfolio, venue, product showcase, entertainment, and education work now requires credible imagery when the approved mock or subject matter calls for them.
*   **Live picker plays nice with modal hosts.** Inside Radix Dialog, Headless UI, vaul, and other portals that lock `body { pointer-events: none }`, the picker chrome had become unclickable. Now defangs outside-handlers at the chrome boundary and forces `pointer-events: auto` on itself. Closes [#113](https://github.com/pbakaus/impeccable/issues/113).

Skill[v3.0.2](https://impeccable.style/changelog#v3.0.2)April 27, 2026

### Claude Code plugin install shrunk by 380×.

Claude Code plugin install shrunk by 380×. The marketplace now ships only the runtime payload (~770 KB) instead of the entire monorepo (291 MB). Plugin source moved from ./ to ./plugin. Reported in #107.

*   **Claude Code plugin install shrunk by 380×.** The marketplace now ships only the runtime payload (~770 KB) instead of the entire monorepo (291 MB). Plugin source moved from `./` to `./plugin`. Reported in [#107](https://github.com/pbakaus/impeccable/issues/107).
*   **Slash commands now register reliably on Claude Code.** The `skills` field in `plugin.json` was missing the trailing slash that the documented schema expects. Reported by three users in [#86](https://github.com/pbakaus/impeccable/issues/86).

Skill[v3.0.1](https://impeccable.style/changelog#v3.0.1)April 24, 2026

### Live mode runs in strict-CSP apps.

Live mode runs in strict-CSP apps. When your HTML carries a Content-Security-Policy meta tag, /impeccable live now silently appends the live-server origin to script-src and connect-src on session start, and reverts the patch verbatim on stop.

*   **Live mode runs in strict-CSP apps.** When your HTML carries a Content-Security-Policy meta tag, `/impeccable live` now silently appends the live-server origin to `script-src` and `connect-src` on session start, and reverts the patch verbatim on stop.
*   **Live mode survives conditional-render content.** Picking an element inside a closed modal, an inactive tab, or a collapsible panel used to wedge live mode when Vite Fast Refresh remounted the parent. Now: a brief upfront heads-up at pick time, plus a contextual toast after Go so variants land the moment the element is back in the DOM.
*   **`/impeccable polish` now a true superset of the retired `/normalize`.** Aligning to the design system is non-optional, drift is named by root cause (missing token, one-off implementation, or conceptual misalignment), and a new Information Architecture & Flow dimension covers progressive disclosure.

Skill[v3.0](https://impeccable.style/changelog#v3.0)April 10, 2026

### Live Mode (Alpha).

Live Mode (Alpha). Run /impeccable live and iterate on your UI in the browser: pick any element, drop a comment or stroke, hit Go, get three production-quality variants swapped in via your framework's HMR, accept the one you want and it writes back to source. Works on Vite, Next.js (including monorepos), SvelteKit, Astro, Nuxt.

*   **Live Mode (Alpha).** Run `/impeccable live` and iterate on your UI in the browser: pick any element, drop a comment or stroke, hit Go, get three production-quality variants swapped in via your framework's HMR, accept the one you want and it writes back to source. Works on Vite, Next.js (including monorepos), SvelteKit, Astro, Nuxt.
*   **Visualize, then build.** Image gen crossed the reference-quality threshold with GPT Image 2, Nano Banana Pro, and Imagen 4 Ultra. `/impeccable shape` drafts a brand toolkit (color, typography, mood board) as real images; `/impeccable craft` pre-renders the hi-fi mock to code toward. Strongest in Codex with GPT 5.5.
*   **PRODUCT.md, shared design memory for your AI.** A single file at your project root that names the audience, brand personality, anti-references, and register (brand vs product). Every command reads it before generating.
*   **DESIGN.md generation, spec-compliant and interoperable.**`/impeccable document` scans your tokens, components, and rendered output and writes a DESIGN.md that follows the [Google Stitch DESIGN.md format](https://stitch.withgoogle.com/docs/design-md/format/).
*   **18 skills became 1 skill with 23 commands.** Every command now lives under `/impeccable`. One entry in your `/` menu instead of 18, a shared design vocabulary, and far less namespace pollution.
*   **Pin your favorites back as shortcuts.** Run `/impeccable pin audit` and `/audit` becomes a standalone command again, without reversing the consolidation.

Skill[v2.1](https://impeccable.style/changelog#v2.1)April 9, 2026

### Streamlined from 21 to 18 commands.

Streamlined from 21 to 18 commands. /arrange renamed to /layout, /normalize merged into /polish, /onboard merged into /harden, and /extract became /impeccable extract.

*   **Streamlined from 21 to 18 commands.**`/arrange` renamed to `/layout`, `/normalize` merged into `/polish`, `/onboard` merged into `/harden`, and `/extract` became `/impeccable extract`.
*   **Automatic cleanup of deprecated skills.** On first load after updating, the skill detects and removes leftover files from renamed or merged commands.

Skill[v2.0](https://impeccable.style/changelog#v2.0)April 8, 2026

### Renamed frontend-design to impeccable.

Renamed frontend-design to impeccable. The core skill now shares its name with the project.

*   **Renamed `frontend-design` to `impeccable`.** The core skill now shares its name with the project.
*   **Skill rewritten against evals.** Fifteen briefs ran through gpt-5.4 and Qwen 3.6 Plus, with and without the skill loaded, then graded side by side. More font and color variety, fewer purple gradients, much better Codex output.
*   **Anti-pattern detection engine.** 28 deterministic rules across typography, color, layout, motion, and quality.
*   **CLI: `npx impeccable detect`.** Scans HTML, CSS, JSX/TSX, Vue, Svelte, and CSS-in-JS. Framework detection, multi-file import tracking, CI-ready JSON output.
*   **Chrome DevTools extension.** One-click detection on any page. Reads live computed styles, surfaces findings in an interactive panel, and highlights elements on the page.
*   **`/critique` got teeth.** Persona sub-agents review in parallel, score against Nielsen's heuristics, run the detector automatically, and open a live browser overlay so you can walk each finding in place.

Skill[v1.x](https://impeccable.style/changelog#v1.x)February 28 – March 18, 2026

### v1.x release history

v1.6.0 Trae (China + International) support. /critique scores against Nielsen's 10 heuristics and persona archetypes. /audit scores 5 dimensions with P0-P3 severity ratings.

*   **v1.6.0** Trae (China + International) support. `/critique` scores against Nielsen's 10 heuristics and persona archetypes. `/audit` scores 5 dimensions with P0-P3 severity ratings.
*   **v1.5.0**`/typeset` (fix typography), `/arrange` (fix layout), `/overdrive` (technically extraordinary effects). Auto design-context gathering via `.impeccable.md`.
*   **v1.3.0** OpenCode and Pi provider support.
*   **v1.2.0** Kiro support. Prefix toggle restored. Audit and critique only suggest installed commands.
*   **v1.1.0** Unified skills architecture. VS Code Copilot and Google Antigravity support. Universal ZIP installer. `/simplify` renamed to `/distill`.
*   **v1.0.0** Initial release. 17 design commands. Cursor, Claude Code, Gemini CLI, and Codex CLI.
