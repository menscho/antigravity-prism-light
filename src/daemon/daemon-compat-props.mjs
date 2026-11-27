// Obsidian Prism 历史兼容属性访问器基类（纯薄转发至 4 大真组合子系统，零原型 Mixin）
export class PrismDaemonCompatBase {
  _s() {
    if (!this._subsystemsReady) this._initSubsystems({});
    return this;
  }

  _ensureSubsystems() {
    this._s();
  }

  // ---- 基础配置与路径属性 ----
  get rootDir() { return this._s()._rootDir; }
  set rootDir(v) {
    this._s();
    this._rootDir = v;
    this.channelOrchestrator.setRootDir(v);
    this.telemetrySubsystem.setRootDir(v);
    this.updateStorageSubsystem.setRootDir(v);
    this.relaunchGuard.setRootDir(v);
  }
  get gitRepoDir() { return this._s()._gitRepoDir; }
  set gitRepoDir(v) {
    this._s();
    this._gitRepoDir = v;
    this.channelOrchestrator._gitRepoDir = v;
    this.updateStorageSubsystem.gitRepoDir = v;
  }
  get cdp() { return this._s()._cdp; }
  set cdp(v) { this._s()._cdp = v; }
  get overridePort() { return this._s()._overridePort; }
  set overridePort(v) {
    this._s();
    this._overridePort = v;
    this.telemetrySubsystem._overridePort = v;
    this.updateStorageSubsystem._overridePort = v;
    this.relaunchGuard._overridePort = v;
  }
  get portFile() { return this._s()._portFile; }
  set portFile(v) {
    this._s();
    this._portFile = v;
    this.telemetrySubsystem._portFile = v;
    this.updateStorageSubsystem._portFile = v;
    this.relaunchGuard._portFile = v;
  }

  // ---- Logger / PidLock ----
  get silent() { return this._s().logger.silent; }
  set silent(v) { this._s().logger.silent = Boolean(v); }
  get logFile() { return this._s().logger.logFile; }
  set logFile(v) { this._s().logger.logFile = v; }
  get _logBytes() { return this._s().logger._logBytes; }
  set _logBytes(v) { this._s().logger._logBytes = v; }
  get pidFile() { return this._s().pidLock.pidFile; }
  set pidFile(v) { this._s().pidLock.pidFile = v; }
  get ownerToken() { return this._s().pidLock.ownerToken; }
  set ownerToken(v) { this._s().pidLock.ownerToken = v; }
  get _loadedCdpVerifier() { return this._s().pidLock._loadedCdpVerifier; }
  set _loadedCdpVerifier(v) { this._s().pidLock._loadedCdpVerifier = v; }
  get _daemonPidVerifier() { return this._s().pidLock._daemonPidVerifier; }
  set _daemonPidVerifier(v) { this._s().pidLock._daemonPidVerifier = v; }
  get _ownerFileCache() { return this._s().pidLock._ownerFileCache; }
  set _ownerFileCache(v) { this._s().pidLock._ownerFileCache = v; }

