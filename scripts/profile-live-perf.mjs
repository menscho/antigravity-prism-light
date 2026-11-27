#!/usr/bin/env node
// Obsidian Prism — 只读 CDP 实时性能采样脚本（严格仅经 Runtime.evaluate 采集原生性能指标，零写入/零副作用）
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');

export const DEFAULT_DURATION_MS = 3000;
export const MIN_DURATION_MS = 500;
export const MAX_DURATION_MS = 30000;

export function parseCliArgs(argv = []) {
  const args = {
    help: false,
    json: false,
    port: 0,
    durationMs: DEFAULT_DURATION_MS,
    targetIndex: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--json') args.json = true;
    else if (a === '--port' && argv[i + 1]) args.port = Number(argv[++i]) || 0;
    else if ((a === '--duration' || a === '-d') && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n)) args.durationMs = Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, Math.round(n)));
    } else if (a === '--target' && argv[i + 1]) {
      args.targetIndex = Math.max(0, Number(argv[++i]) | 0);
    }
  }
  return args;
}

export function getHelpText() {
  return [
    'Obsidian Prism 只读实时性能探针 (profile-live-perf)',
    '',
    '用法:',
    '  node scripts/profile-live-perf.mjs [选项]',
    '',
    '选项:',
    '  -h, --help            显示本帮助信息并退出',
    '  --port <端口号>        显式指定本机 Antigravity CDP 端口（默认自动探测）',
    '  -d, --duration <ms>   采样窗口时长，范围 500..30000 ms（默认 3000）',
    '  --target <索引>        选择第 N 个可用主窗口目标（默认 0）',
    '  --json                以 JSON 格式输出结果',
    '',
    '安全说明:',
    '  仅通过白名单 Runtime.evaluate 读取浏览器原生 performance / rAF / LongTask / DOM 快照，',
    '  不修改宿主文件、不改动 DOM 状态、不调用任何受限 CDP 域。',
  ].join('\n');
}

