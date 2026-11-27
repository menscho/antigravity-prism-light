import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const cdp = require(path.join(ROOT, 'cdp.js'));

const CH1_HARD_LIMIT = 390000;
const BRIDGE_HARD_LIMIT = 31000;
const CONFIG_REFRESH_HARD_LIMIT = 4096;
const TARGET_LOCALES = ['auto', 'zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'tr'];

function listTrackedFiles() {
  try {
    const tracked = execFileSync('git', ['ls-files'], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return [...new Set([...tracked.split(/\r?\n/), ...untracked.split(/\r?\n/)])]
      .map((s) => s.trim())
      .filter((s) => s && fs.existsSync(path.join(ROOT, s)));
  } catch {
    const out = [];
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === '.git' || ent.name === 'node_modules' || ent.name === 'dist') continue;
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(abs);
        else if (ent.isFile()) out.push(path.relative(ROOT, abs).replace(/\\/g, '/'));
      }
    };
    walk(ROOT);
    return out;
  }
}

test('Law 4: Channel 1 (auto + 9 locales) < 390,000 B, pulse-vial-bridge.js < 31,000 B, incremental configRefresh < 4,096 B', () => {
  const summary = [];
  for (const locale of TARGET_LOCALES) {
    const expr = cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, language: locale });
    const bytes = Buffer.byteLength(expr, 'utf8');
    summary.push(`${locale}=${bytes}B`);
    assert.ok(
      bytes < CH1_HARD_LIMIT,
      `Channel 1 [${locale}] payload ${bytes} B exceeds hard limit ${CH1_HARD_LIMIT} B`
    );
  }

  const bridgeBytes = fs.statSync(path.join(ROOT, 'pulse-vial-bridge.js')).size;
  assert.ok(
    bridgeBytes < BRIDGE_HARD_LIMIT,
    `pulse-vial-bridge.js ${bridgeBytes} B exceeds hard limit ${BRIDGE_HARD_LIMIT} B`
  );

  // Incremental configRefresh without language-slice rebuild must stay lightweight (< 4 KiB)
  const refreshExpr = cdp.buildConfigRefreshExpression({ palette: 'warm' });
  const refreshBytes = Buffer.byteLength(refreshExpr, 'utf8');
  assert.ok(
    refreshBytes < CONFIG_REFRESH_HARD_LIMIT,
    `Incremental configRefresh payload ${refreshBytes} B exceeds hard limit ${CONFIG_REFRESH_HARD_LIMIT} B`
  );

  console.log(
    `[bundle-budget] Ch1: ${summary.join(', ')} | pulse-vial-bridge.js=${bridgeBytes}B | configRefresh=${refreshBytes}B`
  );
});

