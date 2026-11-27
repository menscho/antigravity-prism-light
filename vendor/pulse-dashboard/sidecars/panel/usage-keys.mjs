// Upstream: ATtacK030130/antigrative-dashboard v0.9.1 (MIT License — Copyright (c) 2026 AG Pulse contributors)
// Integrated & adapted for Obsidian Prism under GPL-3.0-only compatibility terms.
// Pure leaf helpers shared by usage.mjs and usage-disk-worker.mjs (0 side effects, breaks static worker cycle).

const DATE_FMT_CACHE = new Map();

export function quotaModelFamily(value) {
  const s = String(value || '');
  if (/(?:^|[^a-z])argon(?:$|[^a-z])/i.test(s)) return 'gemini-argon';
  if (/gemini|neon|hydrogen|carbon|orchestrator/i.test(s)) return 'gemini';
  if (
    /claude|sonnet|opus|haiku|anthropic|gpt|openai/i.test(s) ||
    /(?:^|[^a-z0-9])o[134](?:$|[^a-z0-9])/i.test(s) ||
    /^3p(?:$|[-_])/i.test(s)
  ) {
    return '3p';
  }
  return null;
}

export function classifyQuotaGroupId(groups, model) {
  const list = Array.isArray(groups) ? groups.filter((g) => g && typeof g.id === 'string') : [];
  if (!list.length) return null;
  const kind = quotaModelFamily(model);
  const specific = kind && list.find((g) => quotaModelFamily(`${g.id} ${g.name || ''}`) === kind);
  if (specific) return specific.id;
  if (kind === 'gemini-argon') {
    const shared = list.find((g) => g.id === 'gemini' && quotaModelFamily(`${g.id} ${g.name || ''}`) === 'gemini');
    if (shared) return shared.id;
  }
  return kind ? null : list[0].id;
}

export function dateKey(time, zone = 'Asia/Shanghai') {
  let fmt = DATE_FMT_CACHE.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    if (DATE_FMT_CACHE.size >= 32) DATE_FMT_CACHE.delete(DATE_FMT_CACHE.keys().next().value);
    DATE_FMT_CACHE.set(zone, fmt);
  }
  const parts = fmt.formatToParts(time);
  const get = (key) => parts.find((p) => p.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function weekStart(date) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
