// R2 收口 P0 Bug A（元素周期表 v2.35.2 运行态不误锁 + 漂移阈值 12px）与 P0 Bug B（.gemini 精准放行 + 敏感行内提示）回归单测
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

import {
  isSensitiveInlineDiffPath,
  resolveInlineDiffCandidatePath,
} from '../src/daemon/inline-diff-filter.mjs';
import { readSafeInlineDiff } from '../sidecars/daemon/main.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const hostBridge = require(path.join(ROOT, 'vendor', 'periodic-picker', 'host-bridge.js'));
const inlineDiffClientMod = require(path.join(ROOT, 'vendor', 'inline-diff', 'inline-diff-client.js'));
const stubMod = require(path.join(ROOT, 'vendor', 'periodic-picker', 'periodic-picker-stub.js'));
const { tokenizeJs } = require(path.join(ROOT, 'src', 'compiler', 'js-tokenizer.cjs'));
const { mangleSafeLocals } = require(path.join(ROOT, 'src', 'compiler', 'js-mangler.cjs'));
const { serializeTokens } = require(path.join(ROOT, 'src', 'compiler', 'js-serializer.cjs'));
const vialCore = require(path.join(ROOT, 'vial-core.js'));
const cdp = require(path.join(ROOT, 'cdp.js'));

function makeMockBox({ ariaLabel = '', disabled = false, attrs = {}, className = '', withCancelBtn = true, cancelHidden = false } = {}) {
  const attrMap = new Map(Object.entries(attrs));
  if (ariaLabel) attrMap.set('aria-label', ariaLabel);
  const cancelBtn = withCancelBtn
    ? {
        hidden: cancelHidden,
        style: { display: cancelHidden ? 'none' : '' },
        getAttribute: (k) => (k === 'data-testid' ? 'input-cancel-button' : null),
      }
    : null;
  const inputBox = {
    getAttribute: (k) => (k === 'data-testid' ? 'agent-input-box' : null),
    querySelector: (sel) => (sel === '[data-testid="input-cancel-button"]' ? cancelBtn : null),
    closest: () => null,
  };
  const triggerBtn = {
    disabled,
    className,
    hasAttribute: (k) => (k === 'disabled' ? disabled || attrMap.has('disabled') : attrMap.has(k)),
    getAttribute: (k) => (attrMap.has(k) ? attrMap.get(k) : null),
    closest: (sel) => (sel === '[data-testid="agent-input-box"]' ? inputBox : null),
  };
  const doc = {
    activeElement: null,
    querySelectorAll: () => [inputBox],
    querySelector: () => triggerBtn,
  };
  return { doc, inputBox, triggerBtn };
}