  // ---- SessionRegistry ----
  get sessions() { return this._s().sessionRegistry.sessions; }
  set sessions(v) { this._s().sessionRegistry.sessions = v; }
  get ignoredTargets() { return this._s().sessionRegistry.ignoredTargets; }
  set ignoredTargets(v) { this._s().sessionRegistry.ignoredTargets = v; }
  get browserSession() { return this._s().sessionRegistry.browserSession; }
  set browserSession(v) { this._s().sessionRegistry.browserSession = v; }
  get browserPort() { return this._s().sessionRegistry.browserPort; }
  set browserPort(v) { this._s().sessionRegistry.browserPort = v; }
  get _browserDiscoverySubscribed() { return this._s().sessionRegistry._browserDiscoverySubscribed; }
  set _browserDiscoverySubscribed(v) { this._s().sessionRegistry._browserDiscoverySubscribed = v; }
  get _lastListPagesAt() { return this._s().sessionRegistry._lastListPagesAt; }
  set _lastListPagesAt(v) { this._s().sessionRegistry._lastListPagesAt = v; }
  get _forceListPagesNextTick() { return this._s().sessionRegistry._forceListPagesNextTick; }
  set _forceListPagesNextTick(v) { this._s().sessionRegistry._forceListPagesNextTick = v; }
  get _listPagesFallbackIntervalMs() { return this._s().sessionRegistry._listPagesFallbackIntervalMs; }
  set _listPagesFallbackIntervalMs(v) { this._s().sessionRegistry._listPagesFallbackIntervalMs = v; }
  get _discoverTimer() { return this._s().sessionRegistry._discoverTimer; }
  set _discoverTimer(v) { this._s().sessionRegistry._discoverTimer = v; }
  get _discoverTimerTargetAt() { return this._s().sessionRegistry._discoverTimerTargetAt; }
  set _discoverTimerTargetAt(v) { this._s().sessionRegistry._discoverTimerTargetAt = v; }
  get _managedTimers() { return this._s().sessionRegistry._managedTimers; }
  set _managedTimers(v) { this._s().sessionRegistry._managedTimers = v; }
  get hostFsmState() { return this._s().sessionRegistry.hostFsmState; }
  set hostFsmState(v) { this._s().sessionRegistry.hostFsmState = v; }
  get _reentrantTickStreak() { return this._s().sessionRegistry._reentrantTickStreak; }
  set _reentrantTickStreak(v) { this._s().sessionRegistry._reentrantTickStreak = v; }
  get _lastTickFinishedAt() { return this._s().sessionRegistry._lastTickFinishedAt; }
  set _lastTickFinishedAt(v) { this._s().sessionRegistry._lastTickFinishedAt = v; }
  get _prevAttachedCount() { return this._s().sessionRegistry._prevAttachedCount; }
  set _prevAttachedCount(v) { this._s().sessionRegistry._prevAttachedCount = v; }
  get _disconnectedAllSessions() { return this._s().sessionRegistry._disconnectedAllSessions; }
  set _disconnectedAllSessions(v) { this._s().sessionRegistry._disconnectedAllSessions = v; }

  // ---- ChannelOrchestrator & Services & Swarm ----
  get injectExpr() { return this._s().channelOrchestrator.injectExpr; }
  set injectExpr(v) { this._s().channelOrchestrator.injectExpr = v; }
  get codeHash() { return this._s().channelOrchestrator.codeHash; }
  set codeHash(v) { this._s().channelOrchestrator.codeHash = v; }
  get _cdpFileSig() { return this._s().channelOrchestrator._cdpFileSig; }
  set _cdpFileSig(v) { this._s().channelOrchestrator._cdpFileSig = v; }
  get _bundleCachePathOpt() { return this._s().channelOrchestrator._bundleCachePathOpt; }
  set _bundleCachePathOpt(v) { this._s().channelOrchestrator._bundleCachePathOpt = v; }
  get _bundleCacheFlushTimer() { return this._s().channelOrchestrator._bundleCacheFlushTimer; }
  set _bundleCacheFlushTimer(v) { this._s().channelOrchestrator._bundleCacheFlushTimer = v; }
  get _configFingerprintTracker() { return this._s().channelOrchestrator._configFingerprintTracker; }
  set _configFingerprintTracker(v) { this._s().channelOrchestrator._configFingerprintTracker = v; }
  get _configSeq() { return this._s().channelOrchestrator._configSeq; }
  set _configSeq(v) { this._s().channelOrchestrator._configSeq = v; }
  get _broadcastRunning() { return this._s().channelOrchestrator._broadcastRunning; }
  set _broadcastRunning(v) { this._s().channelOrchestrator._broadcastRunning = v; }
  get _broadcastPending() { return this._s().channelOrchestrator._broadcastPending; }
  set _broadcastPending(v) { this._s().channelOrchestrator._broadcastPending = v; }
  get _broadcastWaiters() { return this._s().channelOrchestrator._broadcastWaiters; }
  set _broadcastWaiters(v) { this._s().channelOrchestrator._broadcastWaiters = v; }
  get _configConvergenceDirty() { return this._s().channelOrchestrator._configConvergenceDirty; }
  set _configConvergenceDirty(v) { this._s().channelOrchestrator._configConvergenceDirty = v; }
  get _safeSidebarFileCache() { return this._s().channelOrchestrator._safeSidebarFileCache; }
  set _safeSidebarFileCache(v) { this._s().channelOrchestrator._safeSidebarFileCache = v; }
  get _clientFileExistsCache() { return this._s().channelOrchestrator._clientFileExistsCache; }
  set _clientFileExistsCache(v) { this._s().channelOrchestrator._clientFileExistsCache = v; }

