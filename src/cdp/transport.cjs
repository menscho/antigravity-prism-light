// Chrome DevTools Protocol (CDP) WebSocket 会话与目标过滤传输层（零内部依赖）
'use strict';

function isEligibleTarget(target) {
  if (!target || target.type !== 'page' || !target.webSocketDebuggerUrl) return false;
  const url = String(target.url || '').trim();
  const title = String(target.title || '').trim();
  if (!url) return false;
  const lowUrl = url.toLowerCase();
  if (
    lowUrl.startsWith('devtools://') ||
    lowUrl.startsWith('data:') ||
    lowUrl.startsWith('about:') ||
    lowUrl.startsWith('chrome:') ||
    lowUrl.startsWith('chrome-extension:') ||
    lowUrl.startsWith('edge:') ||
    lowUrl.startsWith('blob:') ||
    lowUrl.startsWith('plugin:')
  ) {
    return false;
  }
  if (/^(?:untitled|launchpad)$/i.test(title) || /\/launchpad(?:\.html)?(?:[?#]|$)/i.test(lowUrl)) return false;

  if (lowUrl.startsWith('vscode-file://') || lowUrl.startsWith('app://')) {
    return true;
  }
  if (lowUrl.startsWith('file://')) {
    return /workbench|antigravity/i.test(lowUrl) || /\bantigravity\b/i.test(title);
  }

  const m = /^(https?):\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/[^?#]*)?(?:[?#]|$)/i.exec(url);
  if (!m) return false;
  const pathname = (m[3] || '/').toLowerCase();
  if (/^\/(?:viewer(?:\/|$)|sandbox(?:\/|$)|stream(?:\/|$)|api(?:\/|$))/.test(pathname)) {
    return false;
  }
  if (/\bantigravity\b/i.test(title)) return true;
  if (m[1].toLowerCase() === 'https' && (!title || /^127\.0\.0\.1(?::\d+)?/.test(title))) {
    return true;
  }
  return false;
}

const SENSITIVE_URL_QUERY_RE = /([?&](?:token|auth|signature|key|secret)=)[^&\s#"']+/gi;
const SWARM_SIDECAR_HOST_RE = /^swarm--swarm_board-\d+$/;

function redactSensitiveUrl(rawUrl) {
  if (rawUrl === null || rawUrl === undefined) return '';
  return String(rawUrl)
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1***@')
    .replace(SENSITIVE_URL_QUERY_RE, '$1<REDACTED>');
}

function isSwarmSidecarUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    return (
      u.protocol === 'plugin:' &&
      SWARM_SIDECAR_HOST_RE.test(u.hostname || '') &&
      !u.port &&
      !u.username &&
      !u.password &&
      u.pathname === '/'
    );
  } catch {
    return false;
  }
}

async function listPages(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(2000),
  });
  const targets = await res.json();
  return targets.filter(isEligibleTarget);
}

async function listSwarmTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(2000),
  });
  const targets = await res.json();
  if (!Array.isArray(targets)) return [];
  return targets
    .filter((t) => {
      if (!t || (t.type !== 'iframe' && t.type !== 'page') || !t.webSocketDebuggerUrl) return false;
      return isSwarmSidecarUrl(t.url);
    })
    .map((t) => ({
      ...t,
      url: redactSensitiveUrl(t.url || ''),
      title: redactSensitiveUrl(t.title || t.url || ''),
    }));
}

async function getBrowserWsUrl(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const info = await res.json();
    return typeof info?.webSocketDebuggerUrl === 'string' ? info.webSocketDebuggerUrl : null;
  } catch {
    return null;
  }
}

