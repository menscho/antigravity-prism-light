// Antigravity 宿主弹性选择器注册表与只读兼容探针回归单测
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  parseHtmlToReadonlyDoc,
  runSnapshotProbe,
  formatCompatReport,
} from '../scripts/probe-host-compat.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const selectorsMod = require(path.join(ROOT_DIR, 'src', 'compat', 'host-selectors.cjs'));

const REQUIRED_CONTRACT_IDS = [
  'sidebarSplit',
  'hoverCardPortal',
  'modelSelectorTrigger',
  'modelSelectorPanel',
  'composerFooter',
  'composerEditor',
  'conversationView',
  'autoscrollViewport',
  'overviewPanelHost',
  'chatBackdropChain',
  'stepPlan',
  'sideQuestionButton',
  'mainContentBody',
];

function buildFullPrimarySnapshotHtml() {
  return `<!doctype html>
<html>
<head><title>Antigravity Workspace</title></head>
<body class="theme-standalone">
  <div class="agy-shell">
    <div data-testid="sidebar-split"></div>
    <div data-testid="pane-titlebar-toolbar"></div>
    <main data-testid="main-content-body">
      <div data-testid="conversation-view">
        <div data-testid="autoscroll-viewport">
          <div data-testid="step-plan"></div>
        </div>
        <div data-testid="agent-input-box">
          <div data-testid="composer-footer">
            <button data-testid="model-selector-trigger">Model</button>
            <button data-testid="side-question-button">/btw</button>
          </div>
        </div>
      </div>
    </main>
    <aside data-testid="overview-panel-host"></aside>
  </div>
  <div data-radix-popper-content-wrapper>
    <div data-testid="model-selector-panel"></div>
  </div>
</body>
</html>`;
}

test('HOST_SELECTOR_CONTRACTS 注册表完整性：覆盖全部 13 条核心契约及三层元数据规范', () => {
  const contracts = selectorsMod.HOST_SELECTOR_CONTRACTS;
  assert.ok(Array.isArray(contracts) && contracts.length >= REQUIRED_CONTRACT_IDS.length);

  const byId = new Map();
  for (const c of contracts) {
    assert.equal(typeof c.id, 'string');
    assert.ok(c.id.length > 0 && !byId.has(c.id), `Duplicate or empty contract id: ${c.id}`);
    byId.set(c.id, c);

    assert.ok(['critical', 'major', 'optional'].includes(c.tier), `Invalid tier on ${c.id}: ${c.tier}`);
    assert.ok(['shell', 'conversation', 'overlay'].includes(c.scope), `Invalid scope on ${c.id}: ${c.scope}`);
    assert.ok(Array.isArray(c.affectedModules) && c.affectedModules.length > 0, `${c.id} missing affectedModules`);
    assert.equal(typeof c.primary?.selector, 'string');
    assert.ok(c.primary.selector.length > 0, `${c.id} missing primary selector`);
    assert.equal(typeof c.fallback?.selector, 'string');
    assert.ok(c.fallback.selector.length > 0, `${c.id} missing fallback selector`);
    assert.equal(typeof c.structural?.selector, 'string');
    assert.ok(c.structural.selector.length > 0, `${c.id} missing structural selector`);
    assert.equal(c.structural.fragile, true, `${c.id} structural fallback must be flagged fragile: true`);
    assert.match(c.sinceHostVersion, /^\d+\.\d+\.\d+$/, `${c.id} invalid sinceHostVersion`);
  }

  for (const id of REQUIRED_CONTRACT_IDS) {
    assert.ok(byId.has(id), `HOST_SELECTOR_CONTRACTS missing required contract: ${id}`);
  }
});

