// 敏感凭据、URL 查询参数与用户主目录路径脱敏工具模块（独立抽离，供守护进程与单测共用）
import os from 'node:os';

export const SECRET_TOKEN_RE =
  /(sk-[A-Za-z0-9_\-]{6,}|AIza[A-Za-z0-9_\-]{12,}|xai-[A-Za-z0-9_\-]{8,}|ghp_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|Bearer\s+[A-Za-z0-9._\-]{8,})/gi;

export const URL_SECRET_QUERY_RE = /([?&](?:token|auth|signature|key|secret)=)[^&\s#"']+/gi;

function escapeRegexChars(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 对日志、路径或错误消息执行凭据脱敏（覆盖 URL 内置账密、敏感 Query 参数及 API Key/Token）。
 */
export function sanitizeSecretText(text) {
  return String(text || '')
    .replace(/https?:\/\/[^/\s:@]+:[^/\s@]+@/gi, 'https://***@')
    .replace(URL_SECRET_QUERY_RE, '$1<REDACTED>')
    .replace(SECRET_TOKEN_RE, '***REDACTED***');
}

/**
 * 将文本中的本机用户主目录（os.homedir()，含正斜杠/反斜杠/JSON 转义双反斜杠变体）脱敏为 <USER_HOME>。
 */
export function sanitizeHomeDirPaths(text, homeDir = os.homedir()) {
  const input = String(text || '');
  const rawHome = String(homeDir || '').replace(/[\\/]+$/, '');
  if (!input || rawHome.length < 4) return input;
  const slashHome = rawHome.replace(/\\/g, '/');
  const backslashHome = rawHome.replace(/\//g, '\\');
  const escapedBackslashHome = backslashHome.replace(/\\/g, '\\\\');
  const variants = [...new Set([escapedBackslashHome, backslashHome, slashHome])].filter((v) => v.length >= 4);
  variants.sort((a, b) => b.length - a.length);
  const flags = process.platform === 'win32' ? 'gi' : 'g';
  const re = new RegExp(variants.map(escapeRegexChars).join('|'), flags);
  return input.replace(re, '<USER_HOME>');
}

/**
 * 组合日志格式化脱敏：先脱敏密钥凭据，再脱敏用户主目录路径。
 */
export function sanitizeLogLine(text, homeDir = os.homedir()) {
  return sanitizeHomeDirPaths(sanitizeSecretText(text), homeDir);
}
