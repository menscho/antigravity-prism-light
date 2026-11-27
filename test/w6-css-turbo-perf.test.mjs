import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const CSS_PATH = path.join(ROOT, 'style.css');
const { minifyCss, flattenNestedCss, splitCssIntoBuckets } = require(path.join(ROOT, 'src', 'compiler', 'css-pack.cjs'));
const cdp = require(path.join(ROOT, 'cdp.js'));

const rawBuf = fs.readFileSync(CSS_PATH);
const rawCss = rawBuf.toString('utf8');
const cssLines = rawCss.split('\n');
const flatCss = minifyCss(flattenNestedCss(minifyCss(rawCss)));

function extractRulesForSelector(cssText, token) {
  const matched = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cssText.length; i++) {
    const ch = cssText[i];
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const rule = cssText.slice(start, i + 1);
        const braceIdx = rule.indexOf('{');
        if (braceIdx > 0 && rule.slice(0, braceIdx).includes(token)) {
          matched.push({ selector: rule.slice(0, braceIdx), body: rule.slice(braceIdx + 1, -1), raw: rule });
        }
        start = i + 1;
      }
    }
  }
  return matched;
}

test('W7-1: 5 core overlays restore frosted-glass backdrop-filter while disabling blur only in performance/motion=off with 0 scroll/stream flicker', () => {
  const restoredGlassTokens = [
    '[data-ag-cs-overview-shell="1"]',
    '.animate-overview-panel',
    '.aux-drawer-popup',
    '.agy-toast',
    '.toast-root',
    '.ag-cs-nav-outline-popover',
    '[data-testid="side-question-panel"]',
    '.agy-fastpick',
    '[data-testid="fastpick"]',
    '[data-testid="slash-command-menu"]',
    '.quick-input-widget',
    '[data-peek-surface]',
    '.floating-comment-card',
  ];

  for (const token of restoredGlassTokens) {
    const rules = extractRulesForSelector(flatCss, token);
    assert.ok(rules.length > 0, `flattened CSS must style ${token}`);
    assert.ok(
      rules.some((r) => /backdrop-filter\s*:\s*blur\(16px\)/i.test(r.body)),
      `core overlay ${token} must restore frosted-glass backdrop-filter:blur(16px)`
    );
  }

  // Lightweight menus also keep frosted-glass blur(16px)
  const ctxMenuRules = extractRulesForSelector(flatCss, '.ag-cs-ctx-menu');
  assert.ok(
    ctxMenuRules.some((r) => r.body.includes('backdrop-filter:blur(16px) saturate(140%)')),
    '.ag-cs-ctx-menu must preserve backdrop-filter:blur(16px) saturate(140%)'
  );
  const lightMenuRules = extractRulesForSelector(flatCss, '[data-testid="context-menu-popup"]');
  assert.ok(
    lightMenuRules.some((r) => r.body.includes('backdrop-filter:blur(16px)')),
    'lightweight context-menu-popup group must preserve backdrop-filter:blur(16px)'
  );

  // Blur degradation is strictly scoped to performance / motion="off" (NEVER transient perf-busy / stream-active / scrolling / win-blur)
  const blurDegradeLine = cssLines.find(
    (l) =>
      l.includes(':is([data-ag-cs-perf-mode="performance"],[data-ag-cs-motion="off"])') &&
      l.includes('backdrop-filter:none!important')
  );
  assert.ok(blurDegradeLine, 'style.css must disable backdrop-filter in performance and motion="off" modes');
  for (const token of restoredGlassTokens) {
    assert.ok(
      blurDegradeLine.includes(token),
      `performance/motion="off" blur degradation rule must cover ${token}`
    );
  }
  assert.ok(
    blurDegradeLine.includes('.agy-selection-pill') && blurDegradeLine.includes('.agy-scroll-bottom'),
    'performance/motion="off" blur degradation rule must cover floating pills and scroll-bottom button'
  );

  // Zero transient scroll/stream/win-blur backdrop-filter:none flicker triggers anywhere in style.css
  const blurNoneLines = cssLines.filter((l) => /backdrop-filter\s*:\s*none/i.test(l));
  for (const line of blurNoneLines) {
    assert.equal(line.includes('data-ag-perf-busy'), false, `must not strip blur on perf-busy: ${line.slice(0, 160)}`);
    assert.equal(line.includes('data-ag-cs-stream-active'), false, `must not strip blur on stream-active: ${line.slice(0, 160)}`);
    assert.equal(line.includes('data-ag-scrolling'), false, `must not strip blur on scrolling: ${line.slice(0, 160)}`);
    assert.equal(line.includes('data-ag-cs-win-blur'), false, `must not strip blur on win-blur: ${line.slice(0, 160)}`);
  }
});

