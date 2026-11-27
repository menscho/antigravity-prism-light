// 出网 SSRF / DNS Rebinding 防护与防符号链接独占原子落盘工具（L3 安全底座）
import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const BLOCKED_AI_PORTS = new Set([
  21, 22, 23, 25, 53, 110, 135, 139, 143, 445, 1433, 3306, 3389, 5432, 6379, 11211, 27017,
]);

export function parseIpv4Octets(raw) {
  const parts = String(raw || '').split('.');
  if (parts.length !== 4) return null;
  const out = [];
  for (let i = 0; i < 4; i++) {
    if (!/^\d{1,3}$/.test(parts[i])) return null;
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out.push(n);
  }
  return out;
}

export function isBlockedCloudOrUnspecifiedIpv4(a, b, c, d) {
  if (a === 0) return true; // 0.0.0.0/8 未指定地址
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 云元数据与链路本地
  if (a === 100 && b === 100 && c === 100 && d === 200) return true; // 阿里云元数据
  if (a >= 224) return true; // 组播与保留地址段（224.0.0.0/4、240.0.0.0/4、255.255.255.255）
  return false;
}

export function isPrivateOrLoopbackIpv4(a, b, c, d) {
  if (isBlockedCloudOrUnspecifiedIpv4(a, b, c, d)) return true;
  if (a === 127) return true; // 127.0.0.0/8 回环
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 组播与保留地址段
  return false;
}

export function parseIpv6Hextets(raw) {
  let s = String(raw || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  const zoneIdx = s.indexOf('%');
  if (zoneIdx >= 0) s = s.slice(0, zoneIdx);
  if (!s.includes(':')) return null;

  let ipv4Tail = null;
  const lastColon = s.lastIndexOf(':');
  const tailPart = s.slice(lastColon + 1);
  if (tailPart.includes('.')) {
    const octets = parseIpv4Octets(tailPart);
    if (!octets) return null;
    ipv4Tail = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    if (lastColon > 0 && s[lastColon - 1] === ':') {
      s = s.slice(0, lastColon + 1);
    } else {
      s = s.slice(0, lastColon);
    }
  }

  const targetGroups = ipv4Tail ? 6 : 8;
  const dblIdx = s.indexOf('::');
  let groups;
  if (dblIdx >= 0) {
    if (s.indexOf('::', dblIdx + 2) >= 0) return null;
    const leftStr = s.slice(0, dblIdx);
    const rightStr = s.slice(dblIdx + 2);
    const left = leftStr ? leftStr.split(':') : [];
    const right = rightStr ? rightStr.split(':') : [];
    const missing = targetGroups - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left, ...new Array(missing).fill('0'), ...right];
  } else {
    groups = s.split(':');
    if (groups.length !== targetGroups) return null;
  }

  const hextets = [];
  for (let i = 0; i < groups.length; i++) {
    if (!/^[0-9a-f]{1,4}$/.test(groups[i])) return null;
    hextets.push(parseInt(groups[i], 16));
  }
  if (ipv4Tail) {
    hextets.push(ipv4Tail[0], ipv4Tail[1]);
  }
  return hextets.length === 8 ? hextets : null;
}

function extractEmbeddedIpv4FromIpv6(h) {
  const isV4Mapped = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff;
  const isV4Translated = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0xffff && h[5] === 0;
  const isV4Compatible = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0;
  const isNat64 =
    h[0] === 0x0064 &&
    h[1] === 0xff9b &&
    ((h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) || h[2] === 0x0001);
  if (isV4Mapped || isV4Translated || isV4Compatible || isNat64) {
    return [h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff];
  }
  if (h[0] === 0x2002) {
    return [h[1] >> 8, h[1] & 0xff, h[2] >> 8, h[2] & 0xff];
  }
  return null;
}

