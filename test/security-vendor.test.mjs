import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
  ThoughtTranslatorService,
  normalizeOpenAiBaseUrl,
  validateOpenAiBaseUrl,
  isKeylessAllowedEndpoint,
} from '../vendor/thought-translator/translator-service.mjs';
import { PromptSuggesterService } from '../vendor/prompt-suggester/suggester-service.mjs';
import { OmniServer } from '../vendor/omni-viewer/omni-server.mjs';
import { createLiveHostAdapter } from '../vendor/sidebar-studio/live-host-adapter.mjs';
import { MetricsStore } from '../vendor/pulse-dashboard/sidecars/panel/store.mjs';
import { TrajectoryReader } from '../vendor/pulse-dashboard/sidecars/panel/trajectory-reader.mjs';
import { UsageLedger, DesktopUsage, LOCAL_SCOPE } from '../vendor/pulse-dashboard/sidecars/panel/usage.mjs';
import { BackgroundStatistics } from '../vendor/pulse-dashboard/sidecars/panel/background-statistics.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SIDEBAR_CLIENT_FILE = path.join(ROOT_DIR, 'vendor', 'sidebar-studio', 'sidebar-client.js');

function mkRealTempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function createSidebarClientHarness({
  initialBootCfg = null,
  assignments = {},
  startCascadeImpl = null,
  wrapperSendImpl = null,
  rawSendImpl = null,
} = {}) {
  const clientCode = fs.readFileSync(SIDEBAR_CLIENT_FILE, 'utf8');
  const docListeners = new Map();
  const winListeners = new Map();
  const timers = new Map();
  let nextTimerId = 1;
  let storeSubCount = 0;
  let storeUnsubCount = 0;
  let routerSubCount = 0;
  let routerUnsubCount = 0;

  const listenerKey = (type, capture) => `${type}:${capture ? 'cap' : 'bub'}`;
  const addToMap = (map, type, fn, opts) => {
    const cap = typeof opts === 'boolean' ? opts : Boolean(opts && opts.capture);
    const k = listenerKey(type, cap);
    if (!map.has(k)) map.set(k, new Set());
    map.get(k).add(fn);
  };
  const removeFromMap = (map, type, fn, opts) => {
    const cap = typeof opts === 'boolean' ? opts : Boolean(opts && opts.capture);
    const k = listenerKey(type, cap);
    map.get(k)?.delete(fn);
  };
  const countMapListeners = (map) => {
    let total = 0;
    for (const set of map.values()) total += set.size;
    return total;
  };

  const makeNode = (tag) => {
    const attrs = new Map();
    const classes = new Set();
    const node = {
      tagName: String(tag || 'DIV').toUpperCase(),
      nodeName: String(tag || 'DIV').toUpperCase(),
      id: '',
      children: [],
      style: {},
      classList: {
        add: (...cs) => cs.forEach((c) => classes.add(c)),
        remove: (...cs) => cs.forEach((c) => classes.delete(c)),
        contains: (c) => classes.has(c),
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k === 'id') this.id = String(v);
      },
      getAttribute(k) {
        return attrs.has(k) ? attrs.get(k) : null;
      },
      removeAttribute(k) {
        attrs.delete(k);
      },
      appendChild(c) {
        c.parentElement = node;
        node.children.push(c);
        return c;
      },
      insertBefore(c) {
        c.parentElement = node;
        node.children.push(c);
        return c;
      },
      remove() {
        if (this.parentElement) {
          const i = this.parentElement.children.indexOf(this);
          if (i >= 0) this.parentElement.children.splice(i, 1);
          this.parentElement = null;
        }
      },
      addEventListener() {},
      removeEventListener() {},
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      getBoundingClientRect() {
        return { width: 240, height: 600, top: 0, left: 0, bottom: 600, right: 240 };
      },
      get firstChild() {
        return node.children[0] || null;
      },
    };
    return node;
  };

  const startCalls = [];
  const rawSendCalls = [];
  const wrapperSendCalls = [];

  const origRawSend = async (req) => {
    rawSendCalls.push(req);
    if (typeof rawSendImpl === 'function') return await rawSendImpl(req);
    return {};
  };
  const origWrapperSend = async (req) => {
    wrapperSendCalls.push(req);
    if (typeof wrapperSendImpl === 'function') return await wrapperSendImpl(req);
    return {};
  };

  const fakeLsClient = {
    startCascade: async (req) => {
      startCalls.push(req);
      if (typeof startCascadeImpl === 'function') return await startCascadeImpl(req);
      return { cascadeId: req.cascadeId };
    },
    sendUserCascadeMessage: origRawSend,
    updateConversationAnnotations: async () => ({}),
    deleteCascadeTrajectory: async () => ({}),
  };

  const fakeLsWrapper = {
    startCascade: async (req) => ({ cascadeId: req.cascadeId }),
    sendUserCascadeMessage: origWrapperSend,
    deleteCascadeTrajectory: async () => ({}),
    updateConversationAnnotations: async () => ({}),
  };

  const fakeRouter = {
    state: { location: { pathname: '/' } },
    navigate() {},
    subscribe() {
      routerSubCount += 1;
      return () => {
        routerUnsubCount += 1;
      };
    },
  };

  const fakeStore = {
    getState: () => ({
      trajectorySummaries: { summaries: {} },
      userStatus: { cascadeModelConfigData: { clientModelConfigs: [] } },
    }),
    subscribe() {
      storeSubCount += 1;
      return () => {
        storeUnsubCount += 1;
      };
    },
    dispatch() {},
  };

  const rootEl = makeNode('div');
  rootEl.id = 'root';
  rootEl.__reactFiber$sec = {
    tag: 10,
    memoizedProps: { value: { store: fakeStore } },
    sibling: {
      tag: 10,
      memoizedProps: { value: fakeLsWrapper },
      sibling: {
        tag: 10,
        memoizedProps: { value: fakeRouter },
        sibling: {
          tag: 10,
          memoizedProps: {
            value: {
              core: {
                projectManagementService: {
                  projectsStateProvider: { getState: () => [] },
                  lsClient: fakeLsClient,
                },
              },
            },
          },
        },
      },
    },
  };

  const doc = {
    head: makeNode('head'),
    body: makeNode('body'),
    documentElement: makeNode('html'),
    hidden: false,
    createElement: (tag) => makeNode(tag),
    createElementNS: (_ns, tag) => makeNode(tag),
    getElementById: (id) => (id === 'root' ? rootEl : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, fn, opts) => addToMap(docListeners, type, fn, opts),
    removeEventListener: (type, fn, opts) => removeFromMap(docListeners, type, fn, opts),
  };

  const snap = {
    storeId: 'store-sec',
    rev: 1,
    navRev: 1,
    draftRev: 1,
    activeMode: 'chat',
    currentView: '/',
    chatDraft: { kind: 'knowledge', folderId: null, sparkProjectId: null },
    assignments,
    knowledgeFolders: [],
    sparkProjects: [],
    chatSidebar: { knowledge: { rootItems: [], folders: [] }, spark: { projects: [] }, archived: { items: [], totalCount: 0 } },
    catalogHealth: 'ready',
    capabilities: { projectPermissions: false, perCascadeIsolation: true },
  };

  const win = {
    document: doc,
    innerWidth: 1440,
    innerHeight: 900,
    location: { pathname: '/' },
    getComputedStyle: () => ({ position: 'relative' }),
    addEventListener: (type, fn, opts) => addToMap(winListeners, type, fn, opts),
    removeEventListener: (type, fn, opts) => removeFromMap(winListeners, type, fn, opts),
    __agPrismSidebarBridge: {
      isOnline: () => true,
      call: async () => ({ ok: true, snapshot: snap }),
    },
  };
  if (initialBootCfg) {
    win.__agPrism = { getState: () => ({ cfg: initialBootCfg }) };
  }

  const fakeSetTimeout = (fn, ms) => {
    const id = nextTimerId++;
    timers.set(id, { fn, ms });
    return id;
  };
  const fakeClearTimeout = (id) => {
    timers.delete(id);
  };

  vm.runInNewContext(clientCode, {
    window: win,
    globalThis: win,
    document: doc,
    crypto: globalThis.crypto,
    getComputedStyle: win.getComputedStyle,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
  });

  return {
    win,
    doc,
    fakeLsClient,
    fakeLsWrapper,
    origRawSend,
    origWrapperSend,
    startCalls,
    rawSendCalls,
    wrapperSendCalls,
    timers,
    getCounts: () => ({
      docListeners: countMapListeners(docListeners),
      winListeners: countMapListeners(winListeners),
      activeTimers: timers.size,
      storeSubCount,
      storeUnsubCount,
      routerSubCount,
      routerUnsubCount,
    }),
  };
}

