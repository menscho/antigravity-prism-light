(function(root,factory){
if(typeof module==='object'&&module.exports){module.exports=factory(root);}else{
try{root.__agPrismTelemetry?.destroy?.();}catch{}
if(typeof window!=='undefined'&&window!==root)try{window.__agPrismTelemetry?.destroy?.();}catch{}
const api=factory(root);root.__agPrismTelemetry=api;if(typeof window!=='undefined')window.__agPrismTelemetry=api;
}
})(typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:this,function(globalRoot){
'use strict';
const isFn=v=>typeof v==='function',isStr=v=>typeof v==='string',isFin=v=>typeof v==='number'&&Number.isFinite(v);
const gA=(e,k)=>e?.getAttribute?.(k),sA=(e,k,v)=>e?.setAttribute?.(k,v),rA=(e,k)=>e?.removeAttribute?.(k);
const qS=(e,s)=>e?.querySelector?.(s),qA=(e,s)=>e?.querySelectorAll?.(s);
const emitB=(w,p)=>{try{w?.__agPulseExternalBridge?.(p);}catch{}};
const TI=s=>`[data-testid="${s}"]`,TIs=s=>s.split('|').map(TI).join(','),cT=t=>(t!==null&&clearTimeout(t),null),stTm=(fn,ms)=>{const t=setTimeout(fn,ms);t?.unref?.();return t;},on=(e,t,f,c)=>(e?.addEventListener?.(t,f,c),()=>e?.removeEventListener?.(t,f,c)),setIf=(e,k,v)=>{if(gA(e,k)!==v)sA(e,k,v);},qAll=(d,s)=>{let r=isFn(d?.querySelectorAll)?Array.from(d.querySelectorAll(s)):[];if(!r.length&&isFn(d?.querySelector)){const o=d.querySelector(s);if(o)r=[o];}return r;},mkTier=(anc,host)=>({anc,host,ro:null,raf:0,curFtTier:0,curBarTier:0,pendW:0,hasPendW:false,lastFtTv:'',lastBarTv:'',lastWide:false});

const BAR_ID='ag-pulse-status-bar',PRISM_BAR_ID='ag-prism-pulse-bar',PRISM_BAR_ATTR='data-ag-prism-pulse-bar',FALLBACK_ATTR='data-ag-prism-fallback',HID_ATTR='data-ag-prism-hidden',METRICS_BINDING='__agPrismMetricsCall';
const WAIT_MS=1500,GRACE_MS=3500,SW_DEBOUNCE_MS=30,HOVER_OPEN_MS=180,HOVER_CLOSE_MS=220,LRU_MAX=32,GUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,URL_CID_RE=/\/c\/([0-9a-f-]{36})/i;
const TIER_ATTR='data-t',TIER_STYLE_ATTR='data-pt',TIER_VALS=['0','1','1 2','1 2 3','1 2 3 4','1 2 3 4 5'],FT_VALS=['0','1','1 2'];
const CID_A='data-cascade-id',CID_S='['+CID_A+']',CV_S=TI('conversation-view'),AE_A='aria-expanded',IB_S=TI('agent-input-box'),MS_S=TI('model-selector-trigger');
const LE='local-estimate',AG='data-ag-cs-',PV='data-pv-',DW='data-warn',CK='conversationId',IK='includeConversations';
const expCss=s=>{
const k='pqrstuvwxyz0123456789abcdefghijklmno',t=[':host([data-no-q="1"][data-t~="','.bar>$2context"]','color:var(--','::before','transparent)',':is(.bar,.bar *)','font-variant-numeric:tabular-nums','position:relative','flex:none','justify-content:','align-items:center','var(--e)',':host([data-t~="','[data-card="','color-mix(in srgb,var(--pt-c) ','overflow:hidden;white-space:nowrap;','transform:scale(.9) translateX(4px);pointer-events:none!important','border-radius:','background:','rgba(148,163,184,.',':host([data-pv-resizing="1"])',':host([data-pv-light="1"])',':is(:hover,[aria-expanded="true"])','transition:','font-size:','opacity:','position:absolute;','flex-shrink:','max-width:','margin:','padding:','.bar .chip',':host(:not(.icons-only))','font-weight:','display:none!','pointer-events:none'];
for(let i=0;i<t.length;i++)s=s.split('$'+k[i]).join(t[i]);
return s.replace(/!(?!important)/g,'!important');
};
const TIER_CSS=expCss('[hidden]{$n}:host{--e:cubic-bezier(.22,1,.36,1);--pt-c:var(--pv-tint,var(--pulse-ring,#3186ff))}.bar{$cgap .28s $0}.bar>:is(.chip,.dot){$4max-width:132px;$e1;transform-origin:right;$cmax-width .28s $0,opacity .17s ease-out,padding .28s $0,margin .28s $0,gap .28s $0,transform .28s $0,background .16s,border-color .22s,box-shadow .22s}.bar>[data-card="cache"]{max-width:240px}$q{$h136px}.bar>.dot{$h16px}:where(.bar>.chip>*:not(.context-ring):not(svg)){$4max-width:108px;flex-shrink:0;$e1;transform-origin:right;$cmax-width .28s $0,opacity .17s ease-out,margin .28s $0,padding .28s $0,transform .28s $0}.context-ring{$ctransform .28s $0}.context-ring[data-anim="1"]{will-change:transform}$11"]) :is(.cache-total,.sub-badge,$2cache"] .dim,.countdown),$14"]) $2context"] .context-label,$15"]) $2context"]>:not(.context-ring){max-width:0!important;flex-shrink:1!important;$e0!;$i0!;$j0!;$5}$11"]) .bar>:is($2speed"],.dot),$12"]) .bar>$2cache"],$13"]) .bar>:is($2week"],$2five"]){$h0!;min-width:0!;$g1!;$e0!;$j0!;$i0!;gap:0!;border:0!;$5}$11"]) .bar>$2speed"]$s,$12"]) .bar>$2cache"]$s,$13"]) .bar>$2week"]$s,$13"]) .bar>$2five"]$s,$13"]) $q$s,$p1"]) .bar>$2cache"]$s,$p2"]) $q$s{$e0!;content:none!}$13"]) $q,$p1"]) .bar>$2cache"],$p2"]) $q{margin-left:0!}$13"]) .bar{gap:0}$15"]) $2context"]{width:26px!;min-width:26px!;height:26px!;$j0!;gap:0!;$6999px!;$ycenter!;$7$39%,$t;border:1px solid $328%,$828))}$15"]) $2context"]$b{$7$317%,$t;border-color:$348%,$84));box-shadow:0 0 10px -2px $345%,$t}$15"]) .context-ring{transform:scale(1.27)}:host([data-pv-motion="off"]) $u,$9 $u{$cnone!}@media (prefers-reduced-motion:reduce){:host(:not([data-pv-ignore-rm="1"])) $u{$cnone!}}');
const SHADOW_CSS=expCss(':host,*,::before,::after{box-sizing:border-box}:host,.bar,.chip{display:inline-flex;$z}:host{--ch:#dae2f0db;--mu:#94a0b6b8;--f:#eef1f7;--pv-tint:#3186ff;flex:0 0 auto;$w;font:11px/16px Inter,system-ui,-apple-system,"Segoe UI",sans-serif;$v;$rch);user-select:none;z-index:20}$a{--ch:#1e293b;--mu:#475569;--f:#0f172a;--pv-tint:#2563eb;--pv-w1:#d97706;--pv-w2:#dc2626}:host([hidden]),.sub-badge[hidden],:host(:not([data-wide="1"])) .sub-badge,.card[hidden],.footnote[hidden],.footnote:empty,:host([data-layout="blocked"])>.bar{$n}:host([data-layout="blocked"]){position:fixed!;left:-9999px!;top:-9999px!;width:0!;height:0!;$i0!;$j0!;overflow:hidden!;visibility:hidden!;$o!}.bar{gap:2px;$x}$k{$x;white-space:nowrap;gap:3.5px;height:24px;$j0 5px;border:0;$65px;$7transparent;$rch);font:inherit;line-height:16px;$d11px;cursor:pointer;overflow:visible;$v;$cbackground .15s,color .15s}$k$b{$7rgba(255,255,255,.05);$rf)}$a $k$b{$7rgba(15,23,42,.05)}$k strong{$m600}$k[data-warn="1"] strong,dd[data-warn="1"]{$rpv-w1,#f59e0b)}$k[data-warn="2"] strong,dd[data-warn="2"]{$rpv-w2,#f87171)}.chip svg{width:12px;height:12px;stroke:currentColor;stroke-width:1.5;fill:none;$e.75;$x}$k .dim{$rmu);$e.66;$d9.5px}$k :is([data-i18n="cache"],[data-i18n="five"],[data-i18n="week"]){$e.62}$k[data-card="speed"]>span:last-child{$e.66;$d10px}$l :is(.chip[data-card="speed"]>:is(svg,.rounds),.chip[data-card="cache"]>:is(svg:first-child,.cache-total,.dim),.chip[data-card="context"]>.context-label){$n}$l $k:not([hidden])~.chip:not([hidden]){$w;margin-left:6px}$l $k:not([hidden])~.chip:not([hidden])$s{content:"·";$fleft:-4px;top:50%;transform:translate(-50%,-50%);$rmu);$e.32;$o}.sub-badge{$d10px;$e.82;$rprimary,#38bdf8);$m500;margin-right:2px}.context-ring{width:11px;height:11px;$650%;$7conic-gradient(var(--pv-tint,#3186ff) var(--used-angle,36deg),$828) 0);display:inline-block;$w;$x}.context-ring::after{content:"";$finset:2.2px;$650%;$7var(--card,#141720)}$a .context-ring::after{$7var(--card,#f8fafc)}.card{$fright:0;left:auto;bottom:calc(100% + 10px);width:min(304px,calc(100vw - 24px));$j12px 13px;$610px;border:1px solid $822);$7var(--card,#12151ef5);$rforeground,#eef1f7);box-shadow:0 16px 40px rgba(0,0,0,.36);z-index:9999}.card::after{content:"";$fleft:0;right:0;top:100%;height:12px}$14"]) .card{right:-84px;width:min(296px,calc(100vw - 32px))}.heading{display:flex;$z;$yspace-between;gap:6px;$d11px;$m600;margin-bottom:6px}.heading>span:first-child{white-space:nowrap}#context-summary{display:block;$d13px;$m600;margin-bottom:2px}#context-tokens{$i0 0 8px;$d11px;$e.76}.track{height:5px;$6999px;$7$818);overflow:hidden;$i6px 0 10px}.track>i{display:block;height:100%;width:0%;$6999px;$7linear-gradient(90deg,#2563eb,#38bdf8)}dl{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;$i8px 0;$d11px}dt{$e.64}dd{$i0;text-align:right;$m500;$4text-overflow:ellipsis}.footnote{$i6px 0 0;$d10px;$e.58}')+TIER_CSS;

const FB_ROWS={
'zh-CN':'缓存|吞吐速率|首字延迟|最近速率|上下文窗口|当前模型|已用|剩余|代理|5h|周|5h 配额|周配额',
'zh-TW':'快取|吞吐速率|首字延遲|最近速率|上下文視窗|目前模型|已用|剩餘|代理|5h|週|5h 額度|週額度',
en:'Cache|Throughput|TTFT|Latest Rate|Context Window|Active Model|used|free| sub|5h|Wk|5h Quota|Weekly Quota',
ja:'キャッシュ|スループット|初回応答|最新速度|コンテキスト|現在のモデル|使用|残り| サブ|5h|週|5h 枠|週間枠',
ko:'캐시|처리 속도|첫 토큰 지연|최근 속도|컨텍스트 창|현재 모델|사용|여유| 서브|5h|주|5h 할당|주간 할당',
es:'Caché|Rendimiento|TTFT|Velocidad rec.|Ventana de ctx|Modelo activo|usado|libre| sub|5h|Sem|Cuota 5h|Cuota sem.',
fr:'Cache|Débit|TTFT|Dernier débit|Fenêtre ctx|Modèle actif|utilisé|libre| sous|5h|Heb|Quota 5h|Quota hebdo',
de:'Cache|Durchsatz|TTFT|Akt. Rate|Kontextfenster|Aktives Modell|belegt|frei| Sub|5h|W|5h-Kontingent|Wochenkontingent',
tr:'Önbellek|Verim|TTFT|Son Hız|Bağlam|Aktif Model|dolu|boş| alt|5h|Hf|5s Kota|Haftalık Kota',
};
const LANG_M=[[/^(?:yue(?:-|$)|zh-yue|.*cantonese)/,'zh-CN'],[/^(?:zh-(?:tw|hant|hk|mo)|tw$|hant$)/,'zh-TW'],[/^zh/,'zh-CN'],[/^(?:ja|jp|japanese$)/,'ja'],[/^(?:ko|kr|korean$)/,'ko'],[/^(?:es|spanish$)/,'es'],[/^(?:fr|french$)/,'fr'],[/^(?:de|german$)/,'de'],[/^(?:tr|turkish$|türkçe$|turkce$)/,'tr']];
function normFbLang(raw,win){
let v=String(raw||'').trim();
if(!v||v.toLowerCase()==='auto'){const nv=win&&'navigator'in win?win.navigator:(typeof navigator!=='undefined'?navigator:null);v=String(nv?.languages?.[0]||nv?.language||'').trim();}
const s=v.toLowerCase().replace(/_/g,'-');
if(!s||s==='auto')return 'en';
for(const[re,code]of LANG_M)if(re.test(s))return code;
return 'en';
}
const FB_I18N=Object.fromEntries(Object.entries(FB_ROWS).map(([lk,s])=>{
const r=s.split('|');
return[lk,{cache:r[0],speedHeading:r[1],ttft:r[2],latestRate:r[3],ctxHeading:r[4],curModel:r[5],fiveShort:r[9],weekShort:r[10],fiveQuota:r[11],weekQuota:r[12],summary:(p,rem)=>`${p}% ${r[6]} · ${rem}% ${r[7]}`,agents:n=>`${n}${r[8]}`}];
}));

const qEta=r=>{
const ms=typeof r==='number'?(r>1e11?r:r*1e3):Date.parse(r||''),d0=ms-Date.now();
if(!isFin(d0)||d0<=0)return '';
const s=Math.max(1,Math.round(d0/1e3)),d=(s/86400)|0,h=((s%86400)/3600)|0;
return d?`${d}d${h}h`:h?`${h}h${((s%3600)/60)|0}m`:`${Math.max(1,(s/60)|0)}m`;
};
const qWin=b=>{
if(!b||typeof b!=='object'||b.available===false||b.disabled)return null;
if(b.expired)return{r:1,t:b.resetAt??b.resetTime};
const n=+(b.remaining??b.remainingFraction);
return isFin(n)?{r:Math.max(0,Math.min(1,n)),t:b.resetAt??b.resetTime}:null;
};
const hasAvailQWin=g=>!!(qWin(g?.windows?.['5h']||g?.fiveHour)||qWin(g?.windows?.weekly||g?.weekly));
const qKind=g=>{
const k=`${g.id||''} ${g.name||''} ${g.description||''} ${g.windows?.['5h']?.id||''} ${g.windows?.weekly?.id||''}`.toLowerCase();
return /argon|wtu/.test(k)?'argon':/claude|anthropic|gpt|openai/.test(k)?'claude':/gemini|google/.test(k)?'gemini':'other';
};
function chooseQuotaGroupFallback(groups,model){
const list=Array.isArray(groups)?groups.filter(g=>g&&typeof g==='object'):[];
if(!list.length)return null;
const byK=k=>list.find(g=>qKind(g)===k),ms=String(model||'').toLowerCase();
const pick=/argon/.test(ms)?byK('argon')||byK('gemini'):/claude|anthropic|sonnet|opus|haiku|gpt|openai|\bo[134]\b/.test(ms)?byK('claude'):/gemini|carbon|hydrogen|neon|pro|flash/.test(ms)?byK('gemini')||byK('argon'):null;
return pick||list.find(hasAvailQWin)||byK('gemini')||list[0];
}
const qGrp=(gs,m,w)=>{
if(!Array.isArray(gs)||!gs.length)return null;
const uc=w?.__agCsUsageCore;
if(uc?.chooseQuotaGroup)try{const hit=uc.chooseQuotaGroup(gs,m);if(hit)return hit;}catch{}
return chooseQuotaGroupFallback(gs,m);
};

const histHooks=new WeakMap();
function subHistory(w,fn){
const h=w?.history;
if(!h||(!isFn(h.pushState)&&!isFn(h.replaceState)))return null;
let rec=histHooks.get(h);
if(!rec){
const oP=isFn(h.pushState)?h.pushState:null,oR=isFn(h.replaceState)?h.replaceState:null;
rec={oP,oR,wP:null,wR:null,cbs:new Set()};
const emit=()=>{for(const cb of [...rec.cbs])try{cb();}catch{}};
try{
if(oP){rec.wP=function(){const r=oP.apply(this,arguments);emit();return r;};h.pushState=rec.wP;}
if(oR){rec.wR=function(){const r=oR.apply(this,arguments);emit();return r;};h.replaceState=rec.wR;}
}catch{return null;}
histHooks.set(h,rec);
}
rec.cbs.add(fn);
return()=>{
rec.cbs.delete(fn);
if(rec.cbs.size===0){
try{if(rec.oP&&h.pushState===rec.wP)h.pushState=rec.oP;if(rec.oR&&h.replaceState===rec.wR)h.replaceState=rec.oR;}catch{}
histHooks.delete(h);
}
};
}

const fmtTok=n=>!isFin(n)||n<0?'—':n>=1e6?`${(n/1e6).toFixed(1).replace(/\.0$/,'')}M`:n>=1e3?`${Math.round(n/1e3)}K`:String(Math.round(n));
function mk(doc,tag,attrs,kids){
const el=doc.createElement(tag);
if(attrs)for(const[k,v]of Object.entries(attrs)){
if(v==null)continue;
if(k==='text')el.textContent=String(v);else if(k==='cls')el.className=String(v);else if(k==='hidden')el.hidden=!!v;else el.setAttribute(k,String(v));
}
if(kids)for(const c of kids)if(c)el.appendChild(c);
return el;
}

const HOST_ATTRS=Object.freeze({[FALLBACK_ATTR]:'1',[PRISM_BAR_ATTR]:'true','data-ag-owned':'1','data-ag-no-i18n':'',translate:'no','data-no-translate':'true','data-ag-localization-skip':'true','data-agy-no-translate':'true','data-antigravity-zh-skip':'1'});
const HIDE_PROPS='position:fixed|left:-9999px|top:-9999px|width:1px|height:1px|opacity:0|pointer-events:none|visibility:hidden|overflow:hidden'.split('|').map(s=>s.split(':'));
const FT_CUTS=[440,360],BAR_CUTS=[880,660,530,440,360],WIDE_CUT=1080,FT_SEL='.agy-composer-footer,'+TI('input-box-bottom-toolbar'),HC_A='data-hover-card-popup',QMODE_ATTR='data-ag-cs-telemetry-quota';
const stepTier=(cur,w,cuts)=>{let t=cur;while(t<cuts.length&&w<cuts[t])t++;while(t>0&&w>=cuts[t-1]+12)t--;return t;};
const SB_SEL='aside,'+TI('sidebar-split')+'>div:first-child,'+TIs('conversation-row-sidebar|project-header')+',['+HC_A+']';
const IGN_STREAM_SEL=TIs('autoscroll-viewport|planner-response-text|agent-response|background-task-command|running-items-card')+',[data-markdown-root],'+SB_SEL+',[data-op-thought="1"],.ag-prism-thought-overlay,.ag-cs-conv-aura-host,.ag-cs-crab,.ag-cs-prism-rim-cv,.ag-anim-icon,.ag-cs-thinking-spark,[data-agy-hans-ui],#agy-theme-switcher,#agy-theme-menu,#antigravity-quota-widget,#antigravity-translation-audit';
const BURST_STEPS=[450,700,900,1100,1400,1800,2200,2500],BUSY_SEL=TIs('input-cancel-button|stop-button|cancel-button|stop-generation-button'),SEND_SEL=TIs('input-send-button|send-button')+','+IB_S+' button[type="submit"]',SLASH_OPT_SEL='[id^="typeahead-item-"][role="option"],'+TI('slash-command-menu')+' [role="option"],[role="listbox"] [role="option"]',PT_SEL=TIs('agy-context-ring-trigger|agy-speed-stats-trigger'),CMP_RE=/^\/compact(?:\s|$)/i;
let reqSeq=0;

function createTelemetryController(envOpts){
const gW=()=>(envOpts&&envOpts.window)||(typeof window!=='undefined'?window:globalRoot);
const gD=()=>(envOpts&&envOpts.document)||gW()?.document||null;

let mode='auto',quotaMode='compact',waitTm=null,rescTm=null,pollTm=null,swTm=null,burstTm=null,burstIdx=0,burstGen=0,burstBase=null,burstCid=null,cmpOff=null,pickCmpAt=0,wasBusy=false;
let hasHost=false,yielded=false,lastSig='',detAt=0,lastHealAt=0;
let docOff=null,popOff=null,winResOff=null,lastSnap=null,mApi=null,mRes=null,seatObs=null,healTm=null;
let expLang='',activeHost=null,winBlur=false,pollSusp=false,blurOff=null,blurObs=null,extGuardHeld=false,lastHref='',lastUrlCid='';
const pend=new Map(),inFlight=new Map(),insts=new Map(),instByHost=new WeakMap(),extTiers=new Map(),snapByCid=new Map(),locSnaps=new WeakMap();

const readRouteKey=w=>{const l=w?.location;return l?`${l.href||''}|${l.pathname||''}|${l.hash||''}`:'';};
const extractUrlCid=w=>{const l=w?.location,m=(isStr(l?.pathname)&&l.pathname.match(URL_CID_RE))||(isStr(l?.href)&&l.href.match(URL_CID_RE));return m?m[1]:null;};
const ctxTs=s=>{const v=s?.speed?.context?.sampledAt;if(isFin(v))return v;const t=Date.parse(v||'');return isFin(t)?t:NaN;};
const putCidSnap=(cid,snap)=>{
if(!cid||!snap||typeof snap!=='object')return;
const prev=snapByCid.get(cid);
if(snap.connection===LE&&prev&&prev.connection!==LE)return;
if(prev&&prev.connection!==LE&&snap.connection!==LE){const pt=ctxTs(prev),nt=ctxTs(snap);if(isFin(pt)&&isFin(nt)&&nt<pt)return;}
snapByCid.delete(cid);snapByCid.set(cid,snap);
if(snapByCid.size>LRU_MAX)snapByCid.delete(snapByCid.keys().next().value);
};
const getCidSnap=cid=>{
if(!cid||!snapByCid.has(cid))return null;
const v=snapByCid.get(cid);snapByCid.delete(cid);snapByCid.set(cid,v);return v;
};
const isConn=(doc,el)=>{
if(!el||el.isConnected===false)return false;
if(el.isConnected===true)return true;
if(!el.parentNode&&!el.parentElement)return false;
if(doc&&isFn(doc.getElementById)&&el.id&&!isFn(doc.querySelectorAll)){const b=doc.getElementById(el.id);if(b&&b!==el)return false;}
return true;
};
const getPrimaryInst=()=>{
const doc=gD();let first=null;
for(const it of insts.values()){if(!isConn(doc,it.host))continue;if(!first)first=it;if(it.host.id===PRISM_BAR_ID)return it;}
return first;
};
const isCardOpen=it=>!!(it&&((it.xCard&&!it.xCard.hidden)||(it.sCard&&!it.sCard.hidden)));
const resolveActiveInst=()=>{
const doc=gD();
for(const it of insts.values())if(isConn(doc,it.host)&&isCardOpen(it))return it;
if(activeHost&&isConn(doc,activeHost)){const hit=instByHost.get(activeHost);if(hit)return hit;}
const actCv=doc?.activeElement?.closest?.(CV_S+','+IB_S);
if(actCv)for(const it of insts.values())if(isConn(doc,it.host)&&(actCv===it.anc||actCv.contains?.(it.anc)))return it;
return getPrimaryInst();
};
const syncPrimaryId=()=>{
const doc=gD();let primary=null;
for(const it of insts.values()){if(!isConn(doc,it.host))continue;if(!primary)primary=it;if(it.host.id===PRISM_BAR_ID){primary=it;break;}}
for(const it of insts.values()){
if(it===primary){if(it.host.id!==PRISM_BAR_ID)sA(it.host,'id',PRISM_BAR_ID);}
else if(it.host.id){rA(it.host,'id');if(it.host.id)it.host.id='';}
}
};

const syncHostAttrs=h=>{
const de=gD()?.documentElement;if(!h||!de)return;
const th=gA(de,AG+'theme');
if(th==='light')setIf(h,PV+'light','1');else if(th==='dark'&&gA(h,PV+'light')==='1')rA(h,PV+'light');
for(const k of['resizing','ignore-rm'])gA(de,AG+k)==='1'?setIf(h,PV+k,'1'):gA(h,PV+k)!==null&&rA(h,PV+k);
};
const syncAllHostAttrs=()=>{for(const it of insts.values())syncHostAttrs(it.host);for(const b of findExtBars(gD()))syncHostAttrs(b);};
const pulseRingAnim=rec=>{const r=rec?.sr?.getElementById?.('context-ring');if(!r)return;rec.ringTm=cT(rec.ringTm);setIf(r,'data-anim','1');rec.ringTm=stTm(()=>{rec.ringTm=null;rA(r,'data-anim');},320);};
const applyTierRec=(rec,force=false)=>{
rec.raf=0;
const doc=gD(),ft=mode!=='off'&&rec.anc&&isConn(doc,rec.anc)?rec.anc:null,w=rec.hasPendW?rec.pendW:ft?.getBoundingClientRect?.().width;
rec.pendW=0;rec.hasPendW=false;
if(!ft||!isFin(w)||w<=0)return;
const prevBarTv=rec.lastBarTv,ftTv=FT_VALS[(rec.curFtTier=stepTier(rec.curFtTier,w,FT_CUTS))]||'0',barTv=TIER_VALS[(rec.curBarTier=stepTier(rec.curBarTier,w,BAR_CUTS))]||'0',isWide=w>=WIDE_CUT;
if(!force&&ftTv===rec.lastFtTv&&gA(ft,TIER_ATTR)===ftTv&&barTv===rec.lastBarTv&&isWide===rec.lastWide)return;
rec.lastFtTv=ftTv;rec.lastBarTv=barTv;rec.lastWide=isWide;setIf(ft,TIER_ATTR,ftTv);
if(rec.host){
if(gA(rec.host,HID_ATTR)!=='1'){setIf(rec.host,TIER_ATTR,barTv);if(prevBarTv&&prevBarTv.includes('5')!==barTv.includes('5'))pulseRingAnim(rec);if(isWide)setIf(rec.host,'data-wide','1');else if(gA(rec.host,'data-wide')!==null)rA(rec.host,'data-wide');}
return;
}
const exts=findExtBars(doc),loc=exts.filter(b=>b&&(ft.contains?.(b)||b.parentElement===ft));
for(const b of(loc.length?loc:extTiers.size<=1?exts:[])){
if(!b||gA(b,HID_ATTR)==='1')continue;
setIf(b,TIER_ATTR,barTv);syncHostAttrs(b);
if(b.shadowRoot&&!qS(b.shadowRoot,`style[${TIER_STYLE_ATTR}="1"]`))try{const st=doc.createElement('style');sA(st,TIER_STYLE_ATTR,'1');st.textContent=TIER_CSS;b.shadowRoot.appendChild(st);}catch{}
}
};
const gBus=()=>{const w=gW();return w?.__agDomBus||w?.__agPrismDomBus||null;};
const subMo=(id,root,opt,fn,pri)=>{
const b=gBus(),w=gW();
if(b?.subscribe)return{disconnect:b.subscribe(id,fn,{doc:gD(),win:w,priority:pri,observeOptions:opt})};
if(!isFn(w?.MutationObserver)||!root)return null;
const mo=new w.MutationObserver(fn);try{mo.observe(root,opt);}catch{}return mo;
};
const readEntryW=e=>(Array.isArray(e?.borderBoxSize)?e.borderBoxSize[0]:e?.borderBoxSize)?.inlineSize??(Array.isArray(e?.contentBoxSize)?e.contentBoxSize[0]:e?.contentBoxSize)?.inlineSize??e?.contentRect?.width;
const schedTierRec=(rec,entries)=>{
if(entries&&typeof entries.length==='number'){
let rw=NaN;for(let i=entries.length-1;i>=0;i--){const w0=readEntryW(entries[i]);if(isFin(w0)&&w0>=0){rw=w0;break;}}
if(isFin(rw)){rec.pendW=rw;rec.hasPendW=true;}
}else rec.hasPendW=false;
if(!rec.raf&&mode!=='off'){const w=gW();if(w?.requestAnimationFrame){let ran=false;const id=w.requestAnimationFrame(()=>{ran=true;applyTierRec(rec,false);});rec.raf=ran?0:id;}else applyTierRec(rec,false);}
};
const ensWinResize=()=>{const w=gW();if(!winResOff&&w&&isFn(w.addEventListener))winResOff=on(w,'resize',()=>{for(const it of insts.values())schedTierRec(it,null);for(const et of extTiers.values())schedTierRec(et,null);},{passive:true});};
const attachTierRec=rec=>{
const w=gW();if(!w||!rec?.anc||mode==='off')return;
if(!rec.ro){
const b=gBus();
if(b?.observeSize)try{rec.ro={disconnect:b.observeSize(rec.anc,(sz,en)=>schedTierRec(rec,[en||{borderBoxSize:[{inlineSize:sz.width}]}]))};}catch{}
else if(isFn(w.ResizeObserver))try{rec.ro=new w.ResizeObserver(es=>schedTierRec(rec,es));rec.ro.observe(rec.anc);}catch{}
}
ensWinResize();if(!rec.lastBarTv||!rec.ro)applyTierRec(rec,true);
};
const detachTierRec=rec=>{
if(!rec)return;
try{if(rec.raf)gW()?.cancelAnimationFrame?.(rec.raf);rec.ringTm=cT(rec.ringTm);rec.ro?.disconnect?.();rA(rec.anc,TIER_ATTR);if(rec.host)rA(rec.host,'data-wide');}catch{}
Object.assign(rec,{raf:0,ro:null,curFtTier:0,curBarTier:0,pendW:0,hasPendW:false,lastFtTv:'',lastBarTv:'',lastWide:false});
};
const clrExtTiers=()=>{for(const et of extTiers.values())detachTierRec(et);extTiers.clear();};
const clrTier=()=>{
for(const it of insts.values())detachTierRec(it);
clrExtTiers();try{winResOff?.();}catch{}winResOff=null;
for(const b of qA(gD(),`#${PRISM_BAR_ID},[${PRISM_BAR_ATTR}],#${BAR_ID},[id^="${BAR_ID}"],[data-ag-pulse-bar]`)||[])try{rA(b,TIER_ATTR);rA(b,'data-wide');qS(b.shadowRoot,`style[${TIER_STYLE_ATTR}="1"]`)?.remove?.();}catch{}
};
const ensTierObs=()=>{
const doc=gD();if(!doc||mode==='off')return;
if(insts.size>0){clrExtTiers();for(const it of insts.values())attachTierRec(it);return;}
const fts=findAnchors(doc,true),ftSet=new Set(fts);
for(const[anc,et]of extTiers)if(!ftSet.has(anc)||!isConn(doc,anc)){detachTierRec(et);extTiers.delete(anc);}
for(const ft of fts){let et=extTiers.get(ft);if(!et)extTiers.set(ft,et=mkTier(ft,null));attachTierRec(et);}
};

const bindHook=()=>{
const w=gW();if(!w)return;
if(!mRes){
mRes=(id,pl)=>{
const it=pend.get(id);if(!it)return;
cT(it.timer);pend.delete(id);
let synced=pl;
if(pl&&pl.connection!==LE&&pl.groups?.length>0){
const prev=(it.cid&&snapByCid.get(it.cid))||(!it.cid?lastSnap:null);
const ks=!pl.speed&&prev?.speed,kc=!pl.conversations?.length&&prev?.conversations?.length;
synced=ks||kc?{...pl,...(ks?{speed:prev.speed}:{}),...(kc?{conversations:prev.conversations}:{})}:pl;
if(it.cid)putCidSnap(it.cid,synced);
if(!lastSnap||!it.cid||resolveActiveInst()?.cid===it.cid)lastSnap=synced;
}
if(it.syncUi&&synced&&synced.connection!==LE&&synced.speed?.context&&insts.size>0){
const doc=gD(),multi=insts.size>1,nAt=String(synced.speed.context.sampledAt||'');
for(const ins of insts.values()){
if(!isConn(doc,ins.host))continue;
const liveCid=detCid(ins.host,multi),oAt=String(ins.snap?.speed?.context?.sampledAt||'');
if((it.cid?(ins.cid===it.cid&&(!liveCid||liveCid===it.cid)):(!multi&&!ins.cid))&&ins.snap!==synced&&(!oAt||!nAt||nAt>=oAt))applySnapToInst(ins,synced);
}
}
it.onSettle?.();it.resolve(pl);
};
}
if(w.__agPrismMetricsResolve!==mRes)w.__agPrismMetricsResolve=mRes;
};
const clrWait=()=>{waitTm=cT(waitTm);rescTm=cT(rescTm);};
const clrSw=()=>{swTm=cT(swTm);};
const clrBurst=()=>{burstGen++;burstTm=cT(burstTm);burstIdx=0;burstBase=burstCid=null;};
const clrPoll=()=>{if(pollTm!==null){clearInterval(pollTm);pollTm=null;}};
const clrCompactWatch=()=>{try{cmpOff?.();}catch{}cmpOff=null;pickCmpAt=0;wasBusy=false;};
const isBlur=()=>{const d=gD();return!!(d?.hidden||gA(d?.documentElement,AG+'win-blur')==='1'||winBlur);};
const readAttrQuotaMode=()=>{const a=gA(gD()?.documentElement,QMODE_ATTR);return a==='both'?'both':a==='compact'?'compact':'';};
const clrBlur=()=>{try{blurOff?.();blurObs?.disconnect?.();}catch{}blurOff=blurObs=null;winBlur=pollSusp=false;};
const startPoll=()=>{
clrPoll();if(insts.size===0||mode==='off')return;
if(isBlur()){pollSusp=true;return;}
pollSusp=false;pollTm=setInterval(()=>{isBlur()?(pollSusp=true,clrPoll()):void refresh();},4000);pollTm?.unref?.();
};
const syncBlur=res=>{
if(insts.size===0||mode==='off'){clrPoll();clrBurst();pollSusp=false;return;}
if(isBlur()){pollSusp=true;clrPoll();clrBurst();return;}
const was=pollSusp;pollSusp=false;if(pollTm===null)startPoll();if(was&&res)void refresh();
};
const ensBlur=()=>{
const w=gW(),d=gD();if(!w||!d)return;
if(!blurOff&&isFn(w.addEventListener)){
const u=[on(w,'blur',()=>{winBlur=true;syncBlur(false);}),on(w,'focus',()=>{winBlur=false;syncBlur(true);}),on(d,'visibilitychange',()=>{if(!gD()?.hidden)winBlur=false;syncBlur(!gD()?.hidden);})];
blurOff=()=>{for(const f of u)f();};
}
if(!blurObs&&d.documentElement)try{blurObs=subMo('pulse-blur',d.documentElement,{childList:false,subtree:false,attributes:true,attributeFilter:[AG+'win-blur',QMODE_ATTR,AG+'theme',AG+'resizing',AG+'ignore-rm']},()=>{const b=gA(gD()?.documentElement,AG+'win-blur')==='1';if(!b)winBlur=false;syncBlur(!b);syncAllHostAttrs();const qm=readAttrQuotaMode();if(qm&&qm!==quotaMode){quotaMode=qm;for(const it of insts.values())if(it.snap||lastSnap)applySnapToInst(it,it.snap||lastSnap);}},'high');}catch{}
};
const clrSeat=()=>{clrSw();healTm=cT(healTm);try{seatObs?.disconnect?.();popOff?.();}catch{}seatObs=popOff=null;clrTier();};
const isConv=(doc,w,anc)=>{
if(!doc||anc?.closest?.('.agy-home')||qS(doc,'.agy-home, [data-testid="home-greeting"]'))return false;
const pn=w?.location?.pathname;
if(typeof pn==='string'&&pn&&!/\/c\/[0-9a-f-]{8,}/i.test(pn)&&!qS(doc,CV_S)&&!anc?.closest?.(CID_S)&&!qS(doc,CID_S))return false;
return true;
};
const findExtBars=doc=>{
if(!doc)return[];
const s=new Set(),add=e=>{if(e)s.add(e);};
try{for(const e of qA(doc,`#${BAR_ID},[id^="${BAR_ID}"],[data-ag-pulse-bar="true"]`)||[])add(e);}catch{}
add(doc.getElementById?.(BAR_ID));return[...s];
};
const purgeOrphans=doc=>{
const live=new Set();for(const it of insts.values())live.add(it.host);
for(const e of qA(doc,`[${FALLBACK_ATTR}="1"],#${PRISM_BAR_ID},[${PRISM_BAR_ATTR}]`)||[])if(!live.has(e))try{e.remove();}catch{}
};
const usableExt=(doc,b)=>!!(b&&gA(b,FALLBACK_ATTR)!=='1'&&isConn(doc,b)&&gA(b,HID_ATTR)!=='1'&&gA(b,'data-layout')!=='blocked'&&b.hidden!==true&&b.style?.display!=='none'&&(!doc?.body||(b.parentElement!==doc.body&&b.parentNode!==doc.body))&&!b.closest?.('.agy-home'));
const hasExt=(barsArg,knownConv=false)=>{
const w=gW(),doc=gD();if(!w||!doc||(!knownConv&&!isConv(doc,w)))return false;
let sawDead=false;
for(const b of barsArg||findExtBars(doc)){
if(!b||gA(b,FALLBACK_ATTR)==='1'||!isConn(doc,b)||gA(b,HID_ATTR)==='1')continue;
if(usableExt(doc,b)){detAt=0;return true;}
sawDead=true;
}
for(const e of qAll(doc,PT_SEL))if(usableExt(doc,e)){detAt=0;return true;}
if(sawDead)return false;
const sig=[w.__agPulseRuntimeOwner?String(w.__agPulseRuntimeOwner):'',w.__agPulseRuntimeBridge?'b':'',w.__agPulseInlineInstalled&&!extGuardHeld?'1':'',w.agPulseHost&&!w.agPulseHost.__prismFallback?'h':''].join('|');
if(sig!=='|||'){const now=Date.now();if(sig!==lastSig){lastSig=sig;detAt=now;return true;}if(!detAt)detAt=now;return now-detAt<GRACE_MS;}
lastSig='';detAt=0;return false;
};
const showExt=()=>{
if(extGuardHeld){extGuardHeld=false;const w=gW();if(w&&!w.__agPulseDispose)w.__agPulseInlineInstalled=false;}
for(const b of findExtBars(gD()))if(b&&gA(b,HID_ATTR)==='1'){
rA(b,HID_ATTR);const s=b.style;
if(s){if(isFn(s.removeProperty)){s.removeProperty('display');for(const[p]of HIDE_PROPS)s.removeProperty(p);}else s.opacity=s.position=s.pointerEvents='';}
}
};
const hideExt=(disposeExt=false)=>{
if(disposeExt){const w=gW();if(w){try{w.__agPulseDispose?.();}catch{}w.__agPulseInlineInstalled=true;extGuardHeld=true;}}
for(const b of findExtBars(gD()))if(b&&gA(b,FALLBACK_ATTR)!=='1'){
sA(b,HID_ATTR,'1');const s=b.style;
if(s){s.removeProperty?.('display');if(isFn(s.setProperty))for(const[p,v]of HIDE_PROPS)s.setProperty(p,v,'important');else Object.assign(s,{position:'fixed',left:'-9999px',opacity:'0',pointerEvents:'none'});}
}
};
const ensBridge=()=>{const w=gW();if(!w)return;bindHook();if(!mApi)mApi={__prismOwned:true,getMetrics:inp=>reqSnapSF(inp?.conversationId||'__bridge',inp,null,true),getLatestSnapshot:()=>lastSnap};w.__agPrismMetricsBridge=mApi;};
const rmHost=()=>{const w=gW();if(hasHost&&w?.agPulseHost?.__prismFallback)delete w.agPulseHost;hasHost=false;};
const ensHost=()=>{
const w=gW();if(!w)return;ensBridge();
if(!w.agPulseHost||!isFn(w.agPulseHost.getMetrics)){
w.agPulseHost={__prismFallback:true,getMetrics:inp=>reqSnapSF(inp?.conversationId||'__host',inp,null,true),getLatestSnapshot:()=>lastSnap,getPreferences:()=>Promise.resolve({language:resolveCurLang()}),setPreferences:v=>Promise.resolve(v||{}),report:()=>{}};
hasHost=true;
}
};
const clrHover=it=>{if(it){it.hOpenTm=cT(it.hOpenTm);it.hCloseTm=cT(it.hCloseTm);}};
const disposeInst=(it,notifyBridge=true)=>{
if(!it)return;clrHover(it);it.pinned=null;it.hoverOpen=false;detachTierRec(it);
try{if(it.xCard)it.xCard.hidden=true;if(it.sCard)it.sCard.hidden=true;if(notifyBridge)emitB(gW(),{event:'dispose',host:it.host});}catch{}
try{it.host.remove();}catch{}
if(activeHost===it.host)activeHost=null;
instByHost.delete(it.host);insts.delete(it.anc);
};
const unmountFb=(keepBridge=false)=>{
clrWait();clrSw();clrBurst();clrPoll();clrCompactWatch();clrBlur();
if(docOff){try{docOff();}catch{}docOff=null;}
if(!keepBridge){clrSeat();for(const it of pend.values()){cT(it.timer);it.onSettle?.();it.resolve(null);}pend.clear();inFlight.clear();rmHost();}
const n=insts.size;for(const it of[...insts.values()])disposeInst(it,false);
if(n)emitB(gW(),{event:'dispose'});
purgeOrphans(gD());activeHost=null;
};

const detCid=(node,multiPane=false)=>{
try{
const cid=gA(node?.closest?.(CID_S),CID_A);if(cid&&GUID_RE.test(cid))return cid;
const cv=node?.closest?.(CV_S),cvCid=gA(cv,CID_A)||gA(qS(cv,CID_S),CID_A);if(cvCid&&GUID_RE.test(cvCid))return cvCid;
if(!multiPane){const uc=extractUrlCid(gW());if(uc)return uc;}
return null;
}catch{return null;}
};
const estSnap=(node=null)=>{
const doc=gD(),sc=node?.closest?.(CV_S)||doc,now=Date.now(),c=sc?locSnaps.get(sc):null;
if(c&&now-c.at<5000)return c.snap;
let model='Gemini 4',chars=0;
try{
const tr=qS(sc,MS_S)||qS(doc,MS_S),lb=gA(tr,'aria-label')||tr?.textContent?.trim();if(lb)model=lb;
const vw=sc&&sc!==doc?sc:qS(doc,CV_S),ts=qA(vw,'[data-testid="planner-response-text"],[data-testid="agent-response"],[data-testid="user-message-bubble"]');
if(ts?.length>0){const n=Math.min(4,ts.length);let s=0;for(let i=ts.length-n;i<ts.length;i++)s+=(ts[i].textContent||'').length;chars=Math.round((s/n)*ts.length);}
else if(isStr(vw?.textContent))chars=vw.textContent.length;
}catch{}
const maxTokens=512000,usedTokens=Math.max(4200,Math.min(maxTokens,Math.round(chars/3.2)+8400));
const snap={connection:LE,speed:{model,tps:null,latestTps:null,ttftSeconds:null,rounds:0,cacheHitRate:null,totalTokens:usedTokens,context:{model,usedTokens,maxTokens,usedFraction:Math.min(.98,usedTokens/maxTokens),sampledAt:now}},groups:[]};
if(sc)locSnaps.set(sc,{at:now,snap});
return snap;
};
const getFbSnap=(cid,sc)=>(cid&&snapByCid.get(cid))||(!cid&&lastSnap)||estSnap(sc);
const reqSnap=(inp,scopeNode=null,onSettle=null,syncUi=false)=>{
const w=gW();bindHook();
const si=inp&&typeof inp==='object'?{...inp}:{};if(si.usageSync)delete si.usageSync;
const cid=isStr(si[CK])?si[CK]:null,fb=()=>getFbSnap(cid,scopeNode);
if(w&&isFn(w[METRICS_BINDING])){
return new Promise(resolve=>{
if(pend.size>=Math.max(8,insts.size*3)){onSettle?.();resolve(fb());return;}
const id=++reqSeq,timer=setTimeout(()=>{pend.delete(id);onSettle?.();resolve(fb());},si.force||si.quotaRefresh?10000:4500);
pend.set(id,{resolve,timer,cid,onSettle,syncUi});
try{w[METRICS_BINDING](JSON.stringify({id,input:si}));}
catch{cT(timer);pend.delete(id);onSettle?.();resolve(fb());}
});
}
onSettle?.();return Promise.resolve(estSnap(scopeNode));
};
const getSfMap=()=>{const w=gW();return w?(w.__agPrismMetricsInflight||=new Map()):inFlight;};
const reqSnapSF=(key,inp,scopeNode,syncUi=false)=>{
const bypass=!!(inp?.force||inp?.freshContext||inp?.quotaRefresh),sf=getSfMap(),cid=isStr(inp?.[CK])?inp[CK]:'',inc=inp?.[IK]!==false;
const k0=cid+':0',k1=cid+':1',rk=cid?(inc?k1:k0):`${key}:${inc?1:0}`;
if(!bypass){
const hk=sf.has(k1)?k1:(!inc&&sf.has(k0))?k0:sf.has(rk)?rk:'',h=hk&&sf.get(hk);
if(h)return new Promise(r=>{
let d=0,tm=null,fin=(v,del)=>{if(d)return;d=1;cT(tm);if(del&&sf.get(hk)===h)sf.delete(hk);r(v||getFbSnap(cid,scopeNode));};
tm=stTm(()=>fin(0,1),4600);
Promise.resolve(h).then(v=>fin(v,!v),()=>fin(0,1));
});
}
let settled=false,p=null;
const done=()=>{if(settled)return;settled=true;if(p&&sf.get(rk)===p)sf.delete(rk);};
p=reqSnap(inp,scopeNode,done,syncUi);
if(!settled){sf.set(rk,p);p.finally(done);}
return p;
};

const resolveCurLang=()=>{const a=gA(gD()?.documentElement,AG+'lang');return normFbLang((a&&a!=='auto'?a:'')||(expLang&&expLang!=='auto'?expLang:''),gW());};
const gStr=()=>FB_I18N[resolveCurLang()]||FB_I18N.en;
const syncLblsFor=sr=>{
if(!sr)return;const t=gStr(),ns=qA(sr,'[data-fb-i18n]')||[];
for(let i=0;i<ns.length;i++){const k=gA(ns[i],'data-fb-i18n');if(k&&isStr(t[k])&&ns[i].textContent!==t[k])ns[i].textContent=t[k];}
};
const applySnapToInst=(it,snap)=>{
if(!it?.sr||!it.host)return;
if(snap&&typeof snap==='object'){
it.snap=snap;if(it.cid)putCidSnap(it.cid,snap);
const act=resolveActiveInst();if(!lastSnap||!act||act===it)lastSnap=snap;
}
const sr=it.sr,fbEl=it.host,sp=snap?.speed||{},ctx=sp.context||{},gE=id=>sr.getElementById(id),sT=(id,v)=>{const e=gE(id),s=String(v);if(e&&e.textContent!==s)e.textContent=s;},wLvl=(e,r)=>{r<=.15?sA(e,DW,'2'):r<=.35?sA(e,DW,'1'):rA(e,DW);};
const mT=ctx.maxTokens>0?ctx.maxTokens:512000,uf=isFin(ctx.usedFraction)?Math.max(0,Math.min(1,ctx.usedFraction)):.04,uT=isFin(ctx.usedTokens)?ctx.usedTokens:Math.round(uf*mT),pct=Math.round(uf*100);
const model=ctx.model||sp.model||'Antigravity Model',tot=sp.taskUsage?.total?.totalTokens??sp.tokens?.totalTokens??sp.cache?.totalTokens??sp.totalTokens??0,hit=isFin(sp.cache?.hitRate)?sp.cache.hitRate:sp.cacheHitRate,subs=Number(sp.taskUsage?.subagents||0);
if(snap?.collection?.state==='processing')sA(fbEl,'data-collection','processing');else rA(fbEl,'data-collection');
const t=gStr();syncLblsFor(sr);
sT('rounds',sp.rounds>0?`${sp.rounds}r`:'—');sT('tps',isFin(sp.tps)&&sp.tps>0?sp.tps.toFixed(1):'—');
sT('cache-total',`${fmtTok(tot>0?tot:uT)} tok`);sT('cache-rate',isFin(hit)?`${(hit*100).toFixed(1)}%`:'—');
const sb=gE('subagent-badge');if(sb){if(subs>0){sb.hidden=false;const bt=t.agents(subs);if(sb.textContent!==bt)sb.textContent=bt;}else sb.hidden=true;}
sT('context-percent',`${pct}%`);sT('ttft',isFin(sp.ttftSeconds)?`${sp.ttftSeconds.toFixed(2)}s`:'—');
sT('latest-rate',isFin(sp.latestTps)?`${sp.latestTps.toFixed(1)} tok/s`:'—');
sT('context-summary',t.summary(pct,Math.max(0,100-pct)));sT('context-tokens',`${fmtTok(uT)} / ${fmtTok(mT)} tok`);sT('context-model',model);
const nE=gE('context-note');if(nE){nE.hidden=true;if(nE.textContent)nE.textContent='';}
const fl=gE('context-fill');if(fl?.style)fl.style.width=`${pct}%`;
gE('context-ring')?.style?.setProperty?.('--used-angle',`${Math.round(uf*360)}deg`);
const qGs=Array.isArray(snap?.groups)&&(snap.groups.length||snap.connection!==LE)?(it.lastGroups=snap.groups):it.lastGroups;
const g=qGrp(qGs,model,gW()),gn=g?.name||g?.id||'',w5=qWin(g?.windows?.['5h']||g?.fiveHour),wW=qWin(g?.windows?.weekly||g?.weekly);
let s5=!!w5,sW=!!wW;if(quotaMode!=='both'&&w5&&wW){if(wW.r<w5.r)s5=false;else sW=false;}
const setQ=(chip,id,w0,lbl,vis)=>{
if(!chip)return;
if(!w0){chip.hidden=true;rA(chip,DW);rA(chip,'title');sT(id,'—');return;}
const p=Math.round(w0.r*100),e=qEta(w0.t);
chip.hidden=!vis;sT(id,`${p}%`);wLvl(chip,w0.r);sA(chip,'title',`${gn?gn+' · ':''}${lbl} ${p}%${e?` (${e})`:''}`);
};
setQ(it.fChip,'five-balance',w5,t.fiveShort,s5);setQ(it.wChip,'week-balance',wW,t.weekShort,sW);
if(!s5&&!sW)sA(fbEl,'data-no-q','1');else rA(fbEl,'data-no-q');
sA(fbEl,'data-quota-mode',quotaMode);
for(const[id,w0]of[['context-five-quota',w5],['context-week-quota',wW]]){
const el=gE(id);if(!el)continue;
if(!w0){if(el.textContent!=='—')el.textContent='—';rA(el,DW);continue;}
const p=Math.round(w0.r*100),e=qEta(w0.t),txt=`${p}%${e?` · ${e}`:''}`;
if(el.textContent!==txt)el.textContent=txt;wLvl(el,w0.r);
}
const sR=isFin(sp.tps)&&sp.tps>0?`${sp.tps.toFixed(1)} tok/s`:isFin(sp.latestTps)&&sp.latestTps>0?`${sp.latestTps.toFixed(1)} tok/s`:'',sF=isFin(sp.ttftSeconds)?`TTFT ${sp.ttftSeconds.toFixed(2)}s`:'';
sT('context-speed',sR&&sF?`${sR} · ${sF}`:sR||sF||'—');
const cH=isFin(hit)?`${(hit*100).toFixed(1)}%`:'',cS=subs>0?t.agents(subs):'';
sT('context-cache',cH&&cS?`${cH} · ${cS}`:cH||cS||'—');
emitB(gW(),{event:'render',data:snap,host:fbEl,[CK]:it.cid});
};

const HID_ANC_SEL='.agy-home,aside,'+TI('conversation-list-sidebar')+','+TI('conversation-row-sidebar')+',[hidden],[inert]';
const isHidAnc=e=>!e||e.hidden===true||e.style?.display==='none'||!!e.closest?.(HID_ANC_SEL);
const isTopWrap=p=>{if(!p)return true;const c=String(p.className||'').trim();return!!(c&&/\bmin-w-0\b/.test(c)&&!/\b(?:flex|inline-flex|agy-composer-footer)\b/.test(c));};
const findAnchors=(doc,knownConv=false)=>{
if(!doc)return[];const w=gW();if(!knownConv&&!isConv(doc,w))return[];
const out=[],seen=new Set(),boxMap=new Map(),isFt=e=>/\bagy-composer-footer\b/.test(String(e.className||''));
for(const ft of qAll(doc,FT_SEL)){
if(!ft||seen.has(ft)||isHidAnc(ft)||(!knownConv&&!isConv(doc,w,ft)))continue;
const box=ft.closest?.(IB_S)||null;
if(box){const prev=boxMap.get(box);if(prev){if(isFt(ft)&&!isFt(prev)){const idx=out.indexOf(prev);if(idx>=0)out[idx]=ft;seen.delete(prev);seen.add(ft);boxMap.set(box,ft);}continue;}boxMap.set(box,ft);}
seen.add(ft);out.push(ft);
}
if(out.length)return out;
for(const mb of qAll(doc,MS_S)){const anc=mb?.parentElement;if(anc&&!seen.has(anc)&&!isHidAnc(mb)&&!isTopWrap(anc)&&(knownConv||isConv(doc,w,mb))){seen.add(anc);out.push(anc);}}
return out;
};
const hasAnyAnchor=(doc,knownConv=false)=>{
if(!doc)return false;const w=gW();if(!knownConv&&!isConv(doc,w))return false;
const ft=qS(doc,FT_SEL);if(ft&&!isHidAnc(ft)&&(knownConv||isConv(doc,w,ft)))return true;
const mb=qS(doc,MS_S),anc=mb?.parentElement;return!!(anc&&!isHidAnc(mb)&&!isTopWrap(anc)&&(knownConv||isConv(doc,w,mb)));
};
const seatIn=(anc,el)=>{
if(!anc||!el)return false;const k=anc.children||[];
if(/\bagy-composer-footer\b/.test(String(anc.className||''))&&k.length>=2&&isFn(anc.insertBefore)){const l=k[k.length-1];if(l&&l!==el){anc.insertBefore(el,l);return true;}}
anc.appendChild(el);return true;
};

const allChips=it=>[it.fChip,it.wChip,it.cChip,it.sChip,it.xChip];
const closeCards=(it,notify=false)=>{
if(!it)return false;clrHover(it);it.pinned=null;it.hoverOpen=false;
if((!it.xCard||it.xCard.hidden)&&(!it.sCard||it.sCard.hidden))return false;
if(it.xCard)it.xCard.hidden=true;if(it.sCard)it.sCard.hidden=true;
for(const c of allChips(it))sA(c,AE_A,'false');
if(notify)emitB(gW(),{event:'card',host:it.host,open:false});
return true;
};
const openCard=(it,card,btn,pin)=>{
if(!it||!card)return;clrHover(it);activeHost=it.host;
for(const o of insts.values())if(o!==it)closeCards(o,false);
it.sCard.hidden=it.xCard.hidden=true;
for(const c of allChips(it))sA(c,AE_A,'false');
card.hidden=false;if(btn)sA(btn,AE_A,'true');
it.pinned=pin?card:null;it.hoverOpen=!pin;void refreshInst(it);
emitB(gW(),{event:'card',host:it.host,open:true,data:it.snap||lastSnap});
};
const ensDocClick=doc=>{if(!docOff&&doc&&isFn(doc.addEventListener))docOff=on(doc,'click',ev=>{for(const it of insts.values())if(ev?.target!==it.host&&!it.host.contains?.(ev?.target))closeCards(it,true);});};
const isStaleResult=(it,reqCid,reqGen,multi)=>{
if(insts.get(it.anc)!==it||!isConn(gD(),it.host)||reqGen!==it.reqGen)return true;
if(reqCid&&it.cid&&it.cid!==reqCid)return true;
const liveCid=detCid(it.host,multi);return!!(reqCid&&liveCid&&liveCid!==reqCid);
};
const refreshInst=async it=>{
const doc=gD();if(!it||!doc||!isConn(doc,it.host)||mode==='off')return null;
const multi=insts.size>1,cid=detCid(it.host,multi);
if(cid!==it.cid){it.cid=cid;it.reqGen++;}
const reqGen=it.reqGen,snap=await reqSnapSF(cid||`__inst_${reqGen}`,{[CK]:cid,force:false,[IK]:isCardOpen(it)},it.host);
if(!isStaleResult(it,cid,reqGen,multi))applySnapToInst(it,snap);
return snap;
};

const createBarInst=(doc,anc)=>{
const E=(t,a,k)=>mk(doc,t,a,k),host=E('div',HOST_ATTRS);
if(!isFn(host.attachShadow))return null;
const sr=host.attachShadow({mode:'open'});sr.appendChild(E('style',{text:SHADOW_CSS}));
const t0=gStr(),btn=(c,k,ex)=>E('button',{type:'button',cls:'chip','data-card':c,...ex},k),dl=rows=>E('dl',null,rows.flatMap(([k,id])=>[E('dt',{'data-fb-i18n':k,text:t0[k]}),E('dd',{id,text:'—'})]));
const qChip=(k,k2,id)=>btn(k,[E('span',{'data-i18n':k,'data-fb-i18n':k2,text:t0[k2]}),E('strong',{id,text:'—'})],{[AE_A]:'false',hidden:true});
const fChip=qChip('five','fiveShort','five-balance'),wChip=qChip('week','weekShort','week-balance'),
sChip=btn('speed',[E('span',{cls:'rounds dim',id:'rounds',text:'—'}),E('strong',{id:'tps',text:'—'}),E('span',{cls:'dim',text:'tok/s'})]),
cChip=btn('cache',[E('span',{cls:'cache-total',id:'cache-total',text:'—'}),E('span',{cls:'sub-badge',id:'subagent-badge',hidden:true,text:''}),E('span',{cls:'dim',text:'·'}),E('span',{'data-i18n':'cache','data-fb-i18n':'cache',text:t0.cache}),E('strong',{id:'cache-rate',text:'—'})],{[AE_A]:'false'}),
xChip=btn('context',[E('span',{cls:'context-ring',id:'context-ring'}),E('span',{cls:'context-label dim','data-i18n':'contextShort',text:'Ctx'}),E('strong',{id:'context-percent',text:'0%'})],{[AE_A]:'false'}),
sCard=E('section',{cls:'card',id:'speed-card',hidden:true},[E('div',{cls:'heading'},[E('span',{'data-fb-i18n':'speedHeading',text:t0.speedHeading})]),dl([['ttft','ttft'],['latestRate','latest-rate']])]),
xCard=E('section',{cls:'card context-card',id:'context-card',hidden:true},[E('div',{cls:'heading'},[E('span',{'data-fb-i18n':'ctxHeading',text:t0.ctxHeading})]),E('strong',{id:'context-summary',text:t0.summary(0,100)}),E('p',{id:'context-tokens',text:'— / 512K tok'}),E('div',{cls:'track',id:'context-track'},[E('i',{id:'context-fill'})]),dl([['curModel','context-model'],['fiveQuota','context-five-quota'],['weekQuota','context-week-quota'],['speedHeading','context-speed'],['cache','context-cache']]),E('p',{cls:'footnote',id:'context-note',hidden:true,text:''})]);
sr.appendChild(E('div',{cls:'bar'},[fChip,wChip,sChip,cChip,xChip]));sr.appendChild(sCard);sr.appendChild(xCard);

const it={...mkTier(anc,host),sr,fChip,wChip,sChip,cChip,xChip,sCard,xCard,pinned:null,hoverOpen:false,hOpenTm:null,hCloseTm:null,cid:null,snap:null,lastGroups:null,reqGen:0};
const markAct=()=>{activeHost=host;};on(host,'pointerdown',markAct);on(host,'focusin',markAct);
const tog=(card,b)=>{if(!card.hidden&&it.pinned===card)closeCards(it,true);else openCard(it,card,b,true);};
const onEnter=b=>{it.hCloseTm=cT(it.hCloseTm);if(!it.pinned&&xCard.hidden&&it.hOpenTm===null&&mode!=='off')it.hOpenTm=stTm(()=>{it.hOpenTm=null;if(mode!=='off'&&isConn(gD(),it.host)&&!it.pinned&&xCard.hidden)openCard(it,xCard,b,false);},HOVER_OPEN_MS);};
const onLeave=()=>{it.hOpenTm=cT(it.hOpenTm);if(!it.pinned&&it.hoverOpen&&!xCard.hidden&&it.hCloseTm===null)it.hCloseTm=stTm(()=>{it.hCloseTm=null;if(!it.pinned&&it.hoverOpen&&!xCard.hidden)closeCards(it,true);},HOVER_CLOSE_MS);};
const onCardEnter=()=>{it.hCloseTm=cT(it.hCloseTm);};
const onCardDown=()=>{if(it.hoverOpen&&!xCard.hidden){clrHover(it);it.pinned=xCard;it.hoverOpen=false;}};
for(const c of allChips(it)){for(const ev of['pointerenter','mouseenter'])on(c,ev,()=>onEnter(c));for(const ev of['pointerleave','mouseleave'])on(c,ev,onLeave);on(c,'click',e=>{e?.stopPropagation?.();tog(c===sChip?sCard:xCard,c);});}
for(const ev of['pointerenter','mouseenter'])on(xCard,ev,onCardEnter);for(const ev of['pointerleave','mouseleave'])on(xCard,ev,onLeave);on(xCard,'pointerdown',onCardDown);

seatIn(anc,host);insts.set(anc,it);instByHost.set(host,it);syncHostAttrs(host);attachTierRec(it);
const initCid=detCid(host,insts.size>1);
if(initCid){it.cid=initCid;const cached=getCidSnap(initCid);if(cached)applySnapToInst(it,cached);}
return it;
};

const reconcileBars=doc=>{
const w=gW();if(!doc||!w)return{mounted:false,added:[],reseated:[]};
const anchors=findAnchors(doc,true),ancSet=new Set(anchors);
for(const[anc,it]of[...insts.entries()])if(!ancSet.has(anc)||!isConn(doc,anc))disposeInst(it,true);
const added=[],reseated=[];
for(const anc of anchors){
const ex=insts.get(anc);
if(ex){if(!isConn(doc,ex.host)||ex.host.parentElement!==anc)try{seatIn(anc,ex.host);reseated.push(ex);}catch{}attachTierRec(ex);}
else{const cr=createBarInst(doc,anc);if(cr)added.push(cr);}
}
syncPrimaryId();purgeOrphans(doc);
if(insts.size){clrExtTiers();ensDocClick(doc);ensCompactWatch(doc);yielded=false;}else{if(docOff){try{docOff();}catch{}docOff=null;}clrCompactWatch();clrBurst();clrPoll();}
for(const x of added)emitB(w,{event:'mount',host:x.host});
for(const x of reseated)emitB(w,{event:'mount',host:x.host});
return{mounted:insts.size>0,added,reseated};
};

const isHcPortal=el=>{
if(!el||el.tagName==='BODY'||el.tagName==='HTML')return false;
const h=(n,k)=>!!n?.hasAttribute?.(k),f=el.firstElementChild;
return h(el,HC_A)||h(f,HC_A)||h(f?.firstElementChild,HC_A)||(h(el,'data-base-ui-portal')&&!!qS(el,'['+HC_A+']'));
};
const isIgnoredStreamNode=t=>{const el=t?.nodeType===1?t:t?.parentElement;return!!(el&&(isHcPortal(el)||(el.closest&&!el.closest(FT_SEL)&&el.closest(IGN_STREAM_SEL))));};
const anchorsChanged=doc=>{
const ancs=findAnchors(doc,true);if(ancs.length!==insts.size)return true;
for(const a of ancs){const it=insts.get(a);if(!it||!isConn(doc,it.host)||it.host.parentElement!==a)return true;}
return false;
};

const readBoxText=n=>{const b=n?.closest?.(IB_S),ed=(b&&qS(b,'[contenteditable="true"],textarea,input'))||n;return String(ed?.value??ed?.innerText??ed?.textContent??'').replace(/\u200B/g,'').trim();};
const hasBusyBtn=doc=>{const e=qS(doc,BUSY_SEL);return!!(e&&e.hidden!==true&&e.style?.display!=='none');};
const isCompactedDrop=(b,s)=>{
const x=s?.speed?.context;if(!x||s?.connection===LE)return false;
const u=isFin(x.usedTokens)?x.usedTokens:null,f=isFin(x.usedFraction)?x.usedFraction:null,c=!!(x.compacted||x.estimatedAfterCompaction);
return(c&&(!b||!b.c||(u!==null&&b.u!==null&&u<b.u*.85)))||(b&&b.u>0&&u!==null&&u<b.u*.72)||!!(b&&b.f>.15&&f!==null&&f<b.f-.12);
};
const armCompactBurst=(sc=null,cidH=null,ds=null)=>{
if(mode==='off'||isBlur()||!insts.size)return false;
const bar=sc?getBarForView(sc):null,ins=(bar&&instByHost.get(bar))||resolveActiveInst();
const cid=(isStr(cidH)&&GUID_RE.test(cidH)?cidH:null)||detCid(sc||ins?.host,insts.size>1)||ins?.cid||null;
const p=ins?.snap?.speed?.context||(cid&&snapByCid.get(cid)?.speed?.context)||lastSnap?.speed?.context,seq=ds?.length?ds:BURST_STEPS;
clrBurst();const gen=burstGen;burstCid=cid;
burstBase=p?{u:isFin(p.usedTokens)?p.usedTokens:null,f:isFin(p.usedFraction)?p.usedFraction:null,c:!!(p.compacted||p.estimatedAfterCompaction)}:null;
const tick=()=>{
if(gen!==burstGen)return;
burstTm=null;if(mode==='off'||isBlur()||!insts.size)return clrBurst();
const tg=burstCid;
void refresh({immediate:true,freshContext:true,cascadeId:tg}).then(s=>{
if(gen!==burstGen||burstCid!==tg)return;
if(isCompactedDrop(burstBase,s)||burstIdx>=seq.length)return clrBurst();
burstTm=stTm(tick,seq[burstIdx++]);
}).catch(()=>{if(gen===burstGen)clrBurst();});
};
burstTm=stTm(tick,seq[burstIdx++]);return true;
};
const ensCompactWatch=doc=>{
const w=gW();if(cmpOff||!doc||mode==='off')return;
wasBusy=hasBusyBtn(doc);
const hitPick=()=>pickCmpAt&&Date.now()-pickCmpAt<4000;
const u=[
on(doc,'keydown',ev=>{if(mode!=='off'&&ev?.key==='Enter'&&!ev.shiftKey&&!ev.ctrlKey&&!ev.altKey&&!ev.metaKey&&!ev.isComposing){const t=ev.target;if(t?.closest?.(IB_S+',[contenteditable="true"],textarea')){const x=readBoxText(t);if(CMP_RE.test(x)||(hitPick()&&(!x||CMP_RE.test(x)))){pickCmpAt=0;armCompactBurst(t);}}}},true),
on(doc,'click',ev=>{const t=ev?.target;if(mode==='off'||!t?.closest)return;const o=t.closest(SLASH_OPT_SEL);if(o&&/^\s*\/?compact(?:\s|$)/i.test(String(o.textContent||''))){pickCmpAt=Date.now();armCompactBurst(t,null,[700,1100,1500,2000]);return;}const b=t.closest(SEND_SEL);if(b&&(CMP_RE.test(readBoxText(b))||hitPick())){pickCmpAt=0;armCompactBurst(b);}},true),
on(w,'ag-prism:compact',ev=>{if(mode!=='off')armCompactBurst(null,ev?.detail?.conversationId||null,ev?.detail?.delays||null);}),
];
cmpOff=()=>{for(const f of u)f();};
};

const schedSwitchRefresh=tCid=>{clrPoll();clrSw();clrBurst();swTm=stTm(()=>{swTm=null;if(mode!=='off'&&insts.size)void refresh({immediate:true,cascadeId:tCid}).finally(()=>{if(insts.size&&mode!=='off'&&!isBlur())startPoll();});},SW_DEBOUNCE_MS);};
const checkConvSwitch=(doc,w,fromRoute=false)=>{
const cH=readRouteKey(w),uCh=cH!==lastHref,cUc=extractUrlCid(w),ucCh=!!(cUc&&cUc!==lastUrlCid);
if(uCh)lastHref=cH;if(cUc)lastUrlCid=cUc;
if(!insts.size)return false;
const multi=insts.size>1;let sw=false,tCid=null;
for(const it of insts.values()){
if(!isConn(doc,it.host))continue;
const nCid=!multi&&(fromRoute||ucCh)&&cUc?cUc:detCid(it.host,multi);
if(nCid!==it.cid){sw=true;tCid=nCid;it.cid=nCid;it.reqGen++;const c=nCid?getCidSnap(nCid):null;if(c)applySnapToInst(it,c);}
else if(fromRoute&&uCh){sw=true;tCid=nCid;it.reqGen++;}
}
if(sw)schedSwitchRefresh(tCid);
return sw;
};

const ensSeatObs=()=>{
const w=gW(),doc=gD();if(!w||!doc||mode==='off')return;
if(!lastHref)lastHref=readRouteKey(w);if(!lastUrlCid)lastUrlCid=extractUrlCid(w)||'';
const runHeal=()=>{
healTm=null;lastHealAt=Date.now();if(mode==='off')return;
const d=gD(),wn=gW();if(!d||!wn)return;
if(!isConv(d,wn)){yielded=false;if(insts.size)unmountFb(true);hideExt(false);return;}
if(mode==='on')hideExt(true);else{showExt();if(hasExt(null,true)){yielded=true;if(insts.size)unmountFb(true);ensTierObs();return;}}
if(insts.size){const res=reconcileBars(d),sw=checkConvSwitch(d,wn,false);if(res.added.length&&!sw)void refresh();else if(insts.size)ensTierObs();}
else if((mode==='on'||waitTm===null)&&findAnchors(d,true).length)mountFb();
};
const schedHeal=(fast=false)=>{if(mode!=='off'&&healTm===null)healTm=stTm(runHeal,fast||Date.now()-lastHealAt>=180?45:180);};
if(!seatObs&&(doc.body||doc.documentElement)){
seatObs=subMo('pulse-seat',doc.body||doc.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:[CID_A]},recs=>{
if(mode==='off')return;
if(Array.isArray(recs)&&recs.length){
const ignAll=l=>{if(l)for(let j=0;j<l.length;j++)if(!isIgnoredStreamNode(l[j]))return false;return true;};
let rel=false;
for(const r of recs){const a=r?.addedNodes,rm=r?.removedNodes;if(r?.type==='attributes'&&r?.attributeName===CID_A){rel=true;break;}if(isIgnoredStreamNode(r?.target)||(((a?.length||0)+(rm?.length||0))&&ignAll(a)&&ignAll(rm)))continue;rel=true;break;}
if(!rel)return;
}
const inC=isConv(doc,w);let bars=null;
const gB=()=>bars||(bars=findExtBars(doc)),visB=b=>b&&gA(b,HID_ATTR)!=='1';
if(!inC){if(insts.size||gB().some(visB))schedHeal(true);return;}
if(insts.size){
if(mode==='auto'&&hasExt(gB(),true)){schedHeal(true);return;}
const nowB=hasBusyBtn(doc);
if(wasBusy&&!nowB){wasBusy=false;armCompactBurst(null,null,[180,650,1100]);}else wasBusy=nowB;
const sw=checkConvSwitch(doc,w,false);if(anchorsChanged(doc)){schedHeal(sw);return;}if(sw)return;
}else if(waitTm===null&&!hasExt(gB(),true)&&hasAnyAnchor(doc,true)){schedHeal(true);return;}
if(healTm!==null)return;
const extMissingTier=gB().some(b=>visB(b)&&b.shadowRoot&&!qS(b.shadowRoot,`style[${TIER_STYLE_ATTR}="1"]`));
let deadExt=false;for(const anc of extTiers.keys())if(!isConn(doc,anc)){deadExt=true;break;}
if(deadExt||extMissingTier||(mode==='on'&&gB().some(b=>visB(b)&&gA(b,FALLBACK_ATTR)!=='1')))schedHeal(false);
},'low');
}
if(!popOff){
const onRoute=()=>{if(mode==='off')return;const d=gD(),wn=gW();if(!d||!wn)return;if(!isConv(d,wn)||!insts.size){schedHeal(true);return;}checkConvSwitch(d,wn,true);if(anchorsChanged(d))schedHeal(true);};
const offs=[isFn(w.addEventListener)?on(w,'popstate',onRoute):null,isFn(w.addEventListener)?on(w,'hashchange',onRoute):null,subHistory(w,onRoute)].filter(Boolean);
if(offs.length)popOff=()=>{for(const f of offs)try{f();}catch{}};
}
};

async function refresh(opts){
const w=gW(),doc=gD();
if(!envOpts&&w?.__agPrismTelemetry&&w.__agPrismTelemetry!==api){unmountFb();return null;}
if(!isConv(doc,w)){yielded=false;unmountFb(true);if(mode!=='off')hideExt();return null;}
if(mode==='on')hideExt(true);else{showExt();if(hasExt(null,true)){yielded=true;unmountFb(true);ensTierObs();return null;}}
if(mode!=='off'&&(insts.size||((mode==='on'||!hasExt(null,true))&&waitTm===null&&findAnchors(doc,true).length)))reconcileBars(doc);
if(!insts.size)return null;
if(opts?.immediate)clrSw();
ensTierObs();
const live=[...insts.values()].filter(it=>isConn(doc,it.host));if(!live.length)return null;
wasBusy=hasBusyBtn(doc);
const multi=live.length>1,force=!!opts?.force,fc=!!opts?.freshContext,hCid=!multi&&isStr(opts?.cascadeId)&&GUID_RE.test(opts.cascadeId)?opts.cascadeId:null;
const reqByKey=new Map(),plan=[];
for(let i=0;i<live.length;i++){
const it=live[i],nCid=hCid||detCid(it.host,multi);
if(nCid!==it.cid){it.cid=nCid;it.reqGen++;const c=nCid?getCidSnap(nCid):null;if(c)applySnapToInst(it,c);}
else if(fc)it.reqGen++;
const key=it.cid||`__pane_${i}`;
plan.push({it,reqCid:it.cid,reqGen:it.reqGen,key});
if(!reqByKey.has(key))reqByKey.set(key,reqSnapSF(key,{[CK]:it.cid,force,[IK]:isCardOpen(it),...(fc?{freshContext:true}:{})},it.host));
}
const snaps=new Map();
await Promise.all([...reqByKey.entries()].map(async([k,p])=>{snaps.set(k,await p);}));
let actSnap=null;const act=resolveActiveInst();
for(let i=0;i<plan.length;i++){
const{it,reqCid,reqGen,key}=plan[i],snap=snaps.get(key)||null;
if(isStaleResult(it,reqCid,reqGen,multi))continue;
applySnapToInst(it,snap);if(it===act||(!act&&i===0))actSnap=snap;
}
return actSnap??lastSnap;
}

function mountFb(){
const w=gW(),doc=gD();
if(!w||!doc||(typeof doc.attachShadow==='undefined'&&!isFn(doc.createElement)))return false;
if(!envOpts&&w.__agPrismTelemetry&&w.__agPrismTelemetry!==api){unmountFb();return false;}
if(mode==='off')return false;
if(!isConv(doc,w)){yielded=false;unmountFb(true);hideExt();ensSeatObs();return false;}
if(mode==='on')hideExt(true);else if(hasExt(null,true)){yielded=true;unmountFb(true);ensSeatObs();return false;}
const res=reconcileBars(doc);ensSeatObs();if(!res.mounted)return false;
ensHost();ensTierObs();ensBlur();lastHref=readRouteKey(w);lastUrlCid=extractUrlCid(w)||'';
if(res.added.length||pollTm===null){void refresh();startPoll();}
return true;
}

const getBars=()=>{const doc=gD(),out=[];for(const it of insts.values())if(isConn(doc,it.host))out.push(it.host);return out;};
const getBarForView=node=>{
const doc=gD();if(!node||!doc)return null;
const d=instByHost.get(node);if(d&&isConn(doc,d.host))return d.host;
const sel=CV_S+','+IB_S+',.agy-composer-footer',cv=node.matches?.(sel)?node:node.closest?.(sel);
if(cv){
for(const it of insts.values())if(isConn(doc,it.host)&&(cv===it.anc||cv.contains?.(it.anc)||it.anc.contains?.(cv)))return it.host;
const ext=qS(cv,`#${BAR_ID},[data-ag-pulse-bar="true"]`);if(ext&&usableExt(doc,ext))return ext;
}
return null;
};
const setActiveBar=target=>{
const doc=gD();if(!target){activeHost=null;return null;}
const h=instByHost.has(target)?target:getBarForView(target);if(!h||!isConn(doc,h))return null;
activeHost=h;emitB(gW(),{event:'focus',host:h,data:instByHost.get(h)?.snap||lastSnap});return h;
};
const getSnapshotForBar=x=>{
if(!x)return resolveActiveInst()?.snap||lastSnap;
if(isStr(x))return snapByCid.get(x)||lastSnap;
const it=instByHost.get(x)||instByHost.get(getBarForView(x));
return it?.snap||(it?.cid&&snapByCid.get(it.cid))||lastSnap;
};
const getState=()=>{
const doc=gD();let n=0;for(const it of insts.values())if(isConn(doc,it.host))n++;
const m=n>0,bl=isBlur();if(m&&bl&&pollTm!==null){pollSusp=true;clrPoll();}
return{mode,quotaMode,mountedFallback:m,mountedCount:n,waitingForExternal:waitTm!==null,yieldedToExternal:!!(mode==='auto'&&(yielded||hasExt())),hasExternal:hasExt(),pollSuspended:!!(m&&(pollSusp||bl))};
};

function sync(cfg){
if(cfg&&isStr(cfg.language)&&cfg.language)expLang=cfg.language.trim().toLowerCase()==='auto'?'':normFbLang(cfg.language,gW());
if(cfg&&Object.hasOwn(cfg,'telemetryQuotaMode'))quotaMode=cfg.telemetryQuotaMode==='both'?'both':'compact';
else{const aQm=readAttrQuotaMode();if(aQm)quotaMode=aQm;}
const raw=cfg?.telemetryModule;mode=raw==='on'||raw==='off'?raw:'auto';
if(insts.size&&mode!=='off')for(const it of insts.values()){syncLblsFor(it.sr);if(it.snap||lastSnap)applySnapToInst(it,it.snap||lastSnap);}
if(mode==='off'){yielded=false;unmountFb();hideExt();return getState();}
ensBridge();ensSeatObs();
const doc=gD(),w=gW();
if(!isConv(doc,w)){yielded=false;unmountFb(true);hideExt();ensHost();return getState();}
if(mode==='on'){yielded=false;clrWait();hideExt(true);ensHost();mountFb();return getState();}
showExt();
if(hasExt()){
yielded=true;unmountFb(true);ensHost();ensTierObs();
if(detAt>0&&rescTm===null)rescTm=stTm(()=>{rescTm=null;if(mode!=='off'&&!hasExt())mountFb();},GRACE_MS+60);
return getState();
}
if(insts.size){reconcileBars(doc);if(insts.size)return getState();}
if(findExtBars(doc).some(b=>b&&gA(b,FALLBACK_ATTR)!=='1'&&isConn(doc,b)&&!usableExt(doc,b))){clrWait();mountFb();return getState();}
if(waitTm===null)waitTm=stTm(waitTimerDone,isFin(cfg?.__fallbackDelayMs)&&cfg.__fallbackDelayMs>=0?cfg.__fallbackDelayMs:WAIT_MS);
return getState();
}
function waitTimerDone(){
waitTm=null;if(mode!=='auto')return;
if(!isConv(gD(),gW())){unmountFb(true);hideExt();return;}
if(hasExt()){yielded=true;unmountFb(true);ensHost();ensTierObs();return;}
mountFb();
}
function destroy(){
clrWait();clrSw();clrBurst();clrCompactWatch();clrSeat();unmountFb();showExt();snapByCid.clear();inFlight.clear();
const w=gW();if(w){if(mApi&&w.__agPrismMetricsBridge===mApi)delete w.__agPrismMetricsBridge;if(mRes&&w.__agPrismMetricsResolve===mRes)delete w.__agPrismMetricsResolve;}
yielded=false;lastSig='';detAt=0;lastSnap=null;lastHref='';lastUrlCid='';
}

const notifyCompact=(cid=null,delays=null)=>armCompactBurst(null,cid,delays);
const api={BAR_ID,PRISM_BAR_ID,PRISM_BAR_ATTR,FALLBACK_ATTR,METRICS_BINDING,sync,destroy,refresh,notifyCompact,chooseQuotaGroupFallback,getLatestSnapshot:()=>resolveActiveInst()?.snap||lastSnap,getSnapshotForBar,getBars,getPrimaryBar:()=>getPrimaryInst()?.host||null,getActiveBar:()=>resolveActiveInst()?.host||null,setActiveBar,getBarForView,getState,createTelemetryController};
return api;
}

return createTelemetryController();
});
