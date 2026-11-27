#!/usr/bin/env node
// Single-source-of-truth version validator & synchronizer for Obsidian Prism.
// Zero external dependencies. Reads package.json#version as canonical SSOT.
//
// Usage:
//   node scripts/bump-version.mjs --check
//   node scripts/bump-version.mjs <newVersion> [--dry-run]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..');

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

// SAFE BUILD (2026-11-27): anchors for the removed native installers and updater were dropped.
export function parseSemver(raw) {
  const clean = String(raw || '').trim().replace(/^v/i, '');
  const m = SEMVER_RE.exec(clean);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  const prerelease = m[4] || '';
  let build = 0;
  if (prerelease) {
    const numMatch = prerelease.match(/(\d+)$/);
    build = numMatch ? Number(numMatch[1]) : 0;
  }
  return {
    version: clean,
    major,
    minor,
    patch,
    prerelease,
    numeric3: `${major}.${minor}.${patch}`,
    windows4: `${major}.${minor}.${patch}.${build}`,
  };
}

export function toThreePartNumeric(version) {
  const p = parseSemver(version);
  if (!p) throw new Error(`Invalid SemVer: "${version}"`);
  return p.numeric3;
}

export function toFourPartWindowsVersion(version) {
  const p = parseSemver(version);
  if (!p) throw new Error(`Invalid SemVer: "${version}"`);
  return p.windows4;
}

/**
 * Inspect CHANGELOG.md for:
 * 1. Presence of `## [<expectedVersion>]` heading;
 * 2. Zero accidental Markdown Setext heading glue (a non-blank text line immediately followed by `---` or `===`).
 */
