// Obsidian Prism DOM 观察总线、三档调度器、零回流观察与双拍 Batcher
(function (root, factory) {
  const api = factory(root);
  const bind = (t) => { if (t) { t.__agPrismDomBus = t.__agDomBus = api; t.__agPrismPerfCaps = api.getPerfCaps; } };
  bind(root);
  if (typeof window !== 'undefined' && window !== root) bind(window);
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function (G) {
  'use strict';
  const BUSY_ATTR = 'data-ag-perf-busy', PERF_MODE_ATTR = 'data-ag-cs-perf-mode', STREAM_ATTR = 'data-ag-cs-stream-active';
  const PERF_CHANGE_EVENT = 'ag-prism-perf-mode-change', CV_EV = 'contentvisibilityautostatechange', BM_EV = 'beforematch';
  const PASSIVE_CAP = Object.freeze({ capture: true, passive: true }), PASSIVE_OPT = Object.freeze({ passive: true });
  const OFF_P = 'html[data-ag-cs-style][data-ag-cs-motion="off"] :is(';
  const OFF_PS = '[data-testid="status-loading-spinner"],[data-testid="input-cancel-button"],[data-ag-cs-row-running="1"],[data-ag-sub-running="1"],[data-ag-overview-running="1"],[data-ag-sp-running="1"],[data-ag-cs-caustic="1"],[data-ag-cs-fiber-camp],[data-ag-cs-thought-streaming="1"],.ag-cs-sidebar-glide-pill,.agy-scroll-bottom';
  const MOTION_OFF_SCOPED_CSS =
    OFF_P + 'button,[role="button"],[role="menuitem"],[role="option"],[role="tab"],[role="switch"],div[role="dialog"],.agy-overlay,.agy-overlay-item,.agy-fastpick,.agy-selection-pill,.agy-toast,.surface-composer-card,.agy-composer-footer,.ag-cs-home-panel,.ag-cs-ctx-menu,.ag-cs-ctx-toast,.ag-cs-model-glyph,.ag-cs-thinking-spark,.ag-cs-smooth-caret,.ag-cs-stream-chunk,.ag-cs-thought-chunk,.ag-cs-code-scan,.ag-prism-thought-chunk,.ag-cs-liftoff-veil,.ag-cs-liftoff-ring,[data-testid="conversation-row-sidebar"],[data-testid="conversation-row-history"],[data-testid="step-plan"],[data-testid="step-plan-item"],[data-testid="queued-messages-card"],[data-testid="interaction-takeover-card"],[data-ag-cs-overview-shell="1"],[data-ag-row-stagger="1"],[data-ag-cs-sonar="1"],' + OFF_PS + '),' +
    OFF_P + OFF_PS + ')::before,' + OFF_P + OFF_PS + ')::after{animation:none!important;transition:none!important}';
  const mkCap = (mode, maxFps, minFrameGapMs, maxDpr, disableHeavyBlur, lowPriorityThrottleMs, chunkBudgetMs) =>
    Object.freeze({ mode, maxFps, minFrameGapMs, maxDpr, disableHeavyBlur, lowPriorityThrottleMs, chunkBudgetMs });
  const PERF_CAPS_TABLE = Object.freeze({
    performance: mkCap('performance', 60, 14.5, 1, true, 200, 2.5),
    balanced: mkCap('balanced', 180, 0, 1.5, false, 180, 3.5),
    quality: mkCap('quality', 0, 0, 2, false, 160, 4.5),
  });
  const SW_RE = /swiftshader|llvmpipe|softpipe|microsoft basic render|software rasterizer|mesa offscreen/i;
  const PM_RE = /^(?:performance|eco|balanced|quality)$/;
  const isF = (v) => typeof v === 'function', isS = (v) => typeof v === 'string', isN = (v) => typeof v === 'number';
  const isO = (v) => !!(v && typeof v === 'object'), isA = Array.isArray, isFin = Number.isFinite;
  const T = (f) => { try { return f(); } catch {} }, noop = () => {}, trimL = (v) => (isS(v) ? v.trim().toLowerCase() : '');
  const clrT = (t) => { if (t) clearTimeout(t); return 0; };
  const normPm = (raw) => {
    const l = trimL(raw);
    return l === 'performance' || l === 'eco' ? 'performance' : l === 'quality' ? 'quality' : 'balanced';
  };
  const readHw = (env) => {
    const s = isO(env) ? env : null, nav = s?.navigator || (s ? null : (typeof navigator !== 'undefined' ? navigator : G?.navigator || null));
    const r = isS(s?.renderer) ? s.renderer : isS(s?.glRenderer) ? s.glRenderer : '';
    const num = (v) => (v == null || v === '' ? NaN : +v);
    return { sw: !!(r && SW_RE.test(r)), mem: num(s && 'deviceMemory' in s ? s.deviceMemory : nav?.deviceMemory), cores: num(s && 'hardwareConcurrency' in s ? s.hardwareConcurrency : nav?.hardwareConcurrency) };
  };
  const posLe = (v, m) => isFin(v) && v > 0 && v <= m;
  const isLowHw = (h) => h.sw || posLe(h.mem, 4) || (posLe(h.cores, 4) && !(isFin(h.mem) && h.mem >= 8));
  const isLowEnd = (env) => isLowHw(readHw(env));
  function resEffPm(rawMode, opts) {
    const o = isO(opts) ? opts : {};
    if (o.explicit === true) return normPm(rawMode);
    if (isS(o.savedMode) && o.savedMode.trim() && o.forceAuto !== true) return normPm(o.savedMode);
    const l = trimL(rawMode);
    if ((!l || l === 'auto' || l === 'balanced') && isLowEnd(o.env !== undefined ? o.env : o.win?.navigator ? { navigator: o.win.navigator } : undefined)) return 'performance';
    return normPm(rawMode);
  }
  const normPri = (p) => (p === 'user-blocking' || p === 'background' ? p : 'user-visible');
  const nowMs = () => (typeof performance !== 'undefined' && performance?.now ? performance.now() : Date.now());
  function rdBox(entry) {
    if (!entry) return null;
    for (const k of ['borderBoxSize', 'contentBoxSize']) {
      const bx = isA(entry[k]) ? entry[k][0] : entry[k];
      if (bx && isFin(bx.inlineSize) && isFin(bx.blockSize)) return { width: bx.inlineSize, height: bx.blockSize, source: k, entry };
    }
    const cr = entry.contentRect;
    return cr && isFin(cr.width) && isFin(cr.height) ? { width: cr.width, height: cr.height, source: 'contentRect', entry } : null;
  }

  function createDomBus(envDoc, envWin) {
    let bDoc = envDoc || null, bWin = envWin || null, subSeq = 0;
    const subs = new Map(), mQ = new Map(), wQ = new Map(), tasks = new Map(), szCbs = new Map(), vMap = new Map(), ioPools = new Map();
    const slots = [0, 1, 1].map((f) => ({ m: null, t: null, k: '', cb: (r) => dispatchMo(r, !!f) }));
    let szCache = new WeakMap(), skEls = new WeakSet(), ioSkEls = new WeakSet();
    let szRo = null, dvOn = false, dvTgt = null, lastVEv = null;
    let bSeq = 0, tSeq = 0, bSched = false, bRaf = 0, bTmr = 0, bFlush = false;
    let scBusy = false, scTmr = 0, stBusy = false, mUntil = 0, mTmr = 0;
    let lsOn = false, curPerf = '', chkEp = 0, mc = null;
    const mcQ = [];

    const getDoc = (o) => o || bDoc || (typeof document !== 'undefined' ? document : null);
    const getWin = (o, d) => o || bWin || d?.defaultView || (typeof window !== 'undefined' ? window : G);
    const getHtml = (o) => getDoc(o)?.documentElement || null;
    const gFn = (k, w) => { const win = w || getWin(); return (isF(win?.[k]) && win[k]) || (isF(G?.[k]) && G[k]) || null; };
    const setA = (h, k, v) => h && T(() => { if (v === null) { if (isF(h.removeAttribute) && (!isF(h.hasAttribute) || h.hasAttribute(k))) h.removeAttribute(k); } else if (isF(h.setAttribute) && (!isF(h.getAttribute) || h.getAttribute(k) !== v)) h.setAttribute(k, v); });
    const rmA = (h, k) => setA(h, k, null);
    const cancelBRaf = (wo) => { if (!bRaf) return; T(() => gFn('cancelAnimationFrame', getWin(wo))?.(bRaf)); bRaf = 0; };
    const evPair = (tg, add, e1, f1, e2, f2, opt) => {
      const m = add ? 'addEventListener' : 'removeEventListener';
      if (!isF(tg?.[m])) return false;
      return !!T(() => { tg[m](e1, f1, opt); tg[m](e2, f2, opt); return true; });
    };

    const parseA = (a1, a2, a3, strObj) => {
      if (isF(a1)) return ['', a1, isO(a2) ? a2 : {}];
      if (strObj && isO(a1) && isF(a2)) return ['', a2, a1];
      return [isS(a1) ? a1 : String(a1 || ''), a2, isO(a3) ? a3 : {}];
    };
    const isStr = (o) => stBusy || getHtml(o)?.getAttribute?.(STREAM_ATTR) === '1';
    function bumpSc(ms) { scBusy = true; scTmr = clrT(scTmr); scTmr = setTimeout(() => { scTmr = 0; scBusy = false; }, isN(ms) && ms >= 0 ? ms : 200); }
    const onScroll = () => bumpSc(200);
    function toggleLs(on, dO, wO) {
      if (on) { if (dO) bDoc = dO; if (wO) bWin = wO; }
      if (on === lsOn) return;
      const d = getDoc(), w = getWin(null, d), tg = isF(w?.[on ? 'addEventListener' : 'removeEventListener']) ? w : d;
      if (evPair(tg, on, 'scroll', onScroll, 'wheel', onScroll, PASSIVE_CAP)) lsOn = on;
      else if (!on) lsOn = false;
    }
    const att = (d, w) => { toggleLs(true, d, w); attachDv(d); };
    const detach = () => { toggleLs(false); detachDv(); };
    const setStr = (a) => { stBusy = !!a; };
    function bumpB(ms) {
      const d = isN(ms) && ms > 0 ? ms : 200, u = nowMs() + d;
      if (u > mUntil) mUntil = u;
      mTmr = clrT(mTmr);
      mTmr = setTimeout(() => { mTmr = 0; if (nowMs() >= mUntil) mUntil = 0; }, d + 4);
    }
    const isBsy = () => scBusy || isStr() || mUntil > nowMs();

    function calcMoOpts(isRa, bodyOnly) {
      let cL = 0, sb = 0, at = 0, cd = 0, allF = 1, cnt = 0;
      const as = new Set();
      for (const s of subs.values()) {
        if (s.ra !== isRa || (bodyOnly && !s.wB)) continue;
        cnt++;
        const o = s.o;
        if (!isRa) { cL |= o.childList !== false; sb |= o.subtree !== false; cd |= !!o.characterData; }
        if (o.attributes) {
          at = 1;
          if (isA(o.attributeFilter) && o.attributeFilter.length) for (const a of o.attributeFilter) as.add(a);
          else allF = 0;
        }
      }
      if (!cnt) return null;
      const m = { childList: !!cL, subtree: !!sb };
      if (at) { m.attributes = true; if (allF && as.size) m.attributeFilter = [...as].sort(); }
      if (cd) m.characterData = true;
      return m;
    }
    function matchRec(s, m) {
      if (!m) return false;
      const t = m.type;
      if (t === 'childList' ? !s.wC : t === 'characterData' ? !s.wD : t === 'attributes' && (!s.wA || (s.aS && m.attributeName && !s.aS.has(m.attributeName)))) return false;
      if (s.rO && m.target) {
        const rt = s.ra ? slots[1].t : slots[0].t;
        if (rt && m.target !== rt && !(s.wB && slots[2].t && m.target === slots[2].t)) return false;
      }
      return s.f ? !!s.f(m) : true;
    }
    function flushSub(s) {
      s.tm = clrT(s.tm);
      if (!s.q.length) return;
      const b = s.q.splice(0, s.q.length);
      s.at = nowMs();
      T(() => s.h(b));
    }
    function dispatchMo(muts, isRa) {
      if (!muts?.length || !subs.size) return;
      const hi = isStr() || scBusy, caps = gCaps(), now = nowMs();
      for (const s of subs.values()) {
        if (isRa !== undefined && s.ra !== isRa) continue;
        let hit = null;
        if (s.pa) hit = muts;
        else for (const m of muts) if (matchRec(s, m)) (hit || (hit = [])).push(m);
        if (!hit?.length) continue;
        if (s.p === 'low' && (hi || s.th > 0)) {
          const wMs = hi ? Math.max(s.th || 0, caps.lowPriorityThrottleMs || 180) : s.th;
          s.q.push(...hit);
          const el = now - s.at;
          if (el >= wMs && !s.tm) flushSub(s);
          else if (!s.tm) s.tm = setTimeout(() => flushSub(s), Math.max(16, wMs - el));
        } else if (s.q.length) { s.q.push(...hit); flushSub(s); }
        else { s.at = now; T(() => s.h(hit)); }
      }
    }
    const takeAll = (disp, max = 3) => {
      let out = [];
      for (let i = 0; i < max; i++) {
        const m = slots[i].m, r = isF(m?.takeRecords) ? T(() => m.takeRecords()) : null;
        if (r?.length) { if (disp) dispatchMo(r, i > 0); out = out.length ? out.concat(r) : r; }
      }
      return out;
    };
    // 仅丢弃全子树 rootMo (slots[0])，保留 <html>/<body> 根属性通知通道
    const drainM = () => takeAll(1), discardM = () => takeAll(0, 1);
    const dropSl = (sl) => { if (sl.m) { T(() => sl.m.disconnect()); sl.m = null; } sl.t = null; sl.k = ''; };
    function syncSl(sl, tg, opts, MO) {
      if (!opts || !tg) return dropSl(sl);
      const k = JSON.stringify(opts);
      if (sl.m && sl.t === tg && sl.k === k) return;
      if (sl.m) T(() => sl.m.disconnect());
      sl.m = new MO(sl.cb); sl.t = tg; sl.k = k;
      T(() => sl.m.observe(tg, opts));
    }
    function reconcileMo() {
      if (!subs.size) { for (let i = 0; i < 3; i++) dropSl(slots[i]); return; }
      const d = getDoc(), w = getWin(null, d), tg = getHtml(d) || d?.body || null, MO = gFn('MutationObserver', w);
      if (!tg || !MO) return;
      syncSl(slots[0], tg, calcMoOpts(false, false), MO);
      syncSl(slots[1], tg, calcMoOpts(true, false), MO);
      syncSl(slots[2], d?.body && d.body !== tg ? d.body : null, calcMoOpts(true, true), MO);
    }
    function sub(a1, a2, a3) {
      let [id, h, o] = parseA(a1, a2, a3, 1);
      if (!isF(h)) return noop;
      id = id || o.id || 'sub-' + ++subSeq;
      if (o.doc) bDoc = o.doc;
      if (o.win) bWin = o.win;
      const pv = subs.get(id);
      if (pv) pv.tm = clrT(pv.tm);
      const mo = isO(o.observeOptions) ? o.observeOptions : { childList: true, subtree: true, attributes: !!o.attributes, attributeFilter: o.attributeFilter };
      const wC = mo.childList !== false, wD = !!mo.characterData, wA = !!mo.attributes;
      const aS = wA && isA(mo.attributeFilter) && mo.attributeFilter.length ? new Set(mo.attributeFilter) : null;
      const rO = mo.subtree === false, ra = rO && !wC && !wD && wA, wB = !!(ra && o.observeBody), f = isF(o.filter) ? o.filter : null;
      const en = { id, h, p: o.priority === 'high' || o.priority === 'low' ? o.priority : 'normal', f, th: isN(o.throttleMs) && o.throttleMs > 0 ? o.throttleMs : 0, o: mo, wC, wD, wA, aS, rO, ra, wB, pa: !f && !rO && wC && wD && wA && !aS, q: [], tm: 0, at: 0 };
      subs.set(id, en);
      att(); reconcileMo();
      return () => { const c = subs.get(id); if (c !== en) return; c.tm = clrT(c.tm); c.q.length = 0; subs.delete(id); reconcileMo(); };
    }

    function flushBatch() {
      bSched = false; bRaf = bTmr = 0;
      if (bFlush) return;
      bFlush = true;
      try {
        for (const q of [mQ, wQ]) { const ls = [...q.values()]; q.clear(); for (const f of ls) T(f); }
      } finally { bFlush = false; if (mQ.size || wQ.size) schedBatch(); }
    }
    function schedBatch() {
      if (bSched) return;
      bSched = true;
      const raf = gFn('requestAnimationFrame');
      if (raf) bRaf = raf(flushBatch); else bTmr = setTimeout(flushBatch, 0);
    }
    const enq = (q, pf, k, fn) => { const cb = isF(k) ? k : fn; if (!isF(cb)) return; q.set(isF(k) || !k ? pf + ++bSeq : k, cb); schedBatch(); };
    const meas = (k, f) => enq(mQ, '__m_', k, f), mut = (k, f) => enq(wQ, '__w_', k, f);
    const flushN = () => { cancelBRaf(); bTmr = clrT(bTmr); flushBatch(); };

    function postMc(cb) {
      const MC = gFn('MessageChannel');
      return !!(MC && T(() => {
        if (!mc) { mc = new MC(); mc.port1.onmessage = () => { const f = mcQ.shift(); if (f) f(); }; }
        mcQ.push(cb); mc.port2.postMessage(null); return true;
      }));
    }
    function ySlice() {
      const sc = getWin()?.scheduler || (typeof scheduler !== 'undefined' ? scheduler : null);
      if (isF(sc?.yield)) { const p = T(() => sc.yield()); if (p) return p; }
      return new Promise((r) => { if (!postMc(r)) setTimeout(r, 0); });
    }

    function clrFb(r) {
      r.t = clrT(r.t);
      if (r.i) { T(() => gFn('cancelIdleCallback')?.(r.i)); r.i = 0; }
      r.g++;
    }
    const finT = (r) => { if (tasks.get(r.k) === r) tasks.delete(r.k); r.d = true; };
    const isAb = (r) => !!(r.x || r.d || r.c?.signal?.aborted);
    function runFb(r) {
      if (isAb(r)) { finT(r); r.rs(undefined); return; }
      finT(r);
      try { r.rs(r.f()); } catch (e) { r.rj(e); }
    }
    function armFb(r, ms) {
      clrFb(r);
      if (r.x || r.d) return;
      const setT = (fn, d) => { r.t = setTimeout(() => { r.t = 0; fn(); }, d); r.t?.unref?.(); };
      if (ms > 0) { setT(() => armFb(r, 0), ms); return; }
      const g = r.g;
      if (r.p === 'user-blocking') { if (!postMc(() => { if (r.g === g) runFb(r); })) setT(() => runFb(r), 0); }
      else if (r.p === 'background') {
        const ric = gFn('requestIdleCallback');
        if (ric && T(() => { r.i = ric(() => { r.i = 0; runFb(r); }, { timeout: 250 }); return true; })) return;
        setT(() => runFb(r), 16);
      } else setT(() => runFb(r), 0);
    }
    function cTask(k) {
      const r = tasks.get(k);
      if (!r) return false;
      r.x = true; finT(r); clrFb(r);
      T(() => r.c?.abort?.()); T(() => r.rs?.(undefined));
      return true;
    }
    function cGrp(pf) {
      if (!isS(pf) || !pf) return 0;
      const ks = [];
      for (const k of tasks.keys()) if (k === pf || k.startsWith(pf)) ks.push(k);
      for (const k of ks) cTask(k);
      return ks.length;
    }
    function repriTask(k, np) {
      const r = tasks.get(k);
      if (!r || r.x || r.d) return false;
      const nm = normPri(np); r.p = nm;
      if (isF(r.c?.setPriority) && T(() => { r.c.setPriority(nm); return true; })) return true;
      if (r.m === 'fb') { armFb(r, 0); return true; }
      return false;
    }
    function schTask(a1, a2, a3) {
      let [k, f, o] = parseA(a1, a2, a3, 0);
      if (!isF(f)) return Promise.resolve(undefined);
      k = k || 'task-' + ++tSeq;
      cTask(k);
      const p = normPri(o.priority), dl = isN(o.delay) && o.delay > 0 ? o.delay : 0;
      const w = getWin(), sc = w?.scheduler || (typeof scheduler !== 'undefined' ? scheduler : null);
      const TC = gFn('TaskController', w), AC = gFn('AbortController', w);
      let rs, rj;
      const pr = new Promise((a, b) => { rs = a; rj = b; });
      const r = { k, f, p, x: false, d: false, m: 'fb', c: null, t: 0, i: 0, g: 0, rs, rj };
      tasks.set(k, r);
      const bind = () => { pr.cancel = () => cTask(k); pr.reprioritize = (np) => repriTask(k, np); return pr; };
      if (isF(sc?.postTask)) {
        const ok = T(() => {
          r.m = 'nt';
          const po = dl > 0 ? { delay: dl } : {};
          if (TC) { r.c = new TC({ priority: p }); po.signal = r.c.signal; }
          else { po.priority = p; if (AC) { r.c = new AC(); po.signal = r.c.signal; } }
          Promise.resolve(sc.postTask(() => { if (isAb(r)) { finT(r); return undefined; } finT(r); return r.f(); }, po)).then(
            (v) => { finT(r); rs(v); },
            (e) => { finT(r); if (isAb(r) || e?.name === 'AbortError') rs(undefined); else rj(e); }
          );
          return true;
        });
        if (ok) return bind();
        r.m = 'fb';
      }
      r.c = AC ? new AC() : { signal: { aborted: false }, abort() { this.signal.aborted = true; } };
      armFb(r, dl);
      return bind();
    }
    async function runChk(items, fn, o) {
      const ls = items ? (isA(items) ? items : [...items]) : [];
      if (!ls.length || !isF(fn)) return { processed: 0, slices: 0, aborted: false };
      const cfg = isO(o) ? o : {}, bud = isN(cfg.budgetMs) && cfg.budgetMs > 0 ? cfg.budgetMs : gCaps().chunkBudgetMs || 3.5;
      const sig = cfg.signal || null, ep = chkEp;
      let processed = 0, slices = 1, st = nowMs();
      for (let i = 0; i < ls.length; i++) {
        if (ep !== chkEp || sig?.aborted) return { processed, slices, aborted: true };
        fn(ls[i], i); processed++;
        if (i + 1 < ls.length && nowMs() - st >= bud) {
          await ySlice();
          if (ep !== chkEp || sig?.aborted) return { processed, slices, aborted: true };
          slices++; st = nowMs();
        }
      }
      return { processed, slices, aborted: false };
    }

    function ensureRo() {
      if (szRo) return szRo;
      const RO = gFn('ResizeObserver');
      if (!RO) return null;
      szRo = T(() => new RO((es) => {
        for (const en of es || []) {
          const el = en?.target, sz = el ? rdBox(en) : null;
          if (!sz) continue;
          szCache.set(el, sz);
          const st = szCbs.get(el);
          if (st) for (const cb of st) T(() => cb(sz, en));
        }
      })) || null;
      return szRo;
    }
    function obsSz(el, cb) {
      if (!el || !isF(cb)) return noop;
      let st = szCbs.get(el); const nw = !st;
      if (!st) { st = new Set(); szCbs.set(el, st); }
      st.add(cb);
      if (nw) T(() => ensureRo()?.observe(el));
      return () => {
        const c = szCbs.get(el);
        if (!c) return;
        c.delete(cb);
        if (!c.size) {
          szCbs.delete(el);
          if (szRo) { T(() => szRo.unobserve(el)); if (!szCbs.size) { T(() => szRo.disconnect()); szRo = null; } }
        }
      };
    }
    const getSz = (el) => (el ? szCache.get(el) || null : null);

    function emitVis(el, vis, source, detail) {
      const r = vMap.get(el);
      if (!r?.cbs.size) return;
      const v = !!vis, info = { visible: v, skipped: !v, isIntersecting: v, source, detail };
      for (const cb of r.cbs) T(() => cb(info));
    }
    const handleVis = (ev, bm) => {
      if (ev && ev === lastVEv) return;
      lastVEv = ev || null;
      const t = ev?.target;
      if (!t || (t.nodeType !== undefined && t.nodeType !== 1)) return;
      if (bm) { skEls.delete(t); ioSkEls.delete(t); emitVis(t, true, BM_EV, ev); }
      else { const sk = !!ev.skipped; if (sk) skEls.add(t); else skEls.delete(t); emitVis(t, !sk, 'content-visibility', ev); }
    };
    const onCv = (ev) => handleVis(ev, 0), onBm = (ev) => handleVis(ev, 1);
    function toggleDv(on, dO) {
      if (on === dvOn) return;
      const d = on ? getDoc(dO) : dvTgt || getDoc();
      if (evPair(d, on, CV_EV, onCv, BM_EV, onBm, PASSIVE_CAP)) { dvOn = on; dvTgt = on ? d : null; }
      else if (!on) { dvOn = false; dvTgt = null; }
    }
    const attachDv = (dO) => toggleDv(true, dO), detachDv = () => toggleDv(false);
    function ensureIo(rm) {
      const k = isS(rm) && rm ? rm : '250px 0px';
      let pl = ioPools.get(k);
      if (pl) return pl;
      const IO = gFn('IntersectionObserver');
      if (!IO) return null;
      return T(() => {
        const io = new IO((es) => {
          for (const en of es || []) {
            const t = en?.target;
            if (!t) continue;
            if (en.isIntersecting) ioSkEls.delete(t); else ioSkEls.add(t);
            emitVis(t, !!en.isIntersecting && !skEls.has(t), 'io', en);
          }
        }, { rootMargin: k });
        pl = { io, els: new Set(), k }; ioPools.set(k, pl); return pl;
      }) || null;
    }
    function obsVis(el, cb, o) {
      if (!el || !isF(cb)) return noop;
      const cfg = isO(o) ? o : {};
      attachDv(cfg.doc);
      let r = vMap.get(el);
      if (!r) {
        let u = null;
        const eCv = (e) => onCv(e?.target ? e : { target: el, skipped: !!e?.skipped });
        const eBm = (e) => onBm(e?.target ? e : { target: el });
        if (evPair(el, true, CV_EV, eCv, BM_EV, eBm, PASSIVE_OPT)) u = () => evPair(el, false, CV_EV, eCv, BM_EV, eBm, PASSIVE_OPT);
        let pl = null;
        if (cfg.io !== false) { pl = ensureIo(cfg.rootMargin); if (pl && !T(() => { pl.io.observe(el); pl.els.add(el); return true; })) pl = null; }
        r = { cbs: new Set(), u, pl }; vMap.set(el, r);
      }
      r.cbs.add(cb);
      return () => {
        const c = vMap.get(el);
        if (!c) return;
        c.cbs.delete(cb);
        if (!c.cbs.size) {
          vMap.delete(el);
          if (c.u) T(c.u);
          if (c.pl) {
            T(() => c.pl.io.unobserve(el));
            c.pl.els.delete(el);
            if (!c.pl.els.size) { T(() => c.pl.io.disconnect()); ioPools.delete(c.pl.k); }
          }
          ioSkEls.delete(el);
        }
      };
    }
    function obsVpVis(el, cb, o) {
      if (!el || !isF(cb)) return noop;
      const c = isO(o) ? o : {};
      let pv = null;
      return obsVis(el, (i) => { const v = !!i?.visible; if (v !== pv) cb(pv = v, i); }, { doc: c.doc, io: true, rootMargin: (isS(c.rootMargin) && c.rootMargin) || '0px' });
    }
    function isSk(el) {
      if (!el) return false;
      if (ioSkEls.has(el) || skEls.has(el)) return true;
      for (let c = el.parentElement, n = 0; c && n < 12; c = c.parentElement, n++) if (skEls.has(c)) return true;
      return false;
    }

    function applyPm(mode, dO, wO) {
      const nm = normPm(mode), d = getDoc(dO), w = getWin(wO, d), h = getHtml(d);
      const pv = curPerf || h?.getAttribute?.(PERF_MODE_ATTR) || '';
      curPerf = nm;
      if (h) { setA(h, PERF_MODE_ATTR, nm); T(() => { if (h.dataset && h.dataset.agCsPerfMode !== nm) h.dataset.agCsPerfMode = nm; }); }
      if (pv && pv !== nm && isF(w?.dispatchEvent)) T(() => {
        const CE = gFn('CustomEvent', w), detail = { mode: nm, caps: PERF_CAPS_TABLE[nm] };
        w.dispatchEvent(CE ? new CE(PERF_CHANGE_EVENT, { detail }) : { type: PERF_CHANGE_EVENT, detail });
      });
      return nm;
    }
    function gCaps(mO, dO) {
      if (isS(mO) && mO) return PERF_CAPS_TABLE[normPm(mO)];
      const h = getHtml(dO), raw = (h && T(() => h.dataset?.agCsPerfMode || h.getAttribute?.(PERF_MODE_ATTR))) || '';
      return PERF_CAPS_TABLE[normPm(raw || curPerf || 'balanced')];
    }
    function gDprCap(baseCap, envOrDoc) {
      const isD = isO(envOrDoc) && !!envOrDoc.documentElement, env = isD ? undefined : envOrDoc;
      const caps = gCaps(null, isD ? envOrDoc : null), b = isFin(+baseCap) && +baseCap > 0 ? +baseCap : caps.maxDpr || 1.5;
      if (caps.mode === 'performance') return Math.min(b, 1);
      const hw = readHw(env);
      if (!isLowHw(hw)) return b;
      return Math.min(b, hw.sw || posLe(hw.mem, 2) ? 1 : 1.25);
    }
    function resAutoPm(cfg, wO) {
      if (!isO(cfg)) return null;
      const tag = cfg.__pmAuto ?? (cfg.perfModeAuto === true ? 1 : cfg.perfModeExplicit === true ? 0 : cfg.__uiSlice?.pmAuto);
      delete cfg.__pmAuto; delete cfg.perfModeAuto; delete cfg.perfModeExplicit;
      if (!tag) return cfg.performanceMode;
      const w = getWin(wO), forceAuto = tag === 2;
      const savedMode = forceAuto ? '' : (T(() => {
        const s = (w?.localStorage || (typeof localStorage !== 'undefined' ? localStorage : null))?.getItem?.('ag-prism:config');
        const v = s ? trimL(JSON.parse(s)?.performanceMode) : '';
        return PM_RE.test(v) ? v : '';
      }) || '');
      return (cfg.performanceMode = resEffPm(cfg.performanceMode, { explicit: false, forceAuto, savedMode, env: w?.navigator ? { navigator: w.navigator } : undefined }));
    }

    function dispose(dO, wO) {
      chkEp++;
      for (const k of [...tasks.keys()]) cTask(k);
      for (const s of subs.values()) { s.tm = clrT(s.tm); s.q.length = 0; }
      subs.clear();
      for (let i = 0; i < 3; i++) dropSl(slots[i]);
      if (szRo) { T(() => szRo.disconnect()); szRo = null; }
      szCbs.clear(); szCache = new WeakMap();
      for (const r of vMap.values()) if (r.u) T(r.u);
      vMap.clear();
      for (const pl of ioPools.values()) { T(() => pl.io.disconnect()); pl.els.clear(); }
      ioPools.clear();
      skEls = new WeakSet(); ioSkEls = new WeakSet(); lastVEv = null;
      cancelBRaf(wO);
      bTmr = clrT(bTmr); scTmr = clrT(scTmr); mTmr = clrT(mTmr);
      bSched = scBusy = stBusy = false; mUntil = 0; curPerf = '';
      mQ.clear(); wQ.clear();
      detach();
      while (mcQ.length) T(() => mcQ.shift()());
      if (mc) { T(() => { mc.port1.onmessage = null; mc.port1.close?.(); mc.port2.close?.(); }); mc = null; }
      const h = getHtml(dO);
      if (h) { rmA(h, BUSY_ATTR); rmA(h, PERF_MODE_ATTR); T(() => { if (h.dataset) delete h.dataset.agCsPerfMode; }); }
    }

    return {
      BUSY_ATTR, PERF_MODE_ATTR, STREAM_ATTR, MOTION_OFF_SCOPED_CSS, PERF_CAPS_TABLE,
      attach: att, subscribe: sub, drainMutations: drainM, discardMutations: discardM, measure: meas, mutate: mut, flushNow: flushN,
      scheduleTask: schTask, cancelTask: cTask, cancelGroup: cGrp, reprioritizeTask: repriTask, yieldSlice: ySlice, runChunked: runChk,
      observeSize: obsSz, getSize: getSz, readBoxSize: rdBox, observeVisibility: obsVis, observeViewportVisibility: obsVpVis, isSkipped: isSk,
      setStreaming: setStr, bumpBusy: bumpB, bumpScrollBusy: bumpSc, isBusy: isBsy, isPerfBusy: isBsy, isStreaming: isStr,
      detectLowEndHardware: isLowEnd, resolveEffectivePerformanceMode: resEffPm, resolveAutoBootPerfMode: resAutoPm, getAdaptiveDprCap: gDprCap,
      normalizePerformanceMode: normPm, applyPerformanceMode: applyPm, getPerfCaps: gCaps,
      getDebugState: () => ({
        subscriberCount: subs.size, observing: !!(slots[0].m || slots[1].m || slots[2].m), listenersAttached: lsOn,
        scrollBusy: scBusy, streamBusy: stBusy, busy: isBsy(), perfMode: gCaps().mode,
        pendingMeasures: mQ.size, pendingMutates: wQ.size, pendingTasks: tasks.size,
        sizeObservedCount: szCbs.size, visibilityObservedCount: vMap.size,
      }),
      dispose, destroy: dispose, createInstance: createDomBus,
    };
  }
  return createDomBus(null, null);
});
