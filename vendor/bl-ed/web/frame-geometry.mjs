// Frame geometry only. Docked views span the ordinary editor columns.
export function frameGeometry(panes) {
  const top = panes.filter(p => p.dock === 'top');
  const bottom = panes.filter(p => p.dock === 'bottom');
  const middle = panes.filter(p => !['top', 'bottom'].includes(p.dock));
  const height = p => `${Number.isFinite(p.height) ? Math.max(0, p.height) : 44}px`;
  const columns = middle.map(p => p.width).join(' ') || 'minmax(0, 1fr)';
  const rows = [...top.map(height), 'minmax(0, 1fr)', ...bottom.map(height)].join(' ');
  const placements = new Map();
  top.forEach((p, i) => placements.set(p.id, {row: String(i + 1), column: '1 / -1'}));
  middle.forEach((p, i) => placements.set(p.id, {row: String(top.length + 1), column: String(i + 1)}));
  bottom.forEach((p, i) => placements.set(p.id, {row: String(top.length + 2 + i), column: '1 / -1'}));
  return {columns, rows, placements};
}