  get swarmSessions() { return this._s().channelOrchestrator.swarmManager.swarmSessions; }
  set swarmSessions(v) { this._s().channelOrchestrator.swarmManager.swarmSessions = v; }
  get _swarmAttaching() { return this._s().channelOrchestrator.swarmManager._swarmAttaching; }
  set _swarmAttaching(v) { this._s().channelOrchestrator.swarmManager._swarmAttaching = v; }
  get omniServer() { return this._s().channelOrchestrator.services.omniServer; }
  set omniServer(v) { this._s().channelOrchestrator.services.omniServer = v; }
  get _omniServerPromise() { return this._s().channelOrchestrator.services._omniServerPromise; }
  set _omniServerPromise(v) { this._s().channelOrchestrator.services._omniServerPromise = v; }
  get sidebarService() { return this._s().channelOrchestrator.services.sidebarService; }
  set sidebarService(v) { this._s().channelOrchestrator.services.sidebarService = v; }
  get _sidebarServicePromise() { return this._s().channelOrchestrator.services._sidebarServicePromise; }
  set _sidebarServicePromise(v) { this._s().channelOrchestrator.services._sidebarServicePromise = v; }
  get _sidebarStopped() { return this._s().channelOrchestrator.services._sidebarStopped; }
  set _sidebarStopped(v) { this._s().channelOrchestrator.services._sidebarStopped = v; }
  get _lazyThoughtService() { return this._s().channelOrchestrator.services._lazyThoughtService; }
  set _lazyThoughtService(v) { this._s().channelOrchestrator.services._lazyThoughtService = v; }
  get _lazyWallpaperService() { return this._s().channelOrchestrator.services._lazyWallpaperService; }
  set _lazyWallpaperService(v) { this._s().channelOrchestrator.services._lazyWallpaperService = v; }
  get _wallpaperServicePromise() { return this._s().channelOrchestrator.services._wallpaperServicePromise; }
  set _wallpaperServicePromise(v) { this._s().channelOrchestrator.services._wallpaperServicePromise = v; }
  get _wallpaperStopped() { return this._s().channelOrchestrator.services._wallpaperStopped; }
  set _wallpaperStopped(v) { this._s().channelOrchestrator.services._wallpaperStopped = v; }
  get _lazySuggesterService() { return this._s().channelOrchestrator.services._lazySuggesterService; }
  set _lazySuggesterService(v) { this._s().channelOrchestrator.services._lazySuggesterService = v; }
  get _suggesterServicePromise() { return this._s().channelOrchestrator.services._suggesterServicePromise; }
  set _suggesterServicePromise(v) { this._s().channelOrchestrator.services._suggesterServicePromise = v; }
  get _suggesterStopped() { return this._s().channelOrchestrator.services._suggesterStopped; }
  set _suggesterStopped(v) { this._s().channelOrchestrator.services._suggesterStopped = v; }