export function checkChangelogHygiene(changelogText, expectedVersion) {
  const issues = [];
  const text = String(changelogText || '');
  if (expectedVersion) {
    const heading = `## [${expectedVersion}]`;
    if (!text.includes(heading)) {
      issues.push(`CHANGELOG.md missing heading "${heading}"`);
    }
  }

  const lines = text.split(/\r?\n/);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^(?:-{3,}|={3,})$/.test(trimmed) && i > 0) {
      const prev = lines[i - 1].trim();
      // A blank line before `---` produces an <hr>; a non-blank text/list/quote line before `---`/`===`
      // becomes a Markdown Setext heading in GitHub/CommonMark renderers.
      if (prev.length > 0 && !prev.startsWith('#') && !/^```/.test(prev) && !/^<!--/.test(prev)) {
        issues.push(
          `CHANGELOG.md line ${i + 1}: potential Setext heading glue ("${trimmed}" immediately follows non-blank line ${i}: "${prev.slice(0, 60)}")`
        );
      }
    }
  }
  return issues;
}

/**
 * Declarative registry of all static version anchors synchronized from package.json#version.
 * Node modules (cdp.js, tools/install-plugin.cjs, update-service.mjs, omni-server.mjs, workbench/server.cjs)
 * read package.json dynamically at runtime; their fallback defaults and compiled C#/Swift/browser anchors live here.
 */
function buildAnchorSpecs(parsed) {
  const { version, numeric3, windows4 } = parsed;
  return [
    {
      rel: 'package.json',
      label: 'package.json#version',
      pattern: /^(\s*"version"\s*:\s*")([^"]+)(")/m,
      expected: version,
      replace: (_, pre, _cur, post) => `${pre}${version}${post}`,
    },
    {
      rel: 'plugin.json',
      label: 'plugin.json#version',
      pattern: /^(\s*"version"\s*:\s*")([^"]+)(")/m,
      expected: version,
      replace: (_, pre, _cur, post) => `${pre}${version}${post}`,
    },
    {
      rel: 'CITATION.cff',
      label: 'CITATION.cff version',
      pattern: /^(version:\s*)([^\r\n]+)$/m,
      expected: version,
      replace: (_, pre) => `${pre}${version}`,
    },
    {
      rel: 'ui-runtime.js',
      label: 'ui-runtime.js VERSION constant',
      pattern: /(const VERSION = ')([^']+)(';)/,
      expected: version,
      replace: (_, pre, _cur, post) => `${pre}${version}${post}`,
    },
    {
      rel: 'settings-panel.js',
      label: 'settings-panel.js export default version param',
      pattern: /(buildSanitizedConfigExport = \(currentSettings = \{\}, rawThoughtCfg = null, version = ')([^']+)('\))/,
      expected: version,
      replace: (_, pre, _cur, post) => `${pre}${version}${post}`,
    },
    {
      rel: 'settings-panel.js',
      label: 'settings-panel.js export fallback version',
      pattern: /(schema: 'obsidian-prism-config-v1', version: String\(version \|\| ')([^']+)('\))/,
      expected: version,
      replace: (_, pre, _cur, post) => `${pre}${version}${post}`,
    },
    {
      rel: 'vendor/omni-viewer/omni-client.js',
      label: 'omni-client.js VERSION constant',
      pattern: /(const VERSION = ')([^']+)(';)/,
      expected: version,
      replace: (_, pre, _cur, post) => `${pre}${version}${post}`,
    },
    {
      rel: 'workbench/app.js',
      label: 'workbench/app.js about preview title',
      pattern: /(Obsidian Prism v)([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)/,
      expected: version,
      replace: (_, pre) => `${pre}${version}`,
    },
    {
      rel: '.github/ISSUE_TEMPLATE/bug_report.md',
      label: 'bug_report.md version template',
      pattern: /(\*\*Obsidian Prism Version\*\*:\s*`v)([^`]+)(`)/,
      expected: version,
      replace: (_, pre, _cur, post) => `${pre}${version}${post}`,
    },
    {
      rel: 'src/utils/fs-safe.cjs',
      label: 'fs-safe.cjs readPkgVersionSafe fallback',
      pattern: /(function readPkgVersionSafe\(rootDir,\s*fallback\s*=\s*')([^']+)('\))/,
      expected: version,
      replace: (_, pre, _cur, post) => `${pre}${version}${post}`,
    },
    {
      rel: 'src/daemon/constants.mjs',
      label: 'constants.mjs PKG_VERSION fallback',
      pattern: /(PKG_VERSION\s*=\s*\(\(\)\s*=>\s*\{[\s\S]*?return ')([^']+)(';)/,
      expected: version,
      replace: (_, pre, _cur, post) => `${pre}${version}${post}`,
    },
    {
      rel: 'vendor/omni-viewer/omni-server.mjs',
      label: 'omni-server.mjs readPackageVersion fallback',
      pattern: /(function readPackageVersion\(fallback\s*=\s*')([^']+)('\))/,
      expected: version,
      replace: (_, pre, _cur, post) => `${pre}${version}${post}`,
    },
    {
      rel: 'workbench/server.cjs',
      label: 'workbench/server.cjs PKG_VERSION fallback',
      pattern: /(PKG_VERSION\s*=\s*\(\(\)\s*=>\s*\{[\s\S]*?return ')([^']+)(';)/,
      expected: version,
      replace: (_, pre, _cur, post) => `${pre}${version}${post}`,
    },
    {
      rel: 'tools/install-plugin.cjs',
      label: 'install-plugin.cjs resolveDefaultPluginVersion fallback',
      pattern: /(return PLUGIN_VERSION \|\| ")([^"]+)(";)/,
      expected: version,
      replace: (_, pre, _cur, post) => `${pre}${version}${post}`,
    },
    // LIGHT (2026-11-27): build-installer.mjs anchor removed with the script.
  ];
}

export function readRootVersion(rootDir = DEFAULT_ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const parsed = parseSemver(pkg?.version);
  if (!parsed) {
    throw new Error(`Invalid package.json#version: "${pkg?.version}"`);
  }
  return parsed;
}

export function checkVersionSync(rootDir = DEFAULT_ROOT) {
  const parsed = readRootVersion(rootDir);
  const specs = buildAnchorSpecs(parsed);
  const errors = [];
  const checked = [];

  for (const spec of specs) {
    const abs = path.join(rootDir, spec.rel);
    if (!fs.existsSync(abs)) {
      errors.push(`[missing] ${spec.rel} (${spec.label})`);
      continue;
    }
    const content = fs.readFileSync(abs, 'utf8');
    const m = spec.pattern.exec(content);
    if (!m) {
      errors.push(`[pattern-not-found] ${spec.rel} (${spec.label})`);
      continue;
    }
    const actual = m[2].trim();
    checked.push({ rel: spec.rel, label: spec.label, expected: spec.expected, actual });
    if (actual !== spec.expected) {
      errors.push(`[mismatch] ${spec.rel} (${spec.label}): expected "${spec.expected}", found "${actual}"`);
    }
  }

  const changelogAbs = path.join(rootDir, 'CHANGELOG.md');
  if (!fs.existsSync(changelogAbs)) {
    errors.push('[missing] CHANGELOG.md');
  } else {
    const changelogText = fs.readFileSync(changelogAbs, 'utf8');
    const clIssues = checkChangelogHygiene(changelogText, parsed.version);
    for (const issue of clIssues) errors.push(`[changelog] ${issue}`);
  }

  return { ok: errors.length === 0, version: parsed.version, windows4: parsed.windows4, checked, errors };
}

export function bumpVersion(newVersionRaw, { rootDir = DEFAULT_ROOT, dryRun = false } = {}) {
  const parsed = parseSemver(newVersionRaw);
  if (!parsed) {
    throw new Error(`Invalid SemVer target: "${newVersionRaw}" (expected e.g. 1.0.8 or 1.0.8-beta.4)`);
  }
  const specs = buildAnchorSpecs(parsed);
  const byFile = new Map();
  for (const spec of specs) {
    if (!byFile.has(spec.rel)) byFile.set(spec.rel, []);
    byFile.get(spec.rel).push(spec);
  }

  const updated = [];
  const errors = [];

  for (const [rel, fileSpecs] of byFile.entries()) {
    const abs = path.join(rootDir, rel);
    if (!fs.existsSync(abs)) {
      errors.push(`Missing target file: ${rel}`);
      continue;
    }
    const orig = fs.readFileSync(abs, 'utf8');
    let next = orig;
    for (const spec of fileSpecs) {
      if (!spec.pattern.test(next)) {
        errors.push(`Pattern not matched in ${rel} (${spec.label})`);
        continue;
      }
      next = next.replace(spec.pattern, spec.replace);
    }
    if (next !== orig) {
      if (!dryRun) {
        fs.writeFileSync(abs, next, 'utf8');
      }
      updated.push(rel);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Version bump aborted with errors:\n- ${errors.join('\n- ')}`);
  }

  return { version: parsed.version, windows4: parsed.windows4, numeric3: parsed.numeric3, updated, dryRun };
}

function runCli(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('Usage:\n  node scripts/bump-version.mjs --check\n  node scripts/bump-version.mjs <newVersion> [--dry-run]');
    process.exit(0);
  }
  if (args.includes('--check')) {
    const res = checkVersionSync(DEFAULT_ROOT);
    if (!res.ok) {
      console.error(`Version sync check FAILED (SSOT=${res.version}, win4=${res.windows4}):`);
      for (const err of res.errors) console.error(`  - ${err}`);
      process.exit(1);
    }
    console.log(`Version sync check PASSED: ${res.checked.length} anchors aligned to ${res.version} (win4=${res.windows4}) + CHANGELOG.md clean.`);
    process.exit(0);
  }

  const dryRun = args.includes('--dry-run');
  const target = args.find((a) => !a.startsWith('-'));
  if (!target) {
    console.error('Error: missing <newVersion> argument.');
    process.exit(1);
  }
  const res = bumpVersion(target, { rootDir: DEFAULT_ROOT, dryRun });
  console.log(
    `${dryRun ? '[dry-run] ' : ''}Synced ${res.updated.length} file(s) to ${res.version} (win4=${res.windows4}, num3=${res.numeric3}):`
  );
  for (const rel of res.updated) console.log(`  - ${rel}`);
  console.log(`Remember to add a "## [${res.version}] - YYYY-MM-DD" section to CHANGELOG.md before running --check.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  runCli(process.argv);
}
