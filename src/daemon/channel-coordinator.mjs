// Obsidian Prism 通用通道元数据查询、源树签名、哈希计算与卸载表达式解析纯工具（唯一消费 CHANNEL_REGISTRY，无原型 Mixin）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { SIDEBAR_BINDING } from './constants.mjs';

const require = createRequire(import.meta.url);
const { CHANNEL_STATIC_SPECS } = require('../channels/registry.cjs');
const { CHANNEL_TEARDOWN_MAP } = require('../channels/channel-teardowns.cjs');

export const CDP_WATCHED_SRC_DIRS = Object.freeze(['utils', 'config', 'platform', 'cdp', 'compiler', 'channels', 'compat']);

const STATIC_SPEC_BY_ID = new Map(CHANNEL_STATIC_SPECS.map((s) => [s.id, s]));

export function getCanonicalChannelSpecs(cdpMod = null) {
  if (Array.isArray(cdpMod?.CHANNEL_REGISTRY) && cdpMod.CHANNEL_REGISTRY.length > 0) {
    return cdpMod.CHANNEL_REGISTRY;
  }
  return CHANNEL_STATIC_SPECS;
}

export function lookupRegistryChannel(cdpMod, id) {
  if (!id) return null;
  if (cdpMod && typeof cdpMod.findChannel === 'function') {
    const hit = cdpMod.findChannel(id);
    if (hit) return hit;
  }
  if (Array.isArray(cdpMod?.CHANNEL_REGISTRY)) {
    const hit = cdpMod.CHANNEL_REGISTRY.find((c) => c && c.id === id);
    if (hit) return hit;
  }
  return STATIC_SPEC_BY_ID.get(id) || null;
}

export function extractTargetCodeHash(expr) {
  const str = typeof expr === 'string' ? expr : '';
  if (!str) return '';
  const m = /const targetHash = "([^"]+)"/.exec(str);
  if (m && m[1]) return m[1];
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

export function hashExpressionShort(expr) {
  const str = typeof expr === 'string' ? expr : '';
  if (!str) return '';
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

export function computeChannelHash(spec, expr) {
  if (spec?.hashMode === 'sha256') return hashExpressionShort(expr);
  if (spec?.hashMode === 'none') return '';
  return extractTargetCodeHash(expr);
}

export function readCdpTreeSig(rootDir) {
  if (!rootDir) return '';
  const parts = [];
  const recordFile = (rel, abs) => {
    try {
      const st = fs.lstatSync(abs);
      if (!st.isSymbolicLink() && st.isFile()) parts.push(`${rel}:${st.mtimeMs}:${st.size}`);
    } catch {}
  };
  recordFile('cdp.js', path.join(rootDir, 'cdp.js'));
  const walkCjs = (dirAbs, relPrefix) => {
    let ents = [];
    try {
      ents = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    ents.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of ents) {
      if (ent.isSymbolicLink()) continue;
      const childAbs = path.join(dirAbs, ent.name);
      const childRel = `${relPrefix}/${ent.name}`;
      if (ent.isDirectory()) walkCjs(childAbs, childRel);
      else if (ent.isFile() && ent.name.endsWith('.cjs')) recordFile(childRel, childAbs);
    }
  };
  for (const sub of CDP_WATCHED_SRC_DIRS) {
    walkCjs(path.join(rootDir, 'src', sub), `src/${sub}`);
  }
  if (parts.length === 0) return '';
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 24);
}

export function hasChannelAssetFile(rootDir, cdpMod, id) {
  if (typeof rootDir !== 'string' || !rootDir) return false;
  const reg = lookupRegistryChannel(cdpMod, id);
  const rel = Array.isArray(reg?.files) && reg.files.length > 0 ? reg.files[0] : '';
  if (!rel) return false;
  try {
    return fs.existsSync(path.join(rootDir, ...rel.split('/')));
  } catch {
    return false;
  }
}

