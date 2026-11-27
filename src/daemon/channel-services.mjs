// Obsidian Prism 通道专属本地后端服务懒启停管理器（Omni / Sidebar / Thought / Wallpaper / Suggester，无原型 Mixin）
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OmniServer } from '../../vendor/omni-viewer/omni-server.mjs';
import { PKG_VERSION, SIDEBAR_BINDING } from './constants.mjs';

export class ChannelServiceManager {
  constructor({
    rootDir = '',
    getCdp = () => null,
    log = () => {},
    pickActiveSidebarHostEntry = () => null,
    onOmniServerStarted = null,
    onSidebarServiceStarted = null,
    omniExecHooks = null,
    sidebarService = null,
    thoughtService = null,
    wallpaperService = null,
    suggesterService = null,
  } = {}) {
    this._rootDir = rootDir;
    this._getCdp = getCdp;
    this._log = log;
    this._pickActiveSidebarHostEntry = pickActiveSidebarHostEntry;
    this._onOmniServerStarted = onOmniServerStarted;
    this._onSidebarServiceStarted = onSidebarServiceStarted;
    this._omniExecHooks = omniExecHooks;

    this.omniServer = null;
    this._omniServerPromise = null;
    this.sidebarService = sidebarService;
    this._sidebarServicePromise = null;
    this._sidebarStopped = false;
    this._lazyThoughtService = thoughtService;
    this._lazyWallpaperService = wallpaperService;
    this._wallpaperServicePromise = null;
    this._wallpaperStopped = false;
    this._lazySuggesterService = suggesterService;
    this._suggesterServicePromise = null;
    this._suggesterStopped = false;
  }

  setRootDir(dir) {
    this._rootDir = dir;
  }

  markStarted() {
    this._sidebarStopped = false;
    this._wallpaperStopped = false;
    this._suggesterStopped = false;
  }

  markStopping() {
    this._sidebarStopped = true;
    this._wallpaperStopped = true;
    this._suggesterStopped = true;
  }

  getSidebarServerMeta() {
    const cdp = this._getCdp?.();
    return {
      binding: SIDEBAR_BINDING,
      version: cdp?.PLUGIN_VERSION || PKG_VERSION,
      schemaVersion: 2,
      serviceReady:
        !this._sidebarStopped &&
        typeof this.sidebarService?.handleRpc === 'function' &&
        !this.sidebarService.getBootDiagnostic?.(),
    };
  }

  async ensureThoughtService() {
    if (this._lazyThoughtService) return this._lazyThoughtService;
    const modUrl = new URL('../../vendor/thought-translator/translator-service.mjs', import.meta.url);
    const { ThoughtTranslatorService } = await import(modUrl.href);
    this._lazyThoughtService = new ThoughtTranslatorService();
    return this._lazyThoughtService;
  }

  async ensureWallpaperService() {
    if (this._wallpaperStopped) return null;
    if (this._lazyWallpaperService) return this._lazyWallpaperService;
    if (this._wallpaperServicePromise) return this._wallpaperServicePromise;
    this._wallpaperServicePromise = (async () => {
      const svcPath = path.join(this._rootDir, 'vendor', 'wallpaper', 'wallpaper-service.mjs');
      if (!fs.existsSync(svcPath)) return null;
      const mod = await import(pathToFileURL(svcPath).href);
      const factory = mod?.createWallpaperService || mod?.default;
      if (this._wallpaperStopped || typeof factory !== 'function') return null;
      const svc = factory({ logger: (m) => this._log(m) });
      if (this._wallpaperStopped) {
        try {
          if (typeof svc?.dispose === 'function') await svc.dispose();
        } catch {}
        return null;
      }
      this._lazyWallpaperService = svc;
      return svc;
    })();
    try {
      return await this._wallpaperServicePromise;
    } finally {
      this._wallpaperServicePromise = null;
    }
  }