test('evaluateSelectorsInDoc 精准区分 OK / FALLBACK_ONLY / BROKEN_CRITICAL 三态', () => {
  // 1) 全量主锚点命中 -> OK
  const okDoc = parseHtmlToReadonlyDoc(buildFullPrimarySnapshotHtml());
  const okReport = selectorsMod.evaluateSelectorsInDoc(okDoc);
  assert.equal(okReport.overallStatus, 'OK');
  assert.equal(okReport.counts.primary, selectorsMod.HOST_SELECTOR_CONTRACTS.length);
  assert.equal(okReport.counts.brokenCritical, 0);

  // 2) 主锚点消失但命中 fallback 或 structural（critical/major）-> FALLBACK_ONLY
  const fallbackHtml = buildFullPrimarySnapshotHtml()
    .replace('data-testid="model-selector-trigger"', 'aria-haspopup="listbox" aria-label="Select Model"')
    .replace('data-testid="autoscroll-viewport"', 'class="overflow-y-auto"');
  const fbDoc = parseHtmlToReadonlyDoc(fallbackHtml);
  const fbReport = selectorsMod.evaluateSelectorsInDoc(fbDoc);
  assert.equal(fbReport.overallStatus, 'FALLBACK_ONLY');
  assert.equal(fbReport.counts.brokenCritical, 0);
  const triggerRow = fbReport.results.find((r) => r.id === 'modelSelectorTrigger');
  assert.equal(triggerRow.status, 'FALLBACK_ONLY');
  assert.equal(triggerRow.matchedLayer, 'fallback');
  assert.equal(triggerRow.fragile, false);
  const scrollRow = fbReport.results.find((r) => r.id === 'autoscrollViewport');
  assert.equal(scrollRow.status, 'FALLBACK_ONLY');
  assert.equal(scrollRow.matchedLayer, 'structural');
  assert.equal(scrollRow.fragile, true);

  // 3) 关键 critical 契约（conversationView）三层全失联 -> BROKEN_CRITICAL
  const brokenHtml = buildFullPrimarySnapshotHtml()
    .replace('data-testid="conversation-view"', 'data-unrelated="1"');
  const brDoc = parseHtmlToReadonlyDoc(brokenHtml);
  const brReport = selectorsMod.evaluateSelectorsInDoc(brDoc);
  assert.equal(brReport.overallStatus, 'BROKEN_CRITICAL');
  assert.ok(brReport.counts.brokenCritical >= 1);
  const convRow = brReport.results.find((r) => r.id === 'conversationView');
  assert.equal(convRow.status, 'BROKEN_CRITICAL');
  assert.equal(convRow.matchedLayer, 'none');
});

test('buildLiveProbeExpression 语法合法且严格保持零写入/零点击/零副作用', () => {
  const expr = selectorsMod.buildLiveProbeExpression();
  assert.equal(typeof expr, 'string');
  assert.ok(expr.length > 200);
  assert.doesNotThrow(() => new vm.Script(expr), 'buildLiveProbeExpression() must compile cleanly');

  // 静态断言：零写 DOM / 零交互 API 调用
  for (const forbidden of [
    '.click(',
    '.focus(',
    '.dispatchEvent(',
    '.setAttribute(',
    '.removeAttribute(',
    '.appendChild(',
    '.remove(',
    'innerHTML',
    'outerHTML',
    'insertAdjacentHTML',
  ]) {
    assert.equal(expr.includes(forbidden), false, `Live probe expression must not contain side-effect call: ${forbidden}`);
  }

  // 在隔离沙盒中实际运行，验证只读调用与 bounding-box 采集
  let writeAttempts = 0;
  const fakeEl = {
    getBoundingClientRect() {
      return { x: 12.4, y: 24.6, width: 320.2, height: 48.8 };
    },
    click() { writeAttempts += 1; },
    setAttribute() { writeAttempts += 1; },
  };
  const sandbox = {
    document: {
      title: 'Antigravity - Main',
      documentElement: { getAttribute: () => '1.0.8-beta.3', setAttribute: () => { writeAttempts += 1; } },
      querySelectorAll(sel) {
        return sel.includes('data-testid') || sel.includes('.agy-shell') || sel.includes('data-radix-popper') ? [fakeEl] : [];
      },
    },
    location: { protocol: 'vscode-file:' },
    navigator: { userAgent: 'Mozilla/5.0 Antigravity/2.35.1 Electron/34.0' },
  };
  const liveRes = vm.runInNewContext(expr, sandbox);
  assert.equal(writeAttempts, 0, 'Live probe must cause 0 DOM mutations or clicks');
  assert.equal(liveRes.overallStatus, 'OK');
  assert.equal(liveRes.total, selectorsMod.HOST_SELECTOR_CONTRACTS.length);
  assert.equal(liveRes.host.userAgent, 'Mozilla/5.0 Antigravity/2.35.1 Electron/34.0');
  assert.deepEqual({ ...liveRes.results[0].sampleRect }, { x: 12, y: 25, width: 320, height: 49 });
  assert.equal(liveRes.results[0].visibleCount, 1);
});

