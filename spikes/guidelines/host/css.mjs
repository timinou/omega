// Explorer CSS: injected per mount, removed on dispose (unuse is exact).
// Built on bl-ed's own tokens (snow & coffee, matte pastels; theme.css), so the
// explorer is the editor, not a page inside it. Depth is one tone step, never a shadow.
//
// The visual grammar the explorer teaches (it obeys the rule it shows first):
//   ON          a solid sage dot           off       a hollow ring
//   used        a left rule whose WIDTH grows with applied+promoted (1–5px)
//   fires here  (Try) a filled bar crossing the hairline that marks the threshold
//   needs you   (Inbox) items sit in the inbox; their kind is a colour and a glyph, not a word
export const css = `
.gx { --gx-gap: 12px; --gx-ink-2: var(--roast); --gx-ink-3: var(--crema); --gx-line: color-mix(in srgb, var(--latte) 55%, transparent);
  position: absolute; inset: 0; display: flex; flex-direction: column; font-family: var(--font-text); font-size: 14px; line-height: 1.45; color: var(--espresso); background: var(--snow); }
.gx * { box-sizing: border-box; }
.gx button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
.gx kbd { font-family: var(--font-code); font-size: 11.5px; padding: 0 5px; border-radius: 4px; background: var(--snow-2); box-shadow: inset 0 0 0 1px var(--oat); color: var(--roast); white-space: nowrap; }

/* header: three places, the current one is the one that is not faded */
.gx-head { flex: none; display: flex; align-items: baseline; gap: 22px; padding: 12px 18px 8px; border-bottom: 1px solid var(--gx-line); }
.gx-src { font-family: var(--font-code); font-size: 12px; color: var(--gx-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.gx-src b { font-weight: 500; color: var(--roast); }
.gx-tabs { display: flex; gap: 16px; }
.gx-tab { color: var(--gx-ink-3); padding-bottom: 3px; border-bottom: 2px solid transparent; }
.gx-tab:hover { color: var(--roast); }
.gx-tab[aria-selected="true"] { color: var(--espresso); border-bottom-color: var(--latte); font-weight: 600; }
.gx-tab .n { font-family: var(--font-code); font-size: 12px; margin-left: 4px; color: var(--apricot); }
.gx-head .sp { flex: 1; }
.gx-hint { color: var(--gx-ink-3); font-size: 12.5px; display: flex; gap: 10px; align-items: center; }
.gx-hint button:hover { color: var(--espresso); }

.gx-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(220px, 34%) 1fr; }
.gx-body.one { grid-template-columns: 1fr; }
.gx-list { overflow: auto; border-right: 1px solid var(--gx-line); padding: 6px 0 18px; }
.gx-detail { overflow: auto; padding: 16px 22px 28px; }

/* list: a rule per row; weight of the left rule = use */
.gx-group { font-size: 11.5px; letter-spacing: .08em; text-transform: lowercase; color: var(--gx-ink-3); padding: 12px 16px 4px; }
.gx-row { display: grid; grid-template-columns: 14px 1fr auto; gap: 8px; align-items: baseline; width: 100%; text-align: left; padding: 6px 14px 6px 12px;
  border-left: var(--use, 1px) solid var(--oat); }
.gx-row:hover { background: var(--snow-2); }
.gx-row[aria-current="true"] { background: var(--oat); border-left-color: var(--mocha); }
.gx-row .name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gx-row.off .name { color: var(--gx-ink-2); font-weight: 400; }
.gx-row .meta { font-family: var(--font-code); font-size: 11.5px; color: var(--gx-ink-3); }
.gx-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; transform: translateY(-1px); }
.gx-dot.on { background: var(--sage); }
.gx-dot.off { box-shadow: inset 0 0 0 1.5px var(--latte); }
.gx-row .warn { color: var(--rose); }

/* detail: reading first — the rule in the text face, large; the rest is quieter */
.gx-detail h2 { font-size: 20px; font-weight: 600; letter-spacing: -.005em; margin: 0 0 4px; display: flex; align-items: center; gap: 10px; }
.gx-sub { color: var(--gx-ink-3); font-size: 12.5px; display: flex; flex-wrap: wrap; gap: 4px 14px; margin-bottom: 14px; }
.gx-sub code { font-family: var(--font-code); }
.gx-rule { font-size: 16px; line-height: 1.55; max-width: 62ch; margin: 0 0 18px; padding-left: 14px; border-left: 3px solid var(--latte); }
.gx-switch { display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px; border-radius: var(--radius); background: var(--snow-2); box-shadow: inset 0 0 0 1px var(--oat); }
.gx-switch:hover { box-shadow: inset 0 0 0 1px var(--latte); }
.gx-switch.on { background: var(--sage-bg); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sage) 45%, transparent); }
.gx-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 14px 0 18px; }
.gx-actions .k { color: var(--gx-ink-3); font-size: 12.5px; }
.gx-actions .sp { flex: 1; }
.gx-sec { margin: 18px 0 6px; font-size: 12px; letter-spacing: .08em; text-transform: lowercase; color: var(--gx-ink-3); display: flex; gap: 8px; align-items: baseline; }
.gx-sec .why { letter-spacing: 0; text-transform: none; font-size: 12.5px; }
.gx ul.gx-l { list-style: none; margin: 0; padding: 0; }
.gx ul.gx-l li { padding: 3px 0 3px 14px; position: relative; max-width: 70ch; }
.gx ul.gx-l li::before { content: ""; position: absolute; left: 2px; top: .75em; width: 5px; height: 1px; background: var(--mocha); }
.gx ul.gx-l.not li { color: var(--gx-ink-2); }
.gx ul.gx-l.not li::before { background: var(--rose); }
.gx ul.gx-l.ex li { font-family: var(--font-code); font-size: 12.5px; color: var(--roast); }
.gx ul.gx-l.ex li .d { color: var(--gx-ink-3); margin-right: 6px; }
.gx-props { font-family: var(--font-code); font-size: 12.5px; color: var(--roast); }

/* the use strip: one mark per state that ever happened, sized by count */
.gx-uses { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--gx-ink-2); }
.gx-uses span b { font-family: var(--font-code); font-weight: 600; color: var(--espresso); margin-right: 3px; }
.gx-uses .z { color: var(--gx-ink-3); }
.gx-uses .z b { color: var(--gx-ink-3); font-weight: 400; }

/* inbox: kind is a colour + a glyph */
.gx-item { display: grid; grid-template-columns: 18px 1fr; gap: 8px; width: 100%; text-align: left; padding: 8px 14px 8px 12px; border-left: 3px solid transparent; }
.gx-item:hover { background: var(--snow-2); }
.gx-item[aria-current="true"] { background: var(--oat); }
.gx-item .g { font-size: 13px; line-height: 1.4; }
.gx-item .t { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.gx-item .m { font-size: 12px; color: var(--gx-ink-3); font-family: var(--font-code); }
.k-ready { border-left-color: var(--sage); } .k-ready .g { color: var(--sage); }
.k-proposed { border-left-color: var(--lavender); } .k-proposed .g { color: var(--lavender); }
.k-misfire { border-left-color: var(--butter); } .k-misfire .g { color: var(--butter); }
.k-violated { border-left-color: var(--rose); } .k-violated .g { color: var(--rose); }
.gx-quote { font-family: var(--font-code); font-size: 13px; background: var(--snow-2); border-radius: var(--radius); padding: 10px 12px; margin: 8px 0 14px; white-space: pre-wrap; max-width: 76ch; }
.gx-btn { padding: 5px 12px; border-radius: var(--radius); background: var(--snow-2); box-shadow: inset 0 0 0 1px var(--oat); }
.gx-btn:hover { box-shadow: inset 0 0 0 1px var(--latte); }
.gx-btn.primary { background: var(--sage-bg); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sage) 45%, transparent); }
.gx-btn:disabled { opacity: .45; cursor: default; }

/* try: a field and a ruler. The bar is the score; the hairline is the threshold */
.gx-try { padding: 16px 22px; overflow: auto; }
.gx-try form { display: flex; gap: 10px; margin-bottom: 6px; }
.gx-try form .gx-btn { flex: none; padding: 0 18px; }
.gx-try input { flex: 1; font: 15px var(--font-text); padding: 8px 12px; border-radius: var(--radius); border: 0; background: var(--snow-2); box-shadow: inset 0 0 0 1px var(--oat); color: var(--espresso); }
.gx-try input:focus { outline: none; box-shadow: inset 0 0 0 1.5px var(--mocha); }
.gx-try .lede { color: var(--gx-ink-3); font-size: 12.5px; margin: 0 0 14px; }
.gx-meter { display: grid; grid-template-columns: minmax(140px, 28%) 1fr 48px; column-gap: 12px; row-gap: 1px; align-items: center; padding: 7px 0; width: 100%; text-align: left; border-bottom: 1px solid color-mix(in srgb, var(--oat) 50%, transparent); }
.gx-meter:hover .nm { color: var(--espresso); text-decoration: underline; text-decoration-color: var(--latte); }
.gx-meter .nm { color: var(--gx-ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gx-meter.fire .nm { color: var(--espresso); font-weight: 600; }
.gx-meter .bar { position: relative; height: 8px; border-radius: 4px; background: var(--snow-2); }
.gx-meter .bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px; background: var(--latte); }
.gx-meter.fire .bar i { background: var(--sage); }
.gx-meter.fire.off .bar i { background: repeating-linear-gradient(90deg, var(--sage) 0 6px, transparent 6px 9px); }
.gx-meter .bar u { position: absolute; top: -4px; bottom: -4px; width: 1px; background: var(--mocha); }
.gx-meter .sc { font-family: var(--font-code); font-size: 12px; color: var(--gx-ink-3); text-align: right; }
.gx-meter .why { grid-column: 2 / 4; font-size: 12px; color: var(--gx-ink-3); }

/* empty, busy, error */
.gx-empty { max-width: 60ch; padding: 26px 22px; color: var(--gx-ink-2); }
.gx-empty h3 { font-size: 16px; color: var(--espresso); margin: 0 0 6px; font-weight: 600; }
.gx-err { flex: none; margin: 10px 18px 0; padding: 8px 12px; border-radius: var(--radius); background: var(--rose-bg); color: var(--espresso); }
.gx-busy { opacity: .55; transition: opacity .12s ease-out; }

/* footer: the keys for THIS place, always visible, never more than one line */
.gx-foot { flex: none; display: flex; gap: 16px; white-space: nowrap; overflow: hidden; padding: 7px 18px; border-top: 1px solid var(--gx-line); font-size: 12.5px; color: var(--gx-ink-3); }
.gx-foot span { display: inline-flex; gap: 6px; align-items: center; }

/* the guide: an overlay card that teaches the place in one look */
.gx-guide { position: absolute; top: 50px; right: 16px; width: min(520px, calc(100% - 32px)); max-height: calc(100% - 66px); overflow: auto;
  font-family: var(--font-text); font-size: 13.5px; line-height: 1.5; color: var(--espresso); background: var(--snow); border-radius: 10px;
  box-shadow: 0 0 0 1px var(--oat), 0 10px 28px color-mix(in srgb, var(--espresso) 12%, transparent); padding: 18px 20px 16px; z-index: 5; }
.gx-guide h3 { margin: 0 0 8px; font-size: 15px; font-weight: 650; }
.gx-guide p { margin: 0 0 8px; color: var(--roast); }
.gx-legend { display: grid; grid-template-columns: 18px 1fr 18px 1fr; gap: 6px 10px; align-items: center; margin: 12px 0 14px; padding: 10px 12px; border-radius: var(--radius); background: var(--snow-2); color: var(--roast); }
.gx-legend .rule { justify-self: center; width: 0; height: 15px; border-left: 4px solid var(--mocha); }
.gx-legend .g { justify-self: center; }
.gx-guide dl { display: grid; grid-template-columns: max-content 1fr; gap: 7px 14px; margin: 0; align-items: baseline; }
.gx-guide dt { display: flex; gap: 4px; justify-content: flex-end; align-items: baseline; }
.gx-guide dd { margin: 0; color: var(--roast); }
.gx-guide .ok { margin-top: 14px; display: flex; justify-content: flex-end; }
/* the pane is a grid cell of the frame; the view body is unpositioned, so the
   explorer sizes itself to the pane: fill it, scroll inside, never the page */
.pane:has(> .view-body > .gx-wrap) { position: relative; min-height: 0; overflow: hidden; }
.gx-wrap { position: absolute; inset: 0; }
`;