test('P0 Bug A: v2.35.2 running trigger with /btw or next-turn aria-label is NOT falsely locked, while true disabled signals & v2.35.1 cancel-only state stay locked', () => {
  // 1) v2.35.2 运行态：同卡片存在可见 input-cancel-button，但按钮未禁用且 aria-label 提示 Applies to /btw / next turn -> 解锁 (false)
  const v2352Labels = [
    'Gemini 4 Carbon (High) — Applies to /btw and messages sent after this turn',
    'Claude Opus 4.6 (Applies to   /btw)',
    'Gemini 4 Neon, messages sent after this turn',
    'Gemini 4 Carbon（应用于 /btw 与后续消息）',
    'Gemini 4 Carbon · 下一轮消息生效',
  ];
  for (const label of v2352Labels) {
    const { doc, triggerBtn } = makeMockBox({ ariaLabel: label, withCancelBtn: true });
    assert.equal(
      hostBridge.isModelTriggerLocked(triggerBtn, doc),
      false,
      `v2.35.2 running unlocked trigger must NOT be locked: ${label}`
    );
  }

  // 2) 即使 aria-label 含 Applies to /btw，只要按钮自身带任何真禁用信号，仍必须严格返回 true
  const trueDisabledCases = [
    { name: 'btn.disabled=true', opts: { ariaLabel: 'Applies to /btw', disabled: true } },
    { name: 'disabled attr', opts: { ariaLabel: 'Applies to /btw', attrs: { disabled: '' } } },
    { name: 'aria-disabled=true', opts: { ariaLabel: 'Applies to /btw', attrs: { 'aria-disabled': 'true' } } },
    { name: 'data-disabled=""', opts: { ariaLabel: 'Applies to /btw', attrs: { 'data-disabled': '' } } },
    { name: 'data-disabled="true"', opts: { ariaLabel: 'Applies to /btw', attrs: { 'data-disabled': 'true' } } },
    { name: 'cursor-not-allowed class', opts: { ariaLabel: 'Applies to /btw', className: 'btn cursor-not-allowed opacity-50' } },
    { name: 'cannot be changed while running', opts: { ariaLabel: 'Model cannot be changed while agent is running' } },
    { name: '运行中无法切换', opts: { ariaLabel: '运行中暂无法切换模型' } },
  ];
  for (const tc of trueDisabledCases) {
    const { doc, triggerBtn } = makeMockBox({ ...tc.opts, withCancelBtn: true });
    assert.equal(
      hostBridge.isModelTriggerLocked(triggerBtn, doc),
      true,
      `True disabled signal must still lock trigger (${tc.name})`
    );
  }

  // 3) 老版本 v2.35.1：无解锁 aria-label 且存在可见 input-cancel-button -> 仍锁定 (true)；隐藏 cancel 按钮 -> 解锁 (false)
  {
    const { doc, triggerBtn } = makeMockBox({ ariaLabel: 'Gemini 4 Carbon (High)', withCancelBtn: true, cancelHidden: false });
    assert.equal(hostBridge.isModelTriggerLocked(triggerBtn, doc), true, 'Legacy v2.35.1 visible cancel button without /btw hint must stay locked');
  }
  {
    const { doc, triggerBtn } = makeMockBox({ ariaLabel: 'Gemini 4 Carbon (High)', withCancelBtn: true, cancelHidden: true });
    assert.equal(hostBridge.isModelTriggerLocked(triggerBtn, doc), false, 'Hidden cancel button must not lock trigger');
  }

  // 4) HOLD_MAX_DRIFT_PX 放宽至 12px，减少高 DPI 触控板/鼠标 420ms 长按抖动误取消
  const pickerSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'periodic-picker', 'periodic-picker.js'), 'utf8');
  assert.ok(/\bHOLD_MAX_DRIFT_PX\s*=\s*12\b/.test(pickerSrc), 'HOLD_MAX_DRIFT_PX must be tuned to 12');
});

