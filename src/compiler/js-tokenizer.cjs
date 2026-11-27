// 零依赖 JS 词法扫描器、保护字集合与短标识符生成器
'use strict';

const { minifyGlsl } = require('./glsl-minifier.cjs');

const REGEX_KW = new Set([
  'return', 'throw', 'case', 'delete', 'void', 'typeof',
  'instanceof', 'in', 'of', 'new', 'yield', 'await', 'else', 'do',
]);
const COND_KW = new Set(['if', 'while', 'for', 'with']);
const SAFE_PREV_NO_ASI = new Set([';', '{', ',', '(', '[', '=', ':', '?', '!', '&', '|', '^', '*', '%', '<', '>']);
const SAFE_NEXT_NO_ASI = new Set(['}', ')', ']', ';', ',', '?', ':']);
const RESERVED_OR_GLOBAL = new Set([
  'arguments', 'undefined', 'Infinity', 'NaN', 'globalThis', 'window', 'self', 'document', 'navigator',
  'location', 'localStorage', 'sessionStorage', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'queueMicrotask', 'structuredClone', 'atob', 'btoa',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'MutationObserver', 'MutationRecord', 'IntersectionObserver', 'IntersectionObserverEntry',
  'ResizeObserver', 'ResizeObserverEntry', 'PerformanceObserver', 'IdleDeadline',
  'AbortController', 'AbortSignal', 'getComputedStyle', 'matchMedia',
  'getSelection', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'visualViewport', 'fetch', 'WebSocket',
  'Worker', 'SharedWorker', 'BroadcastChannel', 'MessageChannel', 'MessagePort',
  'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FormData', 'Headers', 'Request', 'Response',
  'TextEncoder', 'TextDecoder', 'crypto', 'console', 'module', 'exports', 'require', 'process', 'Buffer',
  '__dirname', '__filename', 'Promise', 'Object', 'Array', 'String', 'Number', 'Boolean', 'BigInt', 'Math',
  'Date', 'JSON', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry',
  'ArrayBuffer', 'SharedArrayBuffer', 'Atomics', 'DataView', 'Uint8ClampedArray', 'Uint8Array',
  'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array',
  'Intl', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'AggregateError', 'reportError',
  'RegExp', 'Symbol', 'Proxy', 'Reflect', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'parseInt', 'parseFloat', 'isFinite', 'isNaN',
  'CSS', 'CSSStyleSheet', 'FontFace', 'Node', 'NodeFilter', 'DOMParser', 'XMLSerializer',
  'Element', 'HTMLElement', 'SVGElement', 'HTMLTemplateElement', 'DocumentFragment', 'ShadowRoot',
  'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'PointerEvent', 'FocusEvent', 'ClipboardItem',
  'Image', 'ImageData', 'ImageBitmap', 'createImageBitmap', 'Path2D', 'OffscreenCanvas',
  'OffscreenCanvasRenderingContext2D', 'CanvasRenderingContext2D', 'WebGL2RenderingContext', 'WebGLRenderingContext',
  'trustedTypes', 'TrustedTypes', 'customElements', 'indexedDB', 'caches', 'speechSynthesis',
]);

const JS_KEYWORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let',
  'new', 'null', 'of', 'package', 'private', 'protected', 'public', 'return',
  'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var',
  'void', 'while', 'with', 'yield', 'async', 'await',
]);
const BLOCK_PREV_TOKENS = new Set([')', 'else', 'try', 'catch', 'finally', 'do', '=>', '{', '}', ';']);
const SAFE_BOOL_PREV = new Set(['=', '(', '[', ',', ':', '?', 'return', '===', '!==', '==', '!=', '&&', '||', '??', ';', '{']);
const PROTECTED_BUNDLE_LITERALS = [
  'interaction-takeover-card',
  'side-question-panel',
  'ag-prism-css',
  'ag-claude-style-css',
  'ag-cs-home-panel',
  'ag-prism-thought-raw-toggle',
  'ag-prism-thought-overlay',
];

function isIdChar(ch) {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    (c >= 48 && c <= 57) ||
    c === 95 ||
    c === 36 ||
    c > 127
  );
}

function needsSpace(a, b) {
  if (!a || !b) return false;
  if (isIdChar(a) && isIdChar(b)) return true;
  if ((a === '+' && b === '+') || (a === '-' && b === '-')) return true;
  if (a === '/' && (b === '/' || b === '*')) return true;
  if (a === '<' && b === '!') return true;
  return false;
}

