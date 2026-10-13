// DOM and same-origin viewer boundary. Decisions and bounded rows are home.main.
export function createHost(api) {
  let pending = null, timer = null, disposed = false, deadline = 0;
  const priorTitle = document.title, hadClass = document.body.classList.contains('omega-home-window');
  document.body.classList.add('omega-home-window'); document.title = 'Omega';
  function deliver() {
    if (!pending || disposed) return;
    const frame = document.querySelector('[data-pane="work"] iframe');
    const editor = frame?.contentWindow?.blEd;
    if (!editor) {
      if (performance.now() > deadline) { pending = null; api.dispatch({type:'home/error',message:'Work could not open. Select it again to retry.'}); return; }
      timer = setTimeout(deliver, 50); return;
    }
    const args = pending; pending = null;
    editor.dispatch(editor.R.hashMap(editor.K('type'), editor.K('mobile/nav'),
      editor.K('screen'), args.screen, editor.K('path'), args.path, editor.K('pane'), editor.K('rail')));
  }
  return {
    effect(effect) {
      if (effect.op !== 'navigate') return;
      pending = effect.args; deadline = performance.now() + 15000; clearTimeout(timer); deliver();
    },
    mount(root, dispatch) {
      const priorStyle = root.getAttribute('style');
      root.style.cssText = 'position:absolute;inset:0;overflow:hidden';
      const style = document.createElement('link'); style.rel = 'stylesheet';
      style.href = new URL('style.css', import.meta.url); root.append(style);
      const surface = document.createElement('section'); surface.className = 'omega-home';
      surface.innerHTML = `<nav aria-label="Omega"><button data-activity="home" title="Home">ω<span>Home</span></button><button data-activity="work">Work</button><button data-activity="music">Play</button><button data-activity="machine">Machine</button></nav><main><header><p class="eyebrow">OMEGA</p><h1>Your work</h1><button data-refresh aria-label="Refresh work">↻</button></header><section data-section="continue"><h2>Continue</h2><div data-list="continue"></div><p data-empty>Open your work, or begin something new.</p></section><section data-section="attention"><h2>Needs you</h2><div data-list="attention"></div></section><section><h2>Start something</h2><div class="starts"><button data-activity="work"><strong>Work</strong><span>Tasks, documents and places</span></button><button data-activity="music"><strong>Pelagic</strong><span>Code, sound and light</span></button></div></section><section data-section="places"><h2>Places</h2><div data-list="places"></div></section><footer><span data-status>Connecting…</span><button data-activity="machine">Inspect the machine ↗</button></footer><p role="status" data-error></p></main>`;
      root.append(surface); let previous = '', lastActivity = null, focusFrame = 0, mounted = true;
      const lists = new Map();
      function rows(name, values, kind) {
        const parent = surface.querySelector(`[data-list="${name}"]`), old = lists.get(name) || new Map(), next = new Map();
        values.forEach((value, i) => {
          const id = value.key; let button = old.get(id);
          if (!button) { button = document.createElement('button'); button.innerHTML = '<strong></strong><span></span>'; }
          button.dataset[kind] = id;
          button.querySelector('strong').textContent = value.title || id;
          button.querySelector('span').textContent = kind === 'place' ? value.root || '' : [value['place-name'], value.status].filter(Boolean).join(' · ');
          if (parent.children[i] !== button) parent.insertBefore(button, parent.children[i] || null);
          next.set(id, button);
        });
        for (const [id, button] of old) if (!next.has(id)) button.remove();
        lists.set(name, next);
      }
      surface.addEventListener('click', event => {
        const button = event.target.closest('button'); if (!button) return;
        event.stopPropagation(); // Home controls own focus; do not refocus the hidden editor sink.
        if (button.dataset.activity) dispatch({type:'home/open',activity:button.dataset.activity});
        if (button.dataset.task) dispatch({type:'home/continue',id:button.dataset.task});
        if (button.dataset.place) dispatch({type:'home/place',path:button.dataset.place});
        if (button.hasAttribute('data-refresh')) dispatch({type:'home/refresh'});
      });
      return {
        update(model) {
          const signature = JSON.stringify(model); if (signature === previous) return; previous = signature;
          surface.classList.toggle('compact', model.activity !== 'home');
          if (model.activity !== lastActivity) {
            lastActivity = model.activity; cancelAnimationFrame(focusFrame);
            // The editor focuses its input sink after boot and clicks. Follow
            // that paint, keeping Home keyboard-accessible and restoring the
            // retained child's own focused control when an activity returns.
            focusFrame = requestAnimationFrame(() => {
              if (!mounted || disposed) return;
              if (lastActivity === 'home') surface.querySelector('nav [data-activity="home"]').focus();
              else document.querySelector(`[data-pane="${lastActivity}"] iframe`)?.contentWindow?.focus();
            });
          }
          for (const button of surface.querySelectorAll('nav button')) button.setAttribute('aria-current',button.dataset.activity === model.activity ? 'page' : 'false');
          const resumed = (model.opened || []).filter(x => x !== 'work').map(x => ({key:x,title:x==='music'?'Pelagic':'Runtime inspector',status:'Open in this window'}));
          rows('continue', model.tasks || [], 'task');
          const list = surface.querySelector('[data-list="continue"]');
          for (const stale of list.querySelectorAll('[data-resume]')) stale.remove();
          for (const item of resumed) { const button=document.createElement('button');button.dataset.activity=item.key;button.dataset.resume='';button.textContent=item.title+' ↗';list.append(button); }
          surface.querySelector('[data-empty]').hidden = !!((model.tasks || []).length || resumed.length);
          rows('attention', model.attention || [], 'task'); rows('places', model.places || [], 'place');
          surface.querySelector('[data-section="attention"]').hidden = !(model.attention || []).length;
          surface.querySelector('[data-section="places"]').hidden = !(model.places || []).length;
          surface.querySelector('[data-error]').textContent = model.error || '';
          surface.querySelector('[data-status]').textContent = model.ready ? 'Shared Omega world' : 'Work is unavailable · use Refresh to retry';
        },
        dispose() { mounted = false; cancelAnimationFrame(focusFrame); surface.remove(); style.remove(); if (priorStyle == null) root.removeAttribute('style'); else root.setAttribute('style',priorStyle); }
      };
    },
    dispose() { disposed = true; pending = null; clearTimeout(timer);
      if (!hadClass) document.body.classList.remove('omega-home-window'); document.title = priorTitle; }
  };
}
