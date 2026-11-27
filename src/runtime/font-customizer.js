// 会话正文与代码自定义字体引擎（Issue #98）：严格防 CSS 注入消毒、受管 <style> 隔离、可选按需本机字体读取
(function (root, factory) {
  const api = factory(root);
  if (root) root.__agPrismFontCustomizer = api;
  if (typeof window !== 'undefined' && window && window !== root) {
    window.__agPrismFontCustomizer = api;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function (G) {
  'use strict';

  const STYLE_ID = 'ag-prism-custom-fonts-style';
  const CHAT_FONT_ATTR = 'data-ag-cs-chat-font';
  const MAX_CUSTOM_LEN = 160;
  const MAX_FAMILY_ITEMS = 8;

  const DEFAULT_CHAT_FALLBACK =
    "'Google Sans Flex', 'Google Sans', 'Google Sans Text', 'Inter', 'Segoe UI Variable', 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  const DEFAULT_CODE_FALLBACK =
    "'Cascadia Code', 'JetBrains Mono', 'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, ui-monospace, monospace";

  const CHAT_FONT_PRESETS = Object.freeze({
    default: '',
    'system-sans':
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif",
    'noto-sans':
      "'Noto Sans SC', 'Noto Sans TC', 'Noto Sans JP', 'Noto Sans KR', 'Noto Sans', 'PingFang SC', 'Microsoft YaHei UI', system-ui, sans-serif",
    inter:
      "'Inter', 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei UI', system-ui, -apple-system, sans-serif",
    harmony:
      "'HarmonyOS Sans SC', 'HarmonyOS Sans', 'MiSans', 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei UI', system-ui, sans-serif",
  });

  // 危险字符与 CSS 注入关键字拦截表（在去引号前对每段做前置否决）
  const DANGEROUS_TOKEN_RE =
    /[;{}()\\<>`$\r\n\0\x01-\x1f\x7f]|url\s*\(|expression\s*\(|@import|@charset|@font-face|@media|@layer|javascript:|data:/i;
  // 严格安全字符白名单：Unicode 字母（含拉丁/CJK/假名/韩文等）、数字、空格、-、_、.
  const SAFE_FAMILY_NAME_RE = /^[\p{L}\p{N} ._-]+$/u;
  const RESERVED_CSS_KEYWORDS = new Set([
    'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default', 'none', 'auto',
  ]);

  function sanitizeFontFamilyList(raw) {
    if (typeof raw !== 'string') return { families: [], hadRejected: false };
    const clipped = raw.slice(0, MAX_CUSTOM_LEN);
    if (!clipped.trim()) return { families: [], hadRejected: false };

    const segments = clipped.split(',');
    const families = [];
    const seen = new Set();
    let hadRejected = false;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const trimmedRaw = seg.trim();
      if (!trimmedRaw) continue;

      if (DANGEROUS_TOKEN_RE.test(trimmedRaw)) {
        hadRejected = true;
        continue;
      }

      // 去除首尾包裹引号（单引号或双引号），但不允许内部残留引号
      let unwrapped = trimmedRaw;
      while (
        unwrapped.length >= 2 &&
        ((unwrapped[0] === '"' && unwrapped[unwrapped.length - 1] === '"') ||
          (unwrapped[0] === "'" && unwrapped[unwrapped.length - 1] === "'"))
      ) {
        unwrapped = unwrapped.slice(1, -1).trim();
      }
      if (/['"]/.test(unwrapped)) {
        hadRejected = true;
        continue;
      }

      const collapsed = unwrapped.replace(/\s+/g, ' ').trim();
      if (!collapsed || collapsed.length > 64 || !SAFE_FAMILY_NAME_RE.test(collapsed)) {
        hadRejected = true;
        continue;
      }
      const lower = collapsed.toLowerCase();
      if (RESERVED_CSS_KEYWORDS.has(lower)) {
        hadRejected = true;
        continue;
      }
      if (seen.has(lower)) continue;
      seen.add(lower);
      families.push(collapsed);
      if (families.length >= MAX_FAMILY_ITEMS) break;
    }

    return { families, hadRejected };
  }

  function sanitizeFontFamilyInput(raw, kind = 'chat') {
    const { families } = sanitizeFontFamilyList(raw);
    if (families.length === 0) return '';
    const quoted = families.map((name) => JSON.stringify(name)).join(', ');
    if (kind === 'none') return quoted;
    const fallback = kind === 'code' ? DEFAULT_CODE_FALLBACK : DEFAULT_CHAT_FALLBACK;
    return `${quoted}, ${fallback}`;
  }

  function resolveChatFontStack(chatFont, chatFontCustom) {
    const mode = typeof chatFont === 'string' ? chatFont.trim() : 'default';
    if (!mode || mode === 'default') return '';
    if (mode === 'custom') {
      return sanitizeFontFamilyInput(chatFontCustom, 'chat');
    }
    return Object.prototype.hasOwnProperty.call(CHAT_FONT_PRESETS, mode) ? CHAT_FONT_PRESETS[mode] : '';
  }

  function resolveCodeFontStack(codeFont, codeFontCustom) {
    const mode = typeof codeFont === 'string' ? codeFont.trim() : 'default';
    if (mode !== 'custom') return '';
    return sanitizeFontFamilyInput(codeFontCustom, 'code');
  }

  function buildCustomFontsCss(cfg) {
    const conf = cfg && typeof cfg === 'object' ? cfg : {};
    const chatStack = resolveChatFontStack(conf.chatFont, conf.chatFontCustom);
    const codeStack = resolveCodeFontStack(conf.codeFont, conf.codeFontCustom);
    if (!chatStack && !codeStack) return '';

    const rules = [];
    if (chatStack) {
      // 精准作用域：会话消息正文与输入框，绝不污染图标字体（codicon/SVG）且保护代码块
      rules.push(
        `html[data-ag-cs-style] :is([data-testid="conversation-view"],[data-testid="planner-response-text"],[data-testid="agent-response"],[data-testid="user-message"],[data-testid="message-content"],[data-testid="artifact-view"],.ag-prism-thought-body,.ag-prism-thought-overlay,[data-testid="agent-input-box"] :is([data-lexical-editor="true"],[contenteditable="true"],textarea,input)){--font-sans:${chatStack};font-family:${chatStack} !important;}`
      );
      rules.push(
        `html[data-ag-cs-style] :is([data-testid="planner-response-text"],[data-testid="agent-response"],[data-testid="user-message"],[data-testid="message-content"],[data-testid="artifact-view"],.ag-prism-thought-body) :is(p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th,dt,dd,a,strong,em){font-family:${chatStack} !important;}`
      );
      rules.push(
        `html[data-ag-cs-style] :is(pre,code,.code-block,.code-line,kbd,[data-lexical-editor="true"] code,.monaco-editor .view-lines,.xterm,.xterm-rows,[data-testid="background-task-command"],.ag-prism-thought-code,.ag-prism-thought-pre){font-family:var(--ag-cs-mono-stack) !important;}`
      );
      rules.push(
        `html[data-ag-cs-style] :is(pre,code,.code-block,.code-line,.monaco-editor .view-lines,.xterm-rows) :is(span,div){font-family:inherit !important;}`
      );
    }
    if (codeStack) {
      // 代码自定义字体：与既有 codeLigatures 开关（--_fvl / --_ffs）100% 兼容协同
      rules.push(
        `html[data-ag-cs-style][data-ag-cs-code-font="custom"]{--ag-cs-mono-stack:${codeStack};--font-mono:${codeStack} !important;--editor-font-family:${codeStack} !important;}`
      );
      rules.push(
        `html[data-ag-cs-style][data-ag-cs-code-font="custom"] :is(pre,code,.code-block,.code-line,kbd,[data-lexical-editor="true"] code,.monaco-editor .view-lines,.xterm,.xterm-rows,[data-testid="background-task-command"],.ag-prism-thought-code,.ag-prism-thought-pre){font-family:${codeStack} !important;font-variant-ligatures:var(--_fvl) !important;font-feature-settings:var(--_ffs) !important;}`
      );
    }
    return rules.join('\n');
  }

  function applyCustomFonts(cfg, docOverride) {
    const doc = docOverride || (typeof document !== 'undefined' ? document : null);
    if (!doc) return { active: false, css: '' };
    const de = doc.documentElement;
    const conf = cfg && typeof cfg === 'object' ? cfg : {};
    const chatMode = typeof conf.chatFont === 'string' && conf.chatFont ? conf.chatFont : 'default';

    if (de) {
      try {
        if (chatMode && chatMode !== 'default') {
          if (de.getAttribute?.(CHAT_FONT_ATTR) !== chatMode) de.setAttribute?.(CHAT_FONT_ATTR, chatMode);
        } else if (de.hasAttribute?.(CHAT_FONT_ATTR)) {
          de.removeAttribute?.(CHAT_FONT_ATTR);
        }
      } catch {}
    }

    const css = buildCustomFontsCss(conf);
    const existing = typeof doc.getElementById === 'function' ? doc.getElementById(STYLE_ID) : null;
    if (!css) {
      if (existing) {
        try { existing.remove?.(); } catch {}
      }
      return { active: false, css: '' };
    }

    const host = doc.head || de;
    if (!host) return { active: false, css };
    let el = existing;
    if (!el) {
      el = doc.createElement('style');
      el.id = STYLE_ID;
      try { el.setAttribute?.('data-ag-prism-owned', '1'); } catch {}
      host.appendChild(el);
    }
    if (el.textContent !== css) {
      el.textContent = css;
    }
    if (el.parentNode !== host) {
      host.appendChild(el);
    }
    return { active: true, css };
  }

  // 仅在用户主动点击设置面板按钮时触发，绝不自动调用 window.queryLocalFonts()
  async function listLocalFontFamilies(winOverride) {
    const win = winOverride || (typeof window !== 'undefined' ? window : G);
    if (!win || typeof win.queryLocalFonts !== 'function') {
      return { ok: false, supported: false, denied: false, families: [] };
    }
    try {
      const fonts = await win.queryLocalFonts();
      const set = new Set();
      const list = [];
      if (Array.isArray(fonts) || (fonts && typeof fonts[Symbol.iterator] === 'function')) {
        for (const item of fonts) {
          const fam = item && typeof item.family === 'string' ? item.family.trim() : '';
          if (!fam || DANGEROUS_TOKEN_RE.test(fam) || !SAFE_FAMILY_NAME_RE.test(fam)) continue;
          const low = fam.toLowerCase();
          if (set.has(low)) continue;
          set.add(low);
          list.push(fam);
        }
      }
      list.sort((a, b) => a.localeCompare(b));
      return { ok: true, supported: true, denied: false, families: list };
    } catch {
      return { ok: false, supported: true, denied: true, families: [] };
    }
  }

  function dispose(docOverride) {
    const doc = docOverride || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;
    try { doc.getElementById?.(STYLE_ID)?.remove?.(); } catch {}
    try { doc.documentElement?.removeAttribute?.(CHAT_FONT_ATTR); } catch {}
  }

  return {
    STYLE_ID,
    CHAT_FONT_ATTR,
    MAX_CUSTOM_LEN,
    DEFAULT_CHAT_FALLBACK,
    DEFAULT_CODE_FALLBACK,
    CHAT_FONT_PRESETS,
    sanitizeFontFamilyList,
    sanitizeFontFamilyInput,
    resolveChatFontStack,
    resolveCodeFontStack,
    buildCustomFontsCss,
    applyCustomFonts,
    listLocalFontFamilies,
    dispose,
  };
});
