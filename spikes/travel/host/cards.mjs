import { esc, ext, ago, fmtStamp, CHECKS } from './util.mjs';
const badge = (cls, k, v, title = '') => `<span class="tv-b ${cls}" ${title ? `title="${esc(title)}"` : ''}><i>${esc(k)}</i>${esc(v)}</span>`;
// Three INDEPENDENT facts: the link/source status, the capacity evidence, and availability.
export function sourceBadge(l) {
  const m = { ok: ['ok', 'Page read'], 'not-modified': ['ok', 'Page read (unchanged)'], unchecked: ['mute', 'Not checked'], unreadable: ['warn', 'Loaded, unreadable'], blocked: ['bad', 'Blocked'], 'not-found': ['bad', 'Not found'], 'server-error': ['bad', 'Site error'], unknown: ['warn', 'Unreachable'] }[l.sourceStatus] || ['mute', l.sourceStatus];
  return badge(m[0] === 'ok' ? 'link' : m[0], 'Source', m[1], l.sourceLabel + (l.sourceReason ? ' · ' + l.sourceReason : ''));
}
export function capBadge(l) {
  const c = l.capacity, cls = c.status === 'meets' ? 'ok' : c.status === 'below' ? 'bad' : 'warn';
  const v = c.status === 'meets' ? 'Stated ' + c.max : c.status === 'below' ? 'Too small (' + c.max + ')' : c.max ? 'Confirm ' + c.max : 'Unverified';
  return badge(cls, 'Capacity', v, c.label);
}
export const availBadge = () => badge('mute', 'Dates', 'Unverified', 'Availability and price are never inferred from a reachable link.');
export function locBadge(l) { const s = l.location.status; return badge(s === 'outside' ? 'bad' : s === 'near' ? 'warn' : s === 'named' ? 'mute' : 'warn', 'Place', s === 'outside' ? 'Outside Essaouira' : s === 'near' ? 'Outside town?' : s === 'named' ? 'Essaouira named' : 'Unknown', l.location.label); }
export function card(l, { selected, compared, now }) {
  const kind = l.kind === 'collection' ? 'Collection' : l.kind === 'excluded' ? 'Excluded' : l.propertyType === 'riad' ? 'Riad' : l.propertyType === 'villa' ? 'Villa' : 'Property';
  const q = l.capacity.evidence && l.capacity.status !== 'unknown' || l.capacity.evidence ? `<div class="tv-q">“${esc(l.capacity.evidence.excerpt)}”<small>${l.capacity.evidence.source === 'manual' ? 'quoted by you' : 'page text'} · ${esc(l.capacity.evidence.value)} guests</small></div>` : '';
  const warn = l.location.status === 'outside' ? `<div class="tv-warn"><b>Outside the target area.</b> ${esc(l.location.reason)}. A strong capacity figure does not make it a match.</div>` : '';
  return `<article class="tv-card ${selected ? 'sel' : ''} ${l.shortlisted ? 'short' : ''}" data-card="${esc(l.id)}">
  <div class="dom">${esc(kind)} · ${esc(l.domain)}</div><h3><a href="#" data-act="select" data-id="${esc(l.id)}" style="border:0">${esc(l.title)}</a></h3>
  <div class="tv-row">${sourceBadge(l)}${capBadge(l)}${locBadge(l)}${availBadge()}</div>${warn}${q}
  <div class="tv-note">Checked ${esc(ago(l.checkedAt, now))}${l.sourceReason ? ' · ' + esc(l.sourceReason) : ''}</div>
  <div class="tv-actions"><button data-act="short" data-id="${esc(l.id)}" class="${l.shortlisted ? 'on' : ''}" aria-pressed="${l.shortlisted}">${l.shortlisted ? '★ Shortlisted' : '☆ Shortlist'}</button>
   <button data-act="select" data-id="${esc(l.id)}">Details</button><button data-act="inspect" data-id="${esc(l.id)}">Inspect listing</button>${ext(l.finalUrl || l.url, 'Open link')}
   ${l.shortlisted ? `<button class="ghost ${compared ? 'on' : ''}" data-act="cmp" data-id="${esc(l.id)}">${compared ? '✓ In comparison' : '+ Compare'}</button>` : ''}</div></article>`;
}
export function detail(l, { busy, forms, now }) {
  if (!l) return `<div class="tv-empty">Select a candidate to see its quoted evidence, add your own evidence, take notes and open it in the browser panel.</div>`;
  const ev = l.manualEvidence.map((m) => `<div class="tv-q">“${esc(m.excerpt)}” — ${esc(m.value)} guests<small>user-provided · ${esc(m.by)} · ${esc(fmtStamp(m.at))}</small></div>`).join('');
  const facts = Object.entries({ bedrooms: 'Bedrooms / rooms', privateUse: 'Whole-property use', access: 'Access: logistics mentions', stepFree: 'Step-free / accessibility', heating: 'Heating', pool: 'Pool' }).map(([k, name]) => { const f = l.facts[k] || { status: 'unknown' }; return `<li><b>${name}:</b> ${f.status === 'mentioned' ? `<span class="tv-q" style="display:block">“${esc(f.excerpt)}”</span>` : '<span class="tv-unk">unknown, ask the owner</span>'}</li>`; }).join('');
  const notes = l.notes.map((n) => `<li>${esc(n.text)}<div class="tv-note">${esc(fmtStamp(n.at))}</div></li>`).join('') || '<li class="tv-unk">No notes yet.</li>';
  const r = busy.refresh.has(l.id);
  return `<div class="tv-detail"><h2>${esc(l.title)}</h2><div class="tv-row">${sourceBadge(l)}${capBadge(l)}${locBadge(l)}${availBadge()}</div>
  <p class="tv-note">${esc(l.kindLabel)} · ${esc(l.kindReason || '')}<br>Source: ${esc(l.sourceLabel)}${l.sourceReason ? ' (' + esc(l.sourceReason) + ')' : ''} · last checked ${esc(fmtStamp(l.checkedAt))}${l.previousOk ? ' · last good read ' + esc(fmtStamp(l.previousOk)) : ''}</p>
  ${l.sourceStatus === 'unreadable' ? '<div class="tv-warn">This page loaded but exposed almost no readable text (script-rendered). Nothing on it has been verified; use Inspect listing.</div>' : ''}
  ${l.capacity.ignoredNonSleeping ? `<div class="tv-warn">Ignored dining/seating/event numbers: ${esc(l.capacity.ignoredNonSleeping.join(', '))} (not sleeping capacity).</div>` : ''}
  ${l.excerpt ? `<details open><summary>Source text excerpt</summary><div class="tv-q">${esc(l.excerpt)}<small>first characters of the fetched page text</small></div></details>` : ''}
  <div class="tv-actions"><button class="primary" data-act="inspect" data-id="${esc(l.id)}">Inspect listing</button><button data-act="refresh" data-id="${esc(l.id)}" ${r ? 'disabled' : ''} class="${r ? 'tv-busy' : ''}">Refresh (cached)</button><button data-act="force" data-id="${esc(l.id)}" ${r ? 'disabled' : ''}>Force</button>${ext(l.finalUrl || l.url, 'Open link')}</div>
  <details open><summary>Evidence you provide</summary>${ev || '<p class="tv-unk">None yet.</p>'}
   <p class="tv-note">Evidence you add stays user-provided: it is shown as quoted by you, never as page-verified.</p>
   <form data-form="evidence" data-id="${esc(l.id)}"><label>Capacity (guests that sleep)<input type="number" min="1" max="200" data-draft="ev-value" value="${esc(forms['ev-value'] ?? '')}"></label>
   <label>Quoted excerpt (or URL where you read it)<textarea data-draft="ev-excerpt" placeholder="“Sleeps 22 in 11 bedrooms” from the owner's message">${esc(forms['ev-excerpt'] ?? '')}</textarea></label><div class="tv-actions"><button class="primary" type="submit">Add evidence</button></div>${forms['ev-error'] ? `<div class="tv-err">${esc(forms['ev-error'])}</div>` : ''}</form></details>
  <details><summary>Rooms, access logistics, heating, pool: page mentions</summary><ul class="tv-list">${facts}</ul></details>
  <details open><summary>Notes</summary><ul class="tv-list">${notes}</ul><form data-form="note" data-id="${esc(l.id)}"><label>Add a note<textarea data-draft="note">${esc(forms.note ?? '')}</textarea></label><div class="tv-actions"><button type="submit">Save note</button></div></form></details>
  <details><summary>Correct the classification</summary><div class="tv-actions">${['property', 'collection', 'excluded'].map((k) => `<button data-act="kind" data-id="${esc(l.id)}" data-kind="${k}" class="${l.kind === k ? 'on' : ''}">${k}</button>`).join('')}</div>
   <div class="tv-actions">${[['outside', 'Outside Essaouira'], ['near', 'Near, outside town'], ['named', 'In Essaouira'], ['auto', 'Automatic']].map(([k, n]) => `<button data-act="loc" data-id="${esc(l.id)}" data-status="${k}" class="${(l.location.by === 'user' && l.location.status === k) ? 'on' : ''}">${n}</button>`).join('')}</div></details></div>`;
}
export function inquiry(l, trip) {
  const done = l.checklist || {};
  const qs = CHECKS.filter(([k]) => !done[k]).map(([, t], i) => `${i + 1}. ${t}`);
  return `Subject: Enquiry, ${trip.destination}, ${trip.checkIn}, ${trip.totalGuests} guests\n\nHello,\n\nWe are a family group of ${trip.adults} adults and ${trip.children} children (${trip.totalGuests} guests) looking for the whole property from ${trip.checkIn}, for ${trip.nightsOptions.join(' or ')} nights.\n\nCould you confirm:\n${qs.join('\n') || '(all checklist items marked answered)'}\n\nThank you.`;
}