test('P1 sidebar-client: off-mode module self-protection mounts 0 listeners/timers/hostOps, lazy-activates on sync("on"), and symmetrically unbinds on sync("off")', async () => {
  const h = createSidebarClientHarness();

  // 1) 加载后未 sync({ sidebarStudio: 'on' }) 前：零监听、零定时器、零订阅、零 __agPrismSidebarHostOps、零 sendGuard
  assert.equal(h.win.__agPrismSidebarHostOps, undefined, '关闭态绝不得提前暴露 window.__agPrismSidebarHostOps');
  assert.equal(h.getCounts().docListeners, 0, '关闭态不得提前挂载 8 个 document 监听');
  assert.equal(h.getCounts().winListeners, 0, '关闭态不得提前挂载 window resize 监听');
  assert.equal(h.getCounts().activeTimers, 0, '关闭态不得启动 scheduleDiscovery 轮询定时器');
  assert.equal(h.getCounts().storeSubCount, 0, '关闭态不得订阅 host.store');
  assert.equal(h.getCounts().routerSubCount, 0, '关闭态不得订阅 host.router');
  assert.equal(h.fakeLsWrapper.sendUserCascadeMessage, h.origWrapperSend, '关闭态不得 patch sendUserCascadeMessage');
  assert.equal(h.fakeLsClient.sendUserCascadeMessage, h.origRawSend, '关闭态不得 patch rawLs.sendUserCascadeMessage');
  assert.equal(h.win.__agPrismSidebar.getState().listenersBound, false);

  // 2) sync({ sidebarStudio: 'on' }) 切入开启态 -> 懒挂载全部监听、注册 hostOps、安装 sendGuard、订阅 store/router
  h.win.__agPrismSidebar.sync({ sidebarStudio: 'on' });
  await Promise.resolve();
  assert.ok(h.win.__agPrismSidebarHostOps, '开启态应注册 window.__agPrismSidebarHostOps');
  assert.equal(h.getCounts().docListeners, 8, '开启态应挂载 8 个 document 监听');
  assert.equal(h.getCounts().winListeners, 1, '开启态应挂载 1 个 window resize 监听');
  assert.equal(h.getCounts().storeSubCount, 1, '开启态应订阅 host.store');
  assert.equal(h.getCounts().routerSubCount, 1, '开启态应订阅 host.router');
  assert.notEqual(h.fakeLsWrapper.sendUserCascadeMessage, h.origWrapperSend, '开启态应挂载 wrapper sendGuard');
  assert.notEqual(h.fakeLsClient.sendUserCascadeMessage, h.origRawSend, '开启态应挂载 rawLs sendGuard');

  // 重复 sync('on') 必须幂等，不得重复注册监听或订阅
  h.win.__agPrismSidebar.sync({ sidebarStudio: 'on' });
  assert.equal(h.getCounts().docListeners, 8);
  assert.equal(h.getCounts().winListeners, 1);
  assert.equal(h.getCounts().storeSubCount, 1);
  assert.equal(h.getCounts().routerSubCount, 1);

  // 3) sync({ sidebarStudio: 'off' }) 切出关闭态 -> 对称清理全部监听、定时器、订阅、hostOps 与 sendGuard
  h.win.__agPrismSidebar.sync({ sidebarStudio: 'off' });
  assert.equal(h.win.__agPrismSidebarHostOps, undefined, '切回 off 必须注销 window.__agPrismSidebarHostOps');
  assert.equal(h.getCounts().docListeners, 0, '切回 off 必须移除全部 8 个 document 监听');
  assert.equal(h.getCounts().winListeners, 0, '切回 off 必须移除 window resize 监听');
  assert.equal(h.getCounts().activeTimers, 0, '切回 off 必须清理 probeTimer/syncTimer');
  assert.equal(h.getCounts().storeUnsubCount, 1, '切回 off 必须执行 host.unsubStore');
  assert.equal(h.getCounts().routerUnsubCount, 1, '切回 off 必须执行 host.unsubRouter');
  assert.equal(h.fakeLsWrapper.sendUserCascadeMessage, h.origWrapperSend, '切回 off 必须卸载 wrapper sendGuard');
  assert.equal(h.fakeLsClient.sendUserCascadeMessage, h.origRawSend, '切回 off 必须卸载 rawLs sendGuard');
  assert.equal(h.win.__agPrismSidebar.getState().listenersBound, false);

  h.win.__agPrismSidebar.destroy();
});

test('P1 sidebar-client: Chat send guard & reserveSession enforce strict fail-closed while Code sends pass through untouched', async () => {
  let startAttempt = 0;
  const h = createSidebarClientHarness({
    assignments: {
      'chat-iso-1': { mode: 'chat', placement: { kind: 'knowledge', folderId: null }, continuation: 'ready' },
    },
    startCascadeImpl: async () => {
      startAttempt += 1;
      throw new Error(`customAgentSpec unsupported stage ${startAttempt}`);
    },
  });

  h.win.__agPrismSidebar.sync({ sidebarStudio: 'on' });
  await new Promise((r) => setTimeout(r, 10));

  // 1) Chat 会话发送时若 applyChatIsolationToSendArg 内部抛错（如恶意/损坏 getter），必须 fail-closed 抛错拒发，绝不调用原始 orig
  const brokenChatReq = { cascadeId: 'chat-iso-1' };
  Object.defineProperty(brokenChatReq, 'cascadeConfig', {
    enumerable: true,
    get() {
      throw new Error('simulated isolation serialization failure');
    },
  });

  assert.throws(
    () => h.fakeLsWrapper.sendUserCascadeMessage(brokenChatReq),
    /Chat isolation failed \(fail-closed\)/,
    'wrapper sendGuard 对 Chat 会话隔离异常必须 fail-closed 抛错'
  );
  assert.equal(h.wrapperSendCalls.length, 0, 'fail-closed 拒发绝不得调用原始 lsWrapper.sendUserCascadeMessage');

  assert.throws(
    () => h.fakeLsClient.sendUserCascadeMessage(brokenChatReq),
    /Chat isolation failed \(fail-closed\)/,
    'rawLs sendGuard 对 Chat 会话隔离异常必须 fail-closed 抛错'
  );
  assert.equal(h.rawSendCalls.length, 0, 'fail-closed 拒发绝不得调用原始 rawLs.sendUserCascadeMessage');

  // 2) Code 会话不受影响，原样零改动放行（包括未在 assignments 中的普通会话与原型键名）
  const codeReq = { cascadeId: 'code-session-ok', cascadeConfig: { plannerConfig: { planModel: 1532 } } };
  await h.fakeLsWrapper.sendUserCascadeMessage(codeReq);
  assert.equal(h.wrapperSendCalls.length, 1);
  assert.equal(h.wrapperSendCalls[0], codeReq, 'Code 会话必须原样引用透传');

  const protoNameReq = { cascadeId: 'toString', cascadeConfig: {} };
  await h.fakeLsWrapper.sendUserCascadeMessage(protoNameReq);
  assert.equal(h.wrapperSendCalls.length, 2);
  assert.equal(h.wrapperSendCalls[1], protoNameReq);

  // 3) reserveSession：带 customAgentSpec 的 3 种创建变体均失败后必须 fail-closed 报错拒绝，严禁第 4 次以裸 basePayload 创建会话
  const resv = await h.win.__agPrismSidebarHostOps.reserveSession({
    idempotencyKey: 'fc-reserve-1',
    scopeRef: 'scope-knowledge-default',
    kind: 'knowledge',
    title: 'Fail Closed Test',
    dirPath: '',
  });
  assert.equal(resv.ok, false, '全部隔离变体失败后 reserveSession 必须拒绝');
  assert.match(resv.error, /chat-isolation-spec-rejected/);
  assert.equal(h.startCalls.length, 3, '严禁降级发起第 4 次无 customAgentSpec 的裸 startCascade');
  assert.ok(
    h.startCalls.every((payload) => Boolean(payload && payload.customAgentSpec)),
    '所有尝试发起的 Chat startCascade 请求必须携带 customAgentSpec'
  );
  assert.equal(h.win.__agPrismSidebarLastStartStage, 'rejected-fail-closed');

  h.win.__agPrismSidebar.destroy();
});

