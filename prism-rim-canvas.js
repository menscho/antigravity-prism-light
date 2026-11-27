// Obsidian Prism — Zero-StyleRecalc 300Hz GPU Canvas Prism Rim & Orchestrator Rim Module (prism-rim-canvas.js)
(function (root) {
  'use strict';
  const G = root || (typeof globalThis !== 'undefined' ? globalThis : window);
  if (!G) return;

  const RIM_PALETTES = Object.fromEntries(
    (
      'default|0=rgba(255,255,255,.96)/.24=#4285F4/.5=#9B72CB/.74=#EA4335/.92=#FBBC04/1=rgba(251,188,4,0)|0=#2563EB/.32=#7C3AED/.64=#EA4335/.88=#D97706/1=rgba(217,119,6,0);' +
      'warm|0=rgba(255,246,238,.95)/.26=#F6BD60/.54=#F0A37E/.82=#D97757/1=rgba(217,119,87,0)|0=#9A3412/.34=#C25934/.68=#D97757/.9=#D97706/1=rgba(217,119,6,0);' +
      'cobalt|0=rgba(240,249,255,.96)/.26=#7CE2FF/.56=#4285F4/.86=#1B49B2/1=rgba(27,73,178,0)|0=#1D4ED8/.35=#2563EB/.7=#0284C7/.92=#38BDF8/1=rgba(56,189,248,0);' +
      'iris|0=rgba(245,243,255,.95)/.26=#DDD6FE/.56=#A58AF8/.86=#6D28D9/1=rgba(109,40,217,0)|0=#5B21B6/.36=#7C3AED/.7=#8B5CF6/.92=#A855F7/1=rgba(168,85,247,0);' +
      'amber|0=rgba(255,251,235,.95)/.26=#FDE68A/.56=#F2B84B/.86=#D97706/1=rgba(217,119,6,0)|0=#92400E/.36=#B45309/.7=#D97706/.92=#F59E0B/1=rgba(245,158,11,0);' +
      'mono|0=rgba(248,250,252,.92)/.28=#E2E8F0/.6=#94A3B8/.88=#64748B/1=rgba(100,116,139,0)|0=#1E293B/.36=#334155/.7=#64748B/.92=#94A3B8/1=rgba(148,163,184,0)'
    )
      .split(';')
      .map((b) => {
        const [k, d, l] = b.split('|');
        const p = (x) => x.split('/').map((t) => { const [u, v] = t.split('='); return [+u, v]; });
        return [k, { dark: p(d), light: p(l) }];
      })
  );

  const isFn = (v) => typeof v === 'function', mn = Math.min, mx = Math.max, T = (f) => { try { return f(); } catch {} };
  const ga = (e, k) => e?.getAttribute?.(k);
  const ra = (e, k) => e?.removeAttribute?.(k);
  const dis = (e) => !e || e.isConnected === false;
  const addS = (g, a) => { for (let i = 0; i < a.length; i += 2) g.addColorStop(a[i], a[i + 1]); return g; };
  const palS = (g, tk, dk) => { for (const [o, c] of (RIM_PALETTES[tk] || RIM_PALETTES.default)[dk ? 'dark' : 'light']) g.addColorStop(o, c); return g; };
  const rg = (rgb, a) => `rgba(${rgb},${a.toFixed(4)})`;
  const fillRad = (ctx, cx, cy, r, w, h, st) => {
    const x0 = cx > r ? (cx - r) | 0 : 0, y0 = cy > r ? (cy - r) | 0 : 0;
    const x1 = mn(w, Math.ceil(cx + r)), y1 = mn(h, Math.ceil(cy + r));
    if (x1 <= x0 || y1 <= y0) return;
    ctx.fillStyle = addS(ctx.createRadialGradient(cx, cy, 0, cx, cy, r), st);
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  };
  const PB = 'data-ag-cs-prism-box', PM = 'data-ag-cs-prism-mirror', CV_A = 'data-ag-cs-prism-cv', CV_C = 'ag-cs-prism-rim-cv', CV_S = '.' + CV_C;
  const CAP = { capture: true, passive: true };

  const parseAmbientScale = (r) =>
    G.__agPrismRipple?.parseAmbientScale
      ? G.__agPrismRipple.parseAmbientScale(r)
      : r == null || r === ''
      ? 1
      : mx(0, mn(1, +r > 1 ? +r / 100 : Number.isFinite(+r) ? +r : 1));

  function createPrismRimCanvasController({
    isDestroyed, isDarkTheme, motionReduced, getMinFrameGapMs, getAmbientIntensity, getAccentTone,
    canMountRealCanvas, setAttrIfChanged, runGuardedMut, getActiveCrystalTrack, setCrystalPointerClient,
    onPointerActivity, onComposerRimUpdate,
  }) {
    const ptr = { x: -9999, y: -9999 };
    let prismRaf = 0, idleT = 0, drawAt = 0, pDirty = true, cacheAt = 0, rectAt = 0;
    let pBoxes = [], orchE = null, boxRo = null, spIoI = null, cSig = '0';
    const obsSet = new Set(), trkCvs = new Set(), spObs = new Set(), spVis = new Map(), spOn = new Set();

    const getDoc = () => (typeof document !== 'undefined' ? document : null);
    const getHtml = () => getDoc()?.documentElement || null;
    const qsa = (s) => getDoc()?.querySelectorAll?.(s) || [];
    const unobs = (o, s, e) => { if (s.has(e)) { try { o?.unobserve?.(e); } catch {} s.delete(e); } };
    const clrOffs = (m) => { for (const f of m.values()) { try { f(); } catch {} } m.clear(); };
    const zClr = (cv) => { try { const c = cv.getContext?.('2d'); if (c && cv.width > 0 && cv.height > 0) c.clearRect(0, 0, cv.width, cv.height); } catch {} };

    const emitComp = (v) => {
      if (!isFn(onComposerRimUpdate)) return;
      const on = !!(v && v.strength > 0.015);
      const sig = on ? `1|${Math.round(v.localX / 6)}|${Math.round(v.strength * 12)}|${v.toneKey}|${v.dark ? 1 : 0}` : '0';
      if (sig === cSig) return;
      cSig = sig;
      try { onComposerRimUpdate(on ? { active: true, ...v } : { active: false, localX: -9999, strength: 0, toneKey: 'default', dark: true }); } catch {}
    };

    const readAmb = () => parseAmbientScale(getAmbientIntensity ? getAmbientIntensity() : ga(getHtml(), 'data-ag-cs-ambient'));

    const toneKeyOf = (dark) => {
      const h = getHtml(), t = getAccentTone?.() || ga(h, 'data-ag-cs-accent') || 'follow';
      if (t === 'mono' || t === 'cobalt' || t === 'iris' || t === 'amber') return t;
      const p = ga(h, 'data-ag-cs-palette') || 'obsidian';
      return p === 'warm' || p === 'claude' || (!dark && p === 'obsidian' && ga(h, 'data-ag-cs-light-preset') === 'alabaster') ? 'warm' : 'default';
    };

    const rimOff = () => {
      if (motionReduced?.()) return true;
      const h = getHtml(), m = ga(h, 'data-ag-cs-motion') || '', p = ga(h, 'data-ag-cs-perf-mode') || '';
      return m === 'off' || m === 'subtle' || p === 'performance' || p === 'eco';
    };

    const isH = () => !!(getDoc()?.hidden);
    const isWB = () => isH() || ga(getHtml(), 'data-ag-cs-win-blur') === '1';
    const isRimOn = () => !rimOff() && readAmb() > 0.001;
    const ptrIn = () => ptr.x >= -1000;
    const hasLitRim = () => pBoxes.some((e) => !e.cl) || !!(orchE && !orchE.cl);
    const dragOff = () => { const h = getHtml(); return ga(h, 'data-ag-cs-resizing') === '1' || ga(h, 'data-ag-cs-mascot-drag') === '1'; };
    const canDraw = () => !isWB() && !dragOff() && isRimOn() && ptrIn();
    const wake = () => { if (canDraw()) { drawAt = 0; schedRaf(); } };
    const clrIdle = () => { if (idleT) { isFn(G.clearTimeout) && clearTimeout(idleT); idleT = 0; } };
    const zCv = (c) => { if (c && (c.width || c.height)) c.width = c.height = 0; };
    const zEnt = (e, all) => { if (e && (all || e.cl)) { e._s = ''; e._gc = null; e.cl = true; zCv(e.cv); } };
    const cGrad = (e, slot, key, build) => {
      let c = e._gc;
      if (!c) c = e._gc = Object.create(null);
      const h = c[slot];
      if (h && h.k === key) return h.g;
      const g = build();
      c[slot] = { k: key, g };
      return g;
    };

    const shrinkRims = (all) => {
      clrIdle();
      if (!all && isDestroyed()) return;
      for (const e of pBoxes) zEnt(e, all);
      zEnt(orchE, all);
      if (all) {
        emitComp(null);
        for (const c of trkCvs) zCv(c);
        qsa(CV_S).forEach?.(zCv);
      }
    };
    const armIdle = () => {
      if (isDestroyed() || typeof setTimeout !== 'function') return;
      const ok = (e) => e?.cl && e.cv && (e.cv.width > 0 || e.cv.height > 0);
      if (!ok(orchE) && !pBoxes.some(ok)) return clrIdle();
      if (!idleT) idleT = setTimeout(() => shrinkRims(0), 1800);
    };

    const clrEnt = (e) => {
      if (!e) return;
      e._s = '';
      if (e.ctx && e.cv && e.cv.width > 0 && e.cv.height > 0 && !e.cl) {
        T(() => e.ctx.clearRect(0, 0, e.cv.width, e.cv.height));
        e.cl = true;
      }
    };

    const clrAll = (immediateShrink = false) => {
      pBoxes.forEach(clrEnt);
      clrEnt(orchE);
      emitComp(null);
      qsa(CV_S).forEach?.(zClr);
      if (immediateShrink) shrinkRims(1);
      else armIdle();
    };

    const rmCv = (cv) => {
      if (!cv) return;
      trkCvs.delete(cv);
      const host = cv.parentElement;
      zClr(cv);
      zCv(cv);
      cv.remove?.();
      if (host?.hasAttribute?.(CV_A)) ra(host, CV_A);
    };

    const pruneDet = (trk) => {
      const keepBox = (b) => !dis(b) && ga(b, PB) === '1';
      if (pBoxes.length) {
        let kept = null;
        for (let i = 0; i < pBoxes.length; i++) {
          const e = pBoxes[i];
          if (e && keepBox(e.box)) { if (kept) kept.push(e); }
          else {
            if (!kept) kept = pBoxes.slice(0, i);
            if (e?.cv) rmCv(e.cv);
            if (e?.box) unobs(boxRo, obsSet, e.box);
          }
        }
        if (kept) pBoxes = kept;
      }
      if (orchE && (dis(orchE.box) || (trk && orchE.box !== trk))) {
        if (orchE.cv) rmCv(orchE.cv);
        if (orchE.box) unobs(boxRo, obsSet, orchE.box);
        orchE = null;
      }
      for (const box of Array.from(obsSet)) if (dis(box) || (ga(box, PB) !== '1' && box !== trk)) unobs(boxRo, obsSet, box);
    };

    const prOrp = (fullScan = true) => {
      const trk = getActiveCrystalTrack?.() || null;
      pruneDet(trk);
      const d = getDoc();
      if (!d || !isFn(d.querySelectorAll)) return;
      const keepHost = (h) => !dis(h) && (ga(h, PB) === '1' || (trk && h === trk));
      if (!fullScan) {
        for (const cv of Array.from(trkCvs)) if (dis(cv) || !keepHost(cv.parentElement)) rmCv(cv);
        return;
      }
      for (const cv of Array.from(trkCvs)) if (dis(cv)) trkCvs.delete(cv);
      qsa(CV_S).forEach((cv) => { if (!keepHost(cv.parentElement)) rmCv(cv); else trkCvs.add(cv); });
      qsa(`[${CV_A}]`).forEach((h) => { if (!keepHost(h) || !h.querySelector?.(CV_S)) ra(h, CV_A); });
    };

    const ensureCv = (hostEl) => {
      if (!hostEl || !canMountRealCanvas(hostEl)) return null;
      let cv = null;
      for (let c = hostEl.firstElementChild; c; c = c.nextElementSibling) if (c.classList?.contains(CV_C)) { cv = c; break; }
      if (!cv) {
        cv = document.createElement('canvas');
        cv.className = CV_C;
        cv.width = cv.height = 0;
        cv.setAttribute('aria-hidden', 'true');
        cv.setAttribute('data-ag-no-i18n', '');
        const st = cv.style;
        if (st?.setProperty) {
          for (const p of 'position:absolute|inset:0|width:100%|height:100%|pointer-events:none'.split('|')) { const [k, v] = p.split(':'); st.setProperty(k, v); }
          for (const k of ['margin', 'padding', 'border']) st.setProperty(k, '0', 'important');
        }
        hostEl.appendChild(cv);
      }
      trkCvs.add(cv);
      const ctx = isFn(cv.getContext) ? cv.getContext('2d') : null;
      if (!ctx || !isFn(ctx.createRadialGradient)) { cv.remove(); return null; }
      setAttrIfChanged(hostEl, CV_A, '1');
      return { cv, ctx };
    };

    const strokeRR = (ctx, x, y, w, h, r) => {
      ctx.beginPath();
      if (isFn(ctx.roundRect)) { ctx.roundRect(x, y, w, h, r); return; }
      const cr = mx(0, mn(r, w * 0.5, h * 0.5));
      ctx.moveTo(x + cr, y);
      ctx.arcTo(x + w, y, x + w, y + h, cr);
      ctx.arcTo(x + w, y + h, x, y + h, cr);
      ctx.arcTo(x, y + h, x, y, cr);
      ctx.arcTo(x, y, x + w, y, cr);
      ctx.closePath();
    };

    const traceGhost = (ctx, s) => {
      ctx.beginPath();
      const pts = [0, 0, 0, 13.8, 3.6, 10.5, 6.1, 15.6, 8, 14.7, 5.5, 9.6, 10.1, 9.6];
      ctx.moveTo(0, 0);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * s, pts[i + 1] * s);
      ctx.closePath();
    };

    const drawRefl = (ctx, gx, gy, w, h, dpr, dark, effA, rW, rH, lx, ly) => {
      if ((rW || 0) * (rH || 0) > 120000) return;
      const dO = Math.hypot(lx < 0 ? -lx : lx > rW ? lx - rW : 0, ly < 0 ? -ly : ly > rH ? ly - rH : 0);
      if (dO > 42) return;
      const a = effA * mx(0, 1 - dO / 42) * (dark ? 1 : 0.65);
      if (a <= 0.01) return;
      const rx = gx + 3.2 * dpr, ry = gy + 4.2 * dpr;
      fillRad(ctx, rx + 2 * dpr, ry + 3 * dpr, 26 * dpr, w, h, dark ? [0, rg('248,252,255', 0.135 * a), 0.45, rg('216,232,252', 0.05 * a), 1, 'rgba(200,220,250,0)'] : [0, rg('37,99,235', 0.065 * a), 1, 'rgba(37,99,235,0)']);
      const drawL = (ox, oy, s, x1, y1, st) => {
        ctx.save(); ctx.translate(rx + ox * dpr, ry + oy * dpr); traceGhost(ctx, s);
        ctx.fillStyle = addS(ctx.createLinearGradient(0, 0, x1 * s, y1 * s), st); ctx.fill(); ctx.restore();
      };
      drawL(-0.55, -0.55, 1.18 * dpr, 8, 16, dark ? [0, rg('232,242,255', 0.055 * a), 0.55, rg('204,224,248', 0.024 * a), 1, 'rgba(180,205,238,0)'] : [0, rg('15,23,42', 0.032 * a), 1, 'rgba(15,23,42,0)']);
      drawL(0, 0, 1.04 * dpr, 7, 15, dark ? [0, rg('252,254,255', 0.115 * a), 0.45, rg('222,235,252', 0.048 * a), 1, rg('190,210,240', 0.006 * a)] : [0, rg('15,23,42', 0.06 * a), 1, 'rgba(15,23,42,0.004)']);
    };

    const paintRim = (e, active, lx, ly, radius, dark, toneKey = 'default', amb = 1) => {
      if (dragOff()) return true;
      if (!e || !e.ctx || !e.cv || !e.rect) return false;
      if (!active || amb <= 0.001) { clrEnt(e); return true; }
      const isM = !!e.mm, isRB = !isM && !!e.rb, ip = e.ip || 0;
      const dprCap = busOf()?.getAdaptiveDprCap?.(1.5) || 1.5;
      const dpr = mn((typeof window !== 'undefined' && window.devicePixelRatio) || G.devicePixelRatio || 1, dprCap);
      const w = mx(4, Math.round((e.rect.width + ip) * dpr));
      const h = mx(4, Math.round((e.rect.height + ip) * dpr));
      const cssR = e.br >= 0 ? e.br : 10;
      const effA = mx(0, mn(1, amb * (!isM && toneKey === 'mono' ? 0.58 : 1)));
      const sig = `${w}|${h}|${radius}|${dark ? 1 : 0}|${isM ? 'm' : toneKey}|${isRB ? 'b' : ''}|${effA.toFixed(3)}|${cssR}|${ip}`;
      if (!e.cl && e.cv.width === w && e.cv.height === h && e._s === sig && Math.abs(lx - e._x) < 0.5 && Math.abs(ly - e._y) < 0.5) return true;
      if (e.cv.width !== w || e.cv.height !== h) { e.cv.width = w; e.cv.height = h; }
      e.cl = false; e._s = sig; e._x = lx; e._y = ly;
      const ctx = e.ctx;
      ctx.clearRect(0, 0, w, h);
      const padOff = ip * 0.5, gx = (lx + padOff) * dpr, gy = (ly + padOff) * dpr, gr = radius * dpr;
      const inset = (ip ? 1 : 0.75) * dpr, rw = mx(2, w - inset * 2), rh = mx(2, h - inset * 2), rr = mn(rw * 0.5, rh * 0.5, cssR * dpr);
      const prevA = ctx.globalAlpha, resA = () => { ctx.globalAlpha = prevA !== undefined ? prevA : 1; return true; };
      const canClip = isFn(ctx.save) && isFn(ctx.clip), canTr = isFn(ctx.save) && isFn(ctx.translate) && isFn(ctx.restore);
      const strokeRad = (slot, key, tx, ty, rad, lw, al, mk) => {
        if (canTr) {
          const g = cGrad(e, slot, key, () => mk(0, 0, rad));
          ctx.save(); ctx.globalAlpha = al; ctx.translate(tx, ty);
          strokeRR(ctx, inset - tx, inset - ty, rw, rh, rr);
          ctx.lineWidth = lw; ctx.strokeStyle = g; ctx.stroke(); ctx.restore();
        } else {
          ctx.globalAlpha = al; strokeRR(ctx, inset, inset, rw, rh, rr);
          ctx.lineWidth = lw; ctx.strokeStyle = mk(tx, ty, rad); ctx.stroke();
        }
      };

      if (isM) {
        if (canClip && isFn(ctx.fillRect)) {
          ctx.save();
          strokeRR(ctx, 0, 0, w, h, mn(w * 0.5, h * 0.5, cssR * dpr));
          ctx.clip();
          fillRad(ctx, gx, gy, 210 * dpr, w, h, dark ? [0, rg('238,245,255', 0.068 * effA), 0.42, rg('206,224,250', 0.026 * effA), 0.8, rg('180,202,238', 0.006 * effA), 1, 'rgba(180,202,238,0)'] : [0, rg('37,99,235', 0.042 * effA), 0.5, rg('37,99,235', 0.014 * effA), 1, 'rgba(37,99,235,0)']);
          if (isFn(ctx.translate) && isFn(ctx.createLinearGradient)) drawRefl(ctx, gx, gy, w, h, dpr, dark, effA, e.rect.width, e.rect.height, lx, ly);
          ctx.restore();
        }
        const mSt = dark ? [0, 'rgba(255,255,255,.95)', .24, 'rgba(232,240,252,0.56)', .54, 'rgba(186,202,228,.18)', .85, 'rgba(148,168,198,.03)', 1, 'rgba(148,168,198,0)'] : [0, 'rgba(30,64,175,.52)', .42, 'rgba(59,130,246,.2)', 1, 'rgba(59,130,246,0)'];
        strokeRad('ms', `${gr}|${dark ? 1 : 0}`, gx, gy, gr, 1.35 * dpr, effA, (x, y, rad) => addS(ctx.createRadialGradient(x, y, 0, x, y, rad), mSt));
        return resA();
      }

      if (isRB) {
        const gyR = h + 16 * dpr, grR = mx(radius * 1.15, 220) * dpr, ob = ly - e.rect.height;
        const aR = effA * 0.46 * (ob > 150 ? mx(0, 1 - (ob - 150) / 190) : ly < 0 ? mx(0, 1 + ly / 80) : 1);
        if (aR > 0.004) {
          strokeRad('rb', `${grR}|${dark ? 1 : 0}|${toneKey}`, gx, gyR, grR, 1.15 * dpr, aR, (x, y, rad) => palS(ctx.createRadialGradient(x, y, 0, x, y, rad), toneKey, dark));
          if (canClip) {
            ctx.save(); strokeRR(ctx, inset, inset, rw, rh, rr); ctx.clip();
            const wh = mn(rh, 14 * dpr), wc = dark ? '255,255,255' : '59,130,246', wr = mx(grR * 0.72, 160 * dpr), yTop = mx(0, h - wh);
            if (canTr) {
              ctx.globalAlpha = 0.032 * aR; ctx.translate(gx, h + 2 * dpr);
              ctx.fillStyle = cGrad(e, 'rw', `${wr}|${dark ? 1 : 0}`, () => addS(ctx.createRadialGradient(0, 0, 0, 0, 0, wr), [0, `rgba(${wc},1)`, 1, `rgba(${wc},0)`]));
              ctx.fillRect(-gx, yTop - (h + 2 * dpr), w, wh);
            } else {
              ctx.globalAlpha = 1;
              ctx.fillStyle = addS(ctx.createRadialGradient(gx, h + 2 * dpr, 0, gx, h + 2 * dpr, wr), [0, rg(wc, 0.032 * aR), 1, `rgba(${wc},0)`]);
              ctx.fillRect(0, yTop, w, wh);
            }
            ctx.restore();
          }
          if (isFn(ctx.createLinearGradient) && isFn(ctx.save)) {
            const mkG = cGrad(e, 'mk', `${h}`, () => addS(ctx.createLinearGradient(0, h, 0, 0), [0, 'rgba(0,0,0,1)', .22, 'rgba(0,0,0,.68)', .48, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0)']));
            ctx.save(); ctx.globalCompositeOperation = 'destination-in'; ctx.globalAlpha = 1; ctx.fillStyle = mkG; ctx.fillRect(0, 0, w, h); ctx.restore();
          }
        }
        return resA();
      }

      strokeRad('nm', `${gr}|${dark ? 1 : 0}|${toneKey}`, gx, gy, gr, 1.45 * dpr, effA, (x, y, rad) => palS(ctx.createRadialGradient(x, y, 0, x, y, rad), toneKey, dark));
      return resA();
    };

    const busOf = () => G.__agDomBus || G.__agPrismDomBus || (typeof window !== 'undefined' && (window.__agDomBus || window.__agPrismDomBus)) || null;
    const szOffs = new Map(), visOffs = new Map();
    const onResize = () => {
      pDirty = true; rectAt = 0;
      if (!isDestroyed() && !prismRaf && isFn(G.requestAnimationFrame) && hasLitRim()) wake();
    };
    const ensureRo = () => {
      if (busOf()?.observeSize) return null;
      if (boxRo || typeof ResizeObserver !== 'function') return boxRo;
      boxRo = new ResizeObserver(onResize);
      return boxRo;
    };

    const readRad = (el, fb) => {
      if (!el || typeof getComputedStyle !== 'function') return fb;
      try { const v = parseFloat(getComputedStyle(el).borderTopLeftRadius || ''); return Number.isFinite(v) && v >= 0 ? v : fb; } catch { return fb; }
    };

    const spOk = (e) => !dis(e) && !busOf()?.isSkipped?.(e) && !e.hidden && ga(e, 'aria-hidden') !== 'true' && ga(e, 'data-state') !== 'closed' && ga(e, 'aria-expanded') !== 'false' && e.style?.display !== 'none' && e.style?.visibility !== 'hidden' && !/(?:^|\s)(?:hidden|sr-only|grid-rows-\[0fr\]|h-0|max-h-0)(?:\s|$)/.test(e.className || '');
    const inVp = (r) => !!(r && r.width >= 4 && r.height >= 4 && r.bottom > 0 && r.right > 0 && r.top < (G.innerHeight || 900) && r.left < (G.innerWidth || 1440));
    const spIo = () => {
      if (busOf()?.observeVisibility) return null;
      if (spIoI || typeof IntersectionObserver !== 'function') return spIoI;
      try {
        spIoI = new IntersectionObserver((es) => {
          if (isDestroyed()) return;
          let ch = 0;
          for (const en of es) {
            const t = en?.target, br = en?.boundingClientRect;
            if (!t) continue;
            const on = en.isIntersecting && (!br || (br.width >= 4 && br.height >= 4)) ? 1 : 0;
            if (spVis.get(t) !== on) { spVis.set(t, on); ch = 1; }
          }
          if (ch) { pDirty = true; syncSp(0); }
        });
      } catch { spIoI = null; }
      return spIoI;
    };
    const scanSp = (rd) => {
      const ps = Array.from(qsa('[data-testid="step-plan"]')), des = new Set(), rcs = new Map();
      const bus = busOf();
      if (isRimOn() && !isWB()) {
        for (let i = ps.length - 1; i >= 0 && des.size < 2; i--) {
          const e = ps[i];
          if (!spOk(e) || (spVis.has(e) && !spVis.get(e))) continue;
          if (rd && e.getBoundingClientRect && !bus?.isSkipped?.(e)) {
            const r = e.getBoundingClientRect();
            if (!inVp(r)) continue;
            rcs.set(e, r); des.add(e);
          } else if (spVis.get(e) || (!rd && spOn.has(e))) des.add(e);
        }
      }
      return { ps, des, rcs };
    };
    const applySp = (ps, des) => {
      const bus = busOf(), pSet = new Set(ps);
      if (bus?.observeVisibility) {
        for (const p of ps) if (!visOffs.has(p)) {
          visOffs.set(p, bus.observeVisibility(p, (st) => {
            if (isDestroyed()) return;
            const br = st?.detail?.boundingClientRect;
            const on = st.visible && (!br || (br.width >= 4 && br.height >= 4)) ? 1 : 0;
            if (spVis.get(p) !== on) { spVis.set(p, on); pDirty = true; syncSp(0); }
          }));
        }
        for (const [o, off] of Array.from(visOffs.entries())) if (!pSet.has(o) || dis(o)) {
          T(off);
          visOffs.delete(o); spVis.delete(o);
        }
      } else {
        const io = ps.length ? spIo() : spIoI;
        if (io) {
          for (const p of ps) if (!spObs.has(p)) T(() => { io.observe(p); spObs.add(p); });
          for (const o of Array.from(spObs)) if (!pSet.has(o) || dis(o)) { unobs(io, spObs, o); spVis.delete(o); }
        }
      }
      for (const s of Array.from(spOn)) if (!des.has(s)) {
        spOn.delete(s);
        T(() => { ra(s, PB); ra(s, PM); s.style?.removeProperty?.('--ag-px'); s.style?.removeProperty?.('--ag-py'); });
      }
      for (const s of des) {
        setAttrIfChanged(s, PB, '1');
        setAttrIfChanged(s, PM, '1');
        spOn.add(s);
      }
    };
    const syncSp = (rd) => {
      if (isDestroyed()) return;
      const { ps, des } = scanSp(rd);
      if (!ps.length && !spOn.size && !spObs.size && !visOffs.size) return;
      runGuardedMut(() => { applySp(ps, des); prOrp(false); });
    };

    const rfBox = (now, allowRd) => {
      const bus = busOf();
      const sp = scanSp(allowRd), ro = ensureRo(), prevM = new Map(), nextObs = new Set(), next = [], bSet = new Set(), bList = [];
      for (const e of pBoxes) prevM.set(e.box, e);
      for (const b of qsa(`[${PB}="1"]`)) if ((!spOn.has(b) || sp.des.has(b)) && !bSet.has(b)) { bSet.add(b); bList.push(b); }
      for (const s of sp.des) if (!bSet.has(s)) { bSet.add(s); bList.push(s); }
      const trk = getActiveCrystalTrack ? getActiveCrystalTrack() : null;
      let nextO = null;
      const pre = bList.map((box) => {
        const prev = prevM.get(box), sk = !!bus?.isSkipped?.(box);
        return [box, prev, readRad(box, 10), sk ? null : (sp.rcs.get(box) || (allowRd && box.getBoundingClientRect ? box.getBoundingClientRect() : null))];
      });
      const oRect = trk && allowRd && !bus?.isSkipped?.(trk) && trk.getBoundingClientRect ? trk.getBoundingClientRect() : null;
      const mkEntry = (box, rect, prev, ip, br, mm = false, rb = false) => {
        nextObs.add(box);
        if (bus?.observeSize) {
          if (!szOffs.has(box)) T(() => szOffs.set(box, bus.observeSize(box, onResize)));
        } else if (ro && !obsSet.has(box)) T(() => { ro.observe(box); obsSet.add(box); });
        const reuse = !!(prev?.cv?.isConnected), rim = reuse ? prev : ensureCv(box);
        return {
          box, rect, cv: rim ? rim.cv : null, ctx: rim ? rim.ctx : null, ip, mm, rb, br,
          cl: prev ? prev.cl : false, _s: prev?._s || '', _x: prev?._x ?? -9999, _y: prev?._y ?? -9999,
          _gc: reuse ? (prev._gc || null) : null, px: prev ? prev.px : '', py: prev ? prev.py : '',
        };
      };
      runGuardedMut(() => {
        if (sp.ps.length || spOn.size || spObs.size || visOffs.size) applySp(sp.ps, sp.des);
        for (const [box, prev, br, rect] of pre) {
          const isHp = !!(box.classList?.contains?.('ag-cs-home-panel'));
          if (isHp && ga(box, PM) !== '1') setAttrIfChanged(box, PM, '1');
          const mM = ga(box, PM) === '1' || isHp, rB = !mM && ga(box, 'data-ag-cs-prism-reflect') === 'bottom';
          const pad = mM || isHp || ga(box, 'data-testid') === 'step-plan' ? 0 : 2;
          next.push(mkEntry(box, rect, prev, pad, br, mM, rB));
        }
        if (trk) nextO = mkEntry(trk, oRect, orchE?.box === trk ? orchE : null, 0, 999, false, false);
        for (const [oldEl, off] of Array.from(szOffs.entries())) if (!nextObs.has(oldEl)) { T(off); szOffs.delete(oldEl); }
        if (ro) for (const oldEl of Array.from(obsSet)) if (!nextObs.has(oldEl)) unobs(ro, obsSet, oldEl);
        prOrp();
      });
      pBoxes = next; orchE = nextO; pDirty = false; cacheAt = now;
    };

    const rdRec = (t) => {
      const b = busOf();
      for (const e of pBoxes) if (e.box?.getBoundingClientRect && !b?.isSkipped?.(e.box)) e.rect = e.box.getBoundingClientRect();
      if (orchE?.box?.getBoundingClientRect && !b?.isSkipped?.(orchE.box)) orchE.rect = orchE.box.getBoundingClientRect();
      rectAt = t || performance.now() || 1;
    };

    const flushPtr = (rafNow) => {
      prismRaf = 0;
      if (isDestroyed()) return;
      if (isH()) return shrinkRims(1);
      if (isWB()) return;
      if (dragOff()) { pDirty = true; return; }
      const amb = readAmb();
      if (rimOff() || amb <= 0.001) {
        runGuardedMut(() => { prOrp(); clrAll(true); });
        return;
      }
      const now = typeof rafNow === 'number' && rafNow > 0 ? rafNow : performance.now();
      const minGap = mx(0, Number(getMinFrameGapMs?.() ?? 0) || 0);
      if (minGap > 0 && drawAt > 0 && now - drawAt < minGap) { schedRaf(); return; }
      drawAt = now;
      const { x, y } = ptr, allowRd = ptrIn(), bus = busOf();
      const hasRo = !!(boxRo || szOffs.size > 0);
      const trk = getActiveCrystalTrack ? getActiveCrystalTrack() : null;
      if (
        pDirty || !pBoxes.length || (!hasRo && now - cacheAt > 2500) || now - cacheAt > 8000 ||
        trk !== (orchE ? orchE.box : null) ||
        pBoxes.some((e) => dis(e.box) || (e.cv && e.cv.isConnected === false) || e.br < 0 || (allowRd && !e.rect && !bus?.isSkipped?.(e.box)))
      ) {
        rfBox(now, allowRd);
        rectAt = allowRd ? now : 0;
      } else if (allowRd && (!rectAt || now - rectAt >= 64)) {
        rdRec(now);
      }
      const dark = isDarkTheme(), tk = toneKeyOf(dark);
      let compRim = null;
      const drawEntry = (e, maxR, gradR, vx, vy, minW) => {
        const r = allowRd ? e.rect : null;
        let inR = false, lx = -9999, ly = -9999;
        if (r && r.width >= 4 && r.height >= 4 && (!minW || r.width >= minW)) {
          const hit = e.rb
            ? x >= r.left - 240 && x <= r.right + 240 && y >= r.top - 80 && y <= r.bottom + 340
            : x >= r.left - maxR && x <= r.right + maxR && y >= r.top - maxR && y <= r.bottom + maxR;
          if (hit) { inR = true; lx = x - r.left; ly = y - r.top; }
        }
        if (!e.mm && !e.rb && e.box?.classList?.contains?.('surface-composer-card')) {
          const st = inR && Math.abs(ly) < 220 ? mn(1, amb * (tk === 'mono' ? 0.62 : 1)) * (1 - Math.abs(ly) / 220) : 0;
          if (!compRim || st > compRim.strength) compRim = { localX: lx, strength: st, toneKey: tk, dark };
        }
        if (e.ctx && paintRim(e, inR, lx, ly, gradR, dark, tk, amb)) return;
        const nx = inR ? `${lx.toFixed(1)}px` : '-9999px', ny = inR ? `${ly.toFixed(1)}px` : '-9999px';
        if (e.px !== nx) { e.px = nx; e.box.style.setProperty(vx, nx); }
        if (e.py !== ny) { e.py = ny; e.box.style.setProperty(vy, ny); }
      };
      runGuardedMut(() => {
        for (const e of pBoxes) drawEntry(e, 280, 240, '--ag-px', '--ag-py', 0);
        if (orchE) { drawEntry(orchE, 120, 96, '--orch-px', '--orch-py', 10); setCrystalPointerClient?.(x, y); }
      });
      emitComp(compRim);
      armIdle();
    };

    const schedRaf = () => { if (!prismRaf && typeof requestAnimationFrame === 'function') prismRaf = requestAnimationFrame(flushPtr); };
    const clrRaf = () => { if (prismRaf) { typeof cancelAnimationFrame === 'function' && cancelAnimationFrame(prismRaf); prismRaf = 0; } };

    const SB_SEL = 'aside,[data-testid="sidebar-split"]>div:first-child,[data-testid="conversation-row-sidebar"],[data-testid="project-header"],[data-hover-card-popup]';
    let sbT = null, sbR = false, sbAt = 0;
    const inSb = (t, now) => {
      if (t && t === sbT && now - sbAt < 120) return sbR;
      let res = false;
      try { res = !!t?.closest?.(SB_SEL); } catch { res = false; }
      sbT = t || null; sbR = res; sbAt = now;
      return res;
    };

    const onPointerMove = (ev) => {
      if (isDestroyed() || isWB()) return;
      const x = Number(ev.clientX), y = Number(ev.clientY);
      ptr.x = x; ptr.y = y;
      if (dragOff()) { pDirty = true; return; }
      const now = performance.now(), rimOn = isRimOn();
      if (inSb(ev?.target, now)) {
        if (rimOn && hasLitRim()) { ptr.x = ptr.y = -9999; schedRaf(); }
        onPointerActivity?.(now);
        return;
      }
      if (rimOn && !prismRaf) {
        const far = (e, d) => { const r = e.rect; return e.cl && r && (r.width < 4 || r.height < 4 || x < r.left - d || x > r.right + d || y < r.top - d || y > r.bottom + d); };
        const farIdle = !pDirty && pBoxes.length > 0 && now - cacheAt <= 6000 && rectAt > 0 && now - rectAt < 1500 && pBoxes.every((e) => far(e, 360)) && (!orchE || far(orchE, 200));
        if (!farIdle) schedRaf();
      }
      onPointerActivity?.(now);
    };

    const onLeave = () => { if (!isDestroyed() && !isWB()) { ptr.x = ptr.y = -9999; schedRaf(); } };
    const onVis = () => {
      if (isDestroyed()) return;
      if (isH()) { clrRaf(); shrinkRims(1); }
      else if (!isWB() && isRimOn() && ptrIn()) { drawAt = 0; schedRaf(); }
    };
    const onWinBlur = () => { if (!isDestroyed()) { clrRaf(); clrAll(); } };
    const syncBusRects = () => { if (!isDestroyed() && canDraw() && !rectAt) rdRec(); };
    const ancOf = (a, b) => { if (!a || !b) return false; if (isFn(a.contains)) return a.contains(b); for (let c = b; c; c = c.parentElement) if (c === a) return true; return false; };
    const isRootT = (t, d, w) => !t || t === d || t === d?.documentElement || t === d?.body || t === w;
    const onScroll = (ev) => {
      if (isDestroyed()) return;
      const t = ev?.target, d = getDoc(), w = typeof window !== 'undefined' ? window : d?.defaultView;
      if (!isRootT(t, d, w) && !pBoxes.some((e) => ancOf(t, e?.box)) && !ancOf(t, orchE?.box)) return;
      rectAt = 0;
      if (canDraw()) { const bus = busOf(); if ((pBoxes.length || orchE) && bus?.measure) bus.measure('rim:rects', syncBusRects); schedRaf(); }
    };
    const onAnimEnd = (ev) => {
      const t = !isDestroyed() && ev?.target, d = getDoc();
      if (isRootT(t, d, null) || (t.nodeType !== undefined && t.nodeType !== 1)) return;
      const hit = (b) => !!(b && (b === t || ancOf(t, b) || ancOf(b, t)));
      if (!pBoxes.some((e) => hit(e?.box)) && !hit(orchE?.box)) return;
      rectAt = 0; pDirty = true; wake();
    };
    const bindEv = (m) => {
      const d = getDoc(), w = typeof window !== 'undefined' ? window : d?.defaultView;
      if (d?.[m]) {
        d[m]('visibilitychange', onVis);
        d[m]('transitionend', onAnimEnd, CAP);
        d[m]('animationend', onAnimEnd, CAP);
      }
      d?.documentElement?.[m]?.('pointerleave', onLeave);
      if (w?.[m]) {
        w[m]('blur', onWinBlur);
        w[m]('scroll', onScroll, CAP);
      }
    };
    bindEv('addEventListener');

    const invalidateMetrics = () => {
      pDirty = true; rectAt = 0;
      for (const e of pBoxes) e.br = -1;
      if (isDestroyed()) return;
      runGuardedMut(() => {
        prOrp();
        if (isH()) { clrRaf(); shrinkRims(1); }
        else if (!isRimOn()) { clrRaf(); clrAll(true); }
        else wake();
      });
    };

    const mountNewBoxes = () => {
      pDirty = true; rectAt = 0;
      if (isDestroyed()) return;
      if (isH()) { clrRaf(); shrinkRims(1); return; }
      if (!isRimOn()) { runGuardedMut(() => { clrRaf(); clrAll(true); }); return; }
      runGuardedMut(() => {
        for (const box of qsa(`[${PB}="1"]`)) if (!dis(box) && ga(box, CV_A) !== '1') ensureCv(box);
        if (!isWB() && !dragOff()) { drawAt = 0; schedRaf(); }
      });
    };

    const rescanNow = () => {
      pDirty = true; rectAt = 0; sbT = null; sbAt = 0;
      if (isDestroyed()) return;
      if (isH()) { clrRaf(); shrinkRims(1); return; }
      if (!isRimOn()) { runGuardedMut(() => { prOrp(false); clrRaf(); clrAll(true); }); return; }
      const now = performance.now();
      rfBox(now, ptrIn());
      rectAt = ptrIn() ? now : 0;
      wake();
    };

    const markDirty = () => {
      pDirty = true; sbT = null; sbAt = 0;
      if (isDestroyed()) return;
      syncSp(0);
      runGuardedMut(() => {
        prOrp(false);
        if (!isRimOn()) { clrRaf(); clrAll(true); }
      });
    };

    const teardown = () => {
      clrRaf(); emitComp(null); bindEv('removeEventListener'); shrinkRims(1); trkCvs.clear();
      sbT = null; sbAt = 0; rectAt = 0;
      clrOffs(szOffs);
      if (boxRo) { T(() => boxRo.disconnect()); boxRo = null; }
      obsSet.clear();
      clrOffs(visOffs);
      if (spIoI) { T(() => spIoI.disconnect()); spIoI = null; }
      spObs.clear(); spVis.clear();
      for (const s of spOn) T(() => { ra(s, PB); ra(s, PM); });
      spOn.clear();
      const d = getDoc();
      if (d) {
        d.getElementById?.('ag-prism-dyn-vars')?.remove?.();
        qsa(CV_S).forEach?.((n) => n.remove?.());
        qsa(`[${CV_A}]`).forEach?.((e) => ra(e, CV_A));
      }
      pBoxes = []; orchE = null;
    };

    return {
      onPointerMove, cancelPendingRaf: clrRaf,
      pauseForOverlay: () => { if (!isDestroyed() && isWB()) { clrRaf(); clrAll(isH()); } },
      teardown, markDirty, invalidateMetrics, mountNewBoxes, rescanNow, getLastPointerPos: () => ptr,
    };
  }

  const api = { createPrismRimCanvasController };
  if (typeof module === 'object' && module.exports) module.exports = api;
  G.__agPrismRimCanvas = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