  async ensureSuggesterService() {
    if (this._suggesterStopped) return null;
    if (this._lazySuggesterService) return this._lazySuggesterService;
    if (this._suggesterServicePromise) return this._suggesterServicePromise;
    this._suggesterServicePromise = (async () => {
      const svcPath = path.join(this._rootDir, 'vendor', 'prompt-suggester', 'suggester-service.mjs');
      if (!fs.existsSync(svcPath)) return null;
      const mod = await import(pathToFileURL(svcPath).href);
      const factory = mod?.createPromptSuggesterService || mod?.default;
      if (this._suggesterStopped || typeof factory !== 'function') return null;
      const svc = factory({ getTranslatorService: () => this.ensureThoughtService() });
      if (this._suggesterStopped) {
        try {
          if (typeof svc?.dispose === 'function') await svc.dispose();
        } catch {}
        return null;
      }
      this._lazySuggesterService = svc;
      return svc;
    })();
    try {
      return await this._suggesterServicePromise;
    } finally {
      this._suggesterServicePromise = null;
    }
  }

  async ensureSidebarService() {
    if (this._sidebarStopped) return null;
    if (this.sidebarService) return this.sidebarService;
    if (this._sidebarServicePromise) return this._sidebarServicePromise;
    this._sidebarServicePromise = (async () => {
      const svcPath = path.join(this._rootDir, 'vendor', 'sidebar-studio', 'sidebar-service.mjs');
      if (!fs.existsSync(svcPath)) return null;
      const mod = await import(pathToFileURL(svcPath).href);
      const Ctor = mod?.SidebarStudioService || mod?.default;
      if (this._sidebarStopped || typeof Ctor !== 'function') return null;

      let hostAdapter = null;
      const adapterPath = path.join(this._rootDir, 'vendor', 'sidebar-studio', 'live-host-adapter.mjs');
      if (fs.existsSync(adapterPath)) {
        try {
          const adapterMod = await import(pathToFileURL(adapterPath).href);
          if (typeof adapterMod?.createLiveHostAdapter === 'function') {
            hostAdapter = adapterMod.createLiveHostAdapter({
              logger: (m) => this._log(m),
              evaluateInHost: async (expr, timeoutMs = 4500) => {
                const entry = this._pickActiveSidebarHostEntry();
                if (!entry || entry.session.closed) return { ok: false, error: 'no-verified-host-window' };
                return entry.session.evaluate(expr, true, timeoutMs);
              },
            });
          }
        } catch {}
      }

      const svc = new Ctor({ logger: (m) => this._log(m), hostAdapter });
      this.sidebarService = svc;
      this._onSidebarServiceStarted?.(svc);
      return svc;
    })();
    try {
      return await this._sidebarServicePromise;
    } finally {
      this._sidebarServicePromise = null;
    }
  }

  async ensureOmniServer() {
    if (this.omniServer && this.omniServer.running) return this.omniServer;
    if (this._omniServerPromise) return this._omniServerPromise;
    this._omniServerPromise = (async () => {
      const srv = new OmniServer({ rootDir: this._rootDir, execHooks: this._omniExecHooks });
      await srv.start();
      this.omniServer = srv;
      this._onOmniServerStarted?.(srv);
      return srv;
    })();
    try {
      return await this._omniServerPromise;
    } finally {
      this._omniServerPromise = null;
    }
  }

  async stopOmniServer() {
    if (!this.omniServer) return;
    const oldSrv = this.omniServer;
    this.omniServer = null;
    this._omniServerPromise = null;
    await oldSrv.stop?.().catch?.(() => {});
  }

  async disposeAll() {
    this.markStopping();
    if (this._lazyThoughtService) {
      const th = this._lazyThoughtService;
      this._lazyThoughtService = null;
      try {
        if (typeof th.dispose === 'function') await th.dispose();
        else if (typeof th.close === 'function') await th.close();
        else if (typeof th.stop === 'function') await th.stop();
      } catch {}
    }
    await this.stopOmniServer();
    await this._sidebarServicePromise?.catch(() => null);
    if (this.sidebarService) {
      const sb = this.sidebarService;
      this.sidebarService = null;
      try {
        if (typeof sb.dispose === 'function') await sb.dispose();
      } catch {}
    }
    await this._wallpaperServicePromise?.catch(() => null);
    if (this._lazyWallpaperService) {
      const wp = this._lazyWallpaperService;
      this._lazyWallpaperService = null;
      try {
        if (typeof wp.dispose === 'function') await wp.dispose();
      } catch {}
    }
    await this._suggesterServicePromise?.catch(() => null);
    if (this._lazySuggesterService) {
      const sg = this._lazySuggesterService;
      this._lazySuggesterService = null;
      try {
        if (typeof sg.dispose === 'function') await sg.dispose();
      } catch {}
    }
  }
}
