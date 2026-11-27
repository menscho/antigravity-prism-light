// Obsidian Prism — FastDOM Smooth Typing Caret Engine
// Separates measure & mutate phases with zero forced layout reflow.

(function (G) {
  'use strict';
  if (!G) return;

  const BLOCK_RE = /^(P|DIV|BLOCKQUOTE|UL|OL|LI|PRE|H[1-6]|HR)$/i;
  const ZWSP_RE = /^[\u200b\ufeff]*$/;
  const A_CARET = 'data-ag-cs-smooth-caret';
  const A_HOST = 'data-ag-cs-caret-host';
  const A_VIS = 'data-ag-cs-caret-visible';
  const A_TYP = 'data-ag-cs-caret-typing';
  const S_CARET = '.ag-cs-smooth-caret';
  const M = Math;
  const isFn = (v) => typeof v === 'function';
  const isNum = (v) => typeof v === 'number';
  const isEl = (n) => n?.nodeType === 1;
  const isTxt = (n) => n?.nodeType === 3;
  const isBr = (n) => n?.nodeName === 'BR';
  const getDoc = () => (typeof document < 'u' ? document : null);
  const rAF = (cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : 0);
  const rectOf = (n) => (n && isFn(n.getBoundingClientRect) ? n.getBoundingClientRect() : null);
  const rectsOf = (n) => (n && isFn(n.getClientRects) ? n.getClientRects() : null);
  const rmAttr = (el, k) => { if (el?.hasAttribute?.(k)) el.removeAttribute(k); };
  const isBlockEl = (n) => !!(isEl(n) && BLOCK_RE.test(n.nodeName || n.tagName || ''));
  const isDecoEl = (n) => !!(isEl(n) && !isBr(n) && (n.getAttribute?.('contenteditable') === 'false' || n.hasAttribute?.('data-lexical-decorator')));
  const txtOf = (n) => n.data ?? n.nodeValue ?? '';
  const isBlankTxt = (n) => ZWSP_RE.test(txtOf(n));
  const noEdTxt = (ed) => !(ed.textContent && !ZWSP_RE.test(ed.textContent));
  const cnLen = (n, d = -1) => n?.childNodes?.length ?? d;
  const newWM = () => new WeakMap();
  const prevSib = (n) => {
    if (!n) return null;
    if (n.previousSibling !== undefined) return n.previousSibling;
    const kids = n.parentNode?.childNodes;
    if (!kids) return null;
    for (let i = kids.length; --i > 0;) if (kids[i] === n) return kids[i - 1];
    return null;
  };

  function snapDevicePx(value, dpr = 1) {
    const v = +value || 0, n = +dpr, d = n > 0 && isFinite(n) ? M.min(4, n) : 1;
    return +(M.round(v * d) / d).toFixed(3);
  }

  function createSmoothCaretController({ isDestroyed, isEnabled, setAttrIfChanged, runGuardedMut }) {
    let tm = null, raf = 0, blinkAt = 0;
    let pTyp = false, pRef = false, pScr = false;
    let mEpoch = 1, sEpoch = 1, edList = [], scanAt = 0;
    const mCache = newWM(), prevSt = newWM(), cNode = newWM(), sigCache = newWM();
    let eCache = newWM();
    const isDead = () => isDestroyed() || !isEnabled();
    const cAF = () => { if (raf && typeof cancelAnimationFrame === 'function') { cancelAnimationFrame(raf); raf = 0; } };

    const isQuickEmpty = (ed, fn) => {
      const ch = ed.children, cns = ed.childNodes;
      if (!ch && !cns) return noEdTxt(ed);
      if (ch?.length > 1 || cns?.length > 1 || (isTxt(fn) && !isBlankTxt(fn))) return false;
      let cur = ch?.[0] || ed.firstChild || cns?.[0] || null;
      for (let d = 0; d < 3; d++) {
        if (!cur || isBr(cur)) return true;
        if (isTxt(cur)) return isBlankTxt(cur);
        if (isDecoEl(cur)) return false;
        const k = cur.childNodes;
        if (!k?.length) return d < 2;
        if (k.length > 1) return false;
        cur = k[0];
      }
      return false;
    };

    const hasContent = (ed) => {
      if (!ed.childNodes) return !noEdTxt(ed);
      const st = [ed];
      for (let seen = 0; st.length && seen < 64;) {
        const list = st.pop().childNodes;
        for (let i = list ? list.length : 0; i--;) {
          const ch = list[i];
          if (!ch) continue;
          if (++seen >= 64) return true;
          if (isTxt(ch)) { if (!isBlankTxt(ch)) return true; }
          else if (isEl(ch)) {
            if (isDecoEl(ch)) return true;
            if (ch.childNodes?.length) st.push(ch);
          }
        }
      }
      return false;
    };

    function teardown() {
      if (tm) { clearTimeout(tm); tm = null; }
      cAF();
      blinkAt = scanAt = 0;
      pTyp = pRef = pScr = false;
      edList = [];
      const doc = getDoc();
      if (!doc) return;
      doc.querySelectorAll(S_CARET).forEach((n) => n.remove());
      for (const a of [A_CARET, A_HOST]) doc.querySelectorAll(`[${a}]`).forEach((n) => n.removeAttribute(a));
    }

    function bumpMetricsEpoch() { mEpoch += 1; scanAt = 0; eCache = newWM(); }
    function invalidateSelection() { sEpoch += 1; }

    function getMetrics(ed, force) {
      let rec = mCache.get(ed);
      if (rec && !force && rec[3] === mEpoch) return rec;
      const cs = isFn(getComputedStyle) ? getComputedStyle(ed) : null;
      const pf = (k, d) => parseFloat(cs?.[k]) || d;
      const fs = pf('fontSize', 14), gh = M.max(16, M.min(24, M.round(fs * 1.28)));
      const dh = M.max(16, M.min(28, pf('lineHeight', fs * 1.5)));
      rec = [pf('paddingLeft', 8), gh, pf('paddingTop', 8) + M.max(0, M.round((dh - gh) / 2)), mEpoch];
      mCache.set(ed, rec);
      return rec;
    }

    function measureBox(doc, ed, refresh, hasSel, range, isCol) {
      const edR = rectOf(ed), [padL, gh, emptyTop] = getMetrics(ed, refresh), NO_BOX = { collapsed: false };
      const mkBox = (left, top, height) => {
        if ((ed.scrollHeight || 0) > (ed.clientHeight || 0) + 2 && edR.height > 0 && (top < edR.top - 4 || top + height > edR.bottom + 6)) return NO_BOX;
        return { collapsed: true, left, top, height };
      };
      const mkR = (r, l) => mkBox(l ?? r.left, r.top, r.height);
      const saveProbe = (r) => {
        if (r && r.height > 0 && r.height < 36 && edR.height > 0) eCache.set(ed, [r.left - edR.left, r.top - edR.top, r.height, mEpoch]);
      };
      const okR = (r, rt) => !!(r && r.height > 0 && ((rt ? r.right : r.left) > 0 || r.top > 0));
      const rRect = (rg) => { const rs = rectsOf(rg); return rs?.length ? rs[rs.length - 1] : rectOf(rg); };
      const elRect = (el, deco) => {
        const ok = (r) => r && r.height > 0 && r.right > 0 && (deco || (isNum(r.width) ? r.width > 0 : !isNum(r.left) || r.right > r.left));
        const rs = rectsOf(el);
        if (rs) for (let i = rs.length; i--;) if (ok(rs[i])) return rs[i];
        const b = rectOf(el);
        return ok(b) ? b : null;
      };
      const boxAfter = (pr) => { const h = M.min(gh, pr.height || gh); return mkBox(pr.right, pr.top + M.max(0, (pr.height - h) / 2), h); };
      const inlineRight = (el, blk) => {
        if (!isEl(el) || isBr(el) || (!blk && isBlockEl(el))) return null;
        const pr = elRect(el, isDecoEl(el));
        return pr ? boxAfter(pr) : null;
      };
      let prevRect = null;
      const findPrev = (start, inc) => {
        prevRect = null;
        if (!inc && (!start || start === ed || isBlockEl(start))) return null;
        for (let cur = start, chk = inc, s = 0; cur && cur !== ed && s < 24; s++) {
          if (chk) {
            chk = 0;
            if (isTxt(cur)) { if (!isBlankTxt(cur)) return cur; }
            else if (isEl(cur)) {
              if (isBr(cur) || isBlockEl(cur)) return null;
              const d = isDecoEl(cur);
              if ((prevRect = elRect(cur, d))) return cur;
              if (d) return null;
            }
          }
          const pv = prevSib(cur);
          if (pv) { cur = pv; chk = 1; continue; }
          const p = cur.parentNode;
          if (!p || p === ed || isBlockEl(p)) return null;
          cur = p;
        }
        return null;
      };
      const prevEnd = (start, inc) => {
        const n = findPrev(start, inc);
        if (!n) return null;
        if (isEl(n)) return boxAfter(prevRect);
        if (isTxt(n) && isFn(doc.createRange)) {
          const str = txtOf(n);
          let end = str.length;
          while (end && ZWSP_RE.test(str[end - 1])) end--;
          if (!end) return null;
          try {
            const tr = doc.createRange();
            const tryAt = (st, rt) => { tr.setStart(n, st); tr.setEnd(n, end); const r = rRect(tr); return okR(r, rt) ? mkR(r, rt ? r.right : r.left) : null; };
            return tryAt(end) || tryAt(end - 1, 1);
          } catch {}
        }
        return null;
      };

      if (hasSel) {
        if (!isCol) return NO_BOX;
        if (range && ed.contains?.(range.startContainer)) {
          const sc = range.startContainer, so = range.startOffset, scIsEl = isEl(sc), scn = scIsEl ? sc.childNodes : null;
          // Guard 1 & 2: 芯片内部对齐右侧；元素级光标紧邻内联芯片/元素后先于 getClientRects() 对齐右侧
          const chip = (scIsEl ? sc : sc?.parentElement || sc?.parentNode)?.closest?.('[contenteditable="false"],[data-lexical-decorator]');
          let box = chip && chip !== ed && ed.contains(chip) ? inlineRight(chip, 1) : scn && so > 0 ? inlineRight(scn[so - 1]) : null;
          if (box) return box;
          // Guard 3: 文本/ZWSP offset===0 或空白文本的假矩形交叉校验
          const r0 = rRect(range);
          if (okR(r0)) {
            if (!so || (isTxt(sc) && isBlankTxt(sc))) {
              const pv = findPrev(sc);
              if (isEl(pv) && prevRect && M.abs(r0.top - prevRect.top) < M.max(gh, prevRect.height) && r0.left < prevRect.right - 2) {
                return mkR(r0, prevRect.right + 1);
              }
            }
            return mkR(r0);
          }
          const brBox = (n, sgl) => {
            const r = isBr(n) ? rectOf(n) : null;
            if (!okR(r)) return null;
            if ((!sgl || scn?.length <= 1) && isQuickEmpty(ed, sc)) saveProbe(r);
            return mkR(r);
          };
          if ((box = brBox(sc) || (scIsEl && brBox(scn?.[so], 1)))) return box;
          const cp = scIsEl && so > 0 ? scn?.[so - 1] : null, br = isBr(cp) ? rectOf(cp) : null;
          if (okR(br)) {
            const mg = cp.hasAttribute?.('data-lexical-managed-linebreak') || scn?.length === 1;
            const sr = rectOf(sc), left = sr?.left > 0 ? sr.left : br.left, top = mg ? br.top : br.bottom;
            if (mg && scn?.length <= 1 && isQuickEmpty(ed, sc)) saveProbe({ left, top, height: br.height });
            return mkBox(left, top, br.height);
          }
          // Guard 4: 元素边界/空内联 span/ZWSP 前驱（折行芯片或普通文本）测距
          if ((box = cp ? prevEnd(cp, 1) : (scIsEl && !so) || (isTxt(sc) && isBlankTxt(sc)) ? prevEnd(sc) : null)) return box;
          if (scIsEl && sc !== ed && !so) {
            const sr = rectOf(sc);
            if (sr && (sr.left > 0 || sr.top > 0)) return mkBox(sr.left, sr.top, M.min(gh, sr.height || gh));
          }
        }
      }

      if (hasContent(ed)) return NO_BOX;
      const cached = eCache.get(ed);
      return cached && cached[3] === mEpoch ? mkBox(edR.left + cached[0], edR.top + cached[1], cached[2]) : mkBox(edR.left + padL, edR.top + emptyTop, gh);
    }

    function resolveEditors(doc, ae, refresh) {
      const now = Date.now();
      if (!refresh && edList.length && now - scanAt < 1200 && edList.every((e) => e && e.isConnected !== false) && (!(ae?.isContentEditable || ae?.getAttribute?.('contenteditable') === 'true') || edList.includes(ae))) return edList;
      edList = [...doc.querySelectorAll('[data-testid="agent-input-box"] [contenteditable="true"]')];
      scanAt = now;
      return edList;
    }

    function measureSnapshot(refresh, checkScroll = true) {
      const doc = getDoc();
      if (isDead() || !doc) return null;
      const ae = doc.activeElement, editors = resolveEditors(doc, ae, refresh);
      if (!editors.length) return null;
      const sel = isFn(doc.getSelection) ? doc.getSelection() : null, list = [];
      for (const ed of editors) {
        const host = ed.parentElement;
        if (!host) continue;
        const focused = ae === ed || !!(ae && ed.contains?.(ae));
        if (!focused) {
          sigCache.delete(ed);
          const cc = cNode.get(host);
          const vis = cc && cc.isConnected !== false ? cc.getAttribute?.(A_VIS) === '1' : !!host.querySelector?.(`${S_CARET}[${A_VIS}="1"]`);
          if (!host.hasAttribute?.(A_HOST) || ed.hasAttribute?.(A_CARET) || vis) list.push([ed, host]);
          continue;
        }
        let scrolledOnly = false;
        const rc = sel?.rangeCount || 0;
        const r0 = rc && isFn(sel.getRangeAt) ? sel.getRangeAt(0) : null;
        const col = r0?.collapsed ?? (rc ? !!sel.isCollapsed : true);
        const fn = r0?.endContainer ?? (rc ? sel.focusNode : null);
        const fo = isNum(r0?.endOffset) ? r0.endOffset : rc ? sel.focusOffset : -1;
        const cc = ed.children?.length ?? cnLen(ed, 0);
        const fp = fn && fn !== ed ? fn.parentNode : null, gp = fp && fp !== ed ? fp.parentNode : null;
        const lLen = typeof fn?.nodeValue === 'string' ? fn.nodeValue.length : cnLen(fn, cc);
        const pn = fn && fn !== ed ? (isEl(fn) && fo > 0 ? fn.childNodes?.[fo - 1] || null : prevSib(fn) || (fp && !isBlockEl(fp) ? prevSib(fp) : null)) : null;
        const pk = pn && pn !== ed && !isTxt(pn) ? cnLen(pn, 0) : 0;
        const pSig = !pn || pn === ed ? -1 : isTxt(pn) ? txtOf(pn).length : `${pk}:${!isBlockEl(pn) && (isDecoEl(pn) || pk <= 8) && typeof pn.textContent === 'string' ? pn.textContent.length : 0}`;
        const sigStr = [mEpoch, sEpoch, rc, col ? 1 : 0, fo, cc, lLen, cnLen(fp), cnLen(gp), pSig].join(':');
        const prev = sigCache.get(ed);
        const same = !refresh && !!prev && (ed.hasAttribute?.(A_CARET) || prev[4]) && prev[0] === sigStr && prev[1] === fn && prev[2] === pn;
        if (same && !checkScroll) continue;
        const hsl = host.scrollLeft || 0, hst = host.scrollTop || 0;
        const scKey = `${ed.scrollLeft || 0},${ed.scrollTop || 0},${hsl},${hst}`;
        if (same) {
          if (prev[3] === scKey) continue;
          scrolledOnly = true;
        }
        const measured = measureBox(doc, ed, refresh, rc > 0, r0, col);
        const hostRect = measured?.collapsed ? rectOf(host) : null;
        sigCache.set(ed, [sigStr, fn, pn, scKey, !(measured?.collapsed && hostRect)]);
        list.push([ed, host, focused, measured, hostRect, host.clientLeft || 0, host.clientTop || 0, hsl, hst, isQuickEmpty(ed, fn), scrolledOnly]);
      }
      return list;
    }

    function applyMutations(snapList, isTyping) {
      if (isDead()) { teardown(); return; }
      const doc = getDoc();
      if (!snapList?.length || !doc) return;
      runGuardedMut(() => {
        const dpr = (typeof window < 'u' && +window.devicePixelRatio) || 1;
        for (const [ed, host, focused, measured, hostRect, cl, ct, sl, st, empty, scrolledOnly] of snapList) {
          setAttrIfChanged(host, A_HOST, '1');
          let caret = cNode.get(host);
          if (!caret || caret.parentElement !== host) caret = host.querySelector(S_CARET);
          if (!caret) {
            caret = doc.createElement('div');
            caret.className = S_CARET.slice(1);
            caret.setAttribute('aria-hidden', 'true');
            caret.setAttribute('data-ag-no-i18n', '');
            host.appendChild(caret);
          }
          cNode.set(host, caret);
          if (!focused || !measured?.collapsed || !hostRect) { rmAttr(caret, A_VIS); rmAttr(ed, A_CARET); continue; }

          const x = snapDevicePx(measured.left - hostRect.left - cl + sl, dpr);
          const y = snapDevicePx(measured.top - hostRect.top - ct + st, dpr);
          const h = M.max(15, snapDevicePx(measured.height || 18, dpr));
          const prev = prevSt.get(caret), cs = caret.style, tr = `translate3d(${x}px, ${y}px, 0)`, hs = `${h}px`;
          const moved = !prev || prev[0] !== x || prev[1] !== y;

          if (caret.getAttribute(A_VIS) !== '1' || (prev && !prev[3] && empty) || scrolledOnly) {
            cs.transition = 'none'; cs.transform = tr; cs.height = hs;
            if (!rAF(() => { if (caret.isConnected) cs.transition = ''; })) cs.transition = '';
          } else {
            if (moved) cs.transform = tr;
            if (!prev || prev[2] !== h) cs.height = hs;
          }
          prevSt.set(caret, [x, y, h, empty]);
          setAttrIfChanged(caret, A_VIS, '1');
          setAttrIfChanged(ed, A_CARET, '1');
          const now = Date.now(), ms = isTyping ? 420 : prev && moved && now - blinkAt >= 60 ? 220 : 0;
          if (ms) {
            blinkAt = now;
            setAttrIfChanged(caret, A_TYP, '1');
            if (tm) clearTimeout(tm);
            tm = setTimeout(() => { tm = null; if (caret.isConnected) caret.removeAttribute(A_TYP); }, ms);
          }
        }
      });
    }

    function sync(isTyping, refresh, checkScroll = true) {
      if (isDead()) { teardown(); return; }
      applyMutations(measureSnapshot(refresh, checkScroll), isTyping);
    }

    function queue(isTyping, immediate, refresh, isScroll) {
      if (isDead()) return;
      pTyp ||= !!isTyping; pRef ||= !!refresh; pScr ||= !!isScroll;
      cAF();
      const run = () => { const t = pTyp, r = pRef, s = pScr; pTyp = pRef = pScr = false; sync(t, r, s); };
      immediate ? run() : (raf = rAF(() => { raf = 0; run(); }));
    }

    return { teardown, bumpMetricsEpoch, invalidateSelection, measureSnapshot, applyMutations, sync, queue };
  }

  const api = { createSmoothCaretController, snapDevicePx };
  if (typeof module === 'object' && module.exports) module.exports = api;
  G.__agPrismSmoothCaret = api;
})(typeof globalThis < 'u' ? globalThis : window);