// 生成在宿主页面内执行的只读异步采样表达式（自动清理 rAF 与 PerformanceObserver）
export function buildPerfSampleExpression(durationMs = DEFAULT_DURATION_MS) {
  const dur = Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, Math.round(Number(durationMs) || DEFAULT_DURATION_MS)));
  return `(async () => {
    const durMs = ${dur};
    const perf = typeof performance !== 'undefined' ? performance : null;
    const nowFn = () => (perf && typeof perf.now === 'function' ? perf.now() : Date.now());
    const doc = typeof document !== 'undefined' ? document : null;
    const html = doc && doc.documentElement ? doc.documentElement : null;
    const ga = (k) => (html && typeof html.getAttribute === 'function' ? html.getAttribute(k) : null);

    const frameDeltas = [];
    const longTasks = [];
    let ltSupported = false;
    let obs = null;

    if (typeof PerformanceObserver === 'function') {
      try {
        obs = new PerformanceObserver((list) => {
          for (const ent of list.getEntries()) {
            longTasks.push(Number(ent.duration) || 0);
          }
        });
        obs.observe({ type: 'longtask', buffered: false });
        ltSupported = true;
      } catch {
        obs = null;
      }
    }

    let rafId = 0;
    let startTs = 0;
    let lastTs = 0;
    let actualMs = 0;

    try {
      await new Promise((resolve) => {
        const startWall = nowFn();
        const hardTimer = setTimeout(() => {
          if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
          rafId = 0;
          actualMs = Math.max(1, nowFn() - (startTs || startWall));
          resolve();
        }, durMs + 250);

        const step = (ts) => {
          const t = typeof ts === 'number' ? ts : nowFn();
          if (!startTs) {
            startTs = t;
            lastTs = t;
          } else {
            const dt = t - lastTs;
            if (dt > 0 && dt < 2000) frameDeltas.push(dt);
            lastTs = t;
          }
          if (t - startTs >= durMs) {
            clearTimeout(hardTimer);
            rafId = 0;
            actualMs = Math.max(1, t - startTs);
            resolve();
            return;
          }
          rafId = requestAnimationFrame(step);
        };

        if (typeof requestAnimationFrame === 'function') {
          rafId = requestAnimationFrame(step);
        } else {
          clearTimeout(hardTimer);
          actualMs = durMs;
          resolve();
        }
      });
    } finally {
      if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
      if (obs) {
        try { obs.disconnect(); } catch {}
      }
    }

    const sorted = frameDeltas.slice().sort((a, b) => a - b);
    const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] : 0);
    const frames = frameDeltas.length;
    const avgFps = actualMs > 0 ? +(frames / (actualMs / 1000)).toFixed(2) : 0;
    const maxFrameMs = sorted.length ? +sorted[sorted.length - 1].toFixed(2) : 0;
    const jankOver20 = frameDeltas.filter((d) => d > 20).length;

    let totalNodes = 0;
    let canvasCount = 0;
    let webgl2CanvasCount = 0;
    let activeCanvasCount = 0;
    if (doc && typeof doc.querySelectorAll === 'function') {
      totalNodes = doc.querySelectorAll('*').length;
      const canvases = doc.querySelectorAll('canvas');
      canvasCount = canvases.length;
      for (const cv of canvases) {
        const cls = String(cv.className || '');
        if ((cv.width || 0) > 0 && (cv.height || 0) > 0) activeCanvasCount += 1;
        if (
          cls.includes('ag-cs-ripple-canvas') ||
          cls.includes('ag-cs-brand-glow') ||
          cls.includes('ag-cs-conv-glow') ||
          cv.getAttribute?.('data-ag-vial-gl') === '1' ||
          cls.includes('ag-cs-crystal')
        ) {
          webgl2CanvasCount += 1;
        }
      }
    }

    const rawMem = perf && perf.memory ? perf.memory : null;
    const toMb = (b) => +(Number(b || 0) / (1024 * 1024)).toFixed(2);
    const memory = rawMem
      ? {
          usedJSHeapMB: toMb(rawMem.usedJSHeapSize),
          totalJSHeapMB: toMb(rawMem.totalJSHeapSize),
          jsHeapLimitMB: toMb(rawMem.jsHeapSizeLimit),
        }
      : null;

    const workerApi = (typeof window !== 'undefined' && window.__agPrismRippleWorker) || (typeof globalThis !== 'undefined' && globalThis.__agPrismRippleWorker) || null;
    const workerStats = workerApi && typeof workerApi.getStats === 'function' ? workerApi.getStats() : null;

    const totalBlockingMs = +longTasks.reduce((s, d) => s + Math.max(0, d - 50), 0).toFixed(2);
    const maxLongTaskMs = longTasks.length ? +Math.max(...longTasks).toFixed(2) : 0;

    return {
      sampledAt: new Date().toISOString(),
      hidden: Boolean(doc && doc.hidden),
      fps: {
        frames,
        durationMs: +actualMs.toFixed(1),
        avgFps,
        p50FrameMs: +pct(0.5).toFixed(2),
        p95FrameMs: +pct(0.95).toFixed(2),
        maxFrameMs,
        jankFramesOver20ms: jankOver20,
      },
      longTasks: {
        supported: ltSupported,
        count: longTasks.length,
        totalBlockingMs,
        maxDurationMs: maxLongTaskMs,
      },
      dom: {
        totalNodes,
        canvasCount,
        activeCanvasCount,
        webgl2CanvasCount,
        perfMode: (html && html.dataset && html.dataset.agCsPerfMode) || ga('data-ag-cs-perf-mode') || 'balanced',
        motionLevel: ga('data-ag-cs-motion') || 'unknown',
        targetFps: ga('data-ag-cs-target-fps') || 'unknown',
        isHome: Boolean(doc && doc.querySelector && doc.querySelector('.agy-home')),
        isConv: Boolean(doc && doc.querySelector && doc.querySelector('[data-testid="conversation-view"]')),
        rippleSleeping: Boolean(doc && doc.querySelector && doc.querySelector('.ag-cs-ripple-host[data-ripple-sleep="1"]')),
        auraSleeping: Boolean(doc && doc.querySelector && doc.querySelector('.ag-cs-conv-aura-host[data-aura-sleep="1"]')),
        resizing: ga('data-ag-cs-resizing') === '1',
      },
      worker: workerStats,
      memory,
    };
  })()`;
}

