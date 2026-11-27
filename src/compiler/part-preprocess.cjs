// 运行时模块清单常量、GLSL/模板预处理、死函数裁剪与静态 CSS 常量折叠
'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_SYNC_SUBDIRS,
  isSafeManagedRelPath,
  shouldExcludeSyncRelPath,
  collectManagedSubdirFiles,
} = require('../utils/sync-manifest.cjs');
const { minifyCss, serializeJsValue } = require('./css-pack.cjs');
const { minifyGlsl } = require('./glsl-minifier.cjs');
const { JS_KEYWORDS, tokenizeJs } = require('./js-tokenizer.cjs');
const {
  serializeTokens,
  decodeSimpleJsString,
  hasLoneUtf16Surrogate,
  decodeSimpleTemplateBody,
  compactStaticStringArrayMap,
  minifyEmbeddedCssTemplate,
} = require('./js-serializer.cjs');

// 按需独立通道模块（不打入 Channel 1 主包以严控体积 < 390 KB，仍纳入 SYNC_ROOT_FILES 随安装包/热更新同步）
const DEFERRED_ROOT_MODULES = [
  'i18n-locales.js',
  'dual-mascot-rig.js',
  'settings-panel.js',
  'usage-core.js',
  'home-studio-panel.js',
  'vial-core.js',
  'pulse-vial-bridge.js',
  'host-workbench-enhancer.js',
  'context-menu-btw.js',
];

const RUNTIME_PARTS = [
  'src/runtime/dom-bus.js',
  'src/runtime/reduced-motion-guard.js',
  'src/runtime/font-customizer.js',
  'src/runtime/ripple-worker.js',
  'i18n-core.js',
  'crystal-prism-core.js',
  'animated-icons.js',
  'motion-engine.js',
  'ripple-core.js',
  'conv-aura.js',
  'smooth-caret.js',
  'home-ripple-host.js',
  'model-glyph-crystal.js',
  'stream-choreography.js',
  'prism-rim-canvas.js',
  'ui-runtime.js',
];

const REPO_ROOT_DIR = path.resolve(__dirname, '..', '..');

const SYNC_SUBDIRS = DEFAULT_SYNC_SUBDIRS;

const BASE_SYNC_ROOT_FILES = Object.freeze([
  'plugin.json',
  'package.json',
  'README.md',
  'README.en.md',
  'CHANGELOG.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'config.example.json',
  'cdp.js',
  'inject.js',
  'remove.js',
  'style.css',
  'tools/install-plugin.cjs',
  'workbench/app.js',
  ...DEFERRED_ROOT_MODULES,
  ...RUNTIME_PARTS.filter((p) => !p.includes('/')),
]);

/**
 * 动态拼装同步文件总表（兼容旧版 <= v1.0.8-beta.3 在线同步仅消费 SYNC_ROOT_FILES 的路径）：
 * 基础根目录/工具受管文件 + 实时扫描 src/ 下全部合法运行期文件（去重、POSIX 相对路径、自动过滤非运行期垃圾文件与 symlink）。
 */
function buildSyncRootFiles(rootDir = REPO_ROOT_DIR) {
  const out = [];
  const seen = new Set();
  const pushUnique = (rel) => {
    const normalized = String(rel || '').replace(/\\/g, '/');
    if (!normalized || !isSafeManagedRelPath(normalized) || shouldExcludeSyncRelPath(normalized)) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  };
  for (const rel of BASE_SYNC_ROOT_FILES) {
    pushUnique(rel);
  }
  for (const rel of collectManagedSubdirFiles(rootDir, 'src')) {
    pushUnique(rel);
  }
  return out;
}

const SYNC_ROOT_FILES = buildSyncRootFiles(REPO_ROOT_DIR);

