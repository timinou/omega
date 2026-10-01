Title: The missing design vocabulary for agents.

URL Source: https://impeccable.style/docs/detector

Markdown Content:
On this page 5 sections
1.   [Run a scan](https://impeccable.style/docs/detector#run-a-scan)
2.   [Read a finding](https://impeccable.style/docs/detector#read-a-finding)
3.   [Check against your design system](https://impeccable.style/docs/detector#check-against-your-design-system)
4.   [Keep intentional choices](https://impeccable.style/docs/detector#keep-intentional-choices)
5.   [More scan options](https://impeccable.style/docs/detector#more-scan-options)

Scan for known design problems without starting an AI conversation. The detector checks code and rendered pages for issues such as low contrast, overflowing text, common AI design patterns, and drift from your design system.

## Run a scan

From your project folder:

`npx impeccable detect src/`

Give it one file for a focused check, or a URL to inspect a rendered page:

```
npx impeccable detect src/components/Card.tsx
npx impeccable detect http://localhost:3000
```

**Source scans** inspect UI code and styles. **URL scans** open the page in a browser, where checks can use the rendered layout. Choose the target that matches what you want to inspect.

## Read a finding

Each finding names the rule, identifies the relevant code or element, and explains what to reconsider. Here is a real finding from a small CSS example:

**In example.css**

```
h1 {
  background: linear-gradient(90deg, #ff3399, #8833ff);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
}
```

Detector finding**`gradient-text`**

Line 3 · `background-clip: text + gradient`

The detector recommends a solid text color. Decide whether the gradient serves a purpose in this design.

The rule and location are from an actual scan. The explanation above is shortened for this example.

Fix a real problem, or record a narrow exception for an intentional choice. A clean scan means these checks found no reportable problem; [critique](https://impeccable.style/docs/critique) can assess the wider design.

### Exit codes and automation

Use JSON when a script or CI job needs the results:

`npx impeccable detect --json src/`

| Code | Meaning |
| --- | --- |
| `0` | Scan completed with no primary findings. Advisories may still appear. |
| `2` | Scan completed with primary findings. |
| `1` | At least one target could not be scanned. |

**Primary findings** determine the finding count and exit code. **Advisories** are additional observations; they do not make a scan fail. Treat code `1` as a scan failure, even if other targets produced findings.

Save output or hide advisories

JSON goes to standard output. Human-readable findings go to standard error:

```
npx impeccable detect --json src/ > findings.json
npx impeccable detect src/ 2> findings.txt
```

`--quiet` reduces text output to the final count. `--no-advisory` hides advisories for one scan.

## Check against your design system

When a local `DESIGN.md` exists, the detector uses it to check documented fonts, colors, corner radii, and type sizes. The `.impeccable/design.json` companion file adds structured token and type-scale data.

Keep the record current with [document](https://impeccable.style/docs/document):

`/impeccable document`

For one scan without design-system checks:

`npx impeccable detect --no-design-system src/`

## Keep intentional choices

Ignores apply to both manual scans and [design hooks](https://impeccable.style/docs/hooks). Record the specific value when possible:

`npx impeccable ignores add-value overused-font Inter --reason "Brand font"`

That keeps the rule active for other fonts. [Configuration & ignores](https://impeccable.style/docs/config) covers file scopes, private exceptions, and removing an ignore later.

## More scan options

File types and server-side templates

Folders are searched for supported UI and style files. HTML scans include linked local CSS. JSX, TSX, Vue, Svelte, Astro, and stylesheet files receive source checks.

Declare extra template extensions, such as Blade or ERB, under `detector.extensions`. See [server-side templates](https://impeccable.style/docs/config#server-side-templates).

The detector checks web interfaces. For native iOS or Android work, use [audit](https://impeccable.style/docs/audit) for a review suited to the platform.

Viewport, design domains, and piped input

URL scans use a 1280 × 800 viewport by default. Choose a narrower size to check a mobile layout:

`npx impeccable detect --viewport 390x844 http://localhost:3000`

Limit checks to a design domain, or combine domains with commas:

```
npx impeccable detect --scope type src/
npx impeccable detect --scope type,layout src/
```

With piped text and no target, the detector reads standard input:

`cat component.css | npx impeccable detect`

Project settings and scans without ignores

Manual scans read `.impeccable/config.json` and `.impeccable/config.local.json`. Turning hooks off does not disable manual scans.

`--no-inline-ignores` bypasses in-file ignore comments but keeps config ignores. `--no-config` bypasses both, along with project configuration and local design-system context.

To attach an exception to a file that leaves the repository, use an [inline ignore comment](https://impeccable.style/docs/config#inline-ignore-comments).