test('scripts/probe-host-compat.mjs CLI 对 workbench/replica.html 与破损快照的实跑与退出码契约', () => {
  // 1) 直接实跑仓库内真实静态外壳快照 workbench/replica.html
  const replicaPath = path.join(ROOT_DIR, 'workbench', 'replica.html');
  const rep = runSnapshotProbe(replicaPath);
  assert.equal(rep.overallStatus, 'OK', `workbench/replica.html expected OK, got:\n${formatCompatReport(rep)}`);
  assert.ok(rep.counts.primary >= 4, 'workbench/replica.html must hit primary anchors for shell contracts');
  assert.equal(rep.counts.brokenCritical, 0);

  // 2) CLI --json 模式实跑 workbench/replica.html（exit 0）
  const stdout = execFileSync(
    process.execPath,
    [path.join(ROOT_DIR, 'scripts', 'probe-host-compat.mjs'), '--snapshot', replicaPath, '--json'],
    { cwd: ROOT_DIR, encoding: 'utf8', windowsHide: true }
  );
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.overallStatus, 'OK');
  assert.equal(parsed.source, 'snapshot');
  assert.equal(parsed.results.length, selectorsMod.HOST_SELECTOR_CONTRACTS.length);

  // 3) 破损快照（外壳关键锚点全部丢失）CLI 必须返回退出码 2 + BROKEN_CRITICAL
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-compat-probe-'));
  try {
    const brokenPath = path.join(tmpDir, 'broken.html');
    fs.writeFileSync(brokenPath, '<!doctype html><html><body><div>empty</div></body></html>\n', 'utf8');
    let exitCode = 0;
    let capturedOut = '';
    try {
      execFileSync(
        process.execPath,
        [path.join(ROOT_DIR, 'scripts', 'probe-host-compat.mjs'), '--snapshot', brokenPath, '--json'],
        { cwd: ROOT_DIR, encoding: 'utf8', windowsHide: true }
      );
    } catch (err) {
      exitCode = err.status;
      capturedOut = String(err.stdout || '');
    }
    assert.equal(exitCode, 2, 'BROKEN_CRITICAL snapshot must exit with code 2');
    const brokenJson = JSON.parse(capturedOut);
    assert.equal(brokenJson.overallStatus, 'BROKEN_CRITICAL');
    assert.ok(brokenJson.counts.brokenCritical >= 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 4) package.json 已注册 compat:probe 且 docs/host-compat/matrix.md 存在且记录 v2.33/v2.34/v2.35
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['compat:probe'], 'node scripts/probe-host-compat.mjs');
  const matrixDoc = fs.readFileSync(path.join(ROOT_DIR, 'docs', 'host-compat', 'matrix.md'), 'utf8');
  assert.ok(matrixDoc.includes('v2.33') && matrixDoc.includes('v2.34') && matrixDoc.includes('v2.35'));
  assert.ok(matrixDoc.includes('2 个次版本'));
});