test('P1 sidebar-client: bounded FIFO cap (<= 256) and off/destroy clear for reservedMap, deliveredMap, and sessionModelOverrides', async () => {
  const h = createSidebarClientHarness();
  h.win.__agPrismSidebar.sync({ sidebarStudio: 'on' });
  await new Promise((r) => setTimeout(r, 10));

  const ops = h.win.__agPrismSidebarHostOps;
  for (let i = 0; i < 270; i++) {
    const r = await ops.reserveSession({
      idempotencyKey: `resv-key-${i}`,
      scopeRef: 'scope-knowledge-default',
      kind: 'knowledge',
      title: `T${i}`,
      dirPath: '',
    });
    assert.equal(r.ok, true);
    const d = await ops.deliverFirstMessage({
      idempotencyKey: `deliv-key-${i}`,
      cascadeId: r.cascadeId,
      message: `msg-${i}`,
      scopeRef: 'scope-knowledge-default',
      kind: 'knowledge',
      dirPath: '',
    });
    assert.equal(d.status, 'delivered');
  }

  const stPeak = h.win.__agPrismSidebar.getState();
  assert.equal(stPeak.mapSizes.reserved, 256, 'host.reservedMap 必须严格封顶 256 条');
  assert.equal(stPeak.mapSizes.delivered, 256, 'host.deliveredMap 必须严格封顶 256 条');

  // 最早写入的第 0 条已被 FIFO 淘汰，最新的第 269 条仍命中幂等缓存
  const chkOld = await ops.checkDeliveryStatus({ idempotencyKey: 'deliv-key-0', cascadeId: 'any' });
  const chkNew = await ops.checkDeliveryStatus({ idempotencyKey: 'deliv-key-269', cascadeId: 'any' });
  assert.equal(chkOld.delivered, false, '超出 256 上限的最旧条目应被 FIFO 淘汰');
  assert.equal(chkNew.delivered, true, '最新条目应保留在容量窗口内');

  // 切 off 必须立即清空全部有界 Map
  h.win.__agPrismSidebar.sync({ sidebarStudio: 'off' });
  const stOff = h.win.__agPrismSidebar.getState();
  assert.equal(stOff.mapSizes.reserved, 0);
  assert.equal(stOff.mapSizes.delivered, 0);
  assert.equal(stOff.mapSizes.modelOverrides, 0);

  h.win.__agPrismSidebar.destroy();
});

