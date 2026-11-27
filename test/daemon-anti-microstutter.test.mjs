// Obsidian Prism Daemon / CDP / React Fiber / Telemetry 周期性微卡治理专项单测
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  buildRendererRpcExpression,
  buildRendererRpcCallExpression,
  normalizeRendererTrajectory,
} from '../vendor/pulse-dashboard/sidecars/panel/renderer-rpc-adapter.mjs';
import { MetricsStore } from '../vendor/pulse-dashboard/sidecars/panel/store.mjs';
import { PrismDaemon, RpcDispatcher } from '../src/daemon/index.mjs';
import { handleBrowserTargetEvent, isSameDocumentIgnoringHashAndTab } from '../src/daemon/browser-discovery.mjs';
import { verifyAndHealEntryUnlocked } from '../src/daemon/session-heal.mjs';
import {
  readSafeInlineDiff,
  getInlineDiffStats,
  clearInlineDiffCaches,
} from '../src/daemon/inline-diff-service.mjs';
import { putUsageDiskCache } from '../src/daemon/telemetry-cache.mjs';
import { DaemonLogger } from '../src/daemon/logger.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const pulseBridgeMod = require(path.join(ROOT, 'pulse-vial-bridge.js'));
const inlineFallbackMod = require(path.join(ROOT, 'vendor', 'pulse-dashboard', 'inline-fallback.js'));
const vialCore = require(path.join(ROOT, 'vial-core.js'));

const CID_1 = '11111111-1111-4111-8111-111111111111';
const CID_2 = '22222222-2222-4222-8222-222222222222';

function makeTempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function runGit(repoDir, args) {
  return execFileSync('git', ['-C', repoDir, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'Prism Test',
      GIT_AUTHOR_EMAIL: 'prism-test@example.invalid',
      GIT_COMMITTER_NAME: 'Prism Test',
      GIT_COMMITTER_EMAIL: 'prism-test@example.invalid',
    },
  });
}

function initTempGitRepo(prefix = 'prism-microstutter-git-') {
  const repoDir = makeTempDir(prefix);
  runGit(repoDir, ['init']);
  runGit(repoDir, ['config', 'user.name', 'Prism Test']);
  runGit(repoDir, ['config', 'user.email', 'prism-test@example.invalid']);
  runGit(repoDir, ['config', 'core.autocrlf', 'false']);
  return repoDir;
}

