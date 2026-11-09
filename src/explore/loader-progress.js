// Loader progress (pure, unit-tested): several weighted downloads → one 0–100 bar that never goes
// backwards. Total sizes may be unknown at first (no Content-Length); weights keep the bar honest.
export function createProgress(weights) {
  const items = Object.fromEntries(Object.entries(weights).map(([k, w]) => [k, { w, loaded: 0, total: 0, done: false }]));
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  let last = 0;
  return {
    update(key, loaded, total) {
      const it = items[key];
      if (!it) return last;
      it.loaded = loaded;
      if (total > 0) it.total = total;
      return this.value();
    },
    done(key) {
      if (items[key]) items[key].done = true;
      return this.value();
    },
    value() {
      let sum = 0;
      for (const it of Object.values(items)) {
        const f = it.done ? 1 : it.total > 0 ? Math.min(1, it.loaded / it.total) : 0;
        sum += f * it.w;
      }
      last = Math.max(last, Math.round((sum / totalWeight) * 100));
      return last;
    },
  };
}