function minifyEmbeddedGlslTemplates(src) {
  if (!src.includes('#version 300 es')) return src;
  return src.replace(/`(\s*#version\s+300\s+es\b(?:\\[\s\S]|(?!\$\{)[^`\\])*)`/g, (full, body) => {
    const decoded = decodeSimpleTemplateBody(body);
    if (decoded === null) return full;
    const min = minifyGlsl(decoded);
    return JSON.stringify(min);
  });
}

function stripJsFunctionsByName(src, replacementsByName) {
  const tokens = tokenizeJs(src);
  const out = [];
  const nextSig = (idx) => {
    for (let j = idx; j < tokens.length; j++) {
      if (tokens[j].type !== 'ws' && tokens[j].type !== 'nl') return j;
    }
    return -1;
  };
  const prevSigVal = (list) => {
    for (let k = list.length - 1; k >= 0; k--) {
      if (list[k].type !== 'ws' && list[k].type !== 'nl') return list[k].val;
    }
    return '';
  };
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    const prevV = prevSigVal(out);
    if (tk.type === 'id' && tk.val === 'function' && (!prevV || prevV === ';' || prevV === '}' || prevV === '{')) {
      const nameIdx = nextSig(i + 1);
      const nameTk = nameIdx >= 0 ? tokens[nameIdx] : null;
      if (nameTk && nameTk.type === 'id' && Object.prototype.hasOwnProperty.call(replacementsByName, nameTk.val)) {
        const parenStart = nextSig(nameIdx + 1);
        if (parenStart >= 0 && tokens[parenStart].type === 'punc' && tokens[parenStart].val === '(') {
          let pDepth = 0;
          let pEnd = -1;
          for (let j = parenStart; j < tokens.length; j++) {
            const t = tokens[j];
            if (t.type === 'punc' && t.val === '(') pDepth++;
            else if (t.type === 'punc' && t.val === ')') {
              pDepth--;
              if (pDepth === 0) { pEnd = j; break; }
            }
          }
          const braceStart = pEnd >= 0 ? nextSig(pEnd + 1) : -1;
          if (braceStart >= 0 && tokens[braceStart].type === 'punc' && tokens[braceStart].val === '{') {
            let bDepth = 0;
            let bEnd = -1;
            for (let j = braceStart; j < tokens.length; j++) {
              const t = tokens[j];
              if (t.type === 'lit' && t.val.endsWith('${')) bDepth++;
              else if (t.type === 'punc' && t.val === '{') bDepth++;
              else if (t.type === 'punc' && t.val === '}') {
                bDepth--;
                if (bDepth === 0) { bEnd = j; break; }
              }
            }
            if (bEnd >= 0) {
              const repl = replacementsByName[nameTk.val];
              if (repl) out.push(...tokenizeJs(repl));
              else out.push({ type: 'punc', val: ';' });
              i = bEnd;
              continue;
            }
          }
        }
      }
    }
    out.push(tk);
  }
  return serializeTokens(out);
}

function stripUnusedUpstreamMenuObserver(src) {
  const preCleaned = src
    .replace(/\bvar\s+(?:SET_TITLE_I18N|SET_HEAD_I18N|FILL_RADIUS_CSS|TRACK_HEIGHT|BASE_SPEEDUP|MIN_HEIGHT_SLOTS|CLAUDE_ROWS|CLAUDE_KNOB_[WHR]|TRACE_CAPACITY|traceRingBuffer)\s*=\s*(?:\{[^{}]*\}|[^;\n]+);?/g, '')
    .replace(/\bvar\s+SETTINGS_SCHEMA\s*=\s*_F\(\[[\s\S]*?(?=\r?\nfunction\s+schemaDefaults\b)/, '')
    .replace(/,\s*(?:label|hint|labelEn|hintEn)\s*:\s*"[^"]*"/g, '')
    .replace(/(?<!function\s)\btracePush\([^\n;]*\);?/g, '')
    .replace(/if\s*\(\s*typeof\s+window\s*!==\s*"undefined"\s*&&[\s\S]*?(?=\nreturn\s*\{)/, '')
    .replace(/(var\s+SLIDER_CSS\s*=\s*)("(?:\\.|[^"\\])*")/, (full, p1, lit) => {
      try {
        const rawCss = JSON.parse(lit);
        const cleaned = rawCss.replace(/\.ces-set[^{}]*\{[^{}]*\}/g, '');
        return p1 + serializeJsValue(minifyCss(cleaned));
      } catch {
        return full;
      }
    });
  return stripJsFunctionsByName(preCleaned, {
    schemaDefaults: 'function schemaDefaults(){return{v:1,motion:"fast",ticks:"highlight"};}',
    normalizeSettings: 'function normalizeSettings(r){var b={v:1,motion:"fast",ticks:"highlight"};if(!r||typeof r!=="object")return b;if(r.motion==="fast"||r.motion==="quick"||r.motion==="full")b.motion=r.motion;else if(!r.motion&&r.reducedMotion===true)b.motion="quick";if(r.ticks==="highlight"||r.ticks==="dim"||r.ticks==="hidden")b.ticks=r.ticks;return b;}',
    installMenuObserver: 'function installMenuObserver(){return{stop:function(){},rescan:function(){},getCurrent:function(){return null;}};}',
    openSettingsPanel: 'function openSettingsPanel(){return function(){};}',
    installSettingsUi: 'function installSettingsUi(){return{stop:function(){}};}',
    findInferenceRow: '',
    traceClear: '',
    tracePush: 'function tracePush(){}',
    findSeatEffort: 'function findSeatEffort(){return null;}',
    starCountFor: '',
    resetSettings: '',
    writeSettings: '',
    dumpTrace: '',
    particleCountFor: '',
    starBrightnessFor: '',
  });
}

function preprocessPartToUnits(partName, rawSource, rootDir = path.resolve(__dirname, '..', '..')) {
  const glslCleaned = minifyEmbeddedGlslTemplates(rawSource);
  if (
    partName === 'pulse-vial-bridge.js' ||
    partName === 'settings-panel.js' ||
    partName === 'home-studio-panel.js' ||
    partName === 'vendor/pulse-dashboard/inline-fallback.js'
  ) {
    return [{ key: partName, src: minifyEmbeddedCssTemplate(glslCleaned), prefix: '' }];
  }
  if (partName === 'i18n-locales.js') {
    return [{ key: partName, src: compactStaticStringArrayMap(glslCleaned, 'UI_TABLE'), prefix: '' }];
  }
  if (partName === 'vendor/effort-slider/slider-coexist.js') {
    const upstreamPath = path.join(rootDir, 'vendor', 'effort-slider', 'upstream-client.js');
    if (fs.existsSync(upstreamPath) && !glslCleaned.includes('AntigravityCodexEffortSlider = exportsObj')) {
      const upstreamRaw = stripUnusedUpstreamMenuObserver(fs.readFileSync(upstreamPath, 'utf8'));
      return [
        {
          key: 'vendor/effort-slider/upstream-client.js',
          src: upstreamRaw,
          prefix:
            'globalThis.__agCodexEffortSliderDisableAutoBoot=!0;if(typeof window!=="undefined")window.__agCodexEffortSliderDisableAutoBoot=!0;\n',
        },
        { key: partName, src: glslCleaned, prefix: '' },
      ];
    }
  }
  return [{ key: partName, src: glslCleaned, prefix: '' }];
}

function desugarInterpolatedTemplateTokens(tokens) {
  const out = [];
  let prevSig = null;

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (
      tk.type === 'lit' &&
      tk.val === '`' &&
      i + 1 < tokens.length &&
      tokens[i + 1].type === 'lit' &&
      tokens[i + 1].val.endsWith('${')
    ) {
      const canBeTagged =
        prevSig &&
        (prevSig.type === 'id' ||
          prevSig.val === ')' ||
          prevSig.val === ']' ||
          prevSig.val === '}' ||
          prevSig.val.endsWith("'") ||
          prevSig.val.endsWith('"') ||
          prevSig.val.endsWith('`'));
      const untagged =
        !canBeTagged || (prevSig && JS_KEYWORDS.has(prevSig.val) && prevSig.val !== 'this' && prevSig.val !== 'super');

      if (untagged) {
        const chunks = [];
        const exprs = [];
        let cursor = i + 1;
        let ok = true;
        while (cursor < tokens.length) {
          const segTok = tokens[cursor];
          if (!segTok || segTok.type !== 'lit') {
            ok = false;
            break;
          }
          if (segTok.val.endsWith('`') && !segTok.val.endsWith('${')) {
            const dec = decodeSimpleTemplateBody(segTok.val.slice(0, -1));
            if (dec === null || hasLoneUtf16Surrogate(dec)) ok = false;
            else chunks.push(dec);
            cursor++;
            break;
          }
          if (!segTok.val.endsWith('${')) {
            ok = false;
            break;
          }
          const dec = decodeSimpleTemplateBody(segTok.val.slice(0, -2));
          if (dec === null || hasLoneUtf16Surrogate(dec)) {
            ok = false;
            break;
          }
          chunks.push(dec);
          cursor++;
          let braceDepth = 1;
          const exprStart = cursor;
          while (cursor < tokens.length && braceDepth > 0) {
            const et = tokens[cursor];
            if (et.type === 'lit' && et.val.endsWith('${')) braceDepth++;
            else if (et.type === 'punc' && et.val === '{') braceDepth++;
            else if (et.type === 'punc' && et.val === '}') braceDepth--;
            cursor++;
          }
          if (braceDepth !== 0) {
            ok = false;
            break;
          }
          exprs.push(tokens.slice(exprStart, cursor - 1));
        }

        const maxStaticLen = ok ? chunks.reduce((m, c) => Math.max(m, Buffer.byteLength(c, 'utf8')), 0) : 0;
        if (ok && chunks.length === exprs.length + 1 && maxStaticLen >= 12) {
          out.push({ type: 'punc', val: '(' });
          out.push({ type: 'lit', val: serializeJsValue(chunks[0]) });
          for (let k = 0; k < exprs.length; k++) {
            out.push({ type: 'punc', val: '+' });
            out.push({ type: 'punc', val: '(' });
            const inner = desugarInterpolatedTemplateTokens(exprs[k]);
            for (let m = 0; m < inner.length; m++) out.push(inner[m]);
            out.push({ type: 'punc', val: ')' });
            if (chunks[k + 1].length > 0) {
              out.push({ type: 'punc', val: '+' });
              out.push({ type: 'lit', val: serializeJsValue(chunks[k + 1]) });
            }
          }
          const closeParen = { type: 'punc', val: ')' };
          out.push(closeParen);
          prevSig = closeParen;
          i = cursor - 1;
          continue;
        }
      }
    }

    out.push(tk);
    if (tk.type !== 'ws' && tk.type !== 'nl') prevSig = tk;
  }

  return out;
}