class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.onClose = null;
    this.listeners = new Map();
    this.sessionListeners = new Map();
    this._childSessions = new Map();
    ws.addEventListener('message', (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (msg.method) {
        if (msg.sessionId) {
          const sMap = this.sessionListeners.get(msg.sessionId);
          if (sMap) {
            for (const cb of sMap.get(msg.method) || []) cb(msg.params);
          }
          return;
        }
        for (const cb of this.listeners.get(msg.method) || []) cb(msg.params);
        return;
      }
      const p = msg.id && this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    });
    const markClosed = (reason) => {
      if (this.closed) return;
      this.closed = true;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error(reason || 'CDP connection closed'));
      }
      this.pending.clear();
      const children = [...this._childSessions.values()];
      this._childSessions.clear();
      this.sessionListeners.clear();
      for (const ch of children) {
        try {
          ch.detachLocal();
        } catch {}
      }
      if (this.onClose) {
        try {
          this.onClose();
        } catch {}
      }
    };
    ws.addEventListener('close', () => markClosed('CDP connection closed'));
    ws.addEventListener('error', () => markClosed('CDP socket error'));
  }

  static connect(wsUrl, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        reject(new Error('CDP connect timeout'));
      }, timeoutMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
      ws.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve(new CdpSession(ws));
        },
        { once: true }
      );
      ws.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error('CDP connect failed'));
        },
        { once: true }
      );
    });
  }

  send(method, params = {}, timeoutMs = 5000, sessionId = null) {
    if (this.closed) return Promise.reject(new Error('CDP connection closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timeout`));
      }, timeoutMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
        this.ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  on(method, callback) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(callback);
  }

  onSessionEvent(sessionId, method, callback) {
    if (!sessionId || !method || typeof callback !== 'function') return;
    let sMap = this.sessionListeners.get(sessionId);
    if (!sMap) {
      sMap = new Map();
      this.sessionListeners.set(sessionId, sMap);
    }
    if (!sMap.has(method)) sMap.set(method, []);
    sMap.get(method).push(callback);
  }

  offSession(sessionId) {
    if (!sessionId) return;
    this.sessionListeners.delete(sessionId);
    this._childSessions.delete(sessionId);
  }

  createChildSession(sessionId, targetId = '') {
    const parent = this;
    let childClosed = false;
    const child = {
      sessionId: String(sessionId || ''),
      targetId: String(targetId || ''),
      parent,
      onClose: null,
      get closed() {
        return childClosed || parent.closed;
      },
      send(method, params = {}, timeoutMs = 5000) {
        if (childClosed || parent.closed) {
          return Promise.reject(new Error('CDP child session closed'));
        }
        return parent.send(method, params, timeoutMs, child.sessionId);
      },
      on(method, callback) {
        if (childClosed || parent.closed) return;
        parent.onSessionEvent(child.sessionId, method, callback);
      },
      async evaluate(expression, awaitPromise = false, timeoutMs = 4000) {
        const res = await child.send(
          'Runtime.evaluate',
          {
            expression,
            returnByValue: true,
            awaitPromise,
          },
          timeoutMs
        );
        if (res && res.exceptionDetails) {
          throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
        }
        return res && res.result ? res.result.value : undefined;
      },
      detachLocal() {
        if (childClosed) return;
        childClosed = true;
        parent.offSession(child.sessionId);
        if (typeof child.onClose === 'function') {
          try {
            child.onClose();
          } catch {}
        }
      },
      close() {
        if (childClosed) return;
        child.detachLocal();
        if (!parent.closed && child.sessionId) {
          parent.send('Target.detachFromTarget', { sessionId: child.sessionId }, 1500).catch(() => {});
        }
      },
    };
    if (child.sessionId) {
      this._childSessions.set(child.sessionId, child);
    }
    return child;
  }

  async evaluate(expression, awaitPromise = false, timeoutMs = 4000) {
    const res = await this.send(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise,
      },
      timeoutMs
    );
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result.value;
  }

  close() {
    if (!this.closed) this.ws.close();
  }
}

module.exports = {
  isEligibleTarget,
  redactSensitiveUrl,
  isSwarmSidecarUrl,
  listPages,
  listSwarmTargets,
  getBrowserWsUrl,
  CdpSession,
};
