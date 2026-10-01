Title: The missing design vocabulary for agents.

URL Source: https://impeccable.style/docs/critique

Markdown Content:
Use `critique` when a page feels generic, confusing, or hard to use, and you’re unsure why. Impeccable reviews the design, explains the problems, and recommends where to start. You can use it while work is still taking shape; say what’s unfinished so the review has the right context.

## Try it

`/impeccable critique the checkout page`

Be specific about the page or flow. Include the main task if it isn’t obvious: “Customers need to check the total before they pay.”

**The problem**

Order summary Pay now Total · $48.00

**The suggested fix**

Order summary Total **$48.00**Pay $48.00

Illustrated finding: the payment button draws attention before the total. Put the total first and show the amount on the button. Critique recommends the change; you choose whether to make it.

## How it works

Impeccable combines a design review with automated checks for known anti-patterns. It reads the source and, when browser tools are available, inspects the rendered page. The report explains what was checked and includes:

*   **Design quality:** where the page feels intentional, generic, or inconsistent.
*   **Usability:** how clearly the page guides people through the task, with scores and reasons.
*   **Different perspectives:** simulated walkthroughs that suggest what to investigate with real users.
*   **Priorities:** strengths to preserve, issues to fix, and questions that may change the direction.

## Act on the findings

**Critique leaves the design unchanged.** Read the priority issues, answer any questions that affect the work, then ask for the fixes you want:

`Move the total above the payment button and include the amount in its label. Keep the rest of the checkout as it is.`

For a broader refinement pass, use [polish](https://impeccable.style/docs/polish). For clutter or competing actions, use [distill](https://impeccable.style/docs/distill). Use [audit](https://impeccable.style/docs/audit) to investigate implementation quality.

Scores and saved reviews
Usability checks score from 0 to 4. Checks that don’t apply are marked `n/a`, and the total adjusts accordingly. Read the reasons behind the scores to decide what matters for your page.

Impeccable saves the report under `.impeccable/critique/`. Later reviews can refer to that history, and polish can pick up current priority findings without a copy-and-paste. If the page has changed substantially, run a fresh critique before relying on the old findings.
