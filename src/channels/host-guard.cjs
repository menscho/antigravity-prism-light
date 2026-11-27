// 浏览器端主窗口与顶层帧安全守卫代码片段（供多通道注入表达式复用）
'use strict';

// 通道 2/3（Omni / Sidebar）共用的非宿主窗口跳过守卫（允许 iframe 内或普通顶层校验，与原逻辑逐字符一致）
const CHANNEL_OMNI_SIDEBAR_HOST_GUARD = `    try {
      const loc = typeof window !== 'undefined' && window.location;
      const href = loc && typeof loc.href === 'string' ? loc.href : '';
      if (href) {
        const low = href.toLowerCase();
        if (low.startsWith('devtools://') || low.startsWith('data:') || low.startsWith('chrome:') || low.startsWith('chrome-extension:') || low.startsWith('edge:') || low.startsWith('blob:') || low.startsWith('plugin:')) {
          return { ok: false, status: 'skipped-non-host' };
        }
        if (low.startsWith('vscode-file://') || low.startsWith('app://') || low.startsWith('about:')) {
          const ttl = String(document.title || '').trim();
          if (/^(?:untitled|launchpad)$/i.test(ttl) || /\\/launchpad(?:\\.html)?(?:[?#]|$)/i.test(low)) {
            return { ok: false, status: 'skipped-non-host' };
          }
        }
        if (low.startsWith('http:') || low.startsWith('https:')) {
          const m = /^(https?):\\/\\/(127\\.0\\.0\\.1|localhost|\\[::1\\])(?::\\d+)?(\\/[^?#]*)?(?:[?#]|$)/i.exec(href);
          if (!m) return { ok: false, status: 'skipped-non-host' };
          const pathname = (m[3] || '/').toLowerCase();
          if (/^\\/(?:viewer(?:\\/|$)|sandbox(?:\\/|$)|stream(?:\\/|$)|api(?:\\/|$))/.test(pathname)) {
            return { ok: false, status: 'skipped-non-host' };
          }
          const hasDomMarker =
            Boolean(window.__agPrism || window.__agClaudeStyle) ||
            Boolean(
              document.body &&
                document.body.classList &&
                (document.body.classList.contains('theme-standalone') || document.body.classList.contains('monaco-workbench'))
            ) ||
            Boolean(
              document.querySelector &&
                document.querySelector(
                  '.agy-shell, .agy-home, [data-testid="aux-pane-split"], [data-testid="conversation-view"], [data-testid="agent-input-box"], [data-testid="model-selector-trigger"], .monaco-workbench'
                )
            );
          const isPlainHttp = m[1].toLowerCase() === 'http';
          const hasTitleMarker = !isPlainHttp && /\\bantigravity\\b/i.test(String(document.title || ''));
          if (!hasDomMarker && !hasTitleMarker && (isPlainHttp || String(document.readyState || '') === 'complete')) {
            return { ok: false, status: 'skipped-non-host' };
          }
        }
      }
    } catch {}`;

// 通道 4/5/6/7/8/11 共用的顶层帧 + 宿主 DOM 标记守卫（与原表达式逐字符一致）
const CHANNEL_MAIN_FRAME_HOST_GUARD = `    try {
      if (window.self !== window.top) return { ok: false, status: 'skipped-subframe' };
    } catch {
      return { ok: false, status: 'skipped-subframe' };
    }
    const hasDomMarker = () => {
      try {
        if (
          document.body &&
          document.body.classList &&
          (document.body.classList.contains('theme-standalone') || document.body.classList.contains('monaco-workbench'))
        ) {
          return true;
        }
        return Boolean(
          typeof document.querySelector === 'function' &&
            document.querySelector(
              '.agy-shell, .agy-home, [data-testid="aux-pane-split"], [data-testid="conversation-view"], [data-testid="agent-input-box"], [data-testid="model-selector-trigger"], .monaco-workbench'
            )
        );
      } catch {
        return false;
      }
    };
    let needDomMarkerOnReady = false;
    let isPlainHttpLocalhost = false;
    try {
      const loc = typeof window !== 'undefined' && window.location;
      const href = loc && typeof loc.href === 'string' ? loc.href : '';
      if (href) {
        const low = href.toLowerCase();
        if (low.startsWith('devtools://') || low.startsWith('data:') || low.startsWith('chrome:') || low.startsWith('chrome-extension:') || low.startsWith('edge:') || low.startsWith('blob:') || low.startsWith('plugin:')) {
          return { ok: false, status: 'skipped-non-host' };
        }
        if (low.startsWith('vscode-file://') || low.startsWith('app://') || low.startsWith('about:')) {
          const ttl = String(document.title || '').trim();
          if (/^(?:untitled|launchpad)$/i.test(ttl) || /\\/launchpad(?:\\.html)?(?:[?#]|$)/i.test(low)) {
            return { ok: false, status: 'skipped-non-host' };
          }
        }
        if (low.startsWith('http:') || low.startsWith('https:')) {
          const m = /^(https?):\\/\\/(127\\.0\\.0\\.1|localhost|\\[::1\\])(?::\\d+)?(\\/[^?#]*)?(?:[?#]|$)/i.exec(href);
          if (!m) return { ok: false, status: 'skipped-non-host' };
          const pathname = (m[3] || '/').toLowerCase();
          if (/^\\/(?:viewer(?:\\/|$)|sandbox(?:\\/|$)|stream(?:\\/|$)|api(?:\\/|$))/.test(pathname)) {
            return { ok: false, status: 'skipped-non-host' };
          }
          if (!hasDomMarker()) {
            isPlainHttpLocalhost = m[1].toLowerCase() === 'http';
            const rs = String(document.readyState || '');
            if (isPlainHttpLocalhost) {
              if (rs === 'loading') needDomMarkerOnReady = true;
              else return { ok: false, status: 'skipped-non-host' };
            } else if (!/\\bantigravity\\b/i.test(String(document.title || ''))) {
              if (rs === 'loading') needDomMarkerOnReady = true;
              else return { ok: false, status: 'skipped-non-host' };
            }
          }
        }
      }
    } catch {}`;

module.exports = {
  CHANNEL_OMNI_SIDEBAR_HOST_GUARD,
  CHANNEL_MAIN_FRAME_HOST_GUARD,
};
