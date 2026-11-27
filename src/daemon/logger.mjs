// Obsidian Prism 守护进程日志子组件（0o600 权限、高频突发合并缓冲、错误级同步直写、双文件安全轮转与脱敏，Tier 0）
import fs from 'node:fs';
import { sanitizeSecretText, sanitizeLogLine } from '../../sidecars/daemon/redact.mjs';

export const DAEMON_LOG_MAX_BYTES = 512 * 1024;
const LOG_BURST_WINDOW_MS = 50;
const LOG_FLUSH_DELAY_MS = 120;
const LOG_BUFFER_MAX_BYTES = 4096;

function isImmediateLogMessage(msg) {
  const text = String(msg || '');
  return (
    text.includes('[!]') ||
    text.includes('[boot]') ||
    /\b(?:error|fatal|failed|uncaughtException|unhandledRejection)\b/i.test(text)
  );
}

const activeLoggers = new Set();
let exitHookRegistered = false;
function registerProcessExitFlush(logger) {
  activeLoggers.add(new WeakRef(logger));
  if (exitHookRegistered) return;
  exitHookRegistered = true;
  process.once('exit', () => {
    for (const ref of activeLoggers) {
      try { ref.deref()?.flush(); } catch {}
    }
    activeLoggers.clear();
  });
}

export class DaemonLogger {
  constructor({ logFile = '', silent = false, getCdp = () => null, maxBytes = DAEMON_LOG_MAX_BYTES } = {}) {
    this.logFile = logFile;
    this.silent = Boolean(silent);
    this._getCdp = getCdp;
    this.maxBytes = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : DAEMON_LOG_MAX_BYTES;
    this._logBytes = -1;
    this._pendingLines = [];
    this._pendingBytes = 0;
    this._flushTimer = null;
    this._asyncFlushPromise = null;
    this._lastLogAt = 0;
    registerProcessExitFlush(this);
  }

  _rotateLogFile() {
    if (!this.logFile) return;
    const backupFile = `${this.logFile}.1`;
    try {
      const st = fs.lstatSync(this.logFile);
      if (st.isSymbolicLink()) return;
    } catch {
      this._logBytes = 0;
      return;
    }
    try {
      const bst = fs.lstatSync(backupFile);
      if (bst.isSymbolicLink()) return;
    } catch {}
    let rotated = false;
    try {
      fs.renameSync(this.logFile, backupFile);
      rotated = true;
    } catch {
      try {
        try { fs.unlinkSync(backupFile); } catch {}
        fs.renameSync(this.logFile, backupFile);
        rotated = true;
      } catch {
        try {
          fs.copyFileSync(this.logFile, backupFile);
          rotated = true;
        } catch {}
      }
    }
    if (rotated) {
      try { fs.chmodSync(backupFile, 0o600); } catch {}
    }
    fs.writeFileSync(this.logFile, '', { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(this.logFile, 0o600); } catch {}
    this._logBytes = 0;
  }

  flush() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (this._pendingLines.length === 0 || !this.logFile) {
      this._pendingLines = [];
      this._pendingBytes = 0;
      return;
    }
    const chunk = this._pendingLines.join('');
    this._pendingLines = [];
    this._pendingBytes = 0;
    try {
      fs.appendFileSync(this.logFile, chunk, { encoding: 'utf8', mode: 0o600 });
    } catch {}
  }

  _flushAsync() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (!this.logFile || this._pendingLines.length === 0) {
      this._pendingLines = [];
      this._pendingBytes = 0;
      return this._asyncFlushPromise || Promise.resolve();
    }
    if (this._asyncFlushPromise) return this._asyncFlushPromise;
    const chunk = this._pendingLines.join('');
    this._pendingLines = [];
    this._pendingBytes = 0;
    const task = fs.promises
      .appendFile(this.logFile, chunk, { encoding: 'utf8', mode: 0o600 })
      .catch(() => {})
      .finally(() => {
        if (this._asyncFlushPromise === task) this._asyncFlushPromise = null;
        if (this._pendingLines.length > 0) {
          if (this._pendingBytes >= LOG_BUFFER_MAX_BYTES) void this._flushAsync();
          else this._scheduleFlush();
        }
      });
    this._asyncFlushPromise = task;
    return task;
  }

  async flushAsync() {
    while (this._pendingLines.length > 0 || this._asyncFlushPromise) {
      if (this._pendingLines.length > 0 && !this._asyncFlushPromise) {
        await this._flushAsync();
      } else if (this._asyncFlushPromise) {
        await this._asyncFlushPromise;
      }
    }
  }

  _scheduleFlush() {
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      void this._flushAsync();
    }, LOG_FLUSH_DELAY_MS);
    if (typeof this._flushTimer.unref === 'function') this._flushTimer.unref();
  }

  log(msg, opts = null) {
    if (!this.silent && this.logFile) {
      try {
        if (this._logBytes < 0) {
          try {
            this._logBytes = fs.statSync(this.logFile).size;
          } catch {
            this._logBytes = 0;
          }
        }
        const now = Date.now();
        const line = `[${new Date(now).toISOString()}] ${sanitizeLogLine(msg)}\n`;
        const lineBytes = Buffer.byteLength(line, 'utf8');
        const needsRotate =
          this._logBytes > 0 && (this._logBytes >= this.maxBytes || this._logBytes + lineBytes > this.maxBytes);
        if (needsRotate) {
          this.flush();
          this._rotateLogFile();
        }
        const isColdFirst = this._lastLogAt === 0 && opts?.buffered !== true;
        const syncNow =
          needsRotate ||
          isColdFirst ||
          opts?.sync === true ||
          isImmediateLogMessage(msg);
        this._lastLogAt = now;
        this._logBytes += lineBytes;
        this._pendingLines.push(line);
        this._pendingBytes += lineBytes;
        if (syncNow) {
          this.flush();
        } else if (this._pendingBytes >= LOG_BUFFER_MAX_BYTES) {
          void this._flushAsync();
        } else {
          this._scheduleFlush();
        }
      } catch {}
    }
  }

  redactSensitiveText(text) {
    const cdp = this._getCdp?.();
    const base =
      typeof cdp?.redactSensitiveUrl === 'function'
        ? cdp.redactSensitiveUrl(text)
        : String(text || '');
    return sanitizeSecretText(base);
  }
}

export { sanitizeSecretText, sanitizeLogLine };
