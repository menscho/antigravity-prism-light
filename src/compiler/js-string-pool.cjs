// 模块级高频字符串/成员属性池化、安全全局别名与单文件压缩入口
'use strict';

const {
  RESERVED_OR_GLOBAL,
  JS_KEYWORDS,
  BLOCK_PREV_TOKENS,
  PROTECTED_BUNDLE_LITERALS,
  tokenizeJs,
  createShortNameGen,
} = require('./js-tokenizer.cjs');
const { mangleSafeLocals } = require('./js-mangler.cjs');
const {
  serializeTokens,
  decodeSimpleJsString,
  hasLoneUtf16Surrogate,
  decodeSimpleTemplateBody,
  packTextJsExpr,
} = require('./js-serializer.cjs');

// Collect poolable string literals & high-frequency member property accesses from a mangled token stream
function scanModulePoolCandidates(tokens, allowMemberProps = false) {
  const prevSig = new Array(tokens.length).fill(null);
  const prev2Sig = new Array(tokens.length).fill(null);
  const nextSig = new Array(tokens.length).fill(null);
  let last = null;
  let last2 = null;
  for (let i = 0; i < tokens.length; i++) {
    prevSig[i] = last;
    prev2Sig[i] = last2;
    if (tokens[i].type !== 'ws' && tokens[i].type !== 'nl') {
      last2 = last;
      last = tokens[i];
    }
  }
  last = null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    nextSig[i] = last;
    if (tokens[i].type !== 'ws' && tokens[i].type !== 'nl') last = tokens[i];
  }

  const SEP = '\x7f';
  const occurrences = new Map();

  const addOcc = (strVal, kind, startIdx, endIdx, origBytes) => {
    if (!occurrences.has(strVal)) occurrences.set(strVal, []);
    occurrences.get(strVal).push({ kind, startIdx, endIdx, origBytes });
  };

  const closeIdxByOpen = new Int32Array(tokens.length).fill(-1);
  if (allowMemberProps) {
    const pairStack = [];
    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      if (tk.type === 'lit' && tk.val.endsWith('${')) {
        pairStack.push(i);
      } else if (tk.type === 'punc') {
        if (tk.val === '(' || tk.val === '[' || tk.val === '{') {
          pairStack.push(i);
        } else if ((tk.val === ')' || tk.val === ']' || tk.val === '}') && pairStack.length > 0) {
          closeIdxByOpen[pairStack.pop()] = i;
        }
      }
    }
  }

  const ctxStack = [];
  const ctxTernary = [];
  let pendingClsBrace = false;
  let prevColonBlock = false;
  const inDestructOrParams = () => {
    for (let k = ctxStack.length - 1; k >= 0; k--) {
      if (ctxStack[k] === '{_blk' || ctxStack[k] === '{_cls') return false;
      if (ctxStack[k] === '{_pat' || ctxStack[k] === '(_params' || ctxStack[k] === '[_pat') return true;
    }
    return false;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'ws' || t.type === 'nl') continue;

    if (allowMemberProps) {
      if (t.type === 'lit' && t.val.endsWith('${')) {
        ctxStack.push('{_tpl');
        ctxTernary[ctxStack.length] = 0;
        prevColonBlock = false;
        continue;
      }
      if (t.type === 'punc') {
        const d = ctxStack.length;
        if (t.val === '?') {
          ctxTernary[d] = (ctxTernary[d] || 0) + 1;
          prevColonBlock = false;
          continue;
        }
        if (t.val === ':') {
          if ((ctxTernary[d] || 0) > 0) {
            ctxTernary[d]--;
            prevColonBlock = false;
          } else {
            prevColonBlock = d === 0 || ctxStack[d - 1] === '{_blk';
          }
          continue;
        }
        const wasColonBlk = prevColonBlock;
        prevColonBlock = false;
        if (t.val === '(') {
          const p = prevSig[i];
          const cIdx = closeIdxByOpen[i];
          const afterClose = cIdx >= 0 ? nextSig[cIdx] : null;
          const isParams =
            (p && (p.val === 'function' || p.val === '*' || p.val === 'catch')) ||
            Boolean(afterClose && afterClose.val === '=>');
          ctxStack.push(isParams ? '(_params' : '(');
          ctxTernary[ctxStack.length] = 0;
          continue;
        }
        if (t.val === '[') {
          const cIdx = closeIdxByOpen[i];
          const afterClose = cIdx >= 0 ? nextSig[cIdx] : null;
          const isPat =
            inDestructOrParams() ||
            Boolean(afterClose && (afterClose.val === '=' || afterClose.val === 'of' || afterClose.val === 'in'));
          ctxStack.push(isPat ? '[_pat' : '[');
          ctxTernary[ctxStack.length] = 0;
          continue;
        }
        if (t.val === '{') {
          const p = prevSig[i];
          if (pendingClsBrace) {
            ctxStack.push('{_cls');
            pendingClsBrace = false;
          } else {
            const isBlk = !p || BLOCK_PREV_TOKENS.has(p.val) || wasColonBlk;
            if (isBlk) {
              ctxStack.push('{_blk');
            } else {
              const cIdx = closeIdxByOpen[i];
              const afterClose = cIdx >= 0 ? nextSig[cIdx] : null;
              const isPat =
                inDestructOrParams() ||
                Boolean(p && (p.val === 'const' || p.val === 'let' || p.val === 'var')) ||
                Boolean(afterClose && (afterClose.val === '=' || afterClose.val === 'of' || afterClose.val === 'in'));
              ctxStack.push(isPat ? '{_pat' : '{_obj');
            }
          }
          ctxTernary[ctxStack.length] = 0;
          continue;
        }
        if (t.val === ')' || t.val === ']' || t.val === '}') {
          ctxTernary[ctxStack.length] = 0;
          ctxStack.pop();
          if (t.val === '}') pendingClsBrace = false;
          continue;
        }
        if (t.val === ';') {
          ctxTernary[d] = 0;
          pendingClsBrace = false;
        }
        continue;
      }
      prevColonBlock = false;
      if (t.type === 'id' && t.val === 'class') {
        const p = prevSig[i];
        if (!p || (p.val !== '.' && p.val !== '?.')) pendingClsBrace = true;
      }
    }

    const curCtxTop = ctxStack.length > 0 ? ctxStack[ctxStack.length - 1] : '';

    if (allowMemberProps && t.type === 'id' && t.val.length >= 3 && !t.val.startsWith('__ag')) {
      const p = prevSig[i];
      const p2 = prev2Sig[i];
      const nx = nextSig[i];
      const afterNumericDot = p2 && p2.type === 'lit' && /^[0-9]/.test(p2.val);
      if (
        !afterNumericDot &&
        p &&
        (p.val === '.' || (p.val === '?.' && t.val.length >= 4)) &&
        (!p2 || (p2.val !== 'super' && p2.val !== 'new' && p2.val !== 'import')) &&
        /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t.val) &&
        !PROTECTED_BUNDLE_LITERALS.some((sub) => t.val.includes(sub))
      ) {
        let dotIdx = i - 1;
        while (dotIdx >= 0 && (tokens[dotIdx].type === 'ws' || tokens[dotIdx].type === 'nl')) dotIdx--;
        if (dotIdx >= 0 && tokens[dotIdx] === p) {
          if (p.val === '.') {
            addOcc(t.val, 'dotProp', dotIdx, i, 1 + t.val.length);
          } else {
            addOcc(t.val, 'optProp', i, i, t.val.length);
          }
        }
      } else if (
        curCtxTop === '{_obj' &&
        t.val.length >= 4 &&
        t.val !== '__proto__' &&
        p &&
        (p.val === '{' || p.val === ',') &&
        nx &&
        nx.val === ':' &&
        /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t.val) &&
        !PROTECTED_BUNDLE_LITERALS.some((sub) => t.val.includes(sub))
      ) {
        addOcc(t.val, 'optProp', i, i, t.val.length);
      }
      continue;
    }

    if (t.type !== 'lit') continue;
    let strVal = null;
    let endIdx = i;
    if (t.val[0] === "'" || t.val[0] === '"') {
      strVal = decodeSimpleJsString(t.val);
    } else if (t.val === '`' && i + 1 < tokens.length && tokens[i + 1].type === 'lit' && tokens[i + 1].val.endsWith('`')) {
      const p = prevSig[i];
      const canBeTagged =
        p &&
        (p.type === 'id' ||
          p.val === ')' ||
          p.val === ']' ||
          p.val === '}' ||
          p.val.endsWith("'") ||
          p.val.endsWith('"') ||
          p.val.endsWith('`'));
      if (!canBeTagged || (p && JS_KEYWORDS.has(p.val) && p.val !== 'this' && p.val !== 'super')) {
        const body = tokens[i + 1].val.slice(0, -1);
        if (!body.includes('${')) {
          strVal = decodeSimpleTemplateBody(body);
          if (strVal !== null) endIdx = i + 1;
        }
      }
    }
    if (strVal === null || strVal === 'use strict' || strVal.includes(SEP)) continue;
    const valBytes = Buffer.byteLength(strVal, 'utf8');
    if (valBytes < 3) continue;
    if (hasLoneUtf16Surrogate(strVal)) continue;
    if (PROTECTED_BUNDLE_LITERALS.some((sub) => strVal.includes(sub))) continue;

    const p = prevSig[i];
    const nx = nextSig[endIdx];
    if (nx && nx.val === ':') {
      if (
        allowMemberProps &&
        endIdx === i &&
        curCtxTop === '{_obj' &&
        valBytes >= 5 &&
        strVal !== '__proto__' &&
        p &&
        (p.val === '{' || p.val === ',')
      ) {
        addOcc(strVal, 'optProp', i, i, Buffer.byteLength(t.val, 'utf8'));
      }
      if (!p || p.val !== 'case') continue;
    }
    if (nx && nx.val === '(') continue;
    if (nx && (nx.val === '=' || nx.val === ';') && p && (p.val === '{' || p.val === ';' || p.val === '}' || p.val === 'static')) {
      continue;
    }
    if (p && (p.val === 'import' || p.val === 'from' || p.val === 'get' || p.val === 'set' || p.val === 'async')) continue;

    let origBytes = Buffer.byteLength(t.val, 'utf8');
    if (endIdx > i) origBytes += Buffer.byteLength(tokens[endIdx].val, 'utf8');
    addOcc(strVal, 'str', i, endIdx, origBytes);
    i = endIdx;
  }

  return occurrences;
}

