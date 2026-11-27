// 核心独立通道构建器：通道 2（Omni Viewer）、通道 3（Sidebar Studio）、通道 6（Inline Diff）
'use strict';

const fs = require('fs');
const path = require('path');
const {
  getFileSig,
  sha256Text,
  computeHash,
  serializeJsonForEval,
} = require('../utils/fs-safe.cjs');
const {
  OMNI_BINDING,
  SIDEBAR_BINDING,
  reconcileConfigAliases,
} = require('../config/schema.cjs');
const { resolveBundleCachePathOption } = require('../compiler/cache-validate.cjs');
const { minifySingleSource } = require('../compiler/js-string-pool.cjs');
const {
  CHANNEL_OMNI_SIDEBAR_HOST_GUARD,
  CHANNEL_MAIN_FRAME_HOST_GUARD,
} = require('./host-guard.cjs');

function isSafeV2SidebarClientSource(src) {
  if (typeof src !== 'string' || !src.trim()) return false;
  if (!src.includes('SIDEBAR_STUDIO_CLIENT_V2')) return false;
  // 任何出现 setPrefValue / setPrefValues 标识符或字符串字面量的客户端源码一律拒载（含括号属性访问）
  if (/setPrefValues?/i.test(src)) return false;
  return true;
}

function createCoreChannelBuilders({ rootDir, pluginVersion, readConfig, bundleCache }) {
  function readCompiledOmniClient(opts = null) {
    const omniPath = path.join(rootDir, 'vendor', 'omni-viewer', 'omni-client.js');
    if (!fs.existsSync(omniPath)) {
      return { minCode: '', codeHash: '' };
    }
    const sig = getFileSig(omniPath);
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('omni');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'omni',
      sig,
      fileEntries: [{ rel: 'vendor/omni-viewer/omni-client.js', fullPath: omniPath }],
      opts,
      compileFn: () => {
        const minCode = minifySingleSource(fs.readFileSync(omniPath, 'utf8'), { allowMemberProps: false });
        const codeHash = computeHash(minCode);
        return { minCode, codeHash };
      },
      toCacheEntry: (assets, sourceHash) => ({
        sourceHash,
        codeHash: assets.codeHash,
        minCode: assets.minCode,
        payloadSha256: sha256Text(`${assets.codeHash}\0${assets.minCode}`),
        updatedAt: Date.now(),
      }),
      fromCacheEntry: (entry) => ({
        minCode: entry.minCode,
        codeHash: entry.codeHash,
      }),
    });
  }

  // 第二通道独立注入：绝不挤占静态主包 680KiB 配额，支持服务端 serverMeta 热同步与 codeHash 快速跳过重挂载
  function buildOmniClientExpression(serverMeta = null, customClientSource = null, opts = null) {
    const resolvedOpts = opts || (customClientSource && typeof customClientSource === 'object' ? customClientSource : null);
    let minCode = '';
    let codeHash = '';
    if (typeof customClientSource === 'string') {
      minCode = customClientSource ? minifySingleSource(customClientSource, { allowMemberProps: false }) : '';
      codeHash = minCode ? computeHash(minCode) : '';
    } else {
      const compiled = readCompiledOmniClient(resolvedOpts);
      minCode = compiled.minCode;
      codeHash = compiled.codeHash;
    }

    const metaJson = JSON.stringify(serverMeta && typeof serverMeta === 'object' ? serverMeta : null);
    const hashJson = JSON.stringify(codeHash);
    const verJson = JSON.stringify(pluginVersion);

    return `(() => {
  try {
${CHANNEL_OMNI_SIDEBAR_HOST_GUARD}

    const serverMeta = ${metaJson};
    window.__agPrismOmniServerMeta = serverMeta;

    if (!window.__agPrismOmniBridge || !window.__agPrismOmniBridge.__prismBridgeReady) {
      try { window.__agPrismOmniBridge?.dispose?.(); } catch {}
      const pending = new Map();
      let seq = 0;
      const sendOmniRpc = (reqObj, timeoutMs = 15000) => {
        const payload = reqObj && typeof reqObj === 'object' ? { ...reqObj } : { action: String(reqObj || 'getServerInfo') };
        const act = payload.action || 'getServerInfo';
        if (act === 'getServerInfo' && window.__agPrismOmniServerMeta && window.__agPrismOmniServerMeta.baseUrl) {
          return Promise.resolve({ ok: true, ...window.__agPrismOmniServerMeta });
        }
        if (typeof window.${OMNI_BINDING} !== 'function') {
          return Promise.resolve({ ok: false, offline: true, action: act, error: 'Omni daemon offline' });
        }
        return new Promise((resolve) => {
          if (pending.size >= 32) {
            resolve({ ok: false, busy: true, action: act });
            return;
          }
          const id = ++seq;
          const timer = setTimeout(() => {
            pending.delete(id);
            resolve({ ok: false, timeout: true, action: act });
          }, timeoutMs);
          pending.set(id, { resolve, timer });
          try {
            window.${OMNI_BINDING}(JSON.stringify({ id, ...payload, action: act, input: payload }));
          } catch (err) {
            clearTimeout(timer);
            pending.delete(id);
            resolve({ ok: false, action: act, error: String(err && err.message ? err.message : err) });
          }
        });
      };
      const bridge = {
        __prismBridgeReady: true,
        isOnline: () => typeof window.${OMNI_BINDING} === 'function',
        getServerMeta: () => window.__agPrismOmniServerMeta || null,
        call: sendOmniRpc,
        getServerInfo: () => sendOmniRpc({ action: 'getServerInfo' }, 6000),
        resolvePath: (opts) => sendOmniRpc({ ...(typeof opts === 'string' ? { rawPath: opts } : opts), action: 'resolvePath' }, 8000),
        revealInFolder: (opts) => sendOmniRpc({ ...(typeof opts === 'string' ? { path: opts } : opts), action: 'revealInFolder' }, 10000),
        openExternal: (opts) => sendOmniRpc({ ...(typeof opts === 'string' ? { target: opts } : opts), action: 'openExternal' }, 10000),
        readTextSlice: (opts) => sendOmniRpc({ ...(typeof opts === 'string' ? { path: opts } : opts), action: 'readTextSlice' }, 15000),
        resolve: (id, res) => {
          const item = pending.get(id);
          if (!item) return;
          clearTimeout(item.timer);
          pending.delete(id);
          item.resolve(res);
        },
        dispose: () => {
          for (const item of pending.values()) {
            clearTimeout(item.timer);
            item.resolve({ ok: false, disposed: true });
          }
          pending.clear();
        },
      };
      window.__agPrismOmniBridge = bridge;
      if (typeof window.__agPrismOmniResolve !== 'function') {
        window.__agPrismOmniResolve = bridge.resolve;
      }
    }

    const omniHash = ${hashJson};
    if (!omniHash) {
      return { ok: true, status: 'bridge-only', version: ${verJson} };
    }
    let omniStatus = 'deferred';
    const mountOmni = () => {
      const prismApi = window.__agPrism || window.__agClaudeStyle;
      const st = prismApi && typeof prismApi.getState === 'function' ? prismApi.getState() : null;
      const cfg = (st && st.cfg) || {};
      const existing = window.__agPrismOmni;
      const reused = Boolean(existing && existing.codeHash === omniHash && typeof existing.sync === 'function');
      if (!reused) {
        try { existing?.destroy?.(); } catch {}
        ${minCode};
        if (window.__agPrismOmni && typeof window.__agPrismOmni === 'object') {
          window.__agPrismOmni.codeHash = omniHash;
        }
      }
      if (cfg.omniModule === 'off') {
        try { window.__agPrismOmni?.sync?.(cfg, serverMeta); } catch {}
        omniStatus = 'disabled';
        return;
      }
      omniStatus = reused ? 'synced' : window.__agPrismOmni ? 'mounted' : 'ready';
      try { window.__agPrismOmni?.sync?.(cfg, serverMeta); } catch {}
    };
    if (document.documentElement) {
      mountOmni();
    } else {
      document.addEventListener('DOMContentLoaded', mountOmni, { once: true });
    }
    return { ok: true, status: omniStatus, version: ${verJson}, codeHash: omniHash };
  } catch (err) {
    return { ok: false, status: 'error', channel: 'omni', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  function readCompiledSidebarClient(opts = null) {
    const sidebarPath = path.join(rootDir, 'vendor', 'sidebar-studio', 'sidebar-client.js');
    if (!fs.existsSync(sidebarPath)) {
      return { minCode: '', codeHash: '' };
    }
    const sig = getFileSig(sidebarPath);
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('sidebar');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'sidebar',
      sig,
      fileEntries: [{ rel: 'vendor/sidebar-studio/sidebar-client.js', fullPath: sidebarPath }],
      extraTag: 'v2safe',
      opts,
      compileFn: () => {
        const rawText = fs.readFileSync(sidebarPath, 'utf8');
        if (!isSafeV2SidebarClientSource(rawText)) {
          return { minCode: '', codeHash: '' };
        }
        const minCode = minifySingleSource(rawText, { allowMemberProps: false });
        const codeHash = computeHash(minCode);
        return { minCode, codeHash };
      },
      toCacheEntry: (assets, sourceHash) => ({
        sourceHash,
        codeHash: assets.codeHash,
        minCode: assets.minCode,
        payloadSha256: sha256Text(`${assets.codeHash}\0${assets.minCode}`),
        updatedAt: Date.now(),
      }),
      fromCacheEntry: (entry) => ({
        minCode: entry.minCode,
        codeHash: entry.codeHash,
      }),
    });
  }

  // 第三通道独立注入（Sidebar Studio）：绝不挤占静态主包 670KiB 配额，支持服务端 meta 热同步、codeHash 快速跳过与热启停卸载
  function buildSidebarStudioExpression(serverMeta = null, customClientSource = null, opts = null) {
    const resolvedOpts = opts || (customClientSource && typeof customClientSource === 'object' ? customClientSource : null);
    let minCode = '';
    let codeHash = '';
    if (typeof customClientSource === 'string') {
      minCode = customClientSource && isSafeV2SidebarClientSource(customClientSource)
        ? minifySingleSource(customClientSource, { allowMemberProps: false })
        : '';
      codeHash = minCode ? computeHash(minCode) : '';
    } else {
      const compiled = readCompiledSidebarClient(resolvedOpts);
      minCode = compiled.minCode;
      codeHash = compiled.codeHash;
    }

    const metaJson = serializeJsonForEval(serverMeta && typeof serverMeta === 'object' ? serverMeta : null);
    const hashJson = serializeJsonForEval(codeHash);
    const verJson = serializeJsonForEval(pluginVersion);

    return `(() => {
  try {
${CHANNEL_OMNI_SIDEBAR_HOST_GUARD}

    const serverMeta = ${metaJson};
    window.__agPrismSidebarMeta = serverMeta;

    if (!window.__agPrismSidebarBridge || !window.__agPrismSidebarBridge.__prismBridgeReady) {
      try { window.__agPrismSidebarBridge?.dispose?.(); } catch {}
      const pending = new Map();
      let seq = 0;
      const sendSidebarRpc = (reqObj, timeoutMs = 15000) => {
        const payload = reqObj && typeof reqObj === 'object' ? { ...reqObj } : { action: String(reqObj || 'get-state') };
        const act = payload.action || 'get-state';
        if (typeof window.${SIDEBAR_BINDING} !== 'function') {
          return Promise.resolve({ ok: false, offline: true, action: act, error: { code: 'CAPABILITY_UNAVAILABLE', message: 'Sidebar Studio daemon offline', retryable: true } });
        }
        return new Promise((resolve) => {
          if (pending.size >= 32) {
            resolve({ ok: false, busy: true, action: act, error: { code: 'BUSY', message: 'Sidebar RPC queue full', retryable: true } });
            return;
          }
          const id = ++seq;
          const timer = setTimeout(() => {
            pending.delete(id);
            resolve({ ok: false, timeout: true, action: act, error: { code: 'CAPABILITY_UNAVAILABLE', message: 'Sidebar RPC timeout', retryable: true } });
          }, timeoutMs);
          pending.set(id, { resolve, timer });
          try {
            window.${SIDEBAR_BINDING}(JSON.stringify({ id, version: 2, ...payload, action: act }));
          } catch (err) {
            clearTimeout(timer);
            pending.delete(id);
            resolve({ ok: false, action: act, error: { code: 'INVALID_ARGUMENT', message: String(err && err.message ? err.message : err) } });
          }
        });
      };
      const bridge = {
        __prismBridgeReady: true,
        schemaVersion: 2,
        isOnline: () => typeof window.${SIDEBAR_BINDING} === 'function',
        getMeta: () => window.__agPrismSidebarMeta || null,
        call: sendSidebarRpc,
        rpc: sendSidebarRpc,
        getState: () => sendSidebarRpc({ action: 'get-state' }, 8000),
        syncCatalog: (payload) => sendSidebarRpc({ action: 'sync-catalog', payload: payload && typeof payload === 'object' ? payload : {} }, 8000),
        createSparkBox: (opts) => sendSidebarRpc({ action: 'create-spark-box', payload: typeof opts === 'string' ? { name: opts } : (opts || {}) }, 15000),
        pickFolder: (opts) => sendSidebarRpc({ action: 'pick-folder', payload: opts && typeof opts === 'object' ? opts : {} }, 120000),
        revealFolder: (opts) => sendSidebarRpc({ action: 'reveal-folder', payload: typeof opts === 'string' ? { path: opts } : (opts || {}) }, 10000),
        resolve: (id, res) => {
          const item = pending.get(id);
          if (!item) return;
          clearTimeout(item.timer);
          pending.delete(id);
          item.resolve(res);
        },
        dispose: () => {
          for (const item of pending.values()) {
            clearTimeout(item.timer);
            item.resolve({ ok: false, disposed: true });
          }
          pending.clear();
        },
      };
      window.__agPrismSidebarBridge = bridge;
      if (typeof window.__agPrismSidebarResolve !== 'function') {
        window.__agPrismSidebarResolve = bridge.resolve;
      }
    }

    const cleanupSidebarDom = (preserveRuntimeState = false) => {
      try { window.__agPrismSidebar?.destroy?.({ preserveRuntimeState: Boolean(preserveRuntimeState) }); } catch {}
      try { delete window.__agPrismSidebar; } catch {}
      try {
        document.getElementById('ag-prism-sidebar-studio-css')?.remove();
        document.querySelectorAll('[data-ag-prism-sidebar-owned="1"], .ag-prism-sidebar-studio, .ag-prism-sidebar-rail, .ag-prism-sidebar-popover, .ag-prism-sidebar-modal').forEach((n) => n.remove());
        if (!preserveRuntimeState && document.documentElement) {
          ['data-ag-prism-mode', 'data-ag-prism-chat-kind', 'data-ag-prism-chat-telemetry', 'data-ag-cs-space', 'data-ag-cs-space-palette', 'data-ag-cs-space-accent'].forEach((a) => document.documentElement.removeAttribute(a));
        }
      } catch {}
    };

    const sidebarHash = ${hashJson};
    if (!sidebarHash) {
      const prismApi0 = window.__agPrism || window.__agClaudeStyle;
      const cfg0 = prismApi0 && typeof prismApi0.getState === 'function' ? prismApi0.getState()?.cfg || {} : {};
      if (cfg0.sidebarStudio !== 'on') {
        cleanupSidebarDom(false);
        return { ok: true, status: 'disabled', version: ${verJson} };
      }
      return { ok: true, status: 'bridge-only', version: ${verJson} };
    }

    let sidebarStatus = 'deferred';
    const mountSidebar = () => {
      const prismApi = window.__agPrism || window.__agClaudeStyle;
      const st = prismApi && typeof prismApi.getState === 'function' ? prismApi.getState() : null;
      const cfg = (st && st.cfg) || {};
      if (document.documentElement) {
        document.documentElement.setAttribute('data-ag-prism-sidebar-studio', cfg.sidebarStudio === 'on' ? 'on' : 'off');
      }
      if (cfg.sidebarStudio !== 'on') {
        cleanupSidebarDom(false);
        sidebarStatus = 'disabled';
        return;
      }
      const existing = window.__agPrismSidebar;
      const reused = Boolean(existing && !existing.destroyed && existing.codeHash === sidebarHash && typeof existing.sync === 'function');
      if (!reused) {
        cleanupSidebarDom(true);
        ${minCode};
        if (window.__agPrismSidebar && typeof window.__agPrismSidebar === 'object') {
          window.__agPrismSidebar.codeHash = sidebarHash;
        }
      }
      sidebarStatus = reused ? 'synced' : window.__agPrismSidebar ? 'mounted' : 'ready';
      try { window.__agPrismSidebar?.sync?.(cfg, serverMeta); } catch {}
    };
    if (document.documentElement) {
      mountSidebar();
    } else {
      document.addEventListener('DOMContentLoaded', mountSidebar, { once: true });
    }
    return { ok: true, status: sidebarStatus, version: ${verJson}, codeHash: sidebarHash };
  } catch (err) {
    return { ok: false, status: 'error', channel: 'sidebar', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  function readCompiledInlineDiffClient(opts = null) {
    const clientPath = path.join(rootDir, 'vendor', 'inline-diff', 'inline-diff-client.js');
    if (!fs.existsSync(clientPath)) {
      return { sig: '', minCode: '', codeHash: '' };
    }
    const sig = getFileSig(clientPath);
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('inlineDiff');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'inlineDiff',
      sig,
      fileEntries: [{ rel: 'vendor/inline-diff/inline-diff-client.js', fullPath: clientPath }],
      opts,
      compileFn: () => {
        const minCode = minifySingleSource(fs.readFileSync(clientPath, 'utf8'), { allowMemberProps: false });
        const codeHash = computeHash(minCode);
        return { minCode, codeHash };
      },
      toCacheEntry: (assets, sourceHash) => ({
        sourceHash,
        codeHash: assets.codeHash,
        minCode: assets.minCode,
        payloadSha256: sha256Text(`${assets.codeHash}\0${assets.minCode}`),
        updatedAt: Date.now(),
      }),
      fromCacheEntry: (entry) => ({
        minCode: entry.minCode,
        codeHash: entry.codeHash,
      }),
    });
  }

  // 第六通道独立注入（Inline Diff 展开预览 + 样式与右键菜单）：与 Channel 1 解耦，缺文件时安全返回 ''，支持 codeHash 幂等跳过与热重载
  function buildInlineDiffInjectExpression(config = null, opts = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    let minCode = '';
    let codeHash = '';
    if (opts && typeof opts.customClientSource === 'string') {
      minCode = opts.customClientSource ? minifySingleSource(opts.customClientSource, { allowMemberProps: false }) : '';
      codeHash = minCode ? computeHash(minCode) : '';
    } else {
      const compiled = readCompiledInlineDiffClient(opts);
      minCode = compiled.minCode;
      codeHash = compiled.codeHash;
    }
    if (!minCode || !codeHash) {
      return '';
    }

    const bootCfgJson = serializeJsonForEval(cfg);
    const hashJson = serializeJsonForEval(codeHash);

    return `(() => {
  try {
${CHANNEL_MAIN_FRAME_HOST_GUARD}

    const cleanupInlineDiff = () => {
      try { (window.__agPrismInlineDiff || globalThis.__agPrismInlineDiff)?.destroy?.(); } catch {}
      try { document.getElementById?.('ag-prism-inline-diff-css')?.remove?.(); } catch {}
      try { document.querySelectorAll?.('.ag-cs-inline-diff-box, .ag-cs-diff-ctx-menu')?.forEach?.((el) => el.remove()); } catch {}
      try { delete window.__agPrismInlineDiff; } catch {}
      try { delete globalThis.__agPrismInlineDiff; } catch {}
      try { delete window.__agPrismInlineDiffFactory; } catch {}
      try { delete globalThis.__agPrismInlineDiffFactory; } catch {}
      try { delete window.__agPrismInlineDiffResolve; } catch {}
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
    const targetHash = ${hashJson};
    const mountOrReuse = () => {
      if (needDomMarkerOnReady && !hasDomMarker() && (isPlainHttpLocalhost || !/\\bantigravity\\b/i.test(String(document.title || '')))) {
        return { ok: false, status: 'skipped-non-host' };
      }
      const effectiveCfg = getLiveCfg() || bootCfg;
      const existing = window.__agPrismInlineDiff || globalThis.__agPrismInlineDiff;
      if (existing && !existing.getDebugState?.()?.destroyed && existing.__prismCodeHash === targetHash && typeof existing.sync === 'function') {
        try { existing.sync(effectiveCfg); } catch {}
        return { ok: true, reused: true, codeHash: targetHash };
      }

      cleanupInlineDiff();
      ;${minCode};

      let mounted = window.__agPrismInlineDiff || globalThis.__agPrismInlineDiff;
      const factory = window.__agPrismInlineDiffFactory || globalThis.__agPrismInlineDiffFactory;
      if (!mounted && typeof factory === 'function') {
        try {
          mounted = factory({ window, document });
        } catch {}
      }
      if (mounted && typeof mounted === 'object') {
        mounted.__prismCodeHash = targetHash;
        try { window.__agPrismInlineDiff = mounted; } catch {}
        try { globalThis.__agPrismInlineDiff = mounted; } catch {}
      }
      if (typeof factory === 'function') {
        try { window.__agPrismInlineDiffFactory = factory; } catch {}
        try { globalThis.__agPrismInlineDiffFactory = factory; } catch {}
      }
      try { mounted?.sync?.(effectiveCfg); } catch {}
      return { ok: true, status: 'mounted', codeHash: targetHash };
    };

    if ((needDomMarkerOnReady || !document.documentElement) && typeof document.addEventListener === 'function') {
      document.addEventListener('DOMContentLoaded', () => { try { mountOrReuse(); } catch {} }, { once: true });
      return { ok: true, status: 'deferred', codeHash: targetHash };
    }
    return mountOrReuse();
  } catch (err) {
    return { ok: false, status: 'error', channel: 'inlineDiff', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  return {
    isSafeV2SidebarClientSource,
    buildOmniClientExpression,
    buildSidebarStudioExpression,
    buildInlineDiffInjectExpression,
  };
}

module.exports = {
  isSafeV2SidebarClientSource,
  createCoreChannelBuilders,
};
