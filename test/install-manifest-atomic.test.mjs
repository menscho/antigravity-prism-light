import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  INSTALL_MANIFEST_FILENAME,
  INSTALL_MANIFEST_SCHEMA_VERSION,
  INSTALL_MANIFEST_LAYOUT_VERSION,
  PROTECTED_USER_PATHS,
  PURGE_DATA_FILES,
  DEFAULT_OBSOLETE_PATHS,
  ATOMIC_UPGRADE_RETRY_BACKOFFS_MS,
  computeBufferSha256,
  computeFileSha256,
  isSafeManagedRelPath,
  isProtectedUserPath,
  shouldExcludeSyncRelPath,
  buildInstallManifest,
  applyManifestAtomicUpgrade,
} from '../src/platform/install-manifest.cjs';
import { copyUpdatedRuntimeFromRepo, syncPluginDirWithManifest } from '../src/platform/repo-sync.cjs';
import { collectNativePluginEntries, createInstallManifestPayload } from '../scripts/build-common.mjs';
import { buildLinuxPortable, parseTarEntries, ARCHIVE_ROOT_PREFIX } from '../scripts/build-linux.mjs';
// LIGHT (2026-11-27): scripts/build-installer.mjs (native .exe installer build) is removed.
const buildInstaller = null;

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const removeMod = require(path.join(ROOT, 'remove.js'));
const installPluginMod = require(path.join(ROOT, 'tools', 'install-plugin.cjs'));

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runExe(exePath, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, args, { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`Timeout running ${path.basename(exePath)}`));
    }, timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(exePath)} exited with code ${code}`));
    });
  });
}

test('isSafeManagedRelPath and isProtectedUserPath enforce strict path-traversal and case-insensitive prefix rules', () => {
  // Valid relative paths
  assert.equal(isSafeManagedRelPath('cdp.js'), true);
  assert.equal(isSafeManagedRelPath('vendor/omni-viewer/omni-client.js'), true);
  assert.equal(isSafeManagedRelPath('wallpapers/', { allowTrailingSlash: true }), true);
  assert.equal(isSafeManagedRelPath('wallpapers/'), false);

  // Forbidden traversal, absolute paths, drive letters, empty strings, control chars
  for (const bad of [
    '',
    '   ',
    '../evil.js',
    'a/../../evil.js',
    '..\\evil.js',
    '/etc/passwd',
    '\\windows\\system32\\cmd.exe',
    'C:\\Windows\\win.ini',
    'D:foo.txt',
    'foo:bar',
    './cdp.js',
    'a//b.js',
    'a/./b.js',
    'bad\0name.js',
    'bad\nname.js',
  ]) {
    assert.equal(isSafeManagedRelPath(bad), false, `Expected unsafe path to be rejected: ${JSON.stringify(bad)}`);
  }

  // Protected user path matching (case-insensitive + exact prefix boundary)
  assert.equal(isProtectedUserPath('config.json'), true);
  assert.equal(isProtectedUserPath('CONFIG.JSON'), true);
  assert.equal(isProtectedUserPath('custom.css'), true);
  assert.equal(isProtectedUserPath('Custom.CSS'), true);
  assert.equal(isProtectedUserPath('wallpapers/user.png'), true);
  assert.equal(isProtectedUserPath('Wallpapers\\nested\\bg.jpg'), true);
  assert.equal(isProtectedUserPath('backups/2026/config.json'), true);
  assert.equal(isProtectedUserPath('.bundle-cache.json'), true);
  assert.equal(isProtectedUserPath('repo-meta.json'), true);

  // Strict boundary: must NOT false-positive on sibling prefixes
  assert.equal(isProtectedUserPath('wallpapers-extra/foo.png'), false);
  assert.equal(isProtectedUserPath('config.json.example'), false);
  assert.equal(isProtectedUserPath('custom.css.map'), false);
  assert.equal(isProtectedUserPath('cdp.js'), false);

  // assets/screenshots exclusion
  assert.equal(shouldExcludeSyncRelPath('assets/screenshots'), true);
  assert.equal(shouldExcludeSyncRelPath('assets/screenshots/demo.webp'), true);
  assert.equal(shouldExcludeSyncRelPath('assets/logo.svg'), false);
});

test('applyManifestAtomicUpgrade succeeds cleanly: matches SHA-256, purges obsoletePaths, preserves all user data with zero temp remnants', () => {
  const tmpDir = mkTmp('prism-atomic-ok-');
  try {
    const targetDir = path.join(tmpDir, 'plugin');
    fs.mkdirSync(path.join(targetDir, 'wallpapers'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'legacy'), { recursive: true });

    const userConfig = JSON.stringify({ palette: 'warm', accentTone: 'iris', customFlag: true }, null, 2) + '\n';
    const userCss = '/* user custom overrides */\nbody { --my-color: #123456; }\n';
    const userWallpaper = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

    fs.writeFileSync(path.join(targetDir, 'config.json'), userConfig, 'utf8');
    fs.writeFileSync(path.join(targetDir, 'custom.css'), userCss, 'utf8');
    fs.writeFileSync(path.join(targetDir, 'wallpapers', 'user.png'), userWallpaper);
    fs.writeFileSync(path.join(targetDir, 'cdp.js'), '// old v1.0.7 cdp\n', 'utf8');
    fs.writeFileSync(path.join(targetDir, 'legacy', 'deprecated-module.js'), '// obsolete\n', 'utf8');

    const cfgShaBefore = computeFileSha256(path.join(targetDir, 'config.json'));
    const cssShaBefore = computeFileSha256(path.join(targetDir, 'custom.css'));
    const wpShaBefore = computeFileSha256(path.join(targetDir, 'wallpapers', 'user.png'));

    const newCdp = Buffer.from('// new v1.0.8 cdp\nmodule.exports = { v: 2 };\n', 'utf8');
    const newMod = Buffer.from('export const ok = true;\n', 'utf8');
    const defaultCfgInPkg = Buffer.from('{"palette":"obsidian"}\n', 'utf8');

    const manifest = buildInstallManifest({
      version: '1.0.8-beta.3',
      entries: [
        { path: 'cdp.js', scope: 'both', data: newCdp },
        { path: 'src/new-mod.mjs', scope: 'plugin', data: newMod },
        { path: 'config.json', scope: 'both', data: defaultCfgInPkg },
      ],
      obsoletePaths: ['legacy/deprecated-module.js'],
    });
    assert.equal(manifest.schemaVersion, INSTALL_MANIFEST_SCHEMA_VERSION);
    assert.equal(manifest.layoutVersion, INSTALL_MANIFEST_LAYOUT_VERSION);

    const res = applyManifestAtomicUpgrade({
      targetDir,
      stagedFiles: [
        { path: 'cdp.js', data: newCdp },
        { path: 'src/new-mod.mjs', data: newMod },
        { path: 'config.json', data: defaultCfgInPkg },
      ],
      manifest,
    });

    assert.equal(res.ok, true);
    assert.deepEqual(res.appliedFiles.sort(), ['cdp.js', 'src/new-mod.mjs']);
    assert.ok(res.preservedProtected.includes('config.json'));
    assert.deepEqual(res.removedObsolete, ['legacy/deprecated-module.js']);
    assert.equal(res.verifiedCount, 2);

    // 1) New managed files match manifest SHA-256 100%
    assert.equal(computeFileSha256(path.join(targetDir, 'cdp.js')), computeBufferSha256(newCdp));
    assert.equal(computeFileSha256(path.join(targetDir, 'src', 'new-mod.mjs')), computeBufferSha256(newMod));

    // 2) Obsolete files and emptied parent dir have 0 residue
    assert.equal(fs.existsSync(path.join(targetDir, 'legacy', 'deprecated-module.js')), false);
    assert.equal(fs.existsSync(path.join(targetDir, 'legacy')), false);

    // 3) User data files have 0 byte drift
    assert.equal(computeFileSha256(path.join(targetDir, 'config.json')), cfgShaBefore);
    assert.equal(computeFileSha256(path.join(targetDir, 'custom.css')), cssShaBefore);
    assert.equal(computeFileSha256(path.join(targetDir, 'wallpapers', 'user.png')), wpShaBefore);

    // 4) Zero staging or rollback temp dirs left behind
    const topNames = fs.readdirSync(targetDir);
    assert.equal(topNames.some((n) => n.startsWith('.staging-') || n.startsWith('.rollback-')), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('applyManifestAtomicUpgrade rolls back atomically on SHA-256 mismatch and mid-commit write failure, and retries transient EBUSY locks', () => {
  const tmpDir = mkTmp('prism-atomic-rb-');
  try {
    const targetDir = path.join(tmpDir, 'plugin');
    fs.mkdirSync(path.join(targetDir, 'wallpapers'), { recursive: true });

    const origA = '// old a.js v1\n';
    const origB = '// old b.js v1\n';
    const origObs = '// old obsolete v1\n';
    const userCfg = '{"palette":"claude","keep":1}\n';
    const userCss = '.user { color: gold; }\n';
    const userWp = Buffer.from('PNG-USER-WALLPAPER');

    fs.writeFileSync(path.join(targetDir, 'a.js'), origA, 'utf8');
    fs.writeFileSync(path.join(targetDir, 'b.js'), origB, 'utf8');
    fs.writeFileSync(path.join(targetDir, 'old-dead.js'), origObs, 'utf8');
    fs.writeFileSync(path.join(targetDir, 'config.json'), userCfg, 'utf8');
    fs.writeFileSync(path.join(targetDir, 'custom.css'), userCss, 'utf8');
    fs.writeFileSync(path.join(targetDir, 'wallpapers', 'user.png'), userWp);

    const newA = Buffer.from('// new a.js v2\n', 'utf8');
    const newB = Buffer.from('// new b.js v2\n', 'utf8');
    const newC = Buffer.from('// brand new c.js v2\n', 'utf8');

    const manifest = buildInstallManifest({
      version: '1.0.8-beta.3',
      entries: [
        { path: 'a.js', scope: 'plugin', data: newA },
        { path: 'b.js', scope: 'plugin', data: newB },
        { path: 'sub/c.js', scope: 'plugin', data: newC },
      ],
      obsoletePaths: ['old-dead.js'],
    });

    // Scenario A: SHA-256 verification failure in Stage 1 (tampered staging file)
    assert.throws(
      () =>
        applyManifestAtomicUpgrade({
          targetDir,
          stagedFiles: [
            { path: 'a.js', data: newA },
            { path: 'b.js', data: newB },
            { path: 'sub/c.js', data: newC },
          ],
          manifest,
          _testHooks: {
            afterStage({ stagingDir }) {
              fs.writeFileSync(path.join(stagingDir, 'b.js'), '// corrupted during staging', 'utf8');
            },
          },
        }),
      (err) => err && err.code === 'SHA256_MISMATCH' && err.rolledBack === true
    );
    assert.equal(fs.readFileSync(path.join(targetDir, 'a.js'), 'utf8'), origA);
    assert.equal(fs.readFileSync(path.join(targetDir, 'b.js'), 'utf8'), origB);
    assert.equal(fs.existsSync(path.join(targetDir, 'sub', 'c.js')), false);
    assert.equal(fs.readFileSync(path.join(targetDir, 'old-dead.js'), 'utf8'), origObs);
    assert.equal(fs.readFileSync(path.join(targetDir, 'config.json'), 'utf8'), userCfg);

    // Scenario B: Mid-commit failure after a.js was replaced and sub/c.js created -> must roll back ALL committed ops
    assert.throws(
      () =>
        applyManifestAtomicUpgrade({
          targetDir,
          stagedFiles: [
            { path: 'a.js', data: newA },
            { path: 'b.js', data: newB },
            { path: 'sub/c.js', data: newC },
          ],
          manifest,
          _testHooks: {
            beforeCommitFile(relPath) {
              if (relPath === 'sub/c.js') {
                const err = new Error('Simulated disk I/O interruption');
                err.code = 'EIO';
                throw err;
              }
            },
          },
        }),
      (err) => err && err.code === 'EIO' && err.rolledBack === true
    );

    assert.equal(fs.readFileSync(path.join(targetDir, 'a.js'), 'utf8'), origA, 'a.js must roll back to original v1');
    assert.equal(fs.readFileSync(path.join(targetDir, 'b.js'), 'utf8'), origB, 'b.js must roll back to original v1');
    assert.equal(fs.existsSync(path.join(targetDir, 'sub', 'c.js')), false, 'newly created sub/c.js must be removed on rollback');
    assert.equal(fs.readFileSync(path.join(targetDir, 'old-dead.js'), 'utf8'), origObs, 'obsolete file must remain intact on rollback');
    assert.equal(fs.readFileSync(path.join(targetDir, 'config.json'), 'utf8'), userCfg);
    assert.equal(fs.readFileSync(path.join(targetDir, 'custom.css'), 'utf8'), userCss);
    assert.deepEqual(fs.readFileSync(path.join(targetDir, 'wallpapers', 'user.png')), userWp);
    assert.equal(
      fs.readdirSync(targetDir).some((n) => n.startsWith('.staging-') || n.startsWith('.rollback-')),
      false,
      'Rollback must leave zero .staging-* or .rollback-* temp directories'
    );

    // Scenario C: Transient Windows AV lock (EBUSY twice) recovers via [100, 250, 500] backoff retries
    let lockAttempts = 0;
    const sleepCalls = [];
    const retryRes = applyManifestAtomicUpgrade({
      targetDir,
      stagedFiles: [
        { path: 'a.js', data: newA },
        { path: 'b.js', data: newB },
        { path: 'sub/c.js', data: newC },
      ],
      manifest,
      _testHooks: {
        sleepSync(ms) {
          sleepCalls.push(ms);
        },
        renameSync(src, dst) {
          if (path.basename(dst) === 'a.js' && lockAttempts < 2) {
            lockAttempts += 1;
            const err = new Error('AV scanner temporary lock');
            err.code = 'EBUSY';
            throw err;
          }
          fs.renameSync(src, dst);
        },
      },
    });
    assert.equal(retryRes.ok, true);
    assert.deepEqual(sleepCalls, ATOMIC_UPGRADE_RETRY_BACKOFFS_MS.slice(0, 2));
    assert.equal(computeFileSha256(path.join(targetDir, 'a.js')), computeBufferSha256(newA));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('applyManifestAtomicUpgrade blocks path traversal (../evil) and refuses deleting protected user files smuggled into obsoletePaths', () => {
  const tmpDir = mkTmp('prism-atomic-sec-');
  try {
    const targetDir = path.join(tmpDir, 'plugin');
    const outsideEvil = path.join(tmpDir, 'evil.txt');
    fs.mkdirSync(path.join(targetDir, 'wallpapers'), { recursive: true });
    fs.writeFileSync(outsideEvil, 'OUTSIDE-KEEP', 'utf8');
    fs.writeFileSync(path.join(targetDir, 'config.json'), '{"keep":"cfg"}\n', 'utf8');
    fs.writeFileSync(path.join(targetDir, 'custom.css'), '/* keep custom css */\n', 'utf8');
    fs.writeFileSync(path.join(targetDir, 'wallpapers', 'user.png'), 'IMG-KEEP', 'utf8');
    fs.writeFileSync(path.join(targetDir, 'safe-obsolete.js'), '// delete me', 'utf8');

    const okFile = Buffer.from('// ok\n', 'utf8');

    // 1) Staged path traversal must be rejected upfront
    const goodManifest = buildInstallManifest({
      version: '1.0.8-beta.3',
      entries: [{ path: 'ok.js', scope: 'plugin', data: okFile }],
    });
    assert.throws(
      () =>
        applyManifestAtomicUpgrade({
          targetDir,
          stagedFiles: [
            { path: 'ok.js', data: okFile },
            { path: '../evil.txt', data: Buffer.from('PWNED') },
          ],
          manifest: goodManifest,
        }),
      /Unsafe staged file path/i
    );
    assert.equal(fs.readFileSync(outsideEvil, 'utf8'), 'OUTSIDE-KEEP');

    // 2) Crafted raw manifest smuggling ../evil.txt, config.json, custom.css, wallpapers/user.png into obsoletePaths
    const hostileManifest = {
      ...goodManifest,
      obsoletePaths: [
        '../evil.txt',
        'config.json',
        'custom.css',
        'wallpapers/user.png',
        'safe-obsolete.js',
      ],
    };
    const res = applyManifestAtomicUpgrade({
      targetDir,
      stagedFiles: [{ path: 'ok.js', data: okFile }],
      manifest: hostileManifest,
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.removedObsolete, ['safe-obsolete.js']);
    assert.equal(fs.existsSync(path.join(targetDir, 'safe-obsolete.js')), false);

    // All traversal & protected files MUST survive untouched
    assert.equal(fs.readFileSync(outsideEvil, 'utf8'), 'OUTSIDE-KEEP');
    assert.equal(fs.readFileSync(path.join(targetDir, 'config.json'), 'utf8'), '{"keep":"cfg"}\n');
    assert.equal(fs.readFileSync(path.join(targetDir, 'custom.css'), 'utf8'), '/* keep custom css */\n');
    assert.equal(fs.readFileSync(path.join(targetDir, 'wallpapers', 'user.png'), 'utf8'), 'IMG-KEEP');

    const rejectedMap = new Map(res.rejectedObsolete.map((r) => [r.path, r.reason]));
    assert.equal(rejectedMap.get('../evil.txt'), 'unsafe_path');
    assert.equal(rejectedMap.get('config.json'), 'protected_user_path');
    assert.equal(rejectedMap.get('custom.css'), 'protected_user_path');
    assert.equal(rejectedMap.get('wallpapers/user.png'), 'protected_user_path');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Cross-platform sync parity: assets/screenshots excluded, remove.js aligns PURGE_DATA_FILES, user custom.css/wallpapers preserved on default uninstall, and packages include install-manifest.json', async () => {
  // 1) remove.js PURGE_EXACT_FILES aligns 100% with SSOT PURGE_DATA_FILES (including obsidian-prism-storage-guard-state.json)
  assert.ok(PURGE_DATA_FILES.includes('obsidian-prism-storage-guard-state.json'));
  assert.deepEqual([...removeMod.PURGE_EXACT_FILES].sort(), [...PURGE_DATA_FILES].sort());

  // 2) build-common & build-linux exclude assets/screenshots and include install-manifest.json
  const nativeEntries = collectNativePluginEntries();
  assert.equal(
    nativeEntries.some((e) => e.name.toLowerCase().includes('assets/screenshots')),
    false,
    'collectNativePluginEntries must exclude assets/screenshots'
  );
  const manifestPayload = createInstallManifestPayload({
    version: '1.0.8-beta.3',
    installEntries: [],
    pluginEntries: nativeEntries,
  });
  assert.equal(manifestPayload.manifest.schemaVersion, 2);
  assert.equal(manifestPayload.manifest.layoutVersion, 2);

  const tmpDir = mkTmp('prism-parity-');
  try {
    // Linux portable tarball contains both top-level and native-plugin/install-manifest.json and 0 assets/screenshots
    const outTarGz = path.join(tmpDir, 'linux.tar.gz');
    buildLinuxPortable({ outPath: outTarGz });
    const tarEntries = parseTarEntries(fs.readFileSync(outTarGz));
    const names = new Set(tarEntries.map((e) => e.name));
    assert.equal(names.has(`${ARCHIVE_ROOT_PREFIX}/${INSTALL_MANIFEST_FILENAME}`), true);
    assert.equal(names.has(`${ARCHIVE_ROOT_PREFIX}/native-plugin/${INSTALL_MANIFEST_FILENAME}`), true);
    assert.equal(
      [...names].some((n) => n.toLowerCase().includes('assets/screenshots')),
      false,
      'Linux tarball must exclude assets/screenshots'
    );

    // 3) copyUpdatedRuntimeFromRepo excludes assets/screenshots, preserves custom.css/wallpapers/, and cleans obsoletePaths
    const fakeRepo = path.join(tmpDir, 'repo');
    const fakePlugin = path.join(tmpDir, 'plugin');
    fs.mkdirSync(path.join(fakeRepo, 'assets', 'screenshots'), { recursive: true });
    fs.mkdirSync(path.join(fakePlugin, 'wallpapers'), { recursive: true });
    fs.writeFileSync(path.join(fakeRepo, 'style.css'), '/* new style */\n', 'utf8');
    fs.writeFileSync(path.join(fakeRepo, 'assets', 'logo.svg'), '<svg/>', 'utf8');
    fs.writeFileSync(path.join(fakeRepo, 'assets', 'screenshots', 'big.webp'), 'HUGE-SCREENSHOT', 'utf8');
    fs.writeFileSync(path.join(fakeRepo, 'custom.css'), '/* should not overwrite */', 'utf8');
    fs.writeFileSync(
      path.join(fakeRepo, INSTALL_MANIFEST_FILENAME),
      JSON.stringify(
        buildInstallManifest({
          version: '1.0.8-beta.3',
          entries: [{ path: 'style.css', scope: 'plugin', data: Buffer.from('/* new style */\n') }],
          obsoletePaths: ['stale-old.js'],
        }),
        null,
        2
      ),
      'utf8'
    );
    fs.writeFileSync(path.join(fakePlugin, 'custom.css'), '/* my user css */', 'utf8');
    fs.writeFileSync(path.join(fakePlugin, 'wallpapers', 'user.png'), 'MY-WP', 'utf8');
    fs.writeFileSync(path.join(fakePlugin, 'stale-old.js'), '// remove me', 'utf8');

    copyUpdatedRuntimeFromRepo(fakeRepo, fakePlugin, ['style.css', 'custom.css']);
    assert.equal(fs.existsSync(path.join(fakePlugin, 'assets', 'logo.svg')), true);
    assert.equal(fs.existsSync(path.join(fakePlugin, 'assets', 'screenshots', 'big.webp')), false);
    assert.equal(fs.readFileSync(path.join(fakePlugin, 'custom.css'), 'utf8'), '/* my user css */');
    assert.equal(fs.readFileSync(path.join(fakePlugin, 'wallpapers', 'user.png'), 'utf8'), 'MY-WP');
    assert.equal(fs.existsSync(path.join(fakePlugin, 'stale-old.js')), false);

    // 4) tools/install-plugin.cjs excludes assets/screenshots and spares user custom.css/wallpapers/ on default uninstall
    const hostCfgDir = path.join(tmpDir, '.gemini', 'config');
    const pluginTarget = path.join(hostCfgDir, 'plugins', 'obsidian-prism');
    fs.mkdirSync(hostCfgDir, { recursive: true });
    await installPluginMod.installPlugin({
      sourceDir: ROOT,
      targetDir: pluginTarget,
      hostConfigDir: hostCfgDir,
      startDaemon: false,
      syncShortcuts: false,
    });
    assert.equal(
      fs.existsSync(path.join(pluginTarget, 'assets', 'screenshots')),
      false,
      'tools/install-plugin.cjs must not copy assets/screenshots'
    );

    fs.mkdirSync(path.join(pluginTarget, 'wallpapers'), { recursive: true });
    fs.writeFileSync(path.join(pluginTarget, 'custom.css'), '/* user theme */\n', 'utf8');
    fs.writeFileSync(path.join(pluginTarget, 'wallpapers', 'user.png'), 'USER-PNG', 'utf8');

    // Default uninstall preserves user custom.css and wallpapers/user.png while removing managed files
    await installPluginMod.uninstallPlugin({
      targetDir: pluginTarget,
      hostConfigDir: hostCfgDir,
      noCdp: true,
      syncShortcuts: false,
      purgeData: false,
    });
    assert.equal(fs.existsSync(path.join(pluginTarget, 'cdp.js')), false, 'Managed cdp.js must be removed on default uninstall');
    assert.equal(fs.readFileSync(path.join(pluginTarget, 'custom.css'), 'utf8'), '/* user theme */\n');
    assert.equal(fs.readFileSync(path.join(pluginTarget, 'wallpapers', 'user.png'), 'utf8'), 'USER-PNG');

    // --purge-data removes pluginTarget cleanly (including storage-guard-state.json in hostConfigDir)
    const storageGuardFile = path.join(hostCfgDir, 'obsidian-prism-storage-guard-state.json');
    fs.writeFileSync(storageGuardFile, '{"dismissed":true}\n', 'utf8');
    await installPluginMod.uninstallPlugin({
      targetDir: pluginTarget,
      hostConfigDir: hostCfgDir,
      noCdp: true,
      syncShortcuts: false,
      purgeData: true,
    });
    assert.equal(fs.existsSync(pluginTarget), false);
    assert.equal(fs.existsSync(storageGuardFile), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test(
  'Windows PE metadata + SignPath two-step build (--watcher-only -> --prebuilt-watcher) and installer.exe upgrade preserve custom.css & wallpapers',
  { skip: 'safe build: native installers removed' },
  async () => {
    const tmpDir = mkTmp('prism-twostep-');
    try {
      const watcherExe = path.join(tmpDir, 'step1', 'obsidian-prism-watcher.exe');
      const installerExe = path.join(tmpDir, 'step2', 'obsidian-prism-installer.exe');

      // Step 1: --watcher-only
      const wRes = buildInstaller({ outputPath: watcherExe, watcherOnly: true });
      assert.equal(wRes.mode, 'watcher-only');
      assert.equal(fs.existsSync(watcherExe), true);

      // Step 2: --prebuilt-watcher
      const iRes = buildInstaller({ outputPath: installerExe, prebuiltWatcherPath: watcherExe });
      assert.equal(iRes.mode, 'prebuilt-watcher');
      assert.equal(iRes.usedPrebuiltWatcher, true);
      assert.equal(fs.existsSync(installerExe), true);

      // Inspect real Windows PE FileVersionInfo on both binaries
      const peJson = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `$w=[System.Diagnostics.FileVersionInfo]::GetVersionInfo('${watcherExe.replace(/'/g, "''")}');` +
            `$i=[System.Diagnostics.FileVersionInfo]::GetVersionInfo('${installerExe.replace(/'/g, "''")}');` +
            '@{w=@{prod=$w.ProductName;ver=$w.FileVersion;info=$w.ProductVersion;co=$w.CompanyName;desc=$w.FileDescription};' +
            'i=@{prod=$i.ProductName;ver=$i.FileVersion;info=$i.ProductVersion;co=$i.CompanyName;desc=$i.FileDescription}} | ConvertTo-Json -Compress',
        ],
        { encoding: 'utf8', windowsHide: true }
      ).trim();
      const pe = JSON.parse(peJson);
      assert.equal(pe.w.prod, 'Obsidian Prism');
      assert.equal(pe.i.prod, 'Obsidian Prism');
      assert.equal(pe.w.ver, iRes.windows4);
      assert.equal(pe.i.ver, iRes.windows4);
      assert.equal(pe.w.info, iRes.version);
      assert.equal(pe.i.info, iRes.version);

      // Verify installer.exe deploys install-manifest.json and preserves pre-existing custom.css & wallpapers/user.png
      const installDir = path.join(tmpDir, 'installed');
      const pluginDir = path.join(tmpDir, 'plugins', 'obsidian-prism');
      fs.mkdirSync(path.join(pluginDir, 'wallpapers'), { recursive: true });
      fs.writeFileSync(path.join(pluginDir, 'custom.css'), '/* win user css */\n', 'utf8');
      fs.writeFileSync(path.join(pluginDir, 'wallpapers', 'user.png'), 'WIN-USER-WP', 'utf8');
      const outJson = path.join(tmpDir, 'install-out.json');

      await runExe(installerExe, [
        '--silent',
        '--no-autostart',
        '--no-kill-legacy',
        '--no-native-daemon',
        '--install-dir',
        installDir,
        '--plugin-dir',
        pluginDir,
        '--out',
        outJson,
      ]);

      const res = JSON.parse(fs.readFileSync(outJson, 'utf8'));
      assert.equal(res.ok, true);
      assert.equal(fs.existsSync(path.join(installDir, INSTALL_MANIFEST_FILENAME)), true);
      assert.equal(fs.existsSync(path.join(pluginDir, INSTALL_MANIFEST_FILENAME)), true);
      assert.equal(fs.existsSync(path.join(pluginDir, 'tools', 'install-plugin.cjs')), true);
      assert.equal(fs.readFileSync(path.join(pluginDir, 'custom.css'), 'utf8'), '/* win user css */\n');
      assert.equal(fs.readFileSync(path.join(pluginDir, 'wallpapers', 'user.png'), 'utf8'), 'WIN-USER-WP');

      // Stop watcher started during install test and wait briefly for Windows handle release
      const pidFile = path.join(installDir, '.watch.pid');
      if (fs.existsSync(pidFile)) {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
        if (pid > 0) {
          try { process.kill(pid); } catch {}
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
    }
  }
);

