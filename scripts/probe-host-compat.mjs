#!/usr/bin/env node
// Antigravity 宿主兼容性只读探针 CLI：支持 --snapshot <htmlPath> 离线分析与 --live 本机 CDP 实时体检（零写入/零副作用）
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const {
  HOST_SELECTOR_CONTRACTS,
  PROBE_STATUSES,
  evaluateSelectorsInDoc,
  buildLiveProbeExpression,
} = require(path.join(ROOT_DIR, 'src', 'compat', 'host-selectors.cjs'));

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const decodeHtmlAttr = (s) =>
  String(s || '').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function parseTagAttrs(raw) {
  const attrs = Object.create(null);
  const re = /([:@A-Za-z0-9_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(raw))) {
    attrs[m[1].toLowerCase()] = decodeHtmlAttr(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

// 无正则多轮剥离注释与 <script>/<style> 块直至不动点，避免嵌套拼接残留与 ReDoS
function stripHtmlCommentsAndRawBlocks(html) {
  let cur = String(html || '');
  while (true) {
    const lower = cur.toLowerCase();
    let out = '';
    let i = 0;
    let changed = false;
    while (i < cur.length) {
      const lt = cur.indexOf('<', i);
      if (lt < 0) {
        out += cur.slice(i);
        break;
      }
      out += cur.slice(i, lt);
      if (cur.startsWith('<!--', lt)) {
        const end = cur.indexOf('-->', lt + 4);
        if (end >= 0) {
          i = end + 3;
          changed = true;
          continue;
        }
      } else {
        const tag = lower.startsWith('<script', lt) ? 'script' : lower.startsWith('<style', lt) ? 'style' : '';
        if (tag) {
          const nextCh = cur[lt + 1 + tag.length] || '';
          if (nextCh === '>' || /\s/.test(nextCh) || nextCh === '/') {
            const openEnd = cur.indexOf('>', lt + 1 + tag.length);
            if (openEnd >= 0) {
              const closeToken = `</${tag}`;
              let searchFrom = openEnd + 1;
              let closeEnd = -1;
              while (searchFrom < lower.length) {
                const closeIdx = lower.indexOf(closeToken, searchFrom);
                if (closeIdx < 0) break;
                let after = closeIdx + closeToken.length;
                while (after < cur.length && /\s/.test(cur[after])) after += 1;
                if (cur[after] === '>') {
                  closeEnd = after + 1;
                  break;
                }
                searchFrom = closeIdx + closeToken.length;
              }
              if (closeEnd >= 0) {
                i = closeEnd;
                changed = true;
                continue;
              }
            }
          }
        }
      }
      out += '<';
      i = lt + 1;
    }
    if (!changed) return out;
    cur = out;
  }
}

// 零外部依赖轻量只读 HTML 解析器（仅构建只读节点树用于 CSS 选择器查询）
export function parseHtmlToReadonlyDoc(html) {
  const clean = stripHtmlCommentsAndRawBlocks(html);
  const root = { tag: '#document', attrs: Object.create(null), classes: new Set(), parent: null, children: [] };
  const allElements = [];
  const stack = [root];
  const tagRe = /<\s*(\/)?\s*([A-Za-z][A-Za-z0-9:-]*)([^>]*?)(\/)?\s*>/g;
  let m;
  while ((m = tagRe.exec(clean))) {
    const tag = m[2].toLowerCase();
    if (m[1]) {
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const attrs = parseTagAttrs(m[3] || '');
    const parent = stack[stack.length - 1];
    const node = {
      tag, tagName: tag.toUpperCase(), attrs,
      classes: new Set(String(attrs.class || '').split(/\s+/).filter(Boolean)),
      parent, children: [],
      getAttribute(k) { const key = String(k || '').toLowerCase(); return Object.prototype.hasOwnProperty.call(attrs, key) ? attrs[key] : null; },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, String(k || '').toLowerCase()); },
    };
    parent.children.push(node);
    allElements.push(node);
    if (!m[4] && !VOID_TAGS.has(tag)) stack.push(node);
  }
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''));
  return {
    title: titleMatch ? decodeHtmlAttr(titleMatch[1].trim()) : '',
    allElements,
    querySelectorAll: (sel) => matchSelectorGroup(allElements, sel),
    querySelector: (sel) => matchSelectorGroup(allElements, sel)[0] || null,
  };
}

