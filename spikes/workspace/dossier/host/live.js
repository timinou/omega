// live.js — the page listens to its file, and talks back to it.
// Polls /rev; when the .bl.org changed (an answer, an Emacs save, a
// `bl doc run`), swaps the body in place unless you are mid-answer.
(() => {
  const $ = s => document.querySelector(s);
  let rev = window.omegaDocument.rev, generation = window.omegaDocument.generation, busy = false;
  const savedKey='omega.document:'+window.omegaDocument.path;
  let saved={};try{saved=JSON.parse(sessionStorage.getItem(savedKey)||'{}');}catch{}
  const drafts = new Map(saved.drafts||[]);
  let saveTimer;
  const persistReading=()=>{try{sessionStorage.setItem(savedKey,JSON.stringify({drafts:[...drafts],hash:location.hash,y:scrollY,theme:document.documentElement.dataset.theme}));}catch{}};
  const saveReading=()=>{clearTimeout(saveTimer);saveTimer=setTimeout(persistReading,150);};
  window.addEventListener('pagehide',persistReading);
  window.addEventListener('scroll',saveReading,{passive:true});
  const remember = f => { if(!f)return; const on=f.querySelector('.opt.on');drafts.set(f.dataset.id,{answer:on?.dataset.v||'',note:f.querySelector('textarea').value,base:f.dataset.base||rev});saveReading(); };
  const initialize = () => document.querySelectorAll('form.fb').forEach(f=>{f.dataset.base=rev;const d=drafts.get(f.dataset.id);if(d){f.classList.add('picked');f.querySelector('textarea').value=d.note;f.querySelectorAll('.opt').forEach(b=>b.classList.toggle('on',b.dataset.v===d.answer));f.dataset.base=d.base;}});
  document.addEventListener('input',e=>remember(e.target.closest('form.fb')));
  // Leave file links in the existing editor navigation, in the same pane.
  document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(!a)return;const href=a.getAttribute('href');if(href.startsWith('#')||/^(https?:|mailto:)/i.test(href)||href==='src')return;if(href.includes('/asset/')){a.target='_blank';a.rel='noopener';return;}e.preventDefault();parent.postMessage({type:'omega-document-open',path:href},location.origin);});
  const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2600); };
  const stamp = (s) => { $('#stamp').textContent = s; };
  const editing = () => { const a = document.activeElement; return a && a.tagName === 'TEXTAREA' && a.value.trim() !== (a.defaultValue || '').trim(); };

  // Prototype navigation, inspection and expansion belong to each graph.
  // The same state survives a file refresh; no prototype action writes data.
  const graphs = new Map();
  const svgNS = 'http://www.w3.org/2000/svg';
  const viewsOf = g => Array.from(g.querySelectorAll('.sg-stage > [data-view]'));
  function graphState(g) {
    if (!graphs.has(g.dataset.graph)) graphs.set(g.dataset.graph, { history: [g.dataset.start], mode: 'screen', highlight: false, expanded: false, zoom: innerWidth < 720 ? .7 : .85 });
    return graphs.get(g.dataset.graph);
  }
  const svgEl = (name, attrs = {}) => {
    const el = document.createElementNS(svgNS, name);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  };
  function buildOverview(g) {
    if (g.dataset.built || !viewsOf(g).length) return;
    g.dataset.built = 'true';
    const views = viewsOf(g), byId = new Map(views.map(v => [v.dataset.view, v]));
    const links = [];
    views.forEach(v => {
      v.querySelectorAll('[data-sg-to]').forEach(b => {
        const target = byId.get(b.dataset.sgTo);
        if (!target) return;
        b.dataset.destination = target.dataset.title;
        if (!b.title) b.title = target.dataset.title;
        const existing = links.find(e => e.from === v.dataset.view && e.to === b.dataset.sgTo);
        const label = b.textContent.trim() || target.dataset.title;
        if (existing) { if (!existing.labels.includes(label)) existing.labels.push(label); }
        else links.push({ from: v.dataset.view, to: b.dataset.sgTo, labels: [label], nav: !!b.closest('.sg-app-nav') });
        if (existing && !b.closest('.sg-app-nav')) existing.nav = false;
      });
    });
    // Place screens by the shortest path through their actual content controls.
    // Persistent app navigation is available in the inspector without crowding
    // the graph with repeated sidebar routes.
    const levels = new Map([[g.dataset.start, 0]]), queue = [g.dataset.start];
    for (let i = 0; i < queue.length; i++) {
      links.filter(e => e.from === queue[i] && !e.nav).forEach(e => {
        if (!levels.has(e.to)) { levels.set(e.to, levels.get(e.from) + 1); queue.push(e.to); }
      });
    }
    const lastLevel = Math.max(0, ...levels.values()) + 1;
    views.forEach(v => { if (!levels.has(v.dataset.view)) levels.set(v.dataset.view, lastLevel); });
    const columns = new Map();
    levels.forEach((level, id) => { if (!columns.has(level)) columns.set(level, []); columns.get(level).push(id); });
    const rows = Math.max(...Array.from(columns.values(), c => c.length)), positions = new Map();
    columns.forEach((ids, column) => ids.forEach((id, row) => positions.set(id, { x: 42 + column * 310, y: 42 + row * 236 + (rows - ids.length) * 48 })));
    const canvas = g.querySelector('.sg-canvas'), nodes = g.querySelector('.sg-nodes'), wires = g.querySelector('.sg-wires');
    const width = 84 + (Math.max(...levels.values()) + 1) * 310, height = 90 + rows * 236;
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    wires.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const markerId = 'sg-arrow-' + g.dataset.graph.replace(/[^a-z0-9_-]/gi, '');
    const defs = svgEl('defs'), marker = svgEl('marker', { id: markerId, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    marker.append(svgEl('path', { d: 'M0 0 L10 5 L0 10 z', fill: 'context-stroke' })); defs.append(marker); wires.append(defs);
    links.filter(e => !e.nav).forEach(e => {
      const a = positions.get(e.from), b = positions.get(e.to), forward = b.x > a.x;
      const x1 = a.x + (forward ? 230 : 115), y1 = a.y + (forward ? 86 : 180);
      const x2 = b.x + (forward ? 0 : 115), y2 = b.y + (forward ? 86 : 0);
      const path = forward ? `M${x1},${y1} C${x1 + 70},${y1} ${x2 - 70},${y2} ${x2},${y2}`
        : `M${x1},${y1} C${x1 + 70},${y1 + 72} ${x2 - 70},${y2 - 72} ${x2},${y2}`;
      const group = svgEl('g', { class: 'sg-wire', 'data-from': e.from, 'data-to': e.to });
      const hit = svgEl('path', { d: path, class: 'sg-wire-hit', 'data-sg-to': e.to, 'data-sg-from': e.from });
      const line = svgEl('path', { d: path, class: 'sg-wire-line', 'marker-end': `url(#${markerId})` });
      const title = svgEl('title'); title.textContent = e.labels.join(' · '); hit.append(title);
      const label = svgEl('text', {class: 'sg-wire-label', x: (x1 + x2) / 2 + (forward ? 0 : 32), y: (y1 + y2) / 2 - 8, 'text-anchor': 'middle'});
      label.textContent = e.labels[0];
      group.append(hit, line, label); wires.append(group);
    });
    views.forEach(v => {
      const id = v.dataset.view, at = positions.get(id), node = document.createElement('button');
      node.type = 'button'; node.className = 'sg-node'; node.dataset.sgTo = id;
      node.style.left = at.x + 'px'; node.style.top = at.y + 'px';
      const label = document.createElement('span'); label.className = 'sg-node-title'; label.textContent = v.dataset.title;
      const preview = document.createElement('span'); preview.className = 'sg-node-preview'; preview.setAttribute('aria-hidden', 'true');
      const clone = v.querySelector('.sg-app').cloneNode(true); clone.inert = true;
      clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      clone.querySelectorAll('[data-sg-to]').forEach(el => el.removeAttribute('data-sg-to'));
      preview.append(clone);
      const count = document.createElement('span'); count.className = 'sg-node-count'; count.textContent = links.filter(e => e.from === id).length + ' connections';
      node.append(label, preview, count);
      node.addEventListener('mouseenter', () => markOverview(g, id));
      node.addEventListener('mouseleave', () => markOverview(g, graphState(g).history.at(-1)));
      node.addEventListener('focus', () => markOverview(g, id));
      nodes.append(node);
    });
    g._routes = links; g._graphSize = { width, height, positions };
    const scroller = g.querySelector('.sg-graph-scroll');
    let drag = null;
    scroller.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button,.sg-wire-hit')) return;
      drag = { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
      scroller.setPointerCapture(e.pointerId);
    });
    scroller.addEventListener('pointermove', e => { if (drag) { scroller.scrollLeft = drag.left - e.clientX + drag.x; scroller.scrollTop = drag.top - e.clientY + drag.y; } });
    scroller.addEventListener('pointerup', () => { drag = null; });
    scroller.addEventListener('pointercancel', () => { drag = null; });
  }
  function markOverview(g, id) {
    g.querySelectorAll('.sg-wire').forEach(e => e.classList.toggle('is-related', e.dataset.from === id));
    g.querySelectorAll('.sg-node').forEach(n => n.classList.toggle('is-current', n.dataset.sgTo === id));
  }
  function zoomGraph(g, command) {
    const size = g._graphSize; if (!size) return;
    const state = graphState(g), scroll = g.querySelector('.sg-graph-scroll');
    if (command === 'fit') state.zoom = Math.min(1, (scroll.clientWidth - 24) / size.width, (scroll.clientHeight - 24) / size.height);
    else if (command) state.zoom = Math.max(.15, Math.min(1.5, state.zoom + (command === 'in' ? .15 : -.15)));
    g.querySelector('.sg-canvas').style.transform = `scale(${state.zoom})`;
    const sizer = g.querySelector('.sg-graph-sizer'); sizer.style.width = size.width * state.zoom + 'px'; sizer.style.height = size.height * state.zoom + 'px';
    if (command === 'fit') scroll.scrollTo(0, 0);
  }
  function paintGraph(g, focus = false) {
    const views = viewsOf(g), ids = views.map(v => v.dataset.view);
    if (!ids.length) return;
    const state = graphState(g);
    state.history = state.history.filter(id => ids.includes(id));
    if (!state.history.length) state.history = [g.dataset.start];
    const here = state.history.at(-1), active = views.find(v => v.dataset.view === here), overview = state.mode === 'graph';
    views.forEach(v => { v.hidden = v !== active; });
    g.classList.toggle('sg-highlights', state.highlight); g.classList.toggle('sg-expanded', state.expanded); g.classList.toggle('sg-graph-mode', overview);
    document.body.classList.toggle('sg-immersed', Array.from(graphs.values()).some(s => s.expanded));
    const workbench = g.querySelector('.sg-workbench');
    workbench.setAttribute('role', state.expanded ? 'dialog' : 'region');
    if (state.expanded) workbench.setAttribute('aria-modal', 'true'); else workbench.removeAttribute('aria-modal');
    g.querySelector('.sg-stage').hidden = overview;
    g.querySelector('.sg-overview').hidden = !overview;
    g.querySelector('[data-sg-back]').disabled = state.history.length < 2;
    [['highlight', state.highlight], ['mode', overview], ['expand', state.expanded]].forEach(([key, on]) => g.querySelector(`[data-sg-${key}]`).setAttribute('aria-pressed', String(on)));
    g.querySelector('[data-sg-mode]').setAttribute('aria-label', overview ? 'Return to screen' : 'Show screen graph');
    g.querySelector('[data-sg-expand]').setAttribute('aria-label', state.expanded ? 'Exit full screen' : 'Expand prototype');
    g.querySelector('[data-sg-mode]').dataset.tip = overview ? 'Return to screen · G' : 'Screen graph · G';
    g.querySelector('[data-sg-expand]').dataset.tip = state.expanded ? 'Exit full screen · Esc' : 'Full screen · Esc to exit';
    g.querySelector('.sg-announcement').textContent = (overview ? 'Screen graph · ' : '') + active.dataset.title;
    buildOverview(g); zoomGraph(g); markOverview(g, here);
    const inspector = g.querySelector('.sg-graph-inspector'); inspector.replaceChildren();
    const caption = document.createElement('strong'); caption.textContent = active.dataset.title + ' →'; inspector.append(caption);
    (g._routes || []).filter(e => e.from === here).forEach(e => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.sgTo = e.to; button.dataset.sgFrom = e.from;
      button.textContent = e.labels.join(' / ') + ' → ' + views.find(v => v.dataset.view === e.to).dataset.title;
      inspector.append(button);
    });
    if (focus) {
      const el = overview ? g.querySelector('.sg-node.is-current') : active.querySelector('.d-title,.s-bar b');
      if (el && !el.matches('button')) el.setAttribute('tabindex', '-1');
      (el || workbench).focus({ preventScroll: true });
      if (overview && g._graphSize) {
        const at = g._graphSize.positions.get(here), scroll = g.querySelector('.sg-graph-scroll');
        scroll.scrollTo({left: Math.max(0, (at.x + 115) * state.zoom - scroll.clientWidth / 2), top: Math.max(0, (at.y + 90) * state.zoom - scroll.clientHeight / 2)});
      }
    }
  }
  const paintGraphs = () => document.querySelectorAll('.screen-graph').forEach(g => paintGraph(g));
  function expandGraph(g, on) {
    const state = graphState(g); state.expanded = on;
    if (on) { state.returnFocus = document.activeElement; state.scroll = scrollY; }
    paintGraph(g);
    if (on) g.querySelector('.sg-workbench').focus({ preventScroll: true });
    else { (state.returnFocus?.isConnected ? state.returnFocus : g.querySelector('[data-sg-expand]')).focus({ preventScroll: true }); scrollTo(0, state.scroll || 0); }
  }
  document.addEventListener('click', e => {
    const button = e.target.closest('[data-sg-to],[data-sg-back],[data-sg-reset],[data-sg-highlight],[data-sg-mode],[data-sg-expand],[data-sg-zoom]');
    const g = button?.closest('.screen-graph');
    if (!g) return;
    e.preventDefault();
    const state = graphState(g);
    if (button.hasAttribute('data-sg-zoom')) { zoomGraph(g, button.dataset.sgZoom); return; }
    if (button.hasAttribute('data-sg-expand')) { expandGraph(g, !state.expanded); return; }
    if (button.hasAttribute('data-sg-highlight')) state.highlight = !state.highlight;
    else if (button.hasAttribute('data-sg-mode')) state.mode = state.mode === 'graph' ? 'screen' : 'graph';
    else if (button.hasAttribute('data-sg-reset')) { state.history = [g.dataset.start]; state.mode = 'screen'; }
    else if (button.hasAttribute('data-sg-back')) { if (state.history.length > 1) state.history.pop(); state.mode = 'screen'; }
    else {
      const from = button.dataset.sgFrom;
      if (from && state.history.at(-1) !== from) state.history.push(from);
      if (state.history.at(-1) !== button.dataset.sgTo) state.history.push(button.dataset.sgTo);
      state.mode = 'screen';
    }
    paintGraph(g, !button.hasAttribute('data-sg-highlight'));
  });
  document.addEventListener('keydown', e => {
    const g = document.querySelector('.sg-expanded') || e.target.closest('.screen-graph');
    if (!g) return;
    const editable = e.target.closest('input,textarea,select,[contenteditable]');
    if (editable && e.key === 'Enter' && e.target.closest('.sg-compose')) { e.preventDefault(); e.target.closest('.sg-compose').querySelector('[data-sg-to]')?.click(); return; }
    if (e.key === 'Escape' && graphState(g).expanded) { e.preventDefault(); expandGraph(g, false); return; }
    if (!editable && !e.ctrlKey && !e.metaKey && !e.altKey && ['h', 'g'].includes(e.key.toLowerCase())) {
      e.preventDefault(); g.querySelector(e.key.toLowerCase() === 'h' ? '[data-sg-highlight]' : '[data-sg-mode]').click();
    }
    if (e.key === 'Tab' && graphState(g).expanded) {
      const elements = Array.from(g.querySelector('.sg-workbench').querySelectorAll('button:not(:disabled),input,a[href],textarea,select,[contenteditable="true"],[tabindex="0"]')).filter(el => el.getClientRects().length && !el.closest('[inert]'));
      if (!elements.length) return;
      if (e.shiftKey && (document.activeElement === elements[0] || !elements.includes(document.activeElement))) { e.preventDefault(); elements.at(-1).focus(); }
      else if (!e.shiftKey && (document.activeElement === elements.at(-1) || !elements.includes(document.activeElement))) { e.preventDefault(); elements[0].focus(); }
    }
  });

  const readJSON = async path => {
    const response=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(8000)});
    const data=await response.json();
    if(!response.ok||data.ok===false)throw new Error(data.message||data.error||`HTTP ${response.status}`);
    return data;
  };
  async function refresh(force) {
    try {
      const r = await readJSON('rev');
      if(typeof r.rev!=='string'||typeof r.generation!=='string')throw new Error('Document revision unavailable');
      stamp('live · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      if (r.generation === generation && !force) return;
      if (busy) return;
      const d = await readJSON('doc');
      if(typeof d.html!=='string')throw new Error('Document view unavailable');
      const y = scrollY, active = document.activeElement, focused = active?.tagName==='TEXTAREA' ? active.closest('form.fb')?.dataset.id : null;
      const selection = focused ? [active.selectionStart,active.selectionEnd] : null;
      const disclosures = [...document.querySelectorAll('details')].map(x=>[x.id||x.querySelector('summary')?.textContent,x.open]);
      const videos=[...document.querySelectorAll('video')].map(v=>[v.getAttribute('src'),v.currentTime,v.paused]);
      $('#doc').innerHTML = d.html; rev = d.rev; generation=d.generation; initialize();
      disclosures.forEach(([id,open])=>{const x=[...document.querySelectorAll('details')].find(x=>(x.id||x.querySelector('summary')?.textContent)===id);if(x)x.open=open;});
      videos.forEach(([src,time,paused])=>{const v=[...document.querySelectorAll('video')].find(v=>v.getAttribute('src')===src);if(v){v.currentTime=time;if(!paused)v.play().catch(()=>{});}});
      if(focused){const f=[...document.querySelectorAll('form.fb')].find(f=>f.dataset.id===focused),input=f?.querySelector('textarea');input?.focus({preventScroll:true});if(selection)input?.setSelectionRange(...selection);}
      const design = $('#doc .app2')?.dataset.design;
      if (design) document.documentElement.dataset.design = design;
      else delete document.documentElement.dataset.design;
      show(current); paintGraphs(); scrollTo(0, y);
    } catch (e) { stamp('offline · ' + e.message); }
  }

  document.addEventListener('click', (e) => {
    const opt = e.target.closest('form.fb .opt');
    if (opt) { opt.closest('form').classList.add('picked'); opt.parentElement.querySelectorAll('.opt').forEach(b => b.classList.toggle('on', b === opt && !b.classList.contains('on'))); remember(opt.closest('form')); }
  });

  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form.fb'); if (!f) return;
    e.preventDefault();
    const on = f.querySelector('.opt.on');
    const body = { id: f.dataset.id, answer: on ? on.dataset.v : '', note: f.querySelector('textarea').value, base: f.dataset.base || rev };
    if (f.classList.contains('sending')) return;
    busy = true; f.classList.add('sending');
    try {
      const res = await fetch('answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const text = await res.text();
      let j;
      try { j = text ? JSON.parse(text) : null; } catch { j = null; }
      if (!res.ok) throw new Error(j?.error || `The server returned HTTP ${res.status}. Your draft is still here; try again.`);
      if (!j || j.ok !== true || typeof j.rev !== 'string') throw new Error('The server did not confirm the save. Your draft is still here; try again.');
      drafts.delete(body.id);saveReading(); toast(body.answer ? 'Saved to the document' : 'Answer cleared');
      busy = false; document.activeElement && document.activeElement.blur(); await refresh(true);
    } catch (err) { toast('Not saved: ' + err.message); busy=false;await refresh(true);const draft=drafts.get(body.id);if(draft){draft.base=rev;const current=[...document.querySelectorAll('form.fb')].find(x=>x.dataset.id===body.id);if(current)current.dataset.base=rev;} }
    finally { busy = false; f.classList.remove('sending'); }
  });

  $('#theme').onclick = () => {
    const r = document.documentElement, dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const cur = r.dataset.theme || (dark ? 'dark' : 'light'); r.dataset.theme = cur === 'dark' ? 'light' : 'dark';
  };
  // ── sections as pages: the sidebar picks one, #all shows the whole file ──
  let current = null;
  const secs = () => Array.from(document.querySelectorAll('section.part[data-sec]'));
  const sectionOf = (el) => el && el.closest('section.part[data-sec]');
  function show(id) {
    const list = secs(); if (!list.length) return;
    const all = id === 'all';
    let target = null;
    if (!all) { const el = id && document.getElementById(id); target = el && el.matches('section.part') ? el : list[0]; }
    list.forEach(s => { s.hidden = !(all || s === target); });
    const head = $('header.doc'); if (head) head.hidden = !(all || target === list[0]);
    document.body.classList.toggle('all-mode', all);
    current = all ? 'all' : target.id;
    document.querySelectorAll('.side-item').forEach(i => i.classList.toggle('on', i.dataset.sec === current));
    document.querySelectorAll('.side-all').forEach(a => a.classList.toggle('on', all));
    document.querySelectorAll('nav.chips a').forEach(a => {
      const h = decodeURIComponent(a.getAttribute('href').slice(1)), el = document.getElementById(h);
      a.classList.toggle('on', all ? h === 'all' : !!(el && sectionOf(el) === target));
    });
  }
  function route(scroll) {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h) { show(current); return; }
    if (h === 'all') { show('all'); if (scroll) scrollTo(0, 0); return; }
    const el = document.getElementById(h);
    if (el && el.matches('section.part')) { show(h); if (scroll) scrollTo(0, 0); return; }
    if (el) { const s = sectionOf(el); if (s && current !== 'all') show(s.id); if (scroll) el.scrollIntoView({ block: 'start' }); return; }
    show(current);
  }
  window.addEventListener('hashchange', () => route(true));
  document.addEventListener('keydown', (e) => {
    if (current === 'all' || e.target.closest('input,textarea,select,.screen-graph') || e.metaKey || e.ctrlKey || e.altKey) return;
    const list = secs(), i = list.findIndex(s => s.id === current);
    if (e.key === 'ArrowRight' && i < list.length - 1) location.hash = list[i + 1].id;
    if (e.key === 'ArrowLeft' && i > 0) location.hash = list[i - 1].id;
  });
  if(saved.theme)document.documentElement.dataset.theme=saved.theme;
  if(!location.hash&&saved.hash)history.replaceState(null,'',saved.hash);
  route(true);
  if(saved.y)scrollTo(0,saved.y);
  paintGraphs();

  // Compose with the retained editor's existing controls through its public
  // event API. The iframe owns presentation; the editor still owns selection,
  // source editing and task context. No second editor or document state lives here.
  const owner=window.frameElement?.closest('.reader'), editor=parent!==window?parent.blEd:null;
  const sendEditor=(type,pane,extra=[])=>{if(!editor)return;const {R,K}=editor;editor.dispatch(R.hashMap(K('type'),K(type),...(pane?[K('pane'),K(pane)]:[]),...extra));};
  const sourceLink=e=>{const a=e.target.closest('a[href="src"]');if(!a||!editor)return;e.preventDefault();sendEditor(owner?'mobile/edit-mode':'dossier/edit',owner?.dataset.pane);};
  document.addEventListener('click',sourceLink);
  if(owner&&editor){
    const active=()=>window.frameElement?.isConnected&&!window.frameElement.hidden;
    const query=()=>parent.document.querySelector('.reader-search [data-field="search"]')?.value||'';
    const find=(back=false)=>{const q=query();if(!q)return;show('all');window.find(q,false,back,true);};
    const click=e=>{if(!active())return;const button=e.target.closest('[data-act]');if(!button)return;
      if(button.dataset.act==='heading'){
        const title=button.textContent.replace(/^(TODO|DONE|NEXT|DOING|BLOCKED|WAIT|REVIEW)\s+/,''),slug=title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
        if(document.getElementById(slug))setTimeout(()=>{location.hash=slug;},0);
      }
      if(['find-prev','find-next'].includes(button.dataset.act)){e.preventDefault();e.stopPropagation();find(button.dataset.act==='find-prev');}
      if(button.dataset.act==='copy-passage'&&getSelection()?.toString()){e.preventDefault();e.stopPropagation();parent.navigator.clipboard.writeText(getSelection().toString()).catch(()=>{});}
    };
    const input=e=>{if(active()&&e.target.matches('[data-field="search"]'))find();};
    const passage=()=>{if(!active())return;const selected=getSelection()?.toString().trim();if(!selected)return;
      const {R,K,F}=editor,ed=F.d_editor(editor.frame(),K(owner.dataset.pane||'file')),lines=ed.get(K('text')).get(K('lines')).toArray();
      const pieces=selected.split('\n').filter(Boolean),start=lines.findIndex(l=>l.includes(pieces[0]));if(start<0)return;
      let end=start+1;const last=pieces.at(-1);for(let i=start;i<lines.length;i++)if(lines[i].includes(last)){end=i+1;break;}
      const selection=R.hashMap(K('path'),ed.get(K('path')),K('rev'),ed.get(K('doc')).get(K('rev')),K('start'),start,K('end'),end,K('text'),lines.slice(start,end).join('\n'));
      sendEditor('mobile/selection','rail',[K('selection'),selection]);
    };
    parent.document.addEventListener('click',click,true);parent.document.addEventListener('input',input);document.addEventListener('pointerup',passage);
    window.addEventListener('pagehide',()=>{parent.document.removeEventListener('click',click,true);parent.document.removeEventListener('input',input);document.removeEventListener('pointerup',passage);},{once:true});
  }
  initialize(); refresh(false); setInterval(() => refresh(false), 4000);
})();
