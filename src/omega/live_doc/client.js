// omega.live-doc client — edit a rendered document in place.
//
// The page stays the document's own rendering. Every rendered block that came
// from source lines carries data-src="from:to" (end exclusive). In edit mode a
// block opens where it stands as its exact Org source, in the block's own
// typography; it saves as you pause, and closes back into its rendering.
// Changes from anyone (another tab, Emacs, an agent) arrive through one
// long-poll; the host page refreshes itself on `live-doc:changed`.
//
// Host contract (all optional except data-src):
//   <body data-live-doc='{"rev":"3","editable":true}'>   configuration
//   window.dossierRefresh(force) -> Promise   re-render the page body
//   window.liveDoc.holding()                  true while an editor is open
(() => {
  if (window.liveDoc) return;
  const host = document.querySelector('[data-live-doc]');
  if (!host) return;
  let config = {};
  try { config = JSON.parse(host.dataset.liveDoc || '{}'); } catch {}
  const base = config.prefix || '_live';
  const html = document.documentElement;
  let rev = config.rev == null ? null : String(config.rev);
  let editing = null;          // the open editor session
  let mode = false;            // edit mode: blocks open on a click or tap
  let stale = false;           // a save landed; the rendering is behind its source
  const seq = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const clientId = (() => { try { const k = 'live-doc:client'; let v = sessionStorage.getItem(k); if (!v) { v = (crypto.randomUUID?.() || String(seq())); sessionStorage.setItem(k, v); } return v; } catch { return String(seq()); } })();
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

  // ── changes arrive by long-poll ──────────────────────────────────────────
  let waitDelay = 0;
  async function waitLoop() {
    for (;;) {
      if (document.hidden) { await new Promise(r => document.addEventListener('visibilitychange', r, { once: true })); }
      try {
        const r = await fetch(`${base}/wait?since=${encodeURIComponent(rev ?? '')}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const d = await r.json();
        waitDelay = 0;
        if (d.rev !== rev) { const first = rev === null; rev = d.rev; if (!first) emit('live-doc:changed', { rev }); }
      } catch {
        waitDelay = Math.min(30000, waitDelay ? waitDelay * 2 : 1000);
        emit('live-doc:offline', { retry: waitDelay });
        await new Promise(r => setTimeout(r, waitDelay));
      }
    }
  }

  // ── blocks ────────────────────────────────────────────────────────────────
  const range = el => { const m = /^(\d+):(\d+)$/.exec(el?.dataset?.src || ''); return m ? [Number(m[1]), Number(m[2])] : null; };
  const blocks = () => Array.from(document.querySelectorAll('[data-src]')).filter(el => range(el) && !el.closest('.ld-editor') && el.getClientRects().length);
  const PROSE = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'LI', 'DL']);
  const prose = el => PROSE.has(el.tagName);
  // Interactive controls inside blocks keep working; only the block's text opens.
  const interactive = t => t.closest('a[href],button,input,select,textarea,label,summary,details>*:not(summary) a,form,[contenteditable="true"],video,audio,iframe,.sg-stage,[data-live-doc-ignore]');
  const normalize = s => s.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const shift = (after, delta) => {
    if (!delta) return;
    for (const el of document.querySelectorAll('[data-src]')) {
      const r = range(el); if (!r || r[0] < after) continue;
      el.dataset.src = `${r[0] + delta}:${r[1] + delta}`;
    }
  };
  const draftKey = (from, before) => `live-doc:draft:${location.origin}${location.pathname}:${from}:${hash(before)}`;
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} }, del(k) { try { localStorage.removeItem(k); } catch {} } };

  // Place the caret where the reader pointed: the rendered text just before the
  // pointer is found in the source, nearest the same relative position.
  function caretFor(el, source, point) {
    if (!point) return source.length;
    let node = null, offset = 0;
    if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(point.x, point.y); if (p) { node = p.offsetNode; offset = p.offset; } }
    else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(point.x, point.y); if (r) { node = r.startContainer; offset = r.startOffset; } }
    if (!node || !el.contains(node)) return source.length;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let before = '', total = 0, n;
    while ((n = walker.nextNode())) { if (n === node) { before += n.textContent.slice(0, offset); total = before.length; } else if (!total) before += n.textContent; }
    const rendered = el.textContent || '';
    const ratio = rendered.length ? before.length / rendered.length : 1;
    for (let len = Math.min(24, before.length); len >= 2; len = Math.floor(len / 2)) {
      const needle = before.slice(-len);
      let best = -1, at = source.indexOf(needle);
      while (at !== -1) { if (best < 0 || Math.abs(at / source.length - ratio) < Math.abs(best / source.length - ratio)) best = at; at = source.indexOf(needle, at + 1); }
      if (best >= 0) {
        // Skip closing markup that renders as nothing (*bold*, =code=, ]] …).
        let end = best + len; while (end < source.length && /[*/_=~+\]]/.test(source[end]) && !/\s/.test(source[end - 1] || '')) end++;
        return end;
      }
    }
    return Math.round(ratio * source.length);
  }

  function typography(el, area) {
    const cs = getComputedStyle(el);
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'color', 'textAlign', 'textTransform', 'wordSpacing']) area.style[p] = cs[p];
    return cs;
  }
  const autosize = area => { area.style.height = 'auto'; area.style.height = area.scrollHeight + 'px'; };

  // ── one open editor at a time ─────────────────────────────────────────────
  async function open(el, point) {
    if (editing?.el === el) return;
    if (editing) await close({ refresh: false });
    const r = range(el); if (!r) return;
    const kind = prose(el) ? 'prose' : 'source';
    const box = document.createElement('div');
    box.className = 'ld-editor';
    box.dataset.kind = kind;
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Editing this passage');
    const area = document.createElement('textarea');
    area.className = 'ld-area';
    area.spellcheck = kind === 'prose';
    area.setAttribute('aria-label', kind === 'prose' ? 'Passage source' : 'Block source');
    area.rows = 1;
    const status = document.createElement('div');
    status.className = 'ld-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const done = document.createElement('button');
    done.type = 'button'; done.className = 'ld-done'; done.textContent = 'Done';
    status.append(document.createElement('span'), done);
    box.append(area, status);
    const cs = getComputedStyle(el);
    if (kind === 'prose') {
      typography(el, area);
      box.style.marginTop = cs.marginTop; box.style.marginBottom = cs.marginBottom;
      area.style.paddingLeft = cs.paddingLeft; area.style.paddingRight = cs.paddingRight;
    }
    box.style.minHeight = el.getBoundingClientRect().height + 'px';
    const session = { el, box, area, status, from: r[0], to: r[1], before: null, sent: null, inflight: null, timer: 0, closed: false, kind };
    editing = session;
    html.dataset.liveDocOpen = '';
    el.before(box);
    el.classList.add('ld-hidden');
    area.value = el.textContent.trim();
    area.readOnly = true; box.dataset.state = 'loading';
    autosize(area); area.focus({ preventScroll: true });
    try {
      const q = await fetch(`${base}/block?from=${r[0]}&to=${r[1]}`, { cache: 'no-store' });
      const d = await q.json();
      if (!q.ok) throw new Error(d.error || 'This passage cannot open now.');
      if (session.closed) return;
      session.before = normalize(d.text); session.sent = session.before;
      const draft = store.get(draftKey(session.from, session.before));
      area.value = draft ?? session.before;
      area.readOnly = false; delete box.dataset.state;
      autosize(area);
      const at = draft ? area.value.length : caretFor(el, area.value, point);
      area.setSelectionRange(at, at);
      area.focus({ preventScroll: true });
      say(session, draft ? 'Recovered your unsaved text' : '');
      if (draft) schedule(session, 50);
    } catch (e) {
      say(session, e.message || 'Offline — try again', 'error');
      setTimeout(() => { if (editing === session && session.before === null) close({ refresh: false }); }, 1800);
      return;
    }
    area.addEventListener('input', () => { autosize(area); store.set(draftKey(session.from, session.before), area.value); say(session, ''); schedule(session, 650); });
    area.addEventListener('keydown', e => keys(session, e));
    area.addEventListener('blur', () => setTimeout(() => { if (editing === session && !box.contains(document.activeElement)) close(); }, 160));
    done.addEventListener('click', () => close());
  }

  function say(session, text, tone) {
    const label = session.status.firstChild;
    label.textContent = text;
    session.status.dataset.tone = tone || '';
  }
  function schedule(session, ms) { clearTimeout(session.timer); session.timer = setTimeout(() => save(session), ms); }

  async function save(session) {
    clearTimeout(session.timer);
    if (session.before === null) return true;
    if (session.inflight) { await session.inflight; return save(session); }
    const text = session.area.value;
    if (normalize(text) === session.before) { say(session, session.saved ? 'Saved' : ''); return true; }
    const before = session.before;
    say(session, 'Saving…');
    session.inflight = (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await fetch(`${base}/block`, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ from: session.from, before, text, client: clientId, sequence: seq() }) });
          const d = await r.json().catch(() => ({}));
          if (r.ok) {
            store.del(draftKey(session.from, before));
            const oldTo = session.from + before.split('\n').length;
            shift(oldTo, (d.to - d.from) - (oldTo - session.from));
            session.from = d.from; session.to = d.to; session.before = normalize(text); session.saved = true; stale = true;
            session.removed = !!d.removed; if (d.rev != null) rev = String(d.rev);
            say(session, normalize(session.area.value) === session.before ? 'Saved' : 'Saving…');
            return true;
          }
          if (r.status === 409 && d.reason === 'target-changed') { conflict(session, d.current ?? ''); return false; }
          if (r.status === 409 && attempt < 3) continue;
          say(session, d.error || 'Not saved — your text is kept here', 'error');
          return false;
        } catch {
          say(session, 'Offline — your text is kept; retrying', 'error');
          await new Promise(res => setTimeout(res, Math.min(8000, 800 * 2 ** attempt)));
          if (session.closed && attempt > 3) return false;
        }
      }
    })();
    const ok = await session.inflight; session.inflight = null;
    if (ok && normalize(session.area.value) !== session.before) return save(session);
    return ok;
  }

  function conflict(session, current) {
    say(session, 'Changed elsewhere while you typed', 'error');
    session.box.dataset.state = 'conflict';
    let bar = session.box.querySelector('.ld-conflict');
    if (!bar) {
      bar = document.createElement('div'); bar.className = 'ld-conflict';
      const theirs = document.createElement('pre'); theirs.className = 'ld-theirs';
      const keep = document.createElement('button'); keep.type = 'button'; keep.textContent = 'Keep mine';
      const take = document.createElement('button'); take.type = 'button'; take.textContent = 'Use theirs';
      bar.append(theirs, keep, take);
      session.box.insertBefore(bar, session.status);
      keep.addEventListener('click', () => { session.before = normalize(bar.dataset.current); bar.remove(); delete session.box.dataset.state; save(session); session.area.focus(); });
      take.addEventListener('click', () => { session.before = normalize(bar.dataset.current); session.area.value = session.before; autosize(session.area); bar.remove(); delete session.box.dataset.state; say(session, 'Showing the current version'); session.area.focus(); });
    }
    bar.dataset.current = current;
    bar.querySelector('.ld-theirs').textContent = current || '(this passage was removed elsewhere)';
  }

  async function close(options = {}) {
    const session = editing; if (!session || session.closing) return;
    session.closing = true;
    const ok = await save(session);
    if (!ok && session.box.dataset.state === 'conflict') { session.closing = false; return; }
    session.closed = true;
    editing = null; delete html.dataset.liveDocOpen;
    // The host refreshes only when nobody is typing; this passage is settled.
    if (document.activeElement === session.area) session.area.blur();
    if (stale && !options.next && options.refresh !== false && window.dossierRefresh) {
      // Keep the typed source in place until its rendering replaces it.
      session.box.dataset.state = 'settling'; stale = false;
      try { await window.dossierRefresh(true); } catch { stale = true; }
    }
    // A refresh replaced the body; otherwise reveal the untouched rendering.
    if (session.box.isConnected) { session.box.remove(); session.el.classList.remove('ld-hidden'); if (session.removed) session.el.remove(); }
    if (options.next) { const target = find(options.next); if (target) open(target, null).then(() => { if (editing && options.atEnd) { const a = editing.area; a.setSelectionRange(a.value.length, a.value.length); } }); }
  }
  // After a refresh, elements are new; the neighbour is found again by source line.
  const find = ({ line, dir }) => {
    const list = blocks();
    return dir < 0 ? list.filter(el => range(el)[1] <= line).at(-1) : list.find(el => range(el)[0] >= line);
  };

  function keys(session, e) {
    const a = session.area, mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (mod && e.key === 'Enter') { e.preventDefault(); close(); return; }
    if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(session); return; }
    const collapsed = a.selectionStart === a.selectionEnd;
    if (e.key === 'ArrowUp' && collapsed && !a.value.slice(0, a.selectionStart).includes('\n')) {
      e.preventDefault(); close({ refresh: false, next: { line: session.from, dir: -1 }, atEnd: true });
    } else if (e.key === 'ArrowDown' && collapsed && !a.value.slice(a.selectionEnd).includes('\n')) {
      e.preventDefault(); close({ refresh: false, next: { line: session.to, dir: 1 } });
    }
  }

  // ── edit mode ─────────────────────────────────────────────────────────────
  function setMode(on) {
    mode = !!on;
    if (mode) html.dataset.liveEdit = ''; else delete html.dataset.liveEdit;
    const b = document.getElementById('live-doc-edit');
    if (b) { b.setAttribute('aria-pressed', String(mode)); b.textContent = mode ? 'Done' : 'Edit'; }
    try { sessionStorage.setItem('live-doc:mode', mode ? '1' : ''); } catch {}
    if (!mode && editing) close();
  }
  function toggleButton() {
    if (!config.editable || document.getElementById('live-doc-edit')) return;
    const bar = document.querySelector(config.bar || '.live');
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'live-doc-edit'; b.className = 'ld-toggle';
    b.title = 'Edit this document in place (E)';
    b.addEventListener('click', () => setMode(!mode));
    if (bar) bar.append(b); else { b.classList.add('ld-floating'); document.body.append(b); }
    setMode((() => { try { return sessionStorage.getItem('live-doc:mode') === '1'; } catch { return false; } })());
  }

  document.addEventListener('click', e => {
    if (!config.editable) return;
    // The path is recorded at dispatch: a control the editor just removed (the
    // conflict bar's buttons) still counts as inside it.
    if (editing && !e.composedPath().includes(editing.box) && !e.target.closest?.('#live-doc-edit')) { close(); }
    if (!mode || document.body.hasAttribute('data-review-mode')) return;   // commenting takes the click
    const el = e.target.closest('[data-src]');
    if (!el || !el.isConnected || el.closest('.ld-editor') || interactive(e.target)) return;
    if (getSelection()?.toString()) return;   // selecting text to copy or comment
    e.preventDefault();
    open(el, { x: e.clientX, y: e.clientY });
  });
  // Outside edit mode, a double-click opens the passage directly (desktop).
  document.addEventListener('dblclick', e => {
    if (!config.editable || mode) return;
    const el = e.target.closest('[data-src]');
    if (!el || interactive(e.target)) return;
    getSelection()?.removeAllRanges();
    open(el, { x: e.clientX, y: e.clientY });
  });
  document.addEventListener('keydown', e => {
    if (!config.editable || editing) return;
    const t = e.target;
    if (t.closest?.('input,textarea,select,[contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'e' || e.key === 'E') { e.preventDefault(); setMode(!mode); }
  });
  window.addEventListener('beforeunload', e => { if (editing && normalize(editing.area.value) !== editing.before) { e.preventDefault(); e.returnValue = ''; } });

  window.liveDoc = {
    holding: () => !!editing,
    get rev() { return rev; },
    edit: setMode,
    open: (el, point) => open(el, point),
    close: () => close(),
    install() { toggleButton(); }
  };
  toggleButton();
  if (!html.hasAttribute('data-published')) waitLoop();
})();
