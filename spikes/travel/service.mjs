// Travel desk listing service (phase 1: no UI, no contact/booking).
// Owns persisted trip / listings / shortlist / notes in an isolated data directory.
// Discovery goes through the existing search-cli (bin/bl); refresh fetches real URLs.
// Honesty rules: search 'answer' is model-synthesized and never evidence; capacities are
// extracted only with a quoted source excerpt; availability and pricing are never inferred.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVICE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const OMEGA_ROOT = process.env.OMEGA_HOME || path.resolve(SERVICE_DIR, '../..');

// ---------------------------------------------------------------- text helpers
export function clip(text, n) {
  const s = String(text ?? '');
  return s.length > n ? s.slice(0, Math.max(0, n - 1)).trimEnd() + '…' : s;
}
export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}
export function htmlToText(html) {
  const s = String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?(p|div|br|li|h[1-6]|tr|section|article)\b[^>]*>/gi, ' . ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}
export function extractTitle(html) {
  const h = String(html ?? '');
  const m = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    || h.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i);
  return m ? clip(decodeEntities(m[1]).replace(/\s+/g, ' ').trim(), 200) : '';
}

// ---------------------------------------------------------------- URL safety
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[.*\])$/i;
/** Returns the normalized http(s) URL string, or null when unsafe / not http(s). */
export function safeUrl(input) {
  if (typeof input !== 'string' || input.length > 2000) return null;
  let u;
  try { u = new URL(input.trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (PRIVATE_HOST.test(u.hostname)) return null;
  u.hash = '';
  return u.toString();
}
export const listingId = (url) => sha256(url).slice(0, 12);

/** property | collection | excluded: a heuristic on URL (+ title), recorded with its reason. */
export function classifyUrl(url, title = '') {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  const p = u.pathname.toLowerCase();
  if (host === 'exa.ai' || host.endsWith('.exa.ai')) return { kind: 'excluded', reason: 'search-engine synthesized library page, not a property' };
  if (/\/(buy|sale|for-sale)-|\/buy\b|\/vente\//.test(p)) return { kind: 'excluded', reason: 'for-sale listing, not a rental' };
  if (/\/[a-z-]+:[^/]+\/?|vacation_rentals|\/(villa-rentals|rentals)\/?$/.test(p + u.search)) return { kind: 'collection', reason: 'filtered result / destination page covering several properties' };
  if (/\/property\/|\/ha-\d+|\/rooms\/\d+|\/hotel\/|\/listing\//.test(p) && !/\/(search|accommodations|collections?)\/?$/.test(p))
    return { kind: 'property', reason: 'URL path looks like a single listing' };
  if (/\/(accommodations?|collections?|category|categories|destinations?|search|results)\/|riads?-?(rental|for|in)|rental-[a-z]+\.html$|\/riads?\/?$|\/romantic|\/best-|\/top-\d+|\/(list|listings)\/?$/.test(p) || /(^|\s)(best|top \d+|book riad in|riads? in)\b/i.test(title))
    return { kind: 'collection', reason: 'URL/title looks like a listing collection or search page' };
  return { kind: 'property', reason: 'unclassified; assumed single property (low confidence)', lowConfidence: true };
}

// ---------------------------------------------------------------- trip
export const DEFAULT_TRIP = Object.freeze({
  destination: 'Essaouira',
  checkIn: '2026-12-19',
  nightsOptions: [4, 5],
  adults: 11,
  children: 9,
  totalGuests: 20,
  budget: { unlimited: true, max: null, currency: null },
  // Editable grouping. Child ages are NOT known; never invented. Edit when the user supplies them.
  groups: [{ id: 'party', label: 'Whole party', adults: 11, children: 9, childAges: [] }],
  notes: '',
});
export function defaultTrip() { return structuredClone(DEFAULT_TRIP); }
const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
export function validateTrip(input) {
  const errors = [];
  const t = { ...defaultTrip(), ...(input || {}) };
  if (typeof t.destination !== 'string' || !t.destination.trim()) errors.push('destination required');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(t.checkIn || '') ? new Date(t.checkIn + 'T00:00:00Z') : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t.checkIn) errors.push('checkIn must be a real YYYY-MM-DD date');
  if (!Array.isArray(t.nightsOptions) || !t.nightsOptions.length || !t.nightsOptions.every((n) => isInt(n, 1, 60))) errors.push('nightsOptions must be non-empty integers 1-60');
  if (!isInt(t.adults, 1, 200)) errors.push('adults must be an integer 1-200');
  if (!isInt(t.children, 0, 200)) errors.push('children must be an integer 0-200');
  if (isInt(t.adults, 1, 200) && isInt(t.children, 0, 200) && t.totalGuests !== t.adults + t.children) errors.push('totalGuests must equal adults + children');
  const b = t.budget || {};
  if (b.unlimited !== true && !(typeof b.max === 'number' && b.max > 0 && typeof b.currency === 'string' && b.currency)) errors.push('budget must be unlimited or have positive max and currency');
  if (!Array.isArray(t.groups) || !t.groups.length) errors.push('groups must be a non-empty list');
  else {
    let a = 0, c = 0; const ids = new Set();
    for (const g of t.groups) {
      if (!g || typeof g.id !== 'string' || !g.id || ids.has(g.id)) { errors.push('each group needs a unique id'); continue; }
      ids.add(g.id);
      if (!isInt(g.adults, 0, 200) || !isInt(g.children, 0, 200)) { errors.push('group ' + g.id + ': adults/children must be non-negative integers'); continue; }
      const ages = g.childAges ?? [];
      if (!Array.isArray(ages) || ages.length > g.children || !ages.every((x) => isInt(x, 0, 17))) errors.push('group ' + g.id + ': childAges must be 0-17, at most one per child');
      a += g.adults; c += g.children;
    }
    if (isInt(t.adults, 1, 200) && (a !== t.adults || c !== t.children)) errors.push('groups must sum to ' + t.adults + ' adults and ' + t.children + ' children (got ' + a + '/' + c + ')');
  }
  return errors.length ? { ok: false, errors, trip: null } : { ok: true, errors: [], trip: t };
}

// ---------------------------------------------------------------- concurrency primitives
export class Limiter {
  constructor(max) { this.max = Math.max(1, max | 0); this.active = 0; this.queue = []; this.peak = 0; }
  run(fn) {
    return new Promise((resolve, reject) => {
      const go = () => {
        this.active++; this.peak = Math.max(this.peak, this.active);
        Promise.resolve().then(fn).then(resolve, reject).finally(() => { this.active--; const n = this.queue.shift(); if (n) n(); });
      };
      if (this.active < this.max) go(); else this.queue.push(go);
    });
  }
}
/** TTL cache + inflight de-duplication + shared concurrency limit. Failures are not cached. */
export class CachedCall {
  constructor({ ttlMs = 600000, concurrency = 2, now = Date.now } = {}) {
    this.ttlMs = ttlMs; this.limiter = new Limiter(concurrency); this.now = now;
    this.cache = new Map(); this.inflight = new Map(); this.stats = { calls: 0, hits: 0, joined: 0 };
  }
  async get(key, fn, { force = false } = {}) {
    const hit = this.cache.get(key);
    if (!force && hit && this.now() - hit.at < this.ttlMs) { this.stats.hits++; return { ...hit.value, cache: 'hit' }; }
    if (this.inflight.has(key)) { this.stats.joined++; return { ...(await this.inflight.get(key)), cache: 'joined' }; }
    const p = this.limiter.run(async () => { this.stats.calls++; return fn(); });
    this.inflight.set(key, p);
    try {
      const value = await p;
      if (value && value.ok !== false) this.cache.set(key, { at: this.now(), value });
      return { ...value, cache: 'miss' };
    } finally { this.inflight.delete(key); }
  }
}

// ---------------------------------------------------------------- discovery bridge
/** Extract and decode the single @@RESULT@@ JSON line from mixed stdout. */
export function extractBridgeResult(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const k = lines[i].indexOf('@@RESULT@@');
    if (k >= 0) {
      try { return { ok: true, value: JSON.parse(lines[i].slice(k + 10)) }; }
      catch (e) { return { ok: false, error: 'bridge result line is not valid JSON: ' + e.message }; }
    }
  }
  return { ok: false, error: 'no @@RESULT@@ line in bridge output' };
}
/** Spawn bin/bl (no shell; argv only, key stays in the child's own env/.env). */
export function runSearchCli(query, opts = {}, { root = OMEGA_ROOT, timeoutMs = 120000, spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ query, opts });
    let out = '', err = '', done = false, child;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    try {
      child = spawnFn(path.join(root, 'bin/bl'), ['run', 'spikes/travel/search-cli.bl', '--', payload],
        { cwd: root, env: { ...process.env, OMEGA_HOME: root }, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    } catch (e) { return resolve({ ok: false, error: 'spawn failed: ' + e.message }); }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ ok: false, error: 'search bridge timed out' }); }, timeoutMs);
    child.stdout.on('data', (d) => { if (out.length < 4e6) out += d; });
    child.stderr.on('data', (d) => { if (err.length < 2e4) err += d; });
    child.on('error', (e) => finish({ ok: false, error: 'spawn error: ' + e.message }));
    child.on('close', (code) => {
      const r = extractBridgeResult(out);
      if (!r.ok) return finish({ ok: false, error: r.error + (code ? ' (exit ' + code + ')' : ''), stderr: clip(err, 500) });
      finish({ ok: true, value: r.value });
    });
  });
}
/** Separate model answer (synthesized, never evidence) from citations. Candidates are only citations. */
export function normalizeSearch(raw, query) {
  const results = [];
  const seen = new Set();
  for (const r of raw?.results || []) {
    const url = safeUrl(r?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const cls = classifyUrl(url, r.title);
    results.push({ url, title: clip(r.title, 200), snippet: clip(r.snippet, 600), domain: r.domain || new URL(url).hostname, rank: r.rank ?? results.length + 1, kind: cls.kind, kindReason: cls.reason });
  }
  return {
    query, status: raw?.status || 'unknown', engine: raw?.engine, model: raw?.model, fetchedAt: raw?.['fetched-at'],
    citations: results,
    modelAnswer: { text: clip(raw?.answer, 4000), synthesized: true, note: 'Model-written summary; not source evidence.' },
    usage: raw?.usage || null, error: raw?.error || null,
  };
}

// ---------------------------------------------------------------- capacity extraction
const NUMW = { ten: 10, twelve: 12, fourteen: 14, fifteen: 15, sixteen: 16, eighteen: 18, twenty: 20, 'twenty-two': 22, 'twenty-four': 24, 'twenty-five': 25, thirty: 30 };
const CAP_PATTERNS = [
  /\b(?:sleeps|sleeping|accommodates?|accommodating|hosts?|capacity(?: of| for)?|up to|maximum(?: of)?|max\.?)\s*:?\s*(\d{1,3})\s*(?:\+\s*)?(?:guests?|people|persons?|pax|adults?|pers\b|travell?ers?)?/gi,
  /\b(\d{1,3})\s*(?:guests?|persons?|people|pers\b|pax)\b/gi,

  /\((\d{1,3})\s*pers\.?\)/gi,
  /\b(?:sleeps|accommodates|up to)\s+(ten|twelve|fourteen|fifteen|sixteen|eighteen|twenty(?:-two|-four|-five)?|thirty)\b/gi,
];
/** Capacity claims with quoted excerpts; nothing is returned without an excerpt. */
export function extractCapacities(text, { maxClaims = 6 } = {}) {
  const s = String(text ?? ''); const found = []; const seenAt = new Set();
  for (const re of CAP_PATTERNS) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(s)) && found.length < 40) {
      const raw = m[1].toLowerCase(); const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : NUMW[raw];
      if (!n || n < 2 || n > 100) continue;
      const key = Math.floor(m.index / 20); if (seenAt.has(key)) continue; seenAt.add(key);
      // '18 guests (21 max.)' : the parenthesised max needs extra beds; kept as a separate, flagged claim
      const mx = /^\s*\((?:up to\s*)?(\d{1,3})\s*max\b/i.exec(s.slice(m.index + m[0].length, m.index + m[0].length + 20));
      if (mx && +mx[1] > n) { const e = Math.min(s.length, m.index + m[0].length + 40); found.push({ value: +mx[1], excerpt: clip(s.slice(Math.max(0, m.index - 40), e).trim(), 200), at: m.index, source: 'page-text', extra: true }); }
      const a = Math.max(0, m.index - 60), b = Math.min(s.length, m.index + m[0].length + 60);
      found.push({ value: n, excerpt: clip(s.slice(a, b).trim(), 200), at: m.index, source: 'page-text' });
    }
  }
  found.sort((x, y) => x.at - y.at);
  // pos lets assessCapacity prefer the page header (title/first screen) over related-listing noise
  return found.slice(0, maxClaims).map(({ at, ...c }) => ({ ...c, pos: at }));
}
const HEAD_CHARS = 1200;
export const MIN_READABLE = 200;
// Dining / seating / event numbers are never sleeping capacity. Max / extra-bed wording is never a firm capacity.
export const NONSLEEP_RE = /\b(dining|seat(?:s|ing|ed)?|banquet|reception|wedding|events?|restaurant|conference|meeting|cocktail|standing|buffet|lunch|dinner|tables? for)\b/i;
export const SOFT_RE = /\b(max(?:imum|\.)?|extra beds?|additional beds?|extra guests?|sofa|on request|supplement|surcharge)\b/i;
/** meets | below | unknown, with the evidence used. Manual (user-provided) evidence wins over page text. */
export function assessCapacity(claims, manual = [], need = 20) {
  const all = [...(manual || []).map((m) => ({ ...m, source: 'manual' })), ...(claims || [])].filter((c) => c.excerpt && Number.isFinite(c.value));
  const ignored = all.filter((c) => c.source !== 'manual' && NONSLEEP_RE.test(c.excerpt));
  const usable = all.filter((c) => !ignored.includes(c));
  const ign = ignored.length ? { ignoredNonSleeping: ignored.map((c) => c.value) } : {};
  if (!usable.length) return { status: 'unknown', max: null, evidence: null, ...ign, label: ignored.length ? 'Capacity unverified: only dining/seating/event numbers found (not sleeping capacity)' : 'Capacity unverified' };
  const manualOnly = usable.filter((c) => c.source === 'manual');
  if (manualOnly.length) {
    const top = manualOnly.reduce((a, b) => (b.value > a.value ? b : a));
    return top.value >= need ? { status: 'meets', max: top.value, evidence: top, ...ign, label: 'User-provided capacity ' + top.value + ' (quoted evidence; not date-checked)' }
      : { status: 'below', max: top.value, evidence: top, ...ign, label: 'User-provided capacity ' + top.value + ' < ' + need };
  }
  const base = usable.filter((c) => !c.extra);
  const pool = base.length ? base : usable;
  const extra = usable.filter((c) => c.extra && c.value >= need).sort((a, b) => b.value - a.value)[0];
  const head0 = pool.filter((c) => (c.pos ?? 0) < HEAD_CHARS);
  if (!head0.length) { const deep = pool.reduce((a, b) => (b.value > a.value ? b : a)); return { status: 'unknown', max: null, evidence: null, deepEvidence: deep, ...ign, label: 'Needs confirmation: ' + deep.value + ' appears only deep in the page (may be a related listing, not this property)' }; }
  const head = head0;
  const strong = head.filter((c) => !SOFT_RE.test(c.excerpt));
  const top = (strong.length ? strong : head).reduce((a, b) => (b.value > a.value ? b : a));
  const lows = head.filter((c) => c.value < need && !SOFT_RE.test(c.excerpt)), highs = head.filter((c) => c.value >= need);
  if (top.value >= need) {
    if (!strong.length) return { status: 'unknown', max: top.value, evidence: top, ...ign, label: 'Needs confirmation: ' + top.value + ' appears only as a maximum / extra-bed figure' };
    if (lows.length && highs.length) return { status: 'unknown', max: top.value, evidence: top, conflict: lows[0], ...ign, label: 'Needs confirmation: page states both ' + lows[0].value + ' and ' + top.value };
    return { status: 'meets', max: top.value, evidence: top, ...ign, label: 'Stated capacity ' + top.value + ' (page text; sleeping, dates and private use not verified)' };
  }
  if (extra) return { status: 'unknown', max: top.value, evidence: top, extraEvidence: extra, ...ign, label: 'Needs confirmation: base capacity ' + top.value + ', up to ' + extra.value + ' only as stated max (extra beds?); verify' };
  return { status: 'below', max: top.value, evidence: top, ...ign, label: 'Unsuitable: stated capacity ' + top.value + ' < ' + need };
}

