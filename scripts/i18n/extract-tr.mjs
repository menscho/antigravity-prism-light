// Usage: node scripts/i18n/extract-tr.mjs (generate i18n-work/tr translation chunks).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'i18n-work', 'tr');
const chunkSize = 400;
fs.mkdirSync(outDir, { recursive: true });

function writeChunks(prefix, entries) {
  const rows = Object.entries(entries);
  for (let i = 0; i < rows.length; i += chunkSize) {
    const n = String(Math.floor(i / chunkSize) + 1).padStart(2, '0');
    fs.writeFileSync(path.join(outDir, `${prefix}-${n}.json`), `${JSON.stringify(Object.fromEntries(rows.slice(i, i + chunkSize)), null, 2)}\n`);
  }
}

const localeSource = fs.readFileSync(path.join(root, 'i18n-locales.js'), 'utf8');
const ui = {};
function* localeArrays(source) {
  const startRe = /([A-Za-z_$][\w$]*):\s*\[/g;
  for (let match; (match = startRe.exec(source));) {
    const open = startRe.lastIndex - 1;
    let quote = '', escaped = false, depth = 1, end = open + 1;
    for (; end < source.length && depth; end++) {
      const ch = source[end];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = '';
      } else if (ch === "'" || ch === '"') quote = ch;
      else if (ch === '[') depth++;
      else if (ch === ']') depth--;
    }
    if (!depth) yield { key: match[1], inner: source.slice(open + 1, end - 1) };
    startRe.lastIndex = end;
  }
}
for (const match of localeArrays(localeSource)) {
  try {
    const values = Function(`return [${match.inner}]`)();
    if (values.length >= 8 && typeof values[2] === 'string') ui[`ui:${match.key}`] = values[2];
  } catch {}
}
const inlinePath = path.join(root, 'vendor/inline-diff/inline-diff-client.js');
const inlineSource = fs.readFileSync(inlinePath, 'utf8');
const inlineBlock = inlineSource.match(/const DIFF_FALLBACK = \{([\s\S]*?)\n    \};/);
const inlineUi = {};
if (inlineBlock) {
  for (const match of inlineBlock[1].matchAll(/(inlineDiff\w+):\s*\{([\s\S]*?)\n\s*\},/g)) {
    const en = match[2].match(/\ben:\s*'((?:\\.|[^'\\])*)'/);
    if (en) inlineUi[`inline:${match[1]}`] = Function(`return '${en[1]}'`)();
  }
}
Object.assign(inlineUi, ui);
// The standalone Omni workbench keeps a separate ten-language table.
const omniPath = path.join(root, 'vendor/omni-viewer/workbench-page.mjs');
const omniSource = fs.readFileSync(omniPath, 'utf8');
const omniBlock = omniSource.match(/export const WORKBENCH_I18N = \{([\s\S]*?)\n\};/);
if (omniBlock) {
  for (const match of omniBlock[1].matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    try {
      const values = Function(`return [${match[2]}]`)();
      if (typeof values[3] === 'string') inlineUi[`omni:${match[1]}`] = values[3];
    } catch {}
  }
}
for (const [file, marker, prefix] of [
  ['context-menu-btw.js', 'const I18N = {', 'context'],
  ['host-workbench-enhancer.js', 'const UI_RAW = {', 'workbench'],
]) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const start = source.indexOf(marker);
  const end = source.indexOf('\n  };', start);
  const block = start >= 0 && end > start ? source.slice(start, end) : '';
  const english = block.match(/\ben:\s*'((?:\\.|[^'\\])*)'/);
  if (english) Function(`return '${english[1]}'`)().split('|').forEach((value, i) => { inlineUi[`${prefix}:${i}`] = value; });
}
const effortSource = fs.readFileSync(path.join(root, 'vendor/effort-slider/upstream-client.js'), 'utf8');
for (const [table, name] of [['SET_TITLE_I18N', 'settingsTitle'], ['SET_HEAD_I18N', 'settingsHeading'], ['FIXED_I18N', 'fixed'], ['EFFORT_TITLE_I18N', 'effortTitle']]) {
  const line = effortSource.match(new RegExp(`var ${table} = \\{([^}]+)\\}`));
  const en = line?.[1].match(/\ben:\s*"([^"]*)"/);
  if (en) inlineUi[`effort:${name}`] = en[1];
}
const usageSource = fs.readFileSync(path.join(root, 'usage-core.js'), 'utf8');
for (const match of usageSource.matchAll(/\['([^']+)',\s*\d+,\s*\[([^\]]+)\]\]/g)) {
  try {
    const labels = Function(`return [${match[2]}]`)();
    if (typeof labels[2] === 'string') inlineUi[`usage:homeRange:${match[1]}`] = labels[2];
  } catch {}
}
writeChunks('ui', inlineUi);

