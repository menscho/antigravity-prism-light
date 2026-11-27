// Obsidian Prism — Multi-Route Free Machine Translate Client (Google GTX + Microsoft Edge/Bing)
// Zero external dependencies; strict HTTPS allowlist (anti-SSRF); per-route cooldowns & throttling.

import crypto from 'node:crypto';

export const ALLOWED_MT_HOSTS = Object.freeze(
  new Set(['translate.googleapis.com', 'www.bing.com'])
);
export const GTX_TARGET_LANG_MAP = Object.freeze({ 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', en: 'en', ja: 'ja', ko: 'ko', es: 'es', fr: 'fr', de: 'de', tr: 'tr' });
export const BING_TARGET_LANG_MAP = Object.freeze({ 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant', en: 'en', ja: 'ja', ko: 'ko', es: 'es', fr: 'fr', de: 'de', tr: 'tr' });

const GTX_PROBE = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=ok';
const BING_PAGE = 'https://www.bing.com/translator';
const BING_TR = 'https://www.bing.com/ttranslatev3';
const UA = Object.freeze({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0' });
const REQ_MS = 9000;

function normLang(lang) {
  const s = String(lang || '').trim().toLowerCase().replace(/_/g, '-');
  if (!s || s === 'auto' || s === 'yue' || s.startsWith('yue-') || s === 'zh-yue' || s.includes('cantonese')) return 'zh-CN';
  if (/^zh-(tw|hk|mo|hant)/.test(s) || s === 'tw' || s === 'hant') return 'zh-TW';
  if (/^zh(?:\b|-)/.test(s)) return 'zh-CN';
  for (const [re, code] of [[/^(ja|jp)(?:\b|-)|^japanese$/, 'ja'], [/^(ko|kr)(?:\b|-)|^korean$/, 'ko'], [/^es(?:\b|-)|^spanish$/, 'es'], [/^fr(?:\b|-)|^french$/, 'fr'], [/^de(?:\b|-)|^german$/, 'de'], [/^tr(?:\b|-)|^turkish$|^türkçe$/, 'tr'], [/^en(?:\b|-)|^english$/, 'en']]) {
    if (re.test(s)) return code;
  }
  return 'zh-CN';
}

export const mapGtxTargetLang = (lang) => GTX_TARGET_LANG_MAP[normLang(lang)] || 'zh-CN';
export const mapBingTargetLang = (lang) => BING_TARGET_LANG_MAP[normLang(lang)] || 'zh-Hans';

export function assertAllowedMtUrl(rawUrl) {
  let u;
  try { u = rawUrl instanceof URL ? rawUrl : new URL(String(rawUrl || '')); }
  catch { throw new Error('Blocked invalid machine translate URL'); }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || !ALLOWED_MT_HOSTS.has(host) || u.username || u.password || (u.port && u.port !== '443')) {
    throw new Error(`Blocked non-allowlisted machine translate URL: ${u.protocol}//${host}`);
  }
  return u.href;
}

function parseBingPageTokens(html, now) {
  const s = String(html || '');
  const ig = s.match(/IG\s*:\s*"([^"]+)"/)?.[1];
  const iid = s.match(/data-iid="([^"]+)"/)?.[1] || 'translator.5023';
  const h = s.match(/params_AbusePreventionHelper\s*=\s*\[(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)\]/);
  if (!ig || !h?.[1] || !h?.[2]) return null;
  const ttlMs = Math.max(30_000, Math.min(Number(h[3]) || 3_600_000, 3_600_000));
  return { ig, iid, key: h[1], token: h[2], count: 0, expiresAt: now + Math.max(5000, ttlMs - 60_000) };
}

function splitLong(piece, max) {
  if (piece.length <= max) return [piece];
  const out = [];
  for (let i = 0; i < piece.length; ) {
    let end = Math.min(piece.length, i + max);
    if (end < piece.length) {
      const cut = i + Math.floor(max * 0.6), nl = piece.lastIndexOf('\n', end), sp = piece.lastIndexOf(' ', end);
      end = nl >= cut ? nl + 1 : sp >= cut ? sp + 1 : end;
    }
    out.push(piece.slice(i, end));
    i = end;
  }
  return out;
}

export function buildBingRequestGroups(text, maxChars = 900, maxItems = 1) {
  const raw = String(text || '');
  if (!raw) return [];
  if (raw.length <= maxChars) return [{ items: [raw], seps: [], trailingSep: '' }];
  const toks = raw.split(/(\n{2,})/), pieces = [], seps = [];
  for (let i = 0; i < toks.length; i += 2) {
    const subs = splitLong(toks[i] ?? '', maxChars);
    for (let j = 0; j < subs.length; j++) {
      pieces.push(subs[j]);
      if (j < subs.length - 1) seps.push('');
      else if (i + 1 < toks.length) seps.push(toks[i + 1] ?? '');
    }
  }
  const groups = [];
  let items = [], gSeps = [], chars = 0;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (items.length && (items.length >= maxItems || chars + p.length > maxChars)) {
      groups.push({ items, seps: gSeps, trailingSep: seps[i - 1] ?? '' });
      items = []; gSeps = []; chars = 0;
    } else if (items.length) gSeps.push(seps[i - 1] ?? '');
    items.push(p); chars += p.length;
  }
  if (items.length) groups.push({ items, seps: gSeps, trailingSep: '' });
  return groups;
}

function maskCode(text) {
  const spans = [];
  let tag = 'OPCODE';
  if (/__\s*OPCODE/i.test(text)) do { tag = `OPCODE_${crypto.randomBytes(4).toString('hex').toUpperCase()}`; } while (text.toUpperCase().includes(tag));
  return { masked: text.replace(/`[^`\n]+`/g, (m) => `__${tag}_${spans.push(m) - 1}__`), spans, tag };
}

function restoreCode(tr, spans, tag) {
  if (!spans.length) return tr.trim();
  return tr.replace(new RegExp(`__\\s*${tag}\\s*_?\\s*(\\d+)\\s*__`, 'gi'), (full, n) => (spans[Number(n)] ?? full)).trim();
}

const httpErr = (routeId, status, detail = '') => Object.assign(
  new Error(detail ? `${routeId} HTTP ${status}: ${detail}` : `${routeId} HTTP ${status}`),
  { status, routeId, reason: status === 429 ? 'rate_limited' : status === 403 ? 'forbidden' : 'http_error' }
);
const isExtAbort = (e, sig) => Boolean(sig?.aborted || (e?.name === 'AbortError' && !/timeout/i.test(String(e.message || ''))));
const cancelBody = async (r) => { try { await r?.body?.cancel?.(); } catch {} };
const numOpt = (v, fb) => (v !== undefined ? Math.max(0, Number(v) || 0) : fb);
const fnOpt = (v, fb) => (typeof v === 'function' ? v : fb);
const offAbort = (sig, fn) => { if (sig) { try { sig.removeEventListener('abort', fn); } catch {} } };

export class MachineTranslateClient {
  constructor(o = {}) {
    this._getProxyMode = fnOpt(o.getProxyMode, () => 'auto'); this._resolveProxy = fnOpt(o.resolveProxy, async () => null);
    this._sendRequest = fnOpt(o.sendRequest, null); this._readText = fnOpt(o.readResponseTextBounded, async (r) => r.text());
    this._composeAbort = fnOpt(o.composeAbortSignal, null); this._now = fnOpt(o.now, () => Date.now());
    this._sleepImpl = fnOpt(o.sleep, null); this._redact = fnOpt(o.redactText, (s) => String(s || ''));
    this.maxConcurrency = Math.max(1, Number(o.maxConcurrency) || 2); this.minIntervalMs = numOpt(o.minIntervalMs, 120);
    this.cooldownRateLimitMs = numOpt(o.cooldownRateLimitMs, 60_000); this.cooldownForbiddenMs = numOpt(o.cooldownForbiddenMs, 60_000); this.cooldownErrorMs = numOpt(o.cooldownErrorMs, 20_000);
    this._routeCooldowns = new Map(); this._bingTokenCache = null; this._bingTokenInflight = new Map();
    this._activeSlots = 0; this._waiters = []; this._lastLaunchAt = 0; this._pendingTimers = new Set(); this._disposed = false;
  }

  clearCooldowns() { this._routeCooldowns.clear(); }

  getRouteCooldowns() {
    const now = this._now(), out = {};
    for (const [id, rec] of this._routeCooldowns.entries()) {
      if (rec.until > now) out[id] = { ...rec, remainingMs: rec.until - now };
      else this._routeCooldowns.delete(id);
    }
    return out;
  }

  isRouteCoolingDown(id) {
    const rec = this._routeCooldowns.get(id);
    if (!rec) return false;
    if (this._now() >= rec.until) { this._routeCooldowns.delete(id); return false; }
    return true;
  }

  _recordRouteFailure(id, err) {
    const st = Number(err?.status) || 0, isR = st === 429 || err?.reason === 'rate_limited', isF = st === 403 || err?.reason === 'forbidden';
    const ttl = isR ? this.cooldownRateLimitMs : isF ? this.cooldownForbiddenMs : this.cooldownErrorMs;
    if (ttl <= 0) return;
    this._routeCooldowns.set(id, {
      until: this._now() + ttl, status: st, reason: isR ? 'rate_limited' : isF ? 'forbidden' : err?.reason || 'error',
      error: this._redact(err?.message || String(err || '')).slice(0, 160),
    });
  }

  dispose() {
    this._disposed = true;
    const err = new Error('Machine translate client disposed');
    for (const e of Array.from(this._pendingTimers)) e.cancel(err);
    this._pendingTimers.clear();
    while (this._waiters.length) this._waiters.shift().cancel(err);
    this._bingTokenInflight.clear();
  }

  async _sleep(ms, sig) {
    if (ms <= 0) return;
    if (this._disposed || sig?.aborted) throw new Error('Translation aborted');
    if (this._sleepImpl) { await this._sleepImpl(ms, sig); if (this._disposed || sig?.aborted) throw new Error('Translation aborted'); return; }
    await new Promise((res, rej) => {
      let done = false;
      const clean = () => { offAbort(sig, onA); this._pendingTimers.delete(ent); };
      const ent = { cancel: (e) => { if (!done) { done = true; clearTimeout(t); clean(); rej(e || new Error('Translation aborted')); } } };
      const onA = () => ent.cancel(new Error('Translation aborted'));
      const t = setTimeout(() => { if (!done) { done = true; clean(); res(); } }, ms);
      t.unref?.(); this._pendingTimers.add(ent); sig?.addEventListener('abort', onA, { once: true });
    });
  }

  async _acquire(sig) {
    if (this._disposed || sig?.aborted) throw new Error('Translation aborted');
    if (this._activeSlots < this.maxConcurrency) { this._activeSlots += 1; return; }
    await new Promise((res, rej) => {
      const w = {
        grant: () => { offAbort(sig, onA); res(); },
        cancel: (e) => { const i = this._waiters.indexOf(w); if (i >= 0) this._waiters.splice(i, 1); offAbort(sig, onA); rej(e || new Error('Translation aborted')); },
      };
      const onA = () => w.cancel(new Error('Translation aborted'));
      this._waiters.push(w); sig?.addEventListener('abort', onA, { once: true });
    });
  }

  _release() {
    if (this._waiters.length) { this._waiters.shift().grant(); return; }
    if (this._activeSlots > 0) this._activeSlots -= 1;
  }

  async _throttle(sig, fn) {
    await this._acquire(sig);
    try {
      if (this._disposed || sig?.aborted) throw new Error('Translation aborted');
      if (this.minIntervalMs > 0) {
        const now = this._now(), gap = now - this._lastLaunchAt;
        const wait = this._lastLaunchAt > 0 && gap < this.minIntervalMs ? this.minIntervalMs - gap : 0;
        this._lastLaunchAt = wait > 0 ? this._lastLaunchAt + this.minIntervalMs : now;
        if (wait > 0) await this._sleep(wait, sig);
      }
      return await fn();
    } finally { this._release(); }
  }

  async planRoutes(override = null) {
    const mode = this._getProxyMode(override) || 'auto';
    const directs = [{ id: 'google:direct', engine: 'google', channel: 'direct', proxy: null }, { id: 'bing:direct', engine: 'bing', channel: 'direct', proxy: null }];
    if (mode === 'direct') return directs;
    const [gP, bP] = await Promise.all([this._resolveProxy(GTX_PROBE, override), this._resolveProxy(BING_PAGE, override)]);
    const proxied = [];
    if (gP) proxied.push({ id: 'google:proxy', engine: 'google', channel: 'proxy', proxy: gP });
    if (bP) proxied.push({ id: 'bing:proxy', engine: 'bing', channel: 'proxy', proxy: bP });
    return mode === 'custom' ? proxied : [...proxied, ...directs];
  }

  _makeAbort(ms, ext) {
    if (this._composeAbort) return this._composeAbort(ms, ext);
    const ctl = new AbortController();
    let t = setTimeout(() => { t = null; ctl.abort(Object.assign(new Error('Request timeout'), { name: 'TimeoutError' })); }, ms);
    const onExt = () => ctl.abort(ext?.reason || new Error('Translation aborted'));
    if (ext) { if (ext.aborted) onExt(); else ext.addEventListener('abort', onExt, { once: true }); }
    return { signal: ctl.signal, cleanup() { if (t !== null) { clearTimeout(t); t = null; } offAbort(ext, onExt); } };
  }

  async _fetchMt(url, init, route, ms, sig) {
    const safeUrl = assertAllowedMtUrl(url);
    if (!this._sendRequest) throw new Error('Machine translate transport unavailable');
    const ab = this._makeAbort(ms, sig);
    try {
      return await this._sendRequest({ url: safeUrl, init: { ...init, redirect: 'error', signal: ab.signal }, channel: route.channel, proxy: route.proxy, engine: route.engine, routeId: route.id });
    } finally { ab.cleanup(); }
  }

  async _getBingToken(route, sig, ms = REQ_MS, force = false) {
    if (!force && this._bingTokenCache && this._now() < this._bingTokenCache.expiresAt) return this._bingTokenCache;
    const key = route.channel;
    if (!force && this._bingTokenInflight.has(key)) return this._bingTokenInflight.get(key);
    const task = (async () => {
      const res = await this._fetchMt(BING_PAGE, { method: 'GET', headers: UA }, route, ms, sig);
      if (!res.ok) { await cancelBody(res); throw httpErr(route.id, res.status, 'Bing auth failed'); }
      const html = await this._readText(res, 4 * 1024 * 1024);
      const parsed = parseBingPageTokens(html, this._now());
      if (!parsed) throw new Error(`${route.id} invalid Bing auth token`);
      this._bingTokenCache = parsed;
      return parsed;
    })();
    this._bingTokenInflight.set(key, task);
    try { return await task; } finally { if (this._bingTokenInflight.get(key) === task) this._bingTokenInflight.delete(key); }
  }

  async _postBingTranslate(text, toLang, route, ms, sig) {
    for (let retried = false; ; retried = true) {
      const tok = await this._getBingToken(route, sig, ms, retried);
      tok.count = (tok.count || 0) + 1;
      const url = `${BING_TR}?isVertical=1&IG=${encodeURIComponent(tok.ig)}&IID=${encodeURIComponent(`${tok.iid}.${tok.count}`)}`;
      const body = new URLSearchParams({ fromLang: 'auto-detect', text: String(text || ''), to: toLang, token: tok.token, key: tok.key }).toString();
      const res = await this._fetchMt(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', Referer: BING_PAGE, ...UA }, body }, route, ms, sig);
      if ((res.status === 401 || res.status === 403) && !retried) { await cancelBody(res); this._bingTokenCache = null; continue; }
      if (!res.ok) { await cancelBody(res); throw httpErr(route.id, res.status); }
      const arr = JSON.parse(await this._readText(res, 4 * 1024 * 1024));
      if (!Array.isArray(arr)) {
        const sc = Number(arr?.statusCode) || 0;
        if ((sc === 205 || sc === 401 || sc === 403) && !retried) { this._bingTokenCache = null; continue; }
        if (arr?.showCaptcha || sc === 429) throw httpErr(route.id, 429, 'Bing rate-limited');
        throw httpErr(route.id, sc || 502, String(arr?.errorMessage || 'unexpected Bing response shape'));
      }
      return arr;
    }
  }

  async _viaGoogle(masked, tl, route, sig) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(mapGtxTargetLang(tl))}&dt=t&q=${encodeURIComponent(masked)}`;
    const res = await this._fetchMt(url, { method: 'GET', headers: UA }, route, REQ_MS, sig);
    if (!res.ok) { await cancelBody(res); throw httpErr(route.id, res.status); }
    const json = JSON.parse(await this._readText(res, 4 * 1024 * 1024));
    return (Array.isArray(json?.[0]) ? json[0] : []).map((s) => (Array.isArray(s) && s[0] ? String(s[0]) : '')).join('');
  }

  async _viaBing(masked, tl, route, sig) {
    const to = mapBingTargetLang(tl);
    let out = '';
    for (const g of buildBingRequestGroups(masked, 900, 1)) {
      for (let i = 0; i < g.items.length; i++) {
        const arr = await this._postBingTranslate(g.items[i], to, route, REQ_MS, sig);
        out += typeof arr?.[0]?.translations?.[0]?.text === 'string' ? arr[0].translations[0].text : g.items[i];
        if (i < g.seps.length) out += g.seps[i];
      }
      out += g.trailingSep || '';
    }
    return out;
  }

  _aggErr(rows) {
    const sum = rows.map((r) => `${r.routeId}:${r.status ? `HTTP ${r.status}` : r.reason || 'failed'}`).join(', ');
    if (rows.some((r) => r.status === 429 || r.reason === 'rate_limited')) {
      return Object.assign(new Error(`Machine translate rate-limited (HTTP 429): ${sum}`), { code: 'MT_RATE_LIMITED', status: 429, routeErrors: rows });
    }
    const last = rows[rows.length - 1];
    return Object.assign(new Error(`Machine translate failed: ${last?.error || sum || 'no available route'}`), { status: last?.status || 0, routeErrors: rows });
  }

  async translateBatch(text, targetLang = 'zh-CN', sig = null) {
    if (sig?.aborted) throw new Error('Translation aborted');
    const { masked, spans, tag } = maskCode(String(text || ''));
    const routes = await this.planRoutes(null);
    if (!routes.length) throw new Error('Machine translate proxy not configured');
    const active = [], cooled = [];
    for (const r of routes) {
      if (this.isRouteCoolingDown(r.id)) {
        const rec = this._routeCooldowns.get(r.id);
        cooled.push({ routeId: r.id, status: rec?.status || 0, reason: rec?.reason || 'cooling_down', error: rec?.error || 'cooling down', skippedByCooldown: true });
      } else active.push(r);
    }
    if (!active.length) throw this._aggErr(cooled);
    return this._throttle(sig, async () => {
      const fails = [...cooled];
      for (const r of active) {
        if (sig?.aborted) throw new Error('Translation aborted');
        try {
          const tr = r.engine === 'bing' ? await this._viaBing(masked, targetLang, r, sig) : await this._viaGoogle(masked, targetLang, r, sig);
          this._routeCooldowns.delete(r.id);
          return restoreCode(tr, spans, tag);
        } catch (err) {
          if (isExtAbort(err, sig)) throw new Error('Translation aborted');
          this._recordRouteFailure(r.id, err);
          fails.push({ routeId: r.id, status: Number(err?.status) || 0, reason: err?.reason || (err?.name === 'TimeoutError' ? 'timeout' : 'network_error'), error: this._redact(err?.message || String(err || '')) });
        }
      }
      throw this._aggErr(fails);
    });
  }

  async diagnose({ proxyOverride = null, timeoutMs = 5000, safeRedact = null, classifyErrReason = null } = {}) {
    const redact = fnOpt(safeRedact, this._redact), classify = fnOpt(classifyErrReason, (e) => {
      const m = String(e?.message || e || '');
      return e?.name === 'TimeoutError' || e?.name === 'AbortError' || /timed?\s*out|timeout|aborted/i.test(m)
        ? 'timeout' : /proxy|socks|tunnel|407/i.test(m) ? 'proxy_error' : 'network_error';
    });
    const routes = await this.planRoutes(proxyOverride);
    if (!routes.length) return { ok: false, target: 'gtx', latencyMs: 0, reason: 'proxy_error', error: 'Custom proxy mode requires a configured proxy URL', attemptedRoutes: [] };
    const t0 = this._now(), deadline = t0 + Math.max(100, Number(timeoutMs) || 5000), attempted = [];
    for (const r of routes) {
      const rem = deadline - this._now();
      if (rem <= 30) { attempted.push({ route: r.id, ok: false, reason: 'timeout' }); break; }
      const s0 = this._now();
      try {
        if (r.engine === 'bing') {
          const arr = await this._postBingTranslate('ok', 'zh-Hans', r, rem, null);
          if (typeof arr?.[0]?.translations?.[0]?.text !== 'string') throw new Error(`${r.id} unexpected Bing probe response`);
          const stepMs = this._now() - s0;
          this._routeCooldowns.delete(r.id);
          attempted.push({ route: r.id, ok: true, status: 200, latencyMs: stepMs });
          return { ok: true, target: 'bing', route: r.id, engine: r.engine, channel: r.channel, status: 200, latencyMs: this._now() - t0, reason: 'ok', attemptedRoutes: attempted };
        }
        const res = await this._fetchMt(GTX_PROBE, { method: 'GET', headers: UA }, r, rem, null);
        const stepMs = this._now() - s0;
        if (res.ok) {
          await cancelBody(res); this._routeCooldowns.delete(r.id);
          attempted.push({ route: r.id, ok: true, status: res.status, latencyMs: stepMs });
          return { ok: true, target: 'gtx', route: r.id, engine: r.engine, channel: r.channel, status: res.status, latencyMs: this._now() - t0, reason: 'ok', attemptedRoutes: attempted };
        }
        const snip = await this._readText(res, 16384).catch(() => '');
        this._recordRouteFailure(r.id, httpErr(r.id, res.status, redact(snip.slice(0, 120))));
        attempted.push({ route: r.id, ok: false, status: res.status, reason: res.status === 429 ? 'rate_limited' : 'http_error', latencyMs: stepMs });
      } catch (err) {
        const st = Number(err?.status) || 0, reason = st === 429 ? 'rate_limited' : st ? 'http_error' : classify(err);
        this._recordRouteFailure(r.id, err);
        attempted.push({ route: r.id, ok: false, ...(st ? { status: st } : {}), reason, error: redact(err?.message || String(err || '')).slice(0, 140), latencyMs: this._now() - s0 });
      }
    }
    const totalMs = this._now() - t0, sum = attempted.map((a) => `${a.route}:${a.status ? `HTTP ${a.status}` : a.reason}`).join(', ');
    if (attempted.some((a) => a.status === 429 || a.reason === 'rate_limited')) {
      return { ok: false, target: 'machine', status: 429, latencyMs: totalMs, reason: 'rate_limited', error: redact(`Machine translate rate-limited (HTTP 429): ${sum}`), attemptedRoutes: attempted };
    }
    const last = attempted[attempted.length - 1] || {};
    return { ok: false, target: 'gtx', ...(last.status ? { status: last.status } : {}), latencyMs: totalMs, reason: last.reason || 'network_error', error: redact(last.error || `Machine translate probe failed: ${sum}`), attemptedRoutes: attempted };
  }
}