export function resolveChannelTeardown(cdpMod, specOrId) {
  const spec = typeof specOrId === 'string' ? lookupRegistryChannel(cdpMod, specOrId) : specOrId;
  const id = typeof specOrId === 'string' ? specOrId : spec?.id || '';
  const cdpConstName = spec?.fields?.cdpRemoveConst || STATIC_SPEC_BY_ID.get(id)?.fields?.cdpRemoveConst || '';
  if (cdpConstName && typeof cdpMod?.[cdpConstName] === 'string' && cdpMod[cdpConstName]) {
    return cdpMod[cdpConstName];
  }
  if (spec && typeof spec.teardown === 'string' && spec.teardown) return spec.teardown;
  const reg = lookupRegistryChannel(cdpMod, id);
  if (reg && typeof reg.teardown === 'string' && reg.teardown) return reg.teardown;
  return CHANNEL_TEARDOWN_MAP[id] || '';
}

export function buildSidebarCleanupExpression(force = false) {
  const residueGuard = force
    ? ''
    : `const hasResidue = Boolean(
          window.__agPrismSidebar ||
          document.getElementById('ag-prism-sidebar-studio-css') ||
          document.querySelector('[data-ag-prism-sidebar-owned="1"], .ag-prism-sidebar-studio, .ag-prism-sidebar-rail, .ag-prism-sidebar-popover, .ag-prism-sidebar-modal')
        );
        if (!hasResidue) return { ok: true, status: 'clean' };`;
  return `(() => {
      try {
        ${residueGuard}
        if (document.documentElement) {
          document.documentElement.setAttribute('data-ag-prism-sidebar-studio', 'off');
        }
        try { window.__agPrismSidebar?.destroy?.({ preserveRuntimeState: false }); } catch {}
        try { delete window.__agPrismSidebar; } catch {}
        for (const k of ['__agPrismSidebarHostOps', '__agPrismSidebarLastSendError', '__agPrismSidebarLastStartStage', '__agPrismSidebarLastStartFallback', '__agPrismSidebarLastSendFallback']) {
          try { delete window[k]; delete globalThis[k]; } catch {}
        }
        try { delete window.${SIDEBAR_BINDING}; } catch {}
        document.getElementById('ag-prism-sidebar-studio-css')?.remove();
        document.querySelectorAll('[data-ag-prism-sidebar-owned="1"], .ag-prism-sidebar-studio, .ag-prism-sidebar-rail, .ag-prism-sidebar-popover, .ag-prism-sidebar-modal').forEach((n) => n.remove());
        if (document.documentElement) {
          ['data-ag-prism-mode', 'data-ag-prism-chat-kind', 'data-ag-prism-chat-telemetry', 'data-ag-cs-space', 'data-ag-cs-space-palette', 'data-ag-cs-space-accent'].forEach((a) => document.documentElement.removeAttribute(a));
        }
        return { ok: true, status: 'cleaned' };
      } catch {}
      return { ok: true, status: 'disabled' };
    })()`;
}

export function isSpecEnabledForConfig(cdpMod, spec, cfg) {
  if (!spec) return false;
  try {
    const cdpShouldName = spec.fields?.cdpShouldFn;
    if (cdpShouldName && typeof cdpMod?.[cdpShouldName] === 'function') {
      return Boolean(cdpMod[cdpShouldName](cfg));
    }
    const reg = lookupRegistryChannel(cdpMod, spec.id);
    if (cfg && typeof reg?.shouldEnable === 'function') {
      return Boolean(reg.shouldEnable(cfg));
    }
    if (typeof spec.defaultShouldEnable === 'function') {
      return Boolean(spec.defaultShouldEnable(cfg));
    }
    return true;
  } catch {
    return spec.id === 'omni' || spec.id === 'periodicPicker' || spec.id === 'mascot' || spec.id === 'homeStudio';
  }
}

export function computeSpecCfgSig(spec, cfg, exprHash = '') {
  try {
    if (!spec) return '';
    if (spec.id === 'thought') {
      const base = typeof spec.cfgSig === 'function' ? spec.cfgSig(cfg) : '';
      return base ? `${base}:${exprHash}` : '';
    }
    if (spec.id === 'hostI18n') {
      return typeof spec.cfgSig === 'function' ? spec.cfgSig(cfg) : `${cfg?.hostLocalization || 'auto'}:${cfg?.language || cfg?.lang || 'auto'}`;
    }
    if (spec.tracksSkippedNonHost) {
      return exprHash;
    }
    const cfgPart = typeof spec.cfgSig === 'function' ? spec.cfgSig(cfg) : 'on';
    return exprHash ? `${cfgPart}:${exprHash}` : cfgPart;
  } catch {
    return '';
  }
}

export { CHANNEL_STATIC_SPECS };
