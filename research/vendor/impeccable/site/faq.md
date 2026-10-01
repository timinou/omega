Title: The missing design vocabulary for agents.

URL Source: https://impeccable.style/faq

Markdown Content:
## Frequently asked questions

Get set up, keep Impeccable current, and find a fix when something isn’t working.

I’m new to AI coding tools. Where do I start?

Open your project in a [supported coding tool](https://impeccable.style/tutorials/getting-started#supported-tools), then follow [Getting started](https://impeccable.style/tutorials/getting-started). It walks you through installation and project context, then lets you choose to build something new or improve an existing page.

You don’t need design experience or a vocabulary of design terms. Describe what you’re making, who it’s for, and what feels wrong. For example, in your agent chat:

```
/impeccable the important information gets lost on this dashboard. Help me make it clearer.
```

If you’re new to the coding tool itself, start with its guide to opening a project and talking to the agent. You can learn Impeccable as you work.

How do I install Impeccable, or use the downloaded files?

**In your terminal**, open the project folder and run:

```
npx impeccable install
```

Choose your coding tool and whether to install for this project or all your projects. The installer selects the matching build. It requires Node.js 22.18 or later. Reload your coding tool after installation.

**Downloaded a ZIP?** Copy its contents into your project root, including the hidden folders. Put them alongside `package.json` or `src/`, rather than inside an extra enclosing folder. The archive’s `README.txt` identifies the folders for each tool.

For example, a Codex project installation includes:

```
your-project/
├── .agents/
│   └── skills/
│       └── impeccable/
│           └── SKILL.md
├── package.json
└── src/
```

On macOS, press **Command–Shift–.** in Finder to show hidden folders. For other installation methods, see [Install Impeccable](https://impeccable.style/#downloads).

How do I update Impeccable?

For an installation made with the Impeccable installer, run this **in your terminal**:

```
npx impeccable update
```

Run it from your project folder. If you have both project and user installations, choose which to update. You can specify `--project` or `--user` directly.

To check for an update first, run `npx impeccable check`. Updating replaces Impeccable’s installed files; it leaves your project’s `PRODUCT.md` and `DESIGN.md` alone.

**Installed another way?** Update through the same route:

*   **Marketplace or plugin:** use your coding tool’s plugin manager.
*   **npx skills:** run `npx skills add pbakaus/impeccable` again. This installs the shared build; the Impeccable installer selects a build for your tool.
*   **ZIP:** download the current archive from the homepage and replace the installed Impeccable files.

Reload your coding tool afterward. Use `npx impeccable install --force` only when you intend to replace an existing installation.

Impeccable isn’t appearing or responding. What should I check?

1.   **Check the installation.** Confirm that you selected the coding tool you’re using. A project installation must be in the project you have open. If you copied a ZIP, check the hidden folders too.
2.   **Reload the tool.** Newly installed skills may need a reload or a fresh session before they appear.
3.   **Call Impeccable directly.** In agent chat, try:

```
/impeccable
```

The design commands belong to this main skill. You do not need separate installations for `audit`, `polish`, or `critique`.

Use the command-box switch for Codex syntax. In Codex CLI or the IDE extension, you can also open `/skills` or type `$` to find installed skills. [Codex skill guidance](https://learn.chatgpt.com/docs/build-skills#how-codex-uses-skills).

**Still missing?** Check your tool’s skill settings and discovery list:

*   **Cursor:** look for Impeccable among the discovered skills. [Cursor skills](https://cursor.com/docs/skills).
*   **Gemini CLI:** run `/skills list`; use `/skills reload` after changing an installation. [Gemini skill management](https://geminicli.com/docs/cli/using-agent-skills/).
*   **GitHub Copilot:** check that agent skills are available in the environment you’re using. [Copilot agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills).

If Impeccable is available but its automatic checks are silent, follow [the hook setup guide](https://impeccable.style/docs/hooks#allow-the-hook-in-your-harness). Skill discovery and permission to run a hook are separate checks.

Can I make a shortcut for a command I use often?

Pin it from **agent chat**:

```
/impeccable pin critique
```

This adds a shortcut for `critique` in your coding tool. It forwards the request to Impeccable, so improvements to the main skill carry through. You can also pin commands such as `polish`, `audit`, and `live`.

To remove the shortcut:

```
/impeccable unpin critique
```

Removing a shortcut leaves the main command available. Use the shortcut name shown in your coding tool’s skill or command list.

When should I use generate instead of live?

Use [generate](https://impeccable.style/docs/generate) when you can name the element and the direction you want to explore. Run this in your agent chat:

```
/impeccable generate 3 bold variants of the pricing cards
```

The agent finds the element and shows alternatives in your running page. Compare them, tune when controls are available, and accept one into source or discard the set.

Use [live](https://impeccable.style/docs/live) for an ongoing browser session where you pick elements yourself, annotate them, or use Steer for page-wide requests. Both commands work with web projects and follow your existing design identity unless you ask to change it.

Is Impeccable free?

Yes. Impeccable’s public skills, commands, CLI, and detection engine are free and open source under the [Apache 2.0 license](https://github.com/pbakaus/impeccable/blob/main/LICENSE).

Your coding tool or model provider may charge for usage, including image generation. Those costs are separate from Impeccable. See [Enable image generation](https://impeccable.style/docs/image-generation) for built-in support, the OpenAI API fallback, and billing guidance.
