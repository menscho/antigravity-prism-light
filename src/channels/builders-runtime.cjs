// 下沉运行期独立通道构建器：通道 13（Telemetry 遥测状态栏与实体试管）、通道 14（Effort Slider 推理档位滑条）、
// 通道 15（Workbench Enhancer 工作台深度增强）、通道 16（Context Menu /btw 右键菜单）
'use strict';

const fs = require('fs');
const path = require('path');
const {
  getFileSig,
  sha256Text,
  computeHash,
  serializeJsonForEval,
} = require('../utils/fs-safe.cjs');
const { reconcileConfigAliases } = require('../config/schema.cjs');
const { resolveBundleCachePathOption } = require('../compiler/cache-validate.cjs');
const { minifyEmbeddedCssTemplate } = require('../compiler/js-serializer.cjs');
const { minifySingleSource } = require('../compiler/js-string-pool.cjs');
const { stripUnusedUpstreamMenuObserver } = require('../compiler/part-preprocess.cjs');
const { CHANNEL_MAIN_FRAME_HOST_GUARD } = require('./host-guard.cjs');

function unwrapConfigAndOpts(config, opts, cfgKeys) {
  let resolvedCfg = config;
  let resolvedOpts = opts;
  if (
    !resolvedOpts &&
    config &&
    typeof config === 'object' &&
    ('cachePath' in config || 'noDiskCache' in config || 'deferCacheWrite' in config) &&
    !cfgKeys.some((k) => k in config)
  ) {
    resolvedOpts = config;
    resolvedCfg = null;
  }
  return { resolvedCfg, resolvedOpts };
}

