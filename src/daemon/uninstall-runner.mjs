// Obsidian Prism 脱离式插件卸载执行器（独立模块，替代内联 node -e 脚本，满足零杀软红线）
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REDLINE_SEGMENTS = Object.freeze([
  'conversations_archive',
  'prism-knowledge-space',
  'antigravity-spark',
]);

function isProtectedTargetPath(resolvedTarget, homeDir) {
  const norm = resolvedTarget.toLowerCase();
  const rootPath = path.parse(resolvedTarget).root;
  const protectedPaths = [
    rootPath,
    homeDir,
    path.join(homeDir, '.gemini'),
    path.join(homeDir, '.gemini', 'config'),
    path.join(homeDir, '.gemini', 'antigravity'),
  ].map((p) => path.resolve(p).toLowerCase());
  if (protectedPaths.includes(norm)) return true;
  const segments = resolvedTarget.split(/[\\/]+/).map((s) => s.toLowerCase());
  return REDLINE_SEGMENTS.some((seg) => segments.includes(seg));
}

function atomicWriteJsonExclusive(filePath, dataObj) {
  const dir = path.dirname(filePath);
  const tmp = path.join(
    dir,
    `${path.basename(filePath)}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`
  );
  const payload = JSON.stringify(dataObj, null, 2) + '\n';
  try {
    fs.writeFileSync(tmp, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const targetStat = fs.lstatSync(filePath);
    if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
      throw new Error('Refusing symlink target config.json');
    }
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {}
    throw err;
  }
}

export function resolveUninstallRunnerPath(rootDir, defaultRootDir, lstatFn = fs.lstatSync) {
  const candidates = [
    rootDir ? path.join(rootDir, 'src', 'daemon', 'uninstall-runner.mjs') : '',
    defaultRootDir ? path.join(defaultRootDir, 'src', 'daemon', 'uninstall-runner.mjs') : '',
  ].filter(Boolean);
  for (const cand of candidates) {
    try {
      const st = lstatFn(cand);
      if (st && !st.isSymbolicLink() && st.isFile()) return cand;
    } catch {}
  }
  return candidates[0] || fileURLToPath(import.meta.url);
}

export async function runUninstallFromEnv(env = process.env, opts = {}) {
  const homeDir = path.resolve(opts.homeDir || os.homedir());
  const scriptPath = typeof env.AG_PRISM_UNINSTALL_SCRIPT === 'string' ? env.AG_PRISM_UNINSTALL_SCRIPT.trim() : '';
  const targetDir = typeof env.AG_PRISM_UNINSTALL_TARGET === 'string' ? env.AG_PRISM_UNINSTALL_TARGET.trim() : '';
  const purgeData = env.AG_PRISM_PURGE_DATA === '1';
  const cdpPortNum = Number(env.AG_PRISM_CDP_PORT);
  const cdpPort = Number.isInteger(cdpPortNum) && cdpPortNum > 0 ? cdpPortNum : undefined;

  if (scriptPath) {
    const st = fs.lstatSync(scriptPath);
    if (!st.isSymbolicLink() && st.isFile()) {
      const req = createRequire(import.meta.url);
      const mod = req(scriptPath);
      if (mod && typeof mod.uninstallPlugin === 'function') {
        await mod.uninstallPlugin({
          targetDir: targetDir || undefined,
          purgeData,
          cdpPort,
        });
        return { ok: true, mode: 'script' };
      }
    }
  }

  let removedTarget = false;
  if (targetDir) {
    const resolvedTarget = path.resolve(targetDir);
    if (!isProtectedTargetPath(resolvedTarget, homeDir) && fs.existsSync(resolvedTarget)) {
      const targetStat = fs.lstatSync(resolvedTarget);
      if (!targetStat.isSymbolicLink()) {
        fs.rmSync(resolvedTarget, { recursive: true, force: true });
        removedTarget = true;
      }
    }
  }

  let updatedConfig = false;
  const cfgDir = opts.configDir ? path.resolve(opts.configDir) : path.join(homeDir, '.gemini', 'config');
  const cfgPath = path.join(cfgDir, 'config.json');
  if (fs.existsSync(cfgPath)) {
    const cfgStat = fs.lstatSync(cfgPath);
    if (!cfgStat.isSymbolicLink() && cfgStat.isFile()) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (parsed.plugins && typeof parsed.plugins === 'object') {
          delete parsed.plugins['obsidian-prism'];
        }
        if (parsed.sidecars && typeof parsed.sidecars === 'object') {
          delete parsed.sidecars['obsidian-prism/daemon'];
        }
        atomicWriteJsonExclusive(cfgPath, parsed);
        updatedConfig = true;
      }
    }
  }

  return { ok: true, mode: 'fallback', removedTarget, updatedConfig };
}

function isDirectCliEntry() {
  if (!process.argv[1]) return false;
  try {
    const selfPath = fs.realpathSync(fileURLToPath(import.meta.url));
    const argvPath = fs.realpathSync(path.resolve(process.argv[1]));
    return process.platform === 'win32'
      ? selfPath.toLowerCase() === argvPath.toLowerCase()
      : selfPath === argvPath;
  } catch {
    return false;
  }
}

if (isDirectCliEntry()) {
  const rawDelay = Number(process.env.AG_PRISM_UNINSTALL_DELAY_MS);
  const delayMs = Number.isFinite(rawDelay) && rawDelay >= 0 && rawDelay <= 10000 ? rawDelay : 400;
  setTimeout(async () => {
    try {
      await runUninstallFromEnv(process.env);
    } catch {}
    process.exit(0);
  }, delayMs);
}
