// Obsidian Prism 行内 Diff 敏感路径过滤、URI 解析与安全 Unified Diff 解析器（Tier 1）
import fs from 'node:fs';
import path from 'node:path';
import { isBlockedUncPath } from '../../vendor/omni-viewer/omni-server.mjs';

export const INLINE_DIFF_MAX_URI_LENGTH = 2048;
export const INLINE_DIFF_MAX_PAYLOAD_BYTES = 16384;
export const INLINE_DIFF_MAX_DIFF_LINES = 120;
export const INLINE_DIFF_MAX_SNAPSHOT_LINES = 80;
export const INLINE_DIFF_MAX_LINE_CHARS = 240;
export const INLINE_DIFF_MAX_READ_BYTES = 24 * 1024;
export const INLINE_DIFF_EXPAND_MAX_DIFF_LINES = 1200;
export const INLINE_DIFF_EXPAND_MAX_SNAPSHOT_LINES = 1000;
export const INLINE_DIFF_EXPAND_MAX_READ_BYTES = 128 * 1024;
export const INLINE_DIFF_GIT_MAX_BUFFER = 512 * 1024;
export const INLINE_DIFF_REV_PARSE_TIMEOUT_MS = 3000;
export const INLINE_DIFF_GIT_DIFF_TIMEOUT_MS = 4500;
export const INLINE_DIFF_MAX_GIT_POINTER_BYTES = 4096;

const SENSITIVE_PATH_RULES = JSON.parse(
  fs.readFileSync(new URL('../../sidecars/daemon/sensitive-path-rules.json', import.meta.url), 'utf8')
);
const INLINE_DIFF_SENSITIVE_BASENAMES = new Set(SENSITIVE_PATH_RULES.basenames || []);
const INLINE_DIFF_SENSITIVE_EXTS = new Set(SENSITIVE_PATH_RULES.extensions || []);
const INLINE_DIFF_SENSITIVE_DIRS = new Set(SENSITIVE_PATH_RULES.directories || []);
const INLINE_DIFF_SENSITIVE_SSH_KEYS = new Set(SENSITIVE_PATH_RULES.sshKeyNames || []);
const INLINE_DIFF_SENSITIVE_SYS_PREFIX_RE = new RegExp(SENSITIVE_PATH_RULES.sysPrefixPattern);
const INLINE_DIFF_SENSITIVE_SUBPATH_RE = new RegExp(SENSITIVE_PATH_RULES.subpathPattern);
const INLINE_DIFF_SENSITIVE_SYS_SUFFIXES = Array.isArray(SENSITIVE_PATH_RULES.sysSuffixes)
  ? SENSITIVE_PATH_RULES.sysSuffixes
  : [];

export function clampPositiveInt(value, fallback, maxAllowed) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(maxAllowed, Math.floor(n));
}

export function hasBlockedInlineDiffUnc(rawInput) {
  if (typeof rawInput !== 'string' || !rawInput) return false;
  const s = rawInput.trim();
  if (!s) return false;
  if (isBlockedUncPath(s)) return true;
  // 拦截一切双斜杠/混合斜杠前导（\\、//、\/、/\、\\?\、\\.\），防止 SMB/NetNTLMv2 凭据泄露与 NT 设备路径绕过
  if (/^[\\/]{2}/.test(s)) return true;
  // 拦截单斜杠变体 NT 设备/对象管理器前缀（/?/、/./、\??\、/GLOBAL/UNC/、/GLOBALROOT/Device/Mup|LanmanRedirector|WebDavRedirector）
  if (/^[\\/](?:[?.]+[\\/])+/.test(s)) return true;
  if (/^[\\/]globalroot[\\/]/i.test(s)) return true;
  if (
    /^[\\/](?:global(?:root)?[\\/]+)*(?:unc|device[\\/]+(?:mup|lanmanredirector|webdavredirector|hgfs|vmhgfs|vboxsvr))(?:[\\/]|$)/i.test(
      s
    )
  ) {
    return true;
  }
  return false;
}

export function hasDotDotPathSegment(rawPath) {
  if (typeof rawPath !== 'string') return true;
  const parts = rawPath.split(/[\\/]+/);
  return parts.some((seg) => seg === '..');
}

const ARCHIVE_TOPLEVEL_SCRIPT_EXTS = new Set(['.mjs', '.js', '.cmd', '.sh', '.md']);

