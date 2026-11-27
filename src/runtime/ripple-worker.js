// Obsidian Prism — OffscreenCanvas WebGL2 Worker (glow & field) + 1x1 Probe + Perf Profiles
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.__agPrismRippleWorker = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function (G) {
  'use strict';
  const M = Math, F = Object.freeze, PROBE_TIMEOUT_MS = 1500, INIT_TIMEOUT_MS = 800, PROBE_RETRY_DELAY_MS = 2500, IDLE_SLEEP_MS = 1200;
  const mkP = (mode, g, r, c, v, f, ms, m) => F({ mode, glowDprScale: g, rippleMaxDpr: r, crystalMaxDpr: c, vialMaxDpr: v, maxFps: f, minGapMs: ms, msaa: m });
  const PERF_PROFILES = F({
    balanced: mkP('balanced', 0.7, 1.5, 1.5, 1.5, 0, 0, false),
    performance: mkP('performance', 0.55, 1.0, 1.0, 1.0, 60, 16.67, false),
    quality: mkP('quality', 1.0, 2.0, 1.5, 2.0, 0, 0, true),
  });
  const active = new Set(), retryCbs = new Set();
  let pW = null, pUrl = '', pCache = null, pPend = null, fallbacks = 0, pRetries = 0, pRetryAt = 0, pTimer = 0, mgDepth = 0, lastNested = null;

  const isF = (v) => typeof v === 'function';
  const cl = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? M.max(lo, M.min(hi, n)) : lo; };
  const getDoc = (d) => d || (typeof document !== 'undefined' ? document : null);
  const ga = (h, k) => h?.getAttribute?.(k);
  const rawPerf = (d) => { const h = getDoc(d)?.documentElement; return String(h?.dataset?.agCsPerfMode || ga(h, 'data-ag-cs-perf-mode') || '').trim().toLowerCase(); };
  const getPerfMode = (d) => PERF_PROFILES[rawPerf(d)]?.mode || 'balanced';
  const getPerfProfile = (doc) => PERF_PROFILES[getPerfMode(doc)] || PERF_PROFILES.balanced;
  const getPerfMinGapMs = (doc) => getPerfProfile(doc).minGapMs;
  const resolveRippleDpr = (raw, doc) => M.min(Number(raw) > 0 ? Number(raw) : 1, getPerfProfile(doc).rippleMaxDpr);
  function resolveGlowDpr(rawDpr, doc, baseScale) {
    const raw = Number(rawDpr) > 0 ? Number(rawDpr) : 1, p = getPerfProfile(doc), sc = Number(baseScale);
    if (p.mode === 'performance') return M.max(0.5, M.min(0.95, +(raw * 0.55).toFixed(3)));
    if (p.mode === 'quality') return M.max(0.75, M.min(2, +(raw * (sc > 0 ? M.min(1, sc) : 1)).toFixed(3)));
    const s = sc > 0 ? M.min(p.glowDprScale, sc) : p.glowDprScale;
    return raw <= 1 ? M.max(0.5, +(raw * s).toFixed(3)) : M.max(0.7, M.min(1.25, +(raw * M.min(0.63, s * 0.9)).toFixed(3)));
  }
  function isHostPaused(doc) {
    const d = getDoc(doc), h = d?.documentElement;
    return Boolean(d && (d.hidden === true || ga(h, 'data-ag-cs-win-blur') === '1' || (ga(h, 'data-ag-pp-open') === '1' && /^(performance|eco)$/.test(rawPerf(d)))));
  }

  const PROBE_WORKER_SRC = "'use strict';var p=m=>self.postMessage(m);p({type:'probe-ready'});self.onmessage=e=>{var d=e?.data;if(d?.type!=='probe'||!d.canvas)return p({type:'probe',ok:false,reason:'bad-probe-msg'});p({type:'probe-ack'});try{var g=d.canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:false}),ok=Boolean(g&&!g.isContextLost?.());g&&g.getExtension('WEBGL_lose_context')?.loseContext();p({type:'probe',ok,reason:ok?'ok':'webgl2-null'})}catch(x){p({type:'probe',ok:false,reason:String(x?.message||x||'probe-err')})}};";

  const RENDER_WORKER_SRC = [
    "'use strict';var mode='glow',cv,gl,P,u={},raf=0,pa=0,dd=0,rd=0,dpr=1,fS=0,lC=0,lD=0,lA=0,iMs=1200,mF=0,fc=0,fr=0,fw=7,fh=15,fz=10,fg='',cT,aT,aC,aX,aK='';",
    "var cur={dark:1,intensity:.6,presence:1,reach:.47,prism:0,surge:0,speed:1,spec:0,sem:0,still:1,anim:0,continuous:0,timeSec:12,hu:null};",
    "var nw=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now(),sR=()=>{if(raf&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(raf);raf=0},pm=o=>{try{self.postMessage(o)}catch{}};",
    "var frG=()=>{if(gl)try{P&&gl.deleteProgram(P);cT&&gl.deleteTexture(cT);aT&&gl.deleteTexture(aT)}catch{}P=cT=aT=null;u={};aK=''};",
    "var mT=(i,f)=>{var t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,f);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,f);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t};",
    "var aC2=()=>{cT&&gl.deleteTexture(cT);cT=mT(0,gl.NEAREST);if(fc>0&&fr>0)gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,fc,fr)};",
    "var bld=(vs,fs,ns)=>{frG();var cp=(t,s)=>{var h=gl.createShader(t);gl.shaderSource(h,s);gl.compileShader(h);if(!gl.getShaderParameter(h,gl.COMPILE_STATUS)){var l=gl.getShaderInfoLog(h)||'sh';gl.deleteShader(h);throw new Error(l)}return h},v=cp(gl.VERTEX_SHADER,vs),f=cp(gl.FRAGMENT_SHADER,fs);P=gl.createProgram();gl.attachShader(P,v);gl.attachShader(P,f);gl.linkProgram(P);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(P,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(P)||'link');gl.useProgram(P);for(var n of ns.split(','))u[n]=gl.getUniformLocation(P,n)};",
    "var u1=(l,v)=>l&&gl.uniform1f(l,v),u3=(l,v)=>l&&v&&gl.uniform3f(l,v[0],v[1],v[2]),u4=(l,v)=>l&&v&&gl.uniform4f(l,v[0],v[1],v[2],v[3]),ps=s=>s.split(',').map(x=>x.split(':'));",
    "var G3=ps('uBaseA:baseA,uBaseB:baseB,uPrismA:prismA,uPrismB:prismB,uLightA:lightA,uLightB:lightB,uSurgeLead:surgeLead,uChimeLead:chimeLead,uHotAnchor:hotAnchor,uSemA:semA,uSemB:semB'),G1=ps('uDark:dark,uReach:reach,uIntensity:intensity,uPresence:presence,uPrism:prism,uSurge:surge,uSpeed:speed,uSpectrum:spec,uSemantic:sem'),F3=ps('ink:ink,wave:wave,uSpec0:sp0,uSpec1:sp1,uSpec2:sp2,uSpec3:sp3'),F4=ps('aura:aura,optics:optics,uIdleParams:idle,neb0:n0,neb1:n1,neb2:n2,nebOpt:nOpt');",
    "var bAtl=(fn,d)=>{var k=fn+'|'+d;if(k===aK)return;if(!aC){aC=new OffscreenCanvas(1,1);aX=aC.getContext('2d');if(!aX)throw new Error('no-2d')}var w=Math.ceil(fw*d),h=Math.ceil(fh*d);aC.width=w*fg.length;aC.height=h;aX.setTransform(w/fw,0,0,h/fh,0,0);aX.clearRect(0,0,fw*fg.length,fh);aX.font=fz+'px '+fn;aX.textBaseline='middle';aX.textAlign='center';aX.fillStyle='#fff';for(var i=0;i<fg.length;i++)aX.fillText(fg[i],i*fw+fw/2,fh/2);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,aT);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,aC);gl.uniform2f(u.atlasCell,w,h);u1(u.glyphCount,fg.length);aK=k};",
    "var dr=()=>{gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3)},okG=()=>gl&&P&&cv&&cv.width>0&&cv.height>0&&!gl.isContextLost?.();",
    "var pG=t=>{if(!okG())return;gl.viewport(0,0,cv.width,cv.height);gl.useProgram(P);gl.uniform2f(u.uRes,cv.width,cv.height);u1(u.uDpr,dpr);u1(u.uTime,t);for(var p of G1)u1(u[p[0]],cur[p[1]]);var h=cur.hu;if(h){u4(u.uPre0,h.pre0);u4(u.uPre1,h.pre1);u4(u.uSpecModes,h.modes);for(var p of G3)u3(u[p[0]],h[p[1]])}dr()};",
    "var pF=(p,b)=>{if(!okG()||fc<=0||fr<=0)return;gl.useProgram(P);bAtl(p.font,p.dpr);gl.viewport(0,0,cv.width,cv.height);gl.uniform2f(u.size,cv.width,cv.height);gl.uniform2f(u.grid,fc,fr);gl.uniform2f(u.cellPixels,fw*p.dpr,fh*p.dpr);for(var k of F3)u3(u[k[0]],p[k[1]]);for(var k of F4)u4(u[k[0]],p[k[1]]);u1(u.auraLift,p.auraLift);u1(u.auraPhase,p.auraPhase);u1(u.lightMode,p.lightMode);u1(u.nebulaLift,p.nLift);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,cT);if(b)gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,fc,fr,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(b));dr()};",
    "var tk=ts=>{raf=0;if(dd||pa||!rd||mode!=='glow'||!cur.anim||cur.still)return;var n=typeof ts==='number'?ts:nw();if(!cur.continuous&&iMs>0&&lA>0&&n-lA>=iMs){cur.anim=0;sR();pm({type:'slept'});return}var g=mF>0?1e3/mF:0;if(g>0&&lD>0&&n-lD<g*.88){if(typeof requestAnimationFrame==='function')raf=requestAnimationFrame(tk);return}var dt=lC>0?Math.min(.1,Math.max(0,(n-lC)/1e3)):.016;lC=lD=n;fS+=dt*cur.speed;pG(12+fS);if(typeof requestAnimationFrame==='function')raf=requestAnimationFrame(tk)};",
    "self.onmessage=ev=>{var m=ev?.data;if(!m||dd)return;var tp=m.type;",
    "if(tp==='init'){try{mode=m.mode||'glow';cv=m.canvas;iMs=Number(m.idleTimeoutMs)||1200;mF=Number(m.maxFps)||0;cv?.addEventListener?.('webglcontextlost',e=>{e?.preventDefault?.();sR();rd=0;pm({type:'contextlost'})});gl=cv?.getContext?.('webgl2',{alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:false})||null;if(!gl||gl.isContextLost?.())throw new Error('webgl2-unavailable');if(mode==='field'){fc=m.cols|0;fr=m.rows|0;fw=m.cellW||7;fh=m.cellH||15;fz=m.fontSize||10;fg=m.glyphs||'';bld(m.vs,m.fs,'cells,atlas,size,grid,cellPixels,atlasCell,glyphCount,ink,wave,aura,optics,auraLift,auraPhase,lightMode,neb0,neb1,neb2,nebOpt,nebulaLift,uSpec0,uSpec1,uSpec2,uSpec3,uIdleParams,uIdleMetrics');aC2();aT=mT(1,gl.LINEAR);gl.uniform1i(u.cells,0);gl.uniform1i(u.atlas,1);u4(u.uIdleMetrics,[fw,fh,1/(m.cloudScale||100),1/(m.breathScale||280)])}else bld(m.vs,m.fs,'uRes,uDpr,uTime,uDark,uReach,uIntensity,uPresence,uPrism,uSurge,uSpeed,uSpectrum,uSemantic,uPre0,uPre1,uSpecModes,uBaseA,uBaseB,uPrismA,uPrismB,uLightA,uLightB,uSurgeLead,uChimeLead,uHotAnchor,uSemA,uSemB');if(m.pw>0&&m.ph>0){cv.width=m.pw;cv.height=m.ph;dpr=m.dpr||1}rd=1;lA=nw();pm({type:'ready'})}catch(er){sR();frG();rd=0;pm({type:'error',reason:String(er?.message||er||'init-err')})}return}",
    "if(tp==='resize'){if(!cv)return;var w=Math.max(0,m.pw|0),h=Math.max(0,m.ph|0);dpr=m.dpr||dpr||1;if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h}if(mode==='field'){var c=Math.max(0,m.cols|0),r=Math.max(0,m.rows|0);if(rd&&(c!==fc||r!==fr)){fc=c;fr=r;aC2()}}else if(rd&&!pa&&w>0&&h>0&&m.syncDraw!==false)pG(12+fS);return}",
    "if(tp==='draw'){if(mode==='field'){pa=0;if(rd)try{pF(m.params,m.cellsBuf)}catch(e){pm({type:'error',reason:String(e?.message||e||'field-draw')})}return}pa=0;if(m.maxFps!==undefined)mF=Number(m.maxFps)||0;Object.assign(cur,m,{dark:m.dark?1:0,still:m.still?1:0,anim:m.anim?1:0,continuous:m.continuous?1:0,spec:m.spec||0,sem:m.sem||0,hu:m.hu||null});fS=Math.max(0,(m.timeSec||12)-12);lA=lC=lD=nw();if(rd&&cv?.width>0&&cv.height>0)pG(cur.timeSec);if(cur.anim&&!cur.still&&!raf&&typeof requestAnimationFrame==='function')raf=requestAnimationFrame(tk);else if(!cur.anim||cur.still)sR();return}",
    "if(tp==='clear'){sR();pa=1;if(gl&&cv?.width>0&&cv.height>0&&!gl.isContextLost?.()){gl.viewport(0,0,cv.width,cv.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT)}return}",
    "if(tp==='sleep'||tp==='release'){pa=1;cur.anim=0;sR();if(tp==='release'&&cv)cv.width=cv.height=0;return}",
    "if(tp==='dispose'){dd=1;pa=1;sR();frG();if(gl)try{gl.getExtension('WEBGL_lose_context')?.loseContext()}catch{}gl=cv=aC=aX=null;try{self.close?.()}catch{}}};",
  ].join('');

  const gApi = (k) => (G && G[k]) || (typeof globalThis !== 'undefined' ? globalThis[k] : null);
  const revoke = (u) => { if (u) try { gApi('URL')?.revokeObjectURL?.(u); } catch {} };
  function mkBlobW(src) {
    const B = gApi('Blob'), U = gApi('URL'), W = gApi('Worker');
    if (!B || !U?.createObjectURL || !W) throw new Error('worker-api-unavailable');
    const url = U.createObjectURL(new B([src], { type: 'application/javascript' }));
    try { return { worker: new W(url), url }; } catch (e) { revoke(url); throw e; }
  }
  const hasOff = () => Boolean(gApi('OffscreenCanvas') && gApi('Worker') && gApi('Blob') && gApi('URL')?.createObjectURL);
  const clrRetry = () => { if (pTimer) { clearTimeout(pTimer); pTimer = 0; } retryCbs.clear(); };
  function schedRetry(o = {}, cb) {
    if (isF(cb)) retryCbs.add(cb);
    if (pTimer || !pCache || pCache.ok || !pCache.retryable) return;
    pTimer = setTimeout(() => {
      pTimer = 0;
      const cbs = [...retryCbs]; retryCbs.clear();
      if (!pCache || pCache.ok || !pCache.retryable) return;
      probeWorkerWebGL2({ force: true, timeoutMs: o.timeoutMs }).then((r) => { if (r?.ok) for (const fn of cbs) try { fn(r); } catch {} }).catch(() => {});
    }, o.retryDelayMs !== undefined ? M.max(0, Number(o.retryDelayMs)) : M.max(0, pRetryAt - Date.now()));
  }
  function probeWorkerWebGL2(o = {}) {
    const canR = Boolean(pCache && !pCache.ok && pCache.retryable && Date.now() >= pRetryAt);
    if (!o.force && pCache && !canR) return Promise.resolve(pCache);
    if (!o.force && pPend) return pPend;
    if (!hasOff()) return Promise.resolve((pCache = F({ ok: false, reason: 'unsupported', retryable: false, checkedAt: Date.now() })));
    const tMs = M.max(10, Number(o.timeoutMs) || PROBE_TIMEOUT_MS), rMs = M.max(0, o.retryDelayMs !== undefined ? Number(o.retryDelayMs) : PROBE_RETRY_DELAY_MS);
    pPend = new Promise((res) => {
      let done = false, tm = 0, w = null, url = '', sr = 0, sa = 0;
      const fin = (ok, reason) => {
        if (done) return; done = true;
        if (tm) { clearTimeout(tm); tm = 0; }
        if (w) { try { w.onmessage = w.onerror = null; w.terminate(); } catch {} if (pW === w) pW = null; w = null; }
        if (url) { revoke(url); if (pUrl === url) pUrl = ''; url = ''; }
        const r = String(reason || (ok ? 'ok' : 'failed')), retryable = !ok && r === 'timeout' && pRetries < 1;
        const detail = !ok && r === 'timeout' ? (sa ? 'gpu-hang' : sr ? 'no-ack' : 'no-ready') : r;
        if (retryable) { pRetries += 1; pRetryAt = Date.now() + rMs; } else { if (ok) pRetries = 0; else fallbacks += 1; pRetryAt = 0; }
        pCache = F({ ok: Boolean(ok), reason: r, detail, retryable, checkedAt: Date.now() }); pPend = null; res(pCache);
      };
      try {
        const Off = gApi('OffscreenCanvas'), cv = new Off(1, 1), cr = mkBlobW(PROBE_WORKER_SRC);
        w = pW = cr.worker; url = pUrl = cr.url;
        w.onmessage = (e) => {
          const d = e?.data, t = d?.type;
          if (t === 'probe-ready') sr = 1;
          else if (t === 'probe-ack') sa = 1;
          else if (t === 'probe') fin(Boolean(d.ok), d.reason || (d.ok ? 'ok' : 'webgl2-null'));
        };
        w.onerror = (e) => fin(false, e?.message || 'worker-error');
        tm = setTimeout(() => fin(false, 'timeout'), tMs);
        w.postMessage({ type: 'probe', canvas: cv }, [cv]);
      } catch (e) { fin(false, e?.message || 'csp-blocked'); }
    });
    return pPend;
  }
  const warmProbe = (o) => { try { probeWorkerWebGL2(o).catch(() => {}); } catch {} };
  const getProbeStatus = () => { const c = pCache, r = c ? c.reason : pPend ? 'probing' : 'unprobed'; return { probed: !!c, ok: !!c?.ok, reason: r, detail: c?.detail || r }; };
  function resetProbeCache() {
    clrRetry();
    if (pW) { try { pW.terminate(); } catch {} pW = null; }
    if (pUrl) { revoke(pUrl); pUrl = ''; }
    pCache = pPend = null; pRetries = pRetryAt = 0;
  }
  function checkProbe(o) {
    const ro = { timeoutMs: o.probeTimeoutMs, retryDelayMs: o.probeRetryDelayMs };
    if (!pCache || (!pCache.ok && pCache.retryable && Date.now() >= pRetryAt)) {
      warmProbe(ro);
      if (isF(o.onProbeReady) && pPend) {
        pPend.then((r) => { if (r?.ok) try { o.onProbeReady(r); } catch {} else if (r?.retryable) schedRetry(ro, o.onProbeReady); });
      }
      return false;
    }
    if (!pCache.ok) { if (pCache.retryable && isF(o.onProbeReady)) schedRetry(ro, o.onProbeReady); return false; }
    return true;
  }
  function mkChan(ref, o, hk) {
    const iMs = M.max(20, Number(o.initTimeoutMs) || INIT_TIMEOUT_MS);
    let w = null, url = '', tm = 0, ready = false, failed = false, disposed = false, contextLost = false, notified = false, postMessageCount = 0;
    const drop = () => {
      if (tm) { clearTimeout(tm); tm = 0; }
      if (w) { try { w.onmessage = w.onerror = null; w.terminate(); } catch {} w = null; }
      if (url) { revoke(url); url = ''; }
      active.delete(ref);
    };
    const fail = (rsn, err) => {
      if (failed || disposed) return;
      failed = true; ready = false; if (rsn === 'contextlost') contextLost = true;
      fallbacks += 1; drop(); hk.onFail?.(rsn);
      if (!notified) { notified = true; try { o.onFallback?.(rsn, err); } catch {} if (rsn === 'contextlost') try { o.onContextLost?.({ reason: rsn, fromWorker: true }); } catch {} }
    };
    const post = (m, xf) => {
      if (!w || disposed || failed) return false;
      try { xf ? w.postMessage(m, xf) : w.postMessage(m); postMessageCount += 1; return true; }
      catch (e) { fail('post-error', e); return false; }
    };
    const start = (cv, msg) => {
      try {
        const off = cv.transferControlToOffscreen(), cr = mkBlobW(RENDER_WORKER_SRC);
        w = cr.worker; url = cr.url; active.add(ref);
        w.onmessage = (e) => {
          const d = e?.data; if (!d || disposed || failed) return;
          if (d.type === 'ready') { if (tm) { clearTimeout(tm); tm = 0; } ready = true; hk.onReady?.(); }
          else if (d.type === 'slept') hk.onSlept?.();
          else if (d.type === 'contextlost' || d.type === 'error') fail(d.type === 'contextlost' ? 'contextlost' : d.reason || 'worker-error');
        };
        w.onerror = (e) => fail('worker-onerror', e);
        tm = setTimeout(() => { if (!ready && !disposed && !failed) fail('init-timeout'); }, iMs);
        post({ ...msg, canvas: off }, [off]);
        return true;
      } catch (e) { fail('transfer-or-construct-error', e); return false; }
    };
    const dispose = () => { if (disposed) return; disposed = true; if (w && !failed) try { w.postMessage({ type: 'dispose' }); } catch {} drop(); };
    return { start, post, dispose, state: () => ({ ready, failed, disposed, contextLost, postMessageCount }) };
  }

  function mountGlowWorker(cv, o = {}) {
    if (!cv || !isF(cv.transferControlToOffscreen) || o.prefer2D || o.force2D || G?.__agRippleForce2D === true) return null;
    const core = o.rippleCore || G?.__agCsRippleCore || null, ws = core?.WORKER_SHADERS;
    const fs = ws?.glowFs || core?.HORIZON_FRAGMENT_SHADER || core?.GLOW_FRAG_SHADER, vs = ws?.glowVs || core?.GLOW_VERT_SHADER;
    if (!fs || !vs || !isF(core?.mountBrandHorizonGlow) || !checkProbe(o)) return null;
    const doc = cv.ownerDocument || getDoc(o.doc), iMs = M.max(200, Number(o.idleTimeoutMs) || IDLE_SLEEP_MS);
    let paused = false, sleeping = false, pR = null, pD = null, cW = M.max(0, Number(o.width ?? 0)), cH = M.max(0, Number(o.height ?? 0));
    let dpr = cl(o.dpr || 1, 0.5, 2), pw = cW > 0 ? M.max(1, M.round(cW * dpr)) : 0, ph = cH > 0 ? M.max(1, M.round(cH * dpr)) : 0;
    const ext = { mode: 'worker-webgl2' };
    const ch = mkChan(ext, o, {
      onFail: () => { sleeping = paused = true; },
      onSlept: () => { sleeping = true; },
      onReady: () => { if (pR) { ch.post(pR); pR = null; } if (pD && !paused) { ch.post(pD); pD = null; } if (paused) ch.post({ type: 'sleep' }); },
    });
    const ok = () => { const s = ch.state(); return s.ready && !s.disposed && !s.failed; };
    const setPaused = (flag) => { const s = ch.state(); if (s.disposed || s.failed) return; if (flag) { if (!paused) { paused = sleeping = true; if (s.ready) ch.post({ type: 'sleep' }); } } else paused = false; };
    Object.assign(ext, {
      isContextLost: () => { const s = ch.state(); return s.contextLost || s.failed; },
      isSleeping: () => sleeping || paused, getBufferSize: () => ({ width: pw, height: ph, dpr }),
      canDraw: () => { const s = ch.state(); if (isHostPaused(doc)) { setPaused(true); return false; } return !s.disposed && !s.failed && pw > 0 && ph > 0; },
      resize(nw, nh, nd) {
        const npw = nw > 0 ? M.max(1, M.round(nw * nd)) : 0, nph = nh > 0 ? M.max(1, M.round(nh * nd)) : 0;
        if (nw === cW && nh === cH && nd === dpr && npw === pw && nph === ph) return false;
        cW = nw; cH = nh; dpr = nd; pw = npw; ph = nph;
        const m = { type: 'resize', pw, ph, dpr, syncDraw: true };
        if (ok()) ch.post(m); else pR = m;
        return true;
      },
      clear() { sleeping = paused = true; if (ok()) ch.post({ type: 'clear' }); },
      releaseBackingStore() { pw = ph = 0; sleeping = paused = true; pR = pD = null; if (ok()) ch.post({ type: 'release' }); },
      draw(_w, _h, _d, timeSec, dark, intensity, presence, reach, prism, surge, speed, spec, sem, meta) {
        sleeping = Boolean(meta?.still); if (!sleeping) paused = false;
        const hu = core.computeHorizonUniforms?.(Boolean(dark), presence, prism, surge, speed, spec, sem) || null;
        const m = { type: 'draw', dark: Boolean(dark), intensity, presence, reach, prism, surge, speed, spec, sem, hu, timeSec, still: sleeping, anim: Boolean(!sleeping && o.workerAutoLoop === true), continuous: Boolean(meta?.continuous), maxFps: getPerfProfile(doc).maxFps };
        if (ch.state().ready) ch.post(m); else pD = m;
      },
      dispose() { sleeping = paused = true; ch.dispose(); },
    });
    if (!ch.start(cv, { type: 'init', mode: 'glow', vs, fs, pw, ph, dpr, idleTimeoutMs: iMs, maxFps: getPerfProfile(doc).maxFps })) return null;
    const sess = core.mountBrandHorizonGlow(cv, { ...o, externalRenderer: ext });
    sess.setPaused = setPaused; sess.getStats = () => ({ ...ch.state(), paused, sleeping });
    return sess;
  }

  async function mountGlowWorkerWithProbe(cv, o = {}) {
    const r = await probeWorkerWebGL2({ timeoutMs: o.probeTimeoutMs, force: o.forceProbe });
    if (!r?.ok) { if (r?.retryable) fallbacks += 1; try { o.onFallback?.(r ? r.reason : 'probe-failed'); } catch {} return null; }
    return mountGlowWorker(cv, o);
  }

  function mountManagedGlow(cfg = {}) {
    const { getCanvas, swapCanvas, rippleCore, doc, prefer2D, allowWorker = true, onContextLost, onFallbackDone, onUpgradeReady } = cfg;
    const cv0 = isF(getCanvas) ? getCanvas() : null, noop = { mode: 'none', resize() {}, clear() {}, draw() {}, drawStaticSnapshot() {}, dispose() {} };
    if (!cv0 || !rippleCore?.mountBrandHorizonGlow) return noop;
    mgDepth += 1;
    try {
      if (!prefer2D && allowWorker) {
        let inSync = true, syncFb = false, syncRet = null;
        const prevN = lastNested; lastNested = null;
        const w = mountGlowWorker(cv0, {
          rippleCore, doc, width: 0, height: 0, probeTimeoutMs: cfg.probeTimeoutMs, probeRetryDelayMs: cfg.probeRetryDelayMs, initTimeoutMs: cfg.initTimeoutMs, onContextLost,
          onFallback: (r) => { if (inSync && isF(onFallbackDone)) syncFb = true; try { syncRet = onFallbackDone?.(r); } catch {} },
          onProbeReady: (r) => { try { onUpgradeReady?.(r); } catch {} },
        });
        inSync = false; const inner = lastNested; lastNested = prevN;
        if (w) return w;
        if (syncFb) { const res = inner || (syncRet && typeof syncRet === 'object' ? syncRet : noop); if (mgDepth > 1) lastNested = res; return res; }
      }
      const mk = (u) => rippleCore.mountBrandHorizonGlow(getCanvas(), { prefer2D: !!u, width: 0, height: 0, onContextLost });
      let g = mk(prefer2D);
      if (g?.mode === 'none' && !prefer2D && getPerfMode(doc || cv0?.ownerDocument) !== 'performance' && isF(swapCanvas)) { try { g.dispose?.(true); } catch {} swapCanvas(); g = mk(true); }
      if (mgDepth > 1) lastNested = g;
      return g;
    } finally { mgDepth -= 1; }
  }

  function mountFieldWorker(cv, cols, rows, waves, o = {}) {
    if (!cv || !isF(cv.transferControlToOffscreen) || cols <= 0 || rows <= 0 || o.prefer2D || o.force2D || G?.__agRippleForce2D === true) return null;
    const core = o.rippleCore || G?.__agCsRippleCore || null, ws = core?.WORKER_SHADERS;
    const vs = ws?.fieldVs || core?.VERTEX_SHADER, fs = ws?.fieldFs || core?.FRAGMENT_SHADER;
    if (!vs || !fs || !isF(core?.createGlyphField) || !checkProbe(o)) return null;
    const R = core.RIPPLE;
    let cN = cols, rN = rows, dpr = cl(o.dpr || 1, 0.5, 2), pw = M.round(cN * R.cellWidth * dpr), ph = M.round(rN * R.cellHeight * dpr);
    let data = new Uint8Array(cN * rN * 4), pR = null, pD = null;
    const ext = { mode: 'worker-webgl2', gpuIdleMod: true, data };
    const ch = mkChan(ext, o, { onReady: () => { if (pR) { ch.post(pR); pR = null; } if (pD) { const b = pD.cellsBuf; ch.post(pD, b ? [b] : undefined); pD = null; } } });
    Object.assign(ext, {
      isContextLost: () => { const s = ch.state(); return s.contextLost || s.failed; },
      getBufferSize: () => ({ width: pw, height: ph, dpr }),
      releaseBackingStore() { pw = ph = 0; pR = pD = null; if (ch.state().ready) ch.post({ type: 'release' }); },
      resize(nc, nr, nd) {
        const s = ch.state(); if (s.disposed || s.failed || nc <= 0 || nr <= 0) return false;
        cN = nc; rN = nr; if (nd > 0) dpr = cl(nd, 0.5, 2);
        pw = M.round(cN * R.cellWidth * dpr); ph = M.round(rN * R.cellHeight * dpr);
        data = ext.data = new Uint8Array(cN * rN * 4);
        const m = { type: 'resize', cols: cN, rows: rN, pw, ph, dpr };
        if (s.ready) ch.post(m); else pR = m;
        return true;
      },
      draw(pal, d, upload) {
        const s = ch.state(); if (s.disposed || s.failed || pw <= 0 || ph <= 0) return;
        const buf = upload !== false ? data.slice().buffer : null, m = { type: 'draw', params: core.packFieldDrawParams(pal, d > 0 ? d : dpr), cellsBuf: buf };
        if (s.ready) ch.post(m, buf ? [buf] : undefined); else pD = m;
      },
      dispose() { ch.dispose(); },
    });
    if (!ch.start(cv, { type: 'init', mode: 'field', vs, fs, cols: cN, rows: rN, pw, ph, dpr, cellW: R.cellWidth, cellH: R.cellHeight, fontSize: R.fontSize, glyphs: core.GLYPHS, cloudScale: R.cloudScale, breathScale: R.breathScale })) return null;
    return core.createGlyphField(cv, cN, rN, waves, { externalRenderer: ext, calmZones: o.calmZones, onContextLost: o.onContextLost });
  }

  function mountManagedField(cfg = {}) {
    const { getCanvas, swapCanvas, cols, rows, dpr, waves, rippleCore, prefer2D, allowWorker = true, onContextLost, onFallbackDone, onUpgradeReady } = cfg;
    const cv0 = isF(getCanvas) ? getCanvas() : null;
    if (!cv0 || !rippleCore?.createGlyphField || cols <= 0 || rows <= 0) return rippleCore?.createGlyphField ? rippleCore.createGlyphField(cv0, cols, rows, waves, { prefer2D: !!prefer2D, onContextLost }) : { mode: 'none', dispose() {}, invalidate() {}, draw() {}, needsDraw: () => false, busy: () => false };
    if (!prefer2D && allowWorker) {
      let syncFb = false, syncRet = null;
      const w = mountFieldWorker(cv0, cols, rows, waves, { rippleCore, dpr, onContextLost, onFallback: (r) => { syncFb = true; try { syncRet = onFallbackDone?.(r); } catch {} }, onProbeReady: (r) => { try { onUpgradeReady?.(r); } catch {} } });
      if (w) return w;
      if (syncFb && syncRet && typeof syncRet === 'object') return syncRet;
    }
    const mk = (u) => rippleCore.createGlyphField(getCanvas(), cols, rows, waves, { prefer2D: !!u, onContextLost });
    let f = mk(prefer2D);
    if (f?.mode === 'none' && !prefer2D && getPerfMode(cfg.doc || cv0?.ownerDocument) !== 'performance' && isF(swapCanvas)) { try { f.dispose?.(true); } catch {} swapCanvas(); f = mk(true); }
    return f;
  }

  function disposeAll() {
    clrRetry();
    for (const s of [...active]) try { s.dispose(); } catch {}
    active.clear();
    if (pW) { try { pW.terminate(); } catch {} pW = null; }
    if (pUrl) { revoke(pUrl); pUrl = ''; }
    pPend = null;
  }
  const getActiveWorkerCount = () => active.size + (pW ? 1 : 0);
  const getStats = () => ({ perfMode: getPerfMode(), probe: getProbeStatus(), activeWorkers: getActiveWorkerCount(), totalFallbacks: fallbacks });
  return {
    PROBE_TIMEOUT_MS, INIT_TIMEOUT_MS, PROBE_RETRY_DELAY_MS, IDLE_SLEEP_MS, PERF_PROFILES, PROBE_WORKER_SRC, RENDER_WORKER_SRC,
    getPerfMode, getPerfProfile, getPerfMinGapMs, resolveRippleDpr, resolveGlowDpr, isHostPaused, probeWorkerWebGL2, warmProbe, getProbeStatus, resetProbeCache,
    mountGlowWorker, mountGlowWorkerWithProbe, mountManagedGlow, mountFieldWorker, mountManagedField, disposeAll, getActiveWorkerCount, getStats,
  };
});