function tokenizeJs(src) {
  const n = src.length;
  const tokens = [];
  let lastWord = '';
  let lastOp = '';
  let closedCondParen = false;
  const parenStack = [];
  const tplBraceStack = [];

  const canStartRegex = () => {
    if (tokens.length === 0) return true;
    if (closedCondParen) return true;
    if (lastWord) return REGEX_KW.has(lastWord);
    if (
      lastOp === 'id' ||
      lastOp === 'num' ||
      lastOp === '++' ||
      lastOp === '--' ||
      lastOp === ')' ||
      lastOp === ']' ||
      lastOp === '.' ||
      lastOp === '?.' ||
      lastOp === 'regex' ||
      lastOp === "'" ||
      lastOp === '"' ||
      lastOp === '`'
    ) {
      return false;
    }
    return true;
  };

  const scanTemplate = (startIdx, isRootTpl) => {
    let j = startIdx;
    while (j < n) {
      const c = src[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '`') {
        let body = src.slice(startIdx, j);
        if (isRootTpl && /^\s*#version\s+300\s+es\b/.test(body)) {
          body = minifyGlsl(body);
        }
        tokens.push({ type: 'lit', val: body + '`' });
        lastWord = '';
        lastOp = '`';
        closedCondParen = false;
        return j + 1;
      }
      if (c === '$' && src[j + 1] === '{') {
        tokens.push({ type: 'lit', val: src.slice(startIdx, j + 2) });
        tplBraceStack.push(1);
        lastWord = '';
        lastOp = '${';
        closedCondParen = false;
        return j + 2;
      }
      j++;
    }
    tokens.push({ type: 'lit', val: src.slice(startIdx) });
    return n;
  };

  let i = 0;
  while (i < n) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      tokens.push({ type: 'ws', val: ' ' });
      i++;
      continue;
    }
    if (ch === '\n') {
      tokens.push({ type: 'nl', val: '\n' });
      i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < n && src[i] !== '\n') i++;
      tokens.push({ type: 'nl', val: '\n' });
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      let hasNL = false;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') hasNL = true;
        i++;
      }
      i += 2;
      tokens.push({ type: hasNL ? 'nl' : 'ws', val: hasNL ? '\n' : ' ' });
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === ch) {
          j++;
          break;
        }
        j++;
      }
      tokens.push({ type: 'lit', val: src.slice(i, j) });
      lastWord = '';
      lastOp = ch;
      closedCondParen = false;
      i = j;
      continue;
    }
    if (ch === '`') {
      tokens.push({ type: 'lit', val: '`' });
      i = scanTemplate(i + 1, true);
      continue;
    }
    if (ch === '/' && canStartRegex()) {
      let j = i + 1;
      let classDepth = 0;
      let validRegex = false;
      while (j < n) {
        const rc = src[j];
        if (rc === '\n' || rc === '\r') break;
        if (rc === '\\') {
          if (j + 1 >= n || src[j + 1] === '\n' || src[j + 1] === '\r') break;
          j += 2;
          continue;
        }
        if (rc === '[') classDepth++;
        else if (rc === ']') {
          if (classDepth > 0) classDepth--;
        } else if (rc === '/' && classDepth === 0) {
          j++;
          validRegex = true;
          break;
        }
        j++;
      }
      if (validRegex) {
        while (j < n && /[a-z]/i.test(src[j])) j++;
        tokens.push({ type: 'lit', val: src.slice(i, j) });
        lastWord = '';
        lastOp = 'regex';
        closedCondParen = false;
        i = j;
        continue;
      }
    }
    // ES2022 Private class identifiers (#field)
    if (ch === '#' && i + 1 < n && isIdChar(src[i + 1])) {
      let j = i + 1;
      while (j < n && isIdChar(src[j])) j++;
      tokens.push({ type: 'punc', val: src.slice(i, j) });
      lastWord = '';
      lastOp = 'id';
      closedCondParen = false;
      i = j;
      continue;
    }
    if (isIdChar(ch)) {
      let j = i + 1;
      while (j < n && isIdChar(src[j])) j++;
      const word = src.slice(i, j);
      const isNum = ch >= '0' && ch <= '9';
      const afterMemberDot = lastOp === '.' || lastOp === '?.';
      tokens.push({ type: isNum ? 'lit' : 'id', val: word });
      if (isNum) {
        lastWord = '';
        lastOp = 'num';
      } else if (afterMemberDot) {
        // Property access (e.g. `state.in / w / 2`) must NEVER set lastWord to a REGEX_KW!
        lastWord = '';
        lastOp = 'id';
      } else {
        lastWord = word;
        lastOp = 'id';
      }
      closedCondParen = false;
      i = j;
      continue;
    }
    if (ch === '(') {
      parenStack.push(COND_KW.has(lastWord));
      tokens.push({ type: 'punc', val: '(' });
      lastWord = '';
      lastOp = '(';
      closedCondParen = false;
      i++;
      continue;
    }
    if (ch === ')') {
      const isCond = parenStack.pop() || false;
      tokens.push({ type: 'punc', val: ')' });
      lastWord = '';
      lastOp = ')';
      closedCondParen = isCond;
      i++;
      continue;
    }
    if (ch === '{') {
      if (tplBraceStack.length > 0) tplBraceStack[tplBraceStack.length - 1]++;
      tokens.push({ type: 'punc', val: '{' });
      lastWord = '';
      lastOp = '{';
      closedCondParen = false;
      i++;
      continue;
    }
    if (ch === '}') {
      if (tplBraceStack.length > 0) {
        tplBraceStack[tplBraceStack.length - 1]--;
        if (tplBraceStack[tplBraceStack.length - 1] === 0) {
          tplBraceStack.pop();
          tokens.push({ type: 'punc', val: '}' });
          i = scanTemplate(i + 1, false);
          continue;
        }
      }
      tokens.push({ type: 'punc', val: '}' });
      lastWord = '';
      lastOp = '}';
      closedCondParen = false;
      i++;
      continue;
    }
    if ((ch === '+' && src[i + 1] === '+') || (ch === '-' && src[i + 1] === '-')) {
      const op = src.slice(i, i + 2);
      tokens.push({ type: 'punc', val: op });
      lastWord = '';
      lastOp = op;
      closedCondParen = false;
      i += 2;
      continue;
    }
    if (ch === '?' && src[i + 1] === '.') {
      tokens.push({ type: 'punc', val: '?.' });
      lastWord = '';
      lastOp = '?.';
      closedCondParen = false;
      i += 2;
      continue;
    }
    if (ch === '=' && src[i + 1] === '>') {
      tokens.push({ type: 'punc', val: '=>' });
      lastWord = '';
      lastOp = '=>';
      closedCondParen = false;
      i += 2;
      continue;
    }
    if (
      (ch === '=' && src[i + 1] === '=' && src[i + 2] === '=') ||
      (ch === '!' && src[i + 1] === '=' && src[i + 2] === '=') ||
      (ch === '.' && src[i + 1] === '.' && src[i + 2] === '.')
    ) {
      const op3 = src.slice(i, i + 3);
      tokens.push({ type: 'punc', val: op3 });
      lastWord = '';
      lastOp = op3;
      closedCondParen = false;
      i += 3;
      continue;
    }
    if (
      (ch === '=' && src[i + 1] === '=') ||
      (ch === '!' && src[i + 1] === '=') ||
      (ch === '&' && src[i + 1] === '&') ||
      (ch === '|' && src[i + 1] === '|') ||
      (ch === '?' && src[i + 1] === '?')
    ) {
      const op2 = src.slice(i, i + 2);
      tokens.push({ type: 'punc', val: op2 });
      lastWord = '';
      lastOp = op2;
      closedCondParen = false;
      i += 2;
      continue;
    }
    tokens.push({ type: 'punc', val: ch });
    lastWord = '';
    lastOp = ch;
    closedCondParen = false;
    i++;
  }
  return tokens;
}

function createShortNameGen(existingIds, unsafe, startIdx = 0) {
  const headChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$';
  const tailChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$';
  let genIdx = startIdx;
  return () => {
    while (true) {
      let n = genIdx++;
      let s = headChars[n % headChars.length];
      n = Math.floor(n / headChars.length) - 1;
      while (n >= 0) {
        s += tailChars[n % tailChars.length];
        n = Math.floor(n / tailChars.length) - 1;
      }
      if (!existingIds.has(s) && !unsafe.has(s) && !JS_KEYWORDS.has(s)) {
        existingIds.add(s);
        return s;
      }
    }
  };
}

module.exports = {
  REGEX_KW,
  COND_KW,
  SAFE_PREV_NO_ASI,
  SAFE_NEXT_NO_ASI,
  RESERVED_OR_GLOBAL,
  JS_KEYWORDS,
  BLOCK_PREV_TOKENS,
  SAFE_BOOL_PREV,
  PROTECTED_BUNDLE_LITERALS,
  isIdChar,
  needsSpace,
  tokenizeJs,
  createShortNameGen,
};
