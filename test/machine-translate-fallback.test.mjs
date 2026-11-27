import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

import {
  ALLOWED_MT_HOSTS,
  BING_TARGET_LANG_MAP,
  GTX_TARGET_LANG_MAP,
  assertAllowedMtUrl,
  buildBingRequestGroups,
  mapBingTargetLang,
  mapGtxTargetLang,
} from '../vendor/thought-translator/machine-translate-client.mjs';
import { ThoughtTranslatorService } from '../vendor/thought-translator/translator-service.mjs';

const require = createRequire(import.meta.url);
const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const { copyUpdatedRuntimeFromRepo } = require(path.join(ROOT_DIR, 'src', 'platform', 'repo-sync.cjs'));

const CANONICAL_9_LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'tr'];
const NON_CJK_LOCALES = ['en', 'ko', 'es', 'fr', 'de', 'tr'];
const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;

function mkTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeMockBingPageHtml(ttlMs = 600_000, suffix = 'v1') {
  return `<!doctype html><html><script>IG:"IG_${suffix}";</script><div data-iid="translator.5023"></div><script>var params_AbusePreventionHelper = [1795769054797,"MOCK_TOKEN_${suffix}",${ttlMs}];</script></html>`;
}

function createMiniClientDomEnv(extraGlobals = {}) {
  const listeners = new Map();
  class MockNode {
    constructor(tag = '') {
      this.nodeType = tag ? 1 : 3;
      this.tagName = tag ? String(tag).toUpperCase() : '';
      this.attrs = new Map();
      this.style = {};
      this.className = '';
      this.hidden = false;
      this.disabled = false;
      this.children = [];
      this.parentElement = null;
      this._text = '';
      this._listeners = new Map();
      this.ownerDocument = null;
    }
    get childNodes() { return this.children; }
    get firstChild() { return this.children[0] || null; }
    get nextElementSibling() {
      if (!this.parentElement) return null;
      const idx = this.parentElement.children.indexOf(this);
      if (idx < 0) return null;
      for (let i = idx + 1; i < this.parentElement.children.length; i++) {
        if (this.parentElement.children[i].nodeType === 1) return this.parentElement.children[i];
      }
      return null;
    }
    get previousElementSibling() {
      if (!this.parentElement) return null;
      const idx = this.parentElement.children.indexOf(this);
      for (let i = idx - 1; i >= 0; i--) {
        if (this.parentElement.children[i].nodeType === 1) return this.parentElement.children[i];
      }
      return null;
    }
    closest(sel) {
      let cur = this;
      while (cur) {
        if (cur.nodeType === 1 && cur.matches(sel)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    get isConnected() {
      let cur = this;
      while (cur) {
        if (cur === doc.documentElement || cur === doc.body) return true;
        cur = cur.parentElement;
      }
      return false;
    }
    get nodeValue() { return this.nodeType === 3 ? this._text : null; }
    set nodeValue(v) { if (this.nodeType === 3) this._text = String(v ?? ''); }
    get textContent() {
      if (this.nodeType === 3) return this._text;
      if (this.children.length === 0) return this._text;
      return this.children.map((c) => c.textContent).join('');
    }
    set textContent(v) {
      if (this.nodeType === 3) { this._text = String(v ?? ''); return; }
      for (const c of this.children) c.parentElement = null;
      this.children = [];
      this._text = '';
      const str = String(v ?? '');
      if (str) {
        const tn = doc.createTextNode(str);
        this.appendChild(tn);
      }
    }
    get classList() {
      const self = this;
      return {
        contains: (c) => String(self.className || '').split(/\s+/).includes(c),
        add: (c) => {
          const set = new Set(String(self.className || '').split(/\s+/).filter(Boolean));
          set.add(c);
          self.className = [...set].join(' ');
        },
        remove: (c) => {
          self.className = String(self.className || '').split(/\s+/).filter((x) => x && x !== c).join(' ');
        },
      };
    }
    setAttribute(k, v) {
      this.attrs.set(k, String(v));
      if (k === 'class') this.className = String(v);
    }
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
    hasAttribute(k) { return this.attrs.has(k); }
    removeAttribute(k) { this.attrs.delete(k); }
    appendChild(child) {
      if (child.parentElement) child.remove();
      child.parentElement = this;
      child.ownerDocument = this.ownerDocument || doc;
      this.children.push(child);
      return child;
    }
    insertBefore(child, ref) {
      if (child.parentElement) child.remove();
      child.parentElement = this;
      child.ownerDocument = this.ownerDocument || doc;
      const idx = ref ? this.children.indexOf(ref) : -1;
      if (idx >= 0) this.children.splice(idx, 0, child);
      else this.children.push(child);
      return child;
    }
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
      if (child) child.parentElement = null;
      return child;
    }
    remove() {
      if (this.parentElement) this.parentElement.removeChild(this);
    }
    replaceChildren(...nodes) {
      for (const c of this.children) c.parentElement = null;
      this.children = [];
      this._text = '';
      for (const n of nodes) this.appendChild(n);
    }
    addEventListener(ev, fn) {
      if (!this._listeners.has(ev)) this._listeners.set(ev, new Set());
      this._listeners.get(ev).add(fn);
    }
    removeEventListener(ev, fn) { this._listeners.get(ev)?.delete(fn); }
    getBoundingClientRect() { return { top: 20, bottom: 120, left: 0, right: 400, width: 400, height: 100 }; }
    matches(sel) {
      return sel.split(',').some((raw) => {
        const s = raw.trim();
        if (!s) return false;
        const tagM = s.match(/^([a-zA-Z0-9_-]+)/);
        if (tagM && this.tagName !== tagM[1].toUpperCase()) return false;
        for (const cm of s.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
          if (!this.classList.contains(cm[1])) return false;
        }
        for (const am of s.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)) {
          const val = this.getAttribute(am[1]);
          if (val === null) return false;
          if (am[2] !== undefined && val !== am[2]) return false;
        }
        return true;
      });
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        for (const c of n.children) {
          if (c.nodeType === 1 && c.matches(sel)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }

  const doc = {
    documentElement: null,
    body: null,
    visibilityState: 'visible',
    hidden: false,
    createElement(tag) { const el = new MockNode(tag); el.ownerDocument = doc; return el; },
    createTextNode(txt) { const el = new MockNode(''); el._text = String(txt ?? ''); el.ownerDocument = doc; return el; },
    createDocumentFragment() { const el = new MockNode('FRAGMENT'); el.ownerDocument = doc; return el; },
    querySelectorAll(sel) { return doc.body.querySelectorAll(sel); },
    querySelector(sel) { return doc.body.querySelector(sel); },
    addEventListener(ev, fn) { listeners.set(ev, fn); },
    removeEventListener(ev) { listeners.delete(ev); },
  };
  doc.documentElement = new MockNode('HTML');
  doc.documentElement.ownerDocument = doc;
  doc.body = new MockNode('BODY');
  doc.body.ownerDocument = doc;
  doc.documentElement.appendChild(doc.body);

  const storage = new Map();
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Map,
    Set,
    WeakMap,
    Date,
    Math,
    JSON,
    RegExp,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
    document: doc,
    innerHeight: 900,
    innerWidth: 1440,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    ...extraGlobals,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return { doc, sandbox };
}

test('1) HTTPS allowlist (anti-SSRF), exact 9-locale Bing/GTX maps & safe Bing batch chunking', () => {
  assert.equal(ALLOWED_MT_HOSTS.size, 2);
  assert.ok(assertAllowedMtUrl('https://translate.googleapis.com/translate_a/single?client=gtx&q=hi'));
  assert.ok(assertAllowedMtUrl('https://www.bing.com/translator'));
  assert.ok(assertAllowedMtUrl('https://www.bing.com/ttranslatev3?isVertical=1&IG=ABC&IID=translator.5023.1'));
  assert.throws(() => assertAllowedMtUrl('https://edge.microsoft.com/translate/auth'), /Blocked/i);

  for (const bad of [
    'http://translate.googleapis.com/translate_a/single?q=hi',
    'https://evil.example.com/translate',
    'https://127.0.0.1/translate',
    'https://169.254.169.254/latest/meta-data',
    'https://user:pass@translate.googleapis.com/translate_a/single',
    'https://translate.googleapis.com:8443/translate_a/single',
    'not-a-url',
  ]) {
    assert.throws(() => assertAllowedMtUrl(bad), /Blocked/i, `Must reject non-allowlisted URL: ${bad}`);
  }

  assert.deepEqual(Object.keys(BING_TARGET_LANG_MAP), CANONICAL_9_LOCALES);
  assert.deepEqual(Object.keys(GTX_TARGET_LANG_MAP), CANONICAL_9_LOCALES);
  const expectedBing = {
    'zh-CN': 'zh-Hans',
    'zh-TW': 'zh-Hant',
    en: 'en',
    ja: 'ja',
    ko: 'ko',
    es: 'es',
    fr: 'fr',
    de: 'de',
    tr: 'tr',
  };
  for (const [loc, code] of Object.entries(expectedBing)) {
    assert.equal(mapBingTargetLang(loc), code);
    assert.equal(mapGtxTargetLang(loc), loc);
  }
  assert.equal(mapBingTargetLang('zh-HK'), 'zh-Hant');
  assert.equal(mapBingTargetLang('yue'), 'zh-Hans');
  assert.equal(mapBingTargetLang('tr-TR'), 'tr');

  // Chunking preserves separators and respects both maxChars and maxItems
  const longText = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}: ${'word '.repeat(35).trim()}`).join('\n\n');
  const groups = buildBingRequestGroups(longText, 1200, 10);
  assert.ok(groups.length >= 4, 'Oversized payload must split into multiple safe Bing groups');
  let rebuilt = '';
  for (const g of groups) {
    assert.ok(g.items.length <= 10, 'Each Bing batch must stay <= maxItems');
    const chars = g.items.reduce((acc, s) => acc + s.length, 0);
    assert.ok(chars <= 1200, `Each Bing batch must stay <= maxChars (got ${chars})`);
    for (let i = 0; i < g.items.length; i++) {
      rebuilt += g.items[i];
      if (i < g.seps.length) rebuilt += g.seps[i];
    }
    rebuilt += g.trailingSep || '';
  }
  assert.equal(rebuilt, longText, 'Reassembled Bing chunks must match source text verbatim');
});

test('2) google:proxy 429 cools down only google:proxy, seamlessly falls back to bing:proxy, caches Bing token, handles 205 refresh & chunks >900 chars', async () => {
  const tmpDir = mkTempDir('prism-mt-fb-bing-');
  let now = 1_700_000_000_000;
  const routeCalls = [];
  let bingAuthCalls = 0;
  let tokenTtlMs = 600_000; // 10 min
  let forceStale205Once = false;

  try {
    // Verify production default throttle limits (no custom fetchImpl): concurrency <= 2, minIntervalMs === 120
    const defaultSvc = new ThoughtTranslatorService({ configDir: tmpDir, proxyEnv: {} });
    assert.equal(defaultSvc._mtClient.maxConcurrency, 2);
    assert.equal(defaultSvc._mtClient.minIntervalMs, 120);
    defaultSvc.dispose();

    const svc = new ThoughtTranslatorService({
      configDir: tmpDir,
      proxyEnv: {},
      resolveSystemProxy: () => 'http://127.0.0.1:7890',
      machineClock: () => now,
      machineMinIntervalMs: 0,
      machineCooldownRateLimitMs: 60_000,
      machineTransport: async ({ url, init, channel, routeId }) => {
        routeCalls.push({ routeId, channel, url, method: init?.method });
        if (routeId === 'google:proxy') {
          return new Response('Too Many Requests', { status: 429 });
        }
        if (url === 'https://www.bing.com/translator') {
          assert.equal(init.method, 'GET');
          bingAuthCalls += 1;
          return new Response(makeMockBingPageHtml(tokenTtlMs, `r${bingAuthCalls}`), { status: 200 });
        }
        if (url.startsWith('https://www.bing.com/ttranslatev3')) {
          assert.equal(channel, 'proxy');
          assert.equal(init.method, 'POST');
          assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
          if (forceStale205Once) {
            forceStale205Once = false;
            return new Response(JSON.stringify({ statusCode: 205, errorMessage: 'token expired' }), { status: 200 });
          }
          const form = new URLSearchParams(String(init.body || ''));
          assert.ok(form.get('token') && form.get('key'), 'Bing ttranslatev3 must pass AbusePreventionHelper key & token');
          const toParam = form.get('to');
          const text = form.get('text') || '';
          assert.ok(text.length <= 900, `Each Bing ttranslatev3 chunk must stay <= 900 chars (got ${text.length})`);
          return new Response(JSON.stringify([{ translations: [{ text: `[BING:${toParam}] ${text}` }] }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Unexpected route', { status: 500 });
      },
    });

    // Request 1: google:proxy returns 429 -> seamless fallback to bing:proxy
    const out1 = await svc.translateMachine('Check `translateBatch` fallback pipeline carefully.', null, 'zh-CN');
    assert.equal(out1, '[BING:zh-Hans] Check `translateBatch` fallback pipeline carefully.');
    assert.equal(bingAuthCalls, 1, 'First Bing request must fetch page token once');

    const cooldowns = svc._mtClient.getRouteCooldowns();
    assert.ok(cooldowns['google:proxy'], 'google:proxy must enter cooldown after 429');
    assert.equal(cooldowns['bing:proxy'], undefined, 'bing:proxy must not be cooled');
    assert.equal(cooldowns['google:direct'], undefined, 'google:direct must not be cooled');
    assert.equal(cooldowns['bing:direct'], undefined, 'bing:direct must not be cooled');

    // Request 2 within 60s cooldown: must skip google:proxy completely AND reuse cached Bing token
    now += 15_000;
    const prevGoogleProxyCalls = routeCalls.filter((c) => c.routeId === 'google:proxy').length;
    const out2 = await svc.translateMachine('Verify Traditional Chinese mapping via Bing fallback.', null, 'zh-TW');
    assert.equal(out2, '[BING:zh-Hant] Verify Traditional Chinese mapping via Bing fallback.');
    assert.equal(
      routeCalls.filter((c) => c.routeId === 'google:proxy').length,
      prevGoogleProxyCalls,
      'Subsequent request during cooldown must skip google:proxy'
    );
    assert.equal(bingAuthCalls, 1, 'Cached Bing token must be reused before TTL - 60s');

    // Advance past token refresh margin (TTL - 60s) & past google:proxy cooldown (60s)
    now += 550_000;
    const out3 = await svc.translateMachine('Confirm cooldown expiry and Bing token refresh.', null, 'ja');
    assert.equal(out3, '[BING:ja] Confirm cooldown expiry and Bing token refresh.');
    assert.equal(
      routeCalls.filter((c) => c.routeId === 'google:proxy').length,
      prevGoogleProxyCalls + 1,
      'After 60s cooldown expires, google:proxy should be retried'
    );
    assert.equal(bingAuthCalls, 2, 'Bing token must refresh within 60s before expiry');

    // Status 205 from ttranslatev3 triggers token refresh & retry, and >900 char payload is safely chunked
    forceStale205Once = true;
    const longSample = `${'Sentence alpha. '.repeat(45)}\n\n${'Sentence beta. '.repeat(45)}`;
    const out4 = await svc.translateMachine(longSample, null, 'ko');
    assert.ok(out4.includes('[BING:ko] Sentence alpha.') && out4.includes('[BING:ko] Sentence beta.'));
    assert.equal(bingAuthCalls, 3, 'statusCode 205 must invalidate cache and fetch fresh Bing token');

    svc.dispose();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('3) proxyMode auto fails over to direct when proxy exits 429; custom never bypasses proxy; direct skips proxy', async () => {
  const tmpDir = mkTempDir('prism-mt-fb-modes-');
  const seen = [];

  try {
    // A) proxyMode: 'auto' -> google:proxy (429) -> bing:proxy (429) -> google:direct (200)
    const svcAuto = new ThoughtTranslatorService({
      configDir: tmpDir,
      proxyEnv: {},
      resolveSystemProxy: () => 'http://127.0.0.1:7890',
      machineMinIntervalMs: 0,
      machineTransport: async ({ url, channel, routeId }) => {
        seen.push({ case: 'auto', routeId, channel });
        if (channel === 'proxy') return new Response('Rate limited', { status: 429 });
        if (routeId === 'google:direct') {
          const q = new URL(url).searchParams.get('q') || '';
          return new Response(JSON.stringify([[[`[DIRECT-GTX] ${q}`, q]]]), { status: 200 });
        }
        return new Response('err', { status: 500 });
      },
    });
    const autoOut = await svcAuto.translateMachine('Proxy exit is rate limited so auto switches direct.', null, 'zh-CN');
    assert.equal(autoOut, '[DIRECT-GTX] Proxy exit is rate limited so auto switches direct.');
    assert.deepEqual(
      seen.filter((s) => s.case === 'auto').map((s) => s.routeId),
      ['google:proxy', 'bing:proxy', 'google:direct']
    );
    svcAuto.dispose();

    // B) proxyMode: 'custom' -> NEVER falls back to direct even if both proxy engines 429
    const customCalls = [];
    let allowBingProxy = true;
    const svcCustom = new ThoughtTranslatorService({
      configDir: mkTempDir('prism-mt-fb-custom-'),
      proxyEnv: {},
      machineMinIntervalMs: 0,
      machineTransport: async ({ url, init, channel, routeId }) => {
        customCalls.push({ routeId, channel, url });
        if (routeId === 'google:proxy') return new Response('Rate limited', { status: 429 });
        if (routeId === 'bing:proxy' && allowBingProxy) {
          if (url === 'https://www.bing.com/translator') return new Response(makeMockBingPageHtml(), { status: 200 });
          const form = new URLSearchParams(String(init.body || ''));
          return new Response(JSON.stringify([{ translations: [{ text: `[CUSTOM-BING] ${form.get('text') || ''}` }] }]), { status: 200 });
        }
        return new Response('Rate limited', { status: 429 });
      },
    });
    svcCustom.saveConfig({ proxyMode: 'custom', customProxyUrl: 'http://127.0.0.1:7890' });

    const customBingOk = await svcCustom.translateMachine('Custom proxy falls back from Google to Bing over proxy.', null, 'zh-CN');
    assert.equal(customBingOk, '[CUSTOM-BING] Custom proxy falls back from Google to Bing over proxy.');
    assert.equal(customCalls.some((c) => c.channel === 'direct'), false, 'custom proxyMode must never use direct');

    // Now fail bing:proxy too -> must reject with MT_RATE_LIMITED and still 0 direct calls
    allowBingProxy = false;
    svcCustom._mtClient.clearCooldowns();
    await assert.rejects(
      () => svcCustom.translateMachine('Both proxy engines rate limited under custom proxy mode.', null, 'zh-CN'),
      (err) => err && err.code === 'MT_RATE_LIMITED' && /Machine translate rate-limited \(HTTP 429\)/i.test(err.message)
    );
    assert.equal(customCalls.some((c) => c.channel === 'direct'), false, 'custom proxyMode must NEVER bypass proxy to direct');

    // C) proxyMode: 'direct' -> skips proxy even if system proxy exists
    const directCalls = [];
    const svcDirect = new ThoughtTranslatorService({
      configDir: mkTempDir('prism-mt-fb-direct-'),
      proxyEnv: {},
      resolveSystemProxy: () => 'http://127.0.0.1:7890',
      machineMinIntervalMs: 0,
      machineTransport: async ({ url, channel, routeId }) => {
        directCalls.push({ routeId, channel });
        const q = new URL(url).searchParams.get('q') || '';
        return new Response(JSON.stringify([[[`[DIRECT] ${q}`, q]]]), { status: 200 });
      },
    });
    svcDirect.saveConfig({ proxyMode: 'direct' });
    const directOut = await svcDirect.translateMachine('Direct mode ignores system proxy completely.', null, 'zh-CN');
    assert.equal(directOut, '[DIRECT] Direct mode ignores system proxy completely.');
    assert.deepEqual(directCalls, [{ routeId: 'google:direct', channel: 'direct' }]);

    svcCustom.dispose();
    svcDirect.dispose();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('4) Throttle queue caps concurrency and spacing; machine cooldowns have 0 impact on AI translation', async () => {
  const tmpDir = mkTempDir('prism-mt-throttle-');
  let activeMt = 0;
  let peakMt = 0;
  const startTimes = [];
  let aiHits = 0;

  try {
    // Verify production default throttle limits (no custom fetchImpl): concurrency <= 2, minIntervalMs === 120
    const defaultSvc = new ThoughtTranslatorService({ configDir: tmpDir, proxyEnv: {} });
    assert.equal(defaultSvc._mtClient.maxConcurrency, 2);
    assert.equal(defaultSvc._mtClient.minIntervalMs, 120);
    defaultSvc.dispose();

    const svc = new ThoughtTranslatorService({
      configDir: tmpDir,
      proxyEnv: {},
      machineMaxConcurrency: 2,
      machineMinIntervalMs: 30,
      machineTransport: async ({ url }) => {
        activeMt += 1;
        peakMt = Math.max(peakMt, activeMt);
        startTimes.push(Date.now());
        await new Promise((r) => setTimeout(r, 45));
        activeMt -= 1;
        const q = new URL(url).searchParams.get('q') || '';
        return new Response(JSON.stringify([[[`译:${q}`, q]]]), { status: 200 });
      },
      fetchImpl: async (url) => {
        if (String(url).includes('/chat/completions')) {
          aiHits += 1;
          return new Response(JSON.stringify({ choices: [{ message: { content: 'AI 润色结果 unaffected' } }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Not Found', { status: 404 });
      },
    });
    svc.saveConfig({
      proxyMode: 'direct',
      activeProfileId: 'local-ai',
      profiles: [{ id: 'local-ai', name: 'Local', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '', model: 'qwen3:8b' }],
    });

    const inputs = [
      'Batch sentence alpha verifying throttle concurrency.',
      'Batch sentence beta verifying throttle concurrency.',
      'Batch sentence gamma verifying throttle concurrency.',
      'Batch sentence delta verifying throttle concurrency.',
      'Batch sentence epsilon verifying throttle concurrency.',
    ];
    const outs = await Promise.all(inputs.map((s) => svc.translateMachine(s, null, 'zh-CN')));
    assert.equal(outs.length, 5);
    assert.ok(peakMt <= 2, `Machine translate concurrency must stay <= 2 (observed peak=${peakMt})`);
    assert.ok(startTimes[startTimes.length - 1] - startTimes[0] >= 80, 'Min interval spacing must spread burst launches');

    // Now force all machine routes into 429 cooldown and verify AI translation is 100% unaffected
    svc._mtClient._recordRouteFailure('google:direct', { status: 429, reason: 'rate_limited', message: '429' });
    svc._mtClient._recordRouteFailure('bing:direct', { status: 429, reason: 'rate_limited', message: '429' });
    await assert.rejects(() => svc.translateMachine('Machine routes are cooling down now.', null, 'zh-CN'), /HTTP 429/);

    const aiRes = await svc.translateAiStream('AI translation must stay completely independent of machine cooldown.', null, null, 'zh-CN');
    assert.equal(aiRes.text, 'AI 润色结果 unaffected');
    assert.equal(aiHits, 1);

    svc.dispose();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('5) diagnose({ mode: "machine" }) reports winning route and clear 429 prefix when all routes rate-limited', async () => {
  const tmpDir = mkTempDir('prism-mt-diag-');
  try {
    let scenario = 'bing_proxy_ok';
    const svc = new ThoughtTranslatorService({
      configDir: tmpDir,
      proxyEnv: {},
      resolveSystemProxy: () => 'http://alice:SuperSecretProxy99@127.0.0.1:7890',
      machineTransport: async ({ url, routeId }) => {
        if (scenario === 'bing_proxy_ok') {
          if (routeId === 'google:proxy') return new Response('429 via SuperSecretProxy99', { status: 429 });
          if (routeId === 'bing:proxy') {
            if (url === 'https://www.bing.com/translator') return new Response(makeMockBingPageHtml(), { status: 200 });
            return new Response('[{"translations":[{"text":"好"}]}]', { status: 200 });
          }
        } else if (scenario === 'google_direct_ok') {
          if (routeId.endsWith(':proxy')) return new Response('429 proxy', { status: 429 });
          if (routeId === 'google:direct') return new Response('[[["好","ok"]]]', { status: 200 });
        } else if (scenario === 'all_429') {
          return new Response('429 SuperSecretProxy99', { status: 429 });
        }
        return new Response('fail', { status: 500 });
      },
    });

    const d1 = await svc.diagnose({ mode: 'machine' });
    assert.equal(d1.connectivity.ok, true);
    assert.equal(d1.connectivity.route, 'bing:proxy');
    assert.equal(d1.connectivity.target, 'bing');

    scenario = 'google_direct_ok';
    const d2 = await svc.diagnose({ mode: 'machine' });
    assert.equal(d2.connectivity.ok, true);
    assert.equal(d2.connectivity.route, 'google:direct');
    assert.equal(d2.connectivity.target, 'gtx');

    scenario = 'all_429';
    const d3 = await svc.diagnose({ mode: 'machine' });
    assert.equal(d3.connectivity.ok, false);
    assert.equal(d3.connectivity.reason, 'rate_limited');
    assert.equal(d3.connectivity.status, 429);
    assert.ok(/Machine translate rate-limited \(HTTP 429\)/i.test(d3.connectivity.error));
    assert.equal(JSON.stringify(d3).includes('SuperSecretProxy99'), false, 'Diagnose must redact proxy secrets');

    svc.dispose();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('6) thought-client.js sync(cfg) clears stale failure cooldowns on mode/lang/proxyMode switch & distinguishes 9-locale mt_ratelimit', async () => {
  const clientSrc = fs.readFileSync(path.join(ROOT_DIR, 'vendor', 'thought-translator', 'thought-client.js'), 'utf8');
  let nextStreamResponse = { ok: false, error: 'AI HTTP 429: upstream quota rate limit' };
  const streamModesSeen = [];

  const { doc, sandbox } = createMiniClientDomEnv({
    __agPrismThoughtBridge: {
      call: async () => ({ ok: true, stylePreset: 'technical', entries: {} }),
      translateStream: async (opts) => {
        streamModesSeen.push(opts.mode);
        return nextStreamResponse;
      },
    },
  });

  const btn = doc.createElement('button');
  btn.setAttribute('data-testid', 'thinking-collapsible-trigger');
  btn.setAttribute('aria-expanded', 'true');
  btn.textContent = 'Thought for 4s';
  const panel = doc.createElement('div');
  const p = doc.createElement('p');
  p.textContent = 'Evaluating fallback error classification and cooldown reset across modes with 多语种测试.';
  panel.appendChild(p);
  doc.body.appendChild(btn);
  doc.body.appendChild(panel);

  vm.runInNewContext(clientSrc, sandbox);
  const api = sandbox.__agPrismThought;

  // Step 1: AI mode returns AI 429 -> reason must be 'ratelimit' (not mt_ratelimit)
  api.sync({ thoughtTranslate: 'ai', thoughtTrigger: 'expand', language: 'zh-CN', proxyMode: 'auto' });
  await new Promise((r) => setTimeout(r, 70));

  const aiErrBar = panel.querySelector('.ag-prism-thought-error-bar');
  assert.ok(aiErrBar, 'AI failure must render error bar');
  assert.equal(aiErrBar.getAttribute('data-fail-reason'), 'ratelimit');
  const aiErrTextZh = aiErrBar.querySelector('.ag-prism-thought-error-text').textContent;

  // Seed toolSummary & title failure cooldown maps too
  api.__toolSummaryFailedUntil.set('ts:key', Date.now() + 60000);
  api.__titleFailedUntil.set('title:key', Date.now() + 60000);
  assert.equal(api.__toolSummaryFailedUntil.size, 1);
  assert.equal(api.__titleFailedUntil.size, 1);

  // Step 2: Switch mode ai -> machine: must IMMEDIATELY clear all failure cooldown maps & re-scan
  nextStreamResponse = { ok: false, error: 'Machine translate rate-limited (HTTP 429): google:proxy:HTTP 429, bing:proxy:HTTP 429' };
  api.sync({ thoughtTranslate: 'machine', thoughtTrigger: 'expand', language: 'zh-CN', proxyMode: 'auto' });
  assert.equal(api.__toolSummaryFailedUntil.size, 0, 'Mode switch must clear toolSummaryFailedUntil immediately');
  assert.equal(api.__titleFailedUntil.size, 0, 'Mode switch must clear titleFailedUntil immediately');
  await new Promise((r) => setTimeout(r, 70));

  const mtErrBar = panel.querySelector('.ag-prism-thought-error-bar');
  assert.ok(mtErrBar, 'Machine 429 must render error bar');
  assert.equal(mtErrBar.getAttribute('data-fail-reason'), 'mt_ratelimit', 'Machine 429 must classify as mt_ratelimit');
  const mtErrTextZh = mtErrBar.querySelector('.ag-prism-thought-error-text').textContent;
  assert.notEqual(mtErrTextZh, aiErrTextZh, 'Machine 429 copy must be clearly distinct from AI 429 copy');
  assert.ok(mtErrTextZh.includes('免费机翻'), `Expected machine-specific zh-CN hint, got: ${mtErrTextZh}`);

  // Step 3: Verify all 9 locales have distinct, non-empty mt_ratelimit copy and 0 CJK chars in non-CJK locales
  const mtTextsByLocale = {};
  for (const loc of CANONICAL_9_LOCALES) {
    nextStreamResponse = { ok: false, error: 'Machine translate rate-limited (HTTP 429): all routes rate-limited' };
    api.sync({ thoughtTranslate: 'machine', thoughtTrigger: 'expand', language: loc, proxyMode: 'auto' });
    await new Promise((r) => setTimeout(r, 60));
    const bar = panel.querySelector('.ag-prism-thought-error-bar');
    assert.ok(bar, `mt_ratelimit error bar must render for ${loc}`);
    assert.equal(bar.getAttribute('data-fail-reason'), 'mt_ratelimit');
    const txt = bar.querySelector('.ag-prism-thought-error-text').textContent;
    const badge = btn.querySelector('.ag-prism-thought-trigger-badge');
    const badgeTxt = badge ? badge.textContent : '';
    assert.ok(txt && txt.length >= 6, `mt_ratelimit text missing for ${loc}`);
    assert.ok(badgeTxt && badgeTxt.length >= 4, `mt_ratelimit badge missing for ${loc}`);
    mtTextsByLocale[loc] = txt;
    if (NON_CJK_LOCALES.includes(loc)) {
      assert.equal(CJK_RE.test(txt), false, `Non-CJK locale ${loc} mt_ratelimit leaked CJK: "${txt}"`);
      assert.equal(CJK_RE.test(badgeTxt), false, `Non-CJK locale ${loc} mt_ratelimit badge leaked CJK: "${badgeTxt}"`);
    }
  }
  assert.notEqual(mtTextsByLocale['zh-CN'], mtTextsByLocale['zh-TW']);
  assert.notEqual(mtTextsByLocale.en, mtTextsByLocale.de);

  // Step 4: proxyMode change alone clears cooldowns and triggers rescan
  api.__toolSummaryFailedUntil.set('ts:proxy', Date.now() + 60000);
  api.__titleFailedUntil.set('title:proxy', Date.now() + 60000);
  nextStreamResponse = { ok: true, text: '直连切回后译文成功。', engine: 'machine' };
  api.sync({ thoughtTranslate: 'machine', thoughtTrigger: 'expand', language: 'zh-CN', proxyMode: 'direct' });
  assert.equal(api.__toolSummaryFailedUntil.size, 0, 'proxyMode change must clear toolSummaryFailedUntil');
  assert.equal(api.__titleFailedUntil.size, 0, 'proxyMode change must clear titleFailedUntil');
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(panel.getAttribute('data-op-zh-ready'), '1', 'Switching proxyMode must clear failedSigs and succeed on immediate rescan');

  api.destroy();
});

test('7) repo-sync automatically includes vendor/thought-translator/machine-translate-client.mjs', () => {
  const destDir = mkTempDir('prism-mt-sync-');
  try {
    const copied = copyUpdatedRuntimeFromRepo(ROOT_DIR, destDir);
    assert.ok(copied > 0);
    const syncedMt = path.join(destDir, 'vendor', 'thought-translator', 'machine-translate-client.mjs');
    assert.equal(fs.existsSync(syncedMt), true, 'repo-sync must recursively deploy machine-translate-client.mjs');
  } finally {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
});
