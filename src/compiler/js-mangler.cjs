// 作用域安全局部标识符混淆器（防自由变量/全局符号/属性键误改写）
'use strict';

const {
  RESERVED_OR_GLOBAL,
  JS_KEYWORDS,
  BLOCK_PREV_TOKENS,
  createShortNameGen,
} = require('./js-tokenizer.cjs');
const { compactMangledTokens } = require('./js-mangler-passes.cjs');

function mangleSafeLocals(tokens) {
  const sig = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'ws' && tokens[i].type !== 'nl') sig.push(tokens[i]);
  }
  const declared = new Set();
  const unsafe = new Set(RESERVED_OR_GLOBAL);
  const nonVarTokens = new Set();
  const shorthandTokens = new Set();
  const shorthandCounts = new Map();
  const counts = new Map();
  const minRefScope = new Map();
  const minDeclScope = new Map();
  const bStack = [];
  const ternaryAtDepth = [];
  const declState = new Map();
  const rhsDefaultDepths = new Set();
  const exportedDeclDepths = new Set();
  let exportDeclDepth = -1;
  let exportNextId = false;
  let blockDepth = 0;
  let pendingBraceKind = '';

  const hasOuterDeclContext = () => {
    for (let d = bStack.length; d >= 0; d--) {
      if (rhsDefaultDepths.has(d)) return false;
      if (declState.has(d)) return declState.get(d) === 'lhs';
      if (d > 0) {
        const br = bStack[d - 1];
        if (br !== '{_obj' && br !== '[') return false;
      }
    }
    return false;
  };

  const isOuterExportedDecl = () => {
    for (let d = bStack.length; d >= 0; d--) {
      if (exportedDeclDepths.has(d)) return true;
      if (declState.has(d)) return false;
      if (d > 0) {
        const br = bStack[d - 1];
        if (br !== '{_obj' && br !== '[') return false;
      }
    }
    return false;
  };

  const recordDecl = (name, depth) => {
    if (isOuterExportedDecl()) {
      unsafe.add(name);
      return;
    }
    if (name.length < 2) return;
    declared.add(name);
    const prev = minDeclScope.get(name);
    if (prev === undefined || depth < prev) minDeclScope.set(name, depth);
  };

  const recordRef = (name, depth) => {
    const prev = minRefScope.get(name);
    if (prev === undefined || depth < prev) minRefScope.set(name, depth);
  };

  let lastColonWasCaseOrLabel = false;
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i];
    const prev = i > 0 ? sig[i - 1] : null;
    const prev2 = i > 1 ? sig[i - 2] : null;
    const next = i + 1 < sig.length ? sig[i + 1] : null;

    if (t.type === 'lit' && t.val.endsWith('${')) {
      bStack.push('{_tpl');
      ternaryAtDepth[bStack.length] = 0;
      lastColonWasCaseOrLabel = false;
      continue;
    }

    if (t.type === 'punc') {
      const sd = bStack.length;
      if (t.val === '?') {
        ternaryAtDepth[sd] = (ternaryAtDepth[sd] || 0) + 1;
        lastColonWasCaseOrLabel = false;
        continue;
      }
      if (t.val === ':') {
        if ((ternaryAtDepth[sd] || 0) > 0) {
          ternaryAtDepth[sd]--;
          lastColonWasCaseOrLabel = false;
        } else {
          lastColonWasCaseOrLabel = sd === 0 || bStack[sd - 1] === '{_blk';
        }
        continue;
      }
      const prevColonBlock = lastColonWasCaseOrLabel;
      lastColonWasCaseOrLabel = false;

      if (t.val === '(') {
        bStack.push('(');
        ternaryAtDepth[bStack.length] = 0;
      } else if (t.val === '[') {
        bStack.push('[');
        ternaryAtDepth[bStack.length] = 0;
      } else if (t.val === '{') {
        if (pendingBraceKind) {
          bStack.push(pendingBraceKind);
          if (pendingBraceKind === '{_cls') blockDepth++;
          pendingBraceKind = '';
        } else {
          const isBlock = !prev || BLOCK_PREV_TOKENS.has(prev.val) || prevColonBlock;
          bStack.push(isBlock ? '{_blk' : '{_obj');
          if (isBlock) blockDepth++;
        }
        ternaryAtDepth[bStack.length] = 0;
      } else if (t.val === ')' || t.val === ']' || t.val === '}') {
        declState.delete(bStack.length);
        rhsDefaultDepths.delete(bStack.length);
        exportedDeclDepths.delete(bStack.length);
        if (exportDeclDepth === bStack.length) exportDeclDepth = -1;
        ternaryAtDepth[bStack.length] = 0;
        const popped = bStack.pop();
        if ((popped === '{_blk' || popped === '{_cls') && blockDepth > 0) blockDepth--;
        if (t.val === '}') pendingBraceKind = '';
      } else if (t.val === ';') {
        declState.delete(bStack.length);
        rhsDefaultDepths.delete(bStack.length);
        exportedDeclDepths.delete(bStack.length);
        if (exportDeclDepth === bStack.length) exportDeclDepth = -1;
        exportNextId = false;
        ternaryAtDepth[sd] = 0;
        pendingBraceKind = '';
      } else if (t.val === '=') {
        if (declState.get(bStack.length) === 'lhs') {
          declState.set(bStack.length, 'rhs');
        } else if (bStack.length > 0 && (bStack[bStack.length - 1] === '{_obj' || bStack[bStack.length - 1] === '[')) {
          rhsDefaultDepths.add(bStack.length);
        } else if (!declState.has(bStack.length)) {
          pendingBraceKind = '';
        }
      } else if (t.val === ',') {
        rhsDefaultDepths.delete(bStack.length);
        if (declState.has(bStack.length)) declState.set(bStack.length, 'lhs');
      }
      continue;
    }
    lastColonWasCaseOrLabel = false;

    if (t.type !== 'id') continue;
    const name = t.val;
    if (name === 'class') {
      if (exportDeclDepth === bStack.length) {
        exportNextId = true;
        exportDeclDepth = -1;
      }
      pendingBraceKind = '{_cls';
      declState.delete(bStack.length);
      exportedDeclDepths.delete(bStack.length);
      continue;
    }
    if (name === 'import' || name === 'export') {
      if (next && next.val === '{') pendingBraceKind = '{_esm';
      declState.delete(bStack.length);
      exportedDeclDepths.delete(bStack.length);
      exportDeclDepth = name === 'export' ? bStack.length : -1;
      exportNextId = false;
      continue;
    }
    if (name === 'const' || name === 'let' || name === 'var') {
      declState.set(bStack.length, 'lhs');
      if (exportDeclDepth === bStack.length) {
        exportedDeclDepths.add(bStack.length);
        exportDeclDepth = -1;
      }
      pendingBraceKind = '';
      continue;
    }
    if (JS_KEYWORDS.has(name)) {
      if ((name === 'in' || name === 'of') && declState.get(bStack.length) === 'lhs') {
        declState.set(bStack.length, 'rhs');
      }
      if (exportDeclDepth === bStack.length) {
        if (name === 'function') {
          exportNextId = true;
          exportDeclDepth = -1;
        } else if (name !== 'async' && name !== 'default') {
          exportDeclDepth = -1;
        }
      }
      const exprSafe =
        name === 'in' || name === 'of' || name === 'typeof' || name === 'void' || name === 'new' ||
        name === 'await' || name === 'extends' || name === 'null' || name === 'true' || name === 'false' ||
        name === 'this' || name === 'super' || name === 'delete' || name === 'instanceof' || name === 'async' ||
        (name === 'function' && prev && (prev.val === '=' || prev.val === ',' || prev.val === ':' || prev.val === '(' || prev.val === '[' || prev.val === '?' || prev.val === '&&' || prev.val === '||' || prev.val === '??' || prev.val === 'async'));
      if (!exprSafe) {
        declState.delete(bStack.length);
        exportedDeclDepths.delete(bStack.length);
        pendingBraceKind = '';
      }
      continue;
    }
    if (exportNextId) {
      exportNextId = false;
      unsafe.add(name);
      counts.set(name, (counts.get(name) || 0) + 1);
      continue;
    }
    if (exportDeclDepth === bStack.length) exportDeclDepth = -1;
    if (name.startsWith('__ag') || name === 'AntigravityCodexEffortSlider') {
      unsafe.add(name);
      continue;
    }

    const topBracket = bStack.length > 0 ? bStack[bStack.length - 1] : '{_blk';

    // Member property access (`obj.prop`, `obj?.prop`) is never an IdentifierReference
    if (prev && (prev.val === '.' || prev.val === '?.')) {
      nonVarTokens.add(t);
      continue;
    }
    if (topBracket === '{_cls' || topBracket === '{_esm') {
      unsafe.add(name);
      counts.set(name, (counts.get(name) || 0) + 1);
      continue;
    }
    // Non-shorthand object literal / destructuring property key (`{ prop: val }`) is never an IdentifierReference
    if (topBracket === '{_obj' && prev && (prev.val === '{' || prev.val === ',') && next && next.val === ':') {
      nonVarTokens.add(t);
      continue;
    }
    if (prev && prev.val === '...') {
      counts.set(name, (counts.get(name) || 0) + 1);
      if (hasOuterDeclContext() && next && (next.val === '}' || next.val === ']')) {
        recordDecl(name, blockDepth);
      } else {
        recordRef(name, blockDepth);
      }
      continue;
    }
    if (next && next.val === ':' && topBracket === '{_blk' && (!prev || prev.val === '{' || prev.val === ';' || prev.val === '}' || prev.val === ')')) {
      unsafe.add(name);
      counts.set(name, (counts.get(name) || 0) + 1);
      continue;
    }
    // Object shorthand property `{ foo }` or destructuring binding `{ foo, bar = 1 }`
    if (
      topBracket === '{_obj' &&
      prev &&
      (prev.val === '{' || prev.val === ',') &&
      next &&
      (next.val === ',' || next.val === '}' || next.val === '=')
    ) {
      shorthandTokens.add(t);
      shorthandCounts.set(name, (shorthandCounts.get(name) || 0) + 1);
      counts.set(name, (counts.get(name) || 0) + 1);
      if (hasOuterDeclContext()) {
        recordDecl(name, blockDepth);
      } else {
        recordRef(name, blockDepth);
      }
      continue;
    }
    if (
      topBracket === '{_obj' &&
      prev &&
      (prev.val === '{' || prev.val === ',' || prev.val === ';') &&
      next &&
      (next.val === ',' || next.val === '}' || next.val === '=' || next.val === ';')
    ) {
      unsafe.add(name);
      counts.set(name, (counts.get(name) || 0) + 1);
      continue;
    }
    if (
      topBracket === '{_obj' &&
      next &&
      next.val === '(' &&
      (!prev || prev.val !== 'function') &&
      prev &&
      (prev.val === '}' || prev.val === '{' || prev.val === ';' || prev.val === ',')
    ) {
      nonVarTokens.add(t);
      continue;
    }
    if (next && next.val === '(' && prev && (prev.val === 'get' || prev.val === 'set' || prev.val === 'async' || prev.val === 'static')) {
      if (!prev2 || prev2.val !== 'function') {
        unsafe.add(name);
        counts.set(name, (counts.get(name) || 0) + 1);
        continue;
      }
    }

    counts.set(name, (counts.get(name) || 0) + 1);
    recordRef(name, blockDepth);

    if (
      declState.get(bStack.length) === 'lhs' &&
      prev &&
      (prev.val === 'const' || prev.val === 'let' || prev.val === 'var' || prev.val === ',') &&
      next &&
      (next.val === '=' || next.val === ';' || next.val === ',' || next.val === 'of' || next.val === 'in' || next.val === ')')
    ) {
      recordDecl(name, blockDepth);
    }
    if (prev && prev.val === 'function' && next && next.val === '(') {
      recordDecl(name, blockDepth);
    }
    if (next && next.val === '=>' && (!prev || (prev.val !== '.' && prev.val !== '?.'))) {
      recordDecl(name, blockDepth + 1);
    }
    if (prev && prev.val === '(' && prev2 && prev2.val === 'catch' && next && next.val === ')') {
      recordDecl(name, blockDepth + 1);
    }
  }

  // Second pass: function / arrow parameter lists + catch bindings + expression-body arrows
  const paramDeclTokens = new Set();
  const paramOpenIndices = new Set();
  const paramCloseIndices = new Set();
  const exprArrowIndices = new Set();

  let scanBlockDepth = 0;
  const scanStack = [];
  const scanTernary = [];
  let scanColonBlk = false;
  let scanPendKind = '';
  for (let i = 0; i < sig.length; i++) {
    const tk0 = sig[i];
    const p0 = i > 0 ? sig[i - 1] : null;
    if (tk0.type === 'lit' && tk0.val.endsWith('${')) {
      scanStack.push('{_tpl');
      scanTernary[scanStack.length] = 0;
      scanColonBlk = false;
      continue;
    }
    if (tk0.type === 'id' && tk0.val === 'class') {
      scanPendKind = '{_cls';
      scanColonBlk = false;
    } else if (tk0.type === 'punc') {
      const sd = scanStack.length;
      if (tk0.val === '?') {
        scanTernary[sd] = (scanTernary[sd] || 0) + 1;
        scanColonBlk = false;
      } else if (tk0.val === ':') {
        if ((scanTernary[sd] || 0) > 0) {
          scanTernary[sd]--;
          scanColonBlk = false;
        } else {
          scanColonBlk = sd === 0 || scanStack[sd - 1] === '{_blk';
        }
      } else if (tk0.val === '(' || tk0.val === '[') {
        scanStack.push(tk0.val);
        scanTernary[scanStack.length] = 0;
        scanColonBlk = false;
      } else if (tk0.val === '{') {
        if (scanPendKind) {
          scanStack.push(scanPendKind);
          if (scanPendKind === '{_cls') scanBlockDepth++;
          scanPendKind = '';
        } else {
          const isBlk = !p0 || BLOCK_PREV_TOKENS.has(p0.val) || scanColonBlk;
          scanStack.push(isBlk ? '{_blk' : '{_obj');
          if (isBlk) scanBlockDepth++;
        }
        scanTernary[scanStack.length] = 0;
        scanColonBlk = false;
      } else if (tk0.val === ')' || tk0.val === ']' || tk0.val === '}') {
        scanTernary[scanStack.length] = 0;
        const pop = scanStack.pop();
        if ((pop === '{_blk' || pop === '{_cls') && scanBlockDepth > 0) scanBlockDepth--;
        if (tk0.val === '}') scanPendKind = '';
        scanColonBlk = false;
      } else if (tk0.val === ';') {
        scanTernary[sd] = 0;
        scanPendKind = '';
        scanColonBlk = false;
      } else {
        scanColonBlk = false;
      }
    } else {
      scanColonBlk = false;
    }

    if (tk0.type === 'id' && i + 1 < sig.length && sig[i + 1].val === '=>' && (!p0 || (p0.val !== '.' && p0.val !== '?.'))) {
      paramDeclTokens.add(tk0);
      if (i + 2 < sig.length && sig[i + 2].val !== '{') {
        exprArrowIndices.add(i + 1);
      }
    }
    if (tk0.val === '(' && p0 && p0.val === 'catch' && i + 2 < sig.length && sig[i + 1].type === 'id' && sig[i + 2].val === ')') {
      paramDeclTokens.add(sig[i + 1]);
      continue;
    }

    if (tk0.val !== '(') continue;
    const prev = p0;
    const prev2 = i > 1 ? sig[i - 2] : null;
    const isFnParams =
      (prev && prev.val === 'function') ||
      (prev && prev.type === 'id' && prev2 && prev2.val === 'function');
    let depth = 1;
    let braceDepth = 0;
    let bracketDepth = 0;
    let j = i + 1;
    const paramCandidates = [];
    const destructuredShorthands = [];
    while (j < sig.length && depth > 0) {
      const tk = sig[j];
      if (tk.type === 'lit' && tk.val.endsWith('${')) braceDepth++;
      else if (tk.val === '(') depth++;
      else if (tk.val === ')') depth--;
      else if (tk.val === '{') braceDepth++;
      else if (tk.val === '}' && braceDepth > 0) braceDepth--;
      else if (tk.val === '[') bracketDepth++;
      else if (tk.val === ']' && bracketDepth > 0) bracketDepth--;
      else if (depth === 1 && braceDepth === 0 && bracketDepth === 0 && tk.type === 'id') {
        const pPrev = sig[j - 1];
        const pNext = sig[j + 1];
        if (
          pPrev &&
          (pPrev.val === '(' || pPrev.val === ',' || pPrev.val === '...') &&
          pNext &&
          (pNext.val === ',' || pNext.val === ')' || pNext.val === '=')
        ) {
          if (tk.val.length >= 2) paramCandidates.push(tk);
        }
      } else if (depth === 1 && braceDepth === 0 && bracketDepth > 0 && tk.type === 'id') {
        const pPrev = sig[j - 1];
        const pNext = sig[j + 1];
        if (
          pPrev &&
          (pPrev.val === '[' || pPrev.val === ',' || pPrev.val === '...') &&
          pNext &&
          (pNext.val === ',' || pNext.val === ']' || pNext.val === '=')
        ) {
          if (tk.val.length >= 2) paramCandidates.push(tk);
        }
      } else if (depth === 1 && braceDepth > 0 && tk.type === 'id') {
        if (shorthandTokens.has(tk)) {
          if (tk.val.length >= 2) destructuredShorthands.push(tk);
        } else if (sig[j - 1] && sig[j - 1].val === '...' && sig[j + 1] && sig[j + 1].val === '}') {
          if (tk.val.length >= 2) paramCandidates.push(tk);
        }
      }
      j++;
    }
    const closeIdx = j - 1;
    const afterClose = j < sig.length ? sig[j] : null;
    if (isFnParams || (afterClose && afterClose.val === '=>')) {
      const bodyScopeDepth = scanBlockDepth + 1;
      paramOpenIndices.add(i);
      if (closeIdx > i) paramCloseIndices.add(closeIdx);
      if (afterClose && afterClose.val === '=>' && j + 1 < sig.length && sig[j + 1].val !== '{') {
        exprArrowIndices.add(j);
      }
      for (const pTk of paramCandidates) {
        paramDeclTokens.add(pTk);
        recordDecl(pTk.val, bodyScopeDepth);
      }
      for (const st of destructuredShorthands) {
        paramDeclTokens.add(st);
        recordDecl(st.val, bodyScopeDepth);
      }
    }
  }

  // Compute exact minRefScope treating parameter lists & expression-body arrows at their true inner body depth (+1)
  minRefScope.clear();
  {
    let rDepth = 0;
    let paramActive = 0;
    const rStack = [];
    const rTernary = [];
    let rColonBlk = false;
    const arrowExprStackLens = [];
    let pendKind = '';
    for (let i = 0; i < sig.length; i++) {
      const t = sig[i];
      const prev = i > 0 ? sig[i - 1] : null;
      if (t.type === 'lit' && t.val.endsWith('${')) {
        rStack.push('{_tpl');
        rTernary[rStack.length] = 0;
        rColonBlk = false;
        continue;
      }

      if (t.type === 'punc') {
        const sd = rStack.length;
        if (t.val === '?') {
          rTernary[sd] = (rTernary[sd] || 0) + 1;
          rColonBlk = false;
          continue;
        }
        if (t.val === ':') {
          if ((rTernary[sd] || 0) > 0) {
            rTernary[sd]--;
            rColonBlk = false;
          } else {
            rColonBlk = sd === 0 || rStack[sd - 1] === '{_blk';
          }
          continue;
        }
        const wasColonBlk = rColonBlk;
        rColonBlk = false;
        if (t.val === '=>' && exprArrowIndices.has(i)) {
          arrowExprStackLens.push(rStack.length);
          continue;
        }
        if (
          arrowExprStackLens.length > 0 &&
          (t.val === ';' || (t.val === ',' && rStack.length === arrowExprStackLens[arrowExprStackLens.length - 1]))
        ) {
          while (arrowExprStackLens.length > 0 && arrowExprStackLens[arrowExprStackLens.length - 1] >= rStack.length) {
            arrowExprStackLens.pop();
          }
        }
        if (t.val === '(') {
          rStack.push('(');
          rTernary[rStack.length] = 0;
          if (paramOpenIndices.has(i)) paramActive++;
        } else if (t.val === '[') {
          rStack.push('[');
          rTernary[rStack.length] = 0;
        } else if (t.val === '{') {
          if (pendKind) {
            rStack.push(pendKind);
            if (pendKind === '{_cls') rDepth++;
            pendKind = '';
          } else {
            const isBlk = !prev || BLOCK_PREV_TOKENS.has(prev.val) || wasColonBlk;
            rStack.push(isBlk ? '{_blk' : '{_obj');
            if (isBlk) rDepth++;
          }
          rTernary[rStack.length] = 0;
        } else if (t.val === ')' || t.val === ']' || t.val === '}') {
          if (t.val === ')' && paramCloseIndices.has(i) && paramActive > 0) paramActive--;
          rTernary[rStack.length] = 0;
          const pop = rStack.pop();
          if ((pop === '{_blk' || pop === '{_cls') && rDepth > 0) rDepth--;
          if (t.val === '}') pendKind = '';
          while (arrowExprStackLens.length > 0 && arrowExprStackLens[arrowExprStackLens.length - 1] > rStack.length) {
            arrowExprStackLens.pop();
          }
        } else if (t.val === ';') {
          rTernary[sd] = 0;
          pendKind = '';
        }
        continue;
      }
      rColonBlk = false;
      if (t.type !== 'id') continue;
      if (t.val === 'class') {
        pendKind = '{_cls';
        continue;
      }
      if (JS_KEYWORDS.has(t.val) || nonVarTokens.has(t) || paramDeclTokens.has(t) || unsafe.has(t.val)) continue;
      recordRef(t.val, rDepth + paramActive + arrowExprStackLens.length);
    }
  }

  // Outer-scope free-variable protection
  for (const name of declared) {
    const rDepth = minRefScope.get(name);
    const dDepth = minDeclScope.get(name);
    if (rDepth !== undefined && dDepth !== undefined && rDepth < dDepth) {
      unsafe.add(name);
    }
  }

  const existingIds = new Set(counts.keys());
  const nextShortName = createShortNameGen(existingIds, unsafe, 0);
  const nextTwoCharName = createShortNameGen(existingIds, unsafe, 53);

  const candidates = [];
  for (const name of declared) {
    if (unsafe.has(name)) continue;
    const c = counts.get(name) || 0;
    const sh = shorthandCounts.get(name) || 0;
    const estSave = (c - sh) * (name.length - 2) - sh * 3;
    if (estSave >= 3) candidates.push({ name, c, sh, estSave });
  }
  candidates.sort((a, b) => (b.c - b.sh) - (a.c - a.sh) || b.estSave - a.estSave);

  const renameMap = new Map();
  let singleAvail = 53;
  for (const id of existingIds) if (id.length === 1) singleAvail--;
  for (const id of unsafe) if (id.length === 1 && !existingIds.has(id)) singleAvail--;
  for (const cand of candidates) {
    const useSingle = singleAvail > 0 && cand.c - cand.sh >= 2;
    const short = useSingle ? (singleAvail--, nextShortName()) : nextTwoCharName();
    const realSave = (cand.c - cand.sh) * (cand.name.length - short.length) - cand.sh * (1 + short.length);
    if (realSave >= 2) {
      renameMap.set(cand.name, short);
    }
  }

  const expandedTokens = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.type === 'id' && !nonVarTokens.has(tk) && renameMap.has(tk.val)) {
      const short = renameMap.get(tk.val);
      if (shorthandTokens.has(tk)) {
        expandedTokens.push({ type: 'id', val: tk.val });
        expandedTokens.push({ type: 'punc', val: ':' });
        expandedTokens.push({ type: 'id', val: short });
      } else {
        tk.val = short;
        expandedTokens.push(tk);
      }
    } else {
      expandedTokens.push(tk);
    }
  }

  return compactMangledTokens(expandedTokens, declared);
}

module.exports = {
  mangleSafeLocals,
};