const SAFE_ALIAS_GLOBALS = new Set([
  'Math', 'Number', 'Boolean', 'String', 'Array', 'Object', 'JSON', 'Promise',
  'Map', 'Set', 'WeakMap', 'RegExp', 'Error', 'Date',
  'Uint8Array', 'Uint16Array', 'Int32Array', 'Float32Array',
  'globalThis', 'parseFloat', 'parseInt', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance',
]);

function applyModulePoolReplacements(tokens, selectedEntries, headerBuilder) {
  if (selectedEntries.length === 0) return serializeTokens(tokens);

  const usedIds = new Set();
  let lastSigVal = '';
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.type === 'ws' || tk.type === 'nl') continue;
    if (tk.type === 'id' && lastSigVal !== '.' && lastSigVal !== '?.') usedIds.add(tk.val);
    lastSigVal = tk.val;
  }
  const nextVar = createShortNameGen(usedIds, RESERVED_OR_GLOBAL);
  const activeItems = [];
  let stagedVar = nextVar();

  for (const entry of selectedEntries) {
    const varName = stagedVar;
    let origSum = 0;
    let replSum = 0;
    for (const occ of entry.list) {
      origSum += occ.origBytes;
      replSum += occ.kind === 'str' ? varName.length : varName.length + 2;
    }
    const idxBytes =
      entry.poolIdx !== undefined
        ? entry.poolIdx < 88
          ? 1
          : entry.poolIdx < 1975
          ? 2
          : entry.poolIdx < 7863
          ? 3
          : 4
        : 2;
    const bindingOverhead = varName.length + 1 + idxBytes;
    if (origSum > replSum + bindingOverhead) {
      activeItems.push({ ...entry, varName });
      stagedVar = nextVar();
    }
  }

  if (activeItems.length === 0) return serializeTokens(tokens);

  const prevSig = new Array(tokens.length).fill(null);
  const nextSig = new Array(tokens.length).fill(null);
  let last = null;
  for (let i = 0; i < tokens.length; i++) {
    prevSig[i] = last;
    if (tokens[i].type !== 'ws' && tokens[i].type !== 'nl') last = tokens[i];
  }
  last = null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    nextSig[i] = last;
    if (tokens[i].type !== 'ws' && tokens[i].type !== 'nl') last = tokens[i];
  }

  const globalPositions = new Map();
  const poisonedGlobals = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.type !== 'id' || !SAFE_ALIAS_GLOBALS.has(tk.val)) continue;
    const p = prevSig[i];
    const nx = nextSig[i];
    if (p && (p.val === '.' || p.val === '?.' || p.val === 'function' || p.val === 'class')) continue;
    if (nx && nx.val === ':') continue;
    if (p && p.val === 'typeof') continue;
    if (
      nx &&
      (nx.val === '.' || nx.val === '?.' || nx.val === '(') &&
      !(p && (p.val === 'let' || p.val === 'const' || p.val === 'var' || p.val === 'static' || p.val === 'get' || p.val === 'set' || p.val === 'async' || p.val === '*'))
    ) {
      if (!globalPositions.has(tk.val)) globalPositions.set(tk.val, []);
      globalPositions.get(tk.val).push(i);
      continue;
    }
    if (
      (p &&
        (p.val === 'let' ||
          p.val === 'const' ||
          p.val === 'var' ||
          p.val === '++' ||
          p.val === '--' ||
          p.val === '...' ||
          p.val === '[' ||
          p.val === '(')) ||
      (nx && (nx.val === '=' || nx.val === '=>' || nx.val === '++' || nx.val === '--' || nx.val === ',' || nx.val === '}'))
    ) {
      if (p && (p.val === '{' || p.val === ',' || p.val === '[' || p.val === '(')) {
        if (p.val === '(' && nx && nx.val === ')' && i >= 2) {
          let prevBeforeParen = null;
          for (let k = i - 1; k >= 0; k--) {
            if (tokens[k].type === 'ws' || tokens[k].type === 'nl') continue;
            if (tokens[k] === p) {
              for (let m = k - 1; m >= 0; m--) {
                if (tokens[m].type !== 'ws' && tokens[m].type !== 'nl') {
                  prevBeforeParen = tokens[m];
                  break;
                }
              }
              break;
            }
          }
          const isParamList =
            (prevBeforeParen && (prevBeforeParen.val === 'function' || prevBeforeParen.val === 'catch' || prevBeforeParen.val === 'async')) ||
            Boolean(nextSig[i + 1] && nextSig[i + 1].val === '=>');
          if (!isParamList) {
            if (!globalPositions.has(tk.val)) globalPositions.set(tk.val, []);
            globalPositions.get(tk.val).push(i);
            continue;
          }
        }
        poisonedGlobals.add(tk.val);
        continue;
      }
      if (!nx || (nx.val !== ',' && nx.val !== '}')) {
        poisonedGlobals.add(tk.val);
        continue;
      }
    }
    if (!globalPositions.has(tk.val)) globalPositions.set(tk.val, []);
    globalPositions.get(tk.val).push(i);
  }

  const globalAliasDecls = [];
  const globalReplaceAt = new Map();
  for (const [gName, idxs] of globalPositions.entries()) {
    if (poisonedGlobals.has(gName) || idxs.length < 2) continue;
    const alias = nextVar();
    const save = idxs.length * (gName.length - alias.length) - (alias.length + 1 + gName.length + 1);
    if (save >= 4) {
      globalAliasDecls.push(`${alias}=${gName}`);
      for (const pos of idxs) globalReplaceAt.set(pos, alias);
    }
  }

  const replaceAt = new Map();
  for (const item of activeItems) {
    for (const occ of item.list) {
      replaceAt.set(occ.startIdx, { endIdx: occ.endIdx, kind: occ.kind, ref: item.varName });
    }
  }

  const newTokens = [];
  for (let i = 0; i < tokens.length; i++) {
    const rep = replaceAt.get(i);
    if (rep) {
      if (rep.kind === 'str') {
        newTokens.push({ type: 'id', val: rep.ref });
      } else {
        newTokens.push({ type: 'punc', val: '[' });
        newTokens.push({ type: 'id', val: rep.ref });
        newTokens.push({ type: 'punc', val: ']' });
      }
      i = rep.endIdx;
    } else if (globalReplaceAt.has(i)) {
      newTokens.push({ type: 'id', val: globalReplaceAt.get(i) });
    } else {
      newTokens.push(tokens[i]);
    }
  }

  const aliasPrefix = globalAliasDecls.length > 0 ? `let ${globalAliasDecls.join(',')};` : '';
  const bodyCode = aliasPrefix + serializeTokens(newTokens);
  return headerBuilder(activeItems, bodyCode);
}