test('P0 Bug B (Filter & RPC): .gemini code/doc subtrees are allowed while all credential/config/db/transcript/conversation paths remain 100% blocked_sensitive', async () => {
  // 1) 精准放行的 .gemini 普通代码与文档路径
  const allowedPaths = [
    'C:\\Users\\Administrator\\.gemini\\config\\skills\\t3code-dispatcher\\SKILL.md',
    'C:\\Users\\Administrator\\.gemini\\config\\rules\\AGENTS.md',
    'C:\\Users\\Administrator\\.gemini\\config\\plugins\\obsidian-prism\\ui-runtime.js',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\worktrees\\obsidian-prism\\feat\\src\\app.js',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\brain\\46c42ea7\\plan.md',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\conversations_archive\\_manual-archive-runner.mjs',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\conversations_archive\\helper.js',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\conversations_archive\\run.cmd',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\conversations_archive\\README.md',
    '/home/alice/.gemini/config/skills/demo/SKILL.md',
    '/home/alice/.gemini/antigravity/brain/conv-1/report.md',
    '/home/alice/.gemini/antigravity/conversations_archive/restore.sh',
  ];
  for (const p of allowedPaths) {
    assert.equal(isSensitiveInlineDiffPath(p), false, `Expected .gemini code/doc path allowed: ${p}`);
  }

  // 2) 依然 100% 拦截的敏感路径（返回 blocked_sensitive）
  const blockedPaths = [
    'C:\\Users\\Administrator\\.gemini\\config.json',
    'C:\\Users\\Administrator\\.gemini\\oauth_creds.json',
    'C:\\Users\\Administrator\\.gemini\\google_accounts.json',
    'C:\\Users\\Administrator\\.gemini\\config\\obsidian-prism-thought.json',
    'C:\\Users\\Administrator\\.gemini\\config\\obsidian-prism-thought.json.tmp',
    'C:\\Users\\Administrator\\.gemini\\config\\obsidian-prism-suggester.json',
    'C:\\Users\\Administrator\\.gemini\\config\\obsidian-prism-wallpaper.json',
    'C:\\Users\\Administrator\\.gemini\\config\\plugins\\obsidian-prism\\config.json',
    'C:\\Users\\Administrator\\.gemini\\config\\plugins\\obsidian-prism\\daemon.log',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\brain\\conv-1\\transcript.jsonl',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\brain\\conv-1\\.system_generated\\logs\\transcript_full.jsonl',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\conversations\\1234.db',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\conversations\\1234.pb',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\conversations_archive\\123.db',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\conversations_archive\\123.db-wal',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\conversations_archive\\123.db-shm',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\conversations_archive\\123.pb',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\conversations_archive\\123.sqlite',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\conversations_archive\\index.json',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\conversations_archive\\.env',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\conversations_archive\\sub\\a.db',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\conversations_archive\\sub\\nested.mjs',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\sidecar_data\\obsidian-prism\\state.json',
    'C:\\Users\\Administrator\\.gemini\\config\\skills\\demo\\.env',
    'C:\\Users\\Administrator\\.gemini\\config\\skills\\demo\\.env.local',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\worktrees\\proj\\state.vscdb',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\worktrees\\proj\\local.db',
    'C:\\Users\\Administrator\\.gemini\\config\\skills\\demo\\.gemini\\secret.txt',
    '/home/alice/.gemini/config.json',
    '/home/alice/.gemini/antigravity/conversations/a.pb',
    '/repo/oauth_creds.json',
    '/repo/google_accounts.json',
    '/repo/obsidian-prism-suggester.json',
    '/repo/obsidian-prism-wallpaper.json',
    '/repo/daemon.log',
  ];
  for (const p of blockedPaths) {
    assert.equal(isSensitiveInlineDiffPath(p), true, `Expected sensitive path blocked: ${p}`);
    if (process.platform === 'win32' ? /^[A-Za-z]:\\/.test(p) : p.startsWith('/')) {
      const resolved = resolveInlineDiffCandidatePath(p);
      assert.equal(resolved.ok, false);
      assert.equal(resolved.error, 'blocked_sensitive', `Expected blocked_sensitive from resolveInlineDiffCandidatePath for ${p}`);
    }
  }

  // 3) 真实磁盘 Git 仓库模拟 .gemini/config/skills/t3code-dispatcher/SKILL.md 可成功返回 git-diff，而同仓 config.json 仍 blocked_sensitive
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prism-gemini-diff-'));
  try {
    const skillRepo = path.join(tmpDir, '.gemini', 'config', 'skills', 't3code-dispatcher');
    fs.mkdirSync(skillRepo, { recursive: true });
    const gitEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'Prism Test',
      GIT_AUTHOR_EMAIL: 'prism-test@example.invalid',
      GIT_COMMITTER_NAME: 'Prism Test',
      GIT_COMMITTER_EMAIL: 'prism-test@example.invalid',
    };
    const runGit = (args) => execFileSync('git', ['-C', skillRepo, ...args], { encoding: 'utf8', windowsHide: true, env: gitEnv });
    runGit(['init']);
    runGit(['config', 'user.name', 'Prism Test']);
    runGit(['config', 'user.email', 'prism-test@example.invalid']);
    runGit(['config', 'core.autocrlf', 'false']);

    const skillMd = path.join(skillRepo, 'SKILL.md');
    const secretCfg = path.join(skillRepo, 'config.json');
    fs.writeFileSync(skillMd, '# T3 Dispatcher\nline-a\n', 'utf8');
    fs.writeFileSync(secretCfg, '{"secret":"x"}\n', 'utf8');
    runGit(['add', '.']);
    runGit(['commit', '-m', 'init']);
    fs.writeFileSync(skillMd, '# T3 Dispatcher\nline-b\n', 'utf8');

    const okRes = await readSafeInlineDiff(pathToFileURL(skillMd).href);
    assert.equal(okRes.ok, true, `Expected .gemini/config/skills/.../SKILL.md git-diff allowed, got ${JSON.stringify(okRes)}`);
    assert.equal(okRes.mode, 'git-diff');
    assert.ok(okRes.lines.some((l) => l.kind === 'add' && l.text === 'line-b'));

    const blkRes = await readSafeInlineDiff(pathToFileURL(secretCfg).href);
    assert.equal(blkRes.ok, false);
    assert.equal(blkRes.error, 'blocked_sensitive');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('P0 Bug B (Client UI): inline-diff-client renders explicit 8-locale privacy hint on blocked_sensitive with 0 CJK leaks in non-CJK locales & 0 innerHTML', async () => {
  const clientSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'inline-diff', 'inline-diff-client.js'), 'utf8');
  assert.equal(clientSrc.includes('innerHTML'), false, 'inline-diff-client.js must contain 0 innerHTML');

  // Verify 8-locale completeness & 0 CJK in non-CJK locales for inlineDiffSensitive
  const m = /inlineDiffSensitive\s*:\s*\{([\s\S]*?)\},/.exec(clientSrc);
  assert.ok(m, 'inlineDiffSensitive must be declared in DIFF_FALLBACK');
  const block = m[1];
  const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;
  for (const loc of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de']) {
    const lm = new RegExp(`['"]?${loc}['"]?\\s*:\\s*'([^']+)'`).exec(block);
    assert.ok(lm && lm[1].length > 8, `inlineDiffSensitive[${loc}] missing or empty`);
    if (['en', 'ko', 'es', 'fr', 'de'].includes(loc)) {
      assert.equal(CJK_RE.test(lm[1]), false, `inlineDiffSensitive[${loc}] must contain 0 CJK chars: ${lm[1]}`);
    }
  }

  // Runtime DOM test: blocked_sensitive RPC response renders explicit Chinese privacy notice instead of generic noPreview
  const makeNode = (tag, attrs = {}) => {
    const am = new Map(Object.entries(attrs));
    const kids = [];
    const cls = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean));
    const n = {
      nodeType: 1, tagName: tag.toUpperCase(), children: kids, childNodes: kids,
      parentNode: null, parentElement: null, isConnected: true, _txt: '',
      style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
      get className() { return [...cls].join(' '); },
      set className(v) { cls.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); },
      classList: { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c) },
      get firstChild() { return kids[0] || null; },
      get textContent() { return kids.length && !n._txt ? kids.map((c) => c.textContent).join('') : n._txt; },
      set textContent(v) { kids.length = 0; n._txt = String(v ?? ''); },
      setAttribute(k, v) { am.set(k, String(v)); if (k === 'class') n.className = v; },
      getAttribute(k) { return am.has(k) ? am.get(k) : null; },
      hasAttribute(k) { return am.has(k); },
      removeAttribute(k) { am.delete(k); },
      appendChild(c) { c.parentNode = c.parentElement = n; kids.push(c); return c; },
      insertBefore(c, ref) { c.parentNode = c.parentElement = n; const i = ref ? kids.indexOf(ref) : -1; if (i >= 0) kids.splice(i, 0, c); else kids.push(c); return c; },
      removeChild(c) { const i = kids.indexOf(c); if (i >= 0) kids.splice(i, 1); c.parentNode = c.parentElement = null; return c; },
      remove() { n.parentNode?.removeChild(n); },
      addEventListener() {}, removeEventListener() {},
      get nextElementSibling() { if (!n.parentNode) return null; const i = n.parentNode.children.indexOf(n); return i >= 0 ? n.parentNode.children[i + 1] || null : null; },
      matches(sel) {
        return String(sel || '').split(',').map((p) => p.trim()).some((part) => {
          if (!part) return false;
          if (part.startsWith('.')) return cls.has(part.slice(1));
          if (part.startsWith('#')) return am.get('id') === part.slice(1);
          const amatch = /^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/.exec(part);
          if (amatch) return amatch[2] === undefined ? am.has(amatch[1]) : am.get(amatch[1]) === amatch[2];
          return n.tagName === part.toUpperCase();
        });
      },
      closest(s) { let p = n; while (p) { if (p.matches?.(s)) return p; p = p.parentElement; } return null; },
      querySelector(s) { return n.querySelectorAll(s)[0] || null; },
      querySelectorAll(s) {
        const out = [];
        const walk = (x) => { for (const k of x.children) { if (k.matches?.(s)) out.push(k); walk(k); } };
        walk(n);
        return out;
      },
    };
    return n;
  };
  const html = makeNode('html', { 'data-ag-cs-lang': 'zh-CN' });
  const head = makeNode('head');
  const body = makeNode('body');
  html.appendChild(head);
  html.appendChild(body);
  const doc = {
    documentElement: html, head, body, readyState: 'complete',
    createElement: (t) => makeNode(t),
    getElementById: (id) => html.querySelector(`#${id}`),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener() {}, removeEventListener() {},
  };
  const win = {
    document: doc,
    getComputedStyle: (el) => ({ display: 'flex', flexDirection: el?.className?.includes('flex-col') ? 'column' : 'row' }),
    addEventListener() {}, removeEventListener() {},
    __agPrismInlineDiffCall(rawPayload) {
      const req = JSON.parse(rawPayload);
      queueMicrotask(() => win.__agPrismInlineDiffResolve?.(req.id, { ok: false, error: 'blocked_sensitive' }));
    },
  };

  const client = inlineDiffClientMod.createInlineDiffClient({ win, doc, getLang: () => 'zh-CN' });
  const col = makeNode('div', { class: 'flex flex-col' });
  const row = makeNode('div', {
    class: 'group flex w-full',
    'data-testid': 'tool-call-row',
    'data-ag-diff-uri': 'file:///C:/Users/Administrator/.gemini/config.json',
  });
  const badge = makeNode('span', { 'data-testid': 'diff-line-count' });
  badge.textContent = '+1 -0';
  row.appendChild(badge);
  col.appendChild(row);
  body.appendChild(col);

  assert.equal(client.toggleInlineDiffPreview(badge, { noAnim: true }), true);
  await new Promise((r) => setTimeout(r, 20));
  const emptyMsg = col.querySelector('.ag-cs-inline-diff-empty');
  assert.ok(emptyMsg, 'Expected .ag-cs-inline-diff-empty notice');
  assert.equal(
    emptyMsg.textContent,
    '该文件受隐私安全规则保护，已跳过行内预览（可右键在侧栏查看）',
    'blocked_sensitive must render explicit privacy-protection message'
  );
  client.destroy();
});

