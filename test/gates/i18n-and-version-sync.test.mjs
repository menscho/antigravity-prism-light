import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { checkVersionSync } from '../../scripts/bump-version.mjs';
import { WORKBENCH_I18N } from '../../vendor/omni-viewer/workbench-page.mjs';
import {
  GREETING_POOLS,
  HERO_GREETING_POOLS,
  normalizeGreetingLang,
} from '../../vendor/sidebar-studio/state-machine.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const i18nCore = require(path.join(ROOT, 'i18n-core.js'));
const i18nLocales = require(path.join(ROOT, 'i18n-locales.js'));

const CANONICAL_9_LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'tr'];
const NON_CJK_LOCALES = ['en', 'ko', 'es', 'fr', 'de', 'tr'];
const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;
const FORBIDDEN_TERM_RE = /八方旅人|octopath/i;

function listRepoFiles() {
  try {
    const out = execFileSync('git', ['ls-files'], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && fs.existsSync(path.join(ROOT, s)));
  } catch {
    return [];
  }
}

test('Law 9a: Full 9-locale completeness, 0 CJK in non-CJK locales, 0 standalone yue dictionaries, legacy yue->zh-CN migration', () => {
  // 1) Core i18n-core.js + i18n-locales.js
  assert.deepEqual(
    i18nCore.LANG_OPTIONS.map((o) => o.id),
    CANONICAL_9_LOCALES,
    'i18n-core LANG_OPTIONS must match the canonical 9 locales'
  );
  assert.equal(i18nCore.normalizeLanguage('yue'), 'zh-CN');
  assert.equal(i18nCore.normalizeLanguage('zh-yue'), 'zh-CN');
  assert.equal(i18nCore.normalizeLanguage('tr-TR'), 'tr');

  const zhKeys = Object.keys(i18nLocales.getUiStrings('zh-CN'));
  for (const loc of CANONICAL_9_LOCALES) {
    const dict = i18nLocales.getUiStrings(loc);
    for (const k of zhKeys) {
      const rawVal = dict[k];
      const rendered = typeof rawVal === 'function' ? String(rawVal(3, 5)) : rawVal;
      assert.ok(typeof rendered === 'string' && rendered.length > 0, `i18n-locales[${loc}].${k} must be non-empty`);
      if (NON_CJK_LOCALES.includes(loc)) {
        assert.equal(
          CJK_RE.test(rendered),
          false,
          `i18n-locales[${loc}].${k} must contain 0 CJK chars: "${rendered}"`
        );
      }
    }
  }

  // 2) Omni Workbench 9-column table (zero yue column)
  for (const [k, row] of Object.entries(WORKBENCH_I18N)) {
    assert.equal(row.length, CANONICAL_9_LOCALES.length, `WORKBENCH_I18N.${k} must have exactly 9 locale columns`);
    for (let i = 0; i < CANONICAL_9_LOCALES.length; i++) {
      const loc = CANONICAL_9_LOCALES[i];
      assert.ok(typeof row[i] === 'string' && row[i].length > 0, `WORKBENCH_I18N.${k}[${loc}] must be non-empty`);
      if (NON_CJK_LOCALES.includes(loc)) {
        assert.equal(CJK_RE.test(row[i]), false, `WORKBENCH_I18N.${k}[${loc}] must contain 0 CJK chars: "${row[i]}"`);
      }
    }
  }

  // 3) Sidebar Studio greeting pools (9 locales, zero standalone yue, legacy yue -> zh-CN)
  assert.equal(GREETING_POOLS.yue, undefined, 'GREETING_POOLS must not contain standalone yue');
  assert.equal(HERO_GREETING_POOLS.yue, undefined, 'HERO_GREETING_POOLS must not contain standalone yue');
  assert.equal(normalizeGreetingLang('yue'), 'zh-CN');
  assert.equal(normalizeGreetingLang('zh-yue'), 'zh-CN');
  assert.equal(normalizeGreetingLang('tr-TR'), 'tr');
  for (const loc of CANONICAL_9_LOCALES) {
    assert.ok(GREETING_POOLS[loc]?.withUser?.length > 0, `GREETING_POOLS[${loc}].withUser missing`);
    assert.ok(HERO_GREETING_POOLS[loc]?.headlines?.length > 0, `HERO_GREETING_POOLS[${loc}].headlines missing`);
    if (NON_CJK_LOCALES.includes(loc)) {
      const texts = [
        ...GREETING_POOLS[loc].withUser,
        ...GREETING_POOLS[loc].anonymous,
        ...HERO_GREETING_POOLS[loc].eyebrowWithUser,
        ...HERO_GREETING_POOLS[loc].eyebrowAnonymous,
        ...HERO_GREETING_POOLS[loc].headlines,
      ];
      for (const s of texts) {
        assert.equal(CJK_RE.test(s), false, `Sidebar greeting [${loc}] leaked CJK: "${s}"`);
      }
    }
  }

  // 4) Sidebar client & workbench studio UI have no standalone yue dictionary/option
  const sidebarClientSrc = fs.readFileSync(path.join(ROOT, 'vendor/sidebar-studio/sidebar-client.js'), 'utf8');
  assert.equal(/^\s*['"]?yue['"]?\s*:/m.test(sidebarClientSrc), false, 'sidebar-client.js must not declare standalone yue dictionary');
  const studioHtml = fs.readFileSync(path.join(ROOT, 'workbench/studio.html'), 'utf8');
  assert.equal(/value="yue"/i.test(studioHtml), false, 'workbench/studio.html must not expose yue dropdown option');
});

test('Law 9b: Zero forbidden third-party game terms across all user-facing docs, metadata, UI copy, locales & src/', () => {
  const tracked = listRepoFiles();
  // Legacy internal physical filename & teardown global bridge symbols preserved solely for backward-compatible loading/cleanup
  const LEGACY_INTERNAL_SYMBOL_RE = /octopath-stage-webgl\.js|__agOctopath(?:StageWebGL|TavernAtlas)\b/g;
  const userFacingTargets = new Set([
    'README.md',
    'README.en.md',
    'CHANGELOG.md',
    'CITATION.cff',
    'package.json',
    'plugin.json',
    'i18n-core.js',
    'i18n-locales.js',
    'settings-panel.js',
    'ui-runtime.js',
    'home-studio-panel.js',
    'context-menu-btw.js',
    'vendor/omni-viewer/workbench-page.mjs',
    'vendor/sidebar-studio/state-machine.mjs',
    'vendor/sidebar-studio/sidebar-client.js',
  ]);
  for (const rel of tracked) {
    if (
      rel.startsWith('src/') ||
      rel.startsWith('docs/') ||
      rel.startsWith('.github/') ||
      rel.startsWith('installer/') ||
      (rel.startsWith('vendor/host-i18n/') && rel.endsWith('.json')) ||
      (rel.startsWith('workbench/') && rel.endsWith('.html'))
    ) {
      userFacingTargets.add(rel);
    }
  }

  const hits = [];
  for (const rel of [...userFacingTargets].sort()) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    if (!/\.(?:md|json|mjs|cjs|js|html|cff|cs|swift|txt|yml|yaml|manifest)$/i.test(rel)) continue;
    const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      const scrubbed = line.replace(LEGACY_INTERNAL_SYMBOL_RE, '');
      if (FORBIDDEN_TERM_RE.test(scrubbed)) {
        hits.push(`${rel}:${idx + 1}: ${line.trim().slice(0, 100)}`);
      }
    });
  }

  assert.deepEqual(hits, [], `Forbidden terminology detected in user-facing/src files:\n${hits.join('\n')}`);
});

test('Law 3: Single version SSOT (package.json#version) matches all static anchors & CHANGELOG hygiene', () => {
  const result = checkVersionSync(ROOT);
  assert.equal(
    result.ok,
    true,
    `Version SSOT sync failed (${result.version}):\n${result.errors.join('\n')}`
  );
  // LIGHT (2026-11-27): 14, the build-installer.mjs anchor went with the script
  assert.ok(result.checked.length >= 14, `Expected >= 14 version anchors verified, got ${result.checked.length}`);
});