test('Rollback failure preserves .rollback-* backup directory on disk and reports backup path clearly in error', () => {
  const tmpDir = mkTmp('prism-rb-preserve-');
  try {
    const targetDir = path.join(tmpDir, 'plugin');
    fs.mkdirSync(targetDir, { recursive: true });
    const origA = '// original a.js v1\n';
    const origB = '// original b.js v1\n';
    fs.writeFileSync(path.join(targetDir, 'a.js'), origA, 'utf8');
    fs.writeFileSync(path.join(targetDir, 'b.js'), origB, 'utf8');

    const newA = Buffer.from('// new a.js v2\n', 'utf8');
    const newB = Buffer.from('// new b.js v2\n', 'utf8');
    const manifest = buildInstallManifest({
      version: '1.0.8-beta.3',
      entries: [
        { path: 'a.js', scope: 'plugin', data: newA },
        { path: 'b.js', scope: 'plugin', data: newB },
      ],
    });

    let caught = null;
    try {
      applyManifestAtomicUpgrade({
        targetDir,
        stagedFiles: [
          { path: 'a.js', data: newA },
          { path: 'b.js', data: newB },
        ],
        manifest,
        _testHooks: {
          sleepSync() {},
          beforeCommitFile(relPath) {
            if (relPath === 'b.js') {
              const e = new Error('Simulated commit failure on b.js');
              e.code = 'EIO';
              throw e;
            }
          },
          rollbackRenameSync() {
            const e = new Error('Simulated rollback rename failure');
            e.code = 'EIO';
            throw e;
          },
          rollbackCopyFileSync() {
            const e = new Error('Simulated rollback copy failure');
            e.code = 'EIO';
            throw e;
          },
        },
      });
    } catch (err) {
      caught = err;
    }

    assert.ok(caught, 'Expected atomic upgrade to throw when commit and rollback fail');
    assert.equal(caught.rolledBack, false, 'rolledBack must be false when rollback has failed files');
    assert.equal(caught.rollbackResult?.ok, false);
    assert.ok(caught.rollbackResult?.failedFiles?.some((f) => f.path === 'a.js'));
    assert.ok(typeof caught.rollbackBackupDir === 'string' && caught.rollbackBackupDir.length > 0);
    assert.ok(
      caught.message.includes(caught.rollbackBackupDir),
      'Error message must clearly print preserved .rollback-* backup directory path'
    );
    assert.equal(fs.existsSync(caught.rollbackBackupDir), true, '.rollback-* directory MUST be preserved when rollback fails');
    assert.equal(
      fs.readFileSync(path.join(caught.rollbackBackupDir, 'a.js'), 'utf8'),
      origA,
      'Original backup snapshot of a.js must remain intact inside preserved .rollback-* directory'
    );
    // Staging dir should still be cleaned up
    assert.equal(
      fs.readdirSync(targetDir).some((n) => n.startsWith('.staging-')),
      false,
      '.staging-* temp directory should still be cleaned up'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Production sync paths (repo-sync.cjs & tools/install-plugin.cjs) execute real applyManifestAtomicUpgrade transactions and protect user data', async () => {
  const tmpDir = mkTmp('prism-prod-atomic-');
  try {
    // 1) copyUpdatedRuntimeFromRepo routes through applyManifestAtomicUpgrade (rolls back mid-commit failure & preserves user files)
    const fakeRepo = path.join(tmpDir, 'repo');
    const fakePlugin = path.join(tmpDir, 'plugin-repo-sync');
    fs.mkdirSync(path.join(fakeRepo, 'src', 'utils'), { recursive: true });
    fs.mkdirSync(path.join(fakePlugin, 'wallpapers'), { recursive: true });
    fs.writeFileSync(path.join(fakeRepo, 'style.css'), '/* v2 style */\n', 'utf8');
    fs.writeFileSync(path.join(fakeRepo, 'ui-runtime.js'), '// v2 runtime\n', 'utf8');
    fs.writeFileSync(path.join(fakeRepo, 'src', 'utils', 'demo.cjs'), 'module.exports = 2;\n', 'utf8');
    fs.writeFileSync(path.join(fakePlugin, 'style.css'), '/* v1 style */\n', 'utf8');
    fs.writeFileSync(path.join(fakePlugin, 'ui-runtime.js'), '// v1 runtime\n', 'utf8');
    fs.writeFileSync(path.join(fakePlugin, 'config.json'), '{"palette":"warm","userKeep":true}\n', 'utf8');
    fs.writeFileSync(path.join(fakePlugin, 'custom.css'), '/* user-css-keep */\n', 'utf8');
    fs.writeFileSync(path.join(fakePlugin, 'wallpapers', 'bg.png'), 'USER-BG-BYTES', 'utf8');

    let sawStagingInRepoSync = false;
    assert.throws(
      () =>
        copyUpdatedRuntimeFromRepo(fakeRepo, fakePlugin, ['style.css', 'ui-runtime.js'], {
          _testHooks: {
            afterStage({ stagingDir }) {
              sawStagingInRepoSync = fs.existsSync(stagingDir);
            },
            beforeCommitFile(relPath) {
              if (relPath === 'ui-runtime.js') {
                const e = new Error('Simulated failure during repo-sync commit');
                e.code = 'EIO';
                throw e;
              }
            },
          },
        }),
      (err) => err && err.code === 'EIO' && err.rolledBack === true
    );
    assert.equal(sawStagingInRepoSync, true, 'copyUpdatedRuntimeFromRepo must execute Stage 1 staging');
    assert.equal(fs.readFileSync(path.join(fakePlugin, 'style.css'), 'utf8'), '/* v1 style */\n', 'style.css must roll back to v1');
    assert.equal(fs.readFileSync(path.join(fakePlugin, 'ui-runtime.js'), 'utf8'), '// v1 runtime\n', 'ui-runtime.js must remain v1');
    assert.equal(fs.existsSync(path.join(fakePlugin, 'src', 'utils', 'demo.cjs')), false, 'new file must be removed on rollback');
    assert.equal(fs.readFileSync(path.join(fakePlugin, 'config.json'), 'utf8'), '{"palette":"warm","userKeep":true}\n');
    assert.equal(fs.readFileSync(path.join(fakePlugin, 'custom.css'), 'utf8'), '/* user-css-keep */\n');
    assert.equal(fs.readFileSync(path.join(fakePlugin, 'wallpapers', 'bg.png'), 'utf8'), 'USER-BG-BYTES');

    // Successful run updates atomically while still protecting user data
    const syncedCount = copyUpdatedRuntimeFromRepo(fakeRepo, fakePlugin, ['style.css', 'ui-runtime.js']);
    assert.equal(syncedCount, 3);
    assert.equal(fs.readFileSync(path.join(fakePlugin, 'style.css'), 'utf8'), '/* v2 style */\n');
    assert.equal(fs.readFileSync(path.join(fakePlugin, 'src', 'utils', 'demo.cjs'), 'utf8'), 'module.exports = 2;\n');
    assert.equal(fs.readFileSync(path.join(fakePlugin, 'config.json'), 'utf8'), '{"palette":"warm","userKeep":true}\n');
    assert.equal(fs.readFileSync(path.join(fakePlugin, 'custom.css'), 'utf8'), '/* user-css-keep */\n');
    assert.equal(fs.readFileSync(path.join(fakePlugin, 'wallpapers', 'bg.png'), 'utf8'), 'USER-BG-BYTES');

    // 2) tools/install-plugin.cjs installPlugin & syncPluginDirWithManifest execute real atomic transactions
    const hostCfgDir = path.join(tmpDir, '.gemini', 'config');
    const installTarget = path.join(hostCfgDir, 'plugins', 'obsidian-prism');
    fs.mkdirSync(path.join(installTarget, 'wallpapers'), { recursive: true });
    fs.writeFileSync(path.join(installTarget, 'config.json'), '{"palette":"nord","keep":42}\n', 'utf8');
    fs.writeFileSync(path.join(installTarget, 'custom.css'), '/* install user css */\n', 'utf8');
    fs.writeFileSync(path.join(installTarget, 'wallpapers', 'hero.webp'), 'USER-HERO', 'utf8');

    let sawStagingInInstall = false;
    let sawVerifyInInstall = false;
    const installRes = await installPluginMod.installPlugin({
      sourceDir: ROOT,
      targetDir: installTarget,
      hostConfigDir: hostCfgDir,
      startDaemon: false,
      syncShortcuts: false,
      _atomicTestHooks: {
        afterStage({ stagingDir }) {
          sawStagingInInstall = fs.existsSync(stagingDir);
        },
        beforeVerify({ deployPlan }) {
          sawVerifyInInstall = Array.isArray(deployPlan) && deployPlan.length > 10;
        },
      },
    });
    assert.equal(installRes.ok, true);
    assert.equal(sawStagingInInstall, true, 'installPlugin must run applyManifestAtomicUpgrade staging');
    assert.equal(sawVerifyInInstall, true, 'installPlugin must run applyManifestAtomicUpgrade post-commit SHA-256 verification');
    assert.equal(fs.readFileSync(path.join(installTarget, 'config.json'), 'utf8'), '{"palette":"nord","keep":42}\n');
    assert.equal(fs.readFileSync(path.join(installTarget, 'custom.css'), 'utf8'), '/* install user css */\n');
    assert.equal(fs.readFileSync(path.join(installTarget, 'wallpapers', 'hero.webp'), 'utf8'), 'USER-HERO');
    assert.equal(typeof syncPluginDirWithManifest, 'function');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('DEFAULT_OBSOLETE_PATHS covers retired dead files safely and copyDirRecursiveSync executes atomic upgrade with rollback & user-data protection', () => {
  const expectedRetired = [
    'vendor/swarm-prism/index.js',
    'vendor/swarm-prism/swarm-assets.js',
    'vendor/swarm-prism/swarm-i18n.js',
    'vendor/swarm-prism/swarm-prism.css',
    'vendor/swarm-prism/swarm-runtime.js',
    'vendor/wallpaper/studio-ui/index.html',
    'vendor/wallpaper/studio-ui/studio.css',
    'vendor/wallpaper/studio-ui/studio.js',
    'vendor/wallpaper/wallpaper-hud.js',
    'vendor/wallpaper/wallpaper-procedural.js',
    'tools/patch-asar.cjs',
    'src/channels/inject-runtime-channels.cjs',
  ];

  for (const rel of expectedRetired) {
    assert.ok(DEFAULT_OBSOLETE_PATHS.includes(rel), `DEFAULT_OBSOLETE_PATHS missing retired file: ${rel}`);
    assert.equal(isSafeManagedRelPath(rel), true, `Retired obsolete path must be safe relative path: ${rel}`);
    assert.equal(isProtectedUserPath(rel, PROTECTED_USER_PATHS), false, `Obsolete path must never target protected user path: ${rel}`);
    assert.equal(fs.existsSync(path.join(ROOT, ...rel.split('/'))), false, `Obsolete path must not exist in active repository: ${rel}`);
  }

  // Active wallpaper runtime modules must never appear in DEFAULT_OBSOLETE_PATHS
  for (const activeFile of [
    'vendor/wallpaper/wallpaper-client.js',
    'vendor/wallpaper/wallpaper-service.mjs',
    'vendor/wallpaper/wallpaper-settings-ui.js',
  ]) {
    assert.equal(DEFAULT_OBSOLETE_PATHS.includes(activeFile), false, `Active runtime file must not be in DEFAULT_OBSOLETE_PATHS: ${activeFile}`);
  }

  const tmpDir = mkTmp('prism-copy-atomic-');
  try {
    const srcDir = path.join(tmpDir, 'src');
    const dstDir = path.join(tmpDir, 'dst');
    fs.mkdirSync(path.join(srcDir, 'vendor', 'wallpaper'), { recursive: true });
    fs.mkdirSync(path.join(dstDir, 'vendor', 'swarm-prism'), { recursive: true });
    fs.mkdirSync(path.join(dstDir, 'vendor', 'wallpaper', 'studio-ui'), { recursive: true });
    fs.mkdirSync(path.join(dstDir, 'tools'), { recursive: true });
    fs.mkdirSync(path.join(dstDir, 'wallpapers'), { recursive: true });

    // Source files (including protected paths that must never overwrite user data)
    fs.writeFileSync(path.join(srcDir, 'cdp.js'), '// v2 cdp\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, 'vendor', 'wallpaper', 'wallpaper-client.js'), '// v2 wp client\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, 'config.json'), '{"palette":"default-must-not-overwrite"}\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, 'custom.css'), '/* must not overwrite */\n', 'utf8');

    // Existing destination: v1 managed files + user protected assets + all 11 retired dead files
    fs.writeFileSync(path.join(dstDir, 'cdp.js'), '// v1 cdp\n', 'utf8');
    fs.writeFileSync(path.join(dstDir, 'vendor', 'wallpaper', 'wallpaper-client.js'), '// v1 wp client\n', 'utf8');
    fs.writeFileSync(path.join(dstDir, 'config.json'), '{"palette":"warm","keep":true}\n', 'utf8');
    fs.writeFileSync(path.join(dstDir, 'custom.css'), '/* my user css */\n', 'utf8');
    fs.writeFileSync(path.join(dstDir, 'wallpapers', 'my-bg.webp'), 'USER-WALLPAPER-MEDIA', 'utf8');
    for (const rel of expectedRetired) {
      const abs = path.join(dstDir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, `// dead ${rel}\n`, 'utf8');
    }

    // 1) Mid-commit failure triggers full atomic rollback (v1 files, user data, and dead files remain consistent; 0 temp dirs)
    assert.throws(
      () =>
        installPluginMod.copyDirRecursiveSync(srcDir, dstDir, '', PROTECTED_USER_PATHS, {
          _testHooks: {
            beforeCommitFile(relPath) {
              if (relPath === 'vendor/wallpaper/wallpaper-client.js') {
                const err = new Error('Simulated copyDirRecursiveSync commit interruption');
                err.code = 'EIO';
                throw err;
              }
            },
          },
        }),
      (err) => err && err.code === 'EIO' && err.rolledBack === true
    );
    assert.equal(fs.readFileSync(path.join(dstDir, 'cdp.js'), 'utf8'), '// v1 cdp\n', 'cdp.js must roll back to v1');
    assert.equal(fs.readFileSync(path.join(dstDir, 'config.json'), 'utf8'), '{"palette":"warm","keep":true}\n');
    assert.equal(fs.readFileSync(path.join(dstDir, 'wallpapers', 'my-bg.webp'), 'utf8'), 'USER-WALLPAPER-MEDIA');
    assert.equal(fs.existsSync(path.join(dstDir, 'vendor', 'swarm-prism', 'index.js')), true, 'obsolete files remain intact after rollback');

    // 2) Successful atomic upgrade replaces managed files, purges all 11 dead files & empty dirs, and preserves user assets byte-for-byte
    const appliedCount = installPluginMod.copyDirRecursiveSync(srcDir, dstDir);
    assert.equal(appliedCount, 2);
    assert.equal(fs.readFileSync(path.join(dstDir, 'cdp.js'), 'utf8'), '// v2 cdp\n');
    assert.equal(fs.readFileSync(path.join(dstDir, 'vendor', 'wallpaper', 'wallpaper-client.js'), 'utf8'), '// v2 wp client\n');
    assert.equal(fs.readFileSync(path.join(dstDir, 'config.json'), 'utf8'), '{"palette":"warm","keep":true}\n');
    assert.equal(fs.readFileSync(path.join(dstDir, 'custom.css'), 'utf8'), '/* my user css */\n');
    assert.equal(fs.readFileSync(path.join(dstDir, 'wallpapers', 'my-bg.webp'), 'utf8'), 'USER-WALLPAPER-MEDIA');
    for (const rel of expectedRetired) {
      assert.equal(fs.existsSync(path.join(dstDir, ...rel.split('/'))), false, `Retired dead file must be purged: ${rel}`);
    }
    assert.equal(fs.existsSync(path.join(dstDir, 'vendor', 'swarm-prism')), false, 'Empty vendor/swarm-prism dir must be pruned');
    assert.equal(fs.existsSync(path.join(dstDir, 'vendor', 'wallpaper', 'studio-ui')), false, 'Empty vendor/wallpaper/studio-ui dir must be pruned');
    assert.equal(
      fs.readdirSync(dstDir).some((n) => n.startsWith('.staging-') || n.startsWith('.rollback-')),
      false,
      'No .staging-* or .rollback-* temp directories may remain'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tools/install-plugin.cjs is managed by SYNC_ROOT_FILES and atomic manifest sync without touching unrelated tools/* files', async () => {
  const cdpMod = require(path.join(ROOT, 'cdp.js'));

  // 1) Path safety & SSOT inclusion
  assert.equal(isSafeManagedRelPath('tools/install-plugin.cjs'), true);
  assert.equal(isProtectedUserPath('tools/install-plugin.cjs', PROTECTED_USER_PATHS), false);
  assert.equal(shouldExcludeSyncRelPath('tools/install-plugin.cjs'), false);
  assert.ok(
    Array.isArray(cdpMod.SYNC_ROOT_FILES) && cdpMod.SYNC_ROOT_FILES.includes('tools/install-plugin.cjs'),
    'SYNC_ROOT_FILES must include tools/install-plugin.cjs'
  );

  // 2) Native plugin bundle & install-manifest.json include tools/install-plugin.cjs exclusively under tools/
  const nativeEntries = collectNativePluginEntries();
  const nativeToolEntries = nativeEntries.filter((e) => e.name.startsWith('native-plugin/tools/'));
  assert.deepEqual(
    nativeToolEntries.map((e) => e.name),
    ['native-plugin/tools/install-plugin.cjs'],
    'collectNativePluginEntries must include only tools/install-plugin.cjs under tools/'
  );
  const manifestPayload = createInstallManifestPayload({
    version: cdpMod.PLUGIN_VERSION,
    installEntries: [],
    pluginEntries: nativeEntries,
  });
  const toolManifestEntry = manifestPayload.manifest.files.find((f) => f.path === 'tools/install-plugin.cjs');
  assert.ok(toolManifestEntry, 'install-manifest.json must track tools/install-plugin.cjs');
  assert.equal(toolManifestEntry.scope, 'plugin');
  assert.equal(
    toolManifestEntry.sha256,
    computeFileSha256(path.join(ROOT, 'tools', 'install-plugin.cjs')),
    'install-manifest.json SHA-256 for tools/install-plugin.cjs must match repo file'
  );

  // 3) copyUpdatedRuntimeFromRepo & installPlugin atomically upgrade tools/install-plugin.cjs without syncing or deleting unrelated tools/* files
  const tmpDir = mkTmp('prism-sync-tool-');
  try {
    const fakeRepo = path.join(tmpDir, 'repo');
    const fakePlugin = path.join(tmpDir, 'plugin');
    fs.mkdirSync(path.join(fakeRepo, 'tools'), { recursive: true });
    fs.mkdirSync(path.join(fakePlugin, 'tools'), { recursive: true });

    const newInstallerSrc = '// v2 tools/install-plugin.cjs\nmodule.exports = { v: 2 };\n';
    fs.writeFileSync(path.join(fakeRepo, 'style.css'), '/* v2 */\n', 'utf8');
    fs.writeFileSync(path.join(fakeRepo, 'tools', 'install-plugin.cjs'), newInstallerSrc, 'utf8');
    fs.writeFileSync(path.join(fakeRepo, 'tools', 'other-unmanaged.cjs'), '// must not sync\n', 'utf8');

    fs.writeFileSync(path.join(fakePlugin, 'style.css'), '/* v1 */\n', 'utf8');
    fs.writeFileSync(path.join(fakePlugin, 'tools', 'install-plugin.cjs'), '// stale v1\n', 'utf8');
    fs.writeFileSync(path.join(fakePlugin, 'tools', 'keep-unrelated.cjs'), '// keep me\n', 'utf8');
    fs.writeFileSync(path.join(fakePlugin, 'tools', 'patch-asar.cjs'), '// retired obsolete\n', 'utf8');

    const synced = copyUpdatedRuntimeFromRepo(fakeRepo, fakePlugin, cdpMod.SYNC_ROOT_FILES);
    assert.ok(synced >= 2);
    assert.equal(
      fs.readFileSync(path.join(fakePlugin, 'tools', 'install-plugin.cjs'), 'utf8'),
      newInstallerSrc,
      'copyUpdatedRuntimeFromRepo must atomically update tools/install-plugin.cjs'
    );
    assert.equal(
      fs.existsSync(path.join(fakePlugin, 'tools', 'other-unmanaged.cjs')),
      false,
      'copyUpdatedRuntimeFromRepo must NOT sync unrelated tools/* files'
    );
    assert.equal(
      fs.readFileSync(path.join(fakePlugin, 'tools', 'keep-unrelated.cjs'), 'utf8'),
      '// keep me\n',
      'copyUpdatedRuntimeFromRepo must NOT delete unrelated files in target tools/'
    );
    assert.equal(
      fs.existsSync(path.join(fakePlugin, 'tools', 'patch-asar.cjs')),
      false,
      'Retired tools/patch-asar.cjs must still be purged safely'
    );

    // 4) installPlugin deploys tools/install-plugin.cjs into target pluginDir with exact SHA-256 parity
    const hostCfgDir = path.join(tmpDir, '.gemini', 'config');
    const pluginTarget = path.join(hostCfgDir, 'plugins', 'obsidian-prism');
    fs.mkdirSync(hostCfgDir, { recursive: true });
    await installPluginMod.installPlugin({
      sourceDir: ROOT,
      targetDir: pluginTarget,
      hostConfigDir: hostCfgDir,
      startDaemon: false,
      syncShortcuts: false,
    });
    const deployedToolPath = path.join(pluginTarget, 'tools', 'install-plugin.cjs');
    assert.equal(fs.existsSync(deployedToolPath), true, 'installPlugin must deploy tools/install-plugin.cjs');
    assert.equal(
      computeFileSha256(deployedToolPath),
      computeFileSha256(path.join(ROOT, 'tools', 'install-plugin.cjs')),
      'Deployed tools/install-plugin.cjs SHA-256 must match source repo'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('GAP-2: workbench/app.js, README.en.md, CHANGELOG.md are managed in sync manifest and legacy root CONTRIBUTORS.md is safely purged', async () => {
  const cdpMod = require(path.join(ROOT, 'cdp.js'));

  // 1) SYNC_ROOT_FILES, collectNativePluginEntries & install-manifest.json include the 3 managed files
  for (const rel of ['README.md', 'CHANGELOG.md', 'workbench/app.js']) {
    assert.equal(isSafeManagedRelPath(rel), true);
    assert.equal(isProtectedUserPath(rel, PROTECTED_USER_PATHS), false);
    assert.equal(shouldExcludeSyncRelPath(rel), false);
    assert.ok(cdpMod.SYNC_ROOT_FILES.includes(rel), `SYNC_ROOT_FILES must include ${rel}`);
  }
  assert.ok(DEFAULT_OBSOLETE_PATHS.includes('CONTRIBUTORS.md'), 'DEFAULT_OBSOLETE_PATHS must include migrated root CONTRIBUTORS.md');
  assert.equal(isProtectedUserPath('CONTRIBUTORS.md', PROTECTED_USER_PATHS), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'CONTRIBUTORS.md')), false, 'Root CONTRIBUTORS.md must not exist in active repo');
  assert.equal(fs.existsSync(path.join(ROOT, 'docs', 'CONTRIBUTORS.md')), true, 'Canonical docs/CONTRIBUTORS.md must remain intact');

  const nativeEntries = collectNativePluginEntries();
  for (const rel of ['README.md', 'CHANGELOG.md', 'workbench/app.js']) {
    assert.ok(
      nativeEntries.some((e) => e.name === `native-plugin/${rel}`),
      `collectNativePluginEntries must include native-plugin/${rel}`
    );
  }
  const wbEntries = nativeEntries.filter((e) => e.name.startsWith('native-plugin/workbench/'));
  assert.deepEqual(
    wbEntries.map((e) => e.name),
    ['native-plugin/workbench/app.js'],
    'Only managed workbench/app.js should be bundled under workbench/'
  );

  // 2) installPlugin & copyUpdatedRuntimeFromRepo sync all 3 files, purge stale root CONTRIBUTORS.md, and preserve all protected user assets
  const tmpDir = mkTmp('prism-gap2-sync-');
  try {
    const hostCfgDir = path.join(tmpDir, '.gemini', 'config');
    const pluginTarget = path.join(hostCfgDir, 'plugins', 'obsidian-prism');
    fs.mkdirSync(path.join(pluginTarget, 'wallpapers'), { recursive: true });
    fs.mkdirSync(path.join(pluginTarget, 'backups'), { recursive: true });
    fs.mkdirSync(path.join(pluginTarget, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(pluginTarget, 'CONTRIBUTORS.md'), '# legacy root contributors\n', 'utf8');
    fs.writeFileSync(path.join(pluginTarget, 'docs', 'CONTRIBUTORS.md'), '# canonical docs contributors\n', 'utf8');
    fs.writeFileSync(path.join(pluginTarget, 'config.json'), '{"palette":"warm","keep":true}\n', 'utf8');
    fs.writeFileSync(path.join(pluginTarget, 'custom.css'), '/* keep custom */\n', 'utf8');
    fs.writeFileSync(path.join(pluginTarget, 'wallpapers', 'bg.webp'), 'WP-BYTES', 'utf8');
    fs.writeFileSync(path.join(pluginTarget, 'backups', 'snap.json'), '{"snap":1}\n', 'utf8');
    fs.writeFileSync(path.join(hostCfgDir, 'obsidian-prism-thought.json'), '{"secret":"keep"}\n', 'utf8');

    const res = await installPluginMod.installPlugin({
      sourceDir: ROOT,
      targetDir: pluginTarget,
      hostConfigDir: hostCfgDir,
      startDaemon: false,
      syncShortcuts: false,
    });
    assert.equal(res.ok, true);
    for (const rel of ['README.md', 'CHANGELOG.md', 'workbench/app.js']) {
      const dst = path.join(pluginTarget, ...rel.split('/'));
      assert.equal(fs.existsSync(dst), true, `installPlugin must deploy ${rel}`);
      assert.equal(computeFileSha256(dst), computeFileSha256(path.join(ROOT, ...rel.split('/'))));
    }
    assert.equal(fs.existsSync(path.join(pluginTarget, 'CONTRIBUTORS.md')), false, 'Legacy root CONTRIBUTORS.md must be purged');
    assert.equal(fs.readFileSync(path.join(pluginTarget, 'docs', 'CONTRIBUTORS.md'), 'utf8'), '# canonical docs contributors\n');
    assert.equal(fs.readFileSync(path.join(pluginTarget, 'config.json'), 'utf8'), '{"palette":"warm","keep":true}\n');
    assert.equal(fs.readFileSync(path.join(pluginTarget, 'custom.css'), 'utf8'), '/* keep custom */\n');
    assert.equal(fs.readFileSync(path.join(pluginTarget, 'wallpapers', 'bg.webp'), 'utf8'), 'WP-BYTES');
    assert.equal(fs.readFileSync(path.join(pluginTarget, 'backups', 'snap.json'), 'utf8'), '{"snap":1}\n');
    assert.equal(fs.readFileSync(path.join(hostCfgDir, 'obsidian-prism-thought.json'), 'utf8'), '{"secret":"keep"}\n');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