export function isExplicitLoopbackHost(rawHost) {
  const host = String(rawHost || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const v4 = parseIpv4Octets(host);
  if (v4) return v4[0] === 127;
  if (host.includes(':')) {
    const h = parseIpv6Hextets(host);
    if (!h) return false;
    return h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0 && h[6] === 0 && h[7] === 1;
  }
  return false;
}

/**
 * 静态元数据 / 未指定 / 链路本地 SSRF 主机拦截（永远拒绝，即便允许内网/明文 HTTP）。
 */
export function isBlockedSsrfHost(rawHost) {
  const host = String(rawHost || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;
  if (
    host === 'metadata.google.internal' ||
    host.endsWith('.metadata.google.internal') ||
    host === 'metadata.goog' ||
    host === 'metadata' ||
    host === 'instance-data'
  ) {
    return true;
  }
  const v4 = parseIpv4Octets(host);
  if (v4) {
    return isBlockedCloudOrUnspecifiedIpv4(v4[0], v4[1], v4[2], v4[3]);
  }
  if (host.includes(':')) {
    const h = parseIpv6Hextets(host);
    if (!h) return true;
    if (h.every((x) => x === 0)) return true;
    if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0 && h[6] === 0 && h[7] === 1) {
      return false;
    }
    if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
    if ((h[0] & 0xff00) === 0xff00) return true; // ff00::/8 组播地址
    if (h[0] === 0xfd00 && h[1] === 0x0ec2) return true; // AWS IMDSv2 IPv6
    const emb = extractEmbeddedIpv4FromIpv6(h);
    if (emb && isBlockedCloudOrUnspecifiedIpv4(emb[0], emb[1], emb[2], emb[3])) return true;
    return false;
  }
  return false;
}

/**
 * 判断解析出的 IP 是否属于私有内网 / 回环 / 云元数据 / 链路本地 / 未指定地址。
 * 用于封堵非回环域名经 DNS Rebinding 解析到内网或本机回环的 SSRF 攻击。
 */
export function isPrivateOrReservedIp(rawIp) {
  const ip = String(rawIp || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!ip) return true;
  const v4 = parseIpv4Octets(ip);
  if (v4) {
    return isPrivateOrLoopbackIpv4(v4[0], v4[1], v4[2], v4[3]);
  }
  if (ip.includes(':')) {
    const h = parseIpv6Hextets(ip);
    if (!h) return true;
    if (h.every((x) => x === 0)) return true; // ::
    if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0 && h[6] === 0 && h[7] === 1) {
      return true; // ::1
    }
    if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
    if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((h[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    const emb = extractEmbeddedIpv4FromIpv6(h);
    if (emb && isPrivateOrLoopbackIpv4(emb[0], emb[1], emb[2], emb[3])) return true;
    return false;
  }
  return true;
}

/**
 * 对出网目标 URL 执行静态 + DNS 二次解析 SSRF / DNS Rebinding 校验：
 * - 用户显式填写的本机回环（127.0.0.1 / localhost / [::1]）放行（支持本地 Ollama / LM Studio）；
 * - 非回环域名若经 DNS 解析到回环/私有内网/云元数据 IP，立即拦截；
 * - 代理模式下若本地无法解析（ENOTFOUND/EAI_AGAIN），可按 allowUnresolvedForProxy 交由代理处理。
 */
export async function verifyOutboundUrlSafety(urlStr, opts = {}) {
  let target;
  try {
    target = new URL(String(urlStr || ''));
  } catch {
    throw new Error('Invalid request URL');
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`Unsupported request protocol: ${target.protocol}`);
  }
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const port = target.port ? Number(target.port) : target.protocol === 'https:' ? 443 : 80;
  if (!host || /[\r\n\0\s]/.test(host)) {
    throw new Error('Invalid target host');
  }
  if (BLOCKED_AI_PORTS.has(port)) {
    throw new Error(`Blocked target port: ${port}`);
  }
  if (isBlockedSsrfHost(host)) {
    throw new Error('Blocked target host (SSRF protection)');
  }

  // 用户显式填写的合法回环端点（如 http://127.0.0.1:11434 / http://localhost:1234 / http://[::1]:8000）放行
  if (isExplicitLoopbackHost(host)) {
    return { ok: true, host, loopback: true };
  }

  // 非回环 IP 字面量：拒绝私有/保留地址段（除非显式配置 allowPrivateIp）
  if (net.isIP(host) !== 0) {
    if (isPrivateOrReservedIp(host) && !opts.allowPrivateIp) {
      throw new Error('Blocked private or reserved IP address (SSRF protection)');
    }
    return { ok: true, host, resolvedAddresses: [host] };
  }

  if (opts.skipDnsLookup) {
    return { ok: true, host, dnsSkipped: true };
  }

  const lookupFn =
    typeof opts.dnsLookup === 'function'
      ? opts.dnsLookup
      : (hostname) => dns.promises.lookup(hostname, { all: true });

  let records;
  try {
    records = await lookupFn(host, { all: true });
  } catch (err) {
    if (opts.allowUnresolvedForProxy) {
      return { ok: true, host, unresolvedForProxy: true };
    }
    throw err;
  }

  const rawList = Array.isArray(records) ? records : records ? [records] : [];
  const addresses = rawList
    .map((item) => (typeof item === 'string' ? item : item && typeof item.address === 'string' ? item.address : ''))
    .filter(Boolean);

  if (addresses.length === 0) {
    if (opts.allowUnresolvedForProxy) {
      return { ok: true, host, unresolvedForProxy: true };
    }
    throw new Error(`DNS resolution returned no addresses for ${host}`);
  }

  for (const ip of addresses) {
    if (isBlockedSsrfHost(ip) || isPrivateOrReservedIp(ip)) {
      throw new Error(`Blocked DNS-resolved private/loopback/metadata IP for ${host} (SSRF / DNS Rebinding protection)`);
    }
  }
  return { ok: true, host, resolvedAddresses: addresses };
}

export function assertNoSymlink(filePath, { expectDir = false } = {}) {
  const resolved = path.resolve(String(filePath || ''));
  const root = path.parse(resolved).root;
  const rel = path.relative(root, resolved);
  const parts = rel ? rel.split(path.sep).filter(Boolean) : [];
  let cur = root;
  for (const part of parts) {
    cur = path.join(cur, part);
    try {
      const st = fs.lstatSync(cur);
      if (st.isSymbolicLink()) {
        throw new Error(`Refusing symbolic link path: ${cur}`);
      }
      if (cur === resolved) {
        if (expectDir) {
          if (!st.isDirectory()) throw new Error(`Refusing non-directory path: ${cur}`);
        } else if (!st.isFile() || (typeof st.nlink === 'number' && st.nlink > 1)) {
          throw new Error(`Refusing unsafe non-regular or hardlinked target: ${cur}`);
        }
      }
    } catch (err) {
      if (err && err.code === 'ENOENT') break;
      throw err;
    }
  }
  return resolved;
}

export function atomicWriteFileExclusiveSync(filePath, content, mode = 0o600) {
  const resolved = assertNoSymlink(filePath);
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });
  assertNoSymlink(dir, { expectDir: true });
  const tmp = path.join(
    dir,
    `.${path.basename(resolved)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  try {
    fs.writeFileSync(tmp, content, { encoding: 'utf8', mode, flag: 'wx' });
    assertNoSymlink(resolved);
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, resolved);
        break;
      } catch (err) {
        if (process.platform !== 'win32' || attempt >= 3 || !['EBUSY', 'EPERM', 'EACCES'].includes(err?.code)) {
          throw err;
        }
        try {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * (attempt + 1));
        } catch {}
      }
    }
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {}
    throw err;
  }
}

export async function atomicWriteFileExclusiveAsync(filePath, content, mode = 0o600) {
  const resolved = assertNoSymlink(filePath);
  const dir = path.dirname(resolved);
  await fs.promises.mkdir(dir, { recursive: true });
  assertNoSymlink(dir, { expectDir: true });
  const tmp = path.join(
    dir,
    `.${path.basename(resolved)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  try {
    await fs.promises.writeFile(tmp, content, { encoding: 'utf8', mode, flag: 'wx' });
    assertNoSymlink(resolved);
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.promises.rename(tmp, resolved);
        break;
      } catch (err) {
        if (process.platform !== 'win32' || attempt >= 3 || !['EBUSY', 'EPERM', 'EACCES'].includes(err?.code)) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 15 * (attempt + 1)));
      }
    }
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw err;
  }
}