function createTelemetryTestDom({ cascadeId = CID_1 } = {}) {
  const winListeners = new Map();
  const docListeners = new Map();
  const storageMap = new Map();
  const moRecords = [];

  function makeStyle() {
    const m = new Map();
    return new Proxy(
      {
        setProperty(k, v) { m.set(k, String(v)); },
        getPropertyValue(k) { return m.get(k) || ''; },
        removeProperty(k) { m.delete(k); },
      },
      {
        get(t, p) { return p in t ? t[p] : typeof p === 'string' ? m.get(p) || '' : undefined; },
        set(_t, p, v) { if (typeof p === 'string') { if (v === '' || v == null) m.delete(p); else m.set(p, String(v)); } return true; },
      }
    );
  }

  function matchSingle(el, token) {
    if (!token || !el._attrs) return false;
    let rest = token.trim();
    if (!rest || rest.includes(' ') || rest.includes('>')) return false;
    const tag = rest.match(/^[a-zA-Z0-9-]+/);
    if (tag) {
      if (el.tagName !== tag[0].toUpperCase()) return false;
      rest = rest.slice(tag[0].length);
    }
    for (const m of rest.matchAll(/#([a-zA-Z0-9_-]+)/g)) if (el.getAttribute('id') !== m[1]) return false;
    for (const m of rest.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
      if (!(el.getAttribute('class') || '').split(/\s+/).includes(m[1])) return false;
    }
    for (const m of rest.matchAll(/\[([a-zA-Z0-9_-]+)(?:=["']?([^"'\]\s]+)["']?)?\]/g)) {
      if (!el.hasAttribute(m[1])) return false;
      if (m[2] !== undefined && el.getAttribute(m[1]) !== m[2]) return false;
    }
    return true;
  }

  function matchesSel(el, sel) {
    return String(sel).split(',').some((p) => {
      const toks = p.trim().split(/\s+/).filter(Boolean);
      if (!toks.length || !matchSingle(el, toks[toks.length - 1])) return false;
      let cur = el.parentElement;
      for (let i = toks.length - 2; i >= 0; i -= 1) {
        while (cur && !matchSingle(cur, toks[i])) cur = cur.parentElement;
        if (!cur) return false;
        cur = cur.parentElement;
      }
      return true;
    });
  }

  function walk(root, cb) {
    for (const c of root.children || []) {
      cb(c);
      walk(c, cb);
    }
  }

  function mkNode(tag, attrs = {}) {
    const _attrs = new Map();
    const listeners = new Map();
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      _attrs,
      children: [],
      parentNode: null,
      parentElement: null,
      shadowRoot: null,
      isConnected: true,
      textContent: '',
      hidden: false,
      get id() { return _attrs.get('id') || ''; },
      set id(v) { _attrs.set('id', String(v)); },
      get className() { return _attrs.get('class') || ''; },
      set className(v) { _attrs.set('class', String(v)); },
      classList: {
        contains: (c) => (_attrs.get('class') || '').split(/\s+/).includes(c),
        add: (c) => { const s = new Set((_attrs.get('class') || '').split(/\s+/).filter(Boolean)); s.add(c); _attrs.set('class', [...s].join(' ')); },
        remove: (c) => { const s = new Set((_attrs.get('class') || '').split(/\s+/).filter(Boolean)); s.delete(c); _attrs.set('class', [...s].join(' ')); },
      },
      get firstChild() { return el.children[0] || null; },
      get firstElementChild() { return el.children[0] || null; },
      get nextSibling() {
        if (!el.parentNode) return null;
        const i = el.parentNode.children.indexOf(el);
        return i >= 0 ? el.parentNode.children[i + 1] || null : null;
      },
      setAttribute(k, v) { if (k === 'hidden') el.hidden = true; _attrs.set(k, String(v)); },
      getAttribute(k) { return _attrs.has(k) ? _attrs.get(k) : null; },
      hasAttribute(k) { return _attrs.has(k); },
      removeAttribute(k) { if (k === 'hidden') el.hidden = false; _attrs.delete(k); },
      appendChild(c) {
        if (c.parentNode) c.remove();
        c.parentNode = el;
        c.parentElement = el.tagName === '#SHADOW-ROOT' ? null : el;
        c.isConnected = el.isConnected;
        el.children.push(c);
        return c;
      },
      insertBefore(c, ref) {
        if (!ref) return el.appendChild(c);
        const i = el.children.indexOf(ref);
        if (i < 0) return el.appendChild(c);
        if (c.parentNode) c.remove();
        c.parentNode = el;
        c.parentElement = el.tagName === '#SHADOW-ROOT' ? null : el;
        c.isConnected = el.isConnected;
        el.children.splice(i, 0, c);
        return c;
      },
      removeChild(c) {
        const i = el.children.indexOf(c);
        if (i >= 0) { el.children.splice(i, 1); c.parentNode = c.parentElement = null; c.isConnected = false; }
        return c;
      },
      remove() { if (el.parentNode) el.parentNode.removeChild(el); },
      attachShadow({ mode }) {
        const sr = mkNode('#shadow-root');
        sr.mode = mode;
        sr.host = el;
        sr.isConnected = el.isConnected;
        el.shadowRoot = sr;
        return sr;
      },
      getElementById(id) { let hit = null; walk(el, (n) => { if (!hit && n.getAttribute('id') === id) hit = n; }); return hit; },
      querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) { const r = []; walk(el, (n) => { if (matchesSel(n, sel)) r.push(n); }); return r; },
      matches(sel) { return matchesSel(el, sel); },
      closest(sel) { let c = el; while (c) { if (c.matches?.(sel)) return c; c = c.parentElement; } return null; },
      contains(other) { let c = other; while (c) { if (c === el) return true; c = c.parentNode; } return false; },
      addEventListener(t, f) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(f); },
      removeEventListener(t, f) { listeners.get(t)?.delete(f); },
      dispatchEvent(ev) { for (const f of [...(listeners.get(ev.type) || [])]) f({ target: el, preventDefault() {}, stopPropagation() {}, ...ev }); },
      getBoundingClientRect: () => ({ left: 100, top: 20, right: 900, bottom: 60, width: 800, height: 40 }),
      getContext: () => null,
    };
    el.style = makeStyle();
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') el.textContent = String(v);
      else el.setAttribute(k, v);
    }
    return el;
  }

  const html = mkNode('html', { 'data-ag-cs-theme': 'dark' });
  const body = mkNode('body', { class: 'theme-dark' });
  html.appendChild(body);
  const convView = mkNode('div', { 'data-testid': 'conversation-view', 'data-cascade-id': cascadeId });
  const inputBox = mkNode('div', { 'data-testid': 'agent-input-box' });
  const footer = mkNode('div', { class: 'agy-composer-footer' });
  footer.appendChild(mkNode('button', { 'data-testid': 'model-selector-trigger', text: 'Gemini 4' }));
  footer.appendChild(mkNode('button', { 'data-testid': 'input-send-button', text: 'Send' }));
  inputBox.appendChild(footer);
  convView.appendChild(inputBox);
  body.appendChild(convView);

  const doc = {
    documentElement: html,
    body,
    hidden: false,
    activeElement: body,
    createElement: (t) => mkNode(t),
    getElementById: (id) => html.getElementById(id),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener(t, f) { if (!docListeners.has(t)) docListeners.set(t, new Set()); docListeners.get(t).add(f); },
    removeEventListener(t, f) { docListeners.get(t)?.delete(f); },
  };

  class MockMO {
    constructor(cb) {
      this.cb = cb;
      this.targets = [];
      moRecords.push(this);
    }
    observe(target, opts) { this.targets.push({ target, opts }); }
    disconnect() { this.disconnected = true; }
  }

  const win = {
    document: doc,
    location: { href: `https://127.0.0.1:8798/c/${cascadeId}`, pathname: `/c/${cascadeId}`, hash: '' },
    navigator: { language: 'zh-CN' },
    innerWidth: 1280,
    MutationObserver: MockMO,
    localStorage: {
      getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => storageMap.set(k, String(v)),
      removeItem: (k) => storageMap.delete(k),
    },
    addEventListener(t, f) { if (!winListeners.has(t)) winListeners.set(t, new Set()); winListeners.get(t).add(f); },
    removeEventListener(t, f) { winListeners.get(t)?.delete(f); },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  };
  win.window = win;
  win.globalThis = win;

  return { win, doc, html, body, convView, footer, moRecords, mkNode };
}

