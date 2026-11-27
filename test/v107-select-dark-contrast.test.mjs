import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const cdp = require('../cdp.js');

function checkBalancedBraces(css) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inComment = false;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    const next = css[i + 1];
    if (inComment) {
      if (ch === '*' && next === '/') {
        inComment = false;
        i += 1;
      }
      continue;
    }
    if (!inSingle && !inDouble && ch === '/' && next === '*') {
      inComment = true;
      i += 1;
      continue;
    }
    if (ch === '\\' && (inSingle || inDouble)) {
      i += 1;
      continue;
    }
    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) return { ok: false, depth, pos: i };
    }
  }
  return { ok: depth === 0 && !inSingle && !inDouble && !inComment, depth };
}

function extractTopLevelHtmlStyleBlock(css) {
  const marker = 'html[data-ag-cs-style]{';
  const start = css.indexOf(marker);
  assert.ok(start >= 0, 'style.css must contain top-level html[data-ag-cs-style]{ block');
  let depth = 0;
  for (let i = start + marker.length - 1; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  return '';
}

test('Issue #15: style.css obeys zero :has(), zero non-ASCII, balanced braces, host color-scheme & high-contrast select/option rules', () => {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');

  // 1) Core CSS invariants
  assert.equal(css.includes(':has('), false, 'style.css must contain 0 :has( selectors');
  const nonAscii = css.match(/[^\x00-\x7F]/g);
  assert.equal(nonAscii, null, `style.css must contain 0 non-ASCII chars, found: ${nonAscii?.slice(0, 5)}`);
  const braceCheck = checkBalancedBraces(css);
  assert.equal(braceCheck.ok, true, `style.css braces must be balanced (depth=${braceCheck.depth})`);

  // 2) Top-level html[data-ag-cs-style] block covers palette="host" dark & light color-scheme
  const rootBlock = extractTopLevelHtmlStyleBlock(css);
  assert.ok(rootBlock.length > 0, 'html[data-ag-cs-style] block must close properly');
  assert.match(
    rootBlock,
    /&\[data-ag-cs-palette="host"\]\{[^}]*color-scheme:dark;/,
    'palette="host" must declare dark color-scheme inside html[data-ag-cs-style]'
  );
  assert.match(
    rootBlock,
    /&\[data-ag-cs-palette="host"\][\s\S]*?\[data-ag-cs-theme="light"\][^{]*\{[^}]*color-scheme:light[;}]/,
    'palette="host" must declare light color-scheme for [data-ag-cs-theme="light"]'
  );
  // Existing obsidian & claude/warm palettes keep both dark & light color-scheme
  assert.match(rootBlock, /color-scheme:dark\s*!important;/);
  assert.match(rootBlock, /color-scheme:light\s*!important;/);

  // 3) Both .ag-cs-home-ws-select & .ag-cs-thought-select inherit color-scheme and paint opaque high-contrast option/optgroup colors
  const selRuleMatch = rootBlock.match(
    /:is\(\.ag-cs-home-ws-select,\.ag-cs-thought-select\)\{([^}]*?)&\s*:is\(option,optgroup\)\{([^}]+)\}\}/
  );
  assert.ok(selRuleMatch, 'style.css must style both .ag-cs-home-ws-select and .ag-cs-thought-select plus nested option/optgroup at root scope');
  assert.ok(selRuleMatch[1].includes('color-scheme:inherit;'), 'Both selects must declare color-scheme:inherit');
  const optBody = selRuleMatch[2];
  assert.ok(
    optBody.includes('background-color:color-mix(in srgb,var(--background,#141418) 68%,var(--card,#141418))'),
    'option/optgroup must use opaque color-mix(--background, --card) background-color'
  );
  assert.equal(optBody.includes('transparent'), false, 'option/optgroup background must be opaque (no transparent mix)');
  assert.ok(
    optBody.includes('color:var(--foreground,#F2F2F5)'),
    'option/optgroup must explicitly declare high-contrast foreground text color'
  );
});

test('Issue #15: home-studio-panel.js STUDIO_EXTRA_CSS includes fallback dark-contrast option rule and survives cdp minification & Channel 1 build', () => {
  const studioSrc = fs.readFileSync(path.join(ROOT, 'home-studio-panel.js'), 'utf8');
  assert.ok(
    studioSrc.includes('.ag-cs-home-ws-select{') && studioSrc.includes('color-scheme:inherit'),
    'home-studio-panel.js must set color-scheme:inherit on .ag-cs-home-ws-select'
  );
  assert.ok(
    studioSrc.includes('.ag-cs-home-ws-select option{background:var(--card,#141418);color:var(--foreground,#F2F2F5);}'),
    'home-studio-panel.js STUDIO_EXTRA_CSS must include fallback opaque option background and foreground color'
  );

  // Verify cdp.minifyCss preserves both host color-scheme and shared select/option contrast rules
  const minCss = cdp.minifyCss(cdp.readCss());
  assert.ok(minCss.includes('&[data-ag-cs-palette="host"]{color-scheme:dark;'), 'Minified CSS must keep host dark color-scheme');
  assert.match(minCss, /\[data-ag-cs-theme="light"\][^{]*\{[^}]*color-scheme:light[;}]/, 'Minified CSS must keep host light color-scheme');
  assert.ok(
    minCss.includes(':is(.ag-cs-home-ws-select,.ag-cs-thought-select){color-scheme:inherit;& :is(option,optgroup){background-color:color-mix(in srgb,var(--background,#141418) 68%,var(--card,#141418));color:var(--foreground,#F2F2F5)}}'),
    'Minified CSS must keep shared select color-scheme:inherit and opaque option/optgroup colors'
  );

  // Verify minified home-studio-panel.js preserves fallback option rule before token packing
  const minStudio = cdp.minifyJs(studioSrc);
  assert.ok(
    minStudio.includes('.ag-cs-home-ws-select option{background:var(--card,#141418);color:var(--foreground,#F2F2F5);}'),
    'Minified home-studio-panel.js must retain fallback option rule'
  );

  // Verify full Channel 1 expression compiles cleanly within budget
  const expr = cdp.buildInjectExpression(cdp.DEFAULT_CONFIG);
  assert.ok(Buffer.byteLength(expr, 'utf8') <= 704000, 'Channel 1 bundle must remain <= 704,000 B');
});