test('Redteam P0 #1: js-mangler distinguishes LHS/RHS in declarations (free var in object shorthand never renamed) and preserves export names', () => {
  const src1 = `
    function run() {
      const res = { freeGlobalVar, use: () => freeGlobalVar };
      const { a = { anotherFreeVar }, b } = { a: undefined, b: 2 };
      return { res, a, b };
    }
    run();
  `;
  const mangled1 = serializeTokens(mangleSafeLocals(tokenizeJs(src1)));
  assert.ok(mangled1.includes('freeGlobalVar'), `freeGlobalVar must not be mangled: ${mangled1}`);
  assert.ok(mangled1.includes('anotherFreeVar'), `anotherFreeVar in destructuring default must not be mangled: ${mangled1}`);
  const out = vm.runInNewContext(mangled1, { freeGlobalVar: 'G_OK', anotherFreeVar: 'D_OK' });
  assert.equal(out.res.freeGlobalVar, 'G_OK');
  assert.equal(out.res.use(), 'G_OK');
  assert.equal(out.a.anotherFreeVar, 'D_OK');
  assert.equal(out.b, 2);

  const src2 = `
    export function testExp(x) { const localLongName = x + 1; return localLongName + localLongName; }
    export async function testAsyncExp(v) { const innerVal = v * 2; return innerVal + innerVal; }
    export const exportedAlpha = 10, exportedBeta = 20;
    export class ExportedBox { get() { return exportedAlpha + exportedBeta; } }
  `;
  const mangled2 = serializeTokens(mangleSafeLocals(tokenizeJs(src2)));
  assert.ok(/export function testExp\(/.test(mangled2), `export function name must not be mangled: ${mangled2}`);
  assert.ok(/export async function testAsyncExp\(/.test(mangled2), `export async function name must not be mangled: ${mangled2}`);
  assert.ok(mangled2.includes('exportedAlpha') && mangled2.includes('exportedBeta'), `export const names must not be mangled: ${mangled2}`);
  assert.ok(/export class ExportedBox\b/.test(mangled2), `export class name must not be mangled: ${mangled2}`);
});

test('Redteam P0 #2: periodic-picker-stub stays <2KB, renders first-frame [10Ne] mini-keycap badges, blocks short-click (<260ms) 3D open, and opens smoothly on >=260ms hold', async () => {
  const stubSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'periodic-picker', 'periodic-picker-stub.js'), 'utf8');
  assert.ok(Buffer.byteLength(stubSrc, 'utf8') < 2048, `periodic-picker-stub.js must be <2048B, got ${Buffer.byteLength(stubSrc, 'utf8')}B`);
  assert.equal(/[^\x00-\x7f]/.test(stubSrc), false, 'periodic-picker-stub.js must be pure ASCII');
  assert.equal(stubSrc.includes('innerHTML'), false, 'periodic-picker-stub.js must contain 0 innerHTML');

  const mkEl = (tag, attrs = {}, txt = '') => {
    const am = new Map(Object.entries(attrs));
    const kids = [];
    let t = txt;
    const el = {
      tagName: tag.toUpperCase(),
      id: attrs.id || '',
      className: attrs.class || '',
      children: kids,
      childNodes: kids,
      parentNode: null,
      get textContent() { return t || kids.map((c) => c.textContent).join(''); },
      set textContent(v) { t = String(v ?? ''); },
      setAttribute(k, v) { am.set(k, String(v)); if (k === 'id') el.id = String(v); if (k === 'class') el.className = String(v); },
      getAttribute(k) { return am.has(k) ? am.get(k) : null; },
      appendChild(c) { c.parentNode = el; kids.push(c); return c; },
      remove() { if (el.parentNode) { const i = el.parentNode.children.indexOf(el); if (i >= 0) el.parentNode.children.splice(i, 1); el.parentNode = null; } },
      closest(sel) { let p = el; while (p) { if (sel === '[data-testid="model-selector-trigger"]' && p.getAttribute('data-testid') === 'model-selector-trigger') return p; p = p.parentNode; } return null; },
      querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const c of n.children) {
            const match =
              (sel === '[data-testid="model-selector-trigger"]' && c.getAttribute('data-testid') === 'model-selector-trigger') ||
              (sel === '.ag-pp-mini-keycap' && c.className.split(/\s+/).includes('ag-pp-mini-keycap')) ||
              (sel === '[data-ag-pp-stub="1"]' && c.getAttribute('data-ag-pp-stub') === '1') ||
              (sel.startsWith('#') && c.id === sel.slice(1));
            if (match) out.push(c);
            walk(c);
          }
        };
        walk(el);
        return out;
      },
    };
    return el;
  };

  const listeners = new Map();
  const html = mkEl('html');
  const head = mkEl('head');
  const body = mkEl('body');
  html.appendChild(head);
  html.appendChild(body);
  const neonBtn = mkEl('button', { 'data-testid': 'model-selector-trigger', 'aria-label': 'Gemini 4 Neon' }, 'Gemini 4 Neon');
  const carbonBtn = mkEl('button', { 'data-testid': 'model-selector-trigger' }, 'Gemini 4 Carbon (High)');
  body.appendChild(neonBtn);
  body.appendChild(carbonBtn);
  const doc = {
    documentElement: html, head, body, readyState: 'complete', title: 'Antigravity',
    createElement: (t) => mkEl(t),
    getElementById: (id) => html.querySelector('#' + id),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener(k, fn) { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k).add(fn); },
    removeEventListener(k, fn) { listeners.get(k)?.delete(fn); },
  };
  const win = { document: doc, __agPrismSetting() {}, Date, JSON, String, Number, Boolean, Object, Array, Math, setTimeout, clearTimeout };
  win.window = win; win.globalThis = win; win.self = win; win.top = win;

  // 1) 首帧 stub 挂载即刻渲染 [10Ne] 与 [6C] 迷你键帽徽章
  const stub = stubMod.mountPeriodicPickerStub({ root: win, doc });
  const neBadge = neonBtn.querySelector('.ag-pp-mini-keycap');
  const cBadge = carbonBtn.querySelector('.ag-pp-mini-keycap');
  assert.ok(neBadge, 'First-frame stub must render .ag-pp-mini-keycap on Neon trigger');
  assert.equal(neBadge.getAttribute('data-z'), '10');
  assert.equal(neBadge.getAttribute('data-symbol'), 'Ne');
  assert.equal(neBadge.children[0].textContent, '10');
  assert.equal(neBadge.children[1].textContent, 'Ne');
  assert.ok(cBadge && cBadge.getAttribute('data-z') === '6' && cBadge.getAttribute('data-symbol') === 'C');

  // 2) 短按 (<260ms): pointerdown -> 立刻 pointerup -> 置 autoOpen=false, releasedEarly=true，绝不弹 3D 键盘
  for (const fn of listeners.get('pointerdown') || []) fn({ target: neonBtn, button: 0 });
  assert.equal(win.__agPeriodicPendingOpen.autoOpen, true);
  for (const fn of listeners.get('pointerup') || []) fn({ target: neonBtn });
  assert.equal(win.__agPeriodicPendingOpen.autoOpen, false, 'Short click <260ms must clear autoOpen');
  assert.equal(win.__agPeriodicPendingOpen.releasedEarly, true, 'Short click <260ms must mark releasedEarly=true');

  // 通过真实 buildPeriodicPickerExpression 的 consumePendingOpen 复用路径验证短按绝不 open、长按 >=260ms 正确 open
  const fullExpr = cdp.buildPeriodicPickerExpression(cdp.DEFAULT_CONFIG, { noDiskCache: true });
  const hashMatch = /const targetHash = ("[^"]+")/.exec(fullExpr);
  assert.ok(hashMatch, 'targetHash must exist in buildPeriodicPickerExpression');
  const targetHash = JSON.parse(hashMatch[1]);
  const openCalls = [];
  win.location = { href: 'vscode-file://vscode-app/index.html', protocol: 'vscode-file:' };
  html.setAttribute('data-ag-prism-periodic-picker', '1');
  win.__agPrismPeriodicPicker = {
    __prismCodeHash: targetHash,
    getStatus: () => ({ status: 'active', mode: 'on' }),
    open: (trig) => openCalls.push(trig),
  };
  vm.runInNewContext(fullExpr, win);
  assert.equal(openCalls.length, 0, 'Short click (<260ms) must NEVER open 3D keyboard when full bundle loads');
  assert.equal(win.__agPrismPeriodicStub, undefined, 'Upgrade must destroy stub cleanly');

  // 3) 长按 (>=260ms): pointerDownAt 距今 320ms 且未提前松手 -> 完整包接管时正确打开 3D 键盘
  win.__agPeriodicPendingOpen = { trigger: neonBtn, pointerDownAt: Date.now() - 320, autoOpen: true, releasedAt: 0, releasedEarly: false };
  vm.runInNewContext(fullExpr, win);
  assert.equal(openCalls.length, 1, 'Hold >=260ms must smoothly open 3D keyboard on full bundle handoff');
  assert.equal(openCalls[0], neonBtn);
  stub.destroy();
});

