// JS Token 序列化、字面量解码、文本压缩与嵌入 CSS/静态表压缩工具
'use strict';

const {
  minifyCss,
  serializeJsValue,
  serializeStringListExpr,
  packLzssJsExpr,
  collectWindowFrequencies,
  applyBatchPhraseReplacements,
} = require('./css-pack.cjs');
const {
  SAFE_PREV_NO_ASI,
  SAFE_NEXT_NO_ASI,
  needsSpace,
} = require('./js-tokenizer.cjs');

const SAFE_STMT_START_KW = new Set([
  'const', 'let', 'var', 'function', 'if', 'for', 'while', 'return',
  'try', 'catch', 'finally', 'else', 'switch', 'case', 'default',
  'delete', 'throw', 'break', 'continue',
]);

const CTRL_PAREN_KW = new Set(['if', 'while', 'for', 'with']);
const NO_DROP_SEMI_PREV = new Set(['else', 'do', ':', ';', '{', 'try', 'finally']);

function serializeTokens(tokens) {
  const out = [];
  let lastCh = '';
  let lastTokenVal = '';
  let pendingNL = false;
  const parenIsCtrl = [];
  let lastRParenWasCtrl = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'ws') continue;
    if (t.type === 'nl') {
      pendingNL = true;
      continue;
    }
    const val = t.val;
    if (!val) continue;
    // Safely omit redundant statement-ending ';' immediately before '}' (never drop EmptyStatement after control headers/labels)
    if (val === ';' && !NO_DROP_SEMI_PREV.has(lastTokenVal) && !(lastTokenVal === ')' && lastRParenWasCtrl)) {
      let nextVal = '';
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].type === 'ws' || tokens[j].type === 'nl' || !tokens[j].val) continue;
        nextVal = tokens[j].val;
        break;
      }
      if (nextVal === '}') continue;
    }
    if (val === '(') {
      parenIsCtrl.push(CTRL_PAREN_KW.has(lastTokenVal));
    } else if (val === ')') {
      lastRParenWasCtrl = parenIsCtrl.length ? parenIsCtrl.pop() : false;
    } else {
      lastRParenWasCtrl = false;
    }
    const nextCh = val[0];
    if (lastCh) {
      if (pendingNL) {
        const safeDropNL =
          SAFE_PREV_NO_ASI.has(lastCh) ||
          SAFE_NEXT_NO_ASI.has(nextCh) ||
          lastTokenVal === '=>' ||
          lastTokenVal === '&&' ||
          lastTokenVal === '||' ||
          lastTokenVal === '??' ||
          (lastCh === '}' && SAFE_STMT_START_KW.has(val)) ||
          ((lastCh === '+' || lastCh === '-') && lastTokenVal !== '++' && lastTokenVal !== '--');
        if (!safeDropNL) {
          out.push('\n');
          lastCh = '\n';
        } else if (needsSpace(lastCh, nextCh)) {
          out.push(' ');
          lastCh = ' ';
        }
      } else if (needsSpace(lastCh, nextCh)) {
        out.push(' ');
        lastCh = ' ';
      }
    }
    pendingNL = false;
    out.push(val);
    lastCh = val[val.length - 1];
    lastTokenVal = val;
  }
  return out.join('').trim();
}