// ---------------------------------------------------------------- qualification (location, type, facts)
const FAR_RE = /\b(mirleft|agadir|marrakech|marrakesh|casablanca|taghazout|tamraght|tangier|fes|fez|rabat|ouarzazate|sidi[- ]ifni|legzira|dakhla|chefchaouen)\b/i;
const TARGET_RE = /\b(essaouira|essaouria|mogador)\b/i;
const locText = (l) => [l.url, l.title, l.snippet, l.source?.title].filter(Boolean).join(' ').replace(/[\/_]+/g, ' ');
/** Location relative to the trip destination. Never a distance measurement; reasons are shown. */
export function locationOf(l) {
  if (l.locationOverride) return { ...l.locationOverride, by: 'user' };
  const t = locText(l); // Only a place named in the listing's own URL/title counts. The marketplace's name or country (e.g. a .nz platform) says nothing about the property.
  const far = t.match(FAR_RE);
  if (far) return { status: 'outside', label: 'Outside target: names ' + far[0] + ' (far from Essaouira)', reason: 'URL/title names ' + far[0] };
  const body = (l.source?.textExcerpt || '');
  if (/outside[- ]essaouira/i.test(l.url || '')) return { status: 'near', label: 'Listed as outside Essaouira town: confirm distance', reason: 'site category “outside Essaouira”' };
  if (TARGET_RE.test(t)) return { status: 'named', label: 'Essaouira named (distance to town not verified)', reason: 'URL/title mentions Essaouira' };
  if (body && !TARGET_RE.test(body)) return { status: 'outside', label: 'Outside target: page never mentions Essaouira', reason: 'no mention in page text' };
  return { status: 'unknown', label: 'Location unverified', reason: 'no location in URL/title' };
}
export function propertyTypeOf(l) {
  const name = String(l.title || l.source?.title || '').split(/ [-|–·] /)[0] + ' ' + String(l.url || '').split('/').slice(3).join(' ');
  if (/\briads?\b/i.test(name)) return 'riad';
  if (/\bvillas?\b/i.test(name) || /\bvillas?\b/i.test(l.title || '')) return 'villa';
  return 'other';
}
// Whole-property use must be stated explicitly: "private bathroom/pool/parking/terrace", "private villa" or
// "self-catering" alone say nothing about exclusive use of the property by our group.
const PRIVATE_USE_RE = new RegExp('\\b(?:(?:entire|whole|full)[ -](?:[a-z]+[ -]){0,2}(?:house|home|riad|villa|property|apartment|residence|building|estate)|(?:exclusive|sole)[ -](?:use|occupancy|access|hire|rental)|buy-?outs?|private[ -](?:rental|hire|buy-?out|exclusive|use of the (?:entire|whole|full)))\\b', 'i');
const STEP_FREE_RE = /\b(step[- ]free|wheelchair|no steps|accessible (?:room|bedroom|entrance|bathroom)|disabled access|mobility)\b/i;
const FACT_RES = { bedrooms: /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)[ -](?:double |en-suite |ensuite )?(?:bed)?rooms?\b|\b\d{1,2} suites?\b|\bbedrooms?\b/i,
  access: /\b(parking|garage|pedestrian|car access|walk(?:ing)? (?:to|from|distance)|steps?|stairs?|elevator|lift|taxi|medina|beach|airport)\b/i,
  heating: /\b(heating|heated|fireplace|fire place|heater|radiators?|air[- ]?conditioning|wood stove)\b/i,
  pool: /\b(pool|swimming)\b/i, privateUse: PRIVATE_USE_RE };