function splitTopLevel(str, delim) {
  const out = [];
  let buf = '', quote = '', bracket = 0, paren = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) { buf += ch; if (ch === quote && str[i - 1] !== '\\') quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '[') bracket += 1;
    else if (ch === ']') bracket = Math.max(0, bracket - 1);
    else if (ch === '(') paren += 1;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    if (ch === delim && bracket === 0 && paren === 0) { if (buf.trim()) out.push(buf.trim()); buf = ''; }
    else buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function tokenizeComplexSelector(sel) {
  const tokens = [];
  let buf = '', quote = '', bracket = 0, paren = 0, pendingSpace = false;
  const flush = () => { if (buf) { tokens.push({ type: 'compound', value: buf }); buf = ''; } };
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (quote) { buf += ch; if (ch === quote && sel[i - 1] !== '\\') quote = ''; continue; }
    if (ch === '"' || ch === "'") {
      if (pendingSpace && tokens.length && tokens[tokens.length - 1].type === 'compound') tokens.push({ type: 'combinator', value: ' ' });
      pendingSpace = false; quote = ch; buf += ch; continue;
    }
    if (ch === '[') bracket += 1;
    else if (ch === ']') bracket = Math.max(0, bracket - 1);
    else if (ch === '(') paren += 1;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    if (bracket === 0 && paren === 0 && (ch === '>' || ch === ' ' || ch === '\t' || ch === '\n')) {
      flush();
      if (ch === '>') {
        if (tokens.length && tokens[tokens.length - 1].type === 'combinator') tokens.pop();
        tokens.push({ type: 'combinator', value: '>' }); pendingSpace = false;
      } else pendingSpace = true;
      continue;
    }
    if (pendingSpace && tokens.length && tokens[tokens.length - 1].type === 'compound') tokens.push({ type: 'combinator', value: ' ' });
    pendingSpace = false; buf += ch;
  }
  flush();
  return tokens;
}

