// 在线同步升级兼容与单源 SYNC_SUBDIRS 契约回归测试（按模块域命名）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_SYNC_SUBDIRS,
  collectManagedSubdirFiles,
  isSafeManagedRelPath,
  normalizeSyncSubdirs,
  shouldExcludeSyncRelPath,
} from '../src/utils/sync-manifest.cjs';
import {
  INSTALL_MANIFEST_FILENAME,
  PROTECTED_USER_PATHS,
  buildInstallManifest,
  computeFileSha256,
  isProtectedUserPath,
} from '../src/platform/install-manifest.cjs';
import { copyUpdatedRuntimeFromRepo } from '../src/platform/repo-sync.cjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const cdp = require(path.join(ROOT, 'cdp.js'));
const partPreprocess = require(path.join(ROOT, 'src', 'compiler', 'part-preprocess.cjs'));

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * 精准复刻旧版（<= v1.0.8-beta.3）sidecars/daemon/main.mjs 中的在线 Git 同步算法：
 * 仅动态加载新仓 cdp.js 的 SYNC_ROOT_FILES，且子目录仅硬编码拷贝 assets / vendor / sidecars（不含 src/）。
 */
function runLegacyPreModularRepoSync(repoDir, pluginDir, fallbackFilesList) {
  const repoRoot = path.resolve(repoDir);
  const pluginRoot = path.resolve(pluginDir);
  if (repoRoot.toLowerCase() === pluginRoot.toLowerCase()) return 0;

  const isSafeRelativeSyncPath = (rel) => {
    if (typeof rel !== 'string') return false;
    const trimmed = rel.trim();
    if (!trimmed || trimmed.includes('\0') || path.isAbsolute(trimmed)) return false;
    const parts = trimmed.split(/[\\/]+/).filter(Boolean);
    if (parts.length === 0) return false;
    return !parts.some((p) => p === '.' || p === '..');
  };

  const isPathWithinRoot = (rootPath, candidatePath, allowEqual = false) => {
    const rel = path.relative(rootPath, candidatePath);
    if (rel === '') return allowEqual;
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  };

  const hasSymlinkSegment = (rootDir, targetPath) => {
    const rel = path.relative(rootDir, targetPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return true;
    let cur = rootDir;
    for (const part of rel.split(path.sep).filter(Boolean)) {
      cur = path.join(cur, part);
      try {
        if (fs.lstatSync(cur).isSymbolicLink()) return true;
      } catch (err) {
        if (err && err.code === 'ENOENT') break;
        return true;
      }
    }
    return false;
  };

  fs.mkdirSync(pluginRoot, { recursive: true });
  const realRepoRoot = fs.realpathSync(repoRoot);
  const realPluginRoot = fs.realpathSync(pluginRoot);

  let resolvedFiles = null;
  const repoCdpPath = path.join(repoRoot, 'cdp.js');
  const reqKey = require.resolve(repoCdpPath);
  delete require.cache[reqKey];
  const freshRepoCdp = require(repoCdpPath);
  if (Array.isArray(freshRepoCdp?.SYNC_ROOT_FILES) && freshRepoCdp.SYNC_ROOT_FILES.length > 0) {
    resolvedFiles = freshRepoCdp.SYNC_ROOT_FILES;
  }

  const safeCopyFile = (rel) => {
    if (!isSafeRelativeSyncPath(rel)) return false;
    const src = path.resolve(repoRoot, rel);
    const dst = path.resolve(pluginRoot, rel);
    if (!isPathWithinRoot(repoRoot, src) || !isPathWithinRoot(pluginRoot, dst)) return false;
    if (hasSymlinkSegment(repoRoot, src)) return false;
    let srcStat;
    try {
      srcStat = fs.lstatSync(src);
    } catch {
      return false;
    }
    if (srcStat.isSymbolicLink() || !srcStat.isFile()) return false;
    const realSrc = fs.realpathSync(src);
    if (!isPathWithinRoot(realRepoRoot, realSrc)) return false;
    if (hasSymlinkSegment(pluginRoot, dst)) return false;
    const dstParent = path.dirname(dst);
    fs.mkdirSync(dstParent, { recursive: true });
    if (hasSymlinkSegment(pluginRoot, dst)) return false;
    const realDstParent = fs.realpathSync(dstParent);
    if (!isPathWithinRoot(realPluginRoot, realDstParent, true)) return false;
    fs.copyFileSync(src, dst);
    return true;
  };

  let synced = 0;
  const files = resolvedFiles || fallbackFilesList || ['cdp.js', 'style.css', 'ui-runtime.js'];
  for (const rel of files) {
    if (safeCopyFile(rel)) synced += 1;
  }

  const syncSubDir = (sub) => {
    if (!isSafeRelativeSyncPath(sub)) return;
    const sDir = path.resolve(repoRoot, sub);
    const dDir = path.resolve(pluginRoot, sub);
    if (!isPathWithinRoot(repoRoot, sDir) || !isPathWithinRoot(pluginRoot, dDir)) return;
    if (!fs.existsSync(sDir) || fs.lstatSync(sDir).isSymbolicLink()) return;
    fs.mkdirSync(dDir, { recursive: true });
    for (const ent of fs.readdirSync(sDir, { withFileTypes: true })) {
      if (ent.name === '__pycache__' || ent.name === '.DS_Store') continue;
      if (ent.isSymbolicLink()) continue;
      const childRel = path.join(sub, ent.name);
      const childSrc = path.join(sDir, ent.name);
      const st = fs.lstatSync(childSrc);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) syncSubDir(childRel);
      else if (st.isFile() && safeCopyFile(childRel)) synced += 1;
    }
  };

  // 旧版仅硬编码 3 个目录，不包含 src/
  syncSubDir('assets');
  syncSubDir('vendor');
  syncSubDir('sidecars');
  return synced;
}

