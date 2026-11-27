// 声明式配置单一真相源（L0 契约层，零副作用、零外部依赖）
// 自动派生 DEFAULT_CONFIG、VALIDATORS、validateConfigEntry 与 reconcileConfigAliases。
'use strict';

const STYLE_ID = 'ag-prism-css';
const LEGACY_STYLE_ID = 'ag-claude-style-css';
const SETTING_BINDING = '__agPrismSetting';
const LEGACY_SETTING_BINDING = '__agClaudeStyleSetting';
const OMNI_BINDING = '__agPrismOmniCall';
const SIDEBAR_BINDING = '__agPrismSidebarCall';
const INLINE_DIFF_BINDING = '__agPrismInlineDiffCall';
const WALLPAPER_BINDING = '__agPrismWallpaperCall';
const SUGGESTER_BINDING = '__agPrismSuggestCall';

const CANONICAL_LANG_VALUES = Object.freeze(['auto', 'zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'tr']);
const ON_OFF_VALUES = Object.freeze(['on', 'off']);
const AUTO_ON_OFF_VALUES = Object.freeze(['auto', 'on', 'off']);

function normalizeMascotConfigValue(raw) {
  if (typeof raw !== 'string') return null;
  if (raw === 'dual') return 'crab';
  if (raw === 'off' || raw === 'crab' || raw === 'minis' || raw === 'quad' || raw === 'quad-minis') return raw;
  if (!raw.startsWith('r:') || raw.length <= 2) return null;
  const m = /^r:(?:([ckdw][0-4](?:,[ckdw][0-4])*)?(\+m)?)$/.exec(raw);
  if (!m) return null;
  const counts = { c: 0, k: 0, d: 0, w: 0 };
  const seen = new Set();
  let rawTotal = 0;
  let total = 0;
  if (m[1]) {
    for (const tok of m[1].split(',')) {
      const sp = tok[0];
      const cnt = Number(tok.slice(1));
      if (seen.has(sp) || !Number.isInteger(cnt) || cnt < 0 || cnt > 4) return null;
      seen.add(sp);
      rawTotal += cnt;
      const clamped = cnt > 0 ? 1 : 0;
      counts[sp] = clamped;
      total += clamped;
    }
  }
  if (rawTotal > 6 || total > 4) return null;
  const minis = Boolean(m[2]);
  if (total === 0 && !minis) return 'off';
  if (counts.c === 1 && counts.k === 1 && counts.d === 0 && counts.w === 0) return minis ? 'minis' : 'crab';
  if (counts.c === 1 && counts.k === 1 && counts.d === 1 && counts.w === 1) return minis ? 'quad-minis' : 'quad';
  const parts = [];
  for (const sp of ['c', 'k', 'd', 'w']) {
    if (counts[sp] > 0) parts.push(sp + counts[sp]);
  }
  return 'r:' + parts.join(',') + (minis ? '+m' : '');
}

// 声明式配置 Schema：保持字段顺序与历史 DEFAULT_CONFIG / VALIDATORS / config.example.json 100% 对齐
const CONFIG_SCHEMA = Object.freeze({
  // LIGHT (2026-11-27): default UI language is English instead of 'auto' (system language); 'auto' is still selectable.
  language: Object.freeze({ type: 'enum', values: CANONICAL_LANG_VALUES, default: 'en', aliasPair: 'lang', aliasKind: 'string' }),
  lang: Object.freeze({ type: 'enum', values: CANONICAL_LANG_VALUES, default: 'en', aliasOf: 'language' }),
  palette: Object.freeze({ type: 'enum', values: Object.freeze(['host', 'obsidian', 'warm', 'claude']), default: 'obsidian', legacyMap: Object.freeze({ claude: 'warm' }) }),
  lightPreset: Object.freeze({ type: 'enum', values: Object.freeze(['crystal', 'alabaster']), default: 'crystal' }),
  darkAuraStyle: Object.freeze({ type: 'enum', values: Object.freeze(['prism', 'neon']), default: 'prism' }),
  motionLevel: Object.freeze({ type: 'enum', values: Object.freeze(['off', 'subtle', 'standard', 'ultra']), default: 'ultra' }),
  performanceMode: Object.freeze({ type: 'enum', values: Object.freeze(['balanced', 'performance', 'quality', 'auto', 'eco']), default: 'balanced', legacyMap: Object.freeze({ auto: 'balanced', eco: 'performance' }) }),
  ignoreReducedMotion: Object.freeze({ type: 'boolean', default: false, stringBoolMode: 'strictOn' }),
  targetFps: Object.freeze({ type: 'enum', values: Object.freeze(['60', '120', '180', 'native']), default: '180' }),
  telemetryModule: Object.freeze({ type: 'enum', values: AUTO_ON_OFF_VALUES, default: 'auto', coerceBoolToOnOff: true }),
  telemetryQuotaMode: Object.freeze({ type: 'enum', values: Object.freeze(['compact', 'both']), default: 'compact' }),
  effortSliderModule: Object.freeze({ type: 'enum', values: AUTO_ON_OFF_VALUES, default: 'auto', coerceBoolToOnOff: true }),
  effortMemory: Object.freeze({ type: 'enum', values: ON_OFF_VALUES, default: 'on', coerceBoolToOnOff: true }),
  periodicModelPicker: Object.freeze({ type: 'enum', values: ON_OFF_VALUES, default: 'on', coerceBoolToOnOff: true }),
  thoughtTranslate: Object.freeze({ type: 'enum', values: Object.freeze(['off', 'machine', 'ai']), default: 'off' }),
  thoughtTrigger: Object.freeze({ type: 'enum', values: Object.freeze(['preload', 'expand']), default: 'preload' }),
  homeLayout: Object.freeze({ type: 'enum', values: Object.freeze(['studio', 'classic', 'off']), default: 'studio', aliasPair: 'homeMode', aliasKind: 'string' }),
  homeMode: Object.freeze({ type: 'enum', values: Object.freeze(['studio', 'classic', 'off']), default: 'studio', aliasOf: 'homeLayout' }),
  homeRipple: Object.freeze({ type: 'boolean', default: true, aliasPair: 'ripple', aliasKind: 'boolOnOff' }),
  convRipple: Object.freeze({ type: 'enum', values: Object.freeze(['off', 'subtle', 'medium', 'full']), default: 'off' }),
  ripple: Object.freeze({ type: 'enum', values: ON_OFF_VALUES, default: 'on', aliasOf: 'homeRipple' }),
  composerRestyle: Object.freeze({ type: 'boolean', default: true, aliasPair: 'composer', aliasKind: 'boolOnOff' }),
  composer: Object.freeze({ type: 'enum', values: ON_OFF_VALUES, default: 'on', aliasOf: 'composerRestyle' }),
  placeholderStyle: Object.freeze({ type: 'enum', values: Object.freeze(['studio', 'host']), default: 'studio', aliasPair: 'promptStyle', aliasKind: 'string' }),
  promptStyle: Object.freeze({ type: 'enum', values: Object.freeze(['studio', 'host']), default: 'studio', aliasOf: 'placeholderStyle' }),
  mascot: Object.freeze({ type: 'enum', values: Object.freeze(['crab', 'minis', 'quad', 'quad-minis', 'dual', 'off']), default: 'crab', customValidate: normalizeMascotConfigValue }),
  logoInk: Object.freeze({ type: 'enum', values: Object.freeze(['accent', 'foreground']), default: 'accent' }),
  sidebarRestyle: Object.freeze({ type: 'boolean', default: true, aliasPair: 'sidebar', aliasKind: 'boolOnOff' }),
  sidebar: Object.freeze({ type: 'enum', values: ON_OFF_VALUES, default: 'on', aliasOf: 'sidebarRestyle' }),
  sidebarCompact: Object.freeze({ type: 'boolean', default: false, stringBoolMode: 'strictOn' }),
  sidebarNavFold: Object.freeze({ type: 'enum', values: Object.freeze(['off', 'on']), default: 'off', coerceBoolToOnOff: true }),
  smoothCaret: Object.freeze({ type: 'boolean', default: true, stringBoolMode: 'notOff' }),
  scrollBottomMotion: Object.freeze({ type: 'enum', values: Object.freeze(['smooth', 'instant']), default: 'smooth' }),
  contextMenu: Object.freeze({ type: 'boolean', default: true, stringBoolMode: 'notOff' }),
  accentTone: Object.freeze({ type: 'enum', values: Object.freeze(['follow', 'cobalt', 'iris', 'amber', 'mono']), default: 'follow' }),
  cornerStyle: Object.freeze({ type: 'enum', values: Object.freeze(['sharp', 'balanced', 'soft']), default: 'balanced' }),
  chatFont: Object.freeze({ type: 'enum', values: Object.freeze(['default', 'system-sans', 'noto-sans', 'inter', 'harmony', 'custom']), default: 'default' }),
  chatFontCustom: Object.freeze({ type: 'string', default: '', maxLength: 160 }),
  codeFont: Object.freeze({ type: 'enum', values: Object.freeze(['default', 'jetbrains', 'cascadia', 'sfmono', 'custom']), default: 'default' }),
  codeFontCustom: Object.freeze({ type: 'string', default: '', maxLength: 160 }),
  codeLigatures: Object.freeze({ type: 'boolean', default: false, stringBoolMode: 'strictOn' }),
  ambientIntensity: Object.freeze({ type: 'enum', values: Object.freeze(['0', '35', '70', '100']), default: '100' }),
  darkAura: Object.freeze({ type: 'enum', values: Object.freeze(['subtle', 'balanced', 'vivid']), default: 'balanced' }),
  thoughtView: Object.freeze({ type: 'enum', values: Object.freeze(['immersive', 'bilingual']), default: 'immersive' }),
  omniModule: Object.freeze({ type: 'enum', values: ON_OFF_VALUES, default: 'on', coerceBoolToOnOff: true }),
  linkTarget: Object.freeze({ type: 'enum', values: Object.freeze(['builtin', 'external']), default: 'builtin' }),
  sidebarStudio: Object.freeze({ type: 'enum', values: ON_OFF_VALUES, default: 'off', coerceBoolToOnOff: true }),
  hostLocalization: Object.freeze({ type: 'enum', values: AUTO_ON_OFF_VALUES, default: 'auto' }),
  autoUpdate: Object.freeze({ type: 'enum', values: ON_OFF_VALUES, default: 'off', coerceBoolToOnOff: true }),
  updateChannel: Object.freeze({ type: 'enum', values: Object.freeze(['stable', 'beta']), default: 'stable' }),
  autoArchiveOnExit: Object.freeze({ type: 'boolean', default: false, stringBoolMode: 'strictOn' }),
  pollIntervalMs: Object.freeze({ type: 'integer', default: 2500, min: 500, max: 60000, inValidators: false }),
  autoPromptCdpRelaunch: Object.freeze({ type: 'boolean', optional: true, strictBoolean: true, inValidators: false }),
  autoRelaunchOnBareLaunch: Object.freeze({ type: 'boolean', optional: true, strictBoolean: true, inValidators: false }),
});

const DEFAULT_CONFIG = {};
const VALIDATORS = {};
const STRING_ALIAS_PAIRS = [];
const BOOL_ON_OFF_ALIAS_PAIRS = [];
const STRING_BOOL_COERCIONS = [];
const BOOL_TO_ON_OFF_KEYS = [];
const LEGACY_VALUE_MAPS = [];

for (const [key, spec] of Object.entries(CONFIG_SCHEMA)) {
  if (!spec.optional) {
    DEFAULT_CONFIG[key] = spec.default;
  }
  if (spec.inValidators !== false) {
    if (spec.type === 'boolean') {
      VALIDATORS[key] = 'boolean';
    } else if (spec.type === 'enum' && Array.isArray(spec.values)) {
      VALIDATORS[key] = [...spec.values];
    } else if (spec.type === 'string') {
      VALIDATORS[key] = 'string';
    }
  }
  if (spec.aliasPair && spec.aliasKind === 'string') {
    STRING_ALIAS_PAIRS.push([key, spec.aliasPair]);
  } else if (spec.aliasPair && spec.aliasKind === 'boolOnOff') {
    BOOL_ON_OFF_ALIAS_PAIRS.push([key, spec.aliasPair]);
  }
  if (spec.stringBoolMode) {
    STRING_BOOL_COERCIONS.push([key, spec.stringBoolMode]);
  }
  if (spec.coerceBoolToOnOff) {
    BOOL_TO_ON_OFF_KEYS.push(key);
  }
  if (spec.legacyMap) {
    LEGACY_VALUE_MAPS.push([key, spec.legacyMap]);
  }
}

function validateConfigEntry(key, value) {
  if (!Object.prototype.hasOwnProperty.call(CONFIG_SCHEMA, key)) return false;
  const spec = CONFIG_SCHEMA[key];
  if (typeof spec.customValidate === 'function') {
    return spec.customValidate(value) !== null;
  }
  if (spec.type === 'integer') {
    return typeof value === 'number' && Number.isInteger(value) && value >= spec.min && value <= spec.max;
  }
  if (spec.type === 'boolean') {
    if (spec.strictBoolean) return typeof value === 'boolean';
    return typeof value === 'boolean' || value === 'on' || value === 'off';
  }
  if (spec.type === 'enum' && Array.isArray(spec.values)) {
    return typeof value === 'string' && spec.values.includes(value);
  }
  if (spec.type === 'string') {
    if (typeof value !== 'string') return false;
    const maxLen = Number.isInteger(spec.maxLength) && spec.maxLength > 0 ? spec.maxLength : 160;
    return value.length <= maxLen && !/[\0\r\n]/.test(value);
  }
  return false;
}

const _autoPerfModeConfigs = new WeakSet();

function isPerformanceModeExplicit(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) return false;
  if (!Object.prototype.hasOwnProperty.call(rawConfig, 'performanceMode')) return false;
  const raw = rawConfig.performanceMode;
  if (typeof raw !== 'string') return false;
  const norm = raw.trim().toLowerCase();
  return norm === 'performance' || norm === 'eco' || norm === 'balanced' || norm === 'quality';
}

function wasPerformanceModeAuto(config) {
  return Boolean(config && typeof config === 'object' && _autoPerfModeConfigs.has(config));
}

function reconcileConfigAliases(raw) {
  const out = raw && typeof raw === 'object' ? { ...raw } : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(out, k);
  const rawPerfAuto =
    has('performanceMode') && typeof out.performanceMode === 'string' && out.performanceMode.trim().toLowerCase() === 'auto';

  for (const [primary, alias] of STRING_ALIAS_PAIRS) {
    if (has(primary)) {
      out[alias] = out[primary];
    } else if (has(alias)) {
      out[primary] = out[alias];
    }
  }

  if (typeof out.language === 'string') {
    const lowLang = out.language.trim().toLowerCase().replace(/_/g, '-');
    if (lowLang === 'yue' || lowLang.startsWith('yue-') || lowLang === 'zh-yue' || lowLang.includes('cantonese')) {
      out.language = 'zh-CN';
      out.lang = 'zh-CN';
    }
  }

  const isFalseLike = (v) =>
    v === false || (typeof v === 'string' && /^(?:off|false)$/i.test(v.trim()));
  for (const [boolKey, onOffKey] of BOOL_ON_OFF_ALIAS_PAIRS) {
    if (has(boolKey)) {
      const on = !isFalseLike(out[boolKey]);
      out[boolKey] = on;
      out[onOffKey] = on ? 'on' : 'off';
    } else if (has(onOffKey)) {
      const on = !isFalseLike(out[onOffKey]);
      out[boolKey] = on;
      out[onOffKey] = on ? 'on' : 'off';
    }
  }

  if (has('convRipple')) {
    const rawCr = out.convRipple;
    if (rawCr === true) {
      out.convRipple = 'medium';
    } else if (rawCr === false) {
      out.convRipple = 'off';
    } else if (typeof rawCr === 'string') {
      const lowCr = rawCr.trim().toLowerCase();
      if (lowCr === 'true' || lowCr === 'on') out.convRipple = 'medium';
      else if (lowCr === 'false' || lowCr === 'off') out.convRipple = 'off';
      else if (lowCr === 'subtle' || lowCr === 'medium' || lowCr === 'full') out.convRipple = lowCr;
    }
  }

  for (const [key, mode] of STRING_BOOL_COERCIONS) {
    if (has(key) && typeof out[key] === 'string') {
      out[key] =
        mode === 'strictOn'
          ? out[key] === 'on' || out[key] === 'true'
          : out[key] !== 'off' && out[key] !== 'false';
    }
  }

  for (const key of BOOL_TO_ON_OFF_KEYS) {
    if (has(key) && typeof out[key] === 'boolean') {
      out[key] = out[key] ? 'on' : 'off';
    }
  }

  for (const [key, map] of LEGACY_VALUE_MAPS) {
    if (has(key) && typeof out[key] === 'string' && Object.prototype.hasOwnProperty.call(map, out[key])) {
      out[key] = map[out[key]];
    }
  }

  if (has('mascot') && typeof out.mascot === 'string') {
    const normMascot = normalizeMascotConfigValue(out.mascot);
    if (normMascot !== null) out.mascot = normMascot;
  }

  for (const strKey of ['chatFontCustom', 'codeFontCustom']) {
    if (has(strKey)) {
      const maxLen = CONFIG_SCHEMA[strKey].maxLength || 160;
      out[strKey] = typeof out[strKey] === 'string' ? out[strKey].replace(/[\0\r\n]/g, '').slice(0, maxLen) : '';
    }
  }

  if (rawPerfAuto) _autoPerfModeConfigs.add(out);
  return out;
}

module.exports = {
  STYLE_ID,
  LEGACY_STYLE_ID,
  SETTING_BINDING,
  LEGACY_SETTING_BINDING,
  OMNI_BINDING,
  SIDEBAR_BINDING,
  INLINE_DIFF_BINDING,
  WALLPAPER_BINDING,
  SUGGESTER_BINDING,
  CONFIG_SCHEMA,
  DEFAULT_CONFIG,
  VALIDATORS,
  normalizeMascotConfigValue,
  validateConfigEntry,
  isPerformanceModeExplicit,
  wasPerformanceModeAuto,
  reconcileConfigAliases,
};
