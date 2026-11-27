// 配置持久化存储与 mtimeMs:size 浅拷贝缓存（绑定实例 rootDir，严格无 symlink 原子落盘）
'use strict';

const fs = require('fs');
const path = require('path');
const { isSymlinkPathSync, writeFileAtomicNoSymlinkSync } = require('../utils/fs-safe.cjs');
const { DEFAULT_CONFIG, reconcileConfigAliases } = require('./schema.cjs');

function createConfigStore({ rootDir = path.resolve(__dirname, '..', '..'), configFile = null } = {}) {
  const CONFIG_FILE = configFile ? path.resolve(configFile) : path.join(rootDir, 'config.json');
  const CONFIG_PATH = CONFIG_FILE;
  let _configCache = { sig: '', value: null };

  function invalidateConfigCache() {
    _configCache = { sig: '', value: null };
  }

  function readConfig() {
    try {
      const st = fs.statSync(CONFIG_FILE);
      if (!st.isFile()) {
        _configCache = { sig: '', value: null };
        return { ...DEFAULT_CONFIG };
      }
      const sig = `${st.mtimeMs}:${st.size}:${st.ctimeMs}`;
      if (_configCache.value && _configCache.sig === sig) {
        return { ..._configCache.value };
      }
      const diskRaw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      const merged = reconcileConfigAliases({ ...DEFAULT_CONFIG, ...reconcileConfigAliases(diskRaw) });
      _configCache = { sig, value: merged };
      return { ...merged };
    } catch {
      _configCache = { sig: '', value: null };
      return { ...DEFAULT_CONFIG };
    }
  }

  function writeConfig(nextConfig) {
    const normalized = reconcileConfigAliases({
      ...DEFAULT_CONFIG,
      ...(nextConfig && typeof nextConfig === 'object' ? reconcileConfigAliases(nextConfig) : {}),
    });
    const resolved = path.resolve(CONFIG_FILE);
    const dir = path.dirname(resolved);
    if (isSymlinkPathSync(dir) || isSymlinkPathSync(resolved)) {
      throw new Error(`Refusing symbolic link config path: ${resolved}`);
    }
    const content = JSON.stringify(normalized, null, 2) + '\n';
    writeFileAtomicNoSymlinkSync(resolved, content, {
      mkdir: true,
      mode: 0o600,
      fsync: false,
      checkExistingRegular: false,
    });
    // 写盘成功后立即失效缓存，防止同一毫秒写入后读到陈旧值
    invalidateConfigCache();
    return { ...normalized };
  }

  return {
    CONFIG_FILE,
    CONFIG_PATH,
    readConfig,
    writeConfig,
    invalidateConfigCache,
  };
}

module.exports = {
  createConfigStore,
};