test('SYNC_ROOT_FILES dynamically derives 100% of src/ runtime files with POSIX paths, excluding junk/tests/hidden/symlinks', () => {
  const actualSrcFiles = collectManagedSubdirFiles(ROOT, 'src');
  assert.ok(actualSrcFiles.length >= 70, `Expected >= 70 src/ runtime files, got ${actualSrcFiles.length}`);

  // 1) All src/ runtime files appear in cdp.SYNC_ROOT_FILES as safe POSIX paths without duplicates
  const rootSet = new Set(cdp.SYNC_ROOT_FILES);
  assert.equal(rootSet.size, cdp.SYNC_ROOT_FILES.length, 'SYNC_ROOT_FILES must not contain duplicate entries');
  for (const rel of cdp.SYNC_ROOT_FILES) {
    assert.equal(rel.includes('\\'), false, `SYNC_ROOT_FILES must use POSIX '/' separators: ${rel}`);
    assert.equal(isSafeManagedRelPath(rel), true, `SYNC_ROOT_FILES entry must be safe relative path: ${rel}`);
    assert.equal(shouldExcludeSyncRelPath(rel), false, `SYNC_ROOT_FILES must not contain excluded file: ${rel}`);
    assert.equal(isProtectedUserPath(rel, PROTECTED_USER_PATHS), false, `SYNC_ROOT_FILES must never include protected user path: ${rel}`);
  }
  for (const rel of actualSrcFiles) {
    assert.ok(rootSet.has(rel), `SYNC_ROOT_FILES missing src/ runtime file: ${rel}`);
  }
  for (const coreRel of [
    'src/utils/fs-safe.cjs',
    'src/utils/sync-manifest.cjs',
    'src/platform/install-manifest.cjs',
    'src/platform/repo-sync.cjs',
    'src/daemon/index.mjs',
    'src/runtime/dom-bus.js',
    'src/security/net-guard.mjs',
  ]) {
    assert.ok(rootSet.has(coreRel), `Core runtime module missing from SYNC_ROOT_FILES: ${coreRel}`);
  }

  // 2) SYNC_SUBDIRS single source of truth exported by both cdp.js and sync-manifest.cjs
  assert.deepEqual([...cdp.SYNC_SUBDIRS], [...DEFAULT_SYNC_SUBDIRS]);
  assert.deepEqual([...cdp.SYNC_SUBDIRS], ['assets', 'src', 'vendor', 'sidecars']);

  // 3) Dynamic discovery picks up newly added src/ files automatically and rejects junk/hidden/test/non-runtime files
  const tmpRoot = mkTmp('prism-dynamic-src-');
  try {
    fs.mkdirSync(path.join(tmpRoot, 'src', 'feature', '.hidden-dir'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'src', '__pycache__'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'src', 'feature', 'new-helper.cjs'), 'module.exports = 1;\n', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'src', 'feature', 'worker.mjs'), 'export const x = 1;\n', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'src', 'feature', 'rules.json'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'src', 'feature', 'browser.js'), 'void 0;\n', 'utf8');
    // Junk / non-runtime files that MUST be excluded
    fs.writeFileSync(path.join(tmpRoot, 'src', 'feature', 'scratch.tmp'), 'tmp', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'src', 'feature', 'debug.log'), 'log', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'src', 'feature', '.DS_Store'), 'mac', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'src', 'feature', '.env'), 'SECRET=1', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'src', 'feature', 'NOTES.md'), '# notes', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'src', 'feature', 'unit.test.mjs'), '// test', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'src', 'feature', '.hidden-dir', 'leak.cjs'), 'module.exports = 0;\n', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'src', '__pycache__', 'cache.cjs'), 'module.exports = 0;\n', 'utf8');

    // Symlink / junction escape under src/ MUST be skipped cleanly
    const outsideTarget = path.join(tmpRoot, 'outside-secret-dir');
    fs.mkdirSync(outsideTarget, { recursive: true });
    fs.writeFileSync(path.join(outsideTarget, 'stolen.cjs'), 'module.exports = "escaped";\n', 'utf8');
    const linkDir = path.join(tmpRoot, 'src', 'linked-escape');
    try {
      fs.symlinkSync(outsideTarget, linkDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {}

    const discovered = collectManagedSubdirFiles(tmpRoot, 'src');
    assert.deepEqual(discovered, [
      'src/feature/browser.js',
      'src/feature/new-helper.cjs',
      'src/feature/rules.json',
      'src/feature/worker.mjs',
    ]);
    assert.equal(discovered.some((p) => p.includes('linked-escape') || p.includes('stolen.cjs')), false);

    const builtRootFiles = partPreprocess.buildSyncRootFiles(tmpRoot);
    assert.ok(builtRootFiles.includes('src/feature/new-helper.cjs'));
    assert.ok(builtRootFiles.includes('src/feature/worker.mjs'));
    assert.equal(builtRootFiles.includes('src/feature/scratch.tmp'), false);
    assert.equal(builtRootFiles.includes('src/feature/NOTES.md'), false);
    assert.equal(builtRootFiles.includes('src/feature/unit.test.mjs'), false);
    assert.equal(builtRootFiles.includes('src/feature/.env'), false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Legacy pre-modular online sync (<= v1.0.8-beta.3) cleanly lands complete src/ tree and boots cdp.js & daemon with 0 MODULE_NOT_FOUND', () => {
  const tmpDir = mkTmp('prism-legacy-upgrade-');
  try {
    const legacyPluginDir = path.join(tmpDir, 'plugin-legacy-beta3');
    fs.mkdirSync(path.join(legacyPluginDir, 'wallpapers'), { recursive: true });
    // Pre-existing legacy beta.3 state: stale cdp.js, NO src/ directory, user protected config/css/wallpaper
    const userConfig = JSON.stringify({ palette: 'warm', language: 'zh-CN', keepLegacyUpgrade: true }, null, 2) + '\n';
    const userCss = '/* preserve me across legacy upgrade */\n';
    const userWp = Buffer.from('LEGACY-WALLPAPER-DATA');
    fs.writeFileSync(path.join(legacyPluginDir, 'cdp.js'), '// stale beta.3 monolith cdp.js\n', 'utf8');
    fs.writeFileSync(path.join(legacyPluginDir, 'config.json'), userConfig, 'utf8');
    fs.writeFileSync(path.join(legacyPluginDir, 'custom.css'), userCss, 'utf8');
    fs.writeFileSync(path.join(legacyPluginDir, 'wallpapers', 'user.png'), userWp);
    assert.equal(fs.existsSync(path.join(legacyPluginDir, 'src')), false, 'Legacy beta.3 plugin starts with no src/ directory');

    const cfgShaBefore = computeFileSha256(path.join(legacyPluginDir, 'config.json'));
    const cssShaBefore = computeFileSha256(path.join(legacyPluginDir, 'custom.css'));
    const wpShaBefore = computeFileSha256(path.join(legacyPluginDir, 'wallpapers', 'user.png'));

    // Execute faithful replica of <= v1.0.8-beta.3 online Git sync
    const syncedCount = runLegacyPreModularRepoSync(ROOT, legacyPluginDir, ['cdp.js', 'style.css', 'ui-runtime.js']);
    assert.ok(syncedCount >= 100, `Expected legacy sync to copy >= 100 files, got ${syncedCount}`);

    // 1) Every src/ runtime file from repo must exist with identical SHA-256
    const expectedSrcFiles = collectManagedSubdirFiles(ROOT, 'src');
    for (const rel of expectedSrcFiles) {
      const dst = path.join(legacyPluginDir, ...rel.split('/'));
      assert.equal(fs.existsSync(dst), true, `Legacy sync missed src/ file: ${rel}`);
      assert.equal(
        computeFileSha256(dst),
        computeFileSha256(path.join(ROOT, ...rel.split('/'))),
        `SHA-256 drift on legacy-synced file: ${rel}`
      );
    }

    // 2) Protected user files remain byte-for-byte untouched
    assert.equal(computeFileSha256(path.join(legacyPluginDir, 'config.json')), cfgShaBefore);
    assert.equal(computeFileSha256(path.join(legacyPluginDir, 'custom.css')), cssShaBefore);
    assert.equal(computeFileSha256(path.join(legacyPluginDir, 'wallpapers', 'user.png')), wpShaBefore);

    // 3) Boot upgraded pluginDir/cdp.js and pluginDir/sidecars/daemon/main.mjs in a fresh isolated Node process (0 MODULE_NOT_FOUND)
    const probeScript = [
      'const path = require("node:path");',
      'const { pathToFileURL } = require("node:url");',
      'const dir = process.env.PRISM_UPGRADED_DIR;',
      'const cdpMod = require(path.join(dir, "cdp.js"));',
      'const expr = cdpMod.buildInjectExpression({ ...cdpMod.DEFAULT_CONFIG, language: "zh-CN" });',
      '(async () => {',
      '  const daemonMod = await import(pathToFileURL(path.join(dir, "sidecars", "daemon", "main.mjs")).href);',
      '  process.stdout.write(JSON.stringify({',
      '    version: cdpMod.PLUGIN_VERSION,',
      '    hasSyncSubdirs: Array.isArray(cdpMod.SYNC_SUBDIRS) && cdpMod.SYNC_SUBDIRS.includes("src"),',
      '    exprBytes: Buffer.byteLength(expr, "utf8"),',
      '    hasDaemonClass: typeof daemonMod.PrismDaemon === "function",',
      '    hasRepoSyncFn: typeof daemonMod.copyUpdatedRuntimeFromRepo === "function",',
      '  }));',
      '})().catch((err) => { console.error(err); process.exit(1); });',
    ].join('\n');

    const probeRaw = execFileSync(process.execPath, ['-e', probeScript], {
      cwd: legacyPluginDir,
      env: { ...process.env, PRISM_UPGRADED_DIR: legacyPluginDir },
      encoding: 'utf8',
      windowsHide: true,
    });
    const probe = JSON.parse(probeRaw);
    assert.equal(probe.version, cdp.PLUGIN_VERSION);
    assert.equal(probe.hasSyncSubdirs, true);
    assert.ok(probe.exprBytes > 10000, `Expected non-empty compiled Ch1 bundle, got ${probe.exprBytes} B`);
    assert.equal(probe.hasDaemonClass, true, 'sidecars/daemon/main.mjs must export PrismDaemon without MODULE_NOT_FOUND');
    assert.equal(probe.hasRepoSyncFn, true, 'sidecars/daemon/main.mjs must export copyUpdatedRuntimeFromRepo');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('repo-sync.cjs dynamically honors freshRepoCdp.SYNC_SUBDIRS, falls back cleanly, and blocks traversal/protected/excluded subdirs', () => {
  // 1) Pure unit verification of normalizeSyncSubdirs
  assert.deepEqual(normalizeSyncSubdirs(null), [...DEFAULT_SYNC_SUBDIRS]);
  assert.deepEqual(normalizeSyncSubdirs([]), [...DEFAULT_SYNC_SUBDIRS]);
  assert.deepEqual(
    normalizeSyncSubdirs(
      [
        'assets',
        'src',
        'SRC',
        'runtime-plugins/',
        '../outside',
        'a/../../escape',
        '/etc/passwd',
        'C:\\Windows',
        'nested\\backslash',
        '.git',
        '.bundle-cache',
        'assets/screenshots',
        'wallpapers',
        'backups',
        'config.json',
      ],
      { isProtectedPath: (p) => isProtectedUserPath(p, PROTECTED_USER_PATHS) }
    ),
    ['assets', 'src', 'runtime-plugins']
  );

  const tmpDir = mkTmp('prism-sync-subdirs-');
  try {
    // 2) Fresh repo declaring a brand-new top-level runtime directory + hostile traversal/protected entries in SYNC_SUBDIRS
    const repoA = path.join(tmpDir, 'repo-dynamic');
    const pluginA = path.join(tmpDir, 'plugin-dynamic');
    const outsideDir = path.join(tmpDir, 'outside');
    fs.mkdirSync(path.join(repoA, 'extensions', 'nested'), { recursive: true });
    fs.mkdirSync(path.join(repoA, 'src', 'core'), { recursive: true });
    fs.mkdirSync(path.join(repoA, 'wallpapers'), { recursive: true });
    fs.mkdirSync(path.join(repoA, 'assets', 'screenshots'), { recursive: true });
    fs.mkdirSync(path.join(repoA, '.git'), { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.mkdirSync(path.join(pluginA, 'wallpapers'), { recursive: true });
    fs.mkdirSync(path.join(pluginA, 'backups'), { recursive: true });

    fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'OUTSIDE-SECRET', 'utf8');
    fs.writeFileSync(
      path.join(repoA, 'cdp.js'),
      "module.exports = { SYNC_ROOT_FILES: ['cdp.js'], SYNC_SUBDIRS: ['src', 'extensions', '../outside', '/etc', 'C:\\\\Windows', '.git', 'assets/screenshots', 'wallpapers', 'backups', 'config.json'] };\n",
      'utf8'
    );
    fs.writeFileSync(path.join(repoA, 'src', 'core', 'boot.cjs'), 'module.exports = { ok: true };\n', 'utf8');
    fs.writeFileSync(path.join(repoA, 'extensions', 'nested', 'plugin-ext.mjs'), 'export const ext = 42;\n', 'utf8');
    fs.writeFileSync(path.join(repoA, 'wallpapers', 'evil.png'), 'OVERWRITE-ATTEMPT', 'utf8');
    fs.writeFileSync(path.join(repoA, 'assets', 'screenshots', 'demo.webp'), 'HUGE-SCREENSHOT', 'utf8');
    fs.writeFileSync(path.join(repoA, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8');

    // User protected files in target pluginDir
    fs.writeFileSync(path.join(pluginA, 'config.json'), '{"userKeep":true}\n', 'utf8');
    fs.writeFileSync(path.join(pluginA, 'custom.css'), '/* user keep */\n', 'utf8');
    fs.writeFileSync(path.join(pluginA, 'wallpapers', 'user.png'), 'USER-WP-KEEP', 'utf8');
    fs.writeFileSync(path.join(pluginA, 'backups', 'snap.json'), '{"keep":1}\n', 'utf8');

    const syncedA = copyUpdatedRuntimeFromRepo(repoA, pluginA, ['cdp.js']);
    assert.equal(syncedA, 3, 'Only cdp.js, src/core/boot.cjs, and extensions/nested/plugin-ext.mjs should be synced');
    assert.equal(fs.readFileSync(path.join(pluginA, 'extensions', 'nested', 'plugin-ext.mjs'), 'utf8'), 'export const ext = 42;\n');
    assert.equal(fs.readFileSync(path.join(pluginA, 'src', 'core', 'boot.cjs'), 'utf8'), 'module.exports = { ok: true };\n');

    // All hostile / excluded / protected paths must be blocked without touching user data
    assert.equal(fs.existsSync(path.join(pluginA, 'outside')), false);
    assert.equal(fs.existsSync(path.join(pluginA, 'wallpapers', 'evil.png')), false);
    assert.equal(fs.existsSync(path.join(pluginA, 'assets', 'screenshots', 'demo.webp')), false);
    assert.equal(fs.existsSync(path.join(pluginA, '.git')), false);
    assert.equal(fs.readFileSync(path.join(pluginA, 'config.json'), 'utf8'), '{"userKeep":true}\n');
    assert.equal(fs.readFileSync(path.join(pluginA, 'custom.css'), 'utf8'), '/* user keep */\n');
    assert.equal(fs.readFileSync(path.join(pluginA, 'wallpapers', 'user.png'), 'utf8'), 'USER-WP-KEEP');
    assert.equal(fs.readFileSync(path.join(pluginA, 'backups', 'snap.json'), 'utf8'), '{"keep":1}\n');
    assert.equal(
      fs.readdirSync(pluginA).some((n) => n.startsWith('.staging-') || n.startsWith('.rollback-')),
      false,
      'No temp staging/rollback dirs may remain'
    );

    // 3) Fallback to install-manifest.json syncSubdirs when repo cdp.js omits SYNC_SUBDIRS
    const repoB = path.join(tmpDir, 'repo-manifest-subdirs');
    const pluginB = path.join(tmpDir, 'plugin-manifest-subdirs');
    fs.mkdirSync(path.join(repoB, 'modules'), { recursive: true });
    fs.writeFileSync(path.join(repoB, 'cdp.js'), "module.exports = { SYNC_ROOT_FILES: ['cdp.js'] };\n", 'utf8');
    fs.writeFileSync(path.join(repoB, 'modules', 'feature.cjs'), 'module.exports = "from-manifest";\n', 'utf8');
    const manifestObj = {
      ...buildInstallManifest({
        version: '1.0.9',
        entries: [{ path: 'cdp.js', scope: 'plugin', data: Buffer.from("module.exports = { SYNC_ROOT_FILES: ['cdp.js'] };\n") }],
      }),
      syncSubdirs: ['modules', '../escape'],
    };
    fs.writeFileSync(path.join(repoB, INSTALL_MANIFEST_FILENAME), JSON.stringify(manifestObj, null, 2), 'utf8');

    const syncedB = copyUpdatedRuntimeFromRepo(repoB, pluginB, ['cdp.js']);
    assert.equal(syncedB, 2);
    assert.equal(fs.readFileSync(path.join(pluginB, 'modules', 'feature.cjs'), 'utf8'), 'module.exports = "from-manifest";\n');

    // 4) Fallback to DEFAULT_SYNC_SUBDIRS (assets/src/vendor/sidecars) when neither cdp.js nor manifest declares syncSubdirs
    const repoC = path.join(tmpDir, 'repo-default-fallback');
    const pluginC = path.join(tmpDir, 'plugin-default-fallback');
    fs.mkdirSync(path.join(repoC, 'src', 'utils'), { recursive: true });
    fs.mkdirSync(path.join(repoC, 'sidecars', 'daemon'), { recursive: true });
    fs.writeFileSync(path.join(repoC, 'cdp.js'), "module.exports = { SYNC_ROOT_FILES: ['cdp.js'] };\n", 'utf8');
    fs.writeFileSync(path.join(repoC, 'src', 'utils', 'u.cjs'), 'module.exports = 7;\n', 'utf8');
    fs.writeFileSync(path.join(repoC, 'sidecars', 'daemon', 'm.mjs'), 'export const m = 7;\n', 'utf8');

    const syncedC = copyUpdatedRuntimeFromRepo(repoC, pluginC, ['cdp.js']);
    assert.equal(syncedC, 3);
    assert.equal(fs.readFileSync(path.join(pluginC, 'src', 'utils', 'u.cjs'), 'utf8'), 'module.exports = 7;\n');
    assert.equal(fs.readFileSync(path.join(pluginC, 'sidecars', 'daemon', 'm.mjs'), 'utf8'), 'export const m = 7;\n');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
