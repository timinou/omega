Title: The missing design vocabulary for agents.

URL Source: https://impeccable.style/designing

Markdown Content:
[Start](https://impeccable.style/designing#start)[Improve](https://impeccable.style/designing#iterate)[Check](https://impeccable.style/designing#polish)[Maintain](https://impeccable.style/designing#maintain)

## Start with what  
you want to make

Describe the page, who it is for, and what someone should be able to do. You do not need a finished brief or the right design vocabulary.

```
/impeccable design a signup page for our monthly book club. Make the next event and how to reserve a seat clear.
```

Impeccable reads the project, asks about decisions it cannot safely infer, and helps you choose a direction before building. Bring references, rough sketches, or a strong idea if you have them.

### Give it context it can reuse

[Init](https://impeccable.style/docs/init) records the product’s audience, purpose, and constraints in `PRODUCT.md`. It reads what is already available so you do not have to explain everything from scratch. For an existing visual system, [document](https://impeccable.style/docs/document) records the design separately in `DESIGN.md`.

**A short product record**
Audience Readers choosing a book-club event.

Main task Understand the next meeting and reserve a seat.

Constraint Use confirmed dates and capacity. Do not invent availability.

Illustrated context for the fictional book-club example. Useful facts give later design choices a basis.

Existing code is useful context too. Missing product context can still lead to the wrong assumptions about the audience or what matters. Keep the saved record current as those facts change.

Use [shape](https://impeccable.style/docs/shape) when you want to agree on a plan and stop before implementation.

### Choose a direction you can see

With a mockup-first (comp-led) workflow, image generation can push the visual direction beyond what the coding model would naturally build. You choose a composition, then Impeccable works toward it in code. That translation loses detail: expect a few rounds of prompting and review to get closer to the mockup.

The Neo Mirai case study shows a generated brand toolkit and page mockup alongside the working site built from them. The conference is fictional.

[Read the Neo Mirai case study](https://impeccable.style/cases/neo-mirai) or [open the working site](https://impeccable.style/neo-mirai/index.html).

To inspect the small details, open the [full-size brand reference](https://impeccable.style/assets/openai_image_2_brand.jpg) or [full-size page mockup](https://impeccable.style/assets/openai_image_2_hifi.jpg).

Can I go straight to code instead?
Yes. The direction picker lets you choose mockups first or go straight to code. You can save a project default and still change the path for an individual session in the picker. Code-led still starts with a concept, but the model builds within its natural visual range. It tends to look more coherent on the first pass, with less ambitious execution.

[Compare mockup first (comp-led) and build directly (code-led)](https://impeccable.style/docs/new-work#review-a-mockup-or-go-straight-to-code), or [enable image generation](https://impeccable.style/docs/image-generation) for your coding tool.

Mockups require an image-generation tool. Impeccable can use a supported tool in your coding environment or an API-backed fallback when configured. It should tell you before using your own API credit. Without image generation, use the code-first path.

The first two Neo Mirai images above were generated with OpenAI GPT Image 2. That is the case study’s tool, not a requirement for using Impeccable.

## Improve what is already there

If the page looks sloppy or obviously AI-generated, say so. You can also name a specific problem: the important number is buried, the form is tiring, or the layout falls apart on a phone. Impeccable can help diagnose it and choose an approach.

```
/impeccable this pricing page feels generic, and it is hard to compare plans. Give it a clearer hierarchy while keeping our brand and pricing accurate.
```

*   **Describe the outcome:** ordinary language is enough. For a change you can name, commands such as [layout](https://impeccable.style/docs/layout), [typeset](https://impeccable.style/docs/typeset), and [colorize](https://impeccable.style/docs/colorize) focus the work.
*   **Ask for a review:**[critique](https://impeccable.style/docs/critique) explains what is holding the design back and recommends where to start. You choose which changes to make.
*   **Compare alternatives:**[generate](https://impeccable.style/docs/generate) takes an element and a direction from chat, then shows variants in your running page. Choose the version to keep in source.
*   **Point at the page:**[Live Mode](https://impeccable.style/live-mode) lets you select elements yourself. Use Steer for a direction that applies across the page.

```
/impeccable generate 3 bold variants of the pricing cards
```

[![Image 1: The preview separates the event introduction from a date-and-reservation group. September 24 is prominent above the time and reservation button. The real Live Mode bar shows comparison arrows, the variant counter, Tune, Accept, and discard controls.](https://impeccable.style/images/tutorials/live/02-compare.png)](https://impeccable.style/images/tutorials/live/02-compare.png)

A separate Live Mode example on an event page: introduction on the left; date, time, and reservation on the right. The date is easier to spot, and the action is grouped with the details needed to decide.

A focused refinement keeps the existing design identity. Say when you want a redesign that departs from it. If a result misses your intent, explain what feels wrong or show a reference; you do not need to accept the agent’s first answer.

## Check the work before release

Choose checks that fit what changed. A new checkout, a rewritten help page, and a color adjustment need different attention.

*   **Review the implementation with [audit](https://impeccable.style/docs/audit):** investigate accessibility, performance, responsive behavior, theming, and anti-patterns.
*   **Make the words clear with [clarify](https://impeccable.style/docs/clarify):** check labels, instructions, errors, and empty states against what people need to understand.
*   **Handle difficult cases with [harden](https://impeccable.style/docs/harden):** look at missing data, long content, failures, and recovery.
*   **Finish the details with [polish](https://impeccable.style/docs/polish):** refine hierarchy, spacing, consistency, and interaction in the working interface.

Give the agent a clear target and describe the states that matter. Review the changes and try the actual task, including on narrow screens and with a keyboard. A clean report is useful evidence; it does not replace using the result.

Looking for a specific check? Browse the [full command reference](https://impeccable.style/docs#command-reference) or the [anti-pattern catalog with visual examples](https://impeccable.style/slop).

## Keep the design consistent as it grows

As features accumulate, similar components can drift apart. Keep shared code and recorded design decisions aligned with the product you are building.

*   **Consolidate repeated patterns with [extract](https://impeccable.style/docs/extract).** Turn recurring designs with the same purpose into shared components and reusable style values, then update their uses. Visual similarity alone is not a reason to merge different behaviors.
*   **Update the visual record with [document](https://impeccable.style/docs/document).** Record the current palette, type, layout, and components in `DESIGN.md` so later work can follow the established system. Update it when the design changes intentionally.
*   **Keep checks close to the work with [hooks](https://impeccable.style/docs/hooks).** Run automated detector checks after relevant agent edits, so supported tools can surface problems while the work is still in progress.

**In the interface**Your usual order Review quantities and delivery before placing it.Review order

**In DESIGN.md**

`colors.action: "#263c32"`

Use the dark green primary button for the main action. Keep secondary actions quieter.

Keep the button’s focus outline visible for keyboard use.

Illustrative excerpt: the record connects a reusable value to how it is used. Document captures established choices; review it so an accident does not become a rule.
