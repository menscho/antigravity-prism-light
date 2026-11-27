import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cdp = require('../cdp.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('light-theme overlays avoid specificity inversion and dark fallback leaks across palettes', () => {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const lightBlockIdx = css.indexOf('html[data-ag-cs-style][data-ag-cs-theme="light"]');
  assert.ok(lightBlockIdx > 0, 'style.css must contain light-theme override block');

  const baseSection = css.slice(0, lightBlockIdx);
  const lightSection = css.slice(lightBlockIdx);

  // 1. Inner conversation-navigator-group-card is a 0-padding layout child inside .agy-overlay.surface-glass;
  //    it must NOT receive the dark menu surface rule (which creates a black-on-black box in light mode and double border in dark mode).
  const darkMenuSurfaceLine = baseSection
    .split(/\r?\n/)
    .find((l) => l.includes('var(--ag-cs-menu-bg,rgba(14,16,22,.94))'));
  assert.ok(darkMenuSurfaceLine, 'dark menu surface rule should remain intact for dark themes');
  assert.equal(
    darkMenuSurfaceLine.includes('[data-testid="conversation-navigator-group-card"]'),
    false,
    'inner [data-testid="conversation-navigator-group-card"] must not inherit dark menu surface background'
  );

  // 2. Light override must match the full negated .agy-overlay selector so its specificity (0,6,1) beats
  //    the dark rule (0,5,1) for select dropdowns, model selector, context menus, and popovers in Alabaster & Obsidian light modes.
  const lightMenuOverrideLine = lightSection
    .split(/\r?\n/)
    .find((l) => l.includes('var(--ag-cs-menu-bg-l,rgba(252,253,255,.95))'));
  assert.ok(lightMenuOverrideLine, 'light-theme overlay override rule must exist');
  assert.ok(
    lightMenuOverrideLine.includes('.agy-overlay[data-hover-card-popup],.agy-overlay:not([data-hover-card-popup]):not([data-testid="model-selector-panel"])'),
    'light override must scope hover-card overlay and preserve negated .agy-overlay selector so model-selector-panel stays exempt'
  );
  assert.equal(
    lightMenuOverrideLine.includes(':is(.agy-overlay,'),
    false,
    'light override must NOT include bare .agy-overlay that swallows model-selector-panel exemption'
  );

  // 2b. palette="host" light block must define light fallbacks for --ag-cs-panel-bg (#FFFFFF) and --ag-cs-popover-bg (#FCFDFF)
  const hostLightVarsLine = baseSection
    .split(/\r?\n/)
    .find((l) => l.includes('&[data-ag-cs-palette="host"]{color-scheme:dark;'));
  assert.ok(hostLightVarsLine, 'palette="host" light variable override line must exist');
  assert.match(
    hostLightVarsLine,
    /--ag-cs-panel-bg:color-mix\(in srgb,var\(--vscode-editorWidget-background,var\(--card,#(?:FFF|FFFFFF)\)\) 96%,transparent\);?/,
    'palette="host" light block must declare light --ag-cs-panel-bg fallback (#FFF/#FFFFFF)'
  );
  assert.match(
    hostLightVarsLine,
    /--ag-cs-popover-bg:color-mix\(in srgb,var\(--vscode-editorWidget-background,var\(--card,#FCFDFF\)\) 94%,transparent\);?/,
    'palette="host" light block must declare light --ag-cs-popover-bg fallback (#FCFDFF)'
  );

  // 2c. #193 [P0-1]: nav outline popover ::before bridge must only span 24..32px (left:-6px; width:8px) without occluding 4..24px trigger
  const outlineBridgeLine = baseSection
    .split(/\r?\n/)
    .find((l) => l.includes('.ag-cs-nav-outline-popover::before{'));
  assert.ok(outlineBridgeLine, 'style.css must define .ag-cs-nav-outline-popover::before bridge');
  assert.ok(
    outlineBridgeLine.includes('left:-6px;top:0;bottom:0;width:8px'),
    'outline popover ::before bridge must be left:-6px;width:8px to avoid occluding trigger click zone'
  );

  // 3. .agy-toast & .toast-root must be included in the light override so they beat dark rule (0,3,1) in non-host light modes.
  assert.ok(lightMenuOverrideLine.includes('.agy-toast'), 'light override must cover .agy-toast');
  assert.ok(lightMenuOverrideLine.includes('.toast-root'), 'light override must cover .toast-root');

  // 4. Host palette light mode must override dark-fallback permissions-menu and side-question-panel even without body.theme-light.
  const hostLightLine = lightSection
    .split(/\r?\n/)
    .find((l) => l.includes('&[data-ag-cs-palette="host"]') && l.includes('[data-testid="permissions-menu"]'));
  assert.ok(hostLightLine, 'host palette light override must cover permissions-menu');
  assert.ok(hostLightLine.includes('[data-testid="side-question-panel"]'), 'host palette light override must cover side-question-panel');
  assert.ok(hostLightLine.includes('var(--ag-cs-popover-bg'), 'host palette light override must use theme-aware --ag-cs-popover-bg');

  // 5. Nested floating submenus (.agy-overlay[role="menu"] inside a parent .agy-overlay, e.g. Orchestrator submenu)
  //    must NOT be stripped transparent by the inner bare-[role="menu"] reset rule (fixes transparent submenu in host palette).
  const nestedMenuResetLine = baseSection
    .split(/\r?\n/)
    .find((l) => l.includes('& .agy-overlay [role="menu"]') && l.includes('background:transparent'));
  assert.ok(nestedMenuResetLine, 'inner [role="menu"] reset rule should remain intact');
  assert.ok(
    nestedMenuResetLine.includes(':not(.agy-overlay)'),
    'inner [role="menu"] reset rule must exclude :not(.agy-overlay) so nested floating submenus keep their surface'
  );

  // 6. CSS hygiene & Channel 1 budget check
  assert.equal(/:has\(/.test(css), false, 'style.css must have 0 :has() selectors');
  assert.equal(/[^\x00-\x7F]/.test(css), false, 'style.css must remain pure ASCII');
  const expr = cdp.buildInjectExpression({});
  assert.ok(Buffer.byteLength(expr, 'utf8') < 685000, `Channel 1 payload must stay < 685,000 B (got ${Buffer.byteLength(expr, 'utf8')})`);
});