function isAllowedGeminiSubpath(segs, geminiIdx) {
  if (geminiIdx + 3 >= segs.length) return false;
  const s1 = segs[geminiIdx + 1];
  const s2 = segs[geminiIdx + 2];
  if (s1 === 'config' && (s2 === 'skills' || s2 === 'rules' || s2 === 'plugins')) return true;
  if (s1 === 'antigravity' && (s2 === 'worktrees' || s2 === 'brain')) return true;
  if (s1 === 'antigravity' && s2 === 'conversations_archive' && segs.length === geminiIdx + 4) {
    const leaf = String(segs[geminiIdx + 3] || '').replace(/[. ]+$/, '');
    const ext = path.posix.extname(leaf);
    if (ext && ARCHIVE_TOPLEVEL_SCRIPT_EXTS.has(ext)) return true;
  }
  return false;
}

export function isSensitiveInlineDiffPath(filePath) {
  if (typeof filePath !== 'string' || !filePath) return true;
  let normalized = filePath.replace(/\\/g, '/');
  while (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  if (!normalized) return true;
  const lower = normalized.toLowerCase();
  const base = path.posix.basename(lower);
  if (!base) return true;
  // 防 Windows 末尾点/空格归一化绕过（例如 config.json. / .env ）
  const cleanBase = base.replace(/[. ]+$/, '');
  const basesToCheck = cleanBase && cleanBase !== base ? [base, cleanBase] : [base];
  for (const b of basesToCheck) {
    if (b.startsWith('.env')) return true;
    if (b.endsWith('_history')) return true;
    if (/^obsidian-prism-(?:thought|suggester|wallpaper|sidebar|storage-guard|usage-rollup)/.test(b) && (b.endsWith('.json') || b.endsWith('.json.tmp'))) {
      return true;
    }
    if (/^config\.backup(?:\.|$)/.test(b)) return true;
    if (INLINE_DIFF_SENSITIVE_BASENAMES.has(b)) return true;
    if (INLINE_DIFF_SENSITIVE_SSH_KEYS.has(b)) return true;
    const ext = path.posix.extname(b);
    if (ext && INLINE_DIFF_SENSITIVE_EXTS.has(ext)) return true;
  }
  const cleanLower = lower.replace(/[. ]+$/, '');
  if (
    INLINE_DIFF_SENSITIVE_SYS_PREFIX_RE.test(lower) ||
    INLINE_DIFF_SENSITIVE_SYS_PREFIX_RE.test(cleanLower) ||
    INLINE_DIFF_SENSITIVE_SUBPATH_RE.test(lower) ||
    INLINE_DIFF_SENSITIVE_SUBPATH_RE.test(cleanLower)
  ) {
    return true;
  }
  const segs = lower.split('/').filter(Boolean);
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i];
    if (seg === '.gemini') {
      if (!isAllowedGeminiSubpath(segs, i)) return true;
      continue;
    }
    if (INLINE_DIFF_SENSITIVE_DIRS.has(seg)) return true;
    if (seg === '.git') return true;
    if (seg === 'thought-translator' && basesToCheck.some((b) => b.endsWith('.json'))) return true;
  }
  for (const suffix of INLINE_DIFF_SENSITIVE_SYS_SUFFIXES) {
    if (lower === suffix || lower.endsWith(suffix) || cleanLower === suffix || cleanLower.endsWith(suffix)) {
      return true;
    }
  }
  return false;
}