function createRuntimeChannelBuilders({ rootDir, readConfig, bundleCache }) {
  // ── Channel 13: Telemetry (vial-core + pulse-vial-bridge + inline-fallback) ──
  function shouldEnableTelemetry(config = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    return cfg.telemetryModule !== 'off' && cfg.telemetryModule !== false;
  }

  function readCompiledTelemetryAssets(opts = null) {
    const rels = [
      'vial-core.js',
      'pulse-vial-bridge.js',
      'vendor/pulse-dashboard/inline-fallback.js',
    ];
    const absPaths = rels.map((rel) => path.join(rootDir, ...rel.split('/')));
    if (absPaths.some((p) => !fs.existsSync(p))) {
      return { sig: '', minRuntime: '', codeHash: '' };
    }
    const sig = absPaths.map((p) => getFileSig(p)).join('|');
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('telemetry');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    const fileEntries = rels.map((rel, i) => ({ rel, fullPath: absPaths[i] }));
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'telemetry',
      sig,
      fileEntries,
      opts,
      compileFn: () => {
        const vialMin = minifySingleSource(fs.readFileSync(absPaths[0], 'utf8'), { allowMemberProps: false });
        const bridgeMin = minifySingleSource(minifyEmbeddedCssTemplate(fs.readFileSync(absPaths[1], 'utf8')), { allowMemberProps: false });
        const fallbackMin = minifySingleSource(minifyEmbeddedCssTemplate(fs.readFileSync(absPaths[2], 'utf8')), { allowMemberProps: false });
        const minRuntime = [vialMin, bridgeMin, fallbackMin].join(';\n');
        const codeHash = computeHash(minRuntime);
        return { minRuntime, codeHash };
      },
      toCacheEntry: (assets, sourceHash) => ({
        sourceHash,
        codeHash: assets.codeHash,
        minRuntime: assets.minRuntime,
        payloadSha256: sha256Text(`${assets.codeHash}\0${assets.minRuntime}`),
        updatedAt: Date.now(),
      }),
      fromCacheEntry: (entry) => ({
        minRuntime: entry.minRuntime,
        codeHash: entry.codeHash,
      }),
    });
  }

  function buildTelemetryChannelExpression(config = null, opts = null) {
    const { resolvedCfg, resolvedOpts } = unwrapConfigAndOpts(config, opts, ['telemetryModule', 'telemetryQuotaMode', 'language', 'lang']);
    const cfg = resolvedCfg && typeof resolvedCfg === 'object' ? reconcileConfigAliases(resolvedCfg) : readConfig();
    if (!shouldEnableTelemetry(cfg)) return '';
    const { minRuntime, codeHash } = readCompiledTelemetryAssets(resolvedOpts);
    if (!minRuntime || !codeHash) return '';

    const bootCfgJson = serializeJsonForEval(cfg);
    const hashJson = serializeJsonForEval(codeHash);

    return `(() => {
  try {
${CHANNEL_MAIN_FRAME_HOST_GUARD}

    const cleanupTelemetry = () => {
      try { (window.__agPrism || window.__agClaudeStyle)?.detachTelemetry?.(); } catch {}
      try { (window.__agCsPulseBridgeInst || globalThis.__agCsPulseBridgeInst)?.destroy?.(); } catch {}
      try { (window.__agPrismTelemetry || globalThis.__agPrismTelemetry)?.destroy?.(); } catch {}
      try { document.querySelectorAll?.('[data-ag-prism-fallback="1"]')?.forEach?.((n) => n.remove()); } catch {}
      try {
        document.querySelectorAll?.('[data-ag-prism-hidden="1"]')?.forEach?.((el) => {
          el.removeAttribute('data-ag-prism-hidden');
          const st = el.style;
          if (st && typeof st.removeProperty === 'function') {
            ['display','position','left','top','width','height','opacity','pointer-events','visibility','overflow'].forEach((p) => st.removeProperty(p));
          }
        });
      } catch {}
      for (const k of ['__agPrismTelemetry','__agVialCore','__agCsPulseVialBridge','__agCsPulseBridgeInst']) {
        try { delete window[k]; } catch {}
        try { delete globalThis[k]; } catch {}
      }
    };
    const getLiveCfg = () => {
      try {
        const st = (window.__agPrism || window.__agClaudeStyle)?.getState?.();
        return st && st.cfg && typeof st.cfg === 'object' ? st.cfg : null;
      } catch { return null; }
    };

    const bootCfg = ${bootCfgJson};
    const targetHash = ${hashJson};
    const mountOrReuse = () => {
      if (needDomMarkerOnReady && !hasDomMarker() && (isPlainHttpLocalhost || !/\\bantigravity\\b/i.test(String(document.title || '')))) {
        return { ok: false, status: 'skipped-non-host' };
      }
      const liveCfg = getLiveCfg();
      if (liveCfg && (liveCfg.telemetryModule === 'off' || liveCfg.telemetryModule === false)) {
        cleanupTelemetry();
        return { ok: true, status: 'off', skippedByLiveCfg: true };
      }
      const effectiveCfg = liveCfg || bootCfg;
      const existing = window.__agPrismTelemetry || globalThis.__agPrismTelemetry;
      const hasVial = Boolean(window.__agVialCore || globalThis.__agVialCore);
      const hasBridge = Boolean(window.__agCsPulseVialBridge || globalThis.__agCsPulseVialBridge);
      if (existing && existing.__prismCodeHash === targetHash && hasVial && hasBridge) {
        try { existing.sync?.(effectiveCfg); } catch {}
        try { (window.__agPrism || window.__agClaudeStyle)?.syncTelemetry?.(); } catch {}
        return { ok: true, reused: true, codeHash: targetHash };
      }

      cleanupTelemetry();
      ;${minRuntime};

      const mounted = window.__agPrismTelemetry || globalThis.__agPrismTelemetry;
      if (mounted && typeof mounted === 'object') {
        mounted.__prismCodeHash = targetHash;
        try { window.__agPrismTelemetry = mounted; } catch {}
        try { globalThis.__agPrismTelemetry = mounted; } catch {}
      }
      const vc = globalThis.__agVialCore || window.__agVialCore;
      if (vc) { try { window.__agVialCore = vc; globalThis.__agVialCore = vc; } catch {} }
      const pv = globalThis.__agCsPulseVialBridge || window.__agCsPulseVialBridge;
      if (pv) { try { window.__agCsPulseVialBridge = pv; globalThis.__agCsPulseVialBridge = pv; } catch {} }
      try { mounted?.sync?.(effectiveCfg); } catch {}
      try { (window.__agPrism || window.__agClaudeStyle)?.syncTelemetry?.(); } catch {}
      try { (window.__agPrism || window.__agClaudeStyle)?.syncAbsorbed?.(); } catch {}
      return { ok: true, status: 'mounted', codeHash: targetHash };
    };

    if ((needDomMarkerOnReady || !document.documentElement) && typeof document.addEventListener === 'function') {
      document.addEventListener('DOMContentLoaded', () => { try { mountOrReuse(); } catch {} }, { once: true });
      return { ok: true, status: 'deferred', codeHash: targetHash };
    }
    return mountOrReuse();
  } catch (err) {
    return { ok: false, status: 'error', channel: 'telemetry', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  // ── Channel 14: Effort Slider (upstream-client + slider-coexist) ───────────
  function shouldEnableEffortSlider(config = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    const raw = cfg.effortSliderModule !== undefined ? cfg.effortSliderModule : cfg.effortSlider;
    return raw !== 'off' && raw !== false;
  }

  function readCompiledEffortSliderAssets(opts = null) {
    const upRel = 'vendor/effort-slider/upstream-client.js';
    const coRel = 'vendor/effort-slider/slider-coexist.js';
    const upPath = path.join(rootDir, 'vendor', 'effort-slider', 'upstream-client.js');
    const coPath = path.join(rootDir, 'vendor', 'effort-slider', 'slider-coexist.js');
    if (!fs.existsSync(upPath) || !fs.existsSync(coPath)) {
      return { sig: '', minRuntime: '', codeHash: '' };
    }
    const sig = `${getFileSig(upPath)}|${getFileSig(coPath)}`;
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('effortSlider');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'effortSlider',
      sig,
      fileEntries: [
        { rel: upRel, fullPath: upPath },
        { rel: coRel, fullPath: coPath },
      ],
      opts,
      compileFn: () => {
        const upPre = stripUnusedUpstreamMenuObserver(fs.readFileSync(upPath, 'utf8'));
        const upMin = minifySingleSource(upPre, { allowMemberProps: false });
        const coMin = minifySingleSource(fs.readFileSync(coPath, 'utf8'), { allowMemberProps: false });
        const minRuntime =
          'globalThis.__agCodexEffortSliderDisableAutoBoot=!0;if(typeof window!=="undefined")window.__agCodexEffortSliderDisableAutoBoot=!0;\n' +
          `${upMin};\n${coMin}`;
        const codeHash = computeHash(minRuntime);
        return { minRuntime, codeHash };
      },
      toCacheEntry: (assets, sourceHash) => ({
        sourceHash,
        codeHash: assets.codeHash,
        minRuntime: assets.minRuntime,
        payloadSha256: sha256Text(`${assets.codeHash}\0${assets.minRuntime}`),
        updatedAt: Date.now(),
      }),
      fromCacheEntry: (entry) => ({
        minRuntime: entry.minRuntime,
        codeHash: entry.codeHash,
      }),
    });
  }

  function buildEffortSliderChannelExpression(config = null, opts = null) {
    const { resolvedCfg, resolvedOpts } = unwrapConfigAndOpts(config, opts, ['effortSliderModule', 'effortSlider', 'effortMemory']);
    const cfg = resolvedCfg && typeof resolvedCfg === 'object' ? reconcileConfigAliases(resolvedCfg) : readConfig();
    if (!shouldEnableEffortSlider(cfg)) return '';
    const { minRuntime, codeHash } = readCompiledEffortSliderAssets(resolvedOpts);
    if (!minRuntime || !codeHash) return '';

    const bootCfgJson = serializeJsonForEval(cfg);
    const hashJson = serializeJsonForEval(codeHash);

    return `(() => {
  try {
${CHANNEL_MAIN_FRAME_HOST_GUARD}

    const cleanupEffortSlider = () => {
      try { (window.__agPrismEffortSlider || globalThis.__agPrismEffortSlider)?.destroy?.(); } catch {}
      try {
        if (window.__agCodexEffortSliderInstance && window.__agCodexEffortSliderInstance.__prismOwned) {
          try { window.__agCodexEffortSliderInstance.stop?.(); } catch {}
          delete window.__agCodexEffortSliderInstance;
        }
      } catch {}
      try { document.querySelector?.('#ag-codex-effort-slider-styles[data-ag-prism-slider="1"]')?.remove?.(); } catch {}
      try { document.getElementById?.('ag-prism-effort-slider-hide')?.remove?.(); } catch {}
      try { document.documentElement?.removeAttribute?.('data-ces-slider-ready'); } catch {}
      for (const k of ['__agPrismEffortSlider','AntigravityCodexEffortSlider','__agCodexEffortSliderDisableAutoBoot']) {
        try { delete window[k]; } catch {}
        try { delete globalThis[k]; } catch {}
      }
    };
    const getLiveCfg = () => {
      try {
        const st = (window.__agPrism || window.__agClaudeStyle)?.getState?.();
        return st && st.cfg && typeof st.cfg === 'object' ? st.cfg : null;
      } catch { return null; }
    };

    const bootCfg = ${bootCfgJson};
    const targetHash = ${hashJson};
    const mountOrReuse = () => {
      if (needDomMarkerOnReady && !hasDomMarker() && (isPlainHttpLocalhost || !/\\bantigravity\\b/i.test(String(document.title || '')))) {
        return { ok: false, status: 'skipped-non-host' };
      }
      const liveCfg = getLiveCfg();
      const liveMode = liveCfg ? (liveCfg.effortSliderModule !== undefined ? liveCfg.effortSliderModule : liveCfg.effortSlider) : undefined;
      if (liveMode === 'off' || liveMode === false) {
        cleanupEffortSlider();
        return { ok: true, status: 'off', skippedByLiveCfg: true };
      }
      const effectiveCfg = liveCfg || bootCfg;
      const existing = window.__agPrismEffortSlider || globalThis.__agPrismEffortSlider;
      if (existing && existing.__prismCodeHash === targetHash && typeof existing.sync === 'function') {
        try { existing.sync(effectiveCfg); } catch {}
        return { ok: true, reused: true, codeHash: targetHash };
      }

      cleanupEffortSlider();
      ;${minRuntime};

      const mounted = window.__agPrismEffortSlider || globalThis.__agPrismEffortSlider;
      if (mounted && typeof mounted === 'object') {
        mounted.__prismCodeHash = targetHash;
        try { window.__agPrismEffortSlider = mounted; } catch {}
        try { globalThis.__agPrismEffortSlider = mounted; } catch {}
      }
      try { mounted?.sync?.(effectiveCfg); } catch {}
      try { (window.__agPrism || window.__agClaudeStyle)?.syncAbsorbed?.(); } catch {}
      return { ok: true, status: 'mounted', codeHash: targetHash };
    };

    if ((needDomMarkerOnReady || !document.documentElement) && typeof document.addEventListener === 'function') {
      document.addEventListener('DOMContentLoaded', () => { try { mountOrReuse(); } catch {} }, { once: true });
      return { ok: true, status: 'deferred', codeHash: targetHash };
    }
    return mountOrReuse();
  } catch (err) {
    return { ok: false, status: 'error', channel: 'effortSlider', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  // ── Channel 15: Workbench Enhancer (host-workbench-enhancer.js) ────────────
  function shouldEnableWorkbenchEnhancer(config = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    if (cfg.workbenchEnhancer === 'off' || cfg.workbenchEnhancer === false) return false;
    if (
      cfg.sidebarRestyle === false &&
      (cfg.sidebarNavFold === 'off' || cfg.sidebarNavFold === false) &&
      (cfg.scrollBottomMotion === 'instant' || cfg.scrollBottomMotion === 'off') &&
      (cfg.motionLevel === 'off' || cfg.motionLevel === 'minimal')
    ) {
      return false;
    }
    return true;
  }

  function readCompiledWorkbenchEnhancerAssets(opts = null) {
    const filePath = path.join(rootDir, 'host-workbench-enhancer.js');
    if (!fs.existsSync(filePath)) {
      return { sig: '', minRuntime: '', codeHash: '' };
    }
    const sig = getFileSig(filePath);
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('workbenchEnhancer');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'workbenchEnhancer',
      sig,
      fileEntries: [{ rel: 'host-workbench-enhancer.js', fullPath: filePath }],
      opts,
      compileFn: () => {
        const minRuntime = minifySingleSource(fs.readFileSync(filePath, 'utf8'), { allowMemberProps: false });
        const codeHash = computeHash(minRuntime);
        return { minRuntime, codeHash };
      },
      toCacheEntry: (assets, sourceHash) => ({
        sourceHash,
        codeHash: assets.codeHash,
        minRuntime: assets.minRuntime,
        payloadSha256: sha256Text(`${assets.codeHash}\0${assets.minRuntime}`),
        updatedAt: Date.now(),
      }),
      fromCacheEntry: (entry) => ({
        minRuntime: entry.minRuntime,
        codeHash: entry.codeHash,
      }),
    });
  }

  function buildWorkbenchEnhancerChannelExpression(config = null, opts = null) {
    const { resolvedCfg, resolvedOpts } = unwrapConfigAndOpts(config, opts, [
      'workbenchEnhancer', 'sidebarRestyle', 'sidebar', 'sidebarNavFold', 'scrollBottomMotion', 'motionLevel',
    ]);
    const cfg = resolvedCfg && typeof resolvedCfg === 'object' ? reconcileConfigAliases(resolvedCfg) : readConfig();
    if (!shouldEnableWorkbenchEnhancer(cfg)) return '';
    const { minRuntime, codeHash } = readCompiledWorkbenchEnhancerAssets(resolvedOpts);
    if (!minRuntime || !codeHash) return '';

    const hashJson = serializeJsonForEval(codeHash);

    return `(() => {
  try {
${CHANNEL_MAIN_FRAME_HOST_GUARD}

    const cleanupEnhancer = () => {
      try { (window.__agPrism || window.__agClaudeStyle)?.detachHostEnhancer?.(); } catch {}
      try {
        document.querySelectorAll?.('.ag-cs-code-fold-btn,.ag-cs-nav-outline-popover,.ag-cs-nav-outline-trigger,.ag-cs-sb-more-wrap')?.forEach?.((n) => n.remove());
      } catch {}
      try { delete window.__agPrismHostEnhancer; } catch {}
      try { delete globalThis.__agPrismHostEnhancer; } catch {}
    };
    const isLiveDisabled = () => {
      try {
        const c = (window.__agPrism || window.__agClaudeStyle)?.getState?.()?.cfg;
        if (!c || typeof c !== 'object') return false;
        if (c.workbenchEnhancer === 'off' || c.workbenchEnhancer === false) return true;
        return c.sidebarRestyle === false && c.sidebarNavFold === 'off' && c.scrollBottomMotion === 'instant' && c.motionLevel === 'off';
      } catch { return false; }
    };

    const targetHash = ${hashJson};
    const mountOrReuse = () => {
      if (needDomMarkerOnReady && !hasDomMarker() && (isPlainHttpLocalhost || !/\\bantigravity\\b/i.test(String(document.title || '')))) {
        return { ok: false, status: 'skipped-non-host' };
      }
      if (isLiveDisabled()) {
        cleanupEnhancer();
        return { ok: true, status: 'off', skippedByLiveCfg: true };
      }
      const existing = window.__agPrismHostEnhancer || globalThis.__agPrismHostEnhancer;
      if (existing && existing.__prismCodeHash === targetHash) {
        try {
          const api = window.__agPrism || window.__agClaudeStyle;
          if (typeof api?.syncHostEnhancer === 'function') api.syncHostEnhancer();
          else api?.sync?.();
        } catch {}
        return { ok: true, reused: true, codeHash: targetHash };
      }

      cleanupEnhancer();
      ;${minRuntime};

      const mod = globalThis.__agPrismHostEnhancer || window.__agPrismHostEnhancer;
      if (mod && typeof mod === 'object') {
        mod.__prismCodeHash = targetHash;
        try { window.__agPrismHostEnhancer = mod; } catch {}
        try { globalThis.__agPrismHostEnhancer = mod; } catch {}
      }
      try {
        const api = window.__agPrism || window.__agClaudeStyle;
        if (typeof api?.syncHostEnhancer === 'function') api.syncHostEnhancer();
        else api?.sync?.();
      } catch {}
      return { ok: true, status: 'mounted', codeHash: targetHash };
    };

    if ((needDomMarkerOnReady || !document.documentElement) && typeof document.addEventListener === 'function') {
      document.addEventListener('DOMContentLoaded', () => { try { mountOrReuse(); } catch {} }, { once: true });
      return { ok: true, status: 'deferred', codeHash: targetHash };
    }
    return mountOrReuse();
  } catch (err) {
    return { ok: false, status: 'error', channel: 'workbenchEnhancer', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  // ── Channel 16: Context Menu & /btw (context-menu-btw.js) ──────────────────
  function shouldEnableContextMenu(config = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    return cfg.contextMenu !== false && cfg.contextMenu !== 'off';
  }

  function readCompiledContextMenuAssets(opts = null) {
    const filePath = path.join(rootDir, 'context-menu-btw.js');
    if (!fs.existsSync(filePath)) {
      return { sig: '', minRuntime: '', codeHash: '' };
    }
    const sig = getFileSig(filePath);
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('contextMenu');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'contextMenu',
      sig,
      fileEntries: [{ rel: 'context-menu-btw.js', fullPath: filePath }],
      opts,
      compileFn: () => {
        const minRuntime = minifySingleSource(fs.readFileSync(filePath, 'utf8'), { allowMemberProps: false });
        const codeHash = computeHash(minRuntime);
        return { minRuntime, codeHash };
      },
      toCacheEntry: (assets, sourceHash) => ({
        sourceHash,
        codeHash: assets.codeHash,
        minRuntime: assets.minRuntime,
        payloadSha256: sha256Text(`${assets.codeHash}\0${assets.minRuntime}`),
        updatedAt: Date.now(),
      }),
      fromCacheEntry: (entry) => ({
        minRuntime: entry.minRuntime,
        codeHash: entry.codeHash,
      }),
    });
  }

  function buildContextMenuChannelExpression(config = null, opts = null) {
    const { resolvedCfg, resolvedOpts } = unwrapConfigAndOpts(config, opts, ['contextMenu', 'language', 'lang', 'motionLevel']);
    const cfg = resolvedCfg && typeof resolvedCfg === 'object' ? reconcileConfigAliases(resolvedCfg) : readConfig();
    if (!shouldEnableContextMenu(cfg)) return '';
    const { minRuntime, codeHash } = readCompiledContextMenuAssets(resolvedOpts);
    if (!minRuntime || !codeHash) return '';

    const bootCfgJson = serializeJsonForEval(cfg);
    const hashJson = serializeJsonForEval(codeHash);

    return `(() => {
  try {
${CHANNEL_MAIN_FRAME_HOST_GUARD}

    const cleanupCtx = () => {
      try { (window.__agPrismContextMenu || globalThis.__agPrismContextMenu)?.destroy?.(); } catch {}
      try { document.querySelectorAll?.('.ag-cs-ctx-menu,.ag-cs-ctx-toast')?.forEach?.((n) => n.remove()); } catch {}
      try { delete window.__agPrismContextMenu; } catch {}
      try { delete globalThis.__agPrismContextMenu; } catch {}
    };
    const getLiveCfg = () => {
      try {
        const st = (window.__agPrism || window.__agClaudeStyle)?.getState?.();
        return st && st.cfg && typeof st.cfg === 'object' ? st.cfg : null;
      } catch { return null; }
    };

    const bootCfg = ${bootCfgJson};
    const targetHash = ${hashJson};
    const mountOrReuse = () => {
      if (needDomMarkerOnReady && !hasDomMarker() && (isPlainHttpLocalhost || !/\\bantigravity\\b/i.test(String(document.title || '')))) {
        return { ok: false, status: 'skipped-non-host' };
      }
      const liveCfg = getLiveCfg();
      if (liveCfg && (liveCfg.contextMenu === false || liveCfg.contextMenu === 'off')) {
        cleanupCtx();
        return { ok: true, status: 'off', skippedByLiveCfg: true };
      }
      const effectiveCfg = liveCfg || bootCfg;
      const syncOpts = {
        enabled: effectiveCfg.contextMenu !== false && effectiveCfg.contextMenu !== 'off',
        lang: effectiveCfg.language || effectiveCfg.lang || 'auto',
        motionLevel: effectiveCfg.motionLevel || 'ultra',
      };
      const existing = window.__agPrismContextMenu || globalThis.__agPrismContextMenu;
      if (existing && !existing.getState?.()?.destroyed && existing.__prismCodeHash === targetHash) {
        try { existing.sync?.(syncOpts); } catch {}
        try { (window.__agPrism || window.__agClaudeStyle)?.syncAbsorbed?.(); } catch {}
        return { ok: true, reused: true, codeHash: targetHash };
      }

      cleanupCtx();
      ;${minRuntime};

      const mounted = window.__agPrismContextMenu || globalThis.__agPrismContextMenu;
      if (mounted && typeof mounted === 'object') {
        mounted.__prismCodeHash = targetHash;
        try { window.__agPrismContextMenu = mounted; } catch {}
        try { globalThis.__agPrismContextMenu = mounted; } catch {}
      }
      try { mounted?.sync?.(syncOpts); } catch {}
      try { (window.__agPrism || window.__agClaudeStyle)?.syncAbsorbed?.(); } catch {}
      return { ok: true, status: 'mounted', codeHash: targetHash };
    };

    if ((needDomMarkerOnReady || !document.documentElement) && typeof document.addEventListener === 'function') {
      document.addEventListener('DOMContentLoaded', () => { try { mountOrReuse(); } catch {} }, { once: true });
      return { ok: true, status: 'deferred', codeHash: targetHash };
    }
    return mountOrReuse();
  } catch (err) {
    return { ok: false, status: 'error', channel: 'contextMenu', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  return {
    shouldEnableTelemetry,
    buildTelemetryChannelExpression,
    shouldEnableEffortSlider,
    buildEffortSliderChannelExpression,
    shouldEnableWorkbenchEnhancer,
    buildWorkbenchEnhancerChannelExpression,
    shouldEnableContextMenu,
    buildContextMenuChannelExpression,
  };
}

module.exports = {
  createRuntimeChannelBuilders,
};
