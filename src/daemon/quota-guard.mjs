// RetrieveUserQuotaSummary({ forceRefresh: true }) 不可绕过全局冷却守卫（防宿主风控）
// 无论前端面板或外部 RPC 如何频发 forceRefresh: true，严格强制 >= 60s 全局冷却窗口：
// 冷却期内优先直接复用最近缓存结果；若无可用缓存，则降级为非强制刷新 {}。

export const MIN_QUOTA_FORCE_REFRESH_COOLDOWN_MS = 60_000;

export class QuotaForceRefreshGuard {
  constructor({ cooldownMs = MIN_QUOTA_FORCE_REFRESH_COOLDOWN_MS, now = Date.now } = {}) {
    const parsed = Number(cooldownMs);
    this.cooldownMs =
      Number.isFinite(parsed) && parsed >= MIN_QUOTA_FORCE_REFRESH_COOLDOWN_MS
        ? parsed
        : MIN_QUOTA_FORCE_REFRESH_COOLDOWN_MS;
    this.now = typeof now === 'function' ? now : Date.now;
    this._lastForceRefreshAt = -Infinity;
    this._cachedResult = null;
    this._cachedAt = -Infinity;
  }

  /**
   * 评估一次 RetrieveUserQuotaSummary 请求：
   * - 非 forceRefresh 请求直接放行（并在成功后记录最新缓存）；
   * - forceRefresh: true 请求检查全局 60s 冷却：
   *   - 冷却外：放行 forceRefresh: true，并锁定新一轮 60s 冷却计时；
   *   - 冷却内且存在有效缓存：直接短路返回 cached（0 宿主 RPC）；
   *   - 冷却内且无有效缓存：降级为 { forceRefresh: false }（剥离 forceRefresh）。
   */
  prepare(body = {}) {
    const wantsForce = Boolean(body && typeof body === 'object' && body.forceRefresh === true);
    if (!wantsForce) {
      return {
        action: 'forward',
        body: body && typeof body === 'object' ? { ...body, forceRefresh: false } : {},
        downgraded: false,
      };
    }

    const nowMs = this.now();
    const elapsedSinceForce = nowMs - this._lastForceRefreshAt;
    if (elapsedSinceForce < this.cooldownMs) {
      const hasFreshCache =
        this._cachedResult !== null && nowMs - this._cachedAt < this.cooldownMs;
      if (hasFreshCache) {
        return {
          action: 'cached',
          result: this._cachedResult,
          remainingMs: Math.max(0, this.cooldownMs - elapsedSinceForce),
          downgraded: true,
        };
      }
      const nextBody = { ...(body && typeof body === 'object' ? body : {}) };
      delete nextBody.forceRefresh;
      return {
        action: 'forward',
        body: nextBody,
        remainingMs: Math.max(0, this.cooldownMs - elapsedSinceForce),
        downgraded: true,
      };
    }

    this._lastForceRefreshAt = nowMs;
    return {
      action: 'forward',
      body: { ...(body && typeof body === 'object' ? body : {}), forceRefresh: true },
      downgraded: false,
    };
  }

  recordSuccess(result) {
    if (result && typeof result === 'object') {
      this._cachedResult = result;
      this._cachedAt = this.now();
    }
  }

  getState() {
    const nowMs = this.now();
    const remainingMs = Math.max(0, this.cooldownMs - (nowMs - this._lastForceRefreshAt));
    return {
      cooldownMs: this.cooldownMs,
      lastForceRefreshAt: Number.isFinite(this._lastForceRefreshAt) ? this._lastForceRefreshAt : 0,
      hasCache: this._cachedResult !== null,
      remainingMs,
    };
  }
}
