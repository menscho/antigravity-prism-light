// 扩展功能独立通道构建器：通道 5（思维链转译）、通道 9（设置面板与全量词典）、通道 10（双桌宠）、通道 11（Prompt Suggester）
'use strict';

const fs = require('fs');
const path = require('path');
const {
  getFileSig,
  sha256Text,
  computeHash,
  serializeJsonForEval,
} = require('../utils/fs-safe.cjs');
const { VALIDATORS, reconcileConfigAliases } = require('../config/schema.cjs');
const { resolveBundleCachePathOption } = require('../compiler/cache-validate.cjs');
const { packTextJsExpr } = require('../compiler/js-serializer.cjs');
const { minifyEmbeddedGlslTemplates } = require('../compiler/part-preprocess.cjs');
const { minifySingleSource } = require('../compiler/js-string-pool.cjs');
const { CHANNEL_MAIN_FRAME_HOST_GUARD } = require('./host-guard.cjs');

function createAddonChannelBuilders({ rootDir, readConfig, bundleCache }) {
  function shouldEnableThought(config = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    const raw = typeof cfg.thoughtTranslate === 'string' ? cfg.thoughtTranslate.trim().toLowerCase() : '';
    if (!raw || raw === 'off' || raw === 'false' || raw === '0' || raw === 'none') {
      return false;
    }
    return VALIDATORS.thoughtTranslate.includes(raw) || raw === 'on' || raw === 'auto';
  }

  function readCompiledThoughtAssets(opts = null) {
    const verbsPath = path.join(rootDir, 'vendor', 'thought-translator', 'tool-step-verbs.js');
    const clientPath = path.join(rootDir, 'vendor', 'thought-translator', 'thought-client.js');
    const settingsUiPath = path.join(rootDir, 'vendor', 'thought-translator', 'thought-settings-ui.js');
    if (!fs.existsSync(clientPath) || !fs.existsSync(settingsUiPath)) {
      return { sig: '', minClient: '', minSettingsUi: '', codeHash: '' };
    }
    const hasVerbs = fs.existsSync(verbsPath);
    const sig = `${hasVerbs ? getFileSig(verbsPath) : '0'}|${getFileSig(clientPath)}|${getFileSig(settingsUiPath)}`;
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('thought');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    const fileEntries = [];
    if (hasVerbs) fileEntries.push({ rel: 'vendor/thought-translator/tool-step-verbs.js', fullPath: verbsPath });
    fileEntries.push(
      { rel: 'vendor/thought-translator/thought-client.js', fullPath: clientPath },
      { rel: 'vendor/thought-translator/thought-settings-ui.js', fullPath: settingsUiPath }
    );
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'thought',
      sig,
      fileEntries,
      opts,
      compileFn: () => {
        const minClientParts = [];
        if (hasVerbs) minClientParts.push(minifySingleSource(fs.readFileSync(verbsPath, 'utf8'), { allowMemberProps: false }));
        minClientParts.push(minifySingleSource(fs.readFileSync(clientPath, 'utf8'), { allowMemberProps: false }));
        const minClient = minClientParts.join(';\n');
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

  // 第五通道独立注入（思维链实时转译 + AI 渠道工作台 UI）：默认 off 态 0 B Fail-Closed，支持零刷新热插拔与无损卸载
  function buildThoughtExpression(config = null, opts = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    if (!shouldEnableThought(cfg)) {
      return '';
    }
    const { minClient, minSettingsUi, codeHash } = readCompiledThoughtAssets(opts);
    if (!minClient || !minSettingsUi) {
      return '';
    }
    const rawMode = String(cfg.thoughtTranslate || '').trim().toLowerCase();
    const normalizedBootMode = rawMode === 'machine' ? 'machine' : 'ai';
    const bootCfg = {
      ...cfg,
      thoughtTranslate: normalizedBootMode,
    };
    const bootCfgJson = serializeJsonForEval(bootCfg);
    const hashJson = serializeJsonForEval(codeHash);

    return `(() => {
  try {
${CHANNEL_MAIN_FRAME_HOST_GUARD}

    const getSettingsSec = () => {
      try {
        return document.getElementById?.('ag-cs-settings-sec') || document.getElementById?.('ag-prism-settings-sec') || null;
      } catch {
        return null;
      }
    };
    const cleanupThought = () => {
      try { window.__agPrismThought?.destroy?.(); } catch {}
      try { document.querySelectorAll?.('[data-testid="prism-thought-ai-config"], [data-testid="prism-thought-general-config"]')?.forEach?.((el) => el.remove()); } catch {}
      try { delete window.__agPrismThought; } catch {}
      try { delete globalThis.__agPrismThought; } catch {}
      try { delete window.__agPrismToolStepVerbs; } catch {}
      try { delete globalThis.__agPrismToolStepVerbs; } catch {}
      try { delete window.__agPrismThoughtSettingsUi; } catch {}
      try { delete globalThis.__agPrismThoughtSettingsUi; } catch {}
      try {
        const sec = getSettingsSec();
        if (sec) {
          sec.__prismThoughtUiHandle = null;
          sec.__prismMountThoughtUi?.();
        }
      } catch {}
    };
    const getLiveCfg = () => {
      try {
        const st = window.__agPrism?.getState?.();
        return st && st.cfg && typeof st.cfg === 'object' ? st.cfg : null;
      } catch {
        return null;
      }
    };

    const bootCfg = ${bootCfgJson};
    const initialLiveCfg = getLiveCfg();
    if (initialLiveCfg && initialLiveCfg.thoughtTranslate === 'off') {
      cleanupThought();
      return { ok: true, status: 'off', skippedByLiveCfg: true };
    }

    const targetHash = ${hashJson};
    const mountOrReuse = () => {
      if (needDomMarkerOnReady && !hasDomMarker() && (isPlainHttpLocalhost || !/\\bantigravity\\b/i.test(String(document.title || '')))) {
        return { ok: false, status: 'skipped-non-host' };
      }
      const liveCfg = getLiveCfg();
      if (liveCfg && liveCfg.thoughtTranslate === 'off') {
        cleanupThought();
        return { ok: true, status: 'off', skippedByLiveCfg: true };
      }
      const effectiveCfg = liveCfg || bootCfg;
      const existingThought = window.__agPrismThought;
      const existingUi = window.__agPrismThoughtSettingsUi || globalThis.__agPrismThoughtSettingsUi;
      if (
        existingThought &&
        existingThought.__prismCodeHash === targetHash &&
        existingUi &&
        existingUi.__prismCodeHash === targetHash
      ) {
        try { existingThought.sync?.(effectiveCfg); } catch {}
        try { window.__agPrism?.syncAbsorbed?.(); } catch {}
        try { getSettingsSec()?.__prismMountThoughtUi?.(); } catch {}
        return { ok: true, reused: true, codeHash: targetHash };
      }

      cleanupThought();
      ;${minClient};
      ;${minSettingsUi};

      const mountedThought = window.__agPrismThought || globalThis.__agPrismThought;
      const mountedUi = window.__agPrismThoughtSettingsUi || globalThis.__agPrismThoughtSettingsUi;
      if (mountedThought && typeof mountedThought === 'object') {
        mountedThought.__prismCodeHash = targetHash;
        try { window.__agPrismThought = mountedThought; } catch {}
        try { globalThis.__agPrismThought = mountedThought; } catch {}
      }
      if (mountedUi && typeof mountedUi === 'object') {
        mountedUi.__prismCodeHash = targetHash;
        try { window.__agPrismThoughtSettingsUi = mountedUi; } catch {}
        try { globalThis.__agPrismThoughtSettingsUi = mountedUi; } catch {}
      }
      try { mountedThought?.sync?.(effectiveCfg); } catch {}
      try { window.__agPrism?.syncAbsorbed?.(); } catch {}
      try { getSettingsSec()?.__prismMountThoughtUi?.(); } catch {}
      return { ok: true, status: 'mounted', codeHash: targetHash };
    };

    if ((needDomMarkerOnReady || !document.documentElement) && typeof document.addEventListener === 'function') {
      document.addEventListener('DOMContentLoaded', () => { try { mountOrReuse(); } catch {} }, { once: true });
      return { ok: true, status: 'deferred', codeHash: targetHash };
    }
    return mountOrReuse();
  } catch (err) {
    return { ok: false, status: 'error', channel: 'thought', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  function readCompiledSettingsChannelAssets(opts = null) {
    const locPath = path.join(rootDir, 'i18n-locales.js');
    const setPath = path.join(rootDir, 'settings-panel.js');
    if (!fs.existsSync(locPath) || !fs.existsSync(setPath)) {
      return { sig: '', minRuntime: '', codeHash: '' };
    }
    const locTrPath = path.join(rootDir, 'src', 'runtime', 'i18n-tr-locale.js');
    const brandPath = path.join(rootDir, 'assets', 'brand-mark-svg.js');
    const atlasPath = path.join(rootDir, 'vendor', 'clawd-mascot', 'tavern-atlas-data.js');
    const stageGlPath = path.join(rootDir, 'vendor', 'clawd-mascot', 'octopath-stage-webgl.js');
    const i18nExtPath = path.join(rootDir, 'src', 'runtime', 'i18n-ext-beta4.js');
    const setExtPath = path.join(rootDir, 'src', 'runtime', 'settings-ext-beta4.js');
    const hasLocTr = fs.existsSync(locTrPath);
    const hasBrand = fs.existsSync(brandPath);
    const hasAtlas = fs.existsSync(atlasPath);
    const hasStageGl = fs.existsSync(stageGlPath);
    const hasI18nExt = fs.existsSync(i18nExtPath);
    const hasSetExt = fs.existsSync(setExtPath);
    const sig = `${hasLocTr ? getFileSig(locTrPath) : '0'}|${getFileSig(locPath)}|${hasBrand ? getFileSig(brandPath) : '0'}|${hasAtlas ? getFileSig(atlasPath) : '0'}|${hasStageGl ? getFileSig(stageGlPath) : '0'}|${getFileSig(setPath)}|${hasI18nExt ? getFileSig(i18nExtPath) : '0'}|${hasSetExt ? getFileSig(setExtPath) : '0'}`;
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('settings');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    const fileEntries = [];
    if (hasLocTr) fileEntries.push({ rel: 'src/runtime/i18n-tr-locale.js', fullPath: locTrPath });
    fileEntries.push({ rel: 'i18n-locales.js', fullPath: locPath });
    if (hasBrand) fileEntries.push({ rel: 'assets/brand-mark-svg.js', fullPath: brandPath });
    if (hasAtlas) fileEntries.push({ rel: 'vendor/clawd-mascot/tavern-atlas-data.js', fullPath: atlasPath });
    if (hasStageGl) fileEntries.push({ rel: 'vendor/clawd-mascot/octopath-stage-webgl.js', fullPath: stageGlPath });
    if (hasI18nExt) fileEntries.push({ rel: 'src/runtime/i18n-ext-beta4.js', fullPath: i18nExtPath });
    fileEntries.push({ rel: 'settings-panel.js', fullPath: setPath });
    if (hasSetExt) fileEntries.push({ rel: 'src/runtime/settings-ext-beta4.js', fullPath: setExtPath });
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'settings',
      sig,
      fileEntries,
      opts,
      compileFn: () => {
        const parts = [];
        if (hasLocTr) {
          try { delete require.cache[require.resolve(locTrPath)]; } catch {}
          const trData = require(locTrPath);
          const trJson = JSON.stringify(trData).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
          const packedTr = packTextJsExpr(trJson, 5600);
          parts.push(`globalThis.__agPrismI18nTr=JSON.parse(${packedTr});if(typeof window!=="undefined")window.__agPrismI18nTr=globalThis.__agPrismI18nTr`);
        }
        parts.push(minifySingleSource(fs.readFileSync(locPath, 'utf8'), { allowMemberProps: false }));
        if (hasBrand) parts.push(minifySingleSource(fs.readFileSync(brandPath, 'utf8'), { allowMemberProps: false }));
        if (hasAtlas) parts.push(fs.readFileSync(atlasPath, 'utf8').trim());
        if (hasStageGl) parts.push(minifySingleSource(minifyEmbeddedGlslTemplates(fs.readFileSync(stageGlPath, 'utf8')), { allowMemberProps: false }));
        if (hasI18nExt) parts.push(minifySingleSource(fs.readFileSync(i18nExtPath, 'utf8'), { allowMemberProps: false }));
        parts.push(minifySingleSource(fs.readFileSync(setPath, 'utf8'), { allowMemberProps: false }));
        if (hasSetExt) parts.push(minifySingleSource(fs.readFileSync(setExtPath, 'utf8'), { allowMemberProps: false }));
        const minRuntime = parts.join(';\n');
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

  // 第九通道：设置面板 + 全量 8 语言词典 + 3D 视差黑曜石星辰酒馆 WebGL2 选角舞台按需独立注入
  function buildSettingsChannelExpression(config = null, opts = null) {
    let resolvedOpts = opts;
    if (config && typeof config === 'object' && ('cachePath' in config || 'noDiskCache' in config || 'deferCacheWrite' in config) && !resolvedOpts) {
      resolvedOpts = config;
    }
    const { minRuntime, codeHash } = readCompiledSettingsChannelAssets(resolvedOpts);
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
    const targetHash = ${hashJson};
    const existingPanel = globalThis.__agPrismSettingsPanel || window.__agPrismSettingsPanel;
    const existingLoc = globalThis.__agCsLocales || window.__agCsLocales;
    if (existingPanel && existingPanel.__prismCodeHash === targetHash && existingLoc && existingLoc.__isFullLocales) {
      try { (window.__agPrism || window.__agClaudeStyle)?.sync?.(); } catch {}
      return { ok: true, reused: true, codeHash: targetHash };
    }
    try {
      const staleSec = document.getElementById?.('ag-cs-settings-sec');
      if (staleSec) {
        try { staleSec.querySelector?.('[data-testid="prism-wallpaper-slot"]')?.__agPrismWpUiHandle?.destroy?.(); } catch {}
        try { staleSec.querySelector?.('[data-testid="prism-suggester-slot"]')?.__agPrismSgUiHandle?.destroy?.(); } catch {}
        try { staleSec.__agMascotStageApi?.dispose?.(); } catch {}
        try { staleSec.__prismThoughtUiHandle = null; } catch {}
        staleSec.remove?.();
      }
    } catch {}
    ${minRuntime};
    try {
      const panel = globalThis.__agPrismSettingsPanel || window.__agPrismSettingsPanel;
      if (panel && typeof panel === 'object') {
        panel.__prismCodeHash = targetHash;
        window.__agPrismSettingsPanel = panel;
      }
      const loc = globalThis.__agCsLocales || window.__agCsLocales;
      if (loc && typeof loc === 'object') {
        loc.__isFullLocales = true;
        window.__agCsLocales = loc;
      }
    } catch {}
    try { (window.__agPrism || window.__agClaudeStyle)?.sync?.(); } catch {}
    try { document.getElementById('ag-cs-settings-sec')?.__prismMountThoughtUi?.(); } catch {}
    try { document.getElementById('ag-cs-settings-sec')?.__prismMountWp?.(); } catch {}
    try { (document.getElementById('ag-cs-settings-sec') || document.getElementById('ag-prism-settings-sec'))?.__prismMountSg?.(); } catch {}
    return { ok: true, codeHash: targetHash };
  } catch (err) {
    return { ok: false, status: 'error', channel: 'settings', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  function shouldEnableMascot(config = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    return cfg.mascot !== 'off' && cfg.mascot !== false;
  }

  function readCompiledMascotAssets(opts = null) {
    const hopPath = path.join(rootDir, 'src', 'runtime', 'mascot-hop-transition.js');
    const mascotPath = path.join(rootDir, 'dual-mascot-rig.js');
    if (!fs.existsSync(mascotPath)) {
      return { sig: '', minRuntime: '', codeHash: '' };
    }
    const hasHop = fs.existsSync(hopPath);
    const sig = `${hasHop ? getFileSig(hopPath) : '0'}|${getFileSig(mascotPath)}`;
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('mascot');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    const fileEntries = [];
    if (hasHop) fileEntries.push({ rel: 'src/runtime/mascot-hop-transition.js', fullPath: hopPath });
    fileEntries.push({ rel: 'dual-mascot-rig.js', fullPath: mascotPath });
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'mascot',
      sig,
      fileEntries,
      opts,
      compileFn: () => {
        const parts = [];
        if (hasHop) parts.push(minifySingleSource(fs.readFileSync(hopPath, 'utf8'), { allowMemberProps: false }));
        parts.push(minifySingleSource(fs.readFileSync(mascotPath, 'utf8'), { allowMemberProps: false }));
        const minRuntime = parts.join(';\n');
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

  // 第十通道：双桌宠（mascot-hop-transition.js + dual-mascot-rig.js）配置门控独立注入（mascot === 'off' 时 0 B）
  function buildMascotChannelExpression(config = null, opts = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    if (!shouldEnableMascot(cfg)) {
      return '';
    }
    const { minRuntime, codeHash } = readCompiledMascotAssets(opts);
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
      const liveCfg = window.__agPrism?.getState?.()?.cfg;
      if (liveCfg && (liveCfg.mascot === 'off' || liveCfg.mascot === false)) {
        try { (window.__agPrismMascotHop || globalThis.__agPrismMascotHop)?.dispose?.(); } catch {}
        try { window.__agDualMascotRig?.dispose?.(); } catch {}
        try { (window.__agPrism || window.__agClaudeStyle)?.sync?.(); } catch {}
        try { document.getElementById?.('ag-prism-mascot-hop-style')?.remove?.(); } catch {}
        try {
          document.querySelectorAll?.('.ag-cs-crab, .ag-cs-dual-stage, .ag-cs-crab-stage, .ag-cs-mascot-stage, .ag-v2-mascot-stage, .ag-v2-habitat-prop, .ag-prism-mascot-hop-layer').forEach((n) => {
            try { n.__agMascotApi?.dispose?.(); } catch {}
            n.remove?.();
          });
        } catch {}
        try { document.querySelectorAll?.('[data-ag-cs-crab-anchor]').forEach((n) => n.removeAttribute?.('data-ag-cs-crab-anchor')); } catch {}
        try { document.documentElement?.removeAttribute?.('data-ag-cs-has-crab'); document.documentElement?.removeAttribute?.('data-ag-cs-mascot-drag'); } catch {}
        try { delete window.__agDualMascotRig; delete globalThis.__agDualMascotRig; delete window.__agPrismMascotArt; delete globalThis.__agPrismMascotArt; delete window.__agPrismMascotHop; delete globalThis.__agPrismMascotHop; } catch {}
        return { ok: true, status: 'off', skippedByLiveCfg: true };
      }
    } catch {}
    const targetHash = ${hashJson};
    const existing = globalThis.__agDualMascotRig || window.__agDualMascotRig;
    if (existing && existing.__prismCodeHash === targetHash) {
      try { (window.__agPrism || window.__agClaudeStyle)?.sync?.(); } catch {}
      return { ok: true, reused: true, codeHash: targetHash };
    }
    ${minRuntime};
    try {
      const mod = globalThis.__agDualMascotRig || window.__agDualMascotRig;
      if (mod && typeof mod === 'object') {
        mod.__prismCodeHash = targetHash;
        window.__agDualMascotRig = mod;
      }
    } catch {}
    try { (window.__agPrism || window.__agClaudeStyle)?.sync?.(); } catch {}
    return { ok: true, codeHash: targetHash };
  } catch (err) {
    return { ok: false, status: 'error', channel: 'mascot', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  function readCompiledSuggesterAssets(opts = null) {
    const clientPath = path.join(rootDir, 'vendor', 'prompt-suggester', 'suggester-client.js');
    const settingsUiPath = path.join(rootDir, 'vendor', 'prompt-suggester', 'suggester-settings-ui.js');
    if (!fs.existsSync(clientPath) || !fs.existsSync(settingsUiPath)) {
      return { sig: '', minClient: '', minSettingsUi: '', codeHash: '' };
    }
    const sig = `${getFileSig(clientPath)}|${getFileSig(settingsUiPath)}`;
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('suggester');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'suggester',
      sig,
      fileEntries: [
        { rel: 'vendor/prompt-suggester/suggester-client.js', fullPath: clientPath },
        { rel: 'vendor/prompt-suggester/suggester-settings-ui.js', fullPath: settingsUiPath },
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

  // 第十一通道独立注入（对话续写幽灵补全 + 8 语种 Beta 设置卡片）
  function buildSuggesterExpression(config = null, opts = null) {
    let resolvedOpts = opts;
    if (
      !resolvedOpts &&
      config &&
      typeof config === 'object' &&
      ('cachePath' in config || 'noDiskCache' in config || 'deferCacheWrite' in config || 'customClientSource' in config)
    ) {
      resolvedOpts = config;
    }
    let minClient = '';
    let minSettingsUi = '';
    let codeHash = '';
    if (
      resolvedOpts &&
      typeof resolvedOpts.customClientSource === 'string' &&
      typeof resolvedOpts.customSettingsUiSource === 'string'
    ) {
      minClient = resolvedOpts.customClientSource ? minifySingleSource(resolvedOpts.customClientSource, { allowMemberProps: false }) : '';
      minSettingsUi = resolvedOpts.customSettingsUiSource ? minifySingleSource(resolvedOpts.customSettingsUiSource, { allowMemberProps: false }) : '';
      codeHash = minClient && minSettingsUi ? computeHash(`${minClient}\n${minSettingsUi}`) : '';
    } else {
      const compiled = readCompiledSuggesterAssets(resolvedOpts);
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
        if (sec && typeof sec.__prismMountSg === 'function') {
          sec.__prismMountSg();
          return;
        }
        const slot = document.querySelector?.('[data-testid="prism-suggester-slot"]');
        const fn = window.__prismMountSuggesterUi || globalThis.__prismMountSuggesterUi;
        if (slot && typeof fn === 'function') fn(slot, {});
      } catch {}
    };

    const cleanupSuggester = () => {
      try { (window.__agPrismSuggester || globalThis.__agPrismSuggester)?.destroy?.(); } catch {}
      try { (window.__agPrismSuggesterBridge || globalThis.__agPrismSuggesterBridge)?.dispose?.(); } catch {}
      try { document.getElementById?.('ag-prism-suggester-css')?.remove?.(); } catch {}
      try { document.getElementById?.('ag-prism-model-dd-css')?.remove?.(); } catch {}
      try { document.querySelectorAll?.('[data-testid="prism-suggest-trigger"], [data-testid="prism-ghost-overlay"]')?.forEach?.((n) => n.remove()); } catch {}
      try {
        document.querySelectorAll?.('[data-ag-prism-ghost-active]')?.forEach?.((el) => {
          el.removeAttribute('data-ag-prism-ghost-active');
          el.style?.removeProperty?.('--ag-prism-ghost-min-h');
        });
      } catch {}
      try {
        const slot = document.querySelector?.('[data-testid="prism-suggester-slot"]');
        if (slot) {
          try { slot.__agPrismSgUiHandle?.destroy?.(); } catch {}
          slot.__agPrismSgUiHandle = null;
          while (slot.firstChild) slot.removeChild(slot.firstChild);
        }
      } catch {}
      try { delete window.__agPrismSuggester; } catch {}
      try { delete globalThis.__agPrismSuggester; } catch {}
      try { delete window.__agPrismSuggesterFactory; } catch {}
      try { delete globalThis.__agPrismSuggesterFactory; } catch {}
      try { delete window.__agPrismSuggesterSettingsUi; } catch {}
      try { delete globalThis.__agPrismSuggesterSettingsUi; } catch {}
      try { delete window.__prismMountSuggesterUi; } catch {}
      try { delete globalThis.__prismMountSuggesterUi; } catch {}
      try { delete window.__agPrismSuggesterBridge; } catch {}
      try { delete globalThis.__agPrismSuggesterBridge; } catch {}
      try { delete window.__agPrismSuggesterResolve; } catch {}
      try { delete globalThis.__agPrismSuggesterResolve; } catch {}
    };

    const targetHash = ${hashJson};
    const mountOrReuse = () => {
      if (needDomMarkerOnReady && !hasDomMarker() && (isPlainHttpLocalhost || !/\\bantigravity\\b/i.test(String(document.title || '')))) {
        return { ok: false, status: 'skipped-non-host' };
      }
      const existing = window.__agPrismSuggester || globalThis.__agPrismSuggester;
      const existingUi = window.__agPrismSuggesterSettingsUi || globalThis.__agPrismSuggesterSettingsUi;
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

      cleanupSuggester();
      ;${minClient};
      ;${minSettingsUi};

      let mounted = window.__agPrismSuggester || globalThis.__agPrismSuggester;
      const factory = window.__agPrismSuggesterFactory || globalThis.__agPrismSuggesterFactory;
      if (!mounted && typeof factory === 'function') {
        try {
          mounted = factory({ window, document });
        } catch {}
      }
      if (mounted && typeof mounted === 'object') {
        mounted.__prismCodeHash = targetHash;
        try { window.__agPrismSuggester = mounted; } catch {}
        try { globalThis.__agPrismSuggester = mounted; } catch {}
      }
      const mountedUi = window.__agPrismSuggesterSettingsUi || globalThis.__agPrismSuggesterSettingsUi;
      if (mountedUi && typeof mountedUi === 'object') {
        mountedUi.__prismCodeHash = targetHash;
        try { window.__agPrismSuggesterSettingsUi = mountedUi; } catch {}
        try { globalThis.__agPrismSuggesterSettingsUi = mountedUi; } catch {}
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
    return { ok: false, status: 'error', channel: 'suggester', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  return {
    shouldEnableThought,
    buildThoughtExpression,
    buildSettingsChannelExpression,
    shouldEnableMascot,
    buildMascotChannelExpression,
    buildSuggesterExpression,
  };
}

module.exports = {
  createAddonChannelBuilders,
};
