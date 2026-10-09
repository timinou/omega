import { esc, ext, fmtDate, addDays, fmtStamp, ago, PRESETS, CHECKS } from './util.mjs';
import { card, detail, inquiry, sourceBadge, capBadge, locBadge } from './cards.mjs';
const msg = (m) => (m ? `<div class="${m.kind === 'err' ? 'tv-err' : 'tv-ok'}" role="${m.kind === 'err' ? 'alert' : 'status'}">${esc(m.text)}</div>` : '');
export function strip(trip) {
  const nights = trip.nightsOptions.map((n) => ({ n, out: addDays(trip.checkIn, n) }));
  const chip = (k, v, cls = '') => `<div class="tv-chip ${cls}"><small>${esc(k)}</small><b>${v}</b></div>`;
  return `<div class="tv-strip" aria-label="Trip">${chip('Destination', esc(trip.destination))}${chip('Check-in', esc(fmtDate(trip.checkIn)))}
   ${chip('Check-out', nights.map((x) => `${esc(fmtDate(x.out))} <small style="display:inline">(${x.n} nights)</small>`).join('<br>'))}
   ${chip('Party', `${trip.adults} adults · ${trip.children} children<br><small style="display:inline">${trip.totalGuests} guests</small>`)}
   ${chip('Budget', trip.budget.unlimited ? 'Unlimited' : esc(trip.budget.max + ' ' + trip.budget.currency))}
   ${chip('Rooms & ages', trip.groups.every((g) => !(g.childAges || []).length) ? 'Child ages and room split not yet entered' : 'Entered', 'unknown')}</div>`;
}
export function nav(tab, counts, store) {
  const t = (id, label, n) => `<button data-act="tab" data-tab="${id}" class="${tab === id ? 'on' : ''}" aria-current="${tab === id}">${label}${n != null ? `<span class="count">${n}</span>` : ''}</button>`;
  return `<nav class="tv-nav" aria-label="Travel desk">${t('discover', 'Discover', counts.props)}${t('shortlist', 'Shortlist', counts.short)}${t('compare', 'Compare', counts.cmp)}${t('trip', 'Trip &amp; party')}${t('notes', 'Notes &amp; enquiry')}<span class="sp"></span>
   <button data-act="refresh-all" ${store.s.busy.all ? 'disabled' : ''} class="${store.s.busy.all ? 'tv-busy' : ''}" title="Re-check every candidate, reusing reads from the last 30 minutes">Refresh all</button><button data-act="force-all" ${store.s.busy.all ? 'disabled' : ''} title="Fetch every source again">Force all</button><button data-act="research" title="Open an Omega task with this desk as context">＋ Omega research</button></nav>`;
}
export function discover(store, ctx) {
  const { s } = store, d = s.data, q = s.query, st = s.discover;
  const all = d.listings, props = all.filter((l) => l.kind === 'property'), cols = all.filter((l) => l.kind === 'collection'), exc = all.filter((l) => l.kind === 'excluded');
  const inT = props.filter((l) => l.location.status !== 'outside'), out = props.filter((l) => l.location.status === 'outside');
  const riads = inT.filter((l) => l.propertyType === 'riad'), others = inT.filter((l) => l.propertyType !== 'riad');
  const top = inT.filter((l) => l.suitability !== 'unsuitable').slice(0, 3);
  const c = (l) => card(l, { selected: ctx.selected === l.id, compared: ctx.compare.includes(l.id), now: ctx.now });
  const sec = (title, lede, items, empty) => `<section class="tv-sec"><h2>${title} <span class="tv-note">${items.length}</span></h2><p class="lede">${lede}</p>${items.map(c).join('') || `<div class="tv-empty">${empty}</div>`}</section>`;
  const prog = st?.state === 'loading' ? `<div class="tv-ok tv-busy" role="status">Searching the web with OpenRouter for “${esc(st.query)}”… this can take up to a minute.</div>` : st?.state === 'error' ? `<div class="tv-err" role="alert">Search failed: ${esc(st.error)}<br>Your query is still in the field.</div>` : '';
  const ans = st?.answer?.text ? `<details><summary>Model-written search summary (not evidence)</summary><p class="tv-note">${esc(st.answer.text)}</p></details>` : '';
  return `${msg(s.msg)}<section class="tv-form"><form data-form="search"><label for="tv-q">Find more places (live web search)</label><div class="tv-search"><input id="tv-q" data-draft="query" value="${esc(q)}" placeholder="e.g. riad Essaouira sleeps 20 whole property" autocomplete="off"><button class="primary ${s.busy.discover ? 'tv-busy' : ''}" ${s.busy.discover ? 'disabled' : ''} type="submit">Search</button><button type="button" data-act="force-search" ${s.busy.discover ? 'disabled' : ''} title="Ask the live search again instead of reusing a result from the last hour">Search fresh</button></div></form>
   <div class="tv-presets">${PRESETS.map(([n, t], i) => `<button data-act="preset" data-i="${i}">${esc(n)}</button>`).join('')}</div>${prog}${ans}
   <form data-form="addurl" style="margin-top:10px"><label for="tv-u">Add a listing URL you found</label><div class="tv-search"><input id="tv-u" data-draft="addUrl" value="${esc(s.addUrl)}" placeholder="https://…"><button type="submit">Add</button></div></form></section>
   ${top.length ? `<section class="tv-sec"><h2>Most relevant now</h2><p class="lede">Ranked by: single property → inside the target area → stated capacity → riad before villa → source health. Capacity and link status are separate facts, and nothing here is verified as available.</p>${top.map(c).join('')}</section>` : ''}
   ${sec('Riads', 'Candidates whose own page or title says riad.', riads, 'No riad candidates yet. Search above.')}
   ${sec('Villas &amp; other properties', 'Separate from riads: usually outside the medina, different access and noise.', others, 'None.')}
   ${out.length ? sec('Outside the target area', 'Names a place far from Essaouira (e.g. Mirleft). Kept for reference, never ranked as a match even if capacity looks good.', out, '') : ''}
   ${sec('Collections &amp; search pages', 'Pages listing many properties. Their numbers are never one property\'s capacity. Open one to find real listings, then add them.', cols, 'None.')}
   ${exc.length ? `<details><summary>${exc.length} excluded (for sale / not a property)</summary>${exc.map(c).join('')}</details>` : ''}
   <section class="tv-sec"><h2>Recent searches</h2><ul class="tv-list">${(d.searches || []).slice().reverse().map((x) => `<li>${esc(x.query)} <span class="tv-note">· ${esc(fmtStamp(x.at))} · ${x.citationCount} sources</span></li>`).join('') || '<li class="tv-unk">No searches yet.</li>'}</ul></section>`;
}
export function shortlist(store, ctx) {
  const ls = store.s.data.listings.filter((l) => l.shortlisted);
  return `${msg(store.s.msg)}<section class="tv-sec"><h2>Shortlist</h2><p class="lede">Saved on the service; survives restarts. Tick “Compare” on up to four.</p>${ls.map((l) => card(l, { selected: ctx.selected === l.id, compared: ctx.compare.includes(l.id), now: ctx.now })).join('') || '<div class="tv-empty">Nothing shortlisted yet. Use ☆ Shortlist on a candidate.</div>'}</section>`;
}
const cell = (v, unknown) => (v ? v : `<span class="tv-unk">${unknown}</span>`);
export function compare(store, ctx) {
  const d = store.s.data, trip = d.trip, sh = d.listings.filter((l) => l.shortlisted);
  const ls = (ctx.compare.length ? ctx.compare : sh.map((l) => l.id)).map((id) => d.listings.find((l) => l.id === id)).filter(Boolean).slice(0, 4);
  if (!ls.length) return `${msg(store.s.msg)}<div class="tv-empty">Shortlist two or more places, then compare them here against all ${trip.totalGuests} guests.</div>`;
  const fact = (l, k, name) => { const f = l.facts[k] || { status: 'unknown' }; return f.status === 'mentioned' ? `<div class="tv-q">“${esc(f.excerpt)}”</div>` : '<span class="tv-unk">Unknown, ask</span>'; };
  const rows = [
    [`Fits ${trip.totalGuests} guests`, (l) => capBadge(l) + (l.capacity.evidence ? `<div class="tv-q">“${esc(l.capacity.evidence.excerpt)}”<small>${l.capacity.evidence.source === 'manual' ? 'user-provided' : 'page text'}</small></div>` : '')],
    ['Location', (l) => locBadge(l)], ['Type', (l) => esc(l.propertyType === 'other' ? l.kindLabel : l.propertyType)],
    ['Private / whole-property use', (l) => fact(l, 'privateUse')], ['Bedrooms / rooms', (l) => fact(l, 'bedrooms')], ['Access: logistics mentions', (l) => fact(l, 'access')], ['Step-free / accessibility', (l) => fact(l, 'stepFree')], ['Heating (December)', (l) => fact(l, 'heating')], ['Pool &amp; child safety', (l) => fact(l, 'pool') + '<div class="tv-note">Safety measures are never inferred</div>'],
    ['Price', () => '<span class="tv-unk">Unknown, not verified</span>'], [`Availability ${esc(trip.checkIn)}`, () => '<span class="tv-unk">Unknown, not verified</span>'],
    ['Source / link', (l) => sourceBadge(l) + `<div class="tv-note">${esc(ago(l.checkedAt, ctx.now))}</div>`],
    ['Actions', (l) => `<button data-act="inspect" data-id="${esc(l.id)}">Inspect</button> <button data-act="select" data-id="${esc(l.id)}">Details</button> ${ext(l.finalUrl || l.url, 'Link')}`],
  ];
  return `${msg(store.s.msg)}<section class="tv-sec"><h2>Compare</h2><p class="lede">Facts marked unknown are things no source has shown yet. Quoted text is from the page or from you.</p><div class="tv-scroll"><table class="tv-table"><thead><tr><th class="crit"></th>${ls.map((l) => `<th>${esc(l.title)}</th>`).join('')}</tr></thead><tbody>${rows.map(([name, fn]) => `<tr><td class="crit">${name}</td>${ls.map((l) => `<td>${cell(fn(l), 'Unknown')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
}
export function notes(store, ctx) {
  const d = store.s.data, trip = d.trip, sh = d.listings.filter((l) => l.shortlisted);
  const sel = d.listings.find((l) => l.id === ctx.selected);
  const one = (l) => `<div class="tv-card"><h3>${esc(l.title)}</h3>${CHECKS.map(([k, t]) => `<label class="check"><input type="checkbox" data-act="check" data-id="${esc(l.id)}" data-key="${k}" ${l.checklist[k] ? 'checked' : ''}> <span>${esc(t)}${l.checklist[k] ? ` <small class="tv-note">asked ${esc(ago(l.checklist[k], ctx.now))}</small>` : ''}</span></label>`).join('')}
   <details><summary>Draft enquiry (copy; nothing is sent)</summary><textarea class="tv-draft" readonly aria-label="Draft enquiry">${esc(inquiry(l, trip).replace(/\\n/g, '\n'))}</textarea></details>
   <ul class="tv-list">${l.notes.map((n) => `<li>${esc(n.text)} <span class="tv-note">${esc(fmtStamp(n.at))}</span></li>`).join('')}</ul>
   <form data-form="note" data-id="${esc(l.id)}"><label>Note<textarea data-draft="note-${esc(l.id)}">${esc(store.s.drafts['note-' + l.id] ?? '')}</textarea></label><div class="tv-actions"><button type="submit">Save note</button></div></form></div>`;
  const ls = sh.length ? sh : sel ? [sel] : [];
  return `${msg(store.s.msg)}<section class="tv-sec"><h2>Notes &amp; enquiry checklist</h2><p class="lede">A draft only: this desk never contacts owners, books or pays. Tick items once the owner has answered, and keep what they said in a note.</p>${ls.map(one).join('') || '<div class="tv-empty">Shortlist or select a place to keep notes and an enquiry checklist.</div>'}</section>`;
}
export function tripForm(store) {
  const { s } = store, t = s.tripDraft || structuredClone(s.data.trip), n = (v) => (v == null ? '' : v);
  const gs = t.groups.map((g, i) => `<div class="tv-card"><div class="grid"><label>Group name<input data-trip="g.${i}.label" value="${esc(g.label)}"></label><label>Adults<input type="number" min="0" data-trip="g.${i}.adults" value="${n(g.adults)}"></label><label>Children<input type="number" min="0" data-trip="g.${i}.children" value="${n(g.children)}"></label><label>Child ages (unknown? leave empty)<input data-trip="g.${i}.ages" value="${esc((g.childAges || []).join(', '))}" placeholder="e.g. 3, 7, 12"></label></div>${t.groups.length > 1 ? `<div class="tv-actions"><button data-act="del-group" data-i="${i}">Remove group</button></div>` : ''}</div>`).join('');
  const sumA = t.groups.reduce((a, g) => a + (+g.adults || 0), 0), sumC = t.groups.reduce((a, g) => a + (+g.children || 0), 0);
  return `${msg(s.msg)}<section class="tv-sec"><h2>Trip &amp; party</h2><p class="lede">Confirmed: ${esc(fmtDate('2026-12-19'))}, 4 or 5 nights, 11 adults and 9 children (20). Room allocation and child ages are not known yet, so they stay empty until you add them.</p>
   ${s.tripErrors.length ? `<div class="tv-err" role="alert"><b>Not saved:</b><ul>${s.tripErrors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
   <form data-form="trip" class="tv-form"><div class="grid"><label>Destination<input data-trip="destination" value="${esc(t.destination)}"></label><label>Check-in<input type="date" data-trip="checkIn" value="${esc(t.checkIn)}"></label><label>Nights options (comma separated)<input data-trip="nights" value="${esc(t.nightsOptions.join(', '))}"></label>
   <label>Adults<input type="number" min="1" data-trip="adults" value="${n(t.adults)}"></label><label>Children<input type="number" min="0" data-trip="children" value="${n(t.children)}"></label><label>Total guests<input readonly value="${(+t.adults || 0) + (+t.children || 0)}"></label></div>
   <div class="grid" style="margin-top:10px"><label class="check"><input type="checkbox" data-trip="unlimited" ${t.budget.unlimited ? 'checked' : ''}> <span>Budget unlimited (default)</span></label>${t.budget.unlimited ? '' : `<label>Maximum<input type="number" min="1" data-trip="bmax" value="${n(t.budget.max)}"></label><label>Currency<input data-trip="bcur" value="${esc(t.budget.currency || '')}" placeholder="EUR"></label>`}</div>
   <h3 style="margin:16px 0 4px">Who is travelling</h3><p class="tv-note">Grouped as you describe: families, grandparents, siblings, one single adult. Groups must add up to ${t.adults || 0} adults and ${t.children || 0} children (now ${sumA} / ${sumC}).</p>${gs}
   <div class="tv-actions"><button type="button" data-act="add-group">+ Add group</button><button class="primary ${s.busy.trip ? 'tv-busy' : ''}" type="submit" ${s.busy.trip ? 'disabled' : ''}>Save trip</button><button type="button" data-act="reset-trip" ${s.tripDirty ? '' : 'disabled'}>Discard edits</button></div></form></section>`;
}