export function truncateInlineDiffLine(text, maxChars = INLINE_DIFF_MAX_LINE_CHARS) {
  const s = String(text ?? '');
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function resolveInlineDiffCandidatePath(rawUri) {
  if (typeof rawUri !== 'string') {
    return { ok: false, error: 'invalid_uri' };
  }
  const raw = rawUri.trim();
  if (!raw || raw.length > INLINE_DIFF_MAX_URI_LENGTH) {
    return { ok: false, error: 'invalid_uri' };
  }
  if (/[\x00-\x1f\x7f]/.test(raw) || /%00/i.test(raw)) {
    return { ok: false, error: 'invalid_uri' };
  }
  if (hasBlockedInlineDiffUnc(raw)) {
    return { ok: false, error: 'blocked_unc' };
  }

  let candidatePath = '';
  if (/^file:/i.test(raw)) {
    if (!/^file:\/\//i.test(raw)) {
      return { ok: false, error: 'invalid_uri' };
    }
    const afterScheme = raw.slice(7);
    const rawPathPart = afterScheme.split(/[?#]/, 1)[0];
    // 仅允许本机空主机 file:///...，拒绝 file://host/... 远程共享与 SMB 访问
    if (!rawPathPart.startsWith('/')) {
      return { ok: false, error: 'blocked_unc' };
    }
    if (hasDotDotPathSegment(rawPathPart)) {
      return { ok: false, error: 'blocked_traversal' };
    }
    let decodedPart;
    try {
      decodedPart = decodeURIComponent(rawPathPart);
    } catch {
      return { ok: false, error: 'invalid_uri' };
    }
    if (!decodedPart || /[\x00-\x1f\x7f]/.test(decodedPart)) {
      return { ok: false, error: 'invalid_uri' };
    }
    if (
      hasBlockedInlineDiffUnc(decodedPart) ||
      (decodedPart.startsWith('/') && hasBlockedInlineDiffUnc(decodedPart.slice(1)))
    ) {
      return { ok: false, error: 'blocked_unc' };
    }
    if (hasDotDotPathSegment(decodedPart)) {
      return { ok: false, error: 'blocked_traversal' };
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(raw);
    } catch {
      return { ok: false, error: 'invalid_uri' };
    }
    if (parsedUrl.protocol !== 'file:') {
      return { ok: false, error: 'invalid_uri' };
    }
    if (parsedUrl.hostname) {
      return { ok: false, error: 'blocked_unc' };
    }
    if (/^\/[A-Za-z]:[\\/]/.test(decodedPart)) {
      candidatePath = process.platform === 'win32' ? path.resolve(decodedPart.slice(1)) : decodedPart;
    } else if (decodedPart.startsWith('/')) {
      candidatePath = decodedPart;
    } else {
      return { ok: false, error: 'invalid_uri' };
    }
  } else {
    const isWinDriveAbs = /^[A-Za-z]:[\\/]/.test(raw);
    if (!isWinDriveAbs && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) {
      return { ok: false, error: 'invalid_uri' };
    }
    if (hasDotDotPathSegment(raw)) {
      return { ok: false, error: 'blocked_traversal' };
    }
    if (!isWinDriveAbs && !raw.startsWith('/')) {
      return { ok: false, error: 'invalid_uri' };
    }
    candidatePath = isWinDriveAbs && process.platform === 'win32' ? path.resolve(raw) : raw;
  }

  if (hasBlockedInlineDiffUnc(candidatePath)) {
    return { ok: false, error: 'blocked_unc' };
  }
  if (isSensitiveInlineDiffPath(candidatePath)) {
    return { ok: false, error: 'blocked_sensitive' };
  }
  if (process.platform === 'win32') {
    if (!/^[A-Za-z]:[\\/]/.test(candidatePath)) {
      return { ok: false, error: 'invalid_uri' };
    }
    // 拦截 Windows NTFS 备用数据流（ADS，如 file.txt::$DATA）
    if (candidatePath.slice(2).includes(':')) {
      return { ok: false, error: 'invalid_uri' };
    }
  } else if (!candidatePath.startsWith('/')) {
    return { ok: false, error: 'invalid_uri' };
  }
  return { ok: true, candidatePath };
}

export function unescapeGitQuotedPath(rawToken) {
  if (typeof rawToken !== 'string') return '';
  let s = rawToken.trim();
  if (!s) return '';
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1);
    const bytes = [];
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i];
      if (ch === '\\' && i + 1 < s.length) {
        const next = s[i + 1];
        if (next >= '0' && next <= '7') {
          let oct = next;
          if (i + 2 < s.length && s[i + 2] >= '0' && s[i + 2] <= '7') {
            oct += s[i + 2];
            if (i + 3 < s.length && s[i + 3] >= '0' && s[i + 3] <= '7') {
              oct += s[i + 3];
            }
          }
          bytes.push(parseInt(oct, 8) & 0xff);
          i += oct.length;
          continue;
        }
        const escMap = { n: 0x0a, r: 0x0d, t: 0x09, b: 0x08, f: 0x0c, a: 0x07, v: 0x0b, '"': 0x22, '\\': 0x5c };
        if (Object.prototype.hasOwnProperty.call(escMap, next)) {
          bytes.push(escMap[next]);
        } else {
          const encoded = Buffer.from(next, 'utf8');
          for (const b of encoded) bytes.push(b);
        }
        i += 1;
      } else {
        const encoded = Buffer.from(ch, 'utf8');
        for (const b of encoded) bytes.push(b);
      }
    }
    return Buffer.from(bytes).toString('utf8');
  }
  return s;
}