export function factsOf(l) {
  const text = [l.source?.title, l.source?.textExcerpt].filter(Boolean).join(' . '); const out = {};
  for (const [k, re] of Object.entries(FACT_RES)) {
    const m = text ? re.exec(text) : null;
    out[k] = m ? { status: 'mentioned', excerpt: clip(text.slice(Math.max(0, m.index - 70), m.index + m[0].length + 90).trim(), 220) } : { status: 'unknown', excerpt: null };
  }
  // `access` holds LOGISTICS mentions only (parking, medina, airport...); a generic mention never implies step-free access
  const sf = text ? STEP_FREE_RE.exec(text) : null;
  out.stepFree = sf ? { status: 'mentioned', excerpt: clip(text.slice(Math.max(0, sf.index - 70), sf.index + sf[0].length + 90).trim(), 220) } : { status: 'unknown', excerpt: null };
  return out;
}
export function effectiveSource(src) {
  if (!src) return 'unchecked';
  if (src.status === 'ok' && (src.textLength ?? 0) < MIN_READABLE) return 'unreadable';
  return src.status;
}

// ---------------------------------------------------------------- fetching a source
export const SOURCE_LABELS = {
  unchecked: 'Not checked yet',
  ok: 'Link reachable (page read)',
  'not-modified': 'Link reachable (unchanged since last check)',
  blocked: 'Blocked by site (403 / bot check / redirect problem)',
  'not-found': 'Page not found (404/410)',
  'server-error': 'Site error (5xx)',
  unknown: 'Unknown (could not connect / timed out)',
  unreadable: 'Page loaded but almost no readable text (script-rendered / empty): contents NOT verified',
};
const BOT_RE = /(just a moment|attention required|checking your browser|verify you are (a )?human|are you a robot|captcha|cf-chl|access denied|request unsuccessful|incapsula|pardon our interruption|enable javascript and cookies)/i;
export function looksLikeBotChallenge(text, status) {
  const t = String(text || '');
  return BOT_RE.test(t.slice(0, 3000)) && (t.length < 6000 || status >= 400);
}
const REDIRECT = new Set([301, 302, 303, 307, 308]);
const readLimited = async (res, maxBytes) => {
  if (typeof res.text === 'function' && !res.body?.getReader) return String(await res.text()).slice(0, maxBytes);
  const reader = res.body.getReader(); const dec = new TextDecoder(); let out = '', n = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    n += value.length; out += dec.decode(value, { stream: true });
    if (n >= maxBytes) { try { await reader.cancel(); } catch {} break; }
  }
  return out;
};
/** Fetch one URL with manual redirects, timeout, conditional headers; returns a plain source record. */
export async function fetchSource(url, { fetchFn = globalThis.fetch, timeoutMs = 15000, maxRedirects = 5, maxBytes = 1500000, textLimit = 6000, prior = null, now = () => new Date().toISOString() } = {}) {
  const base = { requestedUrl: url, finalUrl: url, checkedAt: now(), httpStatus: null, redirects: 0 };
  const headers = { 'user-agent': 'Mozilla/5.0 (compatible; TravelDeskBot/0.1; research, no booking)', accept: 'text/html,text/plain;q=0.9,*/*;q=0.5', 'accept-language': 'en' };
  if (prior?.etag) headers['if-none-match'] = prior.etag;
  if (prior?.lastModified) headers['if-modified-since'] = prior.lastModified;
  let cur = url;
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const res = await fetchFn(cur, { headers: hop === 0 ? headers : { 'user-agent': headers['user-agent'], accept: headers.accept, 'accept-language': 'en' }, redirect: 'manual', signal: ctl.signal });
      base.httpStatus = res.status; base.finalUrl = cur; base.redirects = hop;
      if (REDIRECT.has(res.status)) {
        const loc = res.headers.get('location');
        const next = loc && safeUrl(new URL(loc, cur).toString());
        if (!next) return { ...base, status: 'blocked', reason: 'redirect to a missing or unsafe location' };
        if (next === cur) return { ...base, status: 'blocked', reason: 'redirect loop' };
        cur = next; continue;
      }
      if (res.status === 304) return { ...base, status: 'not-modified', reachable: true, reason: 'HTTP 304', etag: prior?.etag, lastModified: prior?.lastModified };
      const ct = res.headers.get('content-type') || '';
      const etag = res.headers.get('etag') || undefined, lastModified = res.headers.get('last-modified') || undefined;
      const body = res.status === 204 ? '' : await readLimited(res, maxBytes);
      const isHtml = /html|xml/i.test(ct) || /^\s*<(!doctype|html)/i.test(body);
      const text = isHtml ? htmlToText(body) : (/text\/|json/i.test(ct) ? body.replace(/\s+/g, ' ').trim() : '');
      if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 451 || looksLikeBotChallenge(text, res.status))
        return { ...base, status: 'blocked', reachable: false, reason: looksLikeBotChallenge(text, res.status) ? 'bot challenge page' : 'HTTP ' + res.status };
      if (res.status === 404 || res.status === 410) return { ...base, status: 'not-found', reachable: false, reason: 'HTTP ' + res.status };
      if (res.status >= 500) return { ...base, status: 'server-error', reachable: false, reason: 'HTTP ' + res.status };
      if (res.status >= 400) return { ...base, status: 'blocked', reachable: false, reason: 'HTTP ' + res.status };
      return {
        ...base, status: 'ok', reachable: true, contentType: clip(ct, 80), etag, lastModified,
        title: isHtml ? extractTitle(body) : '', contentHash: sha256(text), textLength: text.length,
        textExcerpt: clip(text, textLimit), capacityClaims: extractCapacities(isHtml ? extractTitle(body) + ' . ' + text : text),
      };
    }
    return { ...base, status: 'blocked', reachable: false, reason: 'too many redirects' };
  } catch (e) {
    return { ...base, status: 'unknown', reachable: null, reason: e?.name === 'AbortError' ? 'timed out' : 'transport failure: ' + clip(e?.cause?.code || e?.message, 100) };
  } finally { clearTimeout(timer); }
}