function fetchLoopbackJson(port, urlPath, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

export function evaluateHealthWarnings(sample) {
  const warnings = [];
  if (!sample) return ['missing-sample'];
  if (sample.fps?.p95FrameMs > 28) warnings.push(`p95 帧间隔偏高 (${sample.fps.p95FrameMs} ms)`);
  if (sample.longTasks?.count > 5) warnings.push(`采样窗内 LongTask 过多 (${sample.longTasks.count} 次, TBT=${sample.longTasks.totalBlockingMs} ms)`);
  if (sample.dom?.canvasCount > 16) warnings.push(`页面 Canvas 数量偏多 (${sample.dom.canvasCount})`);
  if (sample.dom?.totalNodes > 12000) warnings.push(`DOM 节点数较高 (${sample.dom.totalNodes})`);
  if (sample.memory && sample.memory.usedJSHeapMB > 600) warnings.push(`JS 堆占用偏高 (${sample.memory.usedJSHeapMB} MB)`);
  return warnings;
}

export async function runLivePerfProfile(opts = {}) {
  const cdp = require(path.join(ROOT_DIR, 'cdp.js'));
  const port = opts.port || cdp.readPort();
  if (!port) throw new Error(`未发现本机 Antigravity CDP 调试端口（检查 ${cdp.PORT_FILE}）`);
  const versionInfo = await fetchLoopbackJson(port, '/json/version');
  const pages = await cdp.listPages(port);
  const eligible = pages.filter((p) => cdp.isEligibleTarget(p));
  if (!eligible.length) throw new Error(`端口 ${port} 未发现可采样的 Antigravity 主窗口`);
  const idx = Math.min(eligible.length - 1, Math.max(0, Number(opts.targetIndex) || 0));
  const target = eligible[idx];
  const durationMs = Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, Math.round(Number(opts.durationMs) || DEFAULT_DURATION_MS)));
  const session = await cdp.CdpSession.connect(target.webSocketDebuggerUrl);
  try {
    const expr = buildPerfSampleExpression(durationMs);
    const sample = await session.evaluate(expr, true, durationMs + 5000);
    const warnings = evaluateHealthWarnings(sample);
    return {
      source: 'live-cdp-readonly',
      port,
      targetTitle: target.title || '',
      browser: versionInfo?.Browser || '',
      ...sample,
      warnings,
      status: warnings.length === 0 ? 'HEALTHY' : 'ATTENTION',
    };
  } finally {
    session.close();
  }
}

export function formatPerfReport(report) {
  const lines = [
    `=== Obsidian Prism Live Performance Profile (${report.status || 'OK'}) ===`,
    `Window   : ${report.targetTitle || 'unknown'} | Port: ${report.port || '-'} | Host: ${report.browser || 'unknown'}`,
    `Mode     : perf=${report.dom?.perfMode} | motion=${report.dom?.motionLevel} | targetFps=${report.dom?.targetFps} | view=${report.dom?.isHome ? 'home' : report.dom?.isConv ? 'conv' : 'other'}`,
    `FPS      : avg=${report.fps?.avgFps} fps | p50=${report.fps?.p50FrameMs} ms | p95=${report.fps?.p95FrameMs} ms | max=${report.fps?.maxFrameMs} ms | jank(>20ms)=${report.fps?.jankFramesOver20ms}/${report.fps?.frames}`,
    `LongTask : count=${report.longTasks?.count} | TBT=${report.longTasks?.totalBlockingMs} ms | max=${report.longTasks?.maxDurationMs} ms (supported=${report.longTasks?.supported})`,
    `DOM/GPU  : nodes=${report.dom?.totalNodes} | canvases=${report.dom?.canvasCount} (active=${report.dom?.activeCanvasCount}, webgl2=${report.dom?.webgl2CanvasCount}) | sleep(ripple=${report.dom?.rippleSleeping}, aura=${report.dom?.auraSleeping})`,
  ];
  if (report.worker) {
    lines.push(`Worker   : probe=${report.worker.probe?.ok ? 'ok' : report.worker.probe?.reason} | activeWorkers=${report.worker.activeWorkers} | fallbacks=${report.worker.totalFallbacks}`);
  }
  if (report.memory) {
    lines.push(`Memory   : used=${report.memory.usedJSHeapMB} MB / total=${report.memory.totalJSHeapMB} MB / limit=${report.memory.jsHeapLimitMB} MB`);
  }
  if (Array.isArray(report.warnings) && report.warnings.length > 0) {
    lines.push(`Warnings : ${report.warnings.join('; ')}`);
  }
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log(getHelpText());
    process.exit(0);
  }
  runLivePerfProfile(args)
    .then((report) => {
      console.log(args.json ? JSON.stringify(report, null, 2) : formatPerfReport(report));
    })
    .catch((err) => {
      console.error(`[profile-live-perf] ${err.message}`);
      process.exit(1);
    });
}