  // ---- 16 通道表达式与哈希槽位 ----
  get omniExpr() { return this._s().channelOrchestrator.getChannelExpr('omni'); }
  set omniExpr(v) { this._s().channelOrchestrator.setChannelExpr('omni', v); }
  get sidebarExpr() { return this._s().channelOrchestrator.getChannelExpr('sidebar'); }
  set sidebarExpr(v) { this._s().channelOrchestrator.setChannelExpr('sidebar', v); }
  get hostI18nExpr() { return this._s().channelOrchestrator.getChannelExpr('hostI18n'); }
  set hostI18nExpr(v) { this._s().channelOrchestrator.setChannelExpr('hostI18n', v); }
  get swarmI18nExpr() { return this._s().channelOrchestrator.getChannelExpr('swarmI18n'); }
  set swarmI18nExpr(v) { this._s().channelOrchestrator.setChannelExpr('swarmI18n', v); }
  get swarmI18nCodeHash() { return this._s().channelOrchestrator.getChannelHash('swarmI18n'); }
  set swarmI18nCodeHash(v) { this._s().channelOrchestrator.setChannelHash('swarmI18n', v); }
  get thoughtExpr() { return this._s().channelOrchestrator.getChannelExpr('thought'); }
  set thoughtExpr(v) { this._s().channelOrchestrator.setChannelExpr('thought', v); }
  get thoughtCodeHash() { return this._s().channelOrchestrator.getChannelHash('thought'); }
  set thoughtCodeHash(v) { this._s().channelOrchestrator.setChannelHash('thought', v); }
  get _thoughtHashSource() { return this._s().channelOrchestrator.getChannelHashSource('thought'); }
  set _thoughtHashSource(v) { this._s().channelOrchestrator.setChannelHashSource('thought', v); }
  get inlineDiffExpr() { return this._s().channelOrchestrator.getChannelExpr('inlineDiff'); }
  set inlineDiffExpr(v) { this._s().channelOrchestrator.setChannelExpr('inlineDiff', v); }
  get inlineDiffCodeHash() { return this._s().channelOrchestrator.getChannelHash('inlineDiff'); }
  set inlineDiffCodeHash(v) { this._s().channelOrchestrator.setChannelHash('inlineDiff', v); }
  get _inlineDiffHashSource() { return this._s().channelOrchestrator.getChannelHashSource('inlineDiff'); }
  set _inlineDiffHashSource(v) { this._s().channelOrchestrator.setChannelHashSource('inlineDiff', v); }
  get wallpaperExpr() { return this._s().channelOrchestrator.getChannelExpr('wallpaper'); }
  set wallpaperExpr(v) { this._s().channelOrchestrator.setChannelExpr('wallpaper', v); }
  get wallpaperCodeHash() { return this._s().channelOrchestrator.getChannelHash('wallpaper'); }
  set wallpaperCodeHash(v) { this._s().channelOrchestrator.setChannelHash('wallpaper', v); }
  get _wallpaperHashSource() { return this._s().channelOrchestrator.getChannelHashSource('wallpaper'); }
  set _wallpaperHashSource(v) { this._s().channelOrchestrator.setChannelHashSource('wallpaper', v); }
  get suggesterExpr() { return this._s().channelOrchestrator.getChannelExpr('suggester'); }
  set suggesterExpr(v) { this._s().channelOrchestrator.setChannelExpr('suggester', v); }
  get suggesterCodeHash() { return this._s().channelOrchestrator.getChannelHash('suggester'); }
  set suggesterCodeHash(v) { this._s().channelOrchestrator.setChannelHash('suggester', v); }
  get _suggesterHashSource() { return this._s().channelOrchestrator.getChannelHashSource('suggester'); }
  set _suggesterHashSource(v) { this._s().channelOrchestrator.setChannelHashSource('suggester', v); }
  get periodicPickerExpr() { return this._s().channelOrchestrator.getChannelExpr('periodicPicker'); }
  set periodicPickerExpr(v) { this._s().channelOrchestrator.setChannelExpr('periodicPicker', v); }
  get periodicPickerCodeHash() { return this._s().channelOrchestrator.getChannelHash('periodicPicker'); }
  set periodicPickerCodeHash(v) { this._s().channelOrchestrator.setChannelHash('periodicPicker', v); }
  get _periodicPickerHashSource() { return this._s().channelOrchestrator.getChannelHashSource('periodicPicker'); }
  set _periodicPickerHashSource(v) { this._s().channelOrchestrator.setChannelHashSource('periodicPicker', v); }
  get settingsExpr() { return this._s().channelOrchestrator.getChannelExpr('settings'); }
  set settingsExpr(v) { this._s().channelOrchestrator.setChannelExpr('settings', v); }
  get settingsCodeHash() { return this._s().channelOrchestrator.getChannelHash('settings'); }
  set settingsCodeHash(v) { this._s().channelOrchestrator.setChannelHash('settings', v); }
  get _settingsHashSource() { return this._s().channelOrchestrator.getChannelHashSource('settings'); }
  set _settingsHashSource(v) { this._s().channelOrchestrator.setChannelHashSource('settings', v); }
  get mascotExpr() { return this._s().channelOrchestrator.getChannelExpr('mascot'); }
  set mascotExpr(v) { this._s().channelOrchestrator.setChannelExpr('mascot', v); }
  get mascotCodeHash() { return this._s().channelOrchestrator.getChannelHash('mascot'); }
  set mascotCodeHash(v) { this._s().channelOrchestrator.setChannelHash('mascot', v); }
  get _mascotHashSource() { return this._s().channelOrchestrator.getChannelHashSource('mascot'); }
  set _mascotHashSource(v) { this._s().channelOrchestrator.setChannelHashSource('mascot', v); }
  get homeStudioExpr() { return this._s().channelOrchestrator.getChannelExpr('homeStudio'); }
  set homeStudioExpr(v) { this._s().channelOrchestrator.setChannelExpr('homeStudio', v); }
  get homeStudioCodeHash() { return this._s().channelOrchestrator.getChannelHash('homeStudio'); }
  set homeStudioCodeHash(v) { this._s().channelOrchestrator.setChannelHash('homeStudio', v); }
  get _homeStudioHashSource() { return this._s().channelOrchestrator.getChannelHashSource('homeStudio'); }
  set _homeStudioHashSource(v) { this._s().channelOrchestrator.setChannelHashSource('homeStudio', v); }
  get telemetryExpr() { return this._s().channelOrchestrator.getChannelExpr('telemetry'); }
  set telemetryExpr(v) { this._s().channelOrchestrator.setChannelExpr('telemetry', v); }
  get telemetryCodeHash() { return this._s().channelOrchestrator.getChannelHash('telemetry'); }
  set telemetryCodeHash(v) { this._s().channelOrchestrator.setChannelHash('telemetry', v); }
  get _telemetryHashSource() { return this._s().channelOrchestrator.getChannelHashSource('telemetry'); }
  set _telemetryHashSource(v) { this._s().channelOrchestrator.setChannelHashSource('telemetry', v); }
  get effortSliderExpr() { return this._s().channelOrchestrator.getChannelExpr('effortSlider'); }
  set effortSliderExpr(v) { this._s().channelOrchestrator.setChannelExpr('effortSlider', v); }
  get effortSliderCodeHash() { return this._s().channelOrchestrator.getChannelHash('effortSlider'); }
  set effortSliderCodeHash(v) { this._s().channelOrchestrator.setChannelHash('effortSlider', v); }
  get _effortSliderHashSource() { return this._s().channelOrchestrator.getChannelHashSource('effortSlider'); }
  set _effortSliderHashSource(v) { this._s().channelOrchestrator.setChannelHashSource('effortSlider', v); }
  get workbenchEnhancerExpr() { return this._s().channelOrchestrator.getChannelExpr('workbenchEnhancer'); }
  set workbenchEnhancerExpr(v) { this._s().channelOrchestrator.setChannelExpr('workbenchEnhancer', v); }
  get workbenchEnhancerCodeHash() { return this._s().channelOrchestrator.getChannelHash('workbenchEnhancer'); }
  set workbenchEnhancerCodeHash(v) { this._s().channelOrchestrator.setChannelHash('workbenchEnhancer', v); }
  get _workbenchEnhancerHashSource() { return this._s().channelOrchestrator.getChannelHashSource('workbenchEnhancer'); }
  set _workbenchEnhancerHashSource(v) { this._s().channelOrchestrator.setChannelHashSource('workbenchEnhancer', v); }
  get contextMenuExpr() { return this._s().channelOrchestrator.getChannelExpr('contextMenu'); }
  set contextMenuExpr(v) { this._s().channelOrchestrator.setChannelExpr('contextMenu', v); }
  get contextMenuCodeHash() { return this._s().channelOrchestrator.getChannelHash('contextMenu'); }
  set contextMenuCodeHash(v) { this._s().channelOrchestrator.setChannelHash('contextMenu', v); }
  get _contextMenuHashSource() { return this._s().channelOrchestrator.getChannelHashSource('contextMenu'); }
  set _contextMenuHashSource(v) { this._s().channelOrchestrator.setChannelHashSource('contextMenu', v); }