// ---------------------------------------------------------------- ranking / comparison
const KIND_RANK = { property: 0, collection: 2, excluded: 3 };
const CAP_RANK = { meets: 0, unknown: 1, below: 3 };
const SRC_RANK = { ok: 0, 'not-modified': 0, unchecked: 1, unknown: 1, unreadable: 2, blocked: 2, 'server-error': 2, 'not-found': 4 };
/** Lower sort key is better. Pure and O(n log n); decorates once. */
export function rankListings(listings, need = 20) {
  const dec = listings.map((l) => {
    const cap = capacityOf(l, need);
    const loc = locationOf(l).status === 'outside' ? 1 : 0, ty = propertyTypeOf(l) === 'riad' ? 0 : 1;
    const key = [KIND_RANK[l.kind] ?? 1, loc, CAP_RANK[cap.status], ty, l.shortlisted ? 0 : 1, SRC_RANK[effectiveSource(l.source)] ?? 1, -(cap.max || 0), l.discoveryRank ?? 99];
    return { l, cap, key };
  });
  dec.sort((a, b) => { for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i]; return a.l.id < b.l.id ? -1 : 1; });
  return dec.map(({ l, cap }, i) => ({ position: i + 1, id: l.id, capacity: cap }));
}
/** Collection pages describe many properties: their numbers are never a capacity for one place. */
function capacityOf(l, need) {
  if (l.kind === 'collection' && !(l.manualEvidence || []).length) return { status: 'unknown', max: null, evidence: null, label: 'Collection page: no single-property capacity' };
  return assessCapacity(l.source?.capacityClaims, l.manualEvidence, need);
}
/** Human-friendly view of a listing (never states availability or price). */
export function describeListing(l, need = 20) {
  const cap = capacityOf(l, need);
  const st = effectiveSource(l.source); const loc = locationOf(l);
  if (loc.status === 'outside' && cap.status === 'meets') { cap.label += ' · but location is outside the target'; }
  return {
    location: loc, propertyType: propertyTypeOf(l), facts: factsOf(l), kindReason: l.kindReason || null, excerpt: l.source?.textExcerpt ? clip(l.source.textExcerpt, 500) : null, snippet: l.snippet || null,
    queries: l.queries || [], readable: st === 'ok' || st === 'not-modified', previousOk: l.source?.previousOk || null,
    id: l.id, url: l.url, finalUrl: l.source?.finalUrl || l.url, title: l.title || l.source?.title || l.url, domain: l.domain,
    kind: l.kind, kindLabel: l.kind === 'property' ? 'Property listing' : l.kind === 'collection' ? 'Collection / search page' : 'Excluded (not a property)',
    sourceStatus: st, sourceLabel: SOURCE_LABELS[st] || st, sourceReason: l.source?.reason || null, checkedAt: l.source?.checkedAt || null,
    capacity: cap, suitability: loc.status === 'outside' ? 'outside-target' : cap.status === 'below' ? 'unsuitable' : cap.status === 'meets' ? 'capacity-stated' : 'capacity-unknown',
    availability: { status: 'unknown', label: 'Availability not verified (link reachable does not mean dates are free)' },
    price: { status: 'unknown', label: 'Price not verified' },
    origin: l.origin || 'search', shortlisted: !!l.shortlisted, checklist: l.checklist || {}, notes: l.notes || [], manualEvidence: l.manualEvidence || [],
  };
}
export function compareListings(listings, need = 20) {
  const rows = listings.map((l) => describeListing(l, need));
  return { need, rows: rows.map((r) => ({ id: r.id, title: r.title, kind: r.kind, location: r.location.label, propertyType: r.propertyType, capacity: r.capacity.label, capacityMax: r.capacity.max, suitability: r.suitability, source: r.sourceLabel, checkedAt: r.checkedAt, shortlisted: r.shortlisted, url: r.url })) };
}

