// JS 压缩后段 Token 级无损精简 Pass（const->let、布尔字面量折叠、尾逗号/冗余分号/前导零/单参箭头合并）
'use strict';

const {
  SAFE_PREV_NO_ASI,
  SAFE_NEXT_NO_ASI,
  JS_KEYWORDS,
  BLOCK_PREV_TOKENS,
  SAFE_BOOL_PREV,
} = require('./js-tokenizer.cjs');

const ARROW_UNPAREN_PREV = new Set(['=', ',', '(', '[', '{', ':', ';', '?', '&&', '||', '??', 'return', '=>', 'async']);
const DEC_ZERO_STRIP_PREV = new Set([
  '=', '(', '[', ',', ':', '?', '+', '-', '*', '/', '%', '<', '>', '<=', '>=', '==', '===', '!=', '!==', '&&', '||', '??',
]);

function compactMangledTokens(tokens, declared) {
  let prevS = null;
  const nextS = new Array(tokens.length).fill(null);
  let nxt = null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    nextS[i] = nxt;
    if (tokens[i].type !== 'ws' && tokens[i].type !== 'nl') nxt = tokens[i];
  }
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.type === 'ws' || tk.type === 'nl') continue;
    if (tk.type === 'id' && tk.val === 'const') {
      if (!prevS || prevS.val !== 'export') {
        tk.val = 'let';
      }
    } else if (tk.type === 'id' && (tk.val === 'true' || tk.val === 'false' || (tk.val === 'undefined' && !declared.has('undefined')))) {
      const ns = nextS[i];
      const afterDot = prevS && (prevS.val === '.' || prevS.val === '?.');
      const beforeKey = ns && (ns.val === ':' || ns.val === '(' || ns.val === '.' || ns.val === '=');
      if (!afterDot && !beforeKey && prevS && SAFE_BOOL_PREV.has(prevS.val)) {
        tk.type = 'punc';
        tk.val = tk.val === 'true' ? '!0' : tk.val === 'false' ? '!1' : 'void 0';
      }
    }
    prevS = tk;
  }

  // Safe token-level compaction:
  // 1) Strip trailing commas before `}` / `]` (preserving array elisions `[a,,]`)
  // 2) Strip redundant semicolons immediately before `}` (preserving empty loop/if bodies `while(c);}`)
  // 3) Merge adjacent block-level `; const/let/var b = ...` into `, b = ...`
  // 4) Unparen single-identifier arrow parameters `(x)=>` -> `x=>` & strip leading zero on decimals `0.5` -> `.5`
  const nextSigTok = new Array(tokens.length).fill(null);
  const nextSigIdx = new Array(tokens.length).fill(-1);
  let nxtT = null;
  let nxtI = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    nextSigTok[i] = nxtT;
    nextSigIdx[i] = nxtI;
    if (tokens[i].type !== 'ws' && tokens[i].type !== 'nl') {
      nxtT = tokens[i];
      nxtI = i;
    }
  }

  const cStack = [];
  const cTernary = [];
  let cColonBlk = false;
  const activeDeclByDepth = new Map();
  let pendCls = '';
  let prevSigTok = null;
  let hadNL = false;
  const dropIdx = new Set();

  for (let i = 0; i < tokens.length; i++) {
    if (dropIdx.has(i)) continue;
    const tk = tokens[i];
    if (tk.type === 'ws') continue;
    if (tk.type === 'nl') {
      hadNL = true;
      continue;
    }

    // Cross-token leading-zero decimal strip: `'0' + '.' + digits` -> `'.' + digits`
    if (
      tk.type === 'lit' &&
      tk.val === '0' &&
      prevSigTok &&
      DEC_ZERO_STRIP_PREV.has(prevSigTok.val) &&
      i + 2 < tokens.length &&
      tokens[i + 1].type === 'punc' &&
      tokens[i + 1].val === '.' &&
      tokens[i + 2].type === 'lit' &&
      /^[0-9]+(?:[eE])?$/.test(tokens[i + 2].val)
    ) {
      dropIdx.add(i);
      continue;
    }

    if (
      tk.type === 'punc' &&
      tk.val === '(' &&
      (!prevSigTok || ARROW_UNPAREN_PREV.has(prevSigTok.val))
    ) {
      const idTok = nextSigTok[i];
      const idIdx = nextSigIdx[i];
      if (idTok && idTok.type === 'id' && !JS_KEYWORDS.has(idTok.val)) {
        const closeTok = nextSigTok[idIdx];
        const closeIdx = nextSigIdx[idIdx];
        if (closeTok && closeTok.val === ')') {
          const arrowTok = nextSigTok[closeIdx];
          if (arrowTok && arrowTok.val === '=>') {
            dropIdx.add(i);
            dropIdx.add(closeIdx);
            continue;
          }
        }
      }
    }

    const curDepth = cStack.length;
    const curTop = curDepth > 0 ? cStack[curDepth - 1] : '{_blk';

    // If an ASI-capable newline occurred at current declaration depth, reset active `let`/`var` merge state
    if (hadNL && prevSigTok && activeDeclByDepth.get(curDepth)) {
      const prevVal = prevSigTok.val;
      const pCh = prevVal[prevVal.length - 1];
      const nCh = tk.val[0];
      const safeNL =
        SAFE_PREV_NO_ASI.has(pCh) ||
        SAFE_NEXT_NO_ASI.has(nCh) ||
        prevVal === '=>' ||
        prevVal === '&&' ||
        prevVal === '||' ||
        prevVal === '??' ||
        ((pCh === '+' || pCh === '-') && prevVal !== '++' && prevVal !== '--');
      if (!safeNL) activeDeclByDepth.set(curDepth, '');
    }
    hadNL = false;

    if (tk.type === 'lit' && tk.val.endsWith('${')) {
      cStack.push('{_tpl');
      cTernary[cStack.length] = 0;
      cColonBlk = false;
      prevSigTok = tk;
      continue;
    }

    if (tk.type === 'id' && tk.val === 'class') pendCls = '{_cls';

    if (tk.type === 'punc') {
      if (tk.val === '?') {
        cTernary[curDepth] = (cTernary[curDepth] || 0) + 1;
        cColonBlk = false;
        prevSigTok = tk;
        continue;
      }
      if (tk.val === ':') {
        if ((cTernary[curDepth] || 0) > 0) {
          cTernary[curDepth]--;
          cColonBlk = false;
        } else {
          cColonBlk = curTop === '{_blk';
        }
        prevSigTok = tk;
        continue;
      }
      const wasColonBlk = cColonBlk;
      cColonBlk = false;

      if (tk.val === '(' || tk.val === '[') {
        cStack.push(tk.val);
        cTernary[cStack.length] = 0;
        prevSigTok = tk;
        continue;
      }
      if (tk.val === '{') {
        if (pendCls) {
          cStack.push(pendCls);
          pendCls = '';
        } else {
          const isBlk = !prevSigTok || BLOCK_PREV_TOKENS.has(prevSigTok.val) || wasColonBlk;
          cStack.push(isBlk ? '{_blk' : '{_obj');
        }
        cTernary[cStack.length] = 0;
        activeDeclByDepth.set(cStack.length, '');
        prevSigTok = tk;
        continue;
      }
      if (tk.val === ')' || tk.val === ']' || tk.val === '}') {
        cTernary[cStack.length] = 0;
        activeDeclByDepth.delete(cStack.length);
        const popped = cStack.pop();
        if (tk.val === '}' && popped === '{_cls') activeDeclByDepth.set(cStack.length, '');
        pendCls = '';
        prevSigTok = tk;
        continue;
      }

      const ns = nextSigTok[i];
      const nsIdx = nextSigIdx[i];

      // Trailing comma before `}` or `]`
      if (
        tk.val === ',' &&
        ns &&
        (ns.val === '}' || (ns.val === ']' && prevSigTok && prevSigTok.val !== ',' && prevSigTok.val !== '['))
      ) {
        dropIdx.add(i);
        continue;
      }

      // Consecutive block-level `; const x`, `; let x`, or `; var x` -> `, x`
      if (tk.val === ';' && (curTop === '{_blk' || curDepth === 0)) {
        const activeKw = activeDeclByDepth.get(curDepth);
        if (activeKw && ns && ns.type === 'id' && ns.val === activeKw) {
          const afterKw = nextSigTok[nsIdx];
          if (
            afterKw &&
            ((afterKw.type === 'id' && !JS_KEYWORDS.has(afterKw.val)) ||
              afterKw.val === '{' ||
              afterKw.val === '[')
          ) {
            tk.val = ',';
            dropIdx.add(nsIdx);
            prevSigTok = tk;
            continue;
          }
        }
        activeDeclByDepth.set(curDepth, '');
      }

      // Redundant `;` immediately before `}` (excluding `while(c);}` where prevSigTok is `)` or `do` or `;` or `{` or `:`)
      if (
        tk.val === ';' &&
        ns &&
        ns.val === '}' &&
        prevSigTok &&
        prevSigTok.val !== ')' &&
        prevSigTok.val !== '{' &&
        prevSigTok.val !== ';' &&
        prevSigTok.val !== ':' &&
        prevSigTok.val !== 'do'
      ) {
        dropIdx.add(i);
        continue;
      }
    }

    if (
      tk.type === 'id' &&
      (tk.val === 'const' || tk.val === 'let' || tk.val === 'var') &&
      (curTop === '{_blk' || curDepth === 0) &&
      (!prevSigTok || prevSigTok.val === '{' || prevSigTok.val === ';' || prevSigTok.val === '}')
    ) {
      const afterKw = nextSigTok[i];
      if (
        afterKw &&
        ((afterKw.type === 'id' && !JS_KEYWORDS.has(afterKw.val)) ||
          afterKw.val === '{' ||
          afterKw.val === '[')
      ) {
        activeDeclByDepth.set(curDepth, tk.val);
      }
    }

    prevSigTok = tk;
  }

  if (dropIdx.size > 0) {
    const compacted = [];
    for (let i = 0; i < tokens.length; i++) {
      if (!dropIdx.has(i)) compacted.push(tokens[i]);
    }
    return compacted;
  }
  return tokens;
}

module.exports = {
  compactMangledTokens,
};
