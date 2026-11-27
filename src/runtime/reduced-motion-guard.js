// 纯页内减弱动效守卫（Issue #101）：零 CDP 域依赖，支持实时热切换且保持 motionLevel="off" 最高优先级
(function (root, factory) {
  const api = factory(root);
  if (root) {
    root.__agPrismReducedMotion = api.isReducedMotion;
    root.__agPrismApplyIgnoreReducedMotion = api.applyIgnoreReducedMotion;
    root.__agPrismReducedMotionGuard = api;
  }
  if (typeof window !== 'undefined' && window && window !== root) {
    window.__agPrismReducedMotion = api.isReducedMotion;
    window.__agPrismApplyIgnoreReducedMotion = api.applyIgnoreReducedMotion;
    window.__agPrismReducedMotionGuard = api;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function (G) {
  'use strict';

  const IGNORE_ATTR = 'data-ag-cs-ignore-rm';
  const MOTION_ATTR = 'data-ag-cs-motion';
  const EVENT_NAME = 'ag-prism-rm-change';
  const QUERY = '(prefers-reduced-motion: reduce)';
  const mqlCache = typeof WeakMap === 'function' ? new WeakMap() : null;

  function resolveDoc(docOverride, winOverride) {
    if (docOverride) return docOverride;
    if (winOverride && winOverride.document) return winOverride.document;
    return typeof document !== 'undefined' ? document : null;
  }

  function resolveWin(winOverride, doc) {
    if (winOverride) return winOverride;
    if (doc && doc.defaultView) return doc.defaultView;
    if (typeof window !== 'undefined' && window) return window;
    return G || null;
  }

  function readRootAttr(de, attrName, datasetKey) {
    if (!de) return '';
    try {
      if (typeof de.getAttribute === 'function') {
        const val = de.getAttribute(attrName);
        if (val !== null && val !== undefined) return String(val);
      }
      if (de.dataset && de.dataset[datasetKey] !== undefined) {
        return String(de.dataset[datasetKey]);
      }
    } catch {}
    return '';
  }

  function isMotionLevelOff(doc) {
    const de = doc && doc.documentElement;
    return readRootAttr(de, MOTION_ATTR, 'agCsMotion') === 'off';
  }

  function isIgnoringReducedMotion(doc) {
    const de = doc && doc.documentElement;
    return readRootAttr(de, IGNORE_ATTR, 'agCsIgnoreRm') === '1';
  }

  function querySystemReducedMotion(win) {
    try {
      if (!win || typeof win.matchMedia !== 'function') return false;
      const mm = win.matchMedia;
      if (mqlCache && typeof win === 'object') {
        const hit = mqlCache.get(win);
        if (hit && hit.fn === mm && hit.mql) {
          return Boolean(hit.mql.matches);
        }
        const mql = mm.call(win, QUERY);
        mqlCache.set(win, { fn: mm, mql });
        return Boolean(mql && mql.matches);
      }
      const res = mm.call(win, QUERY);
      return Boolean(res && res.matches);
    } catch {
      return false;
    }
  }

  function isReducedMotion(docOverride, winOverride) {
    const doc = resolveDoc(docOverride, winOverride);
    const win = resolveWin(winOverride, doc);
    if (isMotionLevelOff(doc, win)) return true;
    if (isIgnoringReducedMotion(doc)) return false;
    return querySystemReducedMotion(win);
  }

  function dispatchChangeEvent(win, doc, enabled) {
    const detail = {
      ignoreReducedMotion: enabled,
      reduced: isReducedMotion(doc, win),
    };
    const targets = [];
    if (win && typeof win.dispatchEvent === 'function') targets.push(win);
    if (doc && typeof doc.dispatchEvent === 'function' && doc !== win) targets.push(doc);
    for (let i = 0; i < targets.length; i++) {
      try {
        const CE = (win && win.CustomEvent) || (typeof CustomEvent === 'function' ? CustomEvent : null);
        const EV = (win && win.Event) || (typeof Event === 'function' ? Event : null);
        const ev = CE ? new CE(EVENT_NAME, { detail }) : EV ? Object.assign(new EV(EVENT_NAME), { detail }) : { type: EVENT_NAME, detail };
        targets[i].dispatchEvent(ev);
      } catch {}
    }
  }

  function applyIgnoreReducedMotion(flag, docOverride, winOverride) {
    const enabled = flag === true || flag === 'on' || flag === '1' || flag === 1;
    const doc = resolveDoc(docOverride, winOverride);
    const win = resolveWin(winOverride, doc);
    const de = doc && doc.documentElement;
    let changed = false;
    if (de) {
      const prev = isIgnoringReducedMotion(doc);
      if (enabled) {
        if (!prev) {
          try {
            if (typeof de.setAttribute === 'function') de.setAttribute(IGNORE_ATTR, '1');
            else if (de.dataset) de.dataset.agCsIgnoreRm = '1';
          } catch {}
          changed = true;
        }
      } else if (prev) {
        try {
          if (typeof de.removeAttribute === 'function') de.removeAttribute(IGNORE_ATTR);
          if (de.dataset && 'agCsIgnoreRm' in de.dataset) delete de.dataset.agCsIgnoreRm;
        } catch {}
        changed = true;
      }
    }
    if (changed) {
      dispatchChangeEvent(win, doc, enabled);
    }
    return enabled;
  }

  function dispose(docOverride, winOverride) {
    const doc = resolveDoc(docOverride, winOverride);
    const de = doc && doc.documentElement;
    if (de) {
      try {
        if (typeof de.removeAttribute === 'function') de.removeAttribute(IGNORE_ATTR);
        if (de.dataset && 'agCsIgnoreRm' in de.dataset) delete de.dataset.agCsIgnoreRm;
      } catch {}
    }
  }

  return {
    IGNORE_ATTR,
    MOTION_ATTR,
    EVENT_NAME,
    isMotionLevelOff,
    isIgnoringReducedMotion,
    querySystemReducedMotion,
    isReducedMotion,
    applyIgnoreReducedMotion,
    dispose,
  };
});
