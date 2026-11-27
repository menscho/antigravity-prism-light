// Channel 1 主包统一共享字符串池编译器、CSS 压缩缓存与基础注入模板生成器
'use strict';

const fs = require('fs');
const path = require('path');
const { getFileSig, sha256Text, computeHash } = require('../utils/fs-safe.cjs');
const { minifyCss, serializeJsValue, packCssJsExpr } = require('./css-pack.cjs');
const { tokenizeJs } = require('./js-tokenizer.cjs');
const { mangleSafeLocals } = require('./js-mangler.cjs');
const {
  serializeTokens,
  packTextJsExpr,
  compactStaticStringArrayMap,
  minifyEmbeddedCssTemplate,
} = require('./js-serializer.cjs');
const {
  scanModulePoolCandidates,
  applyModulePoolReplacements,
  minifySingleSource,
} = require('./js-string-pool.cjs');
const {
  RUNTIME_PARTS,
  stripUnusedUpstreamMenuObserver,
  preprocessPartToUnits,
  desugarInterpolatedTemplateTokens,
  foldStaticCssConstTokens,
} = require('./part-preprocess.cjs');

// Ch1 高频 DOM 热模块禁用成员属性（.prop / ?.prop）池化，恢复 V8 原生 Monomorphic IC
const CH1_NO_MEMBER_PROP_POOL_PARTS = new Set([
  'src/runtime/dom-bus.js',
  'stream-choreography.js',
  'ui-runtime.js',
]);