  // ---- TelemetrySubsystem ----
  get _lazyStore() { return this._s().telemetrySubsystem._lazyStore; }
  set _lazyStore(v) { this._s().telemetrySubsystem._lazyStore = v; }
  get _lazyUsage() { return this._s().telemetrySubsystem._lazyUsage; }
  set _lazyUsage(v) { this._s().telemetrySubsystem._lazyUsage = v; }
  get _lazyLsClient() { return this._s().telemetrySubsystem._lazyLsClient; }
  set _lazyLsClient(v) { this._s().telemetrySubsystem._lazyLsClient = v; }
  get _backendSummariesCache() { return this._s().telemetrySubsystem._backendSummariesCache; }
  set _backendSummariesCache(v) { this._s().telemetrySubsystem._backendSummariesCache = v; }
  get _backendSummariesAt() { return this._s().telemetrySubsystem._backendSummariesAt; }
  set _backendSummariesAt(v) { this._s().telemetrySubsystem._backendSummariesAt = v; }
  get _usageCachePathOpt() { return this._s().telemetrySubsystem._usageCachePathOpt; }
  set _usageCachePathOpt(v) { this._s().telemetrySubsystem._usageCachePathOpt = v; }
  get _usageCacheFile() { return this._s().telemetrySubsystem._usageCacheFile; }
  set _usageCacheFile(v) { this._s().telemetrySubsystem._usageCacheFile = v; }
  get _usageDiskCache() { return this._s().telemetrySubsystem._usageDiskCache; }
  set _usageDiskCache(v) { this._s().telemetrySubsystem._usageDiskCache = v; }
  get _usageCacheDirty() { return this._s().telemetrySubsystem._usageCacheDirty; }
  set _usageCacheDirty(v) { this._s().telemetrySubsystem._usageCacheDirty = v; }
  get _usageCacheTimer() { return this._s().telemetrySubsystem._usageCacheTimer; }
  set _usageCacheTimer(v) { this._s().telemetrySubsystem._usageCacheTimer = v; }
  get _usageCacheFlushPromise() { return this._s().telemetrySubsystem._usageCacheFlushPromise; }
  set _usageCacheFlushPromise(v) { this._s().telemetrySubsystem._usageCacheFlushPromise = v; }
  get _usageCacheFlushEpoch() { return this._s().telemetrySubsystem._usageCacheFlushEpoch; }
  set _usageCacheFlushEpoch(v) { this._s().telemetrySubsystem._usageCacheFlushEpoch = v; }
  get _usageCacheFlushGen() { return this._s().telemetrySubsystem._usageCacheFlushGen; }
  set _usageCacheFlushGen(v) { this._s().telemetrySubsystem._usageCacheFlushGen = v; }
  get _scopedTrajCache() { return this._s().telemetrySubsystem._scopedTrajCache; }
  set _scopedTrajCache(v) { this._s().telemetrySubsystem._scopedTrajCache = v; }
  get _scopedTrajInFlight() { return this._s().telemetrySubsystem._scopedTrajInFlight; }
  set _scopedTrajInFlight(v) { this._s().telemetrySubsystem._scopedTrajInFlight = v; }
  get _lastTelemetryActivityAt() { return this._s().telemetrySubsystem._lastTelemetryActivityAt; }
  set _lastTelemetryActivityAt(v) { this._s().telemetrySubsystem._lastTelemetryActivityAt = v; }
  get _telemetryInFlight() { return this._s().telemetrySubsystem._telemetryInFlight; }
  set _telemetryInFlight(v) { this._s().telemetrySubsystem._telemetryInFlight = v; }
  get _customMetricsProvider() { return this._s().telemetrySubsystem._customMetricsProvider; }
  set _customMetricsProvider(v) { this._s().telemetrySubsystem._customMetricsProvider = v; }
  get _discoveredSubagentsByScope() { return this._s().telemetrySubsystem._discoveredSubagentsByScope; }
  set _discoveredSubagentsByScope(v) { this._s().telemetrySubsystem._discoveredSubagentsByScope = v; }
  get _quotaForceRefreshGuard() { return this._s().telemetrySubsystem._quotaForceRefreshGuard; }
  set _quotaForceRefreshGuard(v) { this._s().telemetrySubsystem._quotaForceRefreshGuard = v; }

