// 零外部依赖的 Node 编译期文本级 CSS Nesting 扁平化引擎（L1 src/compiler/）
// 100% 语义等价：逐字节保留声明（含 var() 简写），保序输出 CSSNestedDeclarations，
// 仅在特异性与匹配集合严格一致时展开父选择器列表和顶层 :is()，完整保护 @media/@supports/@container/@keyframes/@font-face/字符串/属性选择器/url(...)。
'use strict';

const GROUP_AT_RULE_RE = /^@(?:media|supports|container|layer|starting-style|scope)\b/i;
const UNSAFE_VENDOR_SEL_RE = /(?:::?-(?:moz|ms|o)-)/i;

function isUrlStart(s, i) {
  const c0 = s.charCodeAt(i);
  if (c0 !== 117 && c0 !== 85) return false;
  const c1 = s.charCodeAt(i + 1);
  if (c1 !== 114 && c1 !== 82) return false;
  const c2 = s.charCodeAt(i + 2);
  if (c2 !== 108 && c2 !== 76) return false;
  if (s.charCodeAt(i + 3) !== 40) return false;
  if (i > 0) {
    const prev = s.charCodeAt(i - 1);
    if (
      (prev >= 65 && prev <= 90) ||
      (prev >= 97 && prev <= 122) ||
      (prev >= 48 && prev <= 57) ||
      prev === 45 ||
      prev === 95
    ) {
      return false;
    }
  }
  return true;
}

function skipQuoted(s, i) {
  const q = s[i];
  const n = s.length;
  for (i++; i < n; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === q) return i;
  }
  return n - 1;
}