test('Redteam P1 #4 & #5: sidebar/storage/usage/config.backup & worktree .git are blocked_sensitive, and multi-locale /btw + title unlock works', () => {
  // P1 #4: 新增敏感路径 100% 拦截
  const extraBlocked = [
    'C:\\Users\\Administrator\\.gemini\\config\\obsidian-prism-sidebar.json',
    'C:\\Users\\Administrator\\.gemini\\config\\obsidian-prism-storage-guard.json',
    'C:\\Users\\Administrator\\.gemini\\config\\obsidian-prism-usage-rollup.json',
    'C:\\Users\\Administrator\\.gemini\\config\\obsidian-prism-usage-rollup-cache.json',
    'C:\\Users\\Administrator\\.gemini\\config\\config.backup.json',
    'C:\\Users\\Administrator\\.gemini\\config\\skills\\demo\\config.backup.2026',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\worktrees\\obsidian-prism\\feat\\.git',
    '/home/alice/.gemini/antigravity/worktrees/proj/.git',
  ];
  for (const p of extraBlocked) {
    assert.equal(isSensitiveInlineDiffPath(p), true, `Expected sensitive path blocked: ${p}`);
  }

  // P1 #5: 日/韩/法/德/西/繁中 /btw 以及 title 属性解锁，同时 title 真禁用仍锁
  const multiLocaleUnlock = [
    { attrs: { 'aria-label': 'Gemini 4 Carbon（/btw に適用）' } },
    { attrs: { 'aria-label': 'Gemini 4 Carbon (/btw 에 적용)' } },
    { attrs: { 'aria-label': 'Gemini 4 Carbon (S’applique à /btw)' } },
    { attrs: { 'aria-label': 'Gemini 4 Carbon (Gilt für /btw)' } },
    { attrs: { 'aria-label': 'Gemini 4 Carbon', title: 'Applies to /btw and subsequent turns' } },
  ];
  for (const tc of multiLocaleUnlock) {
    const { doc, triggerBtn } = makeMockBox({ ...tc, withCancelBtn: true });
    assert.equal(hostBridge.isModelTriggerLocked(triggerBtn, doc), false, `Multi-locale /btw or title hint must unlock: ${JSON.stringify(tc)}`);
  }
  const { doc: lockDoc, triggerBtn: lockBtn } = makeMockBox({
    attrs: { 'aria-label': 'Gemini 4 Carbon', title: 'Model cannot be changed while running' },
    withCancelBtn: true,
  });
  assert.equal(hostBridge.isModelTriggerLocked(lockBtn, lockDoc), true, 'title true-disabled signal must still lock');
});