function createCh1Compiler({
  rootDir = path.resolve(__dirname, '..', '..'),
  stats,
  getInjectWrapperTemplate,
}) {
  const _mangledUnitCache = new Map();
  let _unifiedBundleCache = { sig: '', bundleCode: '', partCodeByName: new Map() };
  let _cssCache = { sig: '', minCss: '', packedExpr: '' };

  function clearMemCaches() {
    _cssCache = { sig: '', minCss: '', packedExpr: '' };
    _unifiedBundleCache = { sig: '', bundleCode: '', partCodeByName: new Map() };
    _mangledUnitCache.clear();
  }

  function hasCompiledUnifiedBundle() {
    return Boolean(_unifiedBundleCache.bundleCode);
  }

  function readCss() {
    const p = path.join(rootDir, 'style.css');
    const sig = getFileSig(p);
    if (_cssCache.sig !== sig) {
      if (stats) stats.cssMinifyRuns += 1;
      const minCss = minifyCss(fs.readFileSync(p, 'utf8'));
      _cssCache = { sig, minCss, packedExpr: '' };
    }
    return _cssCache.minCss;
  }

  function readPackedCssExpr() {
    readCss();
    if (!_cssCache.packedExpr) {
      _cssCache.packedExpr = packCssJsExpr(_cssCache.minCss);
    }
    return _cssCache.packedExpr;
  }

  function getEffectiveBundlePartNames() {
    return [...RUNTIME_PARTS];
  }

  function getMangledUnit(unitKey, sig, src, allowMemberProps = true) {
    const hit = _mangledUnitCache.get(unitKey);
    if (hit && hit.sig === sig) return hit;
    if (stats) stats.mangledUnitRuns += 1;
    const tokens = desugarInterpolatedTemplateTokens(mangleSafeLocals(foldStaticCssConstTokens(tokenizeJs(src))));
    const occs = scanModulePoolCandidates(tokens, allowMemberProps);
    const entry = { sig, tokens, occs };
    _mangledUnitCache.set(unitKey, entry);
    return entry;
  }

  // Unified Bundle-Level Shared String & Member-Property Pool Compiler
  function compileUnifiedBundle() {
    const partNames = getEffectiveBundlePartNames();
    const partMeta = [];
    const sigParts = [];

    for (const partName of partNames) {
      const fullPath = path.join(rootDir, partName);
      let sig = getFileSig(fullPath);
      if (partName === 'vendor/effort-slider/slider-coexist.js') {
        const upPath = path.join(rootDir, 'vendor', 'effort-slider', 'upstream-client.js');
        if (fs.existsSync(upPath)) sig += '|' + getFileSig(upPath);
      }
      sigParts.push(`${partName}:${sig}`);
      partMeta.push({ partName, fullPath, sig });
    }

    const totalSig = sigParts.join(';');
    if (_unifiedBundleCache.sig === totalSig) {
      return _unifiedBundleCache;
    }
    if (stats) stats.compileUnifiedRuns += 1;

    const SEP = '\x7f';
    const POOL_IDX_BASE = 0x00a1;
    const DIRECT_SINGLE_LIMIT = 7775; // 0x00A1..0x1EFF: 1,887 2-byte + 5,888 3-byte UTF-8 chars (all < 0x2028)
    const HI_CHAR_BASE = 0x1f00; // 0x1F00..0x1FFF + 0x00A1..0x00E0 = 16,384 overflow 2-char slots
    const MAX_SHARED_POOL = 12000;

    const compiledParts = [];
    const globalStats = new Map();

    for (const pm of partMeta) {
      const raw = fs.readFileSync(pm.fullPath, 'utf8');
      const allowMemberProps = !CH1_NO_MEMBER_PROP_POOL_PARTS.has(pm.partName);
      const units = preprocessPartToUnits(pm.partName, raw, rootDir).map((u) => {
        const uSig = `${pm.sig}:${u.key}:${allowMemberProps ? 1 : 0}`;
        const mangled = getMangledUnit(u.key, uSig, u.src, allowMemberProps);
        for (const [strVal, list] of mangled.occs.entries()) {
          let g = globalStats.get(strVal);
          if (!g) {
            g = {
              strVal,
              valBytes: Buffer.byteLength(strVal, 'utf8'),
              totalOrig: 0,
              totalReplEst: 0,
              moduleHits: 0,
              totalOccs: 0,
              hasStr: false,
            };
            globalStats.set(strVal, g);
          }
          let unitOrig = 0;
          let unitRepl = 0;
          let unitHasStr = false;
          for (const occ of list) {
            unitOrig += occ.origBytes;
            unitRepl += occ.kind === 'str' ? 2 : 4;
            if (occ.kind === 'str') unitHasStr = true;
          }
          if (unitOrig > unitRepl + 2) {
            g.totalOrig += unitOrig;
            g.totalReplEst += unitRepl + 4;
            g.moduleHits += 1;
            g.totalOccs += list.length;
            if (unitHasStr) g.hasStr = true;
          }
        }
        return { ...u, tokens: mangled.tokens, occs: mangled.occs };
      });
      compiledParts.push({ partName: pm.partName, raw, units });
    }

    const poolCandidates = [];
    for (const g of globalStats.values()) {
      const lzPoolCost = g.valBytes >= 8 ? Math.ceil(g.valBytes * 0.62) + 2 : g.valBytes + 2;
      const netSave = g.totalOrig - (lzPoolCost + g.totalReplEst);
      if ((g.totalOccs >= 2 && netSave >= 1) || (g.hasStr && g.valBytes >= 13 && !g.strVal.startsWith('^]t'))) {
        const sortScore = g.totalOccs >= 2 ? netSave + Math.floor(g.valBytes * 0.25) : Math.floor(g.valBytes * 0.35) - 5;
        poolCandidates.push({ ...g, netSave, sortScore });
      }
    }
    poolCandidates.sort((a, b) => b.sortScore - a.sortScore || b.totalOccs - a.totalOccs);
    const chosenPool = poolCandidates.slice(0, MAX_SHARED_POOL);
    chosenPool.sort((a, b) => b.moduleHits - a.moduleHits || b.totalOccs - a.totalOccs || b.sortScore - a.sortScore);

    const sharedPoolList = chosenPool.map((x) => x.strVal);
    const poolIndexMap = new Map();
    for (let idx = 0; idx < sharedPoolList.length; idx++) {
      poolIndexMap.set(sharedPoolList[idx], idx);
    }

    const ASCII_SLOT_COUNT = 88; // 0x23..0x3B (25) + 0x3F..0x5B (29) + 0x5D..0x7E (34): 1-byte unescaped ASCII
    const SINGLE_TOTAL_LIMIT = ASCII_SLOT_COUNT + DIRECT_SINGLE_LIMIT;
    const encodePoolIndex = (idx) => {
      if (idx < 25) return String.fromCharCode(35 + idx);
      if (idx < 54) return String.fromCharCode(38 + idx);
      if (idx < ASCII_SLOT_COUNT) return String.fromCharCode(39 + idx);
      if (idx < SINGLE_TOTAL_LIMIT) return String.fromCharCode(POOL_IDX_BASE + idx - ASCII_SLOT_COUNT);
      const rem = idx - SINGLE_TOTAL_LIMIT;
      return String.fromCharCode(HI_CHAR_BASE + (rem >> 6), POOL_IDX_BASE + (rem & 63));
    };

    const packedPoolExpr = packTextJsExpr(sharedPoolList.join(SEP), 5600);
    const bootstrapHeader =
      `globalThis.__agSP=${packedPoolExpr}.split(${JSON.stringify(SEP)});` +
      `globalThis.__agM=s=>{let p=globalThis.__agSP,r=[],i=0;for(;i<s.length;i++){let c=s.charCodeAt(i);r.push(p[c<${POOL_IDX_BASE}?(c<60?c-35:c<92?c-38:c-39):c<${HI_CHAR_BASE}?c-${POOL_IDX_BASE - ASCII_SLOT_COUNT}:${SINGLE_TOTAL_LIMIT}+((c-${HI_CHAR_BASE})<<6)+s.charCodeAt(++i)-${POOL_IDX_BASE}])}return r};`;

    const partCodeByName = new Map();
    const orderedCodes = [];

    for (let pIdx = 0; pIdx < compiledParts.length; pIdx++) {
      const cp = compiledParts[pIdx];
      const unitCodes = cp.units.map((u) => {
        const selected = [];
        for (const [strVal, list] of u.occs.entries()) {
          const poolIdx = poolIndexMap.get(strVal);
          if (poolIdx === undefined) continue;
          const totalOrig = list.reduce((s, x) => s + x.origBytes, 0);
          selected.push({ strVal, poolIdx, list, totalOrig });
        }
        selected.sort((a, b) => b.list.length - a.list.length || b.totalOrig - a.totalOrig);

        const plainMin = serializeTokens(u.tokens);
        const pooledCode = applyModulePoolReplacements(u.tokens, selected, (activeItems, bodyCode) => {
          const varNames = activeItems.map((x) => x.varName);
          const idxChars = activeItems.map((x) => encodePoolIndex(x.poolIdx)).join('');
          const bodySep = bodyCode.endsWith(';') || bodyCode.endsWith('}') ? bodyCode : bodyCode + ';';
          return `{let[${varNames.join(',')}]=__agM(${serializeJsValue(idxChars)});${bodySep}}`;
        });

        const bestBody =
          Buffer.byteLength(pooledCode, 'utf8') < Buffer.byteLength(plainMin, 'utf8')
            ? pooledCode
            : plainMin;
        const withSemi = bestBody.endsWith(';') || bestBody.endsWith('}') ? bestBody : bestBody + ';';
        return u.prefix + withSemi;
      });

      let finalPartCode = unitCodes.join('\n');
      if (pIdx === 0) {
        finalPartCode = bootstrapHeader + finalPartCode;
      }
      if (pIdx === compiledParts.length - 1) {
        finalPartCode += '\ndelete globalThis.__agSP;delete globalThis.__agM;';
      }
      partCodeByName.set(cp.partName, finalPartCode);
      orderedCodes.push(finalPartCode);
    }

    const bundleCode = orderedCodes.join('\n');
    if (process.env.AG_PRISM_DEV_WATCH !== '1') _mangledUnitCache.clear();
    _unifiedBundleCache = { sig: totalSig, bundleCode, partCodeByName };
    return _unifiedBundleCache;
  }

  function prepareRuntimePart(partName, rawSource) {
    const normName = String(partName || '').replace(/\\/g, '/');
    const fullPath = path.join(rootDir, normName);
    if (fs.existsSync(fullPath)) {
      try {
        const diskRaw = fs.readFileSync(fullPath, 'utf8');
        if (diskRaw === rawSource) {
          const unified = compileUnifiedBundle();
          if (unified.partCodeByName.has(normName)) {
            return unified.partCodeByName.get(normName);
          }
        }
      } catch {}
    }

    let prepped = rawSource;
    if (normName === 'pulse-vial-bridge.js' || normName === 'vendor/pulse-dashboard/inline-fallback.js') {
      prepped = minifyEmbeddedCssTemplate(prepped);
    } else if (normName === 'i18n-locales.js') {
      prepped = compactStaticStringArrayMap(prepped, 'UI_TABLE');
    } else if (normName === 'vendor/effort-slider/slider-coexist.js') {
      const upstreamPath = path.join(rootDir, 'vendor', 'effort-slider', 'upstream-client.js');
      if (fs.existsSync(upstreamPath) && !rawSource.includes('AntigravityCodexEffortSlider = exportsObj')) {
        const upstreamRaw = stripUnusedUpstreamMenuObserver(fs.readFileSync(upstreamPath, 'utf8'));
        const upstreamMin = minifySingleSource(upstreamRaw);
        const wrapperMin = minifySingleSource(rawSource);
        return `globalThis.__agCodexEffortSliderDisableAutoBoot=!0;if(typeof window!=="undefined")window.__agCodexEffortSliderDisableAutoBoot=!0;\n${upstreamMin}\n${wrapperMin}`;
      }
    }
    const singleOpts = CH1_NO_MEMBER_PROP_POOL_PARTS.has(normName) ? { allowMemberProps: false } : null;
    return minifySingleSource(prepped, singleOpts);
  }

  function readRuntimeBundle() {
    return compileUnifiedBundle().bundleCode;
  }

  function compileBaseInjectTemplate() {
    const packedCss = readPackedCssExpr();
    const bundle = readRuntimeBundle();
    const codeHash = computeHash(bundle);
    const cssHashJson = JSON.stringify(computeHash(packedCss));
    const codeHashJson = JSON.stringify(codeHash);
    const tpl = getInjectWrapperTemplate();
    const marker = '__AG_INJ_BOOTCFG__';
    const idx = tpl.indexOf(marker);
    const hasUniqueMarker = idx >= 0 && tpl.indexOf(marker, idx + marker.length) === -1;
    if (hasUniqueMarker) {
      const tokenMap = {
        __AG_INJ_CSS__: packedCss,
        __AG_INJ_CSSHASH__: cssHashJson,
        __AG_INJ_CODEHASH__: codeHashJson,
        '__AG_INJ_BUNDLE__();': bundle,
      };
      const applyTokens = (s) =>
        s.replace(/__AG_INJ_CSSHASH__|__AG_INJ_CSS__|__AG_INJ_CODEHASH__|__AG_INJ_BUNDLE__\(\);/g, (m) => tokenMap[m]);
      const basePrefix = applyTokens(tpl.slice(0, idx));
      const baseSuffix = applyTokens(tpl.slice(idx + marker.length));
      const baseSha256 = sha256Text(`${basePrefix}\0${baseSuffix}`);
      return { codeHash, basePrefix, baseSuffix, baseSha256 };
    }
    return { codeHash, basePrefix: null, baseSuffix: null, baseSha256: null, packedCss, bundle, cssHashJson, codeHashJson };
  }

  return {
    clearMemCaches,
    hasCompiledUnifiedBundle,
    readCss,
    readPackedCssExpr,
    getEffectiveBundlePartNames,
    compileUnifiedBundle,
    prepareRuntimePart,
    readRuntimeBundle,
    compileBaseInjectTemplate,
  };
}

module.exports = {
  createCh1Compiler,
};