test('P1 translator-service: blocks IPv6/multicast SSRF variants, keeps explicit http/LAN compatibility, preserves baseUrlError, and never leaks 3rd-party API keys to api.openai.com', async () => {
  // 1) 云元数据 / 未指定 / 链路本地 / 组播保留 / 危险端口 / 非 HTTP(S) 协议永远封杀
  const blockedUrls = [
    'http://169.254.169.254/latest/meta-data/',
    'http://100.100.100.200/latest/meta-data/',
    'http://0.0.0.0:11434/v1',
    'http://metadata.google.internal/computeMetadata/v1',
    'http://224.0.0.1:8000/v1',
    'http://255.255.255.255/v1',
    'http://[ff02::1]:8000/v1',
    'http://[::ffff:224.0.0.1]/v1',
    'http://[::ffff:169.254.169.254]/latest/meta-data/',
    'http://[::ffff:a9fe:a9fe]/latest/meta-data/',
    'http://[0:0:0:0:0:ffff:a9fe:a9fe]/v1',
    'http://[::ffff:100.100.100.200]/latest/meta-data/',
    'http://[::ffff:6464:64c8]/latest/meta-data/',
    'http://[::169.254.169.254]/latest/meta-data/',
    'http://[::a9fe:a9fe]/latest/meta-data/',
    'http://[::100.100.100.200]/latest/meta-data/',
    'http://[::6464:64c8]/latest/meta-data/',
    'http://[64:ff9b::169.254.169.254]/latest/meta-data/',
    'http://[64:ff9b::a9fe:a9fe]/latest/meta-data/',
    'http://[64:ff9b::100.100.100.200]/v1',
    'http://[64:ff9b::6464:64c8]/v1',
    'http://[fe80::1]:8000/v1',
    'http://[fe80::a9fe:a9fe]/v1',
    'http://[febf::1234]:8000/v1',
    'http://[fd00:ec2::254]/latest/meta-data/',
    'http://[::]:11434/v1',
    'http://[0:0:0:0:0:0:0:0]:11434/v1',
    'http://127.0.0.1:6379/v1',
    'http://192.168.1.20:22/v1',
    'file:///etc/passwd',
  ];

  for (const url of blockedUrls) {
    const check = validateOpenAiBaseUrl(url);
    assert.equal(check.ok, false, `validateOpenAiBaseUrl 必须拦截危险地址: ${url}`);
    assert.equal(isKeylessAllowedEndpoint(url), false, `isKeylessAllowedEndpoint 必须拒绝危险地址: ${url}`);
    // 兼容既有 normalizeOpenAiBaseUrl 单测契约
    assert.equal(normalizeOpenAiBaseUrl(url), 'https://api.openai.com/v1');
  }

  // 2) 显式回环默认允许 http://（insecureHttp: false）；显式公网/局域网 http:// 默认放行（insecureHttp: true），仅显式 allowInsecureHttp: false 时拒绝
  const allowedLoopbackUrls = [
    'http://127.0.0.1:11434/v1',
    'http://[::1]:8000/v1',
    'http://localhost:1234/v1',
  ];
  for (const url of allowedLoopbackUrls) {
    const check = validateOpenAiBaseUrl(url);
    assert.equal(check.ok, true, `合法本地回环端点应默认放行: ${url}`);
    assert.equal(check.insecureHttp, false, `本机回环不应标记为 insecureHttp: ${url}`);
    assert.equal(isKeylessAllowedEndpoint(url), true, `合法本地回环端点应允许免 Key: ${url}`);
  }
  const nonLoopbackHttpUrls = [
    'http://216.36.109.246/v1',
    'http://api.example.com/v1',
    'http://192.168.1.20:11434/v1',
    'http://10.0.0.8:8000/v1',
    'http://172.16.0.5:8000/v1',
    'http://100.64.0.12:8000/v1',
    'http://[fd12:3456::1]:11434/v1',
    'http://[fc00::1]:11434/v1',
  ];
  for (const url of nonLoopbackHttpUrls) {
    const allowedByDefault = validateOpenAiBaseUrl(url);
    assert.equal(allowedByDefault.ok, true, `用户显式填写的合法 http:// 应默认放行: ${url}`);
    assert.equal(allowedByDefault.insecureHttp, true, `非回环 http:// 应附带 insecureHttp: true 标记: ${url}`);
    const strictBlocked = validateOpenAiBaseUrl(url, { allowInsecureHttp: false });
    assert.equal(strictBlocked.ok, false, `显式 allowInsecureHttp: false 时仍必须拦截非回环 http://: ${url}`);
    assert.equal(strictBlocked.reason, 'insecure-http');
  }
  for (const url of nonLoopbackHttpUrls.slice(2)) {
    assert.equal(isKeylessAllowedEndpoint(url), true, `局域网内网端点仍可识别为免 Key: ${url}`);
  }
  // 无协议头裸地址补全：裸公网域名仍默认补 https://；裸回环与裸 RFC1918 局域网补 http://
  assert.equal(validateOpenAiBaseUrl('api.example.com/v1').url, 'https://api.example.com/v1');
  assert.equal(validateOpenAiBaseUrl('api.example.com/v1').insecureHttp, false);
  assert.equal(validateOpenAiBaseUrl('localhost.evil.com/v1').url, 'https://localhost.evil.com/v1');
  assert.equal(validateOpenAiBaseUrl('10.evil.com/v1').url, 'https://10.evil.com/v1');
  assert.equal(validateOpenAiBaseUrl('192.168.1.20:11434/v1').url, 'http://192.168.1.20:11434/v1');
  assert.equal(validateOpenAiBaseUrl('10.0.0.8:8000/v1').url, 'http://10.0.0.8:8000/v1');
  assert.equal(validateOpenAiBaseUrl('172.16.0.5:8000/v1').url, 'http://172.16.0.5:8000/v1');
  assert.equal(validateOpenAiBaseUrl('localhost:11434/v1').url, 'http://localhost:11434/v1');

  // 3) isKeylessAllowedEndpoint 公网 fc/fd 域名前缀禁止误放行
  assert.equal(isKeylessAllowedEndpoint('https://fc2.com/v1'), false);
  assert.equal(isKeylessAllowedEndpoint('https://fd-evil.com/v1'), false);
  assert.equal(isKeylessAllowedEndpoint('https://fc00.example.com/v1'), false);
  assert.equal(isKeylessAllowedEndpoint('https://fd99.example.org/v1'), false);

  // 4) 显式 http:// 公网与局域网渠道 saveConfig 保存不回弹 OpenAI，且防第三方 Key 静默泄漏至 api.openai.com
  const tmpDir = mkRealTempDir('prism-sec-trans-');
  try {
    const fetchCalls = [];
    const spyFetch = async (url, init) => {
      fetchCalls.push({ url: String(url), headers: init?.headers || {} });
      return new Response(JSON.stringify({ data: [{ id: 'qwen-local' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const svc = new ThoughtTranslatorService({ configDir: tmpDir, fetchImpl: spyFetch });
    const thirdPartyKey = 'sk-thirdparty-secret-99887766';

    // 4-compat) 用户自建公网 http:// 中转站与局域网 Ollama 均可保存不回弹，并可供思考翻译与提示词建议复用
    const savedCompat = svc.saveConfig({
      activeProfileId: 'relay-http',
      profiles: [
        {
          id: 'relay-http',
          name: 'Public HTTP Relay',
          baseUrl: 'http://216.36.109.246/v1',
          apiKey: thirdPartyKey,
          model: 'qwen-local',
        },
        {
          id: 'lan-ollama',
          name: 'LAN Ollama',
          baseUrl: 'http://192.168.1.20:11434/v1',
          apiKey: '',
          model: 'qwen2.5:7b',
        },
      ],
    });
    assert.equal(savedCompat.ok, true);
    assert.equal(savedCompat.profiles[0].baseUrl, 'http://216.36.109.246/v1');
    assert.equal(savedCompat.profiles[1].baseUrl, 'http://192.168.1.20:11434/v1');

    // 重启重新加载磁盘配置同样保留原 http:// 与局域网地址，绝不回弹默认 OpenAI
    const svcCompatReload = new ThoughtTranslatorService({ configDir: tmpDir, fetchImpl: spyFetch });
    const reloadedCfg = svcCompatReload.getSanitizedConfig();
    assert.equal(reloadedCfg.profiles[0].baseUrl, 'http://216.36.109.246/v1');
    assert.equal(reloadedCfg.profiles[1].baseUrl, 'http://192.168.1.20:11434/v1');
    const relayModels = await svcCompatReload.fetchModels({ profileId: 'relay-http' });
    assert.equal(relayModels.ok, true);
    assert.equal(fetchCalls[0].url, 'http://216.36.109.246/v1/models');
    const lanModels = await svcCompatReload.fetchModels({ profileId: 'lan-ollama' });
    assert.equal(lanModels.ok, true);
    assert.equal(fetchCalls[1].url, 'http://192.168.1.20:11434/v1/models');

    // PromptSuggesterService 复用同一渠道配置，同样无缝支持公网 http:// 与局域网 Ollama
    const sgSvc = new PromptSuggesterService({ configDir: tmpDir, translatorService: svcCompatReload });
    const sgState = await sgSvc.getPublicState();
    assert.equal(sgState.ok, true);
    assert.equal(sgState.backend.aiReady, true);
    const sgLanModels = await sgSvc.fetchModels({ profileId: 'lan-ollama' });
    assert.equal(sgLanModels.ok, true);
    assert.equal(fetchCalls[2].url, 'http://192.168.1.20:11434/v1/models');
    const sgBadSave = await sgSvc.saveWorkbenchConfig({
      activeProfileId: 'bad-sg',
      profiles: [{ id: 'bad-sg', name: 'Bad SG', baseUrl: 'http://169.254.169.254/v1', model: 'gpt-4o-mini' }],
    });
    assert.equal(sgBadSave.ok, false, 'PromptSuggesterService 保存非法 SSRF 地址时必须向上透传错误');
    assert.match(sgBadSave.error, /Blocked Base URL/);
    fetchCalls.length = 0;

    // 显式 allowInsecureHttp: false 构造严格模式时仍拦截非回环 http://
    const strictSvc = new ThoughtTranslatorService({
      configDir: path.join(tmpDir, 'strict-http'),
      fetchImpl: spyFetch,
      allowInsecureHttp: false,
    });
    const strictSave = strictSvc.saveConfig({
      activeProfileId: 'strict-http',
      profiles: [{ id: 'strict-http', name: 'Strict', baseUrl: 'http://216.36.109.246/v1', apiKey: thirdPartyKey, model: 'm' }],
    });
    assert.equal(strictSave.ok, false);
    assert.match(strictSave.error, /Plaintext http:\/\/ is blocked/);

    // 4a) 直接传被拦截的 baseUrl + 第三方 Key 给 fetchModels / testConnection
    const fmRes = await svc.fetchModels({ baseUrl: 'http://[::a9fe:a9fe]/v1', apiKey: thirdPartyKey });
    assert.equal(fmRes.ok, false);
    assert.match(fmRes.error, /Blocked Base URL/);

    const tcRes = await svc.testConnection({
      baseUrl: 'http://[64:ff9b::169.254.169.254]/v1',
      apiKey: thirdPartyKey,
      model: 'deepseek-chat',
    });
    assert.equal(tcRes.ok, false);
    assert.match(tcRes.error, /Blocked Base URL/);

    // 4b) 通过 saveConfig 保存含被拦截 URL + 第三方 Key 的 profile：既向上返回明确错误不吞 baseUrlError，又保持 fail-closed 落盘绝不发往 api.openai.com
    const blockedSave = svc.saveConfig({
      activeProfileId: 'evil-ssrf',
      profiles: [
        {
          id: 'evil-ssrf',
          name: 'Blocked Custom',
          baseUrl: 'http://169.254.169.254/latest/meta-data/',
          apiKey: thirdPartyKey,
          model: 'deepseek-chat',
        },
      ],
    });
    assert.equal(blockedSave.ok, false, 'saveConfig 遇到非法 SSRF 地址必须返回 ok: false 而不吞掉错误');
    assert.match(blockedSave.error, /Blocked Base URL/);
    assert.match(blockedSave.profiles[0].baseUrlError || '', /Blocked Base URL/);

    const trRes = await svc.translateThought({
      text: 'Verify third-party API key is never leaked to OpenAI when custom baseUrl is blocked.',
      mode: 'ai',
    });
    assert.equal(trRes.ok, false);
    assert.match(trRes.error, /Blocked Base URL/);

    // 模拟重启重新从磁盘加载该配置，同样必须拒绝而非落盘成 api.openai.com，且 getSanitizedConfig 保留 baseUrlError
    const svcReloaded = new ThoughtTranslatorService({ configDir: tmpDir, fetchImpl: spyFetch });
    const reloadedErrCfg = svcReloaded.getSanitizedConfig();
    assert.equal(reloadedErrCfg.profiles[0].baseUrl, '');
    assert.match(reloadedErrCfg.profiles[0].baseUrlError || '', /Blocked Base URL/);
    const trReloaded = await svcReloaded.translateThought({
      text: 'Reloaded profile with blocked baseUrl must stay fail-closed without hitting OpenAI.',
      mode: 'ai',
    });
    assert.equal(trReloaded.ok, false);
    assert.match(trReloaded.error, /Blocked Base URL/);
    assert.equal(fetchCalls.length, 0, '任何被拦截 URL 场景下 fetchImpl 必须为 0 次调用，绝不把第三方 Key 发往 api.openai.com');

    // 4c) 留空 baseUrl 时明确使用默认 OpenAI 端点（回归兼容）
    const defaultSave = svcReloaded.saveConfig({
      activeProfileId: 'default-openai',
      profiles: [{ id: 'default-openai', name: 'Default OpenAI', baseUrl: '', apiKey: thirdPartyKey, model: 'gpt-4o-mini' }],
    });
    assert.equal(defaultSave.ok, true);
    const okModels = await svcReloaded.fetchModels({});
    assert.equal(okModels.ok, true);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'https://api.openai.com/v1/models');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('P2 live-host-adapter: rejects __proto__/constructor/prototype cascadeId and uses null-prototype lookup map', () => {
  const adapter = createLiveHostAdapter();
  adapter.syncFromRenderer({
    catalog: {
      health: 'ready',
      items: [
        { cascadeId: '__proto__', title: 'evil1', status: 'idle', updatedAt: 10 },
        { cascadeId: 'constructor', title: 'evil2', status: 'idle', updatedAt: 11 },
        { cascadeId: 'prototype', title: 'evil3', status: 'idle', updatedAt: 12 },
        { cascadeId: 'safe-chat-1', title: 'Safe Chat', status: 'idle', updatedAt: 20 },
      ],
    },
  });

  const snap = adapter.getCatalog();
  assert.deepEqual(snap.items.map((x) => x.cascadeId), ['safe-chat-1']);
  assert.equal(Object.prototype.hasOwnProperty.call(snap.lastKnownById, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snap.lastKnownById, 'constructor'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snap.lastKnownById, 'prototype'), false);
  assert.equal(snap.lastKnownById['safe-chat-1']?.title, 'Safe Chat');
});

test('P2 pulse-dashboard: store LRU preserves processing background sessions & bounds cachedSession; trajectory-reader drops stale 0-byte zombies; usage & background-statistics cap caches and surface diagnostics', async () => {
  const tmpDir = mkRealTempDir('prism-sec-pulse-');
  try {
    // 1) MetricsStore: LRU 淘汰跳过活跃后台处理态会话，且 cachedSession 复用 32 条上限淘汰
    const mkGuid = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const bgId = mkGuid(0);
    const fakeClient = {
      reader: {},
      call: async () => ({}),
      discover: async () => ({ pid: 1, port: 1234, csrf: 'tok' }),
      trajectory: async (id) => ({
        trajectory: { cascadeId: id, steps: [], generatorMetadata: [] },
        numTotalSteps: 0,
        numTotalGeneratorMetadata: 0,
        status: 'IDLE',
      }),
    };
    const fakeHistory = {
      directory: path.join(tmpDir, 'history-v1'),
      load: async (_scope, id) => ({
        metrics: {
          conversationId: id,
          tokens: { totalTokens: 100, inputTokens: 80, outputTokens: 20, outputRequests: 1 },
          cache: { readTokens: 0, writeTokens: 0 },
          requests: 1,
        },
        savedAt: new Date().toISOString(),
      }),
      save: async () => ({ savedAt: new Date().toISOString() }),
    };
    const fakeBackground = {
      state: (id) => (id === bgId ? { state: 'processing', stage: 'steps' } : null),
      request: () => true,
      reset() {},
      dispose() {},
    };
    const store = new MetricsStore(fakeClient, {
      dataDir: tmpDir,
      history: fakeHistory,
      background: fakeBackground,
      transcripts: null,
    });
    // 放入一个活跃后台处理态会话
    store.sessions.set(bgId, { data: null, backgroundOnly: true, pending: null, updatedAt: 0 });
    for (let i = 1; i <= 40; i++) {
      await store.session(mkGuid(i), true);
    }
    assert.equal(store.sessions.has(bgId), true, 'LRU 淘汰必须跳过活跃后台处理态会话');
    assert.ok(store.sessions.size <= 32, `session() 后 sessions.size 必须 <= 32，实测 ${store.sessions.size}`);

    // cachedSession() 同样复用上限淘汰（非后台会话不突破 32 上限）
    store.sessions.clear();
    for (let i = 100; i < 145; i++) {
      await store.cachedSession(mkGuid(i));
    }
    assert.ok(store.sessions.size <= 32, `cachedSession() 后 sessions.size 必须 <= 32，实测 ${store.sessions.size}`);

    // 2) TrajectoryReader.read(): 调用方 isCurrent() 变 false 中止时清理 0 字节僵尸条目
    let stillCurrent = true;
    const reader = new TrajectoryReader({
      now: () => Date.now(),
      discover: async () => ({ pid: 1, port: 4321, csrf: 'tok' }),
      call: async (method) => {
        if (method === 'GetAllCascadeTrajectories') {
          stillCurrent = false; // 模拟中途调用方失活（未触发 reset）
          return { trajectorySummaries: { [bgId]: { stepCount: 1, status: 'IDLE', lastModifiedTime: '2026-11-20T00:00:00Z' } } };
        }
        return { steps: [], generatorMetadata: [] };
      },
    });
    await assert.rejects(
      () => reader.read(bgId, { isCurrent: () => stillCurrent }),
      /后台已重新连接/
    );
    assert.equal(reader.entries.has(bgId), false, 'isCurrent() 变 false 中止后不得在 entries 中残留 0 字节僵尸条目');

    // 3) UsageLedger.caches & diskSummaryRetries 容量上限 <= 64 且 DesktopUsage.dispose() 同步置空 ledger._cache
    const ledger = new UsageLedger(path.join(tmpDir, 'usage-v1'));
    for (let i = 0; i < 80; i++) {
      ledger.cache = { key: `k:${i}`, revision: i, value: { totalTokens: i } };
      ledger.diskSummaryRetry = { key: `r:${i}`, at: Date.now() + 30000 };
    }
    assert.equal(ledger.caches.size, 64, 'UsageLedger.caches 必须封顶 64 条');
    assert.equal(ledger.diskSummaryRetries.size, 64, 'UsageLedger.diskSummaryRetries 必须封顶 64 条');
    assert.ok(ledger._cache !== null);

    const desktopUsage = new DesktopUsage(store, ledger);
    desktopUsage.dispose();
    assert.equal(ledger._cache, null, 'DesktopUsage.dispose() 必须同步置空 ledger._cache');
    assert.equal(ledger._diskSummaryRetry, null, 'DesktopUsage.dispose() 必须同步置空 ledger._diskSummaryRetry');
    assert.equal(ledger.caches.size, 0);
    assert.equal(ledger.diskSummaryRetries.size, 0);

    // 4) BackgroundStatistics 识别 Worker OOM 并暴露可诊断提示（worker-oom）
    const fakeWorker = new EventEmitter();
    fakeWorker.terminate = async () => {};
    const bg = new BackgroundStatistics({
      directory: path.join(tmpDir, 'collection-jobs'),
      workerFactory: () => fakeWorker,
    });
    const reqOk = bg.request(LOCAL_SCOPE, bgId, { port: 4321, csrf: 'tok' });
    assert.equal(reqOk, true);
    for (let i = 0; i < 300 && fakeWorker.listenerCount('error') === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.ok(fakeWorker.listenerCount('error') > 0, 'BackgroundStatistics must attach worker error listener');
    fakeWorker.emit('error', Object.assign(new Error('Worker terminated due to reaching memory limit'), { code: 'ERR_WORKER_OUT_OF_MEMORY' }));
    for (let i = 0; i < 100 && bg.state(bgId)?.state !== 'limited'; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const st = bg.state(bgId);
    assert.equal(st?.state, 'limited');
    assert.equal(st?.reason, 'worker-oom');
    assert.equal(bg.lastDiagnostic?.reason, 'worker-oom');
    assert.match(String(bg.lastDiagnostic?.detail || ''), /maxOldGenerationSizeMb=48/);
    bg.dispose();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('security-vendor 7: ThoughtTranslatorService _request blocks DNS-rebinding SSRF (direct & HTTP proxy), allows explicit loopback/LAN/http, and forces redirect=error', async () => {
  const tmpDir = mkRealTempDir('prism-tt-ssrf-');
  try {
    const blockedIps = [
      { address: '127.0.0.1', family: 4 },
      { address: '169.254.169.254', family: 4 },
      { address: '10.0.0.8', family: 4 },
      { address: '172.16.0.5', family: 4 },
      { address: '192.168.1.20', family: 4 },
      { address: '0.0.0.0', family: 4 },
      { address: 'fc00::1', family: 6 },
      { address: 'fe80::1', family: 6 },
      { address: '::1', family: 6 },
      { address: '::ffff:127.0.0.1', family: 6 },
    ];

    // 1) 直连 DNS Rebinding 到内网/云元数据/回环必须全部拦截（即便默认 _allowPrivateIp=true），0 fetch 调用
    for (const ipEntry of blockedIps) {
      let fetchCalls = 0;
      const svc = new ThoughtTranslatorService({
        configFile: path.join(tmpDir, 'direct.json'),
        cacheFile: path.join(tmpDir, 'direct-cache.json'),
        dnsLookup: async () => [ipEntry],
        fetchImpl: async () => {
          fetchCalls += 1;
          return { ok: true, status: 200, text: async () => '{}' };
        },
      });
      await assert.rejects(
        () => svc._request('https://rebind.evil.example/v1/models', { method: 'GET' }),
        /SSRF|private|loopback|reserved|internal|DNS|内网|回环|保留/i,
        `DNS rebinding -> ${ipEntry.address} must be blocked on direct path`
      );
      assert.equal(fetchCalls, 0, `fetchImpl must not execute for rebinding IP ${ipEntry.address}`);
    }

    // 2) HTTP 代理通路同样先做 DNS Rebinding 二次校验，命中内网/云元数据立即拦截
    const proxySvc = new ThoughtTranslatorService({
      configFile: path.join(tmpDir, 'proxy.json'),
      cacheFile: path.join(tmpDir, 'proxy-cache.json'),
      dnsLookup: async () => [{ address: '169.254.169.254', family: 4 }],
    });
    let proxyFetchInvoked = false;
    proxySvc._fetchViaProxy = async () => {
      proxyFetchInvoked = true;
      return { ok: true, status: 200, text: async () => '{}' };
    };
    await assert.rejects(
      () =>
        proxySvc._request(
          'https://metadata-rebind.evil.example/latest/meta-data/',
          { method: 'GET' },
          { proxyMode: 'custom', customProxyUrl: 'http://127.0.0.1:7890' }
        ),
      /SSRF|private|loopback|reserved|internal|DNS|内网|回环|保留/i,
      'DNS rebinding must also be blocked on HTTP proxy path'
    );
    assert.equal(proxyFetchInvoked, false, '_fetchViaProxy must not run when DNS resolves to blocked metadata IP');

    // 3) 用户显式填写本机回环 / 局域网 Ollama IP / 公网 http:// 中转站默认放行，且强制 redirect='error'
    const captured = [];
    const okSvc = new ThoughtTranslatorService({
      configFile: path.join(tmpDir, 'ok.json'),
      cacheFile: path.join(tmpDir, 'ok-cache.json'),
      dnsLookup: async (host) =>
        host === 'api.public.example'
          ? [{ address: '93.184.216.34', family: 4 }]
          : [{ address: '127.0.0.1', family: 4 }],
      fetchImpl: async (url, init) => {
        captured.push({ url, init });
        return { ok: true, status: 200, text: async () => '{"data":[]}' };
      },
    });
    await okSvc._request('http://127.0.0.1:11434/v1/models', { method: 'GET', redirect: 'follow' });
    await okSvc._request('http://localhost:1234/v1/models', { method: 'GET' });
    await okSvc._request('http://192.168.1.20:11434/v1/models', { method: 'GET', redirect: 'follow' });
    await okSvc._request('http://216.36.109.246/v1/models', { method: 'GET', redirect: 'follow' });
    await okSvc._request('https://api.public.example/v1/models', {
      method: 'GET',
      redirect: 'follow',
      headers: { Authorization: 'Bearer sk-secret-token' },
    });
    assert.equal(captured.length, 5);
    for (const item of captured) {
      assert.equal(item.init.redirect, 'error', `Request ${item.url} must enforce redirect=error`);
    }
    // 危险云元数据 / 组播 IP 字面量即使在默认配置下依然 100% 封杀
    for (const badDirect of [
      'http://169.254.169.254/latest/meta-data/',
      'http://100.100.100.200/latest/meta-data/',
      'http://0.0.0.0:11434/v1/models',
      'http://224.0.0.1/v1/models',
      'http://[fe80::1]:8000/v1/models',
      'http://[ff02::1]:8000/v1/models',
      'http://[fd00:ec2::254]/latest/meta-data/',
    ]) {
      await assert.rejects(() => okSvc._request(badDirect, { method: 'GET' }), /SSRF|Blocked/i);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('security-vendor 8: ThoughtTranslatorService _persistStore and _flushCacheToDisk reject symlink/junction paths and write atomically', () => {
  const tmpDir = mkRealTempDir('prism-tt-atomic-');
  try {
    // 1) 正常原子落盘校验
    const cleanDir = path.join(tmpDir, 'clean');
    const configFile = path.join(cleanDir, 'thought-translator.json');
    const cacheFile = path.join(cleanDir, 'thought-translator-cache.json');
    const svc = new ThoughtTranslatorService({ configFile, cacheFile });
    const persisted = svc._persistStore({ ...svc._config, model: 'gpt-4o-mini' });
    assert.equal(persisted?.ok, true);
    assert.equal(fs.existsSync(configFile), true);
    assert.equal(JSON.parse(fs.readFileSync(configFile, 'utf8')).model, 'gpt-4o-mini');

    svc.memCache.set('k-atomic', '原子写入测试');
    svc._flushCacheToDisk();
    assert.equal(fs.existsSync(cacheFile), true);
    assert.match(fs.readFileSync(cacheFile, 'utf8'), /原子写入测试/);

    // 2) 父目录存在 symlink/junction 时必须拒绝写入，不污染真实目录中的诱饵文件
    const victimDir = path.join(tmpDir, 'victim-real');
    fs.mkdirSync(victimDir, { recursive: true });
    const victimStore = path.join(victimDir, 'store.json');
    const victimCache = path.join(victimDir, 'cache.json');
    fs.writeFileSync(victimStore, '{"sentinel":"do-not-touch"}\n', 'utf8');
    fs.writeFileSync(victimCache, '{"sentinel":"cache-untouched"}\n', 'utf8');

    const linkDir = path.join(tmpDir, 'link-dir');
    fs.symlinkSync(victimDir, linkDir, process.platform === 'win32' ? 'junction' : 'dir');

    const linkSvc = new ThoughtTranslatorService({
      configFile: path.join(linkDir, 'store.json'),
      cacheFile: path.join(linkDir, 'cache.json'),
    });
    const storeWriteRes = linkSvc._persistStore({ ...linkSvc._config, model: 'evil-overwrite' });
    assert.equal(Boolean(storeWriteRes?.ok), false, '_persistStore must refuse writing through symlink/junction path');
    assert.equal(
      JSON.parse(fs.readFileSync(victimStore, 'utf8')).sentinel,
      'do-not-touch',
      'Victim store file must remain untouched'
    );

    linkSvc.memCache.set('k-evil', 'evil');
    linkSvc._flushCacheToDisk();
    assert.equal(
      JSON.parse(fs.readFileSync(victimCache, 'utf8')).sentinel,
      'cache-untouched',
      '_flushCacheToDisk must refuse writing through symlink/junction path'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('security-vendor 9: OmniServer._isTrustedLocalOrigin rejects arbitrary file:// origins while preserving Antigravity local origins', () => {
  const srv = new OmniServer();
  for (const bad of [
    'file://',
    'file:///',
    'file:///C:/Users/victim/Downloads/evil.html',
    'file://attacker.local/share/payload.html',
    'file://localhost/tmp/evil.html',
    'https://evil.example.com',
    'http://127.0.0.1.evil.example',
    'vscode-file://vscode-app/extra/path',
    'null',
    '',
  ]) {
    assert.equal(srv._isTrustedLocalOrigin(bad), false, `Untrusted origin must be rejected: ${bad}`);
  }

  for (const good of [
    'vscode-file://vscode-app',
    'app://antigravity',
    'http://127.0.0.1:4321',
    'https://127.0.0.1:4321',
    'http://localhost:8080',
    'https://[::1]:9000',
  ]) {
    assert.equal(srv._isTrustedLocalOrigin(good), true, `Trusted local origin must be accepted: ${good}`);
  }
});

test('security-vendor 10: effort-slider upstream-client dumpTrace redacts Windows/macOS/Linux user home directories to <USER_HOME>', () => {
  const code = fs.readFileSync(path.join(ROOT_DIR, 'vendor', 'effort-slider', 'upstream-client.js'), 'utf8');
  let copiedText = '';
  const listeners = new Map();
  const makeEl = (tag) => {
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      className: '',
      textContent: '',
      style: {},
      children: [],
      attrs: new Map(),
      classList: {
        add() {},
        remove() {},
        toggle() {},
        contains() {
          return false;
        },
      },
      setAttribute(k, v) {
        this.attrs.set(k, String(v));
      },
      getAttribute(k) {
        return this.attrs.has(k) ? this.attrs.get(k) : null;
      },
      appendChild(c) {
        this.children.push(c);
        return c;
      },
      addEventListener(type, fn) {
        if (!listeners.has(this)) listeners.set(this, new Map());
        listeners.get(this).set(type, fn);
      },
      remove() {},
    };
    return el;
  };
  const body = makeEl('body');
  const head = makeEl('head');
  const docEl = makeEl('html');
  const doc = {
    body,
    head,
    documentElement: docEl,
    readyState: 'complete',
    createElement: makeEl,
    getElementById: () => null,
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  const win = {
    document: doc,
    innerWidth: 1200,
    innerHeight: 800,
    __agCodexEffortSliderDisableAutoBoot: true,
    navigator: {
      language: 'en',
      userAgent: 'Electron C:\\Users\\alice_secret\\AppData /Users/bob_secret/Library /home/carol_secret/.config',
      clipboard: {
        writeText(t) {
          copiedText = String(t);
        },
      },
    },
    addEventListener() {},
    removeEventListener() {},
  };
  doc.defaultView = win;
  const ctx = vm.createContext({
    window: win,
    document: doc,
    navigator: win.navigator,
    globalThis: win,
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Map,
    Set,
    Number,
    String,
    Boolean,
    RegExp,
    Error,
  });
  ctx.globalThis = ctx;
  vm.runInContext(code, ctx);
  const api = ctx.AntigravityCodexEffortSlider || win.AntigravityCodexEffortSlider;
  assert.ok(api && typeof api.openSettingsPanel === 'function');
  const close = api.openSettingsPanel({ document: doc, window: win });
  const panel = body.children.find((c) => c.className === 'ces-set');
  assert.ok(panel, 'Settings panel must be mounted');
  const findBtn = (node) => {
    if (!node) return null;
    if (node.tagName === 'BUTTON' && /Copy Debug|复制诊断/.test(node.textContent)) return node;
    for (const ch of node.children || []) {
      const hit = findBtn(ch);
      if (hit) return hit;
    }
    return null;
  };
  const debugBtn = findBtn(panel);
  assert.ok(debugBtn, 'Copy Debug button must exist');
  const onClick = listeners.get(debugBtn)?.get('click');
  assert.equal(typeof onClick, 'function');
  onClick({ stopPropagation() {}, preventDefault() {} });
  close();

  assert.ok(copiedText.length > 0, 'dumpTrace must write sanitized JSON to clipboard');
  assert.equal(/alice_secret|bob_secret|carol_secret/i.test(copiedText), false, 'User home directory names must be redacted');
  assert.match(copiedText, /<USER_HOME>/, 'Redacted trace must contain <USER_HOME> placeholder');
});

test('security-vendor 11: Static test-hygiene gate forbids unsafe ThoughtTranslatorService constructions across test/*.test.mjs', () => {
  const testDir = path.join(ROOT_DIR, 'test');
  const testFiles = fs
    .readdirSync(testDir)
    .filter((f) => f.endsWith('.test.mjs'))
    .sort();
  assert.ok(testFiles.length >= 5, 'Expected multiple test/*.test.mjs files to scan');

  const stripCommentsAndStrings = (src) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
      .replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => m[0] + ' '.repeat(Math.max(0, m.length - 2)) + m[0]);

  const violations = [];
  const ctorRe = /\bnew\s+ThoughtTranslatorService\s*\(/g;

  for (const file of testFiles) {
    const raw = fs.readFileSync(path.join(testDir, file), 'utf8');
    const clean = stripCommentsAndStrings(raw);
    let m;
    ctorRe.lastIndex = 0;
    while ((m = ctorRe.exec(clean)) !== null) {
      let depth = 1;
      let idx = m.index + m[0].length;
      while (idx < clean.length && depth > 0) {
        const ch = clean[idx];
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        idx += 1;
      }
      const argText = clean.slice(m.index + m[0].length, idx - 1);
      const lineNo = raw.slice(0, m.index).split(/\r?\n/).length;
      if (/\bstorePath\b/.test(argText)) {
        violations.push(`${file}:${lineNo} passes invalid option storePath (must use configFile/configDir/homeDir)`);
      }
      if (!/\b(?:configFile|configDir|homeDir)\b/.test(argText)) {
        violations.push(`${file}:${lineNo} omits configFile/configDir/homeDir isolation (risk of overwriting ~/.gemini/config/obsidian-prism-thought.json)`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Unsafe ThoughtTranslatorService test constructions detected:\n${violations.join('\n')}`
  );
});

test('security-vendor 12: thought-settings-ui preserves explicit http:// URLs and surfaces baseUrlError instead of reverting to api.openai.com', async () => {
  const uiCode = fs.readFileSync(
    path.join(ROOT_DIR, 'vendor', 'thought-translator', 'thought-settings-ui.js'),
    'utf8'
  );
  const tmpDir = mkRealTempDir('prism-tt-ui-err-');
  try {
    const svc = new ThoughtTranslatorService({ configDir: tmpDir });
    const listeners = new Map();
    const makeEl = (tag) => {
      const attrs = new Map();
      const children = [];
      const el = {
        nodeType: 1,
        tagName: String(tag || 'div').toUpperCase(),
        className: '',
        type: '',
        value: '',
        placeholder: '',
        hidden: false,
        disabled: false,
        isConnected: true,
        style: {},
        children,
        get firstChild() {
          return children[0] || null;
        },
        set textContent(v) {
          this._text = String(v ?? '');
          children.length = 0;
        },
        get textContent() {
          return this._text ?? children.map((c) => c.textContent).join('');
        },
        setAttribute(k, v) {
          attrs.set(k, String(v));
        },
        getAttribute(k) {
          return attrs.has(k) ? attrs.get(k) : null;
        },
        hasAttribute(k) {
          return attrs.has(k);
        },
        removeAttribute(k) {
          attrs.delete(k);
        },
        toggleAttribute(k, force) {
          const next = force === undefined ? !attrs.has(k) : Boolean(force);
          if (next) attrs.set(k, '');
          else attrs.delete(k);
          return next;
        },
        classList: {
          add() {},
          remove() {},
          toggle() {},
          contains: () => false,
        },
        appendChild(c) {
          c.parentElement = el;
          children.push(c);
          return c;
        },
        insertBefore(c, ref) {
          c.parentElement = el;
          const i = ref ? children.indexOf(ref) : -1;
          if (i >= 0) children.splice(i, 0, c);
          else children.push(c);
          return c;
        },
        removeChild(c) {
          const i = children.indexOf(c);
          if (i >= 0) children.splice(i, 1);
          c.parentElement = null;
        },
        remove() {
          if (el.parentElement) el.parentElement.removeChild(el);
        },
        addEventListener(type, fn) {
          if (!listeners.has(el)) listeners.set(el, new Map());
          listeners.get(el).set(type, fn);
        },
        querySelector(sel) {
          const m = /^\[data-testid="([^"]+)"\]$/.exec(sel);
          if (!m) return null;
          const walk = (n) => {
            if (n.getAttribute?.('data-testid') === m[1]) return n;
            for (const ch of n.children || []) {
              const hit = walk(ch);
              if (hit) return hit;
            }
            return null;
          };
          return walk(el);
        },
        querySelectorAll() {
          return [];
        },
      };
      return el;
    };

    const mkEl = (tag, cls, txt) => {
      const el = makeEl(tag);
      if (cls) el.className = cls;
      if (txt !== undefined && txt !== null) el.textContent = String(txt);
      return el;
    };
    const doc = {
      documentElement: makeEl('html'),
      body: makeEl('body'),
      createElement: makeEl,
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const api = {
      getConfig: async () => svc.getSanitizedConfig(),
      saveConfig: async (payload) => svc.saveConfig(payload),
      testConnection: async (payload) => svc.testConnection(payload),
      fetchModels: async (payload) => svc.fetchModels(payload),
      scan() {},
    };
    const win = {
      document: doc,
      __agPrismThought: api,
      URL,
      setTimeout,
      clearTimeout,
    };
    const ctx = vm.createContext({
      window: win,
      document: doc,
      globalThis: win,
      URL,
      console,
      setTimeout,
      clearTimeout,
      Promise,
      Object,
      Array,
      Map,
      Set,
      Number,
      String,
      Boolean,
      RegExp,
      Error,
      Date,
      Math,
      JSON,
    });
    ctx.globalThis = ctx;
    vm.runInContext(uiCode, ctx);

    const uiMod = ctx.__agPrismThoughtSettingsUi || win.__agPrismThoughtSettingsUi;
    const handle = uiMod.createThoughtAiConfigBox({
      mkEl,
      btnClass: 'ag-cs-thought-btn',
      ui: {},
      lang: 'zh-CN',
      getMode: () => 'ai',
      runGuardedMut: (fn) => fn(),
    });
    await new Promise((r) => setTimeout(r, 20));

    const urlInput = handle.box.querySelector('[data-testid="thought-base-url"]');
    const saveBtn = handle.box.querySelector('[data-testid="thought-save-btn"]');
    const statusEl = handle.box.querySelector('[data-testid="thought-status-badge"]');
    assert.ok(urlInput && saveBtn && statusEl, 'Expected URL input, save button, and status element');

    // 1) 保存合法公网 http:// 中转站：保留原地址不回弹 api.openai.com
    urlInput.value = 'http://216.36.109.246/v1';
    listeners.get(urlInput).get('input')({});
    listeners.get(saveBtn).get('click')({});
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(urlInput.value, 'http://216.36.109.246/v1');
    assert.equal(statusEl.getAttribute('data-state'), 'ok');

    // 2) 保存真正被拒的 SSRF 地址：显示真实错误且绝不回弹 api.openai.com
    urlInput.value = 'http://169.254.169.254/latest/meta-data/';
    listeners.get(urlInput).get('input')({});
    listeners.get(saveBtn).get('click')({});
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(statusEl.getAttribute('data-state'), 'err');
    assert.match(statusEl.textContent, /Blocked Base URL/);
    assert.notEqual(urlInput.value, 'https://api.openai.com/v1');

    // 3) 重新冷加载被拒状态配置：不回退显示 api.openai.com，且立刻呈现 baseUrlError
    await handle.reloadConfig();
    assert.equal(urlInput.value, '', 'Reloaded profile with baseUrlError must not silently revert to api.openai.com');
    assert.equal(statusEl.getAttribute('data-state'), 'err');
    assert.match(statusEl.textContent, /Blocked Base URL/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