const host = JSON.parse(fs.readFileSync(path.join(root, 'vendor/host-i18n/zh-CN.json'), 'utf8'));
const exact = Object.fromEntries(Object.keys(host.exact || {}).map((key) => [`exact:${key}`, key]));
writeChunks('host-exact', exact);
// 线性显式扫描替换未转义捕获组，避免正则嵌套转义引发 ReDoS 回溯
function replaceCaptureGroups(input) {
  let out = '';
  let groupIndex = 0;
  let i = 0;
  while (i < input.length) {
    if (input[i] === '\\' && i + 1 < input.length) {
      out += input.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (input[i] === '(' && input[i + 1] !== '?') {
      let j = i + 1;
      let closed = false;
      while (j < input.length) {
        if (input[j] === '\\' && j + 1 < input.length) {
          j += 2;
        } else if (input[j] === ')') {
          closed = true;
          j += 1;
          break;
        } else {
          j += 1;
        }
      }
      if (!closed) {
        out += input.slice(i);
        break;
      }
      out += `$${++groupIndex}`;
      i = j;
      continue;
    }
    out += input[i];
    i += 1;
  }
  return out;
}

function hintFor(regex) {
  let hint = replaceCaptureGroups(String(regex).replace(/^\^|\$$/g, ''))
    .replace(/\\s\*/g, ' ')
    .replace(/\\s\+/g, ' ')
    .replace(/\\d\+/g, 'number')
    .replace(/\[A-Za-z0-9_.-\+\\]+\+/g, 'text')
    .replace(/\\n/g, ' line break ')
    .replace(/\\\./g, '.')
    .replace(/\\-/g, '-')
    .replace(/[?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!hint || /[\[\\{}]/.test(hint)) hint = `English text matching this pattern: ${hint || regex}`;
  return hint;
}
const patterns = {};
for (const [i, item] of (host.patterns || []).entries()) {
  const id = `pattern:${String(i + 1).padStart(4, '0')}`;
  patterns[id] = { regex: item.regex, zh: item.replacement, en_hint: hintFor(item.regex) };
}
writeChunks('host-patterns', patterns);

const swarm = JSON.parse(fs.readFileSync(path.join(root, 'vendor/host-i18n/swarm-zh-CN.json'), 'utf8'));
const swarmEntries = {};
for (const [key, value] of Object.entries(swarm.exact || {})) swarmEntries[`swarm-exact:${key}`] = value && key;
for (const [i, item] of (swarm.patterns || []).entries()) {
  swarmEntries[`swarm-pattern:${String(i + 1).padStart(4, '0')}`] = { regex: item.regex, zh: item.replacement, en_hint: hintFor(item.regex) };
}
for (const [i, item] of (swarm.optionPatterns || []).entries()) {
  swarmEntries[`swarm-option:${String(i + 1).padStart(4, '0')}`] = { regex: item.regex, zh: item.replacement, en_hint: hintFor(item.regex) };
}
for (const [key, value] of Object.entries(swarm.protectedUiKeys || {})) swarmEntries[`protected:${key}`] = value;
writeChunks('swarm', swarmEntries);

fs.writeFileSync(path.join(outDir, 'README.md'), '# Turkish translation files\n\nTranslate values in each chunk and save the result beside it with the same name plus `.tr.json` (for example, `ui-01.tr.json`). Keep every id unchanged. For regex entries, provide a `tr` string and keep every `$1`, `$2` placeholder used by the pattern. Keep `{name}`-style tokens, HTML tags, and keyboard shortcuts intact. Leave product names Antigravity, Gemini, Claude, and MCP untranslated.\n');
console.log(`Wrote ${Object.keys(ui).length} UI entries, ${Object.keys(exact).length} host exact entries, ${Object.keys(patterns).length} host patterns, and ${Object.keys(swarmEntries).length} swarm entries.`);