// ---------------------------------------------------------------- the service
export class TravelService {
  constructor({ dataDir = path.join(SERVICE_DIR, 'data/world'), seedFile = path.join(SERVICE_DIR, 'data/seed.json'), searchFn, fetchFn = globalThis.fetch,
    now = () => new Date().toISOString(), searchTtlMs = 6 * 3600e3, searchConcurrency = 1, fetchTtlMs = 30 * 60e3, fetchConcurrency = 4, fetchTimeoutMs = 15000, textLimit = 6000, maxListings = 200 } = {}) {
    this.dataDir = dataDir; this.seedFile = seedFile; this.now = now; this.fetchFn = fetchFn;
    this.searchFn = searchFn || ((q, o) => runSearchCli(q, o));
    this.searchCache = new CachedCall({ ttlMs: searchTtlMs, concurrency: searchConcurrency });
    this.fetchLimiter = new Limiter(fetchConcurrency); this.fetchTtlMs = fetchTtlMs; this.fetchTimeoutMs = fetchTimeoutMs; this.textLimit = textLimit; this.maxListings = maxListings;
    this.fetchInflight = new Map(); this.state = null; this.saveChain = Promise.resolve(); this.fetchStats = { fetched: 0, joined: 0, cached: 0 };
  }
  get file() { return path.join(this.dataDir, 'state.json'); }
  async load() {
    if (this.state) return this.state;
    for (const f of [this.file, this.seedFile]) {
      try { const s = JSON.parse(await readFile(f, 'utf8')); this.state = { version: 1, trip: s.trip || defaultTrip(), listings: s.listings || {}, searches: s.searches || [] }; return this.state; }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    this.state = { version: 1, trip: defaultTrip(), listings: {}, searches: [] };
    return this.state;
  }
  save() {
    this.saveChain = this.saveChain.then(async () => {
      await mkdir(this.dataDir, { recursive: true });
      const tmp = this.file + '.tmp'; await writeFile(tmp, JSON.stringify(this.state, null, 2)); await rename(tmp, this.file);
    });
    return this.saveChain;
  }
  async getTrip() { return (await this.load()).trip; }
  async setTrip(patch) {
    const s = await this.load(); const v = validateTrip({ ...s.trip, ...patch });
    if (!v.ok) return { ok: false, errors: v.errors };
    s.trip = v.trip; await this.save(); return { ok: true, trip: s.trip };
  }
  async needed() { return (await this.getTrip()).totalGuests; }
  async addCandidate({ url, title = '', snippet = '', origin = 'search', query = null, rank = null, kind = null }) {
    const s = await this.load(); const u = safeUrl(url);
    if (!u) return { ok: false, error: 'only public http(s) URLs are accepted' };
    const id = listingId(u); let l = s.listings[id];
    if (!l) {
      if (Object.keys(s.listings).length >= this.maxListings) return { ok: false, error: 'listing limit reached' };
      const cls = classifyUrl(u, title);
      l = s.listings[id] = { id, url: u, title: clip(title, 200), snippet: clip(snippet, 600), domain: new URL(u).hostname.replace(/^www\./, ''),
        kind: kind || cls.kind, kindReason: kind ? 'set by user' : cls.reason, origin, discoveredAt: this.now(), queries: [], discoveryRank: rank, source: null, manualEvidence: [], notes: [], shortlisted: false };
    }
    if (query && !l.queries.includes(query)) l.queries.push(query);
    return { ok: true, listing: l, id };
  }
  async discover(query, opts = {}, { force = false } = {}) {
    const q = clip(String(query || '').trim(), 400); if (!q) return { ok: false, error: 'query required' };
    const key = sha256(JSON.stringify([q, opts]));
    const r = await this.searchCache.get(key, async () => {
      const raw = await this.searchFn(q, opts);
      if (!raw || raw.ok === false) return { ok: false, error: raw?.error || 'search failed' };
      const norm = normalizeSearch(raw.value ?? raw, q);
      return norm.status === 'ok' || norm.citations.length ? { ok: true, search: norm } : { ok: false, error: 'search status ' + norm.status + (norm.error ? ': ' + clip(String(norm.error), 200) : '') };
    }, { force });
    if (!r.ok) return r;
    const s = await this.load(); const added = [];
    for (const c of r.search.citations) {
      const a = await this.addCandidate({ url: c.url, title: c.title, snippet: c.snippet, query: q, rank: c.rank, kind: c.kind !== 'property' && c.kind !== 'collection' ? c.kind : null });
      if (a.ok) { if (c.kind === 'excluded') { a.listing.kind = 'excluded'; a.listing.kindReason = c.kindReason; } added.push(a.id); }
    }
    s.searches.push({ query: q, at: this.now(), cache: r.cache, citationCount: r.search.citations.length, model: r.search.model, engine: r.search.engine, usage: r.search.usage });
    s.searches = s.searches.slice(-50);
    await this.save();
    return { ok: true, cache: r.cache, search: r.search, listingIds: added };
  }
  async refresh(id, { force = false } = {}) {
    const s = await this.load(); const l = s.listings[id]; if (!l) return { ok: false, error: 'unknown listing' };
    if (l.kind === 'excluded') return { ok: false, error: 'excluded listings are not fetched' };
    const last = l.source?.checkedAt && Date.parse(l.source.checkedAt);
    if (!force && last && Date.parse(this.now()) - last < this.fetchTtlMs && l.source.status !== 'unknown') { this.fetchStats.cached++; return { ok: true, cache: 'hit', listing: describeListing(l, await this.needed()) }; }
    if (this.fetchInflight.has(id)) { this.fetchStats.joined++; return this.fetchInflight.get(id); }
    const p = this.fetchLimiter.run(async () => {
      this.fetchStats.fetched++;
      const rec = await fetchSource(l.url, { fetchFn: this.fetchFn, timeoutMs: this.fetchTimeoutMs, textLimit: this.textLimit, now: this.now, prior: l.source?.status === 'ok' ? l.source : null });
      // a 304 keeps the previously stored text; a failed check keeps last good extract but records the new status
      const keep = l.source && (rec.status === 'not-modified' || !rec.textExcerpt) ? { title: l.source.title, contentHash: l.source.contentHash, textExcerpt: l.source.textExcerpt, textLength: l.source.textLength, capacityClaims: l.source.capacityClaims, contentType: l.source.contentType } : {};
      l.source = { ...keep, ...rec, previousOk: rec.status !== 'ok' && rec.status !== 'not-modified' ? (l.source?.previousOk || (l.source?.status === 'ok' ? l.source.checkedAt : undefined)) : undefined };
      if (!l.title && l.source.title) l.title = l.source.title;
      await this.save();
      return { ok: true, cache: 'miss', listing: describeListing(l, await this.needed()) };
    }).finally(() => this.fetchInflight.delete(id));
    this.fetchInflight.set(id, p);
    return p;
  }
  async refreshAll({ force = false, kinds = ['property', 'collection'] } = {}) {
    const s = await this.load(); const ids = Object.values(s.listings).filter((l) => kinds.includes(l.kind)).map((l) => l.id);
    const results = await Promise.all(ids.map((id) => this.refresh(id, { force })));
    return { ok: true, count: ids.length, results: results.map((r) => r.listing || r) };
  }
  async addManualEvidence(id, { value, excerpt, by = 'user' }) {
    const s = await this.load(); const l = s.listings[id]; if (!l) return { ok: false, error: 'unknown listing' };
    if (!Number.isInteger(value) || value < 1 || value > 200) return { ok: false, error: 'value must be an integer capacity 1-200' };
    if (typeof excerpt !== 'string' || excerpt.trim().length < 3) return { ok: false, error: 'a quoted excerpt/evidence text is required' };
    l.manualEvidence.push({ value, excerpt: clip(excerpt.trim(), 400), by: clip(by, 60), at: this.now() }); await this.save();
    return { ok: true, listing: describeListing(l, await this.needed()) };
  }
  async addNote(id, text) {
    const s = await this.load(); const l = s.listings[id]; if (!l) return { ok: false, error: 'unknown listing' };
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'note text required' };
    l.notes.push({ text: clip(text.trim(), 1000), at: this.now() }); await this.save(); return { ok: true, notes: l.notes };
  }
  async setShortlist(id, on = true) {
    const s = await this.load(); const l = s.listings[id]; if (!l) return { ok: false, error: 'unknown listing' };
    l.shortlisted = !!on; await this.save(); return { ok: true, shortlisted: l.shortlisted };
  }
  async setLocation(id, status, reason = 'set by user') {
    const s = await this.load(); const l = s.listings[id]; if (!l) return { ok: false, error: 'unknown listing' };
    if (status === null || status === 'auto') delete l.locationOverride;
    else if (['outside', 'near', 'named'].includes(status)) l.locationOverride = { status, label: ({ outside: 'Outside target (marked by you)', near: 'Near Essaouira (marked by you)', named: 'In Essaouira (marked by you)' })[status], reason: clip(reason, 200) };
    else return { ok: false, error: 'location must be outside, near, named or auto' };
    await this.save(); return { ok: true };
  }
  async toggleCheck(id, key, on = true) {
    const s = await this.load(); const l = s.listings[id]; if (!l) return { ok: false, error: 'unknown listing' };
    if (typeof key !== 'string' || !/^[a-z0-9-]{1,40}$/.test(key)) return { ok: false, error: 'invalid checklist key' };
    l.checklist = { ...(l.checklist || {}) }; if (on) l.checklist[key] = this.now(); else delete l.checklist[key];
    await this.save(); return { ok: true, checklist: l.checklist };
  }
  async setKind(id, kind, reason = 'set by user') {
    const s = await this.load(); const l = s.listings[id]; if (!l) return { ok: false, error: 'unknown listing' };
    if (!['property', 'collection', 'excluded'].includes(kind)) return { ok: false, error: 'kind must be property, collection or excluded' };
    l.kind = kind; l.kindReason = clip(reason, 200); await this.save(); return { ok: true };
  }
  async list({ kind = null, shortlistedOnly = false } = {}) {
    const s = await this.load(); const need = s.trip.totalGuests;
    let ls = Object.values(s.listings).filter((l) => (!kind || l.kind === kind) && (!shortlistedOnly || l.shortlisted));
    const order = new Map(rankListings(ls, need).map((r) => [r.id, r.position]));
    ls.sort((a, b) => order.get(a.id) - order.get(b.id));
    return ls.map((l) => describeListing(l, need));
  }
  async compare(ids) {
    const s = await this.load(); const ls = (ids?.length ? ids : Object.values(s.listings).filter((l) => l.shortlisted).map((l) => l.id)).map((i) => s.listings[i]).filter(Boolean);
    return compareListings(ls, s.trip.totalGuests);
  }
  async snapshot() { const s = await this.load(); return JSON.parse(JSON.stringify(s)); }
  async exportSeed(file = this.seedFile) {
    const s = await this.snapshot(); await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ ...s, exportedAt: this.now(), note: 'Clipped text excerpts only; no full HTML. Search answers are not stored as evidence.' }, null, 2));
  }
}