  // ---- UpdateStorageSubsystem ----
  get updateService() { return this._s().updateStorageSubsystem.updateService; }
  set updateService(v) { this._s().updateStorageSubsystem.updateService = v; }
  get addonRegistry() { return this._s().updateStorageSubsystem.addonRegistry; }
  set addonRegistry(v) { this._s().updateStorageSubsystem.addonRegistry = v; }
  get _lastUpdateState() { return this._s().updateStorageSubsystem._lastUpdateState; }
  set _lastUpdateState(v) { this._s().updateStorageSubsystem._lastUpdateState = v; }
  get _updateCheckInFlight() { return this._s().updateStorageSubsystem._updateCheckInFlight; }
  set _updateCheckInFlight(v) { this._s().updateStorageSubsystem._updateCheckInFlight = v; }
  get _updateCheckInFlightChannel() { return this._s().updateStorageSubsystem._updateCheckInFlightChannel; }
  set _updateCheckInFlightChannel(v) { this._s().updateStorageSubsystem._updateCheckInFlightChannel = v; }
  get _storageHealthCache() { return this._s().updateStorageSubsystem._storageHealthCache; }
  set _storageHealthCache(v) { this._s().updateStorageSubsystem._storageHealthCache = v; }
  get _storageHealthAt() { return this._s().updateStorageSubsystem._storageHealthAt; }
  set _storageHealthAt(v) { this._s().updateStorageSubsystem._storageHealthAt = v; }
  get _storageGuardStateFile() { return this._s().updateStorageSubsystem._storageGuardStateFile; }
  set _storageGuardStateFile(v) { this._s().updateStorageSubsystem._storageGuardStateFile = v; }
  get _storageGuardBannerShownAt() { return this._s().updateStorageSubsystem._storageGuardBannerShownAt; }
  set _storageGuardBannerShownAt(v) { this._s().updateStorageSubsystem._storageGuardBannerShownAt = v; }
  get _lastStorageIndexRefreshAt() { return this._s().updateStorageSubsystem._lastStorageIndexRefreshAt; }
  set _lastStorageIndexRefreshAt(v) { this._s().updateStorageSubsystem._lastStorageIndexRefreshAt = v; }
  get _lastVisibleMainIds() { return this._s().updateStorageSubsystem._lastVisibleMainIds; }
  set _lastVisibleMainIds(v) { this._s().updateStorageSubsystem._lastVisibleMainIds = v; }
  get _sawLiveHost() { return this._s().updateStorageSubsystem._sawLiveHost; }
  set _sawLiveHost(v) { this._s().updateStorageSubsystem._sawLiveHost = v; }
  get _autoArchiveExitRan() { return this._s().updateStorageSubsystem._autoArchiveExitRan; }
  set _autoArchiveExitRan(v) { this._s().updateStorageSubsystem._autoArchiveExitRan = v; }
  get _autoArchiveInFlight() { return this._s().updateStorageSubsystem._autoArchiveInFlight; }
  set _autoArchiveInFlight(v) { this._s().updateStorageSubsystem._autoArchiveInFlight = v; }
  get _archiveActionInFlight() { return this._s().updateStorageSubsystem._archiveActionInFlight; }
  set _archiveActionInFlight(v) { this._s().updateStorageSubsystem._archiveActionInFlight = v; }
  get _archiveScheduledAt() { return this._s().updateStorageSubsystem._archiveScheduledAt; }
  set _archiveScheduledAt(v) { this._s().updateStorageSubsystem._archiveScheduledAt = v; }
  get _isUninstalling() { return this._s().updateStorageSubsystem._isUninstalling; }
  set _isUninstalling(v) { this._s().updateStorageSubsystem._isUninstalling = v; }

