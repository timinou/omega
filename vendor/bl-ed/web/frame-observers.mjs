// Read-only subscriptions: delivery follows painting and cannot recurse into it.
export function frameObservers(report = error => console.error(error)) {
  const listeners = new Set();
  let pending = false, current;
  const notify = value => {
    current = value;
    if (pending || !listeners.size) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      for (const fn of [...listeners]) {
        if (!listeners.has(fn)) continue;
        try { fn(current); } catch (error) { report(error); }
      }
    });
  };
  return {notify, subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError('Frame observer must be a function');
    listeners.add(fn);
    return () => listeners.delete(fn);
  }};
}