function skipUrlToken(s, i) {
  const n = s.length;
  let j = i + 4;
  let q = '';
  for (; j < n; j++) {
    const c = s[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (q) {
      if (c === q) q = '';
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
    } else if (c === ')') {
      return j;
    }
  }
  return n - 1;
}

// 词法安全地剥离裸 /* ... */ 注释，严格跳过引号字符串与 url(...)
function stripCssCommentsSafe(css) {
  if (!css.includes('/*')) return css;
  const n = css.length;
  let out = '';
  let last = 0;
  for (let i = 0; i < n; i++) {
    const c = css[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipQuoted(css, i);
      continue;
    }
    if (isUrlStart(css, i)) {
      i = skipUrlToken(css, i);
      continue;
    }
    if (c === '/' && css[i + 1] === '*') {
      out += css.slice(last, i) + ' ';
      i += 2;
      while (i < n && !(css[i] === '*' && css[i + 1] === '/')) i++;
      if (i < n) i++; // 跳过 '/'
      last = i + 1;
    }
  }
  if (last === 0) return css;
  return out + css.slice(last);
}

// 在引号外扫描字符串，fn(char, index, bracketDepth) 返回 false 即提前中止
function scanSelector(s, fn) {
  for (let i = 0, d = 0, c; i < s.length; i++) {
    c = s[i];
    if (c === '\\') {
      i++;
    } else if (c === '"' || c === "'") {
      i = skipQuoted(s, i);
    } else if (fn(c, i, (d += c === '(' || c === '[' ? 1 : c === ')' || c === ']' ? -1 : 0)) === false) {
      return false;
    }
  }
  return true;
}

function splitTopLevelCommas(s) {
  const out = [];
  let start = 0;
  scanSelector(s + ',', (c, i, d) => {
    if (c === ',' && !d) {
      const part = s.slice(start, i).trim();
      if (part) out.push(part);
      start = i + 1;
    }
  });
  return out;
}

function isCompoundSelector(s) {
  return scanSelector(s, (c, _i, d) => d || !/[\s>+~]/.test(c));
}

// 计算 CSS Selectors Level 4 特异性（a*1e6 + b*1e3 + c）；遇到未知复杂语法保守返回 NaN
function computeSelectorSpecificity(sel) {
  if (typeof sel !== 'string' || !sel.trim()) return NaN;
  let n = 0;
  let s = sel.replace(/\\.|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => (m[0] === '\\' ? '_' : '""'));

  // 先由内向外解析多层嵌套的 :is()/:not()/:has()/:where()，再统计顶层属性选择器 [...]，避免双重计数或错算 :where([a])
  const fnRe = /:(is|not|has|where)\(([^()]*)\)/g;
  for (let guard = 0; guard < 16 && fnRe.test(s); guard++) {
    fnRe.lastIndex = 0;
    let failed = false;
    s = s.replace(fnRe, (_m, fnName, inner) => {
      if (fnName === 'where') return ' ';
      const parts = splitTopLevelCommas(inner);
      if (!parts.length) {
        failed = true;
        return ' ';
      }
      let best = -1;
      for (let i = 0; i < parts.length; i++) {
        const sp = computeSelectorSpecificity(parts[i]);
        if (sp !== sp) {
          failed = true;
          return ' ';
        }
        if (sp > best) best = sp;
      }
      n += best;
      return ' ';
    });
    if (failed) return NaN;
  }

  s = s.replace(/\[[^\]]*\]/g, () => {
    n += 1e3;
    return '.';
  });
  if (/["'\\[\]]/.test(s)) return NaN;

  // :nth-*(An+B) / :lang(...) / :dir(...) 仅在不含 ` of ` 复杂子句时按单个伪类计算
  const stripped = s.replace(/:nth-[\w-]+\((?:[^()](?!\bof\b))*\)|:(?:lang|dir)\([\w-]+\)/gi, ':x');
  if (/[()]/.test(stripped)) return NaN;

  const ids = (stripped.match(/#[\w-]+/g) || []).length;
  const clsAndPseudo = (
    stripped.match(/(?<!:)(?:\.[\w-]+|:(?!(?:before|after|first-line|first-letter)\b)[\w-]+)/gi) || []
  ).length;
  const typesAndElems = (
    stripped.match(/::?(?:before|after|first-line|first-letter)\b|::[\w-]+|(?<=^|[\s>+~])[a-z][\w-]*/gi) || []
  ).length;
  return n + 1e6 * ids + 1e3 * clsAndPseudo + typesAndElems;
}

function isSafeExpandableSelector(sel, supportsSelector) {
  if (typeof sel !== 'string') return false;
  const t = sel.trim();
  if (!t || /[{}]/.test(t)) return false;
  if (typeof supportsSelector === 'function') {
    try {
      return Boolean(supportsSelector(t));
    } catch {
      return false;
    }
  }
  if (UNSAFE_VENDOR_SEL_RE.test(t)) return false;
  // 验证括号与引号平衡
  let p = 0;
  let b = 0;
  let q = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (q) {
      if (c === q) q = '';
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if (c === '(') p++;
    else if (c === ')') {
      if (--p < 0) return false;
    } else if (c === '[') b++;
    else if (c === ']') {
      if (--b < 0) return false;
    }
  }
  return !q && p === 0 && b === 0;
}

function findMatchingBlockEnd(css, startIdx) {
  const n = css.length;
  let depth = 1;
  for (let i = startIdx; i < n; i++) {
    const c = css[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipQuoted(css, i);
      continue;
    }
    if (isUrlStart(css, i)) {
      i = skipUrlToken(css, i);
      continue;
    }
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return n;
}

function hasBalancedBraces(css) {
  const n = css.length;
  let depth = 0;
  for (let i = 0; i < n; i++) {
    const c = css[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipQuoted(css, i);
      continue;
    }
    if (isUrlStart(css, i)) {
      i = skipUrlToken(css, i);
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function flattenNestedCss(rawCss, options = null) {
  if (typeof rawCss !== 'string' || !rawCss) return '';
  const supportsSelector = options && typeof options.supportsSelector === 'function' ? options.supportsSelector : null;
  const shouldExpandTopLevelIs = Boolean(options && options.expandTopLevelIs === true);
  const css = stripCssCommentsSafe(rawCss);
  if (!hasBalancedBraces(css)) return rawCss;

  const specCache = new Map();
  const getSpec = (s) => {
    let v = specCache.get(s);
    if (v === undefined) {
      v = computeSelectorSpecificity(s);
      specCache.set(s, v);
    }
    return v;
  };
  const sameSpecificity = (list) => {
    if (!list.length) return false;
    const base = getSpec(list[0]);
    if (base !== base) return false;
    for (let i = 1; i < list.length; i++) {
      if (getSpec(list[i]) !== base) return false;
    }
    return true;
  };

  const okCache = new Map();
  const isOkSel = (s) => {
    let v = okCache.get(s);
    if (v === undefined) {
      v = isSafeExpandableSelector(s, supportsSelector);
      okCache.set(s, v);
    }
    return v;
  };

  // 将子选择器中的 & 替换为父选择器 P（或在纯文本替换会改变匹配语义时保守包裹为 :is(P)）
  const substParent = (child, parentText, plainMode) => {
    let out = '';
    let last = 0;
    let inAttr = 0;
    scanSelector(child, (ch, i) => {
      if (ch === '[') {
        inAttr++;
        return;
      }
      if (ch === ']') {
        if (inAttr > 0) inAttr--;
        return;
      }
      if (ch !== '&' || inAttr > 0) return;
      const pre = child.slice(0, i).trimEnd();
      const first = !pre || /[(,]$/.test(pre);
      const canInline = plainMode && (first || (plainMode > 1 && /[\s>+~]/.test(child[i - 1])));
      out += child.slice(last, i) + (canInline ? parentText : ':is(' + parentText + ')');
      last = i + 1;
    });
    return out + child.slice(last);
  };

  // 仅在匹配集合与特异性完全等价且不触及 :not()/:where()/:has()/属性内部时展开顶层 :is(...)
  const expandTopLevelIs = (sel, from = 0) => {
    let at = -1;
    let end = -1;
    scanSelector(sel, (c, i, d) => {
      if (i >= from && d === 1 && c === '(' && sel.slice(i - 3, i) === ':is' && sel[i - 4] !== ':') {
        at = i - 3;
        return false;
      }
      return true;
    });
    if (at < 0) return [sel];
    scanSelector(sel.slice(at), (c, i, d) => {
      if (c === ')' && !d) {
        end = at + i;
        return false;
      }
      return true;
    });
    if (end < 0) return [sel];

    const parts = splitTopLevelCommas(sel.slice(at + 4, end));
    const pre = sel.slice(0, at);
    const post = sel.slice(end + 1);
    const fits = (p) =>
      isCompoundSelector(p)
        ? !pre || /[\s>+~(,]$/.test(pre) || !/^[\w*-]/.test(p)
        : !pre.trim() && /^([\s>+~.:[#]|$)/.test(post);

    if (!parts.length || parts.length > 40 || !sameSpecificity(parts) || !parts.every((p) => fits(p) && isOkSel(p))) {
      return expandTopLevelIs(sel, end + 1);
    }
    const res = [];
    for (let i = 0; i < parts.length; i++) {
      const sub = expandTopLevelIs(pre + parts[i] + post, at);
      for (let j = 0; j < sub.length; j++) {
        if (res.push(sub[j]) > 200) return [sel];
      }
    }
    return res;
  };

  const PSEUDO_ELEM_RE = /::|:(?:before|after|first-line|first-letter|-webkit-|-moz-|-ms-|-o-)/i;
  const foldDescendantList = (P, children) => {
    const order = [];
    let curRun = null;
    const flushRun = () => {
      if (!curRun) return;
      order.push(curRun);
      curRun = null;
    };
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (c.startsWith('& ')) {
        const rest = c.slice(2).trim();
        if (rest && !rest.includes('&') && !/^[>+~]/.test(rest) && !PSEUDO_ELEM_RE.test(rest) && isOkSel(rest)) {
          const sp = getSpec(rest);
          if (sp === sp) {
            if (curRun && curRun.sp === sp) {
              curRun.bucket.push(rest);
            } else {
              flushRun();
              curRun = { kind: 'grp', sp, bucket: [rest] };
            }
            continue;
          }
        }
      }
      flushRun();
      order.push({ kind: 'raw', c });
    }
    flushRun();
    const plainMode = isCompoundSelector(P) ? 2 : 1;
    const outList = [];
    for (let i = 0; i < order.length; i++) {
      const it = order[i];
      if (it.kind === 'raw') {
        outList.push(substParent(it.c, P, plainMode));
      } else if (it.bucket.length >= 2) {
        outList.push(P + ' :is(' + it.bucket.join(',') + ')');
      } else {
        outList.push(substParent('& ' + it.bucket[0], P, plainMode));
      }
    }
    return outList;
  };

  const resolveSelectors = (rawPrelude, parentSels) => {
    let list = splitTopLevelCommas(rawPrelude);
    if (parentSels && parentSels.length) {
      list = list.map((c) => {
        let hasAmp = false;
        let inAttr = 0;
        scanSelector(c, (ch) => {
          if (ch === '[') inAttr++;
          else if (ch === ']' && inAttr > 0) inAttr--;
          else if (ch === '&' && !inAttr) {
            hasAmp = true;
            return false;
          }
          return true;
        });
        return hasAmp ? c : '& ' + c;
      });
      if (parentSels.length > 1 && (!sameSpecificity(parentSels) || list.length > 1 || parentSels.length * list.length > 200)) {
        const joinedParents = parentSels.join(',');
        list = list.map((c) => substParent(c, joinedParents, 0));
      } else if (parentSels.length === 1 && list.length > 1 && parentSels[0].length >= 20) {
        list = foldDescendantList(parentSels[0], list);
      } else {
        const combined = [];
        for (let pIdx = 0; pIdx < parentSels.length; pIdx++) {
          const P = parentSels[pIdx];
          const plainMode = isCompoundSelector(P) ? 2 : 1;
          for (let cIdx = 0; cIdx < list.length; cIdx++) {
            combined.push(substParent(list[cIdx], P, plainMode));
          }
        }
        list = combined;
      }
    }
    if (!shouldExpandTopLevelIs) return list;
    const expanded = [];
    for (let i = 0; i < list.length; i++) {
      const ex = expandTopLevelIs(list[i]);
      for (let j = 0; j < ex.length; j++) {
        expanded.push(ex[j]);
        if (expanded.length > 800) return list;
      }
    }
    return expanded;
  };

  const out = [];
  const n = css.length;
  const walk = (i, sels, sink) => {
    let st = i;
    let par = 0;
    let decl = '';
    const flush = () => {
      if (decl && sels && sels.length) {
        sink.push(sels.join(',') + '{' + decl + '}');
      }
      decl = '';
    };

    for (; i < n; i++) {
      const c = css[i];
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        i = skipQuoted(css, i);
        continue;
      }
      if (isUrlStart(css, i)) {
        i = skipUrlToken(css, i);
        continue;
      }
      if (c === '(' || c === '[') {
        par++;
      } else if ((c === ')' || c === ']') && par) {
        par--;
      } else if (!par && (c === ';' || c === '}' || c === '{')) {
        const token = css.slice(st, i).trim();
        if (c !== '{') {
          if (token) {
            if (sels) decl += token + ';';
            else sink.push(token + ';');
          }
          if (c === '}') break;
        } else if (token[0] !== '@') {
          if (sels) flush();
          i = walk(i + 1, resolveSelectors(token, sels), sink);
        } else if (GROUP_AT_RULE_RE.test(token)) {
          if (sels) flush();
          const inner = [];
          i = walk(i + 1, sels, inner);
          if (inner.length) sink.push(token + '{' + inner.join('\n') + '}');
        } else {
          const endIdx = findMatchingBlockEnd(css, i + 1);
          sink.push(token + '{' + css.slice(i + 1, endIdx) + '}');
          i = endIdx;
        }
        st = i + 1;
      }
    }
    if (sels) flush();
    return i;
  };

  walk(0, null, out);
  const flat = out.join('\n');
  if (!flat || !hasBalancedBraces(flat)) return rawCss;
  return flat;
}

module.exports = {
  flattenNestedCss,
  computeSelectorSpecificity,
  isSafeExpandableSelector,
  stripCssCommentsSafe,
};