  // ---- RelaunchGuard & DaemonLoop ----
  get _relaunchHooks() { return this._s().relaunchGuard._relaunchHooks; }
  set _relaunchHooks(v) { this._s().relaunchGuard._relaunchHooks = v; }
  get noPortRelaunchThresholdMs() { return this._s().relaunchGuard.noPortRelaunchThresholdMs; }
  set noPortRelaunchThresholdMs(v) { this._s().relaunchGuard.noPortRelaunchThresholdMs = v; }
  get shortcutCheckIntervalMs() { return this._s().relaunchGuard.shortcutCheckIntervalMs; }
  set shortcutCheckIntervalMs(v) { this._s().relaunchGuard.shortcutCheckIntervalMs = v; }
  get _shortcutBackoffIntervalMs() { return this._s().relaunchGuard._shortcutBackoffIntervalMs; }
  set _shortcutBackoffIntervalMs(v) { this._s().relaunchGuard._shortcutBackoffIntervalMs = v; }
  get _shortcutAllClean() { return this._s().relaunchGuard._shortcutAllClean; }
  set _shortcutAllClean(v) { this._s().relaunchGuard._shortcutAllClean = v; }
  get _hasActiveCdpPort() { return this._s().relaunchGuard._hasActiveCdpPort; }
  set _hasActiveCdpPort(v) { this._s().relaunchGuard._hasActiveCdpPort = v; }
  get _noPortSinceMs() { return this._s().relaunchGuard._noPortSinceMs; }
  set _noPortSinceMs(v) { this._s().relaunchGuard._noPortSinceMs = v; }
  get _promptInFlight() { return this._s().relaunchGuard._promptInFlight; }
  set _promptInFlight(v) { this._s().relaunchGuard._promptInFlight = v; }
  get _lastShortcutCheckAt() { return this._s().relaunchGuard._lastShortcutCheckAt; }
  set _lastShortcutCheckAt(v) { this._s().relaunchGuard._lastShortcutCheckAt = v; }
  get _lastObservedHostPid() { return this._s().relaunchGuard._lastObservedHostPid; }
  set _lastObservedHostPid(v) { this._s().relaunchGuard._lastObservedHostPid = v; }
  get _lastActiveCdpPort() { return this._s().relaunchGuard._lastActiveCdpPort; }
  set _lastActiveCdpPort(v) { this._s().relaunchGuard._lastActiveCdpPort = v; }

  get running() { return this._s().daemonLoop.running; }
  set running(v) { this._s().daemonLoop.running = v; }
  get busy() { return this._s().daemonLoop.busy; }
  set busy(v) { this._s().daemonLoop.busy = v; }
  get timer() { return this._s().daemonLoop.timer; }
  set timer(v) { this._s().daemonLoop.timer = v; }
  get fsw() { return this._s().daemonLoop.fsw; }
  set fsw(v) { this._s().daemonLoop.fsw = v; }
  get _reloadTimer() { return this._s().daemonLoop._reloadTimer; }
  set _reloadTimer(v) { this._s().daemonLoop._reloadTimer = v; }
  get _pendingTick() { return this._s().daemonLoop._pendingTick; }
  set _pendingTick(v) { this._s().daemonLoop._pendingTick = v; }
  get pollIntervalMs() { return this._s().daemonLoop.pollIntervalMs; }
  set pollIntervalMs(v) { this._s().daemonLoop.pollIntervalMs = v; }
  get enabledCheck() { return this._s().daemonLoop.enabledCheck; }
  set enabledCheck(v) { this._s().daemonLoop.enabledCheck = v; }
}
