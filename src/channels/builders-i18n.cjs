// 宿主本地化独立通道构建器：通道 4（Host UI 按语种动态本地化 / 反向英文还原）与层 B（Swarm 侧栏按语种本地化）
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
const { packTextJsExpr } = require('../compiler/js-serializer.cjs');
const { minifySingleSource } = require('../compiler/js-string-pool.cjs');
const { CHANNEL_MAIN_FRAME_HOST_GUARD } = require('./host-guard.cjs');

const DICT_COMPRESS_THRESHOLD_BYTES = 470000;

function createI18nChannelBuilders({ rootDir, readConfig, detectSystemUiLocale, bundleCache }) {
  function resolveHostI18nLocale(language, hostLocaleHint = null) {
    const raw = String(language || 'auto').trim().toLowerCase().replace(/_/g, '-');
    const effective =
      raw === 'auto'
        ? String(hostLocaleHint || detectSystemUiLocale() || '').trim().split(/[.@]/)[0].toLowerCase().replace(/_/g, '-')
        : raw;
    return effective === 'tr' || effective.startsWith('tr-') || effective === 'turkish' || effective === 'türkçe' || effective === 'turkce'
      ? 'tr'
      : 'zh-CN';
  }

  function getHostI18nDictionaryPath(config, hostLocaleHint = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    const effective = resolveHostI18nLocale(cfg.language || cfg.lang || 'auto', hostLocaleHint);
    return path.join(rootDir, 'vendor', 'host-i18n', effective === 'tr' ? 'tr.json' : 'zh-CN.json');
  }

  function getSwarmI18nDictionaryPath(config, hostLocaleHint = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    const effective = resolveHostI18nLocale(cfg.language || cfg.lang || 'auto', hostLocaleHint);
    return path.join(rootDir, 'vendor', 'host-i18n', effective === 'tr' ? 'swarm-tr.json' : 'swarm-zh-CN.json');
  }

  function shouldEnableHostI18n(config, hostLocaleHint = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    const mode = cfg.hostLocalization || 'auto';
    const lang = cfg.language || cfg.lang || 'auto';
    const effective = resolveHostI18nLocale(lang, hostLocaleHint);
    if (effective === 'tr') {
      if (mode === 'off') return false;
      return fs.existsSync(path.join(rootDir, 'vendor', 'host-i18n', 'tr.json'));
    }
    // off 模式挂载第四通道进入反向英文还原（温和压制外部运行时 DOM 汉化，零 app.asar 修改）
    if (mode === 'off') return true;
    if (mode === 'on') return true;
    if (lang === 'zh-CN') return true;
    if (lang === 'auto') {
      const sysLocale = hostLocaleHint || detectSystemUiLocale();
      const stripped = String(sysLocale || '').trim().split(/[.@]/)[0];
      const norm = stripped.toLowerCase().replace(/_/g, '-');
      return norm === 'zh' || /^zh-(?:cn|hans|sg)(?:-|$)/.test(norm);
    }
    return false;
  }

  function readCompiledHostI18nAssets(opts = null) {
    const rtPath = path.join(rootDir, 'vendor', 'host-i18n', 'host-i18n-runtime.js');
    const revPath = path.join(rootDir, 'vendor', 'host-i18n', 'reverse-patterns.js');
    const cfg = opts?.config && typeof opts.config === 'object' ? reconcileConfigAliases(opts.config) : readConfig();
    const effectiveLang = resolveHostI18nLocale(cfg.language || cfg.lang || 'auto', opts?.hostLocaleHint || null);
    const dictPath = getHostI18nDictionaryPath(cfg, opts?.hostLocaleHint || null);
    const dictRel = path.basename(dictPath);
    if (!fs.existsSync(rtPath) || !fs.existsSync(dictPath)) {
      return { minRuntime: '', dictRaw: '', codeHash: '' };
    }
    const hasRev = fs.existsSync(revPath);
    const sig = `${effectiveLang}|${getFileSig(rtPath)}|${hasRev ? getFileSig(revPath) : 'norev'}|${getFileSig(dictPath)}`;
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('hostI18n');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    const fileEntries = [];
    if (hasRev) fileEntries.push({ rel: 'vendor/host-i18n/reverse-patterns.js', fullPath: revPath });
    fileEntries.push({ rel: 'vendor/host-i18n/host-i18n-runtime.js', fullPath: rtPath });
    fileEntries.push({ rel: `vendor/host-i18n/${dictRel}`, fullPath: dictPath });
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'hostI18n',
      sig,
      fileEntries,
      extraTag: effectiveLang,
      opts,
      compileFn: () => {
        const minRev = hasRev ? minifySingleSource(fs.readFileSync(revPath, 'utf8'), { allowMemberProps: false }) : '';
        const minRt = minifySingleSource(fs.readFileSync(rtPath, 'utf8'), { allowMemberProps: false });
        const minRuntime = minRev ? `${minRev};\n${minRt}` : minRt;
        const parsedDict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
        const plainJson = JSON.stringify(parsedDict).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
        const dictRaw =
          effectiveLang === 'tr' || Buffer.byteLength(plainJson, 'utf8') > DICT_COMPRESS_THRESHOLD_BYTES
            ? `JSON.parse(${packTextJsExpr(plainJson, 5600)})`
            : plainJson;
        const codeHash = computeHash(`${minRuntime}:${dictRaw}`);
        return { minRuntime, dictRaw, codeHash };
      },
      toCacheEntry: (assets, sourceHash) => ({
        sourceHash,
        codeHash: assets.codeHash,
        minRuntime: assets.minRuntime,
        dictRaw: assets.dictRaw,
        payloadSha256: sha256Text(`${assets.codeHash}\0${assets.minRuntime}\0${assets.dictRaw}`),
        updatedAt: Date.now(),
      }),
      fromCacheEntry: (entry) => ({
        minRuntime: entry.minRuntime,
        dictRaw: entry.dictRaw,
        codeHash: entry.codeHash,
      }),
    });
  }

  // 第四通道独立注入（Host UI 按语种动态本地化 + off 态反向英文还原）：绝不打入静态主包，仅加载当前激活语种单份词库
  function buildHostI18nExpression(config = null, hostLocaleHint = null, opts = null) {
    let resolvedLocaleHint = hostLocaleHint;
    let resolvedOpts = opts;
    if (hostLocaleHint && typeof hostLocaleHint === 'object' && !resolvedOpts) {
      resolvedOpts = hostLocaleHint;
      resolvedLocaleHint = null;
    }
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    if (!shouldEnableHostI18n(cfg, resolvedLocaleHint)) {
      return '';
    }
    const effectiveHostLang = resolveHostI18nLocale(cfg.language || cfg.lang || 'auto', resolvedLocaleHint);
    const { minRuntime, dictRaw, codeHash } = readCompiledHostI18nAssets({
      ...(resolvedOpts || {}),
      config: { ...cfg, language: effectiveHostLang },
      hostLocaleHint: resolvedLocaleHint,
    });
    if (!minRuntime || !dictRaw) {
      return '';
    }
    const mode = cfg.hostLocalization === 'on' ? 'on' : cfg.hostLocalization === 'off' ? 'off' : 'auto';
    const modeJson = serializeJsonForEval(mode);
    const localeOption = effectiveHostLang === 'tr' ? 'locale: "tr",' : '';
    const effectiveLangJson = serializeJsonForEval(effectiveHostLang);
    const hashJson = serializeJsonForEval(codeHash);

    return `(() => {
  try {
${CHANNEL_MAIN_FRAME_HOST_GUARD}

    let targetMode = ${modeJson};
    try {
      const liveCfg = window.__agPrism?.getState?.()?.cfg;
      if (liveCfg && typeof liveCfg === 'object') {
        if (liveCfg.hostLocalization === 'off') {
          targetMode = 'off';
        } else if (liveCfg.hostLocalization === 'on') {
          targetMode = 'on';
        } else {
          targetMode = 'auto';
          const liveLang = liveCfg.language || liveCfg.lang || '';
          if (${effectiveLangJson} === 'tr') {
            if (liveLang && liveLang !== 'tr' && liveLang !== 'auto') {
              try { window.__agPrismHostI18n?.destroy?.(); document.documentElement?.removeAttribute?.('data-ag-prism-host-i18n'); } catch {}
              return { ok: true, status: 'off', skippedByLiveCfg: true };
            }
          } else {
            if (liveLang && liveLang !== 'zh-CN' && liveLang !== 'auto') {
              try { window.__agPrismHostI18n?.destroy?.(); document.documentElement?.removeAttribute?.('data-ag-prism-host-i18n'); } catch {}
              return { ok: true, status: 'off', skippedByLiveCfg: true };
            }
            if (!liveLang || liveLang === 'auto') {
              const navLang = String(
                (typeof navigator !== 'undefined' && ((navigator.languages && navigator.languages[0]) || navigator.language)) || ''
              )
                .trim()
                .split(/[.@]/)[0]
                .toLowerCase()
                .replace(/_/g, '-');
              if (navLang && navLang !== 'zh' && !/^zh-(?:cn|hans|sg)(?:-|$)/.test(navLang)) {
                try { window.__agPrismHostI18n?.destroy?.(); document.documentElement?.removeAttribute?.('data-ag-prism-host-i18n'); } catch {}
                return { ok: true, status: 'off', skippedByLiveCfg: true };
              }
            }
          }
        }
      }
    } catch {}

    const targetHash = ${hashJson};
    const mountOrReuse = () => {
      if (needDomMarkerOnReady && !hasDomMarker() && (isPlainHttpLocalhost || !/\\bantigravity\\b/i.test(String(document.title || '')))) {
        return { ok: false, status: 'skipped-non-host' };
      }
      const existing = window.__agPrismHostI18n;
      if (existing && existing.__prismCodeHash === targetHash && typeof existing.getStatus === 'function') {
        const st = existing.getStatus();
        const isHealthyForTarget =
          st &&
          st.mode === targetMode &&
          (targetMode === 'off'
            ? st.status === 'off-enforced' || st.status === 'off-blocked'
            : st.status === 'active' || st.status === 'yielded');
        if (isHealthyForTarget) {
          return { ok: true, reused: true, codeHash: targetHash, ...st };
        }
        if (typeof existing.setMode === 'function') {
          const switched = existing.setMode(targetMode);
          try { (window.__agPrism || window.__agClaudeStyle)?.sync?.(); } catch {}
          return { ok: true, modeSwitched: true, codeHash: targetHash, ...switched };
        }
      }
      try { existing?.destroy?.(); } catch {}

      ${minRuntime};
      const factory = window.__agPrismHostI18nFactory || globalThis.__agPrismHostI18nFactory;
      if (!factory || typeof factory.mountHostI18n !== 'function') {
        return { ok: false, status: 'factory-missing' };
      }
      const inst = factory.mountHostI18n({
        root: window,
        doc: document,
        mode: targetMode,
        ${localeOption}
        dict: ${dictRaw},
      });
      if (inst && typeof inst === 'object') {
        inst.__prismCodeHash = targetHash;
      }
      const cur = inst && typeof inst.getStatus === 'function' ? inst.getStatus() : { status: 'active' };
      try { (window.__agPrism || window.__agClaudeStyle)?.sync?.(); } catch {}
      return { ok: true, codeHash: targetHash, ...cur };
    };

    if (needDomMarkerOnReady && typeof document.addEventListener === 'function') {
      document.addEventListener('DOMContentLoaded', () => { try { mountOrReuse(); } catch {} }, { once: true });
      return { ok: true, status: 'deferred', codeHash: targetHash };
    }
    return mountOrReuse();
  } catch (err) {
    return { ok: false, status: 'error', channel: 'hostI18n', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  function shouldEnableSwarmI18n(config, hostLocaleHint = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    const mode = cfg.hostLocalization || 'auto';
    // 原生 Swarm 面板本身为英文：off 模式或无词库语种严格 0 附着 / 立即卸载还原英文
    if (mode === 'off') return false;
    if (!shouldEnableHostI18n(cfg, hostLocaleHint)) return false;
    return fs.existsSync(getSwarmI18nDictionaryPath(cfg, hostLocaleHint));
  }

  function readCompiledSwarmI18nAssets(opts = null) {
    const rtPath = path.join(rootDir, 'vendor', 'host-i18n', 'swarm-i18n-runtime.js');
    const cfg = opts?.config && typeof opts.config === 'object' ? reconcileConfigAliases(opts.config) : readConfig();
    const effectiveLang = resolveHostI18nLocale(cfg.language || cfg.lang || 'auto', opts?.hostLocaleHint || null);
    const dictPath = getSwarmI18nDictionaryPath(cfg, opts?.hostLocaleHint || null);
    const dictRel = path.basename(dictPath);
    if (!fs.existsSync(rtPath) || !fs.existsSync(dictPath)) {
      return { minRuntime: '', dictRaw: '', codeHash: '' };
    }
    const sig = `${effectiveLang}|${getFileSig(rtPath)}|${getFileSig(dictPath)}`;
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('swarmI18n');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    const fileEntries = [
      { rel: 'vendor/host-i18n/swarm-i18n-runtime.js', fullPath: rtPath },
      { rel: `vendor/host-i18n/${dictRel}`, fullPath: dictPath },
    ];
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'swarmI18n',
      sig,
      fileEntries,
      extraTag: effectiveLang,
      opts,
      compileFn: () => {
        const minRuntime = minifySingleSource(fs.readFileSync(rtPath, 'utf8'), { allowMemberProps: false });
        const parsedDict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
        const dictRaw = JSON.stringify(parsedDict).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
        const codeHash = computeHash(`${minRuntime}:${dictRaw}`);
        return { minRuntime, dictRaw, codeHash };
      },
      toCacheEntry: (assets, sourceHash) => ({
        sourceHash,
        codeHash: assets.codeHash,
        minRuntime: assets.minRuntime,
        dictRaw: assets.dictRaw,
        payloadSha256: sha256Text(`${assets.codeHash}\0${assets.minRuntime}\0${assets.dictRaw}`),
        updatedAt: Date.now(),
      }),
      fromCacheEntry: (entry) => ({
        minRuntime: entry.minRuntime,
        dictRaw: entry.dictRaw,
        codeHash: entry.codeHash,
      }),
    });
  }

  // Issue #18 层 B：Swarm 独立侧栏 Webview (plugin://swarm--swarm_board-*) 按需纯 CDP 本地化表达式
  // 零 app.asar 修改、0 B Channel 1 增量、仅按需加载当前语种词库并支持 100% 无损英文还原
  function buildSwarmI18nExpression(config = null, hostLocaleHint = null, opts = null) {
    let resolvedLocaleHint = hostLocaleHint;
    let resolvedOpts = opts;
    if (hostLocaleHint && typeof hostLocaleHint === 'object' && !resolvedOpts) {
      resolvedOpts = hostLocaleHint;
      resolvedLocaleHint = null;
    }
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    if (!shouldEnableSwarmI18n(cfg, resolvedLocaleHint)) {
      return '';
    }
    const effectiveSwarmLang = resolveHostI18nLocale(cfg.language || cfg.lang || 'auto', resolvedLocaleHint);
    const { minRuntime, dictRaw, codeHash } = readCompiledSwarmI18nAssets({
      ...(resolvedOpts || {}),
      config: { ...cfg, language: effectiveSwarmLang },
      hostLocaleHint: resolvedLocaleHint,
    });
    if (!minRuntime || !dictRaw) {
      return '';
    }
    const hashJson = serializeJsonForEval(codeHash);

    return `(() => {
  try {
    try {
      const loc = typeof window !== 'undefined' && window.location;
      if (
        !loc ||
        loc.protocol !== 'plugin:' ||
        !/^swarm--swarm_board-\\d+$/.test(String(loc.hostname || '')) ||
        loc.port ||
        loc.username ||
        loc.password ||
        String(loc.pathname || '/') !== '/'
      ) {
        return { ok: false, status: 'skipped-non-swarm-url' };
      }
    } catch {
      return { ok: false, status: 'skipped-non-swarm-url' };
    }

    const targetHash = ${hashJson};
    const mountOrReuse = () => {
      const existing = window.__agPrismSwarmI18n;
      if (existing && existing.__prismCodeHash === targetHash && typeof existing.getStatus === 'function') {
        const st = existing.getStatus();
        if (st && (st.status === 'active' || st.status === 'yielded')) {
          if (st.status === 'active' && typeof existing.scan === 'function') {
            try { existing.scan(); } catch {}
          }
          return { ok: true, reused: true, codeHash: targetHash, ...st };
        }
      }
      try { existing?.destroy?.(); } catch {}

      ${minRuntime};
      const factory = window.__agPrismSwarmI18nFactory || globalThis.__agPrismSwarmI18nFactory;
      if (!factory || typeof factory.mountSwarmI18n !== 'function') {
        return { ok: false, status: 'factory-missing' };
      }
      const inst = factory.mountSwarmI18n({
        root: window,
        doc: document,
        dict: ${dictRaw},
      });
      if (inst && typeof inst === 'object') {
        inst.__prismCodeHash = targetHash;
      }
      const cur = inst && typeof inst.getStatus === 'function' ? inst.getStatus() : { status: 'active' };
      return { ok: Boolean(inst && inst.ok !== false), codeHash: targetHash, ...cur };
    };

    if (typeof document !== 'undefined' && document.readyState === 'loading' && !document.body && typeof document.addEventListener === 'function') {
      document.addEventListener('DOMContentLoaded', () => { try { mountOrReuse(); } catch {} }, { once: true });
      return { ok: true, status: 'deferred', codeHash: targetHash };
    }
    return mountOrReuse();
  } catch (err) {
    return { ok: false, status: 'error', channel: 'swarmI18n', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  return {
    resolveHostI18nLocale,
    getHostI18nDictionaryPath,
    getSwarmI18nDictionaryPath,
    shouldEnableHostI18n,
    buildHostI18nExpression,
    shouldEnableSwarmI18n,
    buildSwarmI18nExpression,
  };
}

module.exports = {
  createI18nChannelBuilders,
};