export function stripGitDiffPrefix(p) {
  const s = unescapeGitQuotedPath(p);
  if (!s || s === '/dev/null') return '';
  return s.replace(/^(?:a|b|i|w|c|o|1|2)\//, '');
}

export function parseDiffGitHeaderPaths(line) {
  const rest = line.slice('diff --git '.length).trim();
  if (!rest) return null;
  const candidates = [];
  const tokens = [];
  let idx = 0;
  while (idx < rest.length && tokens.length < 3) {
    while (idx < rest.length && rest[idx] === ' ') idx += 1;
    if (idx >= rest.length) break;
    if (rest[idx] === '"') {
      let end = idx + 1;
      while (end < rest.length) {
        if (rest[end] === '\\' && end + 1 < rest.length) {
          end += 2;
          continue;
        }
        if (rest[end] === '"') {
          end += 1;
          break;
        }
        end += 1;
      }
      tokens.push(rest.slice(idx, end));
      idx = end;
    } else {
      let end = idx;
      while (end < rest.length && rest[end] !== ' ') end += 1;
      tokens.push(rest.slice(idx, end));
      idx = end;
    }
  }
  if (tokens.length === 2 && idx >= rest.length) {
    const p1 = stripGitDiffPrefix(tokens[0]);
    const p2 = stripGitDiffPrefix(tokens[1]);
    if (p1) candidates.push(p1);
    if (p2) candidates.push(p2);
  }
  // 兜底：无引号且文件名含空格时枚举所有 " b/" 切分点，宁严勿漏
  let splitPos = rest.indexOf(' b/');
  while (splitPos !== -1) {
    const left = stripGitDiffPrefix(rest.slice(0, splitPos));
    const right = stripGitDiffPrefix(rest.slice(splitPos + 1));
    if (left) candidates.push(left);
    if (right) candidates.push(right);
    splitPos = rest.indexOf(' b/', splitPos + 3);
  }
  return candidates.length > 0 ? candidates : null;
}

export function isBlockedDiffHeaderPath(relPath) {
  if (typeof relPath !== 'string' || !relPath) return true;
  if (/[\x00-\x1f\x7f]/.test(relPath)) return true;
  if (hasBlockedInlineDiffUnc(relPath) || hasDotDotPathSegment(relPath)) return true;
  if (isSensitiveInlineDiffPath(relPath)) return true;
  return false;
}

function makeBlockedDiffParseResult() {
  return {
    ok: false,
    reason: 'blocked',
    blocked: true,
    isBinary: false,
    additions: 0,
    deletions: 0,
    truncated: false,
    focusedByHint: false,
    focusHunk: -1,
    cumulativeDiff: false,
    totalLines: 0,
    lines: [],
  };
}

export function isCumulativeDiff(additions, deletions, hints) {
  const hintAdd = Math.max(0, Number(hints?.additions) || 0);
  const hintDel = Math.max(0, Number(hints?.deletions) || 0);
  const hintTotal = hintAdd + hintDel;
  if (hintTotal <= 0) return false;
  const diffTotal = Math.max(0, Number(additions) || 0) + Math.max(0, Number(deletions) || 0);
  return diffTotal > hintTotal * 2 && diffTotal - hintTotal >= 6;
}

export function parseInlineUnifiedDiff(
  rawDiff,
  { maxLines = INLINE_DIFF_MAX_DIFF_LINES, maxLineChars = INLINE_DIFF_MAX_LINE_CHARS, hints = null, expand = false } = {}
) {
  const normalized = String(rawDiff || '').replace(/\r\n/g, '\n');
  const rawLines = normalized.split('\n');
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }
  const hunks = [];
  let curHunk = null;
  let additions = 0;
  let deletions = 0;
  let isBinary = false;
  let inHunk = false;
  let seenDiffHeaders = 0;
  let oldLn = 1;
  let newLn = 1;

  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i];
    if (line.startsWith('diff --git ')) {
      if (seenDiffHeaders >= 1) break;
      seenDiffHeaders += 1;
      inHunk = false;
      curHunk = null;
      const headerPaths = parseDiffGitHeaderPaths(line);
      if (!headerPaths || headerPaths.some((p) => isBlockedDiffHeaderPath(p))) {
        return makeBlockedDiffParseResult();
      }
      continue;
    }
    if (!inHunk) {
      if (seenDiffHeaders >= 1 || /^(?:---|\+\+\+)\s+"?(?:a|b)\//.test(line)) {
        if (line.startsWith('--- ') || line.startsWith('+++ ')) {
          const rawHeaderPath = line.slice(4).split('\t', 1)[0].trim();
          if (rawHeaderPath && rawHeaderPath !== '/dev/null') {
            const p = stripGitDiffPrefix(rawHeaderPath);
            if (!p || isBlockedDiffHeaderPath(p)) return makeBlockedDiffParseResult();
          }
          continue;
        }
        if (seenDiffHeaders >= 1) {
          const metaPrefix = /^(?:rename from |rename to |copy from |copy to )/.exec(line);
          if (metaPrefix) {
            const p = unescapeGitQuotedPath(line.slice(metaPrefix[0].length));
            if (!p || isBlockedDiffHeaderPath(p)) return makeBlockedDiffParseResult();
            continue;
          }
        }
      }
      if ((line.startsWith('Binary files ') && line.endsWith(' differ')) || line === 'GIT binary patch') {
        if (line.startsWith('Binary files ')) {
          const bm = /^Binary files (.+) and (.+) differ$/.exec(line);
          if (bm) {
            const p1 = stripGitDiffPrefix(bm[1]);
            const p2 = stripGitDiffPrefix(bm[2]);
            if ((p1 && isBlockedDiffHeaderPath(p1)) || (p2 && isBlockedDiffHeaderPath(p2))) {
              return makeBlockedDiffParseResult();
            }
          }
        }
        isBinary = true;
        break;
      }
      const hm = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
      if (!hm) continue;
      inHunk = true;
      oldLn = Number(hm[1]);
      newLn = Number(hm[2]);
      curHunk = {
        idx: hunks.length,
        adds: 0,
        dels: 0,
        rows: [{ kind: 'hunk', ln: '', sign: '@@', text: truncateInlineDiffLine(line, maxLineChars) }],
      };
      hunks.push(curHunk);
      continue;
    }

    const hm = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
    if (hm) {
      oldLn = Number(hm[1]);
      newLn = Number(hm[2]);
      curHunk = {
        idx: hunks.length,
        adds: 0,
        dels: 0,
        rows: [{ kind: 'hunk', ln: '', sign: '@@', text: truncateInlineDiffLine(line, maxLineChars) }],
      };
      hunks.push(curHunk);
      continue;
    }
    if (line.startsWith('\\')) continue;
    if (line.startsWith('+')) {
      additions += 1;
      if (curHunk) {
        curHunk.adds += 1;
        curHunk.rows.push({ kind: 'add', ln: String(newLn), sign: '+', text: truncateInlineDiffLine(line.slice(1), maxLineChars) });
      }
      newLn += 1;
    } else if (line.startsWith('-')) {
      deletions += 1;
      if (curHunk) {
        curHunk.dels += 1;
        curHunk.rows.push({ kind: 'del', ln: String(oldLn), sign: '-', text: truncateInlineDiffLine(line.slice(1), maxLineChars) });
      }
      oldLn += 1;
    } else if (line.startsWith(' ') || line === '') {
      if (curHunk) {
        curHunk.rows.push({
          kind: 'ctx',
          ln: String(newLn),
          sign: ' ',
          text: truncateInlineDiffLine(line.startsWith(' ') ? line.slice(1) : '', maxLineChars),
        });
      }
      oldLn += 1;
      newLn += 1;
    }
  }

  if (isBinary) {
    return { blocked: false, isBinary: true, additions: 0, deletions: 0, truncated: false, focusedByHint: false, focusHunk: -1, cumulativeDiff: false, totalLines: 0, lines: [] };
  }

  let totalRowCount = 0;
  for (let i = 0; i < hunks.length; i += 1) totalRowCount += hunks[i].rows.length;

  const hintAdd = Math.max(0, Number(hints?.additions) || 0);
  const hintDel = Math.max(0, Number(hints?.deletions) || 0);
  const hasHints = hintDel > 0 || hintAdd > 0;
  const diffTotal = additions + deletions;
  const hintTotal = hintAdd + hintDel;
  const hasExactStepHunk =
    hasHints &&
    hunks.length > 1 &&
    diffTotal > hintTotal &&
    hunks.some((h) => h.adds === hintAdd && h.dels === hintDel);
  const cumulativeDiff = isCumulativeDiff(additions, deletions, hints) || hasExactStepHunk;
  const needHintScore = hunks.length > 1 && hasHints && (totalRowCount > maxLines || cumulativeDiff);

  if (!needHintScore) {
    const lines = [];
    for (let i = 0; i < hunks.length && lines.length < maxLines; i += 1) {
      const rows = hunks[i].rows;
      for (let j = 0; j < rows.length && lines.length < maxLines; j += 1) lines.push(rows[j]);
    }
    return { blocked: false, isBinary: false, additions, deletions, truncated: totalRowCount > maxLines, focusedByHint: false, focusHunk: -1, cumulativeDiff, totalLines: totalRowCount, lines };
  }

  const scored = hunks.map((h) => {
    let score = 0;
    if (hintDel > 0) {
      if (h.dels > 0) score += 10000;
      if (hintAdd > 0 && h.adds > 0 && h.dels > 0) score += 5000;
    } else if (hintAdd > 0 && h.adds > 0 && h.dels === 0) {
      score += 4000;
    }
    if (h.adds === hintAdd && h.dels === hintDel) score += 2000;
    score -= Math.abs(h.adds - hintAdd) * 4 + Math.abs(h.dels - hintDel) * 6;
    score -= h.idx * 0.5;
    return { h, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].h;

  // 未截断时严格保持文件内自然行号从小到大顺序，仅通过 focusHunk 标记匹配本步块供前端高亮与自动滚动聚焦
  if (totalRowCount <= maxLines) {
    const lines = [];
    for (let i = 0; i < hunks.length && lines.length < maxLines; i += 1) {
      const rows = hunks[i].rows;
      for (let j = 0; j < rows.length && lines.length < maxLines; j += 1) lines.push(rows[j]);
    }
    const focusHunk = cumulativeDiff ? best.idx : -1;
    return {
      blocked: false,
      isBinary: false,
      additions,
      deletions,
      truncated: false,
      focusedByHint: focusHunk >= 0,
      focusHunk,
      cumulativeDiff,
      totalLines: totalRowCount,
      lines,
    };
  }

  const firstDelHunkIdx = hintDel > 0 ? hunks.findIndex((x) => x.dels > 0) : -1;
  const picked = [];
  let used = 0;
  const singleHunkCap = Math.max(48, Math.floor(maxLines * 0.8));
  for (let i = 0; i < scored.length && used < maxLines; i += 1) {
    const h = scored[i].h;
    if (firstDelHunkIdx >= 0 && h.dels === 0 && h.idx < firstDelHunkIdx) continue;
    const rem = maxLines - used;
    if (rem < 4) break;
    const take = Math.min(h.rows.length, picked.length === 0 ? Math.min(rem, Math.max(singleHunkCap, Math.min(h.rows.length, maxLines))) : rem);
    picked.push({ idx: h.idx, slice: h.rows.slice(0, take) });
    used += take;
  }
  // 截断窗口选块后同样严格按自然行号升序输出，禁止倒置重排
  picked.sort((a, b) => a.idx - b.idx);

  const lines = [];
  for (let i = 0; i < picked.length; i += 1) {
    for (let j = 0; j < picked[i].slice.length && lines.length < maxLines; j += 1) lines.push(picked[i].slice[j]);
  }
  const skippedLeading = picked.length > 0 && picked[0].idx > 0;
  const bestOutIdx = picked.findIndex((p) => p.idx === best.idx);
  const focusHunk = (cumulativeDiff || skippedLeading) && bestOutIdx >= 0 ? bestOutIdx : -1;
  return {
    blocked: false,
    isBinary: false,
    additions,
    deletions,
    truncated: totalRowCount > lines.length,
    focusedByHint: skippedLeading || focusHunk >= 0 || (hintDel > 0 && lines.some((r) => r.kind === 'del')),
    focusHunk,
    cumulativeDiff,
    totalLines: totalRowCount,
    lines,
  };
}