function internAndPackModuleStrings(tokens, opts = null) {
  const allowMemberProps =
    opts && typeof opts === 'object' && Object.prototype.hasOwnProperty.call(opts, 'allowMemberProps')
      ? Boolean(opts.allowMemberProps)
      : true;
  const SEP = '\x7f';
  const occurrences = scanModulePoolCandidates(tokens, allowMemberProps);
  const selected = [];
  for (const [strVal, list] of occurrences.entries()) {
    const valBytes = Buffer.byteLength(strVal, 'utf8');
    const count = list.length;
    const totalOrig = list.reduce((s, x) => s + x.origBytes, 0);
    const hasStrLit = list.some((x) => x.kind === 'str');
    if ((count >= 2 && totalOrig > valBytes + 8 + count * 4) || (hasStrLit && valBytes >= 14)) {
      selected.push({ strVal, list, totalOrig });
    }
  }
  if (selected.length < 1) return null;
  selected.sort((a, b) => b.list.length - a.list.length || b.totalOrig - a.totalOrig);

  return applyModulePoolReplacements(tokens, selected, (activeItems, bodyCode) => {
    const varNames = activeItems.map((x) => x.varName);
    const joined = activeItems.map((x) => x.strVal).join(SEP);
    const packedExpr = packTextJsExpr(joined, 760);
    return `{const[${varNames.join(',')}]=${packedExpr}.split(${JSON.stringify(SEP)});${bodyCode}}`;
  });
}

function minifyJs(src) {
  return serializeTokens(mangleSafeLocals(tokenizeJs(src)));
}

function minifySingleSource(src, opts = null) {
  const tokens = mangleSafeLocals(tokenizeJs(src));
  const plainMin = serializeTokens(tokens);
  const packedMin = internAndPackModuleStrings(tokens, opts);
  if (packedMin && Buffer.byteLength(packedMin, 'utf8') + 40 < Buffer.byteLength(plainMin, 'utf8')) {
    return packedMin;
  }
  return plainMin;
}

module.exports = {
  scanModulePoolCandidates,
  SAFE_ALIAS_GLOBALS,
  applyModulePoolReplacements,
  internAndPackModuleStrings,
  minifyJs,
  minifySingleSource,
};
