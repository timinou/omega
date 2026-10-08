// Optional package-owned host resources. BL emits effects/models; only this
// boundary creates IO resources. A module exports createHost(api), never runs
// application initialization on import. All resources follow package lifetime.
export function packageHosts(api) {
  const factories = new Map(), resources = new Map(), mounts = new Map(), generations = new Map();
  let active = new Set();
  function resource(name) {
    if (!active.has(name)) return null;
    if (!resources.has(name) && factories.has(name)) {
      const generation = {}; generations.set(name, generation);
      resources.set(name, factories.get(name)({ ...api,
        dispatch: event => { if (active.has(name) && generations.get(name) === generation) api.dispatch(event); },
      }));
    }
    return resources.get(name);
  }
  const dropMount = root => { mounts.get(root)?.view?.dispose?.(); mounts.delete(root); };
  return {
    register(name, factory) { if (typeof factory === 'function') factories.set(name, factory); },
    sync(names) {
      active = new Set(names);
      for (const [root, m] of mounts) if (!root.isConnected || !active.has(m.name)) dropMount(root);
      for (const [name, r] of resources) if (!active.has(name)) { generations.delete(name); r.dispose?.(); resources.delete(name); }
    },
    effect(name, effect) {
      const r = resource(name); if (!r) return;
      const generation = generations.get(name);
      const current = () => active.has(name) && generations.get(name) === generation;
      try {
        const result = r.effect?.(effect);
        return result?.then ? result.catch(error => { if (current()) throw error; }) : result;
      } catch (error) { if (current()) throw error; }
    },
    paint(name, root, model, pane) {
      const r = resource(name); if (!r) return;
      let m = mounts.get(root);
      if (m && m.name !== name) { dropMount(root); m = null; }
      if (!m) {
        m = { name }; mounts.set(root, m);
        const generation = generations.get(name), mounted = m;
        m.view = r.mount?.(root, event => {
          if (active.has(name) && generations.get(name) === generation && mounts.get(root) === mounted && root.isConnected) api.dispatch({ ...event, pane });
        });
      }
      m.view?.update?.(model);
    },
    dispose() {
      active.clear(); generations.clear();
      for (const root of [...mounts.keys()]) dropMount(root);
      for (const r of resources.values()) r.dispose?.();
      resources.clear(); generations.clear(); active.clear();
    },
  };
}
