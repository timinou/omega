// Guideline explorer painter. Draws the BL view model (guidelines.pkg/model) and
// turns clicks into package events. It performs NO IO: data arrives in the model
// (fetched by the package through intents); actions go back as events.
import { css } from './css.mjs';

const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const THRESHOLD = 0.42;           // the default precision gate (guidelines.recall/gate)
const RECALL = 0.25;              // the semantic recall floor (guidelines.recall/semantic)
const GLYPH = { ready: '✓', proposed: '+', misfire: '≠', violated: '!' };
const KIND = { ready: 'example to accept', proposed: 'proposed guideline', misfire: 'did not fit', violated: 'shown, not followed' };
const used = (s) => (s?.candidate || 0) + (s?.ready || 0) + (s?.promoted || 0);
const ago = (ms) => { if (!ms) return ''; const s = (Date.now() - ms) / 1000; return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
const k = (s) => `<kbd>${esc(s)}</kbd>`;

export function createHost() {
  const views = new Set();
  return {
    mount(root, dispatch) {
      const style = document.createElement('style'); style.dataset.guidelines = ''; style.textContent = css;
      const wrap = document.createElement('div'); wrap.className = 'gx-wrap'; root.append(style, wrap);
      let model = null, tryDraft = null;
      const cmd = (command) => dispatch({ type: 'command', command });
      const view = {
        update(m) { model = m; draw(); },
        dispose() { style.remove(); wrap.remove(); views.delete(view); },
      };
      views.add(view);

      function draw() {
        if (!model) return;
        const keep = document.activeElement?.dataset?.gx;
        const caret = keep ? document.activeElement.selectionStart : null;
        const d = model.data, tab = model.tab || 'guidelines';
        const inboxN = d?.inbox?.length || 0;
        const src = String(model.path || '').split('/').pop();
        const head = `<header class="gx-head">
          <nav class="gx-tabs" role="tablist">
            ${tabBtn('guidelines', 'Guidelines', d?.guidelines?.length)}${tabBtn('inbox', 'Inbox', inboxN, true)}${tabBtn('try', 'Try', null)}
          </nav><span class="sp"></span><span class="gx-src" title="${esc(model.path)}">${model['dirty?'] ? '● ' : ''}<b>${esc(src)}</b>${d ? ` · ${(d.guidelines || []).filter((g) => g['on?']).length} on` : ''}</span>
          <span class="gx-hint">${model.busy ? '<span>reading…</span>' : ''}<button data-cmd="guidelines/help" title="space g ?">${k('space g ?')} guide</button><button data-cmd="guidelines/close" title="space g q">${k('space g q')}</button></span></header>`;
        const err = model.error ? `<div class="gx-err" role="alert">${esc(model.error)} <button class="gx-btn" data-cmd="guidelines/refresh">Retry</button></div>` : '';
        let body;
        if (!d) body = `<main class="gx-body one"><div class="gx-empty"><h3>Reading the guidelines…</h3><p>The explorer reads this file and every task's use of it from the world.</p></div></main>`;
        else if (tab === 'inbox') body = inbox(d);
        else if (tab === 'try') body = tryPane(d);
        else body = list(d);
        wrap.innerHTML = `<div class="gx ${model.busy ? 'gx-busy' : ''}">${head}${err}${body}${foot(tab)}</div>${model['help?'] ? guide() : ''}`;
        if (keep) { const el = wrap.querySelector(`[data-gx="${keep}"]`); if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(caret, caret); } catch {} } }
        wrap.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
      }

      function tabBtn(id, label, n, attention) {
        const cur = (model.tab || 'guidelines') === id;
        return `<button class="gx-tab" role="tab" aria-selected="${cur}" data-tab="${id}">${label}${n ? `<span class="n" ${attention ? '' : 'style="color:var(--crema)"'}>${n}</span>` : ''}</button>`;
      }

      // ── guidelines: list | detail ─────────────────────────────────────
      function list(d) {
        const gs = d.guidelines || [];
        if (!gs.length) return `<main class="gx-body one"><div class="gx-empty"><h3>No guidelines in this file yet</h3>
          <p>A guideline is a top-level heading with an <code>:ID:</code>, a one-paragraph rule, and a <code>** When</code> list of situations. Copy one of the seeds, or write your own; save with ${k('C-s')} and it appears here.</p></div></main>`;
        const on = gs.filter((g) => g['on?']), off = gs.filter((g) => !g['on?']);
        const row = (g) => {
          const u = used(g.stats), w = Math.min(5, 1 + Math.ceil(Math.log2(1 + u)));
          const warn = (g.stats?.violated || 0) + (g.stats?.misfire || 0);
          return `<button class="gx-row ${g['on?'] ? '' : 'off'}" style="--use:${w}px" data-select="${esc(g.id)}" aria-current="${g.id === model.selected}" title="${esc(g.rule)}">
            <span class="gx-dot ${g['on?'] ? 'on' : 'off'}"></span><span class="name">${esc(g.name)}</span>
            <span class="meta">${g.stats?.shown ? g.stats.shown + '×' : ''}${warn ? ` <span class="warn">${GLYPH.misfire}${warn}</span>` : ''}</span></button>`;
        };
        const sel = gs.find((g) => g.id === model.selected) || gs[0];
        return `<main class="gx-body"><nav class="gx-list" aria-label="Guidelines">
          ${on.length ? `<div class="gx-group">on · ${on.length}</div>${on.map(row).join('')}` : ''}
          <div class="gx-group">${on.length ? 'off' : 'all off — nothing is shown to the agent yet'} · ${off.length}</div>${off.map(row).join('')}
          </nav><article class="gx-detail">${detail(sel, d)}</article></main>`;
      }

      function detail(g, d) {
        const s = g.stats || {};
        const use = (n, label) => `<span class="${n ? '' : 'z'}"><b>${n || 0}</b>${label}</span>`;
        const props = Object.entries(g.props || {}).map(([k2, v]) => `<div class="gx-props">:${esc(k2.toUpperCase())}: ${esc(v)}</div>`).join('');
        const ex = (g.examples || []).map((e) => { const m = /^(\d{4}-\d{2}-\d{2})\s+(.*)$/.exec(e); return `<li>${m ? `<span class="d">${m[1]}</span>${esc(m[2])}` : esc(e)}</li>`; }).join('');
        const uses = (d.inbox || []).filter((i) => i.gid === g.id);
        return `<h2><span class="gx-dot ${g['on?'] ? 'on' : 'off'}"></span>${esc(g.name)}</h2>
          <div class="gx-sub"><code>${esc(g.id)}</code>${(g.tags || []).map((t) => `<span>#${esc(t)}</span>`).join('')}<span>${esc(g.scope)} · ${esc(String(g.path || '').split('/').pop())}</span>${g['last-at'] ? `<span>last used ${ago(g['last-at'])}</span>` : ''}</div>
          <p class="gx-rule">${esc(g.rule)}</p>
          <div class="gx-actions"><button class="gx-switch ${g['on?'] ? 'on' : ''}" data-cmd="guidelines/toggle"><span class="gx-dot ${g['on?'] ? 'on' : 'off'}"></span>${g['on?'] ? 'On — shown when it matches' : 'Off — never shown'}</button>
            <span class="k">${k('space g t')}</span>
            <span class="sp"></span><button class="gx-btn" data-try-when="${esc(g.id)}">Try its When lines</button></div>
          <div class="gx-sec">uses <span class="why">— what happened when tasks saw it</span></div>
          <div class="gx-uses">${use(s.shown, ' shown')}${use((s.candidate || 0) + (s.ready || 0) + (s.promoted || 0), ' applied')}${use(s.promoted, ' became examples')}${use(s.misfire, ' misfired')}${use(s.violated, ' not followed')}</div>
          ${uses.length ? `<ul class="gx-l" style="margin-top:8px">${uses.map((i) => `<li><button data-inbox="${esc(i.subject)}">${GLYPH[i.kind] || ''} ${esc(i.text || '')}</button> <span class="gx-uses z">task ${esc(i.task)}</span></li>`).join('')}</ul>` : ''}
          <div class="gx-sec">when <span class="why">— the situations it is matched against</span></div>
          <ul class="gx-l">${(g.when || []).map((w) => `<li>${esc(w)}</li>`).join('') || '<li class="z">none: it can only fire through a trigger</li>'}</ul>
          ${(g.not || []).length ? `<div class="gx-sec">not when <span class="why">— near-misses that count against it</span></div><ul class="gx-l not">${g.not.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
          ${props ? `<div class="gx-sec">triggers <span class="why">— certain, no matching needed</span></div>${props}` : ''}
          <div class="gx-sec">examples <span class="why">— recorded uses; each one also teaches the matcher</span></div>
          ${ex ? `<ul class="gx-l ex">${ex}</ul>` : '<p class="gx-uses z">None yet. Accepted uses from the inbox land here.</p>'}`;
      }

      // ── inbox ─────────────────────────────────────────────────────────
      function inbox(d) {
        const xs = d.inbox || [];
        if (!xs.length) return `<main class="gx-body one"><div class="gx-empty"><h3>Nothing waits for you</h3>
          <p>When a task applies an ON guideline and finishes well, its use arrives here as an example to accept. Proposals from the agent, misfires and guidelines it did not follow arrive here too. Nothing reaches the file without you.</p></div></main>`;
        const cur = xs.find((x) => x.subject === model['inbox-sel']) || xs[0];
        const item = (x) => `<button class="gx-item k-${esc(x.kind)}" data-inbox="${esc(x.subject)}" aria-current="${x === cur}">
          <span class="g" aria-label="${esc(KIND[x.kind] || x.kind)}">${GLYPH[x.kind] || '·'}</span>
          <span><span class="t">${esc(x.text || x.note || '')}</span><span class="m">${esc(x.gid)} · ${esc(x.task)} · ${ago(x.at)}</span></span></button>`;
        return `<main class="gx-body"><nav class="gx-list" aria-label="Inbox">${xs.map(item).join('')}</nav><article class="gx-detail">${inboxDetail(cur, d)}</article></main>`;
      }

      function inboxDetail(x, d) {
        const g = (d.guidelines || []).find((y) => y.id === x.gid);
        const title = { ready: 'Accept this as an example?', proposed: 'A new guideline was proposed', misfire: 'It did not fit', violated: 'It was shown and not followed' }[x.kind] || x.kind;
        const what = {
          ready: `A task finished after applying <b>${esc(g?.name || x.gid)}</b>. Accepting appends this line under its Examples; the matcher reads it from then on.`,
          proposed: x.source === 'dialect' ? 'The agent hit a dialect gap. This draft would warn the next task before it makes the same call.' : 'The agent suggested this. To keep it, copy it into the file as a new heading.',
          misfire: `The agent said <b>${esc(g?.name || x.gid)}</b> did not apply. If it is right, add the situation under <code>** Not when</code>.`,
          violated: `The judge saw <b>${esc(g?.name || x.gid)}</b> shown and not followed${x.p != null ? ` (p ${Number(x.p).toFixed(2)})` : ''}. Read the task; either the rule needs sharper words or the task needs a look.`,
        }[x.kind] || '';
        const quote = x.kind === 'ready' ? `- ${x.line || ''}` : x.kind === 'proposed' && x.draft ? `* ${x.draft.name}\n${x.draft.rule}\n** When\n${(x.draft.when || []).map((w) => '- ' + w).join('\n')}` : (x.note || x.text || '');
        const related = (x.related || []).length ? `<div class="gx-sec">nearby functions</div><ul class="gx-l ex">${x.related.map((r) => `<li>${esc(r.name)} <span class="d">${esc(r.ns)} · ${Number(r.score).toFixed(2)}</span></li>`).join('')}</ul>` : '';
        const accept = x.kind === 'ready'
          ? `<button class="gx-btn primary" data-cmd="guidelines/accept" ${model['dirty?'] ? 'disabled title="Save the file first (C-s)"' : ''}>Accept ${k('space g a')}</button>` : '';
        return `<h2><span style="color:var(--${{ ready: 'sage', proposed: 'lavender', misfire: 'butter', violated: 'rose' }[x.kind] || 'crema'})">${GLYPH[x.kind] || ''}</span>${esc(title)}</h2>
          <div class="gx-sub"><span>${esc(KIND[x.kind] || x.kind)}</span><span>task <code>${esc(x.task)}</code></span>${x.goal ? `<span>while: ${esc(x.goal)}</span>` : ''}<span>${ago(x.at)}</span></div>
          <p class="gx-rule" style="font-size:14.5px">${what}</p>
          <div class="gx-quote">${esc(quote)}</div>${related}
          <div class="gx-actions">${accept}<button class="gx-btn" data-cmd="guidelines/reject">${x.kind === 'ready' ? 'Reject' : 'Dismiss'} ${k('space g x')}</button>
          ${g ? `<button class="gx-btn" data-select="${esc(g.id)}">Open the guideline</button>` : ''}</div>`;
      }

      // ── try ───────────────────────────────────────────────────────────
      function tryPane(d) {
        const t = model.try || {}, rows = t.rows || [];
        const text = tryDraft ?? t.text ?? '';
        const meter = (r) => {
          const sc = Math.max(0, Math.min(1, r.score || 0));
          const fire = r['picked?'];
          return `<button class="gx-meter ${fire ? 'fire' : ''} ${r['on?'] ? '' : 'off'}" data-select="${esc(r.id)}" title="${fire && !r['on?'] ? 'Would fire, but it is off' : ''}">
            <span class="nm"><span class="gx-dot ${r['on?'] ? 'on' : 'off'}"></span> ${esc(r.name)}</span>
            <span class="bar"><i style="width:${(sc * 100).toFixed(1)}%"></i><u style="left:${THRESHOLD * 100}%"></u></span>
            <span class="sc">${sc.toFixed(2)}</span>
            ${r.anchor && sc >= RECALL ? `<span class="why">closest: “${esc(r.anchor)}”${r.neg != null && r.neg + 0.05 >= sc ? ` · held back by a not-when` : ''}</span>` : ''}</button>`;
        };
        return `<main class="gx-body one"><section class="gx-try">
          <form data-form="try"><input data-gx="try" placeholder="Describe what an agent is about to do — e.g. “make the failed cards look different”" value="${esc(text)}" aria-label="Situation"><button class="gx-btn primary" type="submit">Try</button></form>
          <p class="lede">Each bar is how close the situation is to a guideline's When lines and examples. The hairline is the threshold; solid green fires. Striped green would fire but is off. In a file, ${k('space g .')} tries the line under the cursor.</p>
          ${rows.length ? rows.map(meter).join('') : '<div class="gx-empty" style="padding:8px 0"><p>Nothing tried yet.</p></div>'}</section></main>`;
      }

      // ── footer and guide: keys for this place ─────────────────────────
      function foot(tab) {
        const common = `<span>${k('space g j')}${k('space g k')} move</span><span>${k('space g l')}${k('space g i')}${k('space g /')} places</span>`;
        const here = tab === 'inbox' ? `<span>${k('space g a')} accept</span><span>${k('space g x')} reject</span>`
          : tab === 'try' ? `<span>${k('space g .')} try this line</span><span>${k('Enter')} in the field</span>`
            : `<span>${k('space g t')} on/off</span><span>edit the file on the left, ${k('C-s')} saves</span>`;
        return `<footer class="gx-foot">${common}${here}</footer>`;
      }

      function guide() {
        return `<aside class="gx-guide" role="dialog" aria-label="Explorer guide">
          <h3>How guidelines work</h3>
          <p>The file on the left is the source of truth. Each top-level heading is one guideline: a rule, the <b>When</b> situations it is matched against, near-misses under <b>Not when</b>, and recorded <b>Examples</b>.</p>
          <p>Nothing reaches an agent until you switch it <b>ON</b>, a word that then sits in its heading. On every step, ON guidelines whose When lines are close to what the agent is doing ride along with the request; they are never stored in the transcript.</p>
          <div class="gx-legend">
            <span class="g"><span class="gx-dot on"></span></span><span>on — shown when it matches</span>
            <span class="g"><span class="gx-dot off"></span></span><span>off — never shown</span>
            <span class="rule"></span><span>thicker rule — used more</span>
            <span class="g" style="color:var(--sage)">✓</span><span>an example to accept</span>
            <span class="g" style="color:var(--butter)">≠</span><span>did not fit the task</span>
            <span class="g" style="color:var(--rose)">!</span><span>shown, not followed</span></div>
          <dl>
            <dt>${k('space g g')}</dt><dd>open the explorer on a guidelines file</dd>
            <dt>${k('space g j')}${k('space g k')}</dt><dd>next · previous — the file's cursor follows</dd>
            <dt>${k('space g t')}</dt><dd>switch the current guideline on or off</dd>
            <dt>${k('space g /')}${k('space g .')}</dt><dd>try a situation · try the line under the cursor</dd>
            <dt>${k('space g i')}${k('space g a')}${k('space g x')}</dt><dd>inbox · accept · reject</dd>
            <dt>${k('space ?')}${k('space space')}</dt><dd>every key · every command, searchable</dd>
          </dl>
          <div class="ok"><button class="gx-btn" data-cmd="guidelines/help">Got it ${k('space g ?')}</button></div></aside>`;
      }

      // ── events: every click is a package event; IO stays in BL intents ─
      wrap.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tab],[data-select],[data-inbox],[data-cmd],[data-try-when]'); if (!b) return;
        if (b.dataset.tab) return dispatch({ type: 'guidelines/tab', tab: b.dataset.tab });
        if (b.dataset.select) return dispatch({ type: 'guidelines/select', id: b.dataset.select });
        if (b.dataset.inbox) return dispatch({ type: 'guidelines/inbox-select', subject: b.dataset.inbox });
        if (b.dataset.cmd) return cmd(b.dataset.cmd);
        if (b.dataset.tryWhen) { const g = model.data?.guidelines?.find((x) => x.id === b.dataset.tryWhen); tryDraft = null; return dispatch({ type: 'guidelines/try', text: (g?.when || [g?.name || '']).join('; ') }); }
      });
      wrap.addEventListener('input', (e) => { if (e.target.dataset.gx === 'try') tryDraft = e.target.value; });
      wrap.addEventListener('submit', (e) => {
        e.preventDefault(); const v = wrap.querySelector('[data-gx="try"]')?.value || '';
        if (v.trim()) { tryDraft = null; dispatch({ type: 'guidelines/try', text: v.trim() }); }
      });
      // keys typed in the field belong to the field, not to the editor
      wrap.addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT') e.stopPropagation(); });
      return view;
    },
    dispose() { for (const v of [...views]) v.dispose(); views.clear(); },
  };
}
