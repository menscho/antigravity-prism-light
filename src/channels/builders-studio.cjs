// 视觉与工作台独立通道构建器：通道 7（背景壁纸）、通道 8（元素周期表 3D 模型选择器）、通道 12（Studio 首页仪表盘）
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
const { CHANNEL_MAIN_FRAME_HOST_GUARD } = require('./host-guard.cjs');
const { PERIODIC_PICKER_MODULE_FILES } = require('./registry.cjs');

function createStudioChannelBuilders({ rootDir, readConfig, bundleCache }) {
  function readCompiledWallpaperAssets(opts = null) {
    const clientPath = path.join(rootDir, 'vendor', 'wallpaper', 'wallpaper-client.js');
    const settingsUiPath = path.join(rootDir, 'vendor', 'wallpaper', 'wallpaper-settings-ui.js');
    if (!fs.existsSync(clientPath) || !fs.existsSync(settingsUiPath)) {
      return { sig: '', minClient: '', minSettingsUi: '', codeHash: '' };
    }
    const sig = `${getFileSig(clientPath)}|${getFileSig(settingsUiPath)}`;
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('wallpaper');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'wallpaper',
      sig,
      fileEntries: [
        { rel: 'vendor/wallpaper/wallpaper-client.js', fullPath: clientPath },
        { rel: 'vendor/wallpaper/wallpaper-settings-ui.js', fullPath: settingsUiPath },
      ],
      opts,
      compileFn: () => {
        const minClient = minifySingleSource(fs.readFileSync(clientPath, 'utf8'), { allowMemberProps: false });
        const minSettingsUi = minifySingleSource(fs.readFileSync(settingsUiPath, 'utf8'), { allowMemberProps: false });
        const codeHash = computeHash(`${minClient}\n${minSettingsUi}`);
        return { minClient, minSettingsUi, codeHash };
      },
      toCacheEntry: (assets, sourceHash) => ({
        sourceHash,
        codeHash: assets.codeHash,
        minClient: assets.minClient,
        minSettingsUi: assets.minSettingsUi,
        payloadSha256: sha256Text(`${assets.codeHash}\0${assets.minClient}\0${assets.minSettingsUi}`),
        updatedAt: Date.now(),
      }),
      fromCacheEntry: (entry) => ({
        minClient: entry.minClient,
        minSettingsUi: entry.minSettingsUi,
        codeHash: entry.codeHash,
      }),
    });
  }

  // 第七通道独立注入（本地静态/动态背景壁纸引擎 + 5 语种设置卡片）：完全独立于 Channel 1，缺文件时安全返回 ''，支持 codeHash 幂等复用与零泄漏热卸载
  function buildWallpaperExpression(config = null, opts = null) {
    let minClient = '';
    let minSettingsUi = '';
    let codeHash = '';
    if (opts && typeof opts.customClientSource === 'string' && typeof opts.customSettingsUiSource === 'string') {
      minClient = opts.customClientSource ? minifySingleSource(opts.customClientSource, { allowMemberProps: false }) : '';
      minSettingsUi = opts.customSettingsUiSource ? minifySingleSource(opts.customSettingsUiSource, { allowMemberProps: false }) : '';
      codeHash = minClient && minSettingsUi ? computeHash(`${minClient}\n${minSettingsUi}`) : '';
    } else {
      const compiled = readCompiledWallpaperAssets(opts);
      minClient = compiled.minClient;
      minSettingsUi = compiled.minSettingsUi;
      codeHash = compiled.codeHash;
    }
    if (!minClient || !minSettingsUi || !codeHash) {
      return '';
    }

    const hashJson = serializeJsonForEval(codeHash);

    return `(() => {
  try {
${CHANNEL_MAIN_FRAME_HOST_GUARD}

    const mountSettingsSlot = () => {
      try {
        const sec = document.getElementById?.('ag-cs-settings-sec') || document.getElementById?.('ag-prism-settings-sec');
        if (sec && typeof sec.__prismMountWp === 'function') {
          sec.__prismMountWp();
          return;
        }
        const slot = document.querySelector?.('[data-testid="prism-wallpaper-slot"]');
        const fn = window.__prismMountWallpaperUi || globalThis.__prismMountWallpaperUi;
        if (slot && typeof fn === 'function') fn(slot, {});
      } catch {}
    };

    const cleanupWallpaper = () => {
      try {
        document.querySelectorAll?.('#ag-prism-wallpaper-root video')?.forEach?.((v) => {
          try { v.pause?.(); } catch {}
          try { v.removeAttribute?.('src'); } catch {}
          try { v.src = ''; } catch {}
          try { v.load?.(); } catch {}
        });
      } catch {}
      try { (window.__agPrismWallpaper || globalThis.__agPrismWallpaper)?.destroy?.(); } catch {}
      try { (window.__agPrismWallpaperBridge || globalThis.__agPrismWallpaperBridge)?.dispose?.(); } catch {}
      try { document.getElementById?.('ag-prism-wallpaper-root')?.remove?.(); } catch {}
      try { document.getElementById?.('ag-prism-wallpaper-css')?.remove?.(); } catch {}
      try {
        const slot = document.querySelector?.('[data-testid="prism-wallpaper-slot"]');
        if (slot) {
          try { slot.__agPrismWpUiHandle?.destroy?.(); } catch {}
          slot.__agPrismWpUiHandle = null;
          while (slot.firstChild) slot.removeChild(slot.firstChild);
        }
      } catch {}
      try { delete window.__agPrismWallpaper; } catch {}
      try { delete globalThis.__agPrismWallpaper; } catch {}
      try { delete window.__agPrismWallpaperFactory; } catch {}
      try { delete globalThis.__agPrismWallpaperFactory; } catch {}
      try { delete window.__agPrismWallpaperSettingsUi; } catch {}
      try { delete globalThis.__agPrismWallpaperSettingsUi; } catch {}
      try { delete window.__prismMountWallpaperUi; } catch {}
      try { delete globalThis.__prismMountWallpaperUi; } catch {}
      try { delete window.__agPrismWallpaperBridge; } catch {}
      try { delete globalThis.__agPrismWallpaperBridge; } catch {}
      try { delete window.__agPrismWallpaperResolve; } catch {}
      try { delete globalThis.__agPrismWallpaperResolve; } catch {}
    };

    const targetHash = ${hashJson};
    const mountOrReuse = () => {
      if (needDomMarkerOnReady && !hasDomMarker() && (isPlainHttpLocalhost || !/\\bantigravity\\b/i.test(String(document.title || '')))) {
        return { ok: false, status: 'skipped-non-host' };
      }
      const existing = window.__agPrismWallpaper || globalThis.__agPrismWallpaper;
      const existingUi = window.__agPrismWallpaperSettingsUi || globalThis.__agPrismWallpaperSettingsUi;
      if (
        existing &&
        !existing.getDebugState?.()?.destroyed &&
        existing.__prismCodeHash === targetHash &&
        existingUi &&
        existingUi.__prismCodeHash === targetHash
      ) {
        try { existing.sync?.(); } catch {}
        mountSettingsSlot();
        return { ok: true, reused: true, codeHash: targetHash };
      }

      cleanupWallpaper();
      ;${minClient};
      ;${minSettingsUi};

      let mounted = window.__agPrismWallpaper || globalThis.__agPrismWallpaper;
      const factory = window.__agPrismWallpaperFactory || globalThis.__agPrismWallpaperFactory;
      if (!mounted && typeof factory === 'function') {
        try {
          mounted = factory({ window, document });
        } catch {}
      }
      if (mounted && typeof mounted === 'object') {
        mounted.__prismCodeHash = targetHash;
        try { window.__agPrismWallpaper = mounted; } catch {}
        try { globalThis.__agPrismWallpaper = mounted; } catch {}
      }
      const mountedUi = window.__agPrismWallpaperSettingsUi || globalThis.__agPrismWallpaperSettingsUi;
      if (mountedUi && typeof mountedUi === 'object') {
        mountedUi.__prismCodeHash = targetHash;
        try { window.__agPrismWallpaperSettingsUi = mountedUi; } catch {}
        try { globalThis.__agPrismWallpaperSettingsUi = mountedUi; } catch {}
      }
      try { mounted?.sync?.(); } catch {}
      mountSettingsSlot();
      return { ok: true, status: 'mounted', codeHash: targetHash };
    };

    if ((needDomMarkerOnReady || !document.documentElement) && typeof document.addEventListener === 'function') {
      document.addEventListener('DOMContentLoaded', () => { try { mountOrReuse(); } catch {} }, { once: true });
      return { ok: true, status: 'deferred', codeHash: targetHash };
    }
    return mountOrReuse();
  } catch (err) {
    return { ok: false, status: 'error', channel: 'wallpaper', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  function shouldEnablePeriodicPicker(config) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    return cfg.periodicModelPicker !== 'off' && cfg.periodicModelPicker !== false;
  }

  // 纯数据表模块（非热渲染循环）保留属性键池化，给 Ch8 820 KB 预算留足充裕安全余量，其余 6 个热交互/渲染模块恢复原生 V8 .prop IC
  const PERIODIC_PICKER_DATA_ONLY_MODULES = new Set(['pbr-grain-assets.js', 'model-catalog.js']);

  function readCompiledPeriodicPickerStubAssets(opts = null) {
    const stubPath = path.join(rootDir, 'vendor', 'periodic-picker', 'periodic-picker-stub.js');
    if (!fs.existsSync(stubPath)) {
      return { sig: '', minRuntime: '', codeHash: '' };
    }
    const sig = getFileSig(stubPath);
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('periodicPickerStub');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    const fileEntries = [{ rel: 'vendor/periodic-picker/periodic-picker-stub.js', fullPath: stubPath }];
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'periodicPickerStub',
      sig,
      fileEntries,
      opts,
      compileFn: () => {
        const raw = fs.readFileSync(stubPath, 'utf8');
        const minRuntime = minifySingleSource(raw, { allowMemberProps: false });
        const codeHash = minRuntime ? computeHash(minRuntime) : '';
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

  // 第八通道首帧轻触发桩（<2 KB）：监听 [data-testid="model-selector-trigger"] hover 预热与 pointerdown，经控制信道按需拉取完整 8 模块包；off 态连桩也不注入
  function buildPeriodicPickerStubExpression(config = null, opts = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    if (!shouldEnablePeriodicPicker(cfg)) {
      return '';
    }
    const { minRuntime, codeHash } = readCompiledPeriodicPickerStubAssets(opts);
    if (!minRuntime || !codeHash) {
      return '';
    }
    const hashJson = serializeJsonForEval(codeHash);

    return `(() => {
  try {
${CHANNEL_MAIN_FRAME_HOST_GUARD}

    try {
      const liveCfg = window.__agPrism?.getState?.()?.cfg;
      if (liveCfg && typeof liveCfg === 'object' && (liveCfg.periodicModelPicker === 'off' || liveCfg.periodicModelPicker === false)) {
        try { window.__agPrismPeriodicStub?.destroy?.(); } catch {}
        try { window.__agPrismPeriodicPicker?.destroy?.(); } catch {}
        try { document.getElementById?.('ag-prism-periodic-stub-css')?.remove?.(); } catch {}
        for (const k of ['__agPrismPeriodicStub', '__agPrismPeriodicStubFactory', '__agPeriodicPendingOpen', '__agPeriodicFullLoaded', '__agPeriodicStubHash']) {
          try { delete window[k]; } catch {}
          try { delete globalThis[k]; } catch {}
        }
        return { ok: true, status: 'off', skippedByLiveCfg: true };
      }
    } catch {}

    const targetHash = ${hashJson};
    const mountOrReuse = () => {
      if (needDomMarkerOnReady && !hasDomMarker() && (isPlainHttpLocalhost || !/\\bantigravity\\b/i.test(String(document.title || '')))) {
        return { ok: false, status: 'skipped-non-host' };
      }
      const fullInst = window.__agPrismPeriodicPicker;
      if (window.__agPeriodicFullLoaded === true && fullInst) {
        const st = typeof fullInst.getStatus === 'function' ? fullInst.getStatus() : null;
        if (!st || (st.status !== 'off' && st.status !== 'destroyed')) {
          try { window.__agPeriodicStubHash = targetHash; } catch {}
          return { ok: true, reused: true, fullLoaded: true, codeHash: targetHash };
        }
      }
      const existingStub = window.__agPrismPeriodicStub;
      if (existingStub && existingStub.__prismCodeHash === targetHash) {
        const st = typeof existingStub.getStatus === 'function' ? existingStub.getStatus() : null;
        if (!st || (st.status !== 'off' && st.status !== 'destroyed')) {
          try { window.__agPeriodicStubHash = targetHash; } catch {}
          return { ok: true, reused: true, stub: true, codeHash: targetHash };
        }
      }
      try { existingStub?.destroy?.(); } catch {}
      ${minRuntime};
      const factory = window.__agPrismPeriodicStubFactory || globalThis.__agPrismPeriodicStubFactory;
      if (!factory || typeof factory.mountPeriodicPickerStub !== 'function') {
        return { ok: false, status: 'stub-factory-missing' };
      }
      const stub = factory.mountPeriodicPickerStub({ root: window, doc: document });
      if (stub && typeof stub === 'object') {
        stub.__prismCodeHash = targetHash;
        if (!window.__agPrismPeriodicStub) window.__agPrismPeriodicStub = stub;
      }
      try {
        if (!document.getElementById?.('ag-prism-periodic-stub-css') && !document.getElementById?.('ag-prism-periodic-picker-css') && document.createElement) {
          const p = document.head || document.documentElement;
          if (p && typeof p.appendChild === 'function') {
            const st = document.createElement('style');
            st.id = 'ag-prism-periodic-stub-css';
            st.textContent = '.ag-pp-mini-keycap{display:inline-flex;align-items:center;justify-content:center;gap:.5px;height:16px;padding:0 5px;margin:0 2px;border-radius:4px;box-sizing:border-box;flex:0 0 auto;background:var(--mk-bg,rgba(255,255,255,.045));color:var(--mk-fg,var(--secondary-foreground,#C8D0DF));border:1px solid var(--mk-border,rgba(218,228,255,.19));font:600 9.5px/1 var(--ag-cs-mono-stack,ui-monospace,monospace);pointer-events:none;user-select:none}.ag-pp-mk-z{font-size:7.5px;opacity:.78}';
            p.appendChild(st);
          }
        }
      } catch {}
      try { window.__agPeriodicStubHash = targetHash; } catch {}
      return { ok: true, status: 'stub', codeHash: targetHash };
    };

    if (needDomMarkerOnReady && typeof document.addEventListener === 'function') {
      document.addEventListener('DOMContentLoaded', () => { try { mountOrReuse(); } catch {} }, { once: true });
      return { ok: true, status: 'deferred', codeHash: targetHash };
    }
    return mountOrReuse();
  } catch (err) {
    return { ok: false, status: 'error', channel: 'periodicPicker', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  function readCompiledPeriodicPickerAssets(opts = null) {
    const baseDir = path.join(rootDir, 'vendor', 'periodic-picker');
    const rtPath = path.join(baseDir, 'periodic-picker.js');
    if (!fs.existsSync(rtPath)) {
      return { sig: '', minRuntime: '', codeHash: '' };
    }
    const presentModules = [];
    const sigParts = [];
    for (const name of PERIODIC_PICKER_MODULE_FILES) {
      const filePath = path.join(baseDir, name);
      if (fs.existsSync(filePath)) {
        presentModules.push({ name, filePath, rel: `vendor/periodic-picker/${name}` });
        sigParts.push(`${name}:${getFileSig(filePath)}`);
      } else {
        sigParts.push(`${name}:none`);
      }
    }
    const sig = sigParts.join('|');
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('periodicPicker');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    const fileEntries = presentModules.map((mod) => ({
      rel: mod.rel,
      fullPath: mod.filePath,
      name: mod.name,
    }));
    const extraTag = presentModules.map((mod) => mod.name).join(',');
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'periodicPicker',
      sig,
      fileEntries,
      extraTag,
      opts,
      compileFn: () => {
        const parts = [];
        for (const item of fileEntries) {
          const buf = Buffer.isBuffer(item.content) ? item.content : fs.readFileSync(item.fullPath);
          const allowMemberProps = PERIODIC_PICKER_DATA_ONLY_MODULES.has(item.name);
          const minPart = minifySingleSource(buf.toString('utf8'), { allowMemberProps });
          if (minPart) parts.push(minPart);
        }
        const minRuntime = parts.join(';\n');
        const codeHash = minRuntime ? computeHash(minRuntime) : '';
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

  // 第八通道完整包按需注入（元素周期表 3D 模型选择器 8 模块）：绝不打入静态主包，加载后自动接管轻桩与挂起打开状态并 100% 对称卸载
  function buildPeriodicPickerExpression(config = null, opts = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    if (!shouldEnablePeriodicPicker(cfg)) {
      return '';
    }
    const { minRuntime, codeHash } = readCompiledPeriodicPickerAssets(opts);
    if (!minRuntime || !codeHash) {
      return '';
    }
    const hashJson = serializeJsonForEval(codeHash);

    return `(() => {
  try {
${CHANNEL_MAIN_FRAME_HOST_GUARD}

    try {
      const liveCfg = window.__agPrism?.getState?.()?.cfg;
      if (liveCfg && typeof liveCfg === 'object' && (liveCfg.periodicModelPicker === 'off' || liveCfg.periodicModelPicker === false)) {
        try {
          window.__agPrismPeriodicStub?.destroy?.();
          window.__agPrismPeriodicPicker?.destroy?.();
          document.documentElement?.removeAttribute?.('data-ag-prism-periodic-picker');
          document.documentElement?.removeAttribute?.('data-ag-pp-open');
          document.documentElement?.removeAttribute?.('data-ag-pp-holding');
          document.querySelectorAll?.('#ag-prism-periodic-stub-css, #ag-prism-periodic-picker-css, #ag-prism-periodic-picker-root, .ag-pp-hold-ring, .ag-pp-mini-keycap').forEach((n) => n.remove());
          for (const k of ['__agPrismPeriodicStub', '__agPrismPeriodicStubFactory', '__agPeriodicPendingOpen', '__agPeriodicFullLoaded', '__agPeriodicStubHash', '__agPrismPeriodicPicker', '__agPrismPeriodicPickerFactory', '__agPrismKeyboard3D', '__agPrismPeriodicKeyboard3D', '__agPrismOledScreen', '__agPrismGrainAssets', '__agPeriodicAudioFx', '__agPeriodicModelCatalog', '__agPeriodicHostBridge', '__agPeriodicBentoUi', '__agPeriodicPbrGrainAssets', '__agPeriodicOledScreen', '__agPeriodicKeyboard3D']) {
            try { delete window[k]; } catch {}
            try { delete globalThis[k]; } catch {}
          }
        } catch {}
        return { ok: true, status: 'off', skippedByLiveCfg: true };
      }
    } catch {}

    const targetHash = ${hashJson};
    const consumePendingOpen = (inst) => {
      try {
        const pending = window.__agPeriodicPendingOpen;
        if (!pending || typeof pending !== 'object') return;
        try { delete window.__agPeriodicPendingOpen; } catch {}
        if (!pending.autoOpen || pending.releasedEarly || typeof inst?.open !== 'function') return;
        const downAt = Number(pending.pointerDownAt) || 0;
        const now = Date.now();
        const ageMs = now - downAt;
        if (ageMs < 0 || ageMs >= 2500) return;
        if (pending.releasedAt) {
          if (Number(pending.releasedAt) - downAt >= 260) inst.open(pending.trigger || undefined);
          return;
        }
        if (ageMs >= 260) {
          inst.open(pending.trigger || undefined);
          return;
        }
        // 拉包快于 260ms 且用户仍按住不放：补齐剩余长按时长，中途松手则静默取消防短按误弹
        if (typeof setTimeout === 'function' && typeof document.addEventListener === 'function') {
          let done = false;
          const cleanup = () => {
            if (done) return;
            done = true;
            try { clearTimeout(tm); } catch {}
            try { document.removeEventListener('pointerup', onUp, true); } catch {}
            try { document.removeEventListener('pointercancel', onUp, true); } catch {}
          };
          const onUp = () => { cleanup(); };
          document.addEventListener('pointerup', onUp, true);
          document.addEventListener('pointercancel', onUp, true);
          const tm = setTimeout(() => {
            if (done) return;
            cleanup();
            try {
              const st = typeof inst.getStatus === 'function' ? inst.getStatus() : null;
              if (!st || (st.status !== 'off' && st.status !== 'destroyed')) inst.open(pending.trigger || undefined);
            } catch {}
          }, Math.max(16, 260 - ageMs));
        }
      } catch {}
    };
    const mountOrReuse = () => {
      if (needDomMarkerOnReady && !hasDomMarker() && (isPlainHttpLocalhost || !/\\bantigravity\\b/i.test(String(document.title || '')))) {
        return { ok: false, status: 'skipped-non-host' };
      }
      const existing = window.__agPrismPeriodicPicker;
      if (existing && existing.__prismCodeHash === targetHash) {
        const st = typeof existing.getStatus === 'function' ? existing.getStatus() : null;
        const domActive = !document.documentElement || document.documentElement.getAttribute('data-ag-prism-periodic-picker') === '1';
        if ((!st || (st.status !== 'off' && st.status !== 'destroyed' && st.mode !== 'off')) && domActive) {
          try { document.getElementById?.('ag-prism-periodic-stub-css')?.remove?.(); } catch {}
          try { window.__agPrismPeriodicStub?.destroy?.(true); } catch {}
          try { window.__agPeriodicFullLoaded = true; globalThis.__agPeriodicFullLoaded = true; } catch {}
          consumePendingOpen(existing);
          return { ok: true, reused: true, codeHash: targetHash, ...(st && typeof st === 'object' ? st : {}) };
        }
      }
      try { document.getElementById?.('ag-prism-periodic-stub-css')?.remove?.(); } catch {}
      try { window.__agPrismPeriodicStub?.destroy?.(true); } catch {}
      try { delete window.__agPrismPeriodicStub; delete window.__agPrismPeriodicStubFactory; } catch {}
      try { existing?.destroy?.(); } catch {}

      ${minRuntime};
      const factory = window.__agPrismPeriodicPickerFactory || globalThis.__agPrismPeriodicPickerFactory;
      if (!factory || typeof factory.mountPeriodicPicker !== 'function') {
        return { ok: false, status: 'factory-missing' };
      }
      const inst = factory.mountPeriodicPicker({
        root: window,
        doc: document,
        mode: 'on',
      });
      if (inst && typeof inst === 'object') {
        inst.__prismCodeHash = targetHash;
        if (!window.__agPrismPeriodicPicker) window.__agPrismPeriodicPicker = inst;
      }
      try { window.__agPeriodicFullLoaded = true; globalThis.__agPeriodicFullLoaded = true; } catch {}
      consumePendingOpen(inst);
      const cur = inst && typeof inst.getStatus === 'function' ? inst.getStatus() : { status: 'active' };
      return { ok: true, codeHash: targetHash, ...(cur && typeof cur === 'object' ? cur : {}) };
    };

    if (needDomMarkerOnReady && typeof document.addEventListener === 'function') {
      document.addEventListener('DOMContentLoaded', () => { try { mountOrReuse(); } catch {} }, { once: true });
      return { ok: true, status: 'deferred', codeHash: targetHash };
    }
    return mountOrReuse();
  } catch (err) {
    return { ok: false, status: 'error', channel: 'periodicPicker', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  function shouldEnableHomeStudio(config = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    return (cfg.homeLayout || cfg.homeMode || 'studio') === 'studio';
  }

  function readCompiledHomeStudioAssets(opts = null) {
    const studioPath = path.join(rootDir, 'home-studio-panel.js');
    const usagePath = path.join(rootDir, 'usage-core.js');
    if (!fs.existsSync(studioPath)) {
      return { sig: '', minRuntime: '', codeHash: '' };
    }
    const hasUsage = fs.existsSync(usagePath);
    const sig = hasUsage ? `${getFileSig(usagePath)}|${getFileSig(studioPath)}` : getFileSig(studioPath);
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('homeStudio');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    const fileEntries = hasUsage
      ? [
          { rel: 'usage-core.js', fullPath: usagePath },
          { rel: 'home-studio-panel.js', fullPath: studioPath },
        ]
      : [{ rel: 'home-studio-panel.js', fullPath: studioPath }];
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'homeStudio',
      sig,
      fileEntries,
      opts,
      compileFn: () => {
        const studioSrc = minifyEmbeddedCssTemplate(fs.readFileSync(studioPath, 'utf8'));
        const combined = hasUsage ? `${fs.readFileSync(usagePath, 'utf8')}\n;\n${studioSrc}` : studioSrc;
        const minRuntime = minifySingleSource(combined);
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

  // 第十二通道独立注入（Studio 首页用量仪表盘与缓存控制器）：完全独立于 Channel 1，接入磁盘缓存，支持幂等复用、热替换旧实例与零泄漏卸载
  function buildHomeStudioChannelExpression(config = null, opts = null) {
    let resolvedCfg = config;
    let resolvedOpts = opts;
    if (
      !resolvedOpts &&
      config &&
      typeof config === 'object' &&
      ('cachePath' in config || 'noDiskCache' in config || 'deferCacheWrite' in config) &&
      !('homeLayout' in config) &&
      !('homeMode' in config)
    ) {
      resolvedOpts = config;
      resolvedCfg = null;
    }
    const cfg = resolvedCfg && typeof resolvedCfg === 'object' ? reconcileConfigAliases(resolvedCfg) : readConfig();
    if (!shouldEnableHomeStudio(cfg)) {
      return '';
    }
    const { minRuntime, codeHash } = readCompiledHomeStudioAssets(resolvedOpts);
    if (!minRuntime || !codeHash) {
      return '';
    }
    const hashJson = serializeJsonForEval(codeHash);
    return `(() => {
  try {
    try {
      if (window.self !== window.top) return { ok: false, status: 'skipped-subframe' };
    } catch {
      return { ok: false, status: 'skipped-subframe' };
    }
    try {
      const loc = typeof window !== 'undefined' && window.location;
      const href = loc && typeof loc.href === 'string' ? loc.href : '';
      if (href) {
        const low = href.toLowerCase();
        if (low.startsWith('devtools://') || low.startsWith('data:') || low.startsWith('chrome:') || low.startsWith('chrome-extension:') || low.startsWith('edge:') || low.startsWith('blob:') || low.startsWith('plugin:')) {
          return { ok: false, status: 'skipped-non-host' };
        }
      }
    } catch {}
    try {
      const liveCfg = (window.__agPrism || window.__agClaudeStyle)?.getState?.()?.cfg;
      if (liveCfg && typeof liveCfg === 'object' && (liveCfg.homeLayout || liveCfg.homeMode || 'studio') !== 'studio') {
        try { (window.__agPrism || window.__agClaudeStyle)?.detachHomeStudio?.(); } catch {}
        try { document.getElementById?.('ag-prism-studio-v101-css')?.remove?.(); } catch {}
        try { document.querySelectorAll?.('.ag-cs-home-panel-seat, .ag-cs-home-panel')?.forEach?.((n) => n.remove()); } catch {}
        try { document.documentElement?.removeAttribute?.('data-ag-prism-scope'); } catch {}
        try { delete window.__agPrismHomeStudioPanel; delete globalThis.__agPrismHomeStudioPanel; delete window.__agHomeStudioPanel; delete globalThis.__agHomeStudioPanel; } catch {}
        return { ok: true, status: 'off', skippedByLiveCfg: true };
      }
    } catch {}
    const targetHash = ${hashJson};
    const existing = globalThis.__agPrismHomeStudioPanel || window.__agPrismHomeStudioPanel || globalThis.__agHomeStudioPanel || window.__agHomeStudioPanel;
    if (existing && existing.__prismCodeHash === targetHash) {
      try {
        const api = window.__agPrism || window.__agClaudeStyle;
        if (typeof api?.syncHomeStudio === 'function') api.syncHomeStudio();
        else api?.sync?.();
      } catch {}
      return { ok: true, reused: true, codeHash: targetHash };
    }
    try { (window.__agPrism || window.__agClaudeStyle)?.detachHomeStudio?.(); } catch {}
    ${minRuntime};
    try {
      const mod = globalThis.__agPrismHomeStudioPanel || window.__agPrismHomeStudioPanel || globalThis.__agHomeStudioPanel || window.__agHomeStudioPanel;
      if (mod && typeof mod === 'object') {
        mod.__prismCodeHash = targetHash;
        window.__agPrismHomeStudioPanel = mod;
        globalThis.__agPrismHomeStudioPanel = mod;
        window.__agHomeStudioPanel = mod;
        globalThis.__agHomeStudioPanel = mod;
      }
    } catch {}
    try {
      const api = window.__agPrism || window.__agClaudeStyle;
      if (typeof api?.syncHomeStudio === 'function') api.syncHomeStudio();
      else api?.sync?.();
    } catch {}
    return { ok: true, status: 'mounted', codeHash: targetHash };
  } catch (err) {
    return { ok: false, status: 'error', channel: 'homeStudio', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  return {
    PERIODIC_PICKER_MODULE_FILES,
    buildWallpaperExpression,
    shouldEnablePeriodicPicker,
    buildPeriodicPickerStubExpression,
    buildPeriodicPickerExpression,
    shouldEnableHomeStudio,
    buildHomeStudioChannelExpression,
  };
}

module.exports = {
  PERIODIC_PICKER_MODULE_FILES,
  createStudioChannelBuilders,
};