function matchCompound(el, compound) {
  if (!el || el.tag === '#document') return false;
  let i = 0;
  while (i < compound.length) {
    const ch = compound[i];
    if (ch === '*') { i += 1; }
    else if (ch === '#') {
      const m = /^#([A-Za-z0-9_-]+)/.exec(compound.slice(i));
      if (!m || el.attrs.id !== m[1]) return false;
      i += m[0].length;
    } else if (ch === '.') {
      const m = /^\.([A-Za-z0-9_-]+)/.exec(compound.slice(i));
      if (!m || !el.classes.has(m[1])) return false;
      i += m[0].length;
    } else if (ch === '[') {
      const end = compound.indexOf(']', i + 1);
      if (end < 0) return false;
      const am = /^([:@A-Za-z0-9_-]+)(?:\s*([~^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s"'\]]+))(?:\s+([iI]))?)?$/.exec(compound.slice(i + 1, end).trim());
      if (!am) return false;
      const attrName = am[1].toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(el.attrs, attrName)) return false;
      if (am[2]) {
        const op = am[2], ci = Boolean(am[6]);
        let actual = String(el.attrs[attrName] || ''), expected = am[3] ?? am[4] ?? am[5] ?? '';
        if (ci) { actual = actual.toLowerCase(); expected = expected.toLowerCase(); }
        if (op === '=' && actual !== expected) return false;
        if (op === '*=' && !actual.includes(expected)) return false;
        if (op === '^=' && !actual.startsWith(expected)) return false;
        if (op === '$=' && !actual.endsWith(expected)) return false;
        if (op === '~=' && !actual.split(/\s+/).includes(expected)) return false;
      }
      i = end + 1;
    } else if (ch === ':') {
      const pm = /^:([A-Za-z-]+)(?:\(([^)]*)\))?/.exec(compound.slice(i));
      if (!pm) return false;
      const pseudo = pm[1].toLowerCase(), arg = (pm[2] || '').trim(), siblings = el.parent ? el.parent.children : [];
      if (pseudo === 'first-child' && siblings[0] !== el) return false;
      else if (pseudo === 'last-child' && siblings[siblings.length - 1] !== el) return false;
      else if (pseudo === 'last-of-type' && siblings.filter((s) => s.tag === el.tag).pop() !== el) return false;
      else if (pseudo === 'not' && arg && matchCompound(el, arg)) return false;
      i += pm[0].length;
    } else {
      const tm = /^([A-Za-z][A-Za-z0-9:-]*)/.exec(compound.slice(i));
      if (!tm || el.tag !== tm[1].toLowerCase()) return false;
      i += tm[0].length;
    }
  }
  return true;
}

function matchComplex(el, tokens, idx = tokens.length - 1) {
  if (idx < 0) return true;
  if (tokens[idx].type !== 'compound' || !matchCompound(el, tokens[idx].value)) return false;
  if (idx === 0) return true;
  const comb = tokens[idx - 1];
  if (!comb || comb.type !== 'combinator') return false;
  if (comb.value === '>') return Boolean(el.parent && el.parent.tag !== '#document' && matchComplex(el.parent, tokens, idx - 2));
  for (let cur = el.parent; cur && cur.tag !== '#document'; cur = cur.parent) {
    if (matchComplex(cur, tokens, idx - 2)) return true;
  }
  return false;
}

function matchSelectorGroup(allElements, selector) {
  const parsed = splitTopLevel(String(selector || ''), ',').map(tokenizeComplexSelector).filter((t) => t.length > 0);
  if (!parsed.length) return [];
  const hits = [];
  for (let i = 0; i < allElements.length; i++) {
    for (let j = 0; j < parsed.length; j++) {
      if (matchComplex(allElements[i], parsed[j])) { hits.push(allElements[i]); break; }
    }
  }
  return hits;
}

export function runSnapshotProbe(htmlPath, opts = {}) {
  const absPath = path.resolve(htmlPath);
  const doc = parseHtmlToReadonlyDoc(fs.readFileSync(absPath, 'utf8'));
  const hasConv = Boolean(doc.querySelector('[data-testid="conversation-view"], [data-cascade-id], [data-testid="agent-input-box"], [data-testid="model-selector-trigger"]'));
  const snapshotShellOnly = opts.strictAll === true ? false : opts.shellOnly === true ? true : !hasConv;
  return {
    source: 'snapshot',
    snapshotPath: path.relative(ROOT_DIR, absPath).replace(/\\/g, '/'),
    title: doc.title,
    ...evaluateSelectorsInDoc(doc, { contracts: opts.contracts || HOST_SELECTOR_CONTRACTS, snapshotShellOnly }),
  };
}

function fetchLoopbackJson(port, urlPath, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

export async function runLiveProbe(opts = {}) {
  const cdp = require(path.join(ROOT_DIR, 'cdp.js'));
  const port = opts.port || cdp.readPort();
  if (!port) throw new Error(`未发现本机 Antigravity CDP 调试端口（检查 ${cdp.PORT_FILE}）`);
  const versionInfo = await fetchLoopbackJson(port, '/json/version');
  const pages = await cdp.listPages(port);
  const eligible = pages.filter((p) => cdp.isEligibleTarget(p));
  if (!eligible.length) throw new Error(`端口 ${port} 未发现可探测的 Antigravity 主窗口`);
  const target = eligible[0];
  const session = await cdp.CdpSession.connect(target.webSocketDebuggerUrl);
  try {
    const expr = buildLiveProbeExpression(opts.contracts || HOST_SELECTOR_CONTRACTS, { snapshotShellOnly: opts.shellOnly === true });
    const probeRes = await session.evaluate(expr, false, 4000);
    return {
      source: 'live', port, targetTitle: target.title || '',
      browser: versionInfo?.Browser || '',
      userAgent: versionInfo?.['User-Agent'] || probeRes?.host?.userAgent || '',
      ...probeRes,
    };
  } finally {
    session.close();
  }
}

export function formatCompatReport(report) {
  const badge = (st) => (st === 'OK' ? '[OK]' : st === 'FALLBACK_ONLY' ? '[FALLBACK]' : st === 'DEFERRED_DYNAMIC' ? '[DYNAMIC]' : st === 'BROKEN_CRITICAL' ? '[BROKEN!]' : '[MISSING]');
  const lines = [`=== Antigravity Host Compat Probe (${report.source} / ${report.mode}) ===`];
  if (report.snapshotPath) lines.push(`Snapshot : ${report.snapshotPath} (${report.title || 'untitled'})`);
  if (report.browser || report.userAgent) lines.push(`Host     : ${report.browser || 'unknown'} | UA: ${report.userAgent || 'unknown'}`);
  const c = report.counts;
  lines.push(`Overall  : ${report.overallStatus} (primary=${c.primary}, fallback=${c.fallback}, structural=${c.structural}, deferred=${c.deferred}, missing=${c.missing}, brokenCritical=${c.brokenCritical})`);
  lines.push('-'.repeat(86));
  for (const r of report.results) {
    const countInfo = r.count > 0 ? `n=${r.count}${r.visibleCount > 0 ? ` vis=${r.visibleCount}` : ''}` : 'n=0';
    lines.push(`${badge(r.status).padEnd(11)} ${r.id.padEnd(22)} ${r.tier.padEnd(9)} ${r.scope.padEnd(13)} ${r.matchedLayer.padEnd(11)} ${countInfo.padEnd(12)} >=${r.sinceHostVersion}${r.fragile ? ' [FRAGILE]' : ''}`);
  }
  return lines.join('\n');
}

function parseCliArgs(argv) {
  const args = { snapshot: '', live: false, json: false, strictAll: false, shellOnly: false, failOnFallback: false, port: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--snapshot' && argv[i + 1]) args.snapshot = argv[++i];
    else if (a === '--live') args.live = true;
    else if (a === '--json') args.json = true;
    else if (a === '--strict-all') args.strictAll = true;
    else if (a === '--shell-only') args.shellOnly = true;
    else if (a === '--fail-on-fallback') args.failOnFallback = true;
    else if (a === '--port' && argv[i + 1]) args.port = Number(argv[++i]) || 0;
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.snapshot && !args.live) {
    console.error('用法: node scripts/probe-host-compat.mjs --snapshot <htmlPath> [--json] [--strict-all] | --live [--json] [--port <n>]');
    process.exit(1);
  }
  (async () => {
    const report = args.live
      ? await runLiveProbe({ port: args.port, shellOnly: args.shellOnly })
      : runSnapshotProbe(args.snapshot, { strictAll: args.strictAll, shellOnly: args.shellOnly });
    console.log(args.json ? JSON.stringify(report, null, 2) : formatCompatReport(report));
    if (report.overallStatus === PROBE_STATUSES.BROKEN_CRITICAL) process.exit(2);
    if (args.failOnFallback && report.overallStatus === PROBE_STATUSES.FALLBACK_ONLY) process.exit(1);
  })().catch((err) => {
    console.error(`[compat:probe] ${err.message}`);
    process.exit(1);
  });
}