test('Law 4+: Declarative CHANNEL_REGISTRY multi-channel payloads stay within per-channel budgets', () => {
  assert.ok(Array.isArray(cdp.CHANNEL_REGISTRY) && cdp.CHANNEL_REGISTRY.length >= 16, 'CHANNEL_REGISTRY must cover all 16 delayed/on-demand channels');
  const seenIds = new Set();
  for (const ch of cdp.CHANNEL_REGISTRY) {
    assert.equal(typeof ch.id, 'string');
    assert.ok(ch.id.length > 0 && !seenIds.has(ch.id), `Duplicate or empty channel id: ${ch.id}`);
    seenIds.add(ch.id);
    assert.ok(Array.isArray(ch.configKeys), `Channel ${ch.id} must declare configKeys array`);
    assert.ok(Array.isArray(ch.files) && ch.files.length > 0, `Channel ${ch.id} must declare non-empty files array`);
    assert.ok(Number.isInteger(ch.budgetBytes) && ch.budgetBytes > 0, `Channel ${ch.id} must declare positive integer budgetBytes`);
    assert.equal(typeof ch.shouldEnable, 'function', `Channel ${ch.id} must declare shouldEnable()`);
    assert.equal(typeof ch.build, 'function', `Channel ${ch.id} must declare build()`);
    assert.equal(typeof ch.teardown, 'string');
    assert.ok(ch.teardown.length > 0, `Channel ${ch.id} must declare non-empty teardown expression`);
  }

  const allEnabledCfg = {
    ...cdp.DEFAULT_CONFIG,
    omniModule: 'on',
    sidebarStudio: 'on',
    hostLocalization: 'on',
    thoughtTranslate: 'ai',
    periodicModelPicker: 'on',
    mascot: 'crab',
    homeLayout: 'studio',
    telemetryModule: 'auto',
    effortSliderModule: 'on',
    contextMenu: true,
    sidebarNavFold: true,
    scrollBottomMotion: 'on',
    sidebarRestyle: true,
  };
  const report = cdp.getChannelBudgetReport(allEnabledCfg, { noDiskCache: true });
  assert.equal(report.ok, true, `Over-budget channels: ${report.overBudgetChannels.join(', ')}`);
  const lines = [];
  for (const ch of report.channels) {
    assert.equal(ch.enabled, true, `Channel ${ch.id} expected enabled under allEnabledCfg`);
    assert.ok(ch.bytes > 0, `Channel ${ch.id} compiled to 0 B unexpectedly`);
    assert.ok(
      ch.bytes <= ch.budgetBytes,
      `Channel ${ch.id} payload ${ch.bytes} B exceeds budgetBytes ${ch.budgetBytes} B`
    );
    lines.push(`${ch.id}=${ch.bytes}B/${ch.budgetBytes}B`);
  }

  // 4 条 Phase 3B 下沉通道在关闭态必须 0 编译 / 0 注入（0 B）
  const offloadedDisabledCfg = {
    ...cdp.DEFAULT_CONFIG,
    telemetryModule: 'off',
    effortSliderModule: 'off',
    sidebarNavFold: 'off',
    scrollBottomMotion: 'instant',
    sidebarRestyle: false,
    motionLevel: 'off',
    contextMenu: false,
  };
  const offReport = cdp.getChannelBudgetReport(offloadedDisabledCfg, { noDiskCache: true });
  for (const id of ['telemetry', 'effortSlider', 'workbenchEnhancer', 'contextMenu']) {
    const ch = cdp.findChannel(id);
    assert.ok(ch, `Offloaded channel ${id} must be registered`);
    assert.equal(ch.shouldEnable(offloadedDisabledCfg), false, `${id} shouldEnable must be false when gated off`);
    assert.equal(ch.build(offloadedDisabledCfg, { noDiskCache: true }), '', `${id} build must return empty string when gated off`);
    const row = offReport.channels.find((c) => c.id === id);
    assert.equal(row.enabled, false);
    assert.equal(row.bytes, 0);
  }
  const trI18nCfg = { ...allEnabledCfg, language: 'tr', hostLocalization: 'on' };
  for (const id of ['hostI18n', 'swarmI18n']) {
    const ch = cdp.findChannel(id);
    assert.ok(ch, `Channel ${id} must be registered`);
    assert.equal(ch.shouldEnable(trI18nCfg), true, `${id} shouldEnable must be true for tr`);
    const expr = ch.build(trI18nCfg, { noDiskCache: true });
    const bytes = Buffer.byteLength(expr, 'utf8');
    assert.ok(bytes > 0 && bytes <= ch.budgetBytes, `Channel ${id}[tr] payload ${bytes} B exceeds budgetBytes ${ch.budgetBytes} B`);
    lines.push(`${id}[tr]=${bytes}B/${ch.budgetBytes}B`);
  }

  console.log(`[bundle-budget] Channels (${report.channels.length}): ${lines.join(', ')}`);
});

test('Law 10: Tracked core text files enforce strict 0 UTF-8 BOM and 0 CRLF line endings', () => {
  const tracked = listTrackedFiles();
  const coreTextRe = /\.(?:mjs|cjs|js|css|json|md|yml|yaml|cff|manifest|cs|swift|html|svg|txt)$/i;
  const bomViolations = [];
  const crlfViolations = [];

  for (const rel of tracked) {
    if (!coreTextRe.test(rel)) continue;
    const buf = fs.readFileSync(path.join(ROOT, rel));
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      bomViolations.push(rel);
    }
    if (buf.includes(0x0d)) {
      crlfViolations.push(rel);
    }
  }

  assert.deepEqual(bomViolations, [], `UTF-8 BOM detected in tracked text file(s): ${bomViolations.join(', ')}`);
  assert.deepEqual(crlfViolations, [], `CRLF line endings detected in tracked text file(s): ${crlfViolations.join(', ')}`);
});