test('W7-2: default animations restore smooth GPU linear/ease-in-out (0 low-FPS steps()) and win-blur freeze is scoped strictly to performance/eco', () => {
  // Default animations must be smooth (strictly 0 steps() anywhere in style.css; mini-crab aligns to TICK=100ms with linear)
  const stepLines = cssLines.filter((l) => /steps\(/i.test(l));
  assert.equal(stepLines.length, 0, `style.css must have strictly 0 steps() usages, found: ${stepLines.join(' | ')}`);
  const miniCrabLine = cssLines.find((l) => l.includes('.ag-v2-mini-crab-canvas{')) || '';
  assert.ok(
    miniCrabLine.includes('transition:transform .1s linear'),
    '.ag-v2-mini-crab-canvas must align to TICK=100ms with smooth transition:transform .1s linear'
  );

  // Explicit smooth timing checks on restored running & skeleton animations
  assert.ok(rawCss.includes('animation:ag-ov-br 4s ease-in-out infinite'), 'ag-ov-br must use smooth ease-in-out');
  assert.ok(rawCss.includes('animation:ag-cs-pulse 2.8s ease-in-out infinite'), 'sub-running pulse must use smooth ease-in-out');
  assert.ok(rawCss.includes('animation:ag-cs-pulse 1.5s ease-in-out infinite'), 'home skeleton pulse must use smooth ease-in-out');
  assert.ok(rawCss.includes('animation:ag-cs-orbit-spin 1.9s linear infinite'), 'input-cancel-button orbit must use smooth linear');
  assert.ok(rawCss.includes('animation:ag-cs-spark-orbit 2.4s ease-in-out infinite'), 'thinking spark orbit must use smooth ease-in-out');
  assert.ok(rawCss.includes('animation:ag-cs-orbit-spin 2.4s linear infinite'), 'status-loading-spinner orbit must use smooth linear');
  assert.ok(rawCss.includes('animation:ag-st-p 2.2s ease-in-out infinite !important'), 'status-loading-spinner core dot must use smooth ease-in-out');
  assert.ok(rawCss.includes('animation:ag-cs-comet-tip 1.1s ease-in-out infinite'), 'thought streaming comet tip must use smooth ease-in-out');

  // Performance mode retains power-saving ambient disable without choppy low-FPS steps()
  const perfModeLine = cssLines.find(
    (l) => l.includes('[data-ag-cs-perf-mode="performance"]') && l.includes('[data-ag-overview-running="1"]')
  );
  assert.ok(perfModeLine, 'performance mode must disable ambient breathing on overview & step-plan');
  assert.ok(
    perfModeLine.includes('[data-ag-sp-running="1"]') && perfModeLine.includes('animation:none!important'),
    'performance mode must disable ag-ov-br breathing animation on overview & step-plan'
  );

  // win-blur & pp-open CSS animation pause is scoped strictly to performance/eco so dual-screen default mode stays alive
  const winBlurLine = cssLines.find(
    (l) => l.includes('[data-ag-cs-win-blur="1"]') && l.includes('animation-play-state:paused')
  );
  assert.ok(winBlurLine, 'style.css must define performance/eco win-blur animation-play-state:paused rule');
  assert.ok(
    winBlurLine.includes(
      'html[data-ag-cs-style]:is([data-ag-cs-win-blur="1"],[data-ag-pp-open="1"]):is([data-ag-cs-perf-mode="performance"],[data-ag-cs-perf-mode="eco"])'
    ),
    'win-blur animation pause must be scoped strictly to performance/eco modes'
  );
  const requiredPausedSelectors = [
    '.shimmer-text-mask',
    '.shimmer-text-content',
    '.animate-spin',
    '.animate-pulse',
    '.animate-bounce',
    '[class*="agentStateCaret"]',
    '[data-ag-cs-sonar="1"]',
    '[data-ag-overview-running="1"]::after',
    '[data-ag-sp-running="1"]::after',
    '[data-ag-sub-running="1"]::before',
    '[data-testid="status-loading-spinner"]::before',
  ];
  for (const sel of requiredPausedSelectors) {
    assert.ok(winBlurLine.includes(sel), `performance/eco win-blur rule must still pause ${sel}`);
  }
  assert.equal(
    /:is\([^)]*::(?:before|after)/.test(rawCss),
    false,
    'style.css must never put ::before or ::after inside :is(...)'
  );
});

test('W7-3: sticky-breaking whole-turn/pre contain-intrinsic-block-size virtualization is removed while preserving legacy bleed guards', () => {
  // Wave 6 whole-turn & generic viewport pre virtualization must be removed
  assert.equal(
    rawCss.includes('contain-intrinsic-block-size'),
    false,
    'style.css must not apply sticky-breaking contain-intrinsic-block-size virtualization on turns/pre'
  );
  assert.equal(
    rawCss.includes(':is([data-testid="agent-response"],[data-testid="user-message"],[data-testid="turn-cards-container"]):not(:last-child)'),
    false,
    'must not apply content-visibility:auto to whole agent-response/user-message/turn-cards-container blocks'
  );
  assert.equal(
    rawCss.includes('[data-testid="autoscroll-viewport"] pre:not(:last-child)'),
    false,
    'must not apply generic autoscroll-viewport pre content-visibility:auto that breaks sticky headers'
  );

  const cvLines = cssLines.filter((l) => l.includes('content-visibility:auto'));
  assert.ok(cvLines.length >= 3, 'style.css must preserve legacy Issue #57 content-visibility:auto rules');
  for (const line of cvLines) {
    assert.ok(
      line.includes(':not([data-ag-cs-bleed="1"])'),
      `every remaining content-visibility:auto line must exclude [data-ag-cs-bleed="1"]: ${line.slice(0, 180)}`
    );
  }

  // Sidebar conversation rows must NEVER have content-visibility
  const sidebarCvLines = cssLines.filter(
    (l) => l.includes('conversation-row-sidebar') && l.includes('content-visibility')
  );
  assert.equal(sidebarCvLines.length, 0, 'conversation-row-sidebar must have 0 content-visibility rules');

  // Preserve legacy history & markdown pre contracts
  assert.ok(
    rawCss.includes('[data-testid="conversation-row-history"]:not([data-ag-cs-bleed="1"]){content-visibility:auto;contain-intrinsic-size:auto 44px;'),
    'must preserve legacy conversation-row-history content-visibility rule'
  );
  assert.ok(rawCss.includes('contain-intrinsic-size:auto 26px'), 'must preserve legacy 26px intrinsic size contract');
});

test('W6-4: style.css hygiene (0 BOM/CRLF/:has/non-ASCII, balanced braces) and tight darkChatActive + Ch1 budgets', () => {
  // Hygiene invariants
  assert.equal(rawBuf[0] === 0xef && rawBuf[1] === 0xbb && rawBuf[2] === 0xbf, false, 'style.css must have 0 UTF-8 BOM');
  assert.equal(/\r\n/.test(rawCss), false, 'style.css must use LF only (0 CRLF)');
  assert.equal(/:has\(/.test(rawCss), false, 'style.css must have 0 :has() selectors');
  assert.equal(/[^\x00-\x7f]/.test(rawCss), false, 'style.css must be 100% pure ASCII');

  // Balanced braces
  let balance = 0;
  for (let i = 0; i < rawCss.length; i++) {
    if (rawCss[i] === '{') balance++;
    else if (rawCss[i] === '}') balance--;
    assert.ok(balance >= 0, `unmatched closing brace at offset ${i}`);
  }
  assert.equal(balance, 0, 'style.css braces must be strictly balanced');

  // Flattened CSS has zero residual CSS Nesting &
  assert.equal(/(?:^|[\s,{])&/.test(flatCss), false, 'flattened CSS must contain 0 residual & selectors');

  // Size & line budgets
  const lineCount = rawCss.split(/\r?\n/).length;
  assert.ok(rawBuf.length <= 208800, `style.css raw size ${rawBuf.length} B exceeds 208,800 B target`);
  assert.ok(lineCount <= 860, `style.css line count ${lineCount} exceeds Law 2 limit 860`);

  const buckets = splitCssIntoBuckets(flatCss);
  const darkChatActive = Buffer.byteLength(buckets.core + buckets.viewSidebar + buckets.motionFull, 'utf8');
  assert.ok(darkChatActive < 184320, `darkChatActive ${darkChatActive} B exceeds 184,320 B hard redline`);
  assert.ok(darkChatActive <= 183800, `darkChatActive ${darkChatActive} B exceeds 183,800 B W6 target`);

  const ch1AutoBytes = Buffer.byteLength(cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, language: 'auto' }), 'utf8');
  assert.ok(ch1AutoBytes < 389500, `Ch1[auto] ${ch1AutoBytes} B exceeds 389,500 B W6 guard`);
  assert.ok(ch1AutoBytes <= 389200, `Ch1[auto] ${ch1AutoBytes} B exceeds 389,200 B W6 target`);
});