test('Redteam P1 #6: vial-core swaps canvas on webglcontextlost so 2D fallback draws non-empty frame even when WebGL2 canvas returns null for 2d', () => {
  let draw2dOps = 0;
  const make2dCtx = () => ({
    save() { draw2dOps++; }, restore() {}, clearRect() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    roundRect() {}, rect() {}, clip() {}, setLineDash() {}, measureText: () => ({ width: 20 }),
    fill() { draw2dOps++; }, stroke() { draw2dOps++; },
    fillRect() { draw2dOps++; }, strokeRect() { draw2dOps++; }, fillText() { draw2dOps++; }, strokeText() {},
    setTransform() {}, transform() {}, resetTransform() {}, translate() {}, scale() {}, rotate() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  });

  const glListeners = new Map();
  let glLost = false;
  const mockGl = {
    VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88e4, FLOAT: 0x1406, COLOR_BUFFER_BIT: 0x4000, TRIANGLE_STRIP: 5,
    TEXTURE0: 0x84c0, TEXTURE_2D: 0x0de1, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, NEAREST: 0x2600, LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f, TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
    createShader: () => ({}), shaderSource() {}, compileShader() {}, getShaderParameter: () => true, deleteShader() {},
    createProgram: () => ({}), attachShader() {}, linkProgram() {}, getProgramParameter: () => true, deleteProgram() {},
    createBuffer: () => ({}), bindBuffer() {}, bufferData() {}, deleteBuffer() {},
    getAttribLocation: () => 0, enableVertexAttribArray() {}, vertexAttribPointer() {}, useProgram() {},
    createTexture: () => ({}), activeTexture() {}, bindTexture() {}, texParameteri() {}, texImage2D() {}, texSubImage2D() {}, deleteTexture() {},
    getUniformLocation: () => ({}), uniform1i() {}, uniform1f() {}, uniform2f() {}, uniform3f() {}, uniform3fv() {}, uniform4fv() {}, uniform2fv() {},
    viewport() {}, clearColor() {}, clear() {}, drawArrays() {},
    isContextLost: () => glLost,
    getExtension: () => ({ loseContext() {} }),
  };

  const parent = {
    children: [],
    replaceChild(nextCv, oldCv) {
      const i = this.children.indexOf(oldCv);
      if (i >= 0) this.children[i] = nextCv;
      nextCv.parentNode = this;
      oldCv.parentNode = null;
    },
  };
  const ownerDoc = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0, height: 0, className: '', style: { cssText: '' }, parentNode: null, ownerDocument: ownerDoc,
        addEventListener() {}, removeEventListener() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 68, height: 212 }),
        getContext: (kind) => (kind === '2d' ? make2dCtx() : null),
      };
    },
  };
  const glCanvas = {
    width: 68, height: 212, className: 'vial-cv', style: { cssText: 'width:68px;height:212px' },
    parentNode: parent, ownerDocument: ownerDoc,
    addEventListener(k, fn) { glListeners.set(k, fn); },
    removeEventListener(k) { glListeners.delete(k); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 68, height: 212 }),
    // 严格模拟 HTML5 Canvas 规范：已绑定 webgl2 的节点调用 getContext('2d') 恒返回 null！
    getContext: (kind) => (kind === 'webgl2' ? mockGl : null),
  };
  parent.children.push(glCanvas);

  const vial = vialCore.mountPhysicalWaterVial(glCanvas, { cssWidth: 68, cssHeight: 212, fill: 0.45 });
  assert.equal(vial.getDebugState().rendererMode, 'webgl2');

  // 触发 webglcontextlost -> 必须换入新 2D canvas 并绘制非空画面！
  glLost = true;
  glListeners.get('webglcontextlost')?.({ preventDefault() {} });
  assert.equal(vial.getDebugState().rendererMode, '2d');
  assert.notEqual(parent.children[0], glCanvas, 'Must swap to a fresh 2D canvas node when WebGL2 canvas returns null for 2d');
  draw2dOps = 0;
  vial.step(0.016);
  assert.ok(draw2dOps > 10, `2D fallback must draw non-empty vial + scale marks after webglcontextlost (got ${draw2dOps} ops)`);

  // 触发 webglcontextrestored -> 还原 WebGL2 节点
  glLost = false;
  glListeners.get('webglcontextrestored')?.({});
  assert.equal(vial.getDebugState().rendererMode, 'webgl2');
  assert.equal(parent.children[0], glCanvas, 'webglcontextrestored must restore original WebGL2 canvas');
  vial.dispose();
});