function decodeSimpleJsString(lit) {
  if (!lit || lit.length < 2) return null;
  const q = lit[0];
  if ((q !== "'" && q !== '"') || lit[lit.length - 1] !== q) return null;
  let out = '';
  for (let i = 1; i < lit.length - 1; i++) {
    const c = lit[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    i++;
    if (i >= lit.length - 1) return null;
    const e = lit[i];
    if (e === 'n') out += '\n';
    else if (e === 'r') out += '\r';
    else if (e === 't') out += '\t';
    else if (e === '\\' || e === "'" || e === '"') out += e;
    else if (e === '0' && !/[0-9]/.test(lit[i + 1] || '')) out += '\0';
    else if (e === 'x' && /^[0-9a-fA-F]{2}/.test(lit.slice(i + 1, i + 3))) {
      out += String.fromCharCode(parseInt(lit.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (e === 'u' && lit[i + 1] === '{') {
      const closeBrace = lit.indexOf('}', i + 2);
      if (closeBrace < 0 || closeBrace >= lit.length - 1) return null;
      const hex = lit.slice(i + 2, closeBrace);
      if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) return null;
      const cp = parseInt(hex, 16);
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
      out += String.fromCodePoint(cp);
      i = closeBrace;
    } else if (e === 'u' && /^[0-9a-fA-F]{4}/.test(lit.slice(i + 1, i + 5))) {
      const code = parseInt(lit.slice(i + 1, i + 5), 16);
      if (code >= 0xd800 && code <= 0xdbff) {
        if (lit.slice(i + 5, i + 7) === '\\u' && /^[0-9a-fA-F]{4}/.test(lit.slice(i + 7, i + 11))) {
          const low = parseInt(lit.slice(i + 7, i + 11), 16);
          if (low >= 0xdc00 && low <= 0xdfff) {
            out += String.fromCharCode(code, low);
            i += 10;
            continue;
          }
        }
        return null;
      }
      if (code >= 0xdc00 && code <= 0xdfff) return null;
      out += String.fromCharCode(code);
      i += 4;
    } else {
      return null;
    }
  }
  return out;
}

function hasLoneUtf16Surrogate(strVal) {
  for (let k = 0; k < strVal.length; k++) {
    const cc = strVal.charCodeAt(k);
    if (cc >= 0xd800 && cc <= 0xdbff) {
      const nx2 = strVal.charCodeAt(k + 1);
      if (nx2 >= 0xdc00 && nx2 <= 0xdfff) {
        k++;
        continue;
      }
      return true;
    }
    if (cc >= 0xdc00 && cc <= 0xdfff) return true;
  }
  return false;
}

function decodeSimpleTemplateBody(body) {
  let out = '';
  const n = body.length;
  for (let i = 0; i < n; i++) {
    const c = body[i];
    if (c === '\r') {
      out += '\n';
      if (body[i + 1] === '\n') i++;
      continue;
    }
    if (c !== '\\') {
      out += c;
      continue;
    }
    i++;
    if (i >= n) return null;
    const e = body[i];
    if (e === 'n') out += '\n';
    else if (e === 'r') out += '\r';
    else if (e === 't') out += '\t';
    else if (e === '\\' || e === '`' || e === '$' || e === "'" || e === '"') out += e;
    else if (e === '\n') continue;
    else if (e === '\r') {
      if (body[i + 1] === '\n') i++;
      continue;
    } else if (e === '0' && !/[0-9]/.test(body[i + 1] || '')) out += '\0';
    else if (e === 'x' && /^[0-9a-fA-F]{2}/.test(body.slice(i + 1, i + 3))) {
      out += String.fromCharCode(parseInt(body.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (e === 'u' && body[i + 1] === '{') {
      const closeBrace = body.indexOf('}', i + 2);
      if (closeBrace < 0) return null;
      const hex = body.slice(i + 2, closeBrace);
      if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) return null;
      const cp = parseInt(hex, 16);
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
      out += String.fromCodePoint(cp);
      i = closeBrace;
    } else if (e === 'u' && /^[0-9a-fA-F]{4}/.test(body.slice(i + 1, i + 5))) {
      const code = parseInt(body.slice(i + 1, i + 5), 16);
      if (code >= 0xd800 && code <= 0xdfff) return null;
      out += String.fromCharCode(code);
      i += 4;
    } else {
      return null;
    }
  }
  return out;
}

function packTextJsExpr(text, maxDict = 5200) {
  if (text.length >= 8192) {
    const lzPacked = packLzssJsExpr(text, ['ag-cs-home-panel', 'SIDEBAR_STUDIO_CLIENT_V2']);
    if (lzPacked && Buffer.byteLength(lzPacked, 'utf8') + 12 < Buffer.byteLength(serializeJsValue(text), 'utf8')) {
      return lzPacked;
    }
  }
  const usedInText = new Set();
  for (let i = 0; i < text.length; i++) {
    const cc = text.charCodeAt(i);
    if ((cc >= 0x00a1 && cc <= 0x17ff) || (cc >= 0xe010 && cc <= 0xf8ff)) usedInText.add(cc);
  }
  const freeTokens = [];
  let contiguous = false;
  let TOKEN_BASE = 0x0100;
  for (const candBase of [0x00a1, 0x00b8, 0x0100]) {
    const contLimit = Math.min(0x17ff, candBase + maxDict - 1);
    let ok = true;
    for (let cc = candBase; cc <= contLimit; cc++) {
      if (usedInText.has(cc)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      TOKEN_BASE = candBase;
      contiguous = true;
      for (let cc = candBase; cc <= contLimit && freeTokens.length < maxDict; cc++) {
        freeTokens.push(String.fromCharCode(cc));
      }
      break;
    }
  }
  if (!contiguous) {
    for (let cc = 0x00a1; cc <= 0x07ff && freeTokens.length < maxDict; cc++) {
      if (cc === 0x00ad) continue;
      if (!usedInText.has(cc)) freeTokens.push(String.fromCharCode(cc));
    }
    for (let cc = 0xe010; cc <= 0xf8ff && freeTokens.length < maxDict; cc++) {
      if (!usedInText.has(cc)) freeTokens.push(String.fromCharCode(cc));
    }
  }
  if (freeTokens.length < 16) return serializeJsValue(text);

  let work = text;
  const dict = [];
  const tokChars = [];

  const wordRe = /[A-Za-z0-9_.#\-:;()=,{}\[\]\/ <>"']{4,56}/g;
  for (let round = 0; round < 6 && dict.length < Math.min(1400, freeTokens.length); round++) {
    const freq = new Map();
    const matches = work.match(wordRe);
    if (!matches) break;
    for (let m = 0; m < matches.length; m++) {
      freq.set(matches[m], (freq.get(matches[m]) || 0) + 1);
    }
    const res = applyBatchPhraseReplacements(work, freq, freeTokens, dict, tokChars, contiguous, 5, 240, 0);
    work = res.work;
    if (res.added < 6) break;
  }

  for (const winLen of [36, 24, 16, 11, 8, 6, 4, 3, 2]) {
    const maxPasses = winLen <= 4 ? 2 : 1;
    for (let pass = 0; pass < maxPasses && dict.length < freeTokens.length; pass++) {
      const freq = collectWindowFrequencies(work, winLen, false);
      const res = applyBatchPhraseReplacements(work, freq, freeTokens, dict, tokChars, contiguous, 4, 360, winLen);
      work = res.work;
      if (res.added < 6) break;
    }
  }

  const rawExpr = serializeJsValue(text);
  if (dict.length === 0) return rawExpr;

  let packed = '';
  if (contiguous) {
    const maxHex = (TOKEN_BASE + dict.length - 1).toString(16).padStart(4, '0');
    const baseHex = TOKEN_BASE.toString(16).padStart(4, '0');
    const decRe = new RegExp(`[\\u${baseHex}-\\u${maxHex}]`, 'g');
    let verify = work;
    for (let f = 1, guard = 0; f && guard < 32; guard++) {
      f = 0;
      verify = verify.replace(decRe, (c) => {
        f = 1;
        return dict[c.charCodeAt(0) - TOKEN_BASE];
      });
    }
    if (verify !== text) return rawExpr;
    packed = `(()=>{let s=${serializeJsValue(work)},d=${serializeStringListExpr(dict)};for(let f=1;f;)f=0,s=s.replace(/[\\u${baseHex}-\\u${maxHex}]/g,(c)=>(f=1,d[c.charCodeAt(0)-${TOKEN_BASE}]));return s})()`;
  } else {
    const decMap = new Map();
    for (let i = 0; i < dict.length; i++) decMap.set(tokChars[i], dict[i]);
    const decRe = /[\u00A1-\u07FF\uE010-\uF8FF]/g;
    let verify = work;
    for (let f = 1, guard = 0; f && guard < 32; guard++) {
      f = 0;
      verify = verify.replace(decRe, (c) => {
        const v = decMap.get(c);
        if (v === undefined) return c;
        f = 1;
        return v;
      });
    }
    if (verify !== text) return rawExpr;
    const skipChars = [String.fromCharCode(0x00ad)];
    for (const cc of usedInText) {
      if ((cc >= 0x00a1 && cc <= 0x07ff && cc !== 0x00ad) || (cc >= 0xe010 && cc <= 0xf8ff)) {
        skipChars.push(String.fromCharCode(cc));
      }
    }
    const skipStr = skipChars.join('');
    const litKPacked = `(()=>{let s=${serializeJsValue(work)},k=${serializeJsValue(tokChars.join(''))},d=${serializeStringListExpr(dict)},m=new Map(Array.from(k,(c,i)=>[c,d[i]]));for(let f=1;f;)f=0,s=s.replace(/[\\u00A1-\\u07FF\\uE010-\\uF8FF]/g,(c)=>{let v=m.get(c);return v===void 0?c:(f=1,v)});return s})()`;
    const genKPacked = `(()=>{let s=${serializeJsValue(work)},u=new Set(${serializeJsValue(skipStr)}),d=${serializeStringListExpr(dict)},m=new Map(),j=0,F=String.fromCharCode;for(let c=161;c<2048&&j<d.length;c++){let k=F(c);if(!u.has(k))m.set(k,d[j++])}for(let c=57360;c<63744&&j<d.length;c++){let k=F(c);if(!u.has(k))m.set(k,d[j++])}for(let f=1;f;)f=0,s=s.replace(/[\\u00A1-\\u07FF\\uE010-\\uF8FF]/g,(c)=>{let v=m.get(c);return v===void 0?c:(f=1,v)});return s})()`;
    packed = Buffer.byteLength(genKPacked, 'utf8') < Buffer.byteLength(litKPacked, 'utf8') ? genKPacked : litKPacked;
  }
  return Buffer.byteLength(packed, 'utf8') + 12 < Buffer.byteLength(rawExpr, 'utf8') ? packed : rawExpr;
}

function compactStaticStringArrayMap(src, constName) {
  const marker = `const ${constName} = {`;
  const start = src.indexOf(marker);
  if (start < 0) return src;
  let i = start + marker.length - 1;
  let depth = 0;
  let end = -1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const q = ch;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
    i++;
  }
  if (end < 0) return src;
  const rawBlock = src.slice(start + `const ${constName} = `.length, end);
  let p = 0;
  const n = rawBlock.length;
  const skipWS = () => {
    while (p < n) {
      if (/\s/.test(rawBlock[p])) { p++; continue; }
      if (rawBlock[p] === '/' && rawBlock[p + 1] === '/') {
        while (p < n && rawBlock[p] !== '\n') p++;
        continue;
      }
      if (rawBlock[p] === '/' && rawBlock[p + 1] === '*') {
        p += 2;
        while (p < n && !(rawBlock[p] === '*' && rawBlock[p + 1] === '/')) p++;
        p += 2;
        continue;
      }
      break;
    }
  };
  const readStr = () => {
    const q = rawBlock[p];
    if (q !== "'" && q !== '"') return null;
    p++;
    let s = '';
    while (p < n) {
      const c = rawBlock[p++];
      if (c === q) return s;
      if (c === '\\') {
        const e = rawBlock[p++];
        if (e === 'n') s += '\n';
        else if (e === 'r') s += '\r';
        else if (e === 't') s += '\t';
        else if (e === '\\' || e === "'" || e === '"') s += e;
        else return null;
      } else {
        s += c;
      }
    }
    return null;
  };
  skipWS();
  if (rawBlock[p++] !== '{') return src;
  const rows = [];
  while (p < n) {
    skipWS();
    if (rawBlock[p] === '}') { p++; break; }
    let key = null;
    if (rawBlock[p] === "'" || rawBlock[p] === '"') key = readStr();
    else {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(rawBlock.slice(p));
      if (!m) return src;
      key = m[0];
      p += key.length;
    }
    if (!key || key.includes('\t') || key.includes('\n')) return src;
    skipWS();
    if (rawBlock[p++] !== ':') return src;
    skipWS();
    if (rawBlock[p++] !== '[') return src;
    const arr = [key];
    while (p < n) {
      skipWS();
      if (rawBlock[p] === ']') { p++; break; }
      const item = readStr();
      if (item === null || item.includes('\t') || item.includes('\n')) return src;
      arr.push(item);
      skipWS();
      if (rawBlock[p] === ',') p++;
    }
    rows.push(arr.join('\t'));
    skipWS();
    if (rawBlock[p] === ',') p++;
  }
  let afterEnd = end;
  while (afterEnd < src.length && (src[afterEnd] === ' ' || src[afterEnd] === '\t')) afterEnd++;
  if (src[afterEnd] === ';') afterEnd++;
  const tableBlob = JSON.stringify(rows.join('\n'));
  const replacement = `const ${constName} = Object.fromEntries(${tableBlob}.split("\\n").map((r) => { const a = r.split("\\t"); return [a[0], a.slice(1)]; }));`;
  return src.slice(0, start) + replacement + src.slice(afterEnd);
}

// Balanced-brace template interpolation scanner for embedded CSS (safe with nested `{ ... }` in `${...}`)
function minifyEmbeddedCssTemplate(src) {
  return src.replace(/const CSS\s*=\s*`([\s\S]*?)`;/, (_, body) => {
    const slots = [];
    let safeBody = '';
    let i = 0;
    const n = body.length;
    while (i < n) {
      if (body[i] === '\\' && i + 1 < n) {
        safeBody += body.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (body[i] === '$' && body[i + 1] === '{') {
        let j = i + 2;
        let depth = 1;
        while (j < n && depth > 0) {
          const ch = body[j];
          if (ch === "'" || ch === '"' || ch === '`') {
            const q = ch;
            j++;
            while (j < n) {
              if (body[j] === '\\') { j += 2; continue; }
              if (body[j] === q) { j++; break; }
              j++;
            }
            continue;
          }
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
          j++;
        }
        if (depth === 0) {
          const expr = body.slice(i + 2, j - 1);
          slots.push(expr);
          safeBody += `__AGTPL${slots.length - 1}__`;
          i = j;
          continue;
        }
      }
      safeBody += body[i++];
    }
    const min = minifyCss(safeBody);
    const segs = min.split(/__AGTPL(\d+)__/);
    const jsConcat = segs
      .map((part, idx) => (idx % 2 === 0 ? JSON.stringify(part) : `(${slots[Number(part)]})`))
      .filter((part) => part !== '""')
      .join('+');
    return `const CSS=${jsConcat || '""'};`;
  });
}

module.exports = {
  serializeTokens,
  decodeSimpleJsString,
  hasLoneUtf16Surrogate,
  decodeSimpleTemplateBody,
  packTextJsExpr,
  compactStaticStringArrayMap,
  minifyEmbeddedCssTemplate,
};
