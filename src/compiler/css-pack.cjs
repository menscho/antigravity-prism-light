// 零依赖词法级 CSS 压缩器、UTF-16 LZSS 压缩器与 CSS 短语字典打包器（L1 src/compiler/）
'use strict';

const { flattenNestedCss } = require('./css-flatten.cjs');

function minifyCss(css) {
  const n = css.length;
  const out = [];
  let i = 0;
  let pendingWS = false, sawCustomPropName = false, inCustomPropVal = false, customParenDepth = 0;
  const NO_SPACE_AFTER = new Set(['{', '}', ';', ',', '>', '~', '(', ':']);
  const NO_SPACE_BEFORE = new Set(['{', '}', ';', ',', '>', '~', ')']);
  const noAfter = (tok) => Boolean(tok) && NO_SPACE_AFTER.has(tok) && !(inCustomPropVal && tok === ',');
  const isHex = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
  const isIdCont = (c) =>
    (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45;
  while (i < n) {
    const ch = css[i];
    if (ch === "'" || ch === '"') {
      if (pendingWS && out.length > 0 && !noAfter(out[out.length - 1])) out.push(' ');
      pendingWS = false;
      let j = i + 1;
      while (j < n) {
        if (css[j] === '\\') { j += 2; continue; }
        if (css[j] === ch) { j++; break; }
        j++;
      }
      out.push(css.slice(i, j));
      i = j;
      continue;
    }
    if (ch === '/' && css[i + 1] === '*') {
      i += 2;
      while (i < n && !(css[i] === '*' && css[i + 1] === '/')) i++;
      i += 2;
      pendingWS = true;
      continue;
    }
    if (
      (ch === 'u' || ch === 'U') &&
      (css[i + 1] === 'r' || css[i + 1] === 'R') &&
      (css[i + 2] === 'l' || css[i + 2] === 'L') &&
      css[i + 3] === '('
    ) {
      if (pendingWS && out.length > 0 && !noAfter(out[out.length - 1])) out.push(' ');
      pendingWS = false;
      let j = i + 4, q = '';
      while (j < n) {
        const c = css[j];
        if (q) { if (c === '\\') { j += 2; continue; } if (c === q) q = ''; }
        else { if (c === "'" || c === '"') q = c; else if (c === ')') { j++; break; } }
        j++;
      }
      out.push(css.slice(i, j));
      i = j;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { pendingWS = true; i++; continue; }
    if (ch === '}' && out.length > 0 && out[out.length - 1] === ';') out.pop();
    if (inCustomPropVal) {
      if (ch === '(') customParenDepth++;
      else if (ch === ')' && customParenDepth > 0) customParenDepth--;
      else if ((ch === ';' || ch === '}') && customParenDepth === 0) { inCustomPropVal = false; sawCustomPropName = false; }
    } else if (ch === '-' && css[i + 1] === '-') {
      const pt = out.length > 0 ? out[out.length - 1] : '';
      if (!pt || pt === '{' || pt === ';') sawCustomPropName = true;
    } else if (ch === ':' && sawCustomPropName) {
      inCustomPropVal = true; sawCustomPropName = false; customParenDepth = 0;
    } else if (ch === '{' || ch === ';' || ch === '}') {
      sawCustomPropName = false;
    }
    if ((NO_SPACE_BEFORE.has(ch) && !(inCustomPropVal && ch === ',')) || (ch === '!' && css.startsWith('!important', i))) {
      pendingWS = false; out.push(ch); i++; continue;
    }
    if (pendingWS && out.length > 0 && !noAfter(out[out.length - 1])) out.push(' ');
    pendingWS = false;
    if (
      ch === '#' &&
      i + 6 < n &&
      (i + 7 >= n || !isIdCont(css.charCodeAt(i + 7))) &&
      isHex(css.charCodeAt(i + 1)) &&
      isHex(css.charCodeAt(i + 2)) &&
      isHex(css.charCodeAt(i + 3)) &&
      isHex(css.charCodeAt(i + 4)) &&
      isHex(css.charCodeAt(i + 5)) &&
      isHex(css.charCodeAt(i + 6)) &&
      css[i + 1].toLowerCase() === css[i + 2].toLowerCase() &&
      css[i + 3].toLowerCase() === css[i + 4].toLowerCase() &&
      css[i + 5].toLowerCase() === css[i + 6].toLowerCase()
    ) {
      let k = i + 7;
      let pDepth = 0;
      let inDeclVal = false;
      while (k < n) {
        const kc = css[k];
        if (kc === "'" || kc === '"') {
          k++;
          while (k < n) {
            if (css[k] === '\\') { k += 2; continue; }
            if (css[k] === kc) { k++; break; }
            k++;
          }
          continue;
        }
        if (kc === '/' && css[k + 1] === '*') {
          k += 2;
          while (k < n && !(css[k] === '*' && css[k + 1] === '/')) k++;
          k += 2;
          continue;
        }
        if (kc === '(') pDepth++;
        else if (kc === ')') { if (pDepth > 0) pDepth--; }
        else if (pDepth === 0) {
          if (kc === ';' || kc === '}') { inDeclVal = true; break; }
          if (kc === '{') break;
        }
        k++;
      }
      if (inDeclVal) {
        out.push('#' + css[i + 1] + css[i + 3] + css[i + 5]);
        i += 7;
        continue;
      }
    }
    out.push(ch);
    i++;
  }
  return out.join('').trim();
}

function serializeJsValue(val) {
  return JSON.stringify(val).replace(/[<>\u2028\u2029]/g, (ch) =>
    `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

function serializeStringListExpr(list) {
  const arrExpr = serializeJsValue(list);
  if (!Array.isArray(list) || list.length < 8) return arrExpr;
  for (const sep of ['\x7f', '\u00fe', '\u00ff']) {
    if (list.every((s) => typeof s === 'string' && !s.includes(sep))) {
      const joinedExpr = `${serializeJsValue(list.join(sep))}.split(${serializeJsValue(sep)})`;
      if (Buffer.byteLength(joinedExpr, 'utf8') < Buffer.byteLength(arrExpr, 'utf8')) return joinedExpr;
    }
  }
  return arrExpr;
}

const PROTECTED_CSS_LITERALS = ['interaction-takeover-card', 'side-question-panel', 'ag-cs-home-panel'];

const LZSS_SAFE_ASCII = (() => {
  const arr = [];
  for (let c = 32; c <= 126; c++) {
    if (c !== 34 && c !== 60 && c !== 62 && c !== 92) arr.push(c);
  }
  return arr; // 91 unescaped 1-byte JSON ASCII chars (no ", <, >, \)
})();

// 纯同步零-eval UTF-16 LZSS 压缩器（~2.7ms 解码，自适应大窗口覆盖全量 CSS/词典，支持完整 BMP/CJK/Emoji）
function packLzssJsExpr(text, protectFirstList = []) {
  if (typeof text !== 'string' || text.length < 1024) return null;
  const n = text.length, usedLow = new Uint8Array(2048);
  for (let i = 0; i < n; i++) { const cc = text.charCodeAt(i); if (cc >= 0x00a1 && cc < 0x0800) usedLow[cc] = 1; }
  // 寻找 0x00A1..0x07FF（全部 2 字节 UTF-8、无转义、无代理项）内最长连续空闲区间
  let bestStart = -1, bestLen = 0, curStart = -1;
  for (let cc = 0x00a1; cc <= 0x0800; cc++) {
    if (cc < 0x0800 && !usedLow[cc]) { if (curStart < 0) curStart = cc; }
    else if (curStart >= 0) { const len = cc - curStart; if (len > bestLen) { bestLen = len; bestStart = curStart; } curStart = -1; }
  }
  if (bestLen < 512) return null;

  const tokStart = bestStart, tokEnd = bestStart + bestLen, BASE = LZSS_SAFE_ASCII.length, isLarge = n > 80000;
  const shortLenSpan = isLarge ? 18 : 22, longLenSpan = isLarge ? 56 : 96, shortMaxLen = 2 + shortLenSpan, longMaxLen = 3 + longLenSpan, maxSteps = isLarge ? 1024 : 768;
  const shortSlots = Math.floor(bestLen * (isLarge ? 0.5 : 0.62)), longBase = tokStart + shortSlots, longSlots = bestLen - shortSlots;
  const shortMaxDist = Math.floor((shortSlots * BASE) / shortLenSpan), longMaxDist = Math.min(262144, Math.floor((longSlots * BASE * BASE) / longLenSpan));
  if (shortMaxDist < 64 || longMaxDist < 512) return null;

  const protectedPos = protectFirstList && protectFirstList.length > 0 ? new Uint8Array(n) : null;
  if (protectedPos) {
    for (let p = 0; p < protectFirstList.length; p++) {
      const lit = protectFirstList[p], idx = lit ? text.indexOf(lit) : -1;
      if (idx >= 0) for (let k = 0; k < lit.length; k++) protectedPos[idx + k] = 1;
    }
  }

  const charBytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const cc = text.charCodeAt(i);
    charBytes[i] =
      cc < 0x80
        ? cc === 34 || cc === 92
          ? 2
          : cc < 32 || cc === 60 || cc === 62
          ? 6
          : 1
        : cc < 0x800
        ? 2
        : 3;
  }

  const head = new Int32Array(65536);
  head.fill(-1);
  const prev = new Int32Array(n);
  prev.fill(-1);
  const hash3 = (pos) =>
    ((text.charCodeAt(pos) * 31 + text.charCodeAt(pos + 1)) * 31 + text.charCodeAt(pos + 2)) & 0xffff;
  const insert = (pos) => {
    if (pos + 2 >= n) return;
    const h = hash3(pos);
    prev[pos] = head[h];
    head[h] = pos;
  };
  const findBest = (pos) => {
    if (pos + 2 >= n) return { len: 0, dist: 0, gain: 0 };
    if (protectedPos && protectedPos[pos]) return { len: 0, dist: 0, gain: 0 };
    const c0 = text.charCodeAt(pos);
    if (c0 >= 0xdc00 && c0 <= 0xdfff) return { len: 0, dist: 0, gain: 0 };
    const h = hash3(pos);
    let cur = head[h];
    let bestMatchLen = 0;
    let bestDist = 0;
    let bestGain = 0;
    let steps = 0;
    let maxLen = Math.min(longMaxLen, n - pos);
    if (protectedPos) {
      for (let k = 1; k < maxLen; k++) {
        if (protectedPos[pos + k]) {
          maxLen = k;
          break;
        }
      }
      if (maxLen < 3) return { len: 0, dist: 0, gain: 0 };
    }
    const c1 = text.charCodeAt(pos + 1);
    const c2 = text.charCodeAt(pos + 2);
    while (cur >= 0 && pos - cur <= longMaxDist && steps < maxSteps) {
      steps++;
      if (
        text.charCodeAt(cur) === c0 &&
        text.charCodeAt(cur + 1) === c1 &&
        text.charCodeAt(cur + 2) === c2
      ) {
        let l = 3;
        let matchBytes = charBytes[pos] + charBytes[pos + 1] + charBytes[pos + 2];
        while (l < maxLen && text.charCodeAt(cur + l) === text.charCodeAt(pos + l)) {
          matchBytes += charBytes[pos + l];
          l++;
        }
        if (l > 0) {
          const lastC = text.charCodeAt(pos + l - 1);
          if (lastC >= 0xd800 && lastC <= 0xdbff) {
            matchBytes -= charBytes[pos + l - 1];
            l--;
          }
        }
        if (l >= 3) {
          const dist = pos - cur;
          const cost = dist <= shortMaxDist && l <= shortMaxLen ? 3 : l >= 4 ? 4 : 999;
          const gain = matchBytes - cost;
          if (gain > bestGain || (gain === bestGain && l > bestMatchLen)) {
            bestGain = gain;
            bestMatchLen = l;
            bestDist = dist;
            if (bestMatchLen === maxLen) break;
          }
        }
      }
      cur = prev[cur];
    }
    return { len: bestMatchLen, dist: bestDist, gain: bestGain };
  };

  const out = [];
  let i = 0;
  while (i < n) {
    const m = findBest(i);
    if (m.gain >= 1) {
      insert(i);
      const m2 = findBest(i + 1);
      if (m2.gain > m.gain + charBytes[i]) {
        out.push(text[i]);
        i++;
        continue;
      }
      if (m.dist <= shortMaxDist && m.len <= shortMaxLen) {
        const st = (m.dist - 1) * shortLenSpan + (m.len - 3);
        out.push(String.fromCharCode(tokStart + Math.floor(st / BASE), LZSS_SAFE_ASCII[st % BASE]));
      } else {
        const st = (m.dist - 1) * longLenSpan + (m.len - 4);
        const q = Math.floor(st / BASE);
        out.push(
          String.fromCharCode(
            longBase + Math.floor(q / BASE),
            LZSS_SAFE_ASCII[q % BASE],
            LZSS_SAFE_ASCII[st % BASE]
          )
        );
      }
      for (let k = 1; k < m.len; k++) insert(i + k);
      i += m.len;
    } else {
      insert(i);
      out.push(text[i]);
      i++;
    }
  }

  const encoded = out.join('');
  // 严格无损往返验证（与运行时解码器逐字节一致）
  const o = new Uint16Array(n);
  let p = 0;
  const decG = (c) => c - 32 - (c > 34) - (c > 60) - (c > 62) - (c > 92);
  for (let idx = 0; idx < encoded.length; ) {
    const c = encoded.charCodeAt(idx++);
    if (c < tokStart || c >= tokEnd) {
      if (p >= n) return null;
      o[p++] = c;
      continue;
    }
    const v1 = decG(encoded.charCodeAt(idx++));
    let st;
    let l;
    let d;
    if (c < longBase) {
      st = (c - tokStart) * BASE + v1;
      l = 3 + (st % shortLenSpan);
      d = 1 + ((st / shortLenSpan) | 0);
    } else {
      st = ((c - longBase) * BASE + v1) * BASE + decG(encoded.charCodeAt(idx++));
      l = 4 + (st % longLenSpan);
      d = 1 + ((st / longLenSpan) | 0);
    }
    let q = p - d;
    if (q < 0 || p + l > n) return null;
    while (l-- > 0) o[p++] = o[q++];
  }
  if (p !== n) return null;
  let verify = '';
  for (let idx = 0; idx < p; idx += 16384) {
    verify += String.fromCharCode.apply(null, o.subarray(idx, Math.min(p, idx + 16384)));
  }
  if (verify !== text) return null;

  const rangeCheck = tokEnd === 2048 ? `c<${tokStart}||c>=2048` : `c<${tokStart}||c>=${tokEnd}`;
  return `(()=>{let s=${serializeJsValue(encoded)},o=new Uint16Array(${n}),p=0,g=c=>c-32-(c>34)-(c>60)-(c>62)-(c>92),r="",i=0;for(;i<s.length;){let c=s.charCodeAt(i++);if(${rangeCheck}){o[p++]=c;continue}let v=g(s.charCodeAt(i++)),t,l,d;if(c<${longBase}){t=(c-${tokStart})*${BASE}+v;l=3+t%${shortLenSpan};d=1+(t/${shortLenSpan}|0)}else{t=((c-${longBase})*${BASE}+v)*${BASE}+g(s.charCodeAt(i++));l=4+t%${longLenSpan};d=1+(t/${longLenSpan}|0)}for(let q=p-d;l--;)o[p++]=o[q++]}for(i=0;i<p;i+=16384)r+=String.fromCharCode.apply(null,o.subarray(i,i+16384<p?i+16384:p));return r})()`;
}

// Fast 2-gram pre-filter + Batch Top-K non-overlapping greedy phrase replacement
function collectWindowFrequencies(work, winLen, skipPua = false) {
  const n = work.length;
  const freq = new Map();
  if (n < winLen * 2) return freq;

  const gramCounts = new Uint16Array(65536);
  const limit = n - winLen;
  if (winLen >= 4) {
    for (let i = 0; i <= limit; i++) {
      const h = ((work.charCodeAt(i) & 0x3f) << 10) | ((work.charCodeAt(i + 1) & 0x1f) << 5) | (work.charCodeAt(i + 2) & 0x1f);
      if (gramCounts[h] < 65535) gramCounts[h]++;
    }
    for (let i = 0; i <= limit; i++) {
      const c0 = work.charCodeAt(i);
      if (skipPua && c0 >= 0xe000 && c0 <= 0xe00f) continue;
      const h = ((c0 & 0x3f) << 10) | ((work.charCodeAt(i + 1) & 0x1f) << 5) | (work.charCodeAt(i + 2) & 0x1f);
      if (gramCounts[h] < 2) continue;
      const cLast = work.charCodeAt(i + winLen - 1);
      if ((c0 >= 0xdc00 && c0 <= 0xdfff) || (cLast >= 0xd800 && cLast <= 0xdbff)) continue;
      const sub = work.slice(i, i + winLen);
      if (sub.includes('\x7f') || (skipPua && /[\uE000-\uE00F]/.test(sub))) continue;
      freq.set(sub, (freq.get(sub) || 0) + 1);
    }
  } else {
    for (let i = 0; i <= limit; i++) {
      const h = ((work.charCodeAt(i) & 0xff) << 8) | (work.charCodeAt(i + 1) & 0xff);
      if (gramCounts[h] < 65535) gramCounts[h]++;
    }
    for (let i = 0; i <= limit; i++) {
      const c0 = work.charCodeAt(i);
      if (skipPua && c0 >= 0xe000 && c0 <= 0xe00f) continue;
      const h = ((c0 & 0xff) << 8) | (work.charCodeAt(i + 1) & 0xff);
      if (gramCounts[h] < 2) continue;
      const cLast = work.charCodeAt(i + winLen - 1);
      if ((c0 >= 0xdc00 && c0 <= 0xdfff) || (cLast >= 0xd800 && cLast <= 0xdbff)) continue;
      const sub = work.slice(i, i + winLen);
      if (sub.includes('\x7f') || (skipPua && /[\uE000-\uE00F]/.test(sub))) continue;
      freq.set(sub, (freq.get(sub) || 0) + 1);
    }
  }
  return freq;
}

function applyBatchPhraseReplacements(work, freq, freeTokens, dict, tokChars, contiguous, minGain, batchLimit = 160, fixedLen = 0) {
  if (dict.length >= freeTokens.length) return { work, added: 0 };
  const dictExtra = contiguous ? 3 : 5;
  const candidates = [];
  for (const [phrase, approx] of freq.entries()) {
    if (approx < 2) continue;
    let estBytes = 0;
    for (let k = 0; k < phrase.length; k++) {
      const cc = phrase.charCodeAt(k);
      estBytes += cc < 0x80 ? 1 : cc < 0x800 ? 2 : 3;
    }
    if (estBytes <= 2) continue;
    const estGain = approx * (estBytes - 2) - (estBytes + dictExtra);
    if (estGain > minGain) {
      candidates.push({ phrase, estBytes, estGain });
    }
  }
  if (candidates.length === 0) return { work, added: 0 };
  candidates.sort((a, b) => b.estGain - a.estGain);

  const limit = Math.min(candidates.length, batchLimit * 2 + 48);
  const tentative = [];

  for (let idx = 0; idx < limit && tentative.length < batchLimit && dict.length + tentative.length < freeTokens.length; idx++) {
    const cand = candidates[idx];
    const phrase = cand.phrase;
    if (phrase.length < 2) continue;
    let overlaps = false;
    for (let c = 0; c < tentative.length; c++) {
      const prev = tentative[c].phrase;
      if (phrase.includes(prev) || prev.includes(phrase)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    const tok = freeTokens[dict.length + tentative.length];
    const tokBytes = tok.charCodeAt(0) < 0x0800 ? 2 : 3;
    if (cand.estBytes <= tokBytes) continue;
    const approx = freq.get(phrase) || 0;
    const predGain = approx * (cand.estBytes - tokBytes) - (cand.estBytes + dictExtra);
    if (predGain <= minGain) continue;

    tentative.push({ phrase, tok, tokBytes });
  }

  if (tentative.length === 0) return { work, added: 0 };

  const headMask = new Uint8Array(65536);
  const hitMap = new Map();
  let curWork = '';

  if (fixedLen >= 2) {
    const tokMap = new Map();
    for (const item of tentative) {
      headMask[((item.phrase.charCodeAt(0) & 0xff) << 8) | (item.phrase.charCodeAt(1) & 0xff)] = 1;
      tokMap.set(item.phrase, item);
      hitMap.set(item.phrase, 0);
    }
    const n = work.length;
    const endLimit = n - fixedLen;
    const outSegs = [];
    let lastPos = 0;
    let i = 0;
    while (i <= endLimit) {
      const h = ((work.charCodeAt(i) & 0xff) << 8) | (work.charCodeAt(i + 1) & 0xff);
      if (headMask[h]) {
        const sub = work.slice(i, i + fixedLen);
        const item = tokMap.get(sub);
        if (item) {
          if (i > lastPos) outSegs.push(work.slice(lastPos, i));
          outSegs.push(item.tok);
          hitMap.set(sub, (hitMap.get(sub) || 0) + 1);
          i += fixedLen;
          lastPos = i;
          continue;
        }
      }
      i++;
    }
    if (lastPos === 0) return { work, added: 0 };
    if (lastPos < n) outSegs.push(work.slice(lastPos));
    curWork = outSegs.join('');
  } else {
    const buckets = new Map();
    for (const item of tentative) {
      const p = item.phrase;
      headMask[((p.charCodeAt(0) & 0xff) << 8) | (p.charCodeAt(1) & 0xff)] = 1;
      const key32 = p.charCodeAt(0) * 65536 + p.charCodeAt(1);
      if (!buckets.has(key32)) buckets.set(key32, []);
      buckets.get(key32).push(item);
      hitMap.set(p, 0);
    }
    for (const list of buckets.values()) {
      list.sort((a, b) => b.phrase.length - a.phrase.length);
    }
    const n = work.length;
    const outSegs = [];
    let lastPos = 0;
    let i = 0;
    while (i < n - 1) {
      const c0 = work.charCodeAt(i);
      const c1 = work.charCodeAt(i + 1);
      if (headMask[((c0 & 0xff) << 8) | (c1 & 0xff)]) {
        const bList = buckets.get(c0 * 65536 + c1);
        if (bList) {
          let matched = null;
          for (let k = 0; k < bList.length; k++) {
            const candItem = bList[k];
            if (work.startsWith(candItem.phrase, i)) {
              matched = candItem;
              break;
            }
          }
          if (matched) {
            if (i > lastPos) outSegs.push(work.slice(lastPos, i));
            outSegs.push(matched.tok);
            hitMap.set(matched.phrase, (hitMap.get(matched.phrase) || 0) + 1);
            i += matched.phrase.length;
            lastPos = i;
            continue;
          }
        }
      }
      i++;
    }
    if (lastPos === 0) return { work, added: 0 };
    if (lastPos < n) outSegs.push(work.slice(lastPos));
    curWork = outSegs.join('');
  }

  const accepted = [];
  const fixupMap = new Map();
  for (const item of tentative) {
    const realHits = hitMap.get(item.phrase) || 0;
    const pBytes = Buffer.byteLength(JSON.stringify(item.phrase), 'utf8') - 2;
    const realGain = realHits * (pBytes - item.tokBytes) - (pBytes + dictExtra);
    if (realHits >= 2 && realGain > 0) {
      const targetTok = freeTokens[dict.length + accepted.length];
      if (item.tok !== targetTok) {
        fixupMap.set(item.tok, targetTok);
        item.tok = targetTok;
      }
      accepted.push(item);
    } else if (realHits > 0) {
      fixupMap.set(item.tok, item.phrase);
    }
  }

  if (fixupMap.size > 0) {
    const charList = [...fixupMap.keys()]
      .map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
      .join('');
    curWork = curWork.replace(new RegExp(`[${charList}]`, 'g'), (c) => fixupMap.get(c));
  }

  if (accepted.length === 0) return { work, added: 0 };

  for (const item of accepted) {
    dict.push(item.phrase);
    tokChars.push(item.tok);
  }

  return { work: curWork, added: accepted.length };
}

const CSS_BUCKET_ORDER = Object.freeze([
  'core', 'paletteWarm', 'paletteHost', 'accentCustom', 'convRipple', 'thoughtExt', 'viewHome', 'viewSidebar', 'viewSettings', 'motionOff', 'motionSubtle', 'motionFull', 'themeLight',
]);
const CSS_BUCKET_MARK_PREFIX = '/*@ag:';
const VIEW_HOME_RE = /(?:\.agy-home\b|\.ag-cs-home-|\.ag-cs-quota-|\.ag-cs-qbar-|\[data-ag-cs-home="(?:studio|classic)"\])/;
const VIEW_SIDEBAR_RE = /(?:\[data-ag-cs-sidebar="on"\]|\.ag-cs-sb-more-|\[data-ag-sb-more-)/;
const VIEW_SETTINGS_RE = /(?:#ag-cs-settings-sec\b|\[data-ag-cs-settings-dlg="1"\]|\bdiv\[role="dialog"\]|\.agy-dialog\b)/;
const THOUGHT_EXT_RE = /(?:\.ag-prism-thought-|\[data-ag-prism-thought-view=|\[data-op-(?:thought-panel|zh-))/;
const KEYFRAME_BUCKET_MAP = { 'ag-b-gr': 'viewHome', 'ag-cs-sonar-pulse-light': 'themeLight', 'ag-prism-thought-chunk-in': 'thoughtExt' };
const BUCKET_PREDICATES = [
  ['themeLight', (s) => s.includes('[data-ag-cs-theme="light"]')],
  ['paletteWarm', (s) => s.includes('[data-ag-cs-palette="warm"]')],
  ['paletteHost', (s) => s.includes('[data-ag-cs-palette="host"]')],
  ['accentCustom', (s) => s.includes('[data-ag-cs-accent')],
  ['convRipple', (s) => s.includes('[data-ag-cs-conv-ripple="1"]')],
  ['viewHome', (s) => VIEW_HOME_RE.test(s)],
  ['viewSettings', (s) => VIEW_SETTINGS_RE.test(s)],
  ['thoughtExt', (s) => THOUGHT_EXT_RE.test(s)],
  ['motionOff', (s) => s.includes('[data-ag-cs-motion="off"]')],
  ['motionSubtle', (s) => s.includes('[data-ag-cs-motion="subtle"]')],
  ['motionFull', (s) => s.includes('[data-ag-cs-motion="standard"]') || s.includes('[data-ag-cs-motion="ultra"]') || s.includes(':not([data-ag-cs-motion])')],
  ['viewSidebar', (s) => VIEW_SIDEBAR_RE.test(s)],
];

// 词法安全地切分顶层 CSS 规则并按主题/视图/动效归类分片
function splitTopLevelCssRules(css) {
  const rules = [];
  for (let i = 0, st = 0, d = 0, n = css.length; i < n; i++) {
    const c = css[i];
    if (c === '\\') { i++; continue; }
    if (c === '"' || c === "'") { for (i++; i < n && css[i] !== c; i++) if (css[i] === '\\') i++; continue; }
    if (c === '/' && css[i + 1] === '*') { for (i += 2; i < n && !(css[i] === '*' && css[i + 1] === '/'); i++); i++; continue; }
    if (c === '{') d++;
    else if (c === '}') { if (d > 0) d--; if (d === 0) { const s = css.slice(st, i + 1).trim(); if (s) rules.push(s); st = i + 1; } }
    else if (c === ';' && d === 0) { const s = css.slice(st, i + 1).trim(); if (s) rules.push(s); st = i + 1; }
    if (i === n - 1 && st < n) { const t = css.slice(st).trim(); if (t) rules.push(t); }
  }
  return rules;
}

function splitSelectorTopCommas(sel) {
  const parts = [];
  for (let i = 0, st = 0, d = 0, n = sel.length; i <= n; i++) {
    const c = i < n ? sel[i] : ',';
    if (c === '\\') { i++; continue; }
    if (c === '"' || c === "'") { for (i++; i < n && sel[i] !== c; i++) if (sel[i] === '\\') i++; continue; }
    if (c === '(' || c === '[') d++;
    else if ((c === ')' || c === ']') && d > 0) d--;
    else if (c === ',' && d === 0) { const p = sel.slice(st, i).trim(); if (p) parts.push(p); st = i + 1; }
  }
  return parts;
}

function skipParenBlock(s, openIdx) {
  for (let j = openIdx + 1, d = 1, n = s.length; j < n; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === '"' || c === "'") { for (j++; j < n && s[j] !== c; j++) if (s[j] === '\\') j++; continue; }
    if (c === '(') d++; else if (c === ')' && --d === 0) return j;
  }
  return s.length - 1;
}

function parseSelectorShellAndGroups(sel) {
  let shell = '';
  const groups = [];
  for (let i = 0, n = sel.length; i < n; i++) {
    const c = sel[i];
    if (c === '\\') { shell += sel.slice(i, i + 2); i++; continue; }
    if (c === '"' || c === "'") { const st = i; for (i++; i < n && sel[i] !== c; i++) if (sel[i] === '\\') i++; shell += sel.slice(st, i + 1); continue; }
    if (sel.startsWith(':not(', i) && sel[i - 1] !== ':') {
      const end = skipParenBlock(sel, i + 4);
      if (sel.slice(i + 5, end).trim() === '[data-ag-cs-motion]') shell += ':not([data-ag-cs-motion])';
      i = end; continue;
    }
    const fnLen = sel.startsWith(':is(', i) ? 4 : sel.startsWith(':where(', i) ? 7 : 0;
    if (fnLen && sel[i - 1] !== ':') { const end = skipParenBlock(sel, i + fnLen - 1); groups.push(splitSelectorTopCommas(sel.slice(i + fnLen, end))); i = end; continue; }
    shell += c;
  }
  return { shell, groups };
}

function selectorEveryBranchMatches(sel, pred) {
  const parts = splitSelectorTopCommas(sel);
  return parts.length > 0 && parts.every((part) => {
    const { shell, groups } = parseSelectorShellAndGroups(part);
    return pred(shell) || groups.some((mems) => mems.length > 0 && mems.every((m) => selectorEveryBranchMatches(m, pred)));
  });
}

function classifyCssRule(rule) {
  if (rule[0] === '@') {
    const km = /^@keyframes\s+([A-Za-z0-9_-]+)/.exec(rule);
    if (km) return KEYFRAME_BUCKET_MAP[km[1]] || 'core';
    if (!rule.startsWith('@media') && !rule.startsWith('@supports')) return 'core';
    const b1 = rule.indexOf('{'), b2 = rule.lastIndexOf('}');
    const inner = b1 >= 0 && b2 > b1 ? splitTopLevelCssRules(rule.slice(b1 + 1, b2)) : [];
    const first = inner.length ? classifyCssRule(inner[0]) : 'core';
    return first !== 'core' && inner.every((r) => classifyCssRule(r) === first) ? first : 'core';
  }
  const brace = rule.indexOf('{'), rawSel = brace > 0 ? rule.slice(0, brace) : rule;
  for (let i = 0; i < BUCKET_PREDICATES.length; i++) if (selectorEveryBranchMatches(rawSel, BUCKET_PREDICATES[i][1])) return BUCKET_PREDICATES[i][0];
  return 'core';
}

function splitCssIntoBuckets(flatCss) {
  const lists = Object.fromEntries(CSS_BUCKET_ORDER.map((k) => [k, []]));
  for (const r of splitTopLevelCssRules(flatCss)) lists[classifyCssRule(r)].push(r);
  return Object.fromEntries(CSS_BUCKET_ORDER.map((k) => [k, lists[k].join('')]));
}

function assembleBucketedCss(buckets) {
  return CSS_BUCKET_ORDER.map((k) => (buckets[k] ? `${CSS_BUCKET_MARK_PREFIX}${k}*/${buckets[k]}` : '')).join('');
}

function packCssJsExpr(css, options = null) {
  const shouldFlatten = !(options && options.flatten === false);
  const flatMin = shouldFlatten ? minifyCss(flattenNestedCss(css)) : css;
  // 默认输出单块连续扁平压缩 CSS（不切 13 桶、不插入 /*@ag:*/*/ 边界标记，保持连续 LZSS 窗口与零漏桶激活）；
  // 仅显式传 { bucketize: true } 时保留旧分桶拼接格式供向后兼容调用
  const shouldBucket = shouldFlatten && Boolean(options && options.bucketize === true) && flatMin.includes('html[data-ag-cs-style]');
  const preparedCss = shouldBucket ? assembleBucketedCss(splitCssIntoBuckets(flatMin)) : flatMin;
  const lzPacked = packLzssJsExpr(preparedCss, PROTECTED_CSS_LITERALS);
  if (lzPacked && Buffer.byteLength(lzPacked, 'utf8') + 12 < Buffer.byteLength(serializeJsValue(preparedCss), 'utf8')) {
    return lzPacked;
  }
  const TOKEN_BASE = 0x00a1;
  const MAX_DICT = 4800; // 0x00A1..0x1360 (1,887 2-byte + 2,913 3-byte UTF-8 chars, all < 0x2028)
  for (let i = 0; i < preparedCss.length; i++) {
    const cc = preparedCss.charCodeAt(i);
    if (cc >= TOKEN_BASE && cc < TOKEN_BASE + MAX_DICT) {
      return serializeJsValue(preparedCss);
    }
  }

  let work = preparedCss;
  for (let p = 0; p < PROTECTED_CSS_LITERALS.length; p++) {
    if (work.includes(String.fromCharCode(0xe000 + p))) return serializeJsValue(preparedCss);
    work = work.split(PROTECTED_CSS_LITERALS[p]).join(String.fromCharCode(0xe000 + p));
  }

  const freeTokens = [];
  for (let k = 0; k < MAX_DICT; k++) freeTokens.push(String.fromCharCode(TOKEN_BASE + k));
  const dict = [];
  const tokChars = [];

  const clauseRe = /[^{};,\u00A1-\u13FF\uE000-\uE00F]{5,64}[{};,]?/g;
  for (let round = 0; round < 6 && dict.length < 1200; round++) {
    const freq = new Map();
    const matches = work.match(clauseRe);
    if (!matches) break;
    for (let m = 0; m < matches.length; m++) {
      const s = matches[m];
      freq.set(s, (freq.get(s) || 0) + 1);
      const brk = s.indexOf(']');
      if (brk >= 4) {
        const sub = s.slice(0, brk + 1);
        freq.set(sub, (freq.get(sub) || 0) + 1);
      }
      const col = s.indexOf(':');
      if (col >= 4) {
        const sub = s.slice(0, col + 1);
        freq.set(sub, (freq.get(sub) || 0) + 1);
      }
    }
    const res = applyBatchPhraseReplacements(work, freq, freeTokens, dict, tokChars, true, 5, 220, 0);
    work = res.work;
    if (res.added < 6) break;
  }

  for (const winLen of [36, 24, 16, 11, 8, 6, 4, 3, 2]) {
    const maxPasses = winLen <= 4 ? 2 : 1;
    for (let pass = 0; pass < maxPasses && dict.length < MAX_DICT; pass++) {
      const freq = collectWindowFrequencies(work, winLen, true);
      const res = applyBatchPhraseReplacements(work, freq, freeTokens, dict, tokChars, true, 4, 360, winLen);
      work = res.work;
      if (res.added < 6) break;
    }
  }

  for (let p = 0; p < PROTECTED_CSS_LITERALS.length; p++) {
    work = work.split(String.fromCharCode(0xe000 + p)).join(PROTECTED_CSS_LITERALS[p]);
  }
  if (dict.length === 0) return serializeJsValue(preparedCss);

  const maxCodeHex = (TOKEN_BASE + dict.length - 1).toString(16).padStart(4, '0');
  const decRe = new RegExp(`[\\u00A1-\\u${maxCodeHex}]`, 'g');
  let verify = work;
  for (let f = 1, guard = 0; f && guard < 32; guard++) {
    f = 0;
    verify = verify.replace(decRe, (c) => {
      f = 1;
      return dict[c.charCodeAt(0) - TOKEN_BASE];
    });
  }
  if (verify !== preparedCss) return serializeJsValue(preparedCss);

  return `(()=>{let s=${serializeJsValue(work)},d=${serializeStringListExpr(dict)};for(let f=1;f;)f=0,s=s.replace(/[\\u00A1-\\u${maxCodeHex}]/g,(c)=>(f=1,d[c.charCodeAt(0)-${TOKEN_BASE}]));return s})()`;
}

module.exports = {
  flattenNestedCss,
  minifyCss,
  serializeJsValue,
  serializeStringListExpr,
  PROTECTED_CSS_LITERALS,
  CSS_BUCKET_ORDER,
  CSS_BUCKET_MARK_PREFIX,
  splitTopLevelCssRules,
  classifyCssRule,
  splitCssIntoBuckets,
  assembleBucketedCss,
  packLzssJsExpr,
  collectWindowFrequencies,
  applyBatchPhraseReplacements,
  packCssJsExpr,
};
