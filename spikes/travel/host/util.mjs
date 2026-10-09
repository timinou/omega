export const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeHref = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
export const ext = (url, label) => `<a href="${esc(safeHref(url))}" target="_blank" rel="noopener noreferrer" data-ext>${esc(label)} ↗</a>`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function fmtDate(iso) { const d = new Date(iso + 'T00:00:00Z'); return Number.isNaN(d.getTime()) ? iso : `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
export function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function fmtStamp(iso) { if (!iso) return 'never'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso) : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; }
export function ago(iso, now = Date.now()) { if (!iso) return 'never'; const s = Math.max(0, (now - Date.parse(iso)) / 1000); if (!Number.isFinite(s)) return String(iso); if (s < 90) return 'just now'; if (s < 5400) return Math.round(s / 60) + ' min ago'; if (s < 129600) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago'; }
export async function api(path, body, { timeout = 30000, signal } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  signal?.addEventListener('abort', () => ctl.abort(), { once: true });
  try {
    const r = await fetch('/travel/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: ctl.signal });
    const j = await r.json().catch(() => ({ ok: false, message: 'Unreadable response (HTTP ' + r.status + ')' }));
    if (!r.ok && j.ok !== false) j.ok = false;
    return j;
  } catch (e) { return { ok: false, message: e.name === 'AbortError' ? 'Timed out waiting for the travel service' : 'Travel service unreachable: ' + e.message }; }
  finally { clearTimeout(t); }
}
export const PRESETS = [
  ['Whole riad, 20 guests', 'entire private riad Essaouira medina sleeps 20 guests holiday rental'],
  ['Large villa near Essaouira', 'large private villa Essaouira Morocco 20 guests holiday rental pool'],
  ['Riad exclusive use, 10 bedrooms', 'riad exclusive use Essaouira 10 bedrooms large group family'],
  ['Heated / winter, family friendly', 'Essaouira riad villa large group December heating fireplace family children safe pool'],
];
export const CHECKS = [
  ['sleeps-20', 'Confirms it sleeps all 20 guests (not dining or event capacity)'],
  ['private-use', 'Whole property for our group only, no other guests'],
  ['rooms-beds', 'Bedroom count, bed types, who can share; cots for the children'],
  ['dates', 'Free for the 19 Dec check-in, for 4 and for 5 nights'],
  ['price', 'Total price incl. fees, taxes, cleaning, deposit; currency'],
  ['access', 'Vehicle access / porters, steps, distance from parking, luggage'],
  ['heating', 'December heating in bedrooms and living areas'],
  ['pool-safety', 'Pool or water: fencing, cover, depth, supervision for children'],
  ['terms', 'Cancellation, payment schedule and house rules (noise, events)'],
];