function foldStaticCssConstTokens(tokens) {
  const sigIdx = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'ws' && tokens[i].type !== 'nl') sigIdx.push(i);
  }
  const edits = [];
  for (let s = 0; s + 3 < sigIdx.length; s++) {
    const t0 = tokens[sigIdx[s]];
    const t1 = tokens[sigIdx[s + 1]];
    const t2 = tokens[sigIdx[s + 2]];
    if ((t0.val !== 'const' && t0.val !== 'let' && t0.val !== 'var') || t1.type !== 'id' || t2.val !== '=') {
      continue;
    }
    const isCssVar = /CSS/i.test(t1.val);
    const startSig = s + 3;
    const first = tokens[sigIdx[startSig]];
    if (first.val === '[') {
      let depth = 1;
      let cur = startSig + 1;
      const elemRanges = [];
      let elemStart = cur;
      while (cur < sigIdx.length && depth > 0) {
        const v = tokens[sigIdx[cur]].val;
        if (v === '[' || v === '(' || v === '{') depth++;
        else if (v === ']' || v === ')' || v === '}') {
          depth--;
          if (depth === 0) {
            if (cur > elemStart) elemRanges.push([elemStart, cur - 1]);
            break;
          }
        } else if (depth === 1 && v === ',') {
          if (cur > elemStart) elemRanges.push([elemStart, cur - 1]);
          elemStart = cur + 1;
        }
        cur++;
      }
      if (
        depth === 0 &&
        elemRanges.length >= 2 &&
        cur + 4 < sigIdx.length &&
        tokens[sigIdx[cur]].val === ']' &&
        tokens[sigIdx[cur + 1]].val === '.' &&
        tokens[sigIdx[cur + 2]].val === 'join' &&
        tokens[sigIdx[cur + 3]].val === '('
      ) {
        let sep = ',';
        let closePos = cur + 4;
        let ok = true;
        if (tokens[sigIdx[closePos]].val === ')') {
          sep = ',';
        } else if (
          closePos + 1 < sigIdx.length &&
          tokens[sigIdx[closePos]].type === 'lit' &&
          (tokens[sigIdx[closePos]].val[0] === "'" || tokens[sigIdx[closePos]].val[0] === '"') &&
          tokens[sigIdx[closePos + 1]].val === ')'
        ) {
          const decSep = decodeSimpleJsString(tokens[sigIdx[closePos]].val);
          if (decSep === null) ok = false;
          else {
            sep = decSep;
            closePos += 1;
          }
        } else {
          ok = false;
        }
        const afterJoin = closePos + 1 < sigIdx.length ? tokens[sigIdx[closePos + 1]] : null;
        if (ok && (!afterJoin || afterJoin.val === ';' || afterJoin.val === ',')) {
          const segments = [];
          let strRun = [];
          const flushStrRun = (trailingSep) => {
            if (strRun.length === 0) return;
            const joined = strRun.join(sep) + (trailingSep ? sep : '');
            const minChunk = isCssVar
              ? joined.replace(/^\s+/, '').replace(/\s{2,}/g, ' ').replace(/\s*([{};:,])\s*/g, '$1')
              : joined;
            segments.push([{ type: 'lit', val: serializeJsValue(minChunk) }]);
            strRun = [];
          };
          for (let rIdx = 0; rIdx < elemRanges.length; rIdx++) {
            const [es, ee] = elemRanges[rIdx];
            if (
              es === ee &&
              tokens[sigIdx[es]].type === 'lit' &&
              (tokens[sigIdx[es]].val[0] === "'" || tokens[sigIdx[es]].val[0] === '"')
            ) {
              const dec = decodeSimpleJsString(tokens[sigIdx[es]].val);
              if (dec !== null) {
                strRun.push(dec);
                continue;
              }
            }
            if (!isCssVar) {
              segments.length = 0;
              strRun.length = 0;
              break;
            }
            flushStrRun(true);
            const exprSlice = tokens.slice(sigIdx[es], sigIdx[ee] + 1);
            const hasMore = rIdx + 1 < elemRanges.length;
            const wrapped = [{ type: 'punc', val: '(' }, ...exprSlice, { type: 'punc', val: ')' }];
            if (hasMore && sep.length > 0) {
              wrapped.push({ type: 'punc', val: '+' });
              wrapped.push({ type: 'lit', val: serializeJsValue(sep) });
            }
            segments.push(wrapped);
          }
          flushStrRun(false);
          if (segments.length === 1 && segments[0].length === 1 && segments[0][0].type === 'lit') {
            const fullRaw = decodeSimpleJsString(segments[0][0].val);
            const foldedText = fullRaw !== null ? (isCssVar ? minifyCss(fullRaw) : fullRaw) : null;
            edits.push({
              from: sigIdx[startSig],
              to: sigIdx[closePos],
              repTokens: [{ type: 'lit', val: foldedText !== null ? serializeJsValue(foldedText) : segments[0][0].val }],
            });
          } else if (isCssVar && segments.length > 0) {
            const repTokens = [];
            for (let k = 0; k < segments.length; k++) {
              if (k > 0) repTokens.push({ type: 'punc', val: '+' });
              for (const tk of segments[k]) repTokens.push(tk);
            }
            edits.push({ from: sigIdx[startSig], to: sigIdx[closePos], repTokens });
          }
          s = closePos;
          continue;
        }
      }
    }
    if (first.type === 'lit' && (first.val[0] === "'" || first.val[0] === '"')) {
      const firstDec = decodeSimpleJsString(first.val);
      if (firstDec !== null) {
        const parts = [firstDec];
        let cur = startSig + 1;
        let lastTokPos = startSig;
        let ok = true;
        while (cur + 1 < sigIdx.length && tokens[sigIdx[cur]].val === '+') {
          const rhs = tokens[sigIdx[cur + 1]];
          if (rhs.type !== 'lit' || (rhs.val[0] !== "'" && rhs.val[0] !== '"')) {
            ok = false;
            break;
          }
          const dec = decodeSimpleJsString(rhs.val);
          if (dec === null) {
            ok = false;
            break;
          }
          parts.push(dec);
          lastTokPos = cur + 1;
          cur += 2;
        }
        const afterConcat = cur < sigIdx.length ? tokens[sigIdx[cur]] : null;
        if (ok && parts.length >= 2 && (!afterConcat || afterConcat.val === ';' || afterConcat.val === ',')) {
          const joinedText = parts.join('');
          const foldedText = isCssVar ? minifyCss(joinedText) : joinedText;
          edits.push({
            from: sigIdx[startSig],
            to: sigIdx[lastTokPos],
            repTokens: [{ type: 'lit', val: serializeJsValue(foldedText) }],
          });
          s = lastTokPos;
        }
      }
    }
  }
  if (edits.length === 0) return tokens;
  const out = [];
  let eIdx = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (eIdx < edits.length && i === edits[eIdx].from) {
      for (const rt of edits[eIdx].repTokens) out.push(rt);
      i = edits[eIdx].to;
      eIdx++;
    } else {
      out.push(tokens[i]);
    }
  }
  return out;
}

module.exports = {
  DEFERRED_ROOT_MODULES,
  RUNTIME_PARTS,
  SYNC_SUBDIRS,
  SYNC_ROOT_FILES,
  buildSyncRootFiles,
  minifyEmbeddedGlslTemplates,
  stripJsFunctionsByName,
  stripUnusedUpstreamMenuObserver,
  preprocessPartToUnits,
  desugarInterpolatedTemplateTokens,
  foldStaticCssConstTokens,
};