test('1. findAgentMgr 15s negative cache stops repeated 4,000-node Fiber BFS and invalidates early on route/container change', async () => {
  let fakeNow = 100000;
  let fiberVisits = 0;
  const fakeLs = {
    getUserStatus: async () => ({ userStatus: { email: 'perf@test.local' } }),
    getCascadeTrajectory: async () => ({ status: 1, numTotalSteps: 2, trajectory: { steps: [], generatorMetadata: [] } }),
  };

  // Build 1,200-node Fiber tree containing LS at root and NO AgentMgr initially
  let chain = { memoizedProps: {}, child: null, sibling: null };
  for (let i = 0; i < 1200; i += 1) {
    const next = chain;
    chain = {
      get memoizedProps() {
        fiberVisits += 1;
        return {};
      },
      child: next,
      sibling: null,
    };
  }
  const rootFiber = { memoizedProps: { value: fakeLs }, child: chain, sibling: null };
  const fakeRoot = { __reactFiber$root: rootFiber };
  let activeConv = null;

  const sandbox = {
    Date: { now: () => fakeNow, parse: Date.parse },
    location: { pathname: `/c/${CID_1}`, hash: '' },
    document: {
      getElementById: (id) => (id === 'root' ? fakeRoot : null),
      querySelector: (sel) => (String(sel).includes('conversation-view') ? activeConv : null),
      querySelectorAll: () => [],
    },
    WeakRef: globalThis.WeakRef,
    Promise,
    Set,
    Object,
    Array,
    Number,
    String,
    Boolean,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  // Install dispatcher and warm LS cache
  const probeRes = await vm.runInContext(buildRendererRpcExpression('Probe', {}), sandbox);
  assert.equal(probeRes.ok, true);
  fiberVisits = 0;

  // First PeekContextState misses AgentMgr and scans the 1,200-node Fiber tree once
  const p1 = await vm.runInContext(buildRendererRpcCallExpression('PeekContextState', { cascadeId: CID_1 }), sandbox);
  assert.equal(p1.ok, true);
  const firstScanVisits = fiberVisits;
  assert.ok(firstScanVisits >= 1200, `Expected initial BFS to visit >=1200 Fiber nodes, got ${firstScanVisits}`);

  // Next 5 calls within 15s cooldown must hit negative cache with 0 Fiber BFS visits
  for (let i = 0; i < 5; i += 1) {
    fakeNow += 2000;
    const pHit = await vm.runInContext(buildRendererRpcCallExpression('PeekContextState', { cascadeId: CID_1 }), sandbox);
    assert.equal(pHit.ok, true);
  }
  assert.equal(fiberVisits, firstScanVisits, 'Calls within 15s negative-cache cooldown must perform 0 additional Fiber BFS visits');

  // Route change invalidates negative cache immediately
  sandbox.location.pathname = `/c/${CID_2}`;
  await vm.runInContext(buildRendererRpcCallExpression('PeekContextState', { cascadeId: CID_2 }), sandbox);
  assert.ok(fiberVisits > firstScanVisits, 'Route pathname change must invalidate negative cache early');
  const afterRouteVisits = fiberVisits;

  // New conversation container mount invalidates negative cache immediately and discovers late-mounted AgentMgr
  const lateAgentMgr = {
    peek: () => ({ getState: () => ({ status: 1, trajectorySlice: { totalStepsLength: 9 }, contextWindowUsage: { estimatedTokensUsed: 32000, maxContextTokens: 512000 } }) }),
    getAgentStates: () => new Map(),
  };
  activeConv = { getAttribute: (k) => (k === 'data-cascade-id' ? CID_2 : null) };
  rootFiber.sibling = { memoizedProps: { value: lateAgentMgr }, child: null, sibling: null };
  const pLate = await vm.runInContext(buildRendererRpcCallExpression('PeekContextState', { cascadeId: CID_2 }), sandbox);
  assert.equal(pLate.ok, true);
  assert.ok(fiberVisits > afterRouteVisits, 'Mounting a new conversation container must invalidate negative cache early');
  assert.equal(pLate.data.stepCount, 9);
  assert.equal(pLate.data.contextWindowUsage.estimatedTokensUsed, 32000);

  // Expiry after >15s also invalidates negative cache
  vm.runInContext('delete globalThis.__agPrismAgentMgrRef', sandbox);
  rootFiber.sibling = null;
  await vm.runInContext(buildRendererRpcCallExpression('PeekContextState', { cascadeId: CID_2 }), sandbox);
  const beforeExpire = fiberVisits;
  fakeNow += 15001;
  await vm.runInContext(buildRendererRpcCallExpression('PeekContextState', { cascadeId: CID_2 }), sandbox);
  assert.ok(fiberVisits > beforeExpire, 'Negative cache must expire after 15,000ms');
});

test('2. GetCascadeTrajectory incremental unchanged path skips 8 MiB projection clone & keeps MetricsStore/legacy 100% compatible', async () => {
  let middleStepReads = 0;
  let stepStatus = 3;
  const rawSteps = [];
  for (let i = 0; i < 400; i += 1) {
    const idx = i;
    rawSteps.push({
      type: 1,
      get status() {
        if (idx > 0 && idx < 399) middleStepReads += 1;
        return stepStatus;
      },
      step: { case: 'plannerResponse', value: { response: `step-${idx}`, toolCalls: [] } },
      metadata: { createdAt: '2026-11-27T01:00:00.000Z', completedAt: '2026-11-27T01:00:01.000Z' },
    });
  }
  const fakeTraj = {
    status: 1,
    numTotalSteps: 400,
    numTotalGeneratorMetadata: 1,
    contextWindowUsage: { estimatedTokensUsed: 64000, maxContextTokens: 512000, lastStepIndex: 399 },
    trajectory: {
      cascadeId: CID_1,
      steps: rawSteps,
      generatorMetadata: [{ stepIndices: [399], chatModel: { model: 1, usage: { inputTokens: '50000', outputTokens: '2000' } } }],
    },
  };
  const fakeLs = {
    getUserStatus: async () => ({ userStatus: { email: 'inc@test.local' } }),
    getCascadeTrajectory: async () => fakeTraj,
  };
  const sandbox = {
    document: { getElementById: (id) => (id === 'root' ? { __reactFiber$1: { memoizedProps: { value: fakeLs }, child: null, sibling: null } } : null), querySelectorAll: () => [] },
    WeakRef: globalThis.WeakRef,
    Promise,
    Set,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Date,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  // Legacy call without lastStepCount/lastStepSig -> full projection returned
  const fullRes = await vm.runInContext(buildRendererRpcExpression('GetCascadeTrajectory', { cascadeId: CID_1 }), sandbox);
  assert.equal(fullRes.ok, true);
  assert.equal(fullRes.data.unchanged, undefined);
  assert.equal(fullRes.data.trajectory.steps.length, 400);
  assert.ok(typeof fullRes.data.lastStepSig === 'string' && fullRes.data.lastStepSig.length > 0);
  assert.ok(middleStepReads >= 398);

  // Incremental call with matching lastStepCount + lastStepSig -> unchanged:true with 0 middle-step reads!
  middleStepReads = 0;
  const incRes = await vm.runInContext(
    buildRendererRpcCallExpression('GetCascadeTrajectory', {
      cascadeId: CID_1,
      lastStepCount: 400,
      lastStepSig: fullRes.data.lastStepSig,
    }),
    sandbox
  );
  assert.equal(incRes.ok, true);
  assert.equal(incRes.data.unchanged, true);
  assert.equal(incRes.data.trajectory, undefined, 'unchanged response must omit full trajectory tree');
  assert.equal(middleStepReads, 0, 'unchanged fast-path must perform 0 full-step cloning iterations');

  // Normalized unchanged payload keeps unchanged flag cleanly
  const normUnchanged = normalizeRendererTrajectory(incRes.data, CID_1);
  assert.equal(normUnchanged.unchanged, true);
  assert.equal(normUnchanged.numTotalSteps, 400);

  // Mutating last step status invalidates signature and returns fresh full projection
  stepStatus = 2;
  const changedRes = await vm.runInContext(
    buildRendererRpcCallExpression('GetCascadeTrajectory', {
      cascadeId: CID_1,
      lastStepCount: 400,
      lastStepSig: fullRes.data.lastStepSig,
    }),
    sandbox
  );
  assert.equal(changedRes.ok, true);
  assert.equal(changedRes.data.unchanged, undefined);
  assert.equal(changedRes.data.trajectory.steps.length, 400);

  // MetricsStore.session reuses cached entry.data cleanly when client.trajectory returns { unchanged: true }
  const tmpDir = makeTempDir('prism-store-inc-');
  try {
    let trajCalls = 0;
    const capturedOpts = [];
    const fakeClient = {
      server: { port: 0, csrf: '', pid: 101, mode: 'renderer-proxy' },
      call: async () => ({}),
      discover: async () => ({ port: 0, csrf: '', pid: 101, mode: 'renderer-proxy' }),
      trajectory: async (_id, opts) => {
        trajCalls += 1;
        capturedOpts.push(opts);
        if (trajCalls === 1) {
          return {
            status: 'CASCADE_RUN_STATUS_IDLE',
            numTotalSteps: 12,
            lastStepSig: 'sig-v1',
            contextWindowUsage: { estimatedTokensUsed: 48000, maxContextTokens: 512000 },
            trajectory: { cascadeId: CID_1, steps: [{ type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', metadata: {} }], generatorMetadata: [] },
          };
        }
        return { unchanged: true, status: 'CASCADE_RUN_STATUS_IDLE', numTotalSteps: 12, lastStepSig: 'sig-v1' };
      },
      dispose() {},
    };
    const store = new MetricsStore(fakeClient, { dataDir: tmpDir, background: null, transcripts: null });
    const first = await store.session(CID_1, false);
    assert.ok(first);
    store.sessions.get(CID_1).updatedAt = 0; // force re-check without force=true
    const second = await store.session(CID_1, false);
    assert.equal(trajCalls, 2);
    assert.equal(capturedOpts[1].lastStepCount, 12);
    assert.equal(capturedOpts[1].lastStepSig, 'sig-v1');
    assert.equal(second, first, 'MetricsStore.session must reuse cached metrics when trajectory returns unchanged:true');
    store.dispose();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('3. pulse-vial-bridge 0 :has(), GPU-only pv-in, data-has-quota sync, domBus body-MO removal, includeConversations:false & inline-fallback 0 :host-context()', async () => {
  // Static + decoded CSS hygiene
  const bridgeSrc = fs.readFileSync(path.join(ROOT, 'pulse-vial-bridge.js'), 'utf8');
  assert.equal(bridgeSrc.includes(':has('), false, 'pulse-vial-bridge.js source must have 0 :has(');
  const ctx = { G: {} };
  vm.runInNewContext(bridgeSrc.slice(bridgeSrc.indexOf('let N=null'), bridgeSrc.indexOf(',L0=Z(')) + '; globalThis.__CSS = CSS;', ctx);
  assert.equal(ctx.__CSS.includes(':has('), false, 'Decoded pulse-vial-bridge CSS must have 0 :has(');
  assert.ok(ctx.__CSS.includes('#context-card[data-has-quota="1"]'), 'Decoded CSS must target #context-card[data-has-quota="1"]');
  const pvInMatch = ctx.__CSS.match(/@keyframes pv-in\{[^}]*\}[^}]*\}/);
  assert.ok(pvInMatch && !pvInMatch[0].includes('blur('), 'pv-in keyframes must use pure GPU opacity+transform without blur()');

  const fbSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'pulse-dashboard', 'inline-fallback.js'), 'utf8');
  assert.equal(fbSrc.includes(':host-context('), false, 'inline-fallback.js must have 0 :host-context(');
  assert.equal(fbSrc.includes('.context-ring{will-change:transform'), false, '.context-ring must not permanently hold will-change:transform');

  // Runtime test: data-has-quota sync, domBus adoption (0 doc.body MO), inline-fallback host attr sync & includeConversations:false
  const env = createTelemetryTestDom({ cascadeId: CID_1 });
  const domBusSubs = [];
  env.win.__agDomBus = {
    subscribe(id, cb, opts) {
      domBusSubs.push({ id, cb, opts });
      return () => {};
    },
  };
  const metricInputs = [];
  env.win.__agPrismMetricsCall = (raw) => {
    const req = JSON.parse(raw);
    metricInputs.push(req.input);
    env.win.__agPrismMetricsResolve?.(req.id, {
      connection: 'live',
      groups: [{ id: 'gemini', name: 'Gemini', windows: { '5h': { remainingFraction: 0.9, available: true } } }],
      speed: { model: 'Gemini 4', tps: 42, context: { usedTokens: 40000, maxTokens: 512000, usedFraction: 0.08 } },
    });
  };

  const ctl = inlineFallbackMod.createTelemetryController({ window: env.win, document: env.doc });
  ctl.sync({ telemetryModule: 'on' });
  const host = ctl.getPrimaryBar();
  assert.ok(host);

  // Host attribute sync from html[data-ag-cs-*]
  env.html.setAttribute('data-ag-cs-theme', 'light');
  env.html.setAttribute('data-ag-cs-resizing', '1');
  env.html.setAttribute('data-ag-cs-ignore-rm', '1');
  for (const sub of domBusSubs) if (sub.id === 'pulse-blur') sub.cb([]);
  assert.equal(host.getAttribute('data-pv-light'), '1');
  assert.equal(host.getAttribute('data-pv-resizing'), '1');
  assert.equal(host.getAttribute('data-pv-ignore-rm'), '1');

  const prevDoc = globalThis.document;
  delete globalThis.document;
  const bridge = pulseBridgeMod.mountPulseVialBridge({
    win: env.win,
    doc: env.doc,
    storage: env.win.localStorage,
    vialCore,
    autoPoll: false,
    allowMultiple: true,
  });
  try {
    await bridge.sync();
    // Collapsed poll passes includeConversations: false
    assert.ok(metricInputs.length >= 1);
    assert.equal(metricInputs.every((inp) => inp.includeConversations === false), true, 'Collapsed polling must send includeConversations: false');

    // No standalone doc.body MutationObserver when __agDomBus is available
    const bodyObserved = env.moRecords.some((mo) => mo.targets.some((t) => t.target === env.body));
    assert.equal(bodyObserved, false, 'pulse-vial-bridge must not attach standalone doc.body MO when __agDomBus is present');
    assert.ok(domBusSubs.some((s) => s.id === 'pv-attr'), 'pulse-vial-bridge must subscribe via __agDomBus');

    // Mount & unmount .quota-details toggles #context-card[data-has-quota="1"]
    const card = host.shadowRoot.getElementById('context-card');
    assert.equal(card.hasAttribute('data-has-quota'), false);
    const qd = env.mkNode('div', { class: 'quota-details' });
    card.appendChild(qd);
    await bridge.sync();
    assert.equal(card.getAttribute('data-has-quota'), '1');
    qd.remove();
    await bridge.sync();
    assert.equal(card.hasAttribute('data-has-quota'), false);

    // Backend store.snapshot + RpcDispatcher honor includeConversations: false
    const fakeStore = new MetricsStore(
      {
        call: async () => ({}),
        discover: async () => ({ port: 0, csrf: '', pid: 9, mode: 'renderer-proxy' }),
        trajectory: async () => ({ status: 1, numTotalSteps: 0, trajectory: { cascadeId: CID_1, steps: [], generatorMetadata: [] } }),
        dispose() {},
      },
      { dataDir: makeTempDir('prism-inc-store-'), background: null, transcripts: null }
    );
    fakeStore.serverPid = 9;
    fakeStore.quota = [];
    fakeStore.quotaAt = Date.now();
    fakeStore.summaries = Array.from({ length: 50 }, (_, i) => ({ id: `conv-${i}`, title: `Big Conversation ${i}` }));
    fakeStore.summariesAt = Date.now();
    const collapsedSnap = await fakeStore.snapshot({ conversationId: CID_1, includeConversations: false, selectLatest: false });
    const expandedSnap = await fakeStore.snapshot({ conversationId: CID_1, includeConversations: true, selectLatest: false });
    assert.deepEqual(collapsedSnap.conversations, []);
    assert.equal(expandedSnap.conversations.length, 50);
    fs.rmSync(fakeStore.dataDir, { recursive: true, force: true });
    fakeStore.dispose();

    // RpcDispatcher also strips large conversations when includeConversations === false
    const sentExprs = [];
    const dispatcher = new RpcDispatcher({
      telemetrySubsystem: {
        _customMetricsProvider: null,
        _telemetryInFlight: 0,
        isDisabled: () => false,
        beginActivity() { this._telemetryInFlight += 1; },
        endActivity() { this._telemetryInFlight -= 1; },
        releaseIdle() {},
        async ensureMetricsCollector() {
          return async () => ({ connection: 'live', speed: null, groups: [], conversations: [{ id: 'a' }, { id: 'b' }] });
        },
      },
    });
    const fakeEntry = {
      mainFrameId: 'F1',
      hasFrameTree: true,
      contextFrames: new Map([[1, { isDefault: true, type: 'default', frameId: 'F1' }]]),
      session: { closed: false, async send(m, p) { if (m === 'Runtime.evaluate') sentExprs.push(p.expression); return {}; } },
    };
    await dispatcher.handleBindingCall(fakeEntry, {
      name: '__agPrismMetricsCall',
      payload: JSON.stringify({ id: 101, input: { includeConversations: false } }),
      executionContextId: 1,
    });
    let rpcPayload = null;
    vm.runInNewContext(sentExprs[0], { window: { __agPrismMetricsResolve: (_id, d) => { rpcPayload = d; } } });
    assert.deepEqual(JSON.parse(JSON.stringify(rpcPayload.conversations)), []);
  } finally {
    bridge.destroy();
    ctl.destroy();
    if (prevDoc !== undefined) globalThis.document = prevDoc;
  }
});

test('4. Window-level single-flight (__agPrismMetricsInflight) deduplicates concurrent inline-fallback + pulse-vial-bridge polls', async () => {
  const env = createTelemetryTestDom({ cascadeId: CID_1 });
  let cdpCalls = 0;
  const pendingResolvers = [];
  env.win.__agPrismMetricsCall = (raw) => {
    cdpCalls += 1;
    const req = JSON.parse(raw);
    pendingResolvers.push(() => {
      env.win.__agPrismMetricsResolve?.(req.id, {
        connection: 'live',
        groups: [{ id: 'gemini', name: 'Gemini', windows: { '5h': { remainingFraction: 0.85, available: true } } }],
        speed: { model: 'Gemini 4', tps: 55.5, context: { usedTokens: 60000, maxTokens: 512000, usedFraction: 0.12 } },
      });
    });
  };

  const ctl = inlineFallbackMod.createTelemetryController({ window: env.win, document: env.doc });
  ctl.sync({ telemetryModule: 'on' });
  // Drain initial mount refresh
  assert.equal(cdpCalls, 1);
  pendingResolvers.shift()();
  await new Promise((r) => setTimeout(r, 10));

  const prevDoc = globalThis.document;
  delete globalThis.document;
  const bridge = pulseBridgeMod.mountPulseVialBridge({
    win: env.win,
    doc: env.doc,
    storage: env.win.localStorage,
    vialCore,
    autoPoll: false,
    allowMultiple: true,
  });
  try {
    // Drain initial bridge sync
    if (pendingResolvers.length) {
      pendingResolvers.shift()();
      await new Promise((r) => setTimeout(r, 10));
    }

    cdpCalls = 0;
    const pFallback = ctl.refresh();
    const pBridge = bridge.sync();
    assert.ok(env.win.__agPrismMetricsInflight instanceof Map);
    assert.equal(env.win.__agPrismMetricsInflight.size, 1);
    assert.equal(cdpCalls, 1, 'Concurrent inline-fallback.refresh() + pulse-vial-bridge.sync() must share 1 single-flight CDP call');

    pendingResolvers.shift()();
    await Promise.all([pFallback, pBridge]);
    assert.equal(env.win.__agPrismMetricsInflight.size, 0, 'Single-flight entry must clean up after resolve');

    // 4a. Synchronous throw in __agPrismMetricsCall from pulse-vial-bridge must clean __agPrismMetricsInflight and unblock inline-fallback
    const origResolve = env.win.__agPrismMetricsResolve;
    env.win.__agPrismMetricsCall = () => { throw new Error('sync bridge failure'); };
    const pBridgeThrow = bridge.sync();
    const pFbAfterThrow = ctl.refresh();
    await Promise.all([pBridgeThrow, pFbAfterThrow]);
    assert.equal(env.win.__agPrismMetricsInflight.size, 0, 'Sync throw in __agPrismMetricsCall must clean __agPrismMetricsInflight');
    assert.equal(env.win.__agPrismMetricsResolve, origResolve, 'Sync throw must restore __agPrismMetricsResolve');

    // 4b. Unanswered __agPrismMetricsCall timeout (2s) must settle bridge + concurrent inline-fallback and delete inflight key
    env.win.__agPrismMetricsCall = () => {};
    const pBridgeTimeout = bridge.sync();
    const pFbSharedTimeout = ctl.refresh();
    assert.equal(env.win.__agPrismMetricsInflight.size, 1, 'Pending bridge call should register in __agPrismMetricsInflight');
    const [bRes, fbRes] = await Promise.all([pBridgeTimeout, pFbSharedTimeout]);
    assert.ok(bRes && typeof bRes === 'object', 'Timed-out bridge.sync() must settle cleanly');
    assert.ok(fbRes && fbRes.speed, 'Shared inline-fallback.refresh() must resolve to fallback snapshot on bridge timeout');
    assert.equal(env.win.__agPrismMetricsInflight.size, 0, 'Timed-out inflight Promise must auto-delete from __agPrismMetricsInflight');

    // 4c. Rejected external promise in __agPrismMetricsInflight must be cleaned and not hang/reject inline-fallback
    env.win.__agPrismMetricsInflight.set(`${CID_1}:1`, Promise.reject(new Error('stale rejected inflight')));
    const fbAfterRej = await ctl.refresh();
    assert.ok(fbAfterRej && fbAfterRej.speed, 'inline-fallback must recover cleanly from rejected shared inflight');
    assert.equal(env.win.__agPrismMetricsInflight.size, 0, 'Rejected shared inflight entry must be evicted');

    // 4d. Subsequent normal request works without permanent deadlock
    env.win.__agPrismMetricsCall = (raw) => {
      const req = JSON.parse(raw);
      env.win.__agPrismMetricsResolve?.(req.id, {
        connection: 'live',
        groups: [{ id: 'gemini', name: 'Gemini', windows: { '5h': { remainingFraction: 0.77, available: true } } }],
        speed: { model: 'Gemini 4', tps: 61.2, context: { usedTokens: 70000, maxTokens: 512000, usedFraction: 0.14 } },
      });
    };
    const recovered = await ctl.refresh();
    assert.equal(recovered.connection, 'live');
    assert.equal(env.win.__agPrismMetricsInflight.size, 0);
  } finally {
    bridge.destroy();
    ctl.destroy();
    if (prevDoc !== undefined) globalThis.document = prevDoc;
  }
});

test('5. Target.targetInfoChanged title / #hash+?tab= jitter preserves healthyStreak 45s backoff while cross-doc nav still invalidates', async () => {
  let tickCalls = 0;
  const entry = {
    wsUrl: 'ws://127.0.0.1:9999/page/1',
    pageId: 'p1',
    url: `https://127.0.0.1:8798/c/${CID_1}?tab=file__a#line-1`,
    title: 'Conv A - Antigravity',
    targetType: 'page',
    targetAttached: true,
    detectedScopeKey: 'local',
    _usageScopeVerified: true,
    healthyStreak: 5,
    verifyDirty: false,
    lastVerifyAt: Date.now(),
    lastVerifiedCodeHash: 'h1',
    mainFrameId: 'F1',
    contextFrames: new Map([[1, { frameId: 'F1', isDefault: true, type: 'default', docGen: 0 }]]),
    session: { closed: false, evaluate: async () => { throw new Error('Should not run 7KB DOM probe during 45s backoff'); } },
  };
  const reg = {
    sessions: new Map([[entry.wsUrl, entry]]),
    browserSession: { closed: false },
    hasMainDefaultContext: () => true,
    isEligibleDaemonTarget: () => false,
    _deps: { scheduleImmediateTick: () => { tickCalls += 1; } },
  };

  assert.equal(
    isSameDocumentIgnoringHashAndTab(
      `https://127.0.0.1:8798/c/${CID_1}?tab=a#s1`,
      `https://127.0.0.1:8798/c/${CID_1}?tab=b#s2`
    ),
    true
  );

  // Combined title + ?tab= + #hash churn must preserve healthyStreak=5 and skip dirty flag
  const r1 = handleBrowserTargetEvent(reg, {
    targetInfo: {
      targetId: 'p1',
      type: 'page',
      attached: true,
      title: 'Conv A (generating...) - Antigravity',
      url: `https://127.0.0.1:8798/c/${CID_1}?tab=file__b#line-99`,
    },
  });
  assert.equal(r1.dirty, false);
  assert.equal(entry.healthyStreak, 5);
  assert.equal(entry.verifyDirty, false);
  assert.equal(tickCalls, 0);

  // Verify 45s backoff skips DOM probe (lastVerifyAt 20s ago < 45s)
  entry.lastVerifyAt = Date.now() - 20000;
  const orch = {
    codeHash: 'h1',
    sessionRegistry: reg,
    getCdp: () => ({ readConfig: () => ({}) }),
    getChannelExpr: () => '',
    hasChannelFile: () => false,
    isChannelEnabled: () => false,
  };
  const healSkip = await verifyAndHealEntryUnlocked(orch, entry, false);
  assert.equal(healSkip.skipped, true, 'Healthy streak 5 with browserSession live must stay in 45s backoff');

  // Cross-document pathname change must still invalidate immediately
  const r2 = handleBrowserTargetEvent(reg, {
    targetInfo: {
      targetId: 'p1',
      type: 'page',
      attached: true,
      title: 'Conv B - Antigravity',
      url: `https://127.0.0.1:8798/c/${CID_2}?tab=file__b`,
    },
  });
  assert.equal(r2.dirty, true);
  assert.equal(entry.healthyStreak, 0);
  assert.equal(entry.verifyDirty, true);
  assert.equal(tickCalls, 1);
});

test('6. inline-diff-service caches LRU up to 128, deduplicates repo git status within 2.5s TTL, and detects newly written untracked files', async () => {
  const repoDir = initTempGitRepo('prism-idiff-ttl-');
  try {
    const files = ['a.js', 'b.js', 'c.js', 'd.js', 'e.js'].map((name) => path.join(repoDir, name));
    for (const f of files) fs.writeFileSync(f, `export const v = "${path.basename(f)}";\n`, 'utf8');
    runGit(repoDir, ['add', '.']);
    runGit(repoDir, ['commit', '-m', 'init']);
    // Ensure committed files' mtime precedes our snapshot start
    const past = new Date(Date.now() - 5000);
    for (const f of files) fs.utimesSync(f, past, past);

    clearInlineDiffCaches();
    assert.equal(getInlineDiffStats().cacheMax, 128);

    // Concurrent reads of 4 clean committed files in the same repo -> 1 shared git status subprocess!
    const results = await Promise.all(files.slice(0, 4).map((f) => readSafeInlineDiff(f)));
    for (const res of results) {
      assert.equal(res.ok, true);
      assert.equal(res.mode, 'snapshot');
    }
    const afterBurst = getInlineDiffStats();
    assert.equal(afterBurst.gitExecCount, 1, `Expected 1 shared git.exe for 4 concurrent clean files, got ${afterBurst.gitExecCount}`);
    assert.ok(afterBurst.statusInFlightDedups + afterBurst.statusCacheHits >= 3);

    // 5th clean file within 2.5s TTL -> hits gitRoot + repoStatus caches with 0 extra git.exe!
    const fifth = await readSafeInlineDiff(files[4]);
    assert.equal(fifth.ok, true);
    assert.equal(fifth.mode, 'snapshot');
    const afterFifth = getInlineDiffStats();
    assert.equal(afterFifth.gitExecCount, 1, '5th clean file within 2.5s TTL must spawn 0 additional git.exe');
    assert.ok(afterFifth.rootCacheHits >= 1);
    assert.ok(afterFifth.statusCacheHits >= 1);

    // Brand-new untracked file written after snapshot -> bypasses stale snapshot and detects new-file
    await new Promise((r) => setTimeout(r, 25));
    const freshFile = path.join(repoDir, 'brand-new.js');
    fs.writeFileSync(freshFile, 'export const fresh = true;\n', 'utf8');
    const freshRes = await readSafeInlineDiff(freshFile);
    assert.equal(freshRes.ok, true);
    assert.equal(freshRes.mode, 'new-file');
  } finally {
    clearInlineDiffCaches();
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test('7. telemetry-cache 0-JSON.stringify dirty diff, DaemonLogger async buffer without dropping logs & 72ms thought-stream frame coalescing', async () => {
  // 7a. telemetry-cache avoids JSON.stringify while detecting deep nested changes accurately
  const tmpDir = makeTempDir('prism-microstutter-misc-');
  const origStringify = JSON.stringify;
  const origAppendSync = fs.appendFileSync;
  try {
    const tel = {
      _usageCacheFile: path.join(tmpDir, 'usage-cache.json'),
      _usageDiskCache: new Map(),
      _usageCacheDirty: false,
      _usageCacheTimer: null,
    };
    const mkRec = (outTok) => ({
      cascadeId: CID_1,
      stepCount: 8,
      lastModifiedSec: 1763625000,
      calls: 2,
      days: { '2026-11-27': { calls: 2, total: 1000 + outTok, models: { gemini: { input: 1000, output: outTok } } } },
    });
    putUsageDiskCache(tel, CID_1, 8, 1763625000, mkRec(500), 'local');
    tel._usageCacheDirty = false;
    if (tel._usageCacheTimer) { clearTimeout(tel._usageCacheTimer); tel._usageCacheTimer = null; }

    let stringifyCalls = 0;
    JSON.stringify = (...args) => { stringifyCalls += 1; return origStringify(...args); };
    // Identical cloned record -> 0 JSON.stringify, stays clean
    putUsageDiskCache(tel, CID_1, 8, 1763625000, mkRec(500), 'local');
    assert.equal(stringifyCalls, 0, 'putUsageDiskCache equal check must use 0 JSON.stringify calls');
    assert.equal(tel._usageCacheDirty, false);

    // Deep nested change (same total by shifting input/output) -> detected accurately with 0 JSON.stringify
    const deepChanged = mkRec(500);
    deepChanged.days['2026-11-27'].models.gemini.output = 501;
    deepChanged.days['2026-11-27'].models.gemini.input = 999;
    putUsageDiskCache(tel, CID_1, 8, 1763625000, deepChanged, 'local');
    assert.equal(stringifyCalls, 0, 'Deep nested record diff must still use 0 JSON.stringify calls');
    assert.equal(tel._usageCacheDirty, true, 'Deep nested token change must never be dropped');
    if (tel._usageCacheTimer) { clearTimeout(tel._usageCacheTimer); tel._usageCacheTimer = null; }
    JSON.stringify = origStringify;

    // 7b. DaemonLogger non-burst steady-state logs use async buffered flush (0 appendFileSync), error/flush still sync-safe
    const logFile = path.join(tmpDir, 'daemon.log');
    let appendSyncCalls = 0;
    fs.appendFileSync = (...args) => { appendSyncCalls += 1; return origAppendSync(...args); };
    const logger = new DaemonLogger({ logFile, silent: false });
    logger.log('[boot] daemon initialized'); // cold first boot line creates 0o600 file synchronously
    appendSyncCalls = 0;
    // Simulate non-burst interval (>50ms after previous log)
    await new Promise((r) => setTimeout(r, 70));
    logger.log('[i] normal non-burst heartbeat 1');
    await new Promise((r) => setTimeout(r, 70));
    logger.log('[i] normal non-burst heartbeat 2');
    assert.equal(appendSyncCalls, 0, 'Steady-state non-burst routine logs must use async buffer (0 fs.appendFileSync)');
    await logger.flushAsync();
    const afterAsync = fs.readFileSync(logFile, 'utf8');
    assert.ok(afterAsync.includes('normal non-burst heartbeat 1'));
    assert.ok(afterAsync.includes('normal non-burst heartbeat 2'));

    logger.log('[i] buffered before exit');
    assert.equal(appendSyncCalls, 0);
    logger.flush(); // simulates process.once('exit') sync fallback
    assert.equal(appendSyncCalls, 1);
    assert.ok(fs.readFileSync(logFile, 'utf8').includes('buffered before exit'));

    logger.log('[!] fatal crash line');
    assert.equal(appendSyncCalls, 2, 'Error/fatal log must flush synchronously to preserve crash diagnostics');
    assert.ok(fs.readFileSync(logFile, 'utf8').includes('fatal crash line'));
    fs.appendFileSync = origAppendSync;

    // 7c. RpcDispatcher translate-stream 72ms frame coalescing
    const chunkExprs = [];
    const entry = {
      mainFrameId: 'F1',
      hasFrameTree: true,
      contextFrames: new Map([[1, { isDefault: true, type: 'default', frameId: 'F1' }]]),
      session: {
        closed: false,
        async send(method, params) {
          if (method === 'Runtime.evaluate') chunkExprs.push(params.expression);
          return {};
        },
      },
    };
    const dispatcher = new RpcDispatcher({
      channelOrchestrator: {
        async ensureThoughtService() {
          return {
            async translateThought({ onPartial }) {
              const tokens = ['A', 'AB', 'ABC', 'ABCD', 'ABCDE', 'ABCDEF', 'ABCDEFG', 'ABCDEFGH'];
              for (const tok of tokens) {
                onPartial(tok);
                await new Promise((r) => setTimeout(r, 6));
              }
              await new Promise((r) => setTimeout(r, 90));
              onPartial('ABCDEFGHIJ');
              await new Promise((r) => setTimeout(r, 20));
              return { ok: true, translated: 'ABCDEFGHIJ' };
            },
          };
        },
      },
    });
    await dispatcher.handleBindingCall(entry, {
      name: '__agPrismThoughtCall',
      payload: JSON.stringify({ id: 7, action: 'translate-stream', input: { text: 'hello' } }),
      executionContextId: 1,
    });
    const onChunkExprs = chunkExprs.filter((e) => e.includes('__agPrismThoughtOnChunk'));
    assert.ok(onChunkExprs.length >= 2 && onChunkExprs.length <= 4, `Expected 72ms coalescing to compress 9 partials into 2..4 CDP frames, got ${onChunkExprs.length}`);
    // Reconstruct streamed text from delta frames
    let acc = '';
    for (const expr of onChunkExprs) {
      vm.runInNewContext(expr, {
        window: {
          __agPrismThoughtOnChunk(_id, frame) {
            if (typeof frame === 'string') acc = frame;
            else if (frame && typeof frame.a === 'string') acc = acc.slice(0, frame.o) + frame.a;
          },
        },
      });
    }
    assert.ok(acc.startsWith('A') && acc.length >= 8, `Coalesced delta frames must preserve ordered content, got "${acc}"`);
  } finally {
    JSON.stringify = origStringify;
    fs.appendFileSync = origAppendSync;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
