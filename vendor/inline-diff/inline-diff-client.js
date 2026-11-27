// Channel 6 Inline Diff Client (vendor/inline-diff/inline-diff-client.js)
(function(root){
'use strict';
const G=root||(typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:null);
if(!G)return;

const INLINE_DIFF_STYLE_ID = 'ag-prism-inline-diff-css';
const PORTAL_ID='ag-prism-overlay-portal',MAX_PENDING=32,TIMEOUT_MS=5500,CACHE_MAX=32,CACHE_TTL=15000,NEG_TTL=8000,MAX_BYTES=196608,MAX_LINE_CHARS=240,MAX_CLIENT_LINES=1200,PREVIEW_LIMIT=120;
const DET_ERR_RE=/^(?:not_found|blocked|outside_git_repo|invalid_uri|not_a_file|binary)/i;

// Strictly pure ASCII, 0 :has(), balanced braces, zero pseudo-elements inside :is()
const INLINE_DIFF_CSS=[
'@keyframes ag-cs-diff-unfold{from{opacity:0;transform:translate3d(0,-5px,0) scaleY(.97);}to{opacity:1;transform:translate3d(0,0,0) scaleY(1);}}',
'@keyframes ag-cs-diff-fold{from{opacity:1;transform:translate3d(0,0,0) scaleY(1);}to{opacity:0;transform:translate3d(0,-4px,0) scaleY(.97);}}',
'@keyframes ag-cs-diff-pulse{0%,100%{opacity:.45;}50%{opacity:.95;}}',
'@keyframes ag-cs-diff-in{from{opacity:0;transform:translate3d(0,-3px,0);}to{opacity:1;transform:translate3d(0,0,0);}}',
'$H{',
'& $Cbody{&::-webkit-scrollbar{width:4px;height:4px;display:block;}&::-webkit-scrollbar-track{$Z$T;}&::-webkit-scrollbar-thumb{$Z$T;$R999px;}&:hover::-webkit-scrollbar-thumb{$Zvar(--_s8,$W.18));&:hover{$Zvar(--_s9,$W.32));}}}',
'& [data-testid="autoscroll-viewport"] .bleed-contain $Cbody{$J-right:14px$I;$P-right:8px$I;overscroll-behavior-y:auto$I;}',
'& [data-testid="autoscroll-viewport"] .bleed-contain .overflow-y-auto $Cbody{$J-right:12px$I;overscroll-behavior-y:auto$I;}',
'& [data-ag-diff-chip-row="1"]{overflow-y:visible$I;}',
'& [data-ag-diff-chip="1"]{$K$I;$A$I;gap:7px$I;min-height:22px$I;$P:1px 5px$I;$J:0 -2px$I;$R4px$I;$Z$T$I;border:1px solid $T$I;$Snone$I;cursor:pointer$I;$Ovisible$I;$Nbackground-color 130ms ease,box-shadow 130ms ease$I;&:hover{$B$W.048)$I;& [data-ag-diff-chip-file="1"]{text-decoration-color:$W.36)$I;}}&[data-ag-inline-diff-open="1"]{$B$W.065)$I;$Sinset 0 -1px 0 $W.22)$I;& [data-ag-diff-chip-file="1"]{text-decoration-color:$T$I;}}& [data-ag-diff-chip-file="1"],& [data-ag-diff-chip-file="1"] :is([data-testid="entity-pill"],.inline-pill){$Z$T$I;$Ycolor:$T$I;$Snone$I;$P:0$I;$J:0$I;color:$G$I;font-weight:500;}& [data-ag-diff-chip-file="1"]{text-decoration:underline;text-decoration-color:$W.16);text-underline-offset:3px;text-decoration-thickness:1px;$Ntext-decoration-color 130ms ease;}& [data-testid="diff-line-count"]{$Z$T$I;border:0$I;$Snone$I;$P:0$I;$J:0$I;gap:5px$I;font-size:11.5px$I;font-weight:500;&::before{display:none$I;}}}',
'& [data-testid="diff-line-count"]{$K;$A;gap:4px;$Rvar(--ag-cs-r-sm)$I;border:1px solid $T;$P:1px 5px$I;font-family:var(--ag-cs-mono-stack);font-size:11px;font-variant-numeric:tabular-nums;$Nbackground-color 130ms ease,border-color 130ms ease,color 130ms ease$I;& [data-ag-diff-stat="add"]{color:#5CE68B$I;text-shadow:0 0 9px rgba(74,222,128,.42);}& [data-ag-diff-stat="del"]{color:#FF857D$I;text-shadow:0 0 9px rgba(248,113,113,.40);}& [data-ag-diff-stat="zero"]{color:$W.28)$I;text-shadow:none$I;}}',
'& $Cbox{display:block;$X;width:100%;min-width:0;max-width:100%;$Ohidden;align-self:stretch;$J:0;$P:0;transform-origin:50% 0%;contain:layout style;&[data-ag-diff-anim="1"]{will-change:transform,opacity;animation:ag-cs-diff-unfold 150ms var(--ag-ease-out,cubic-bezier(.16,1,.3,1)) both;}&[data-ag-diff-state="closing"]{will-change:transform,opacity;pointer-events:none;animation:ag-cs-diff-fold 120ms cubic-bezier(.32,0,.67,0) forwards;}&[data-ag-diff-expanded="1"] $Cbody{max-height:540px;}}',
'& $Ccard{position:relative;display:flex;flex-direction:column;$X;width:100%;min-width:0;max-width:100%;$J:6px 0 12px;$P:0;$R10px;border:1px solid $W.085);$Brgba(10,11,14,.92);background-image:radial-gradient(85% 52px at 50% 0%,$W.042),$T);$Sinset 0 1px 0 $W.095),0 14px 34px -12px rgba(0,0,0,.64);$Ohidden;&:hover $Cfloat-acts{opacity:1;}}',
'& $Ctop{display:flex;$A;justify-content:space-between;gap:10px;flex:none;$X;width:100%;min-width:0;min-height:30px;$P:5px 8px 5px 12px;$E:1px solid $W.07);$Zlinear-gradient(180deg,$W.032),$W.01));&.is-compact{min-height:26px;$P:3px 8px 3px 12px;justify-content:flex-end;$E-color:$W.045);$Z$W.012);& $Cfloat-acts{opacity:.58;}}}',
'& $Cnote{flex:1 1 auto;min-width:0;$P:0;$J:0;$F;font-size:11px;line-height:1.45;$M;opacity:.88;white-space:normal;word-break:break-word;}',
'& $Cfloat-acts{position:static;flex:none;$J-left:auto;$K;$A;gap:2px;$P:2px;$R6px;$Zrgba(12,14,18,.68);border:1px solid $W.08);$Sinset 0 1px 0 $W.07);opacity:.78;$Nopacity 140ms ease;&:focus-within{opacity:1;}}',
'& $Cact-btn{appearance:none;$K;$A;justify-content:center;width:22px;height:22px;$P:0;border:0;$R4px;$Z$T;$M;cursor:pointer;$Nbackground-color 110ms ease,color 110ms ease;& svg{width:12px;height:12px;}&:hover{$B$W.10);color:$G;}}',
'& $Cbody{flex:1 1 auto;min-height:0;width:100%;max-width:100%;min-width:0;$X;max-height:360px;$Oauto;scrollbar-width:thin;scrollbar-color:$W.16) $T;$P:6px 0;font-family:var(--ag-cs-mono-stack);font-size:12px;line-height:1.62;tab-size:2;scroll-behavior:smooth;}',
'& $Cwrap-tag{$K;$A;height:15px;$P:0 5px;$J:auto 12px auto 4px;$R3px;$Z$W.05);border:1px solid $W.09);$M;$F;font-size:10px;line-height:1;flex-shrink:0;}',
'& $Cstep-tag{position:sticky;left:54px;z-index:1;$K;$A;height:16px;$P:0 6px;$J:0 6px 0 10px;$R999px;$Z$U.15);border:1px solid $U.36);color:#93C5FD;$F;font-size:10px;font-weight:500;line-height:1;flex-shrink:0;}',
'& $Cfocus-sep{display:flex;$A;min-width:100%;width:max-content;height:22px;$J:0 0 2px;$B$U.065);$E:1px solid $U.22);}& :is($Cfocus-sep,$Cline.is-hunk.is-focus-sep){& $Cln{height:100%;$K;$A;justify-content:center;$Brgba(18,26,42,.96);color:$Q.86);$Sinset 2px 0 0 #60A5FA;$P:0 8px;}& $Cgap-rule{$Zlinear-gradient(90deg,$U.32),$U.04));}}',
'& $Cmore-bar{appearance:none;display:flex;$A;justify-content:center;width:100%;$P:6px 12px 3px;$J-top:4px;border:0;$Ytop:1px solid $W.06);$Z$T;$M;$F;font-size:11px;cursor:pointer;$Ncolor 120ms ease,background-color 120ms ease;&:hover{color:$G;$B$W.028);}&:disabled{opacity:.6;cursor:wait;}}',
'& $Cline{display:flex;align-items:stretch;min-width:100%;width:max-content;$X;white-space:pre;color:color-mix(in srgb,var(--secondary-foreground) 86%,$T);&:is(.is-add,.is-del) $Csign{font-weight:600;opacity:1;&.is-cont{opacity:.42;font-weight:400;text-shadow:none$I;}}&.is-add{$Zlinear-gradient(90deg,rgba(46,184,92,.16) 0%,rgba(46,184,92,.09) 42%,rgba(46,184,92,.045) 100%)$I;color:$G;& $Cln{$Brgba(18,44,28,.96);color:rgba(134,239,172,.88);$Sinset 2px 0 0 #4ADE80,inset 7px 0 12px -4px rgba(74,222,128,.34);}& $Csign{color:#6EE7B7$I;text-shadow:0 0 9px rgba(74,222,128,.62),0 0 2px rgba(167,243,208,.45);}}&.is-del{$Zlinear-gradient(90deg,rgba(239,68,68,.15) 0%,rgba(239,68,68,.085) 42%,rgba(239,68,68,.04) 100%)$I;color:color-mix(in srgb,$G 92%,$T);& $Cln{$Brgba(48,20,24,.96);color:rgba(252,165,165,.88);$Sinset 2px 0 0 #F87171,inset 7px 0 12px -4px rgba(248,113,113,.32);}& $Csign{color:#FCA5A5$I;text-shadow:0 0 9px rgba(248,113,113,.60),0 0 2px rgba(254,202,202,.42);}}&.is-hunk{$A;height:22px;$J:3px 0;$B$W.022);$Ytop:1px solid $W.05);$E:1px solid $W.05);& $Cln{height:100%;$K;$A;justify-content:center;$Brgba(14,15,19,.96);color:$W.40);$P:0 8px;}&.is-focus-sep{$B$U.075);$Ytop-color:$U.26);$E-color:$U.22);}}&.is-focus{&.is-ctx{$B$U.055);& $Cln{$Brgba(18,24,38,.96);color:$Q.74);$Sinset 2px 0 0 $U.68);}}&.is-focus-start{$Sinset 0 1px 0 $U.26);}&.is-focus-end{$Sinset 0 -1px 0 $U.22);}}}',
'& $Cgap-rule{flex:1 1 auto;height:1px;$J:0 16px;$Zlinear-gradient(90deg,$W.09),$W.02));pointer-events:none;}',
'& $Cln{position:sticky;left:0;z-index:1;flex:none;width:46px;$X;$P:0 10px 0 8px;text-align:right;$Brgba(12,13,17,.96);$Yright:1px solid $W.06);color:$W.36);user-select:none;font-variant-numeric:tabular-nums;font-size:11px;}',
'& $Csign{flex:none;width:22px;text-align:center;user-select:none;opacity:.76;}& $Ccode{flex:1 1 auto;min-width:0;$P:0 16px 0 2px;}',
'& $Cloading{display:flex;$A;gap:10px;height:30px;$P:0 14px;$F;font-size:11.5px;$M;&::before{content:"";width:38px;height:2.5px;$R999px;$Zcolor-mix(in srgb,var(--primary) 46%,var(--ag-cs-border-2));animation:ag-cs-diff-pulse 1.2s ease-in-out infinite;}}',
'& $Cempty{$P:10px 14px;$F;font-size:12px;line-height:1.5;$M;}',
'& $Dmenu{position:fixed;z-index:9999;min-width:184px;$P:4px;$R10px;$Brgba(14,16,22,.96);background-image:linear-gradient(rgba(164,196,255,.05) 0%,$T 44%);backdrop-filter:blur(16px) saturate(140%);border:1px solid rgba(214,226,255,.12);$Sinset 0 1px 0 rgba(232,240,255,.12),0 18px 40px -10px rgba(0,0,0,.64);display:flex;flex-direction:column;gap:2px;animation:ag-cs-diff-in 110ms var(--ag-ease-out,ease-out);}',
'& $Ditem{appearance:none;width:100%;height:28px;$P:0 9px;border:0;$R7px;$Z$T;color:var(--secondary-foreground);$F;font-size:12px;font-weight:450;display:flex;$A;gap:8px;cursor:pointer;text-align:left;white-space:nowrap;$Nbackground-color 110ms ease,color 110ms ease;& svg{width:13px;height:13px;flex-shrink:0;opacity:.78;}&:hover{$Brgba(164,196,255,.09);color:$G;& svg{opacity:1;}}}',
'}',
'$H[data-ag-cs-theme="light"],$H>body:is(.theme-light,.light-theme,.light){',
'& [data-ag-diff-chip="1"]{$Z$T$I;$Ycolor:$T$I;$Snone$I;& [data-ag-diff-chip-file="1"]{text-decoration-color:$L.20);}&:hover{$B$L.048)$I;& [data-ag-diff-chip-file="1"]{text-decoration-color:$L.42)$I;}}&[data-ag-inline-diff-open="1"]{$B$L.068)$I;$Sinset 0 -1px 0 $L.24)$I;}}',
'& [data-testid="diff-line-count"]{& [data-ag-diff-stat="add"]{color:#15803D$I;text-shadow:none;}& [data-ag-diff-stat="del"]{color:#B91C1C$I;text-shadow:none;}& [data-ag-diff-stat="zero"]{color:$L.34)$I;text-shadow:none;}}',
'& $Ccard{$Z#FAFBFD;$Ycolor:$L.10);$S0 8px 22px -10px $L.11);}& $Ctop{$Zlinear-gradient(180deg,$L.03),$L.01));$E-color:$L.08);&.is-compact{$Z$L.014);$E-color:$L.06);}}& $Cbody{scrollbar-color:$L.18) $T;}& $Cfloat-acts{$Zrgba(250,251,253,.9);$Ycolor:$L.10);$S0 2px 6px -2px $L.10);}',
'& $Cact-btn:hover{$B$L.08);}& $Cmore-bar{$Ytop-color:$L.08);&:hover{$B$L.03);}}& $Cwrap-tag{$Z$L.045);$Ycolor:$L.10);}& $Cstep-tag{$Z$V.10);$Ycolor:$V.28);color:#1D4ED8;}& $Cln{$B#F3F5F9;$Yright-color:$L.08);color:rgba(71,85,105,.64);}',
'& $Cfocus-sep{$B$V.055);$E-color:$V.18);}& :is($Cfocus-sep,$Cline.is-hunk.is-focus-sep){& $Cln{$B#EAF1FE;color:#1D4ED8;$Sinset 2px 0 0 #2563EB;}& $Cgap-rule{$Zlinear-gradient(90deg,$V.26),$V.03));}}',
'& $Dmenu{$Zrgba(252,253,255,.96);$Ycolor:$L.12);$S0 12px 30px -8px $L.16),0 0 0 1px $L.06);& $Ditem:hover{$B$V.07);}}',
'& $Cline{&:is(.is-add,.is-del) $Csign{font-weight:600;opacity:1;text-shadow:none;&.is-cont{opacity:.38;font-weight:400;}}&.is-add{$Zrgba(22,163,74,.095)$I;& $Cln{$B#E7F6EC;color:#15803D;$Sinset 2px 0 0 #16A34A;}& $Csign{color:#15803D$I;}}&.is-del{$Zrgba(220,38,38,.088)$I;& $Cln{$B#FDECEC;color:#B91C1C;$Sinset 2px 0 0 #DC2626;}& $Csign{color:#B91C1C$I;}}&.is-focus{&.is-ctx{$B$V.045);& $Cln{$B#EEF4FE;color:#1E40AF;$Sinset 2px 0 0 $V.58);}}&.is-focus-start{$Sinset 0 1px 0 $V.22);}&.is-focus-end{$Sinset 0 -1px 0 $V.18);}}}',
'& $Cline.is-hunk{$B$L.026);$Ycolor:$L.065);& $Cln{$B#EEF1F6;color:rgba(71,85,105,.58);}&.is-focus-sep{$B$V.06);$Ycolor:$V.22);}}& $Cgap-rule{$Zlinear-gradient(90deg,$L.12),$L.03));}',
'}',
'@media (prefers-reduced-motion:reduce){:root:not([data-ag-cs-ignore-rm="1"]) :is($Cloading::before,$Dmenu){animation:none$I;}:root:not([data-ag-cs-ignore-rm="1"]) $Dmenu{backdrop-filter:none$I;}$H:not([data-ag-cs-ignore-rm="1"]):not([data-ag-cs-motion="ultra"]):not([data-ag-cs-motion="standard"]) $Cbox{animation:none$I;filter:none$I;}}',
'$H[data-ag-cs-win-blur="1"]:is([data-ag-cs-perf-mode="performance"],[data-ag-cs-perf-mode="eco"]) $Cloading::before{animation-play-state:paused$I;}',
'$H[data-ag-cs-motion="off"] $Cbox,$H[data-ag-cs-motion="off"] $Cloading::before,$H[data-ag-cs-motion="off"] $Dmenu{animation:none$I;transition:none$I;}',
'$H:is([data-ag-cs-perf-mode="performance"],[data-ag-cs-perf-mode="eco"],[data-ag-cs-motion="off"]) $Dmenu{backdrop-filter:none$I;}',
].join('\n').replace(/\$([CWLHIBTFARXMDGSOEKNZUVQPJY])/g,(_,k)=>({C:'.ag-cs-inline-diff-',W:'rgba(255,255,255,',L:'rgba(15,23,42,',H:'html[data-ag-cs-style]',I:' !important',B:'background-color:',T:'transparent',F:'font-family:var(--font-sans)',A:'align-items:center',R:'border-radius:',X:'box-sizing:border-box',M:'color:var(--muted-foreground)',D:'.ag-cs-diff-ctx-',G:'var(--foreground)',S:'box-shadow:',O:'overflow:',E:'border-bottom',K:'display:inline-flex',N:'transition:',Z:'background:',U:'rgba(96,165,250,',V:'rgba(37,99,235,',Q:'rgba(147,197,253,',P:'padding',J:'margin',Y:'border-'}[k]));
const _C='.ag-cs-inline-diff-';

const NO_TR_ATTRS=[['translate','no'],['data-no-translate','true'],['data-ag-localization-skip','true'],['data-agy-no-translate','true'],['data-antigravity-zh-skip','1'],['data-ag-no-i18n','']];
const S_CNT='[data-testid="diff-line-count"]',S_CHG='[data-testid="changed-files-card"]',P='ag-cs-inline-diff-';
const ga=(e,k)=>e?.getAttribute?.(k),sa=(e,k,v)=>e?.setAttribute?.(k,String(v)),ra=(e,k)=>e?.removeAttribute?.(k);
const qs=(e,s)=>e?.querySelector?.(s)||null,qa=(e,s)=>e?.querySelectorAll?.(s)||[],cl=(e,s)=>e?.closest?.(s)||null;
const isStr=(v)=>typeof v==='string',isFn=(v)=>typeof v==='function',isObj=(v)=>Boolean(v&&typeof v==='object'),stopEv=(e)=>{e?.preventDefault?.();e?.stopPropagation?.();};
const tagU=(e)=>String(e?.tagName||'').toUpperCase(),isEl=(n)=>Boolean(n&&(n.nodeType===1||(n.nodeType===undefined&&isStr(n.tagName))));
const trunc=(s)=>{const v=String(s??'');return v.length>MAX_LINE_CHARS?v.slice(0,MAX_LINE_CHARS-1)+'…':v;};

function markNoTrOwned(el){if(isFn(el?.setAttribute)){for(let i=0;i<NO_TR_ATTRS.length;i++)sa(el,NO_TR_ATTRS[i][0],NO_TR_ATTRS[i][1]);sa(el,'data-ag-owned','1');}return el;}
function baseUri(u){const p=String(u||'').replace(/\\/g,'/').replace(/^file:\/\/\/?/i,'').split(/[?#]/,1)[0].split('/').filter(Boolean);return p.length?p[p.length-1]:'';}
function isUniDiff(raw){
if(!isStr(raw))return false;
const s=raw.trim();if(s.length<4||s.length>MAX_BYTES)return false;
if(/^@@\s+-\d+/m.test(s)||/^diff --git /m.test(s)||/^---\s+\S+\r?\n\+\+\+\s+\S+/m.test(s))return true;
const ls=s.split(/\r?\n/);
return ls.length>=2&&ls.some((l)=>l[0]==='+'||l[0]==='-')&&ls.every((l)=>!l||l[0]==='+'||l[0]==='-'||l[0]===' '||l.startsWith('@@')||l[0]==='\\');
}
function parseUnifiedDiffLines(rawText,maxLines=MAX_CLIENT_LINES){
const raw=String(rawText||'');if(raw.length>MAX_BYTES)return[];
const ls=raw.replace(/\r\n/g,'\n').split('\n'),out=[];let o=1,n=1;
for(let i=0;i<ls.length&&out.length<maxLines;i++){
const l=ls[i];if(/^(?:diff --git|index |--- |\+\+\+ |\\ No newline)/.test(l))continue;
const hm=l.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/);
if(hm){o=Number(hm[1])||1;n=Number(hm[2])||1;out.push({kind:'hunk',ln:'',sign:'@@',text:trunc(l)});continue;}
if(l[0]==='+')out.push({kind:'add',ln:String(n++),sign:'+',text:trunc(l.slice(1))});
else if(l[0]==='-')out.push({kind:'del',ln:String(o++),sign:'-',text:trunc(l.slice(1))});
else if(l.length||out.length){out.push({kind:'ctx',ln:String(n++),sign:' ',text:trunc(l[0]===' '?l.slice(1):l)});o++;}
}
return out;
}
function splitDL(s){if(!s)return[];const a=s.replace(/\r\n/g,'\n').split('\n');if(a.length>1&&a[a.length-1]==='')a.pop();return a;}
function buildNewLines(rawText,maxLines=MAX_CLIENT_LINES){
const raw=String(rawText||'');if(!raw||raw.length>MAX_BYTES)return{lines:[],total:0};
const ls=splitDL(raw),out=[];for(let i=0;i<ls.length&&out.length<maxLines;i++)out.push({kind:'add',ln:String(i+1),sign:'+',text:trunc(ls[i])});
return{lines:out,total:ls.length};
}
function buildPairDiffLines(oldText,newText,startLine=1,maxLines=MAX_CLIENT_LINES){
const sO=String(oldText||''),sN=String(newText||'');if(sO===sN||sO.length+sN.length>MAX_BYTES)return[];
const base=Math.max(1,Number(startLine)||1),a=splitDL(sO),b=splitDL(sN),out=[];
let p=0;while(p<a.length&&p<b.length&&a[p]===b[p])p++;
let saI=a.length-1,sbI=b.length-1;while(saI>=p&&sbI>=p&&a[saI]===b[sbI]){saI--;sbI--;}
const m=saI>=p?saI-p+1:0,n=sbI>=p?sbI-p+1:0;if(!m&&!n)return[];
const push=(k,ln,sg,tx)=>{if(out.length<maxLines)out.push({kind:k,ln:String(ln),sign:sg,text:trunc(tx)});};
if(m>0&&n>0&&m*n<=160000){
const cols=n+1,dp=new Int32Array((m+1)*cols);
for(let i=m-1;i>=0;i--){const ai=a[p+i],r=i*cols,nr=(i+1)*cols;for(let j=n-1;j>=0;j--)dp[r+j]=ai===b[p+j]?dp[nr+j+1]+1:Math.max(dp[nr+j],dp[r+j+1]);}
const ops=[];for(let i=Math.max(0,p-2);i<p;i++)ops.push({kind:'ctx',ln:base+i,sign:' ',text:a[i]});
let i=0,j=0;
while(i<m&&j<n){
if(a[p+i]===b[p+j]){ops.push({kind:'ctx',ln:base+p+j,sign:' ',text:b[p+j]});i++;j++;}
else if(dp[(i+1)*cols+j]>=dp[i*cols+j+1])ops.push({kind:'del',ln:base+p+i,sign:'-',text:a[p+i++]});
else ops.push({kind:'add',ln:base+p+j,sign:'+',text:b[p+j++]});
}
while(i<m)ops.push({kind:'del',ln:base+p+i,sign:'-',text:a[p+i++]});
while(j<n)ops.push({kind:'add',ln:base+p+j,sign:'+',text:b[p+j++]});
for(let k=sbI+1,te=Math.min(b.length,sbI+3);k<te;k++)ops.push({kind:'ctx',ln:base+k,sign:' ',text:b[k]});
for(let x=0;x<ops.length&&out.length<maxLines;){
if(ops[x].kind!=='ctx'){const r=ops[x++];push(r.kind,r.ln,r.sign,r.text);continue;}
let e=x;while(e<ops.length&&ops[e].kind==='ctx')e++;
if(x>0&&e<ops.length&&e-x>5){
for(let k=x;k<x+2;k++)push('ctx',ops[k].ln,' ',ops[k].text);
if(out.length<maxLines)out.push({kind:'hunk',ln:'',sign:'@@',text:`@@ -${ops[e-2].ln} +${ops[e-2].ln} @@`});
for(let k=e-2;k<e;k++)push('ctx',ops[k].ln,' ',ops[k].text);
}else for(let k=x;k<e;k++)push('ctx',ops[k].ln,' ',ops[k].text);
x=e;
}
return out;
}
for(let i=Math.max(0,p-2);i<p;i++)push('ctx',base+i,' ',a[i]);
for(let i=p;i<=saI;i++)push('del',base+i,'-',a[i]);
for(let i=p;i<=sbI;i++)push('add',base+i,'+',b[i]);
for(let i=sbI+1,te=Math.min(b.length,sbI+3);i<te;i++)push('ctx',base+i,' ',b[i]);
return out;
}
function normLines(arr,maxLines=MAX_CLIENT_LINES){
const out=[];
for(let i=0;i<arr.length&&out.length<maxLines;i++){
const it=arr[i];if(!isObj(it))continue;
const rk=String(it.kind||it.type||'').toLowerCase(),kind=/^(?:add|added|insert|insertion)$/.test(rk)?'add':/^(?:del|deleted|remove|removed|deletion)$/.test(rk)?'del':/^(?:hunk|header)$/.test(rk)?'hunk':'ctx';
out.push({kind,ln:String(it.ln??it.lineNumber??it.newLine??it.oldLine??''),sign:String(it.sign??(kind==='add'?'+':kind==='del'?'-':kind==='hunk'?'@@':' ')),text:trunc(it.text??it.content??it.value??it.line??'')});
}
return out;
}
function parseHunks(hunks,maxLines=MAX_CLIENT_LINES){
const out=[];
for(let i=0;i<hunks.length&&out.length<maxLines;i++){
const h=hunks[i];if(!isObj(h)||!Array.isArray(h.lines))continue;
let o=Number(h.oldStart??h.oldLineStart??1)||1,n=Number(h.newStart??h.newLineStart??o)||1;
if(out.length>0||h.header)out.push({kind:'hunk',ln:'',sign:'@@',text:trunc(h.header||`@@ -${o} +${n} @@`)});
for(let j=0;j<h.lines.length&&out.length<maxLines;j++){
const ln=h.lines[j];
if(isStr(ln)){if(ln[0]==='+')out.push({kind:'add',ln:String(n++),sign:'+',text:trunc(ln.slice(1))});else if(ln[0]==='-')out.push({kind:'del',ln:String(o++),sign:'-',text:trunc(ln.slice(1))});else{out.push({kind:'ctx',ln:String(n++),sign:' ',text:trunc(ln[0]===' '?ln.slice(1):ln)});o++;}}
else if(isObj(ln)){const nm=normLines([ln],1);if(nm.length)out.push(nm[0]);}
}
}
return out;
}

const PAIR_KEYS='TargetContent,ReplacementContent|targetContent,replacementContent|target_content,replacement_content|Target,Replacement|oldText,newText|old_text,new_text|oldString,newString|old_string,new_string|oldStr,newStr|before,after|beforeText,afterText|beforeContent,afterContent|original,modified|originalText,modifiedText|originalContent,modifiedContent|originalCode,modifiedCode'.split('|').map((s)=>s.split(','));
const DIFF_STR_KEYS='unifiedDiff|unified_diff|unified|diff|patch|diffText|rawDiff|gitDiff|codeDiff'.split('|');
const CHUNK_KEYS='ReplacementChunks|replacementChunks|replacement_chunks|edits|chunks|changes'.split('|');
const URI_KEYS='uri|fileUri|filePath|TargetFile|targetFile|target_file|AbsolutePath|absolutePath|path|Path'.split('|');
const PRIO_KEYS='step|value|args|result|data|contentBlocks|fileDiff|diff|toolCall|edit|payload'.split('|');
const SKIP_KEYS=new Set('return|child|sibling|alternate|stateNode|_owner|ownerDocument|parentNode|parentElement|children|props|metadata|lexicalEditor|userStatus|cascadeModelConfigData|tokenizationService|customLinks|chatPills'.split('|'));
const CREATED_TOOL_RE=/^(?:write_file|write_to_file|create_file|create_new_file)$/i;
const CREATED_ROW_RE=/(?:^|[\s\u3000:])(?:Created|Wrote)(?=[\s\u3000:]|$)|已创建|创建了|新建/i;

function extractPair(obj,maxLines=MAX_CLIENT_LINES){
if(!isObj(obj))return[];
const sl=Number(obj.StartLine??obj.startLine??obj.start_line??obj.lineNumber??obj.oldStart)||1;
for(let i=0;i<PAIR_KEYS.length;i++){const ov=obj[PAIR_KEYS[i][0]],nv=obj[PAIR_KEYS[i][1]];if((isStr(ov)||isStr(nv))&&(ov||nv)&&ov!==nv){const b=buildPairDiffLines(isStr(ov)?ov:'',isStr(nv)?nv:'',sl,maxLines);if(b.length)return b;}}
return[];
}
function extractChunks(chunks,maxLines=MAX_CLIENT_LINES){
if(!Array.isArray(chunks)||!chunks.length)return[];
const out=[];
for(let i=0;i<chunks.length&&out.length<maxLines;i++){
const ch=chunks[i];if(!isObj(ch))continue;
const seg=isStr(ch.unifiedDiff)&&isUniDiff(ch.unifiedDiff)?parseUnifiedDiffLines(ch.unifiedDiff,maxLines-out.length):isStr(ch.diff)&&isUniDiff(ch.diff)?parseUnifiedDiffLines(ch.diff,maxLines-out.length):extractPair(ch,maxLines-out.length);
if(seg.length){if(out.length>0&&out.length<maxLines)out.push({kind:'hunk',ln:'',sign:'@@',text:`@@ -${Number(ch.StartLine??ch.startLine??1)||1} @@`});for(let j=0;j<seg.length&&out.length<maxLines;j++)out.push(seg[j]);}
}
return out.length?out:chunks.some((c)=>isObj(c)&&(c.kind||c.type)&&(c.text!==undefined||c.content!==undefined||c.value!==undefined||c.line!==undefined))?normLines(chunks,maxLines):[];
}
const isPathStr=(v)=>isStr(v)&&Boolean(v.trim())&&v.length<=1024&&(v.trim().startsWith('file:')||v.includes('/')||v.includes('\\')||/^[A-Za-z0-9._-]+\.[A-Za-z0-9]{1,8}$/.test(v.trim()));
function scanObj(rootObj,st){
if(!isObj(rootObj))return;
const q=[{obj:rootObj,d:0}];
for(let qi=0;qi<q.length&&st.nodes<220;qi++){
const{obj,d}=q[qi];if(!isObj(obj)||st.visited.has(obj)||obj.nodeType===1||obj.nodeType===9||isFn(obj.addEventListener))continue;
st.visited.add(obj);st.nodes++;let hp=false;
for(let i=0;i<URI_KEYS.length;i++){const v=obj[URI_KEYS[i]];if(isPathStr(v)){hp=true;if(!st.uri){st.uri=v.trim();if(!st.fileName)st.fileName=baseUri(st.uri);}break;}}
if(!st.fileName&&isPathStr(obj.file))st.fileName=baseUri(obj.file);
if(!st.stepCtx&&isObj(obj.diffContext))st.stepCtx=obj.diffContext;
if(CREATED_TOOL_RE.test(String(obj.toolName||obj.tool||obj.name||''))||obj.isCreated===true||obj.isNewFile===true||obj.newFile===true)st.isCreated=true;
const ds=obj.diffStats||obj.stats||obj;
if(isObj(ds)){const a=Number(ds.additions??ds.linesAdded),dl=Number(ds.deletions??ds.linesRemoved);if(!st.additions&&Number.isFinite(a)&&a>0)st.additions=Math.trunc(a);if(!st.deletions&&Number.isFinite(dl)&&dl>0)st.deletions=Math.trunc(dl);}
if(!st.lines.length)for(let i=0;i<DIFF_STR_KEYS.length;i++){const dv=obj[DIFF_STR_KEYS[i]];if(isStr(dv)&&isUniDiff(dv)){const ps=parseUnifiedDiffLines(dv,MAX_CLIENT_LINES);if(ps.length){st.lines=ps;break;}}}
if(!st.lines.length&&Array.isArray(obj.hunks)&&obj.hunks.length)st.lines=parseHunks(obj.hunks,MAX_CLIENT_LINES);
if(!st.lines.length)for(let i=0;i<CHUNK_KEYS.length;i++)if(Array.isArray(obj[CHUNK_KEYS[i]])&&obj[CHUNK_KEYS[i]].length){const ex=extractChunks(obj[CHUNK_KEYS[i]],MAX_CLIENT_LINES);if(ex.length){st.lines=ex;break;}}
if(!st.lines.length){const pl=extractPair(obj,MAX_CLIENT_LINES);if(pl.length)st.lines=pl;}
if(!st.lines.length&&!st.writeLines.length&&!obj.Append&&(hp||st.isCreated)&&!PAIR_KEYS.some((p)=>isStr(obj[p[0]])&&obj[p[0]].length>0)){
const expC=isStr(obj.Content)?obj.Content:isStr(obj.CodeContent)?obj.CodeContent:'',cv=expC||(st.isCreated&&isStr(obj.content)?obj.content:'');
if(cv&&cv.length<=MAX_BYTES){const b=buildNewLines(cv,MAX_CLIENT_LINES);if(b.lines.length){st.writeLines=b.lines;st.writeTotal=b.total;if(expC)st.isCreated=true;}}
}
if(st.lines.length&&st.uri)return;if(d>=8)continue;
if(Array.isArray(obj)){for(let i=0;i<Math.min(obj.length,12);i++)if(isObj(obj[i]))q.push({obj:obj[i],d:d+1});}
else{const seen=new Set();for(let i=0;i<PRIO_KEYS.length;i++){const k=PRIO_KEYS[i];if(isObj(obj[k])){seen.add(k);q.push({obj:obj[k],d:d+1});}}const ks=Object.keys(obj);for(let i=0;i<Math.min(ks.length,40);i++){const k=ks[i];if(!seen.has(k)&&!SKIP_KEYS.has(k)&&!k.startsWith('__react')&&isObj(obj[k]))q.push({obj:obj[k],d:d+1});}}
}
}
function extractInlineDiffPayload(badgeEl,rowEl,winRef){
let uri='',fileName='',additions=0,deletions=0,lines=[],totalLines=0,source='',isCreated=false,writeLines=[],writeTotal=0;
const uAttr=ga(badgeEl,'data-ag-diff-uri')||ga(rowEl,'data-ag-diff-uri');if(isStr(uAttr)&&uAttr.trim()){uri=uAttr.trim();fileName=baseUri(uri);}
const rawJson=ga(badgeEl,'data-ag-diff-json')||ga(rowEl,'data-ag-diff-json');
if(rawJson&&rawJson.length<=MAX_BYTES){try{
const p=JSON.parse(rawJson);
if(isObj(p)){
if(!uri){const c=p.uri||p.filePath||p.path;if(isStr(c)&&c.trim())uri=c.trim();}
if(isStr(p.file))fileName=baseUri(p.file);if(!fileName&&uri)fileName=baseUri(uri);
if(typeof p.additions==='number')additions=p.additions;if(typeof p.deletions==='number')deletions=p.deletions;
if(p.isCreated===true||p.isNewFile===true)isCreated=true;
lines=Array.isArray(p.lines)?normLines(p.lines,MAX_CLIENT_LINES):(isStr(p.unified)||isStr(p.unifiedDiff))?parseUnifiedDiffLines(p.unified||p.unifiedDiff,MAX_CLIENT_LINES):extractPair(p,MAX_CLIENT_LINES);
if(lines.length)source='step-patch';
}
}catch{}}
if((!lines.length||!uri)&&(badgeEl||rowEl)){try{
const st={uri,fileName,additions,deletions,lines,writeLines:[],writeTotal:0,isCreated,stepCtx:null,visited:new WeakSet(),nodes:0};
const scanNode=(el,maxUp)=>{if(!el)return;const fk=Object.keys(el).find((k)=>k.startsWith('__reactFiber$')||k.startsWith('__reactInternalInstance$'));for(let d=0,f=fk?el[fk]:null;d<maxUp&&f;d++,f=f.return){if(isObj(f.memoizedProps))scanObj(f.memoizedProps,st);if(!st.lines.length&&isObj(f.memoizedState))for(let hs=0,h=f.memoizedState;hs<10&&isObj(h);hs++,h=h.next){if(isObj(h.memoizedState))scanObj(h.memoizedState,st);if(st.lines.length&&st.uri)break;}if(st.lines.length&&st.uri)break;}};
scanNode(badgeEl,28);if(!st.lines.length||!st.uri)scanNode(rowEl,16);
uri=st.uri||uri;fileName=st.fileName||fileName;additions=st.additions||additions;deletions=st.deletions||deletions;isCreated=Boolean(isCreated||st.isCreated);writeLines=st.writeLines;writeTotal=st.writeTotal;
if(st.lines.length){lines=st.lines;source='step-patch';}
const W=winRef||(typeof window!=='undefined'?window:G);
if(!lines.length&&isFn(W?.__agPrismResolveInlineDiff)){const ext=W.__agPrismResolveInlineDiff({uri,fileName,additions,deletions,diffContext:st.stepCtx,badgeEl,rowEl});lines=Array.isArray(ext?.lines)?normLines(ext.lines,MAX_CLIENT_LINES):isStr(ext?.unified)?parseUnifiedDiffLines(ext.unified,MAX_CLIENT_LINES):[];if(lines.length)source='step-patch';}
}catch{}}
if(!additions&&!deletions){const txt=String(badgeEl?.textContent||''),am=txt.match(/\+(\d+)/),dm=txt.match(/-(\d+)/);if(am)additions=Number(am[1])||0;if(dm)deletions=Number(dm[1])||0;}
if(!isCreated&&(ga(badgeEl,'data-ag-diff-created')==='1'||ga(rowEl,'data-ag-diff-created')==='1'||(deletions===0&&CREATED_ROW_RE.test(String(rowEl?.textContent||'')))))isCreated=true;
if(!lines.length&&writeLines.length&&(isCreated||deletions===0)){lines=writeLines;totalLines=writeTotal||writeLines.length;source='new-file';isCreated=true;}
if(lines.length&&!additions&&!deletions)for(let i=0;i<lines.length;i++){if(lines[i].kind==='add')additions++;else if(lines[i].kind==='del')deletions++;}
if(!fileName&&uri)fileName=baseUri(uri);
if(!fileName&&rowEl){const fm=String(rowEl.textContent||'').trim().match(/([A-Za-z0-9._-]+\.[A-Za-z0-9]{1,8})/);if(fm)fileName=fm[1];}
return{uri,fileName:fileName||'Diff Preview',additions,deletions,lines,totalLines:totalLines||lines.length,source,isCreated};
}

const DIFF_FALLBACK={
inlineDiffOpenSidebar:{'zh-CN':'在侧栏打开完整对比','zh-TW':'在側欄開啟完整對比',en:'Open full diff in Sidebar',ja:'サイドバーで完全な差分を開く',ko:'사이드바에서 전체 차이 열기',es:'Abrir diff completo en la barra lateral',fr:'Ouvrir le diff complet dans la barre latérale',de:'Vollständigen Diff in Seitenleiste öffnen',tr:'Tam diff’i kenar çubuğunda aç'},
inlineDiffCollapse:{'zh-CN':'收起','zh-TW':'收合',en:'Collapse',ja:'閉じる',ko:'접기',es:'Contraer',fr:'Réduire',de:'Einklappen',tr:'Daralt'},
inlineDiffLoading:{'zh-CN':'正在读取差异...','zh-TW':'正在讀取差異...',en:'Loading diff...',ja:'差分を読み込み中...',ko:'차이점 불러오는 중...',es:'Cargando diff...',fr:'Chargement du diff...',de:'Diff wird geladen...',tr:'Diff yükleniyor...'},
inlineDiffBinary:{'zh-CN':'二进制文件暂不支持行内预览，请右键在侧栏打开。','zh-TW':'二進位檔案暫不支援行內預覽，請右鍵在側欄開啟。',en:'Binary file cannot be previewed inline. Right-click to open in Sidebar.',ja:'バイナリファイルはインライン表示できません。右クリックでサイドバーから開けます。',ko:'바이너리 파일은 인라인으로 미리 볼 수 없습니다. 우클릭하여 사이드바에서 여세요.',es:'Los archivos binarios no tienen vista previa en línea. Haz clic derecho para abrir en la barra lateral.',fr:'Les fichiers binaires ne peuvent pas être prévisualisés en ligne. Clic droit pour ouvrir dans la barre latérale.',de:'Binärdateien können nicht inline angezeigt werden. Rechtsklick zum Öffnen in der Seitenleiste.',tr:'İkili dosya satır içi önizlenemez. Kenar çubuğunda açmak için sağ tıklayın.'},
inlineDiffNoPreview:{'zh-CN':'当前步骤暂无行内差异，请右键在侧栏打开。','zh-TW':'目前步驟暫無行內差異，請右鍵在側欄開啟。',en:'Inline diff is unavailable for this step. Right-click to open in Sidebar.',ja:'このステップには差分テキストがありません。右クリックでサイドバーから開けます。',ko:'이 단계에는 인라인 차이가 없습니다. 우클릭하여 사이드바에서 여세요.',es:'El diff en línea no está disponible para este paso. Haz clic derecho para abrir en la barra lateral.',fr:'Le diff en ligne est indisponible pour cette étape. Clic droit pour ouvrir dans la barre latérale.',de:'Inline-Diff ist für diesen Schritt nicht verfügbar. Rechtsklick zum Öffnen in der Seitenleiste.',tr:'Bu adım için satır içi diff kullanılamıyor. Kenar çubuğunda açmak için sağ tıklayın.'},
inlineDiffSensitive:{'zh-CN':'该文件受隐私安全规则保护，已跳过行内预览（可右键在侧栏查看）','zh-TW':'該檔案受隱私安全規則保護，已略過行內預覽（可右鍵在側欄檢視）',en:'Protected by privacy rules; inline preview skipped (right-click to view in Sidebar).',ja:'プライバシー保護ルールによりインライン表示をスキップしました（右クリックでサイドバー表示）',ko:'개인정보 보호 규칙으로 인라인 미리보기를 건너뛰었습니다(우클릭하여 사이드바에서 보기).',es:'Protegido por reglas de privacidad; vista previa en línea omitida (clic derecho para ver en la barra lateral).',fr:'Protégé par les règles de confidentialité ; aperçu en ligne ignoré (clic droit pour voir dans la barre latérale).',de:'Durch Datenschutzregeln geschützt; Inline-Vorschau übersprungen (Rechtsklick für Seitenleiste).',tr:'Gizlilik kurallarıyla korunuyor; satır içi önizleme atlandı (kenar çubuğunda açmak için sağ tıklayın).'},
inlineDiffSnapshotNotice:{'zh-CN':'未受 Git 追踪 · 预览当前文件内容（右键可在侧栏打开完整对比）','zh-TW':'未受 Git 追蹤 · 預覽目前檔案內容（右鍵可在側欄開啟完整對比）',en:'Not tracked by Git · previewing current file (right-click to open full diff in Sidebar)',ja:'Git 未追跡 · 現在のファイルを表示中（右クリックでサイドバーで完全な差分を開く）',ko:'Git 추적 안 됨 · 현재 파일 미리보기(우클릭하여 사이드바에서 전체 차이 열기)',es:'No rastreado por Git · vista previa del archivo actual (clic derecho para abrir diff completo)',fr:'Non suivi par Git · aperçu du fichier actuel (clic droit pour ouvrir le diff complet)',de:'Nicht von Git verfolgt · Vorschau der aktuellen Datei (Rechtsklick für vollständigen Diff)',tr:'Git tarafından izlenmiyor · geçerli dosya önizleniyor (tam diff’i kenar çubuğunda açmak için sağ tıklayın)'},
inlineDiffLongLinesTag:{'zh-CN':'单行长改','zh-TW':'單行長改',en:'long line',ja:'長行',ko:'긴 줄',es:'línea larga',fr:'ligne longue',de:'lange Zeile',tr:'uzun satır'},
inlineDiffStepBadge:{'zh-CN':'本步','zh-TW':'本步',en:'This step',ja:'このステップ',ko:'이 단계',es:'Este paso',fr:'Cette étape',de:'Dieser Schritt',tr:'Bu adım'},
inlineDiffMenuExpand:{'zh-CN':'展开行内对比','zh-TW':'展開行內對比',en:'Expand inline diff',ja:'インライン差分を展開',ko:'인라인 차이 펼치기',es:'Expandir diff en línea',fr:'Déplier le diff en ligne',de:'Inline-Diff ausklappen',tr:'Satır içi diff’i genişlet'},
inlineDiffMenuCollapse:{'zh-CN':'收起行内对比','zh-TW':'收合行內對比',en:'Collapse inline diff',ja:'インライン差分を閉じる',ko:'인라인 차이 접기',es:'Contraer diff en línea',fr:'Replier le diff en ligne',de:'Inline-Diff einklappen',tr:'Satır içi diff’i daralt'},
inlineDiffMenuCopyPath:{'zh-CN':'复制文件路径','zh-TW':'複製檔案路徑',en:'Copy file path',ja:'ファイルパスをコピー',ko:'파일 경로 복사',es:'Copiar ruta del archivo',fr:'Copier le chemin du fichier',de:'Dateipfad kopieren',tr:'Dosya yolunu kopyala'},
inlineDiffLargeExpandBtn:{'zh-CN':'⋯ 大文件仅节选关键片段 · 点击在右侧栏查看完整对比','zh-TW':'⋯ 大檔案僅節選關鍵片段 · 點擊在右側欄檢視完整對比',en:'⋯ Showing key hunks · Click to open full diff in Sidebar',ja:'⋯ 大きなファイルのため一部のみ表示 · クリックしてサイドバーで全体を見る',ko:'⋯ 대용량 파일 주요 변경만 표시 · 클릭하여 사이드바에서 전체 보기',es:'⋯ Mostrando fragmentos clave · Haz clic para abrir el diff completo',fr:'⋯ Extraits clés affichés · Cliquer pour ouvrir le diff complet',de:'⋯ Wichtige Bereiche angezeigt · Klicken für vollständigen Diff',tr:'⋯ Önemli bölümler gösteriliyor · Tam diff’i kenar çubuğunda açmak için tıklayın'},
inlineDiffExpandAll:{'zh-CN':'展开全部（剩余 {n} 行）','zh-TW':'展開全部（剩餘 {n} 行）',en:'Expand all ({n} more lines)',ja:'すべて展開（残り {n} 行）',ko:'전체 펼치기 ({n}줄 더 있음)',es:'Expandir todo ({n} líneas más)',fr:'Tout déplier ({n} lignes de plus)',de:'Alle ausklappen ({n} weitere Zeilen)',tr:'Tümünü genişlet ({n} satır daha)'},
inlineDiffExpandAllPlain:{'zh-CN':'展开全部','zh-TW':'展開全部',en:'Expand all',ja:'すべて展開',ko:'전체 펼치기',es:'Expandir todo',fr:'Tout déplier',de:'Alle ausklappen',tr:'Tümünü genişlet'},
inlineDiffCumulativeNotice:{'zh-CN':'工作区累计改动 (+{a} -{d}) · 单步精确对比请点右上角在侧栏打开','zh-TW':'工作區累計改動 (+{a} -{d}) · 單步精確對比請點右上角在側欄開啟',en:'Working-tree cumulative diff (+{a} -{d}) · click top-right to view exact step diff in Sidebar',ja:'作業ツリーの累積差分 (+{a} -{d}) · 単一ステップの正確な差分は右上からサイドバーで開けます',ko:'작업 트리 누적 변경 (+{a} -{d}) · 단계별 정확한 차이는 우측 상단에서 사이드바로 여세요',es:'Diff acumulado del árbol (+{a} -{d}) · haz clic arriba a la derecha para ver el paso exacto',fr:'Diff cumulé de l’espace (+{a} -{d}) · cliquez en haut à droite pour le diff exact',de:'Kumulierter Arbeitsbaum-Diff (+{a} -{d}) · oben rechts für exakten Schritt-Diff öffnen',tr:'Çalışma ağacı toplam diff’i (+{a} -{d}) · tam adım farkı için sağ üstten kenar çubuğunda açın'},
};

const SVG_P={external:['M15 3h6v6','M10 14L21 3','M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],close:['M18 6L6 18','M6 6l12 12'],chevDown:['M6 9l6 6 6-6']};

function createInlineDiffClient(options={}){
const doc=options.doc||options.document||(typeof document!=='undefined'?document:null);
const win=options.win||options.window||(typeof window!=='undefined'?window:G);
let cfg=isObj(options.config)?{...options.config}:{};
const extGetCfg=isFn(options.getConfig)?options.getConfig:null,getCfg=()=>{const e=extGetCfg?extGetCfg():null;return isObj(e)?{...cfg,...e}:cfg;};
const baseGetLang=isFn(options.getLang)?options.getLang:null,baseT=isFn(options.t)?options.t:null,baseMut=isFn(options.runGuardedMut)?options.runGuardedMut:null,baseSetA=isFn(options.setAttrIfChanged)?options.setAttrIfChanged:null;
let hookGetLang=baseGetLang,hookT=baseT,hookMut=baseMut,hookSetA=baseSetA;

const normLang=(raw)=>{
let v=String(raw||'').trim();if(!v||v.toLowerCase()==='auto')v=String(((win&&'navigator'in win?win.navigator:typeof navigator!=='undefined'?navigator:null)?.language)||'').trim();
const s=v.toLowerCase().replace(/_/g,'-');if(!s||s==='auto')return'en';
if(s==='yue'||s.startsWith('yue-')||s==='zh-yue'||s.includes('cantonese'))return'zh-CN';
if(/^zh-(tw|hant|hk|mo)|^(tw|hant)$/.test(s))return'zh-TW';
if(/^zh/.test(s))return'zh-CN';
if(/^(ja|jp)|^japanese$/.test(s))return'ja';
if(/^(ko|kr)|^korean$/.test(s))return'ko';
if(/^es|^spanish$/.test(s))return'es';
if(/^fr|^french$/.test(s))return'fr';
if(/^de|^german$/.test(s))return'de';
if(/^tr|^(turkish|türkçe|turkce)$/.test(s))return'tr';
return'en';
};
const getLang=()=>{if(isFn(hookGetLang)){try{const v=String(hookGetLang()||'').trim();if(v&&v!=='auto')return normLang(v);}catch{}}const c=String(cfg.language||cfg.lang||'').trim();return c&&c!=='auto'?normLang(c):normLang(String(ga(doc?.documentElement,'data-ag-cs-lang')||'').trim());};
const mut=(fn)=>(isFn(hookMut)?hookMut(fn):fn());
const setA=(el,n,v)=>(isFn(hookSetA)?hookSetA(el,n,v):(el&&ga(el,n)!==v&&sa(el,n,v)));
const extDead=isFn(options.isDestroyed)?options.isDestroyed:()=>false;let dead=false;const isDead=()=>dead||extDead();

const pending=new Map(),cache=new Map(),inflight=new Map(),animTimers=new Set(),focusRafs=new Set();
let hoverTmr=0,syncTmr=0,reqSeq=1,allowNative=false,ctxMenu=null,styleEl=null,selfApi=null;
const stats={inlineDiffToggleCount:0};
const mk=(t,c,x,...ks)=>{const e=doc.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;for(const k of ks)if(k)e.appendChild(k);return e;};
const byId=(id)=>(isFn(doc?.getElementById)?doc.getElementById(id):null);

function getUiText(key,fb){
if(isFn(hookT)){try{const v=hookT(key);if(isStr(v)&&v&&v!==key)return v;}catch{}}
const lg=getLang();try{const ui=(win?.__agCsLocales||G.__agCsLocales)?.getUiStrings?.(lg);if(ui&&isStr(ui[key])&&ui[key])return ui[key];}catch{}
const row=DIFF_FALLBACK[key];return(row&&(row[lg]||row.en))||fb||key;
}
function mkSvg(kind,sz=14){
const NS='http://www.w3.org/2000/svg';if(!isFn(doc?.createElementNS)){const sp=doc.createElement('span');sa(sp,'aria-hidden','true');return sp;}
const svg=doc.createElementNS(NS,'svg');
for(const[k,v]of[['width',sz],['height',sz],['viewBox','0 0 24 24'],['fill','none'],['stroke','currentColor'],['stroke-width','1.6'],['stroke-linecap','round'],['stroke-linejoin','round'],['aria-hidden','true']])sa(svg,k,v);
if(SVG_P[kind])for(const d of SVG_P[kind]){const n=doc.createElementNS(NS,'path');sa(n,'d',d);svg.appendChild(n);}
else if(kind==='moreDots')for(const cx of['6','12','18']){const n=doc.createElementNS(NS,'circle');for(const[k,v]of[['cx',cx],['cy','12'],['r','1.2'],['fill','currentColor'],['stroke','none']])sa(n,k,v);svg.appendChild(n);}
return svg;
}
function ensureStyle(){
if(isDead()||!isFn(doc?.createElement))return null;
if(styleEl&&styleEl.isConnected!==false&&(!isFn(doc.getElementById)||doc.getElementById(INLINE_DIFF_STYLE_ID)===styleEl))return styleEl;
const ex=byId(INLINE_DIFF_STYLE_ID);if(ex){if(ex.textContent!==INLINE_DIFF_CSS)mut(()=>{ex.textContent=INLINE_DIFF_CSS;});markNoTrOwned(ex);return(styleEl=ex);}
const tgt=doc.head||doc.documentElement||doc.body;if(!isFn(tgt?.appendChild))return null;
let cr=null;mut(()=>{cr=doc.createElement('style');cr.id=INLINE_DIFF_STYLE_ID;markNoTrOwned(cr);cr.textContent=INLINE_DIFF_CSS;tgt.appendChild(cr);});return(styleEl=cr);
}
function ensurePortal(){
if(!doc?.body)return null;
let p=byId(PORTAL_ID)||qs(doc.body,'#'+PORTAL_ID);
if(!p&&isFn(doc.createElement)){p=markNoTrOwned(doc.createElement('div'));p.id=PORTAL_ID;sa(p,'id',PORTAL_ID);if(p.style)p.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:9990;contain:layout style';doc.body.appendChild(p);}
return p||doc.body;
}
function onResolve(id,resp){const e=pending.get(id);if(!e)return;pending.delete(id);if(e.timer)clearTimeout(e.timer);try{e.resolve(resp||null);}catch{}}
if(win){try{win.__agPrismInlineDiffResolve=onResolve;}catch{}}

function findHostRow(badgeEl){
if(!badgeEl)return null;
const exp=cl(badgeEl,'[data-testid="tool-call-row"], [data-ag-tool-row="1"]');if(exp)return exp;
let cur=badgeEl,spanHost=null;const cands=[];
for(let i=0;i<16&&cur?.parentElement;i++,cur=cur.parentElement){
const p=cur.parentElement;if(p===doc?.documentElement||cur===doc?.body||cur===doc?.documentElement)break;
const tid=ga(cur,'data-testid')||'';if(tid==='conversation-view'||tid==='autoscroll-viewport'||qa(cur,S_CNT).length>1||(cur.classList?.contains?.('flex-col')&&(cur.children?.length||0)>1))break;
const pt=tagU(p);if(pt==='SPAN'||pt==='BUTTON'||pt==='A')continue;
let disp='',dir='';try{const cs=win?.getComputedStyle?.(p);if(cs){disp=String(cs.display||cs.getPropertyValue?.('display')||'').toLowerCase();dir=String(cs.flexDirection||cs.getPropertyValue?.('flex-direction')||'').toLowerCase();}}catch{}
if(!(disp?(disp==='flex'&&dir==='column')||disp==='block'||disp==='grid':Boolean(p.classList?.contains?.('flex-col'))))continue;
if(tagU(cur)==='SPAN'){if(!spanHost)spanHost=cur;continue;}
cands.push(cur);
}
if(cands.length){
let best=cands[cands.length-1],bw=-1;
for(let i=0;i<cands.length;i++){const c=cands[i],w=Math.round(Number(c.getBoundingClientRect?.()?.width)||0);if(w>bw||(w===bw&&(Boolean(c.classList?.contains?.('w-full'))||i>0))){bw=w;best=c;}}
return bw===0?cands.find((c)=>c.classList?.contains?.('w-full'))||best:best;
}
return spanHost||cl(badgeEl,'button, [role="button"]')||badgeEl.parentElement||null;
}

function requestDaemon(uri,hints,expand=false){
if(isDead()||!uri||!isFn(win?.__agPrismInlineDiffCall))return null;
const isCr=Boolean(hints?.isCreated),expFlag=Boolean(expand),key=`${uri}|${Number(hints?.additions)||0}:${Number(hints?.deletions)||0}|${isCr?1:0}|${expFlag?1:0}`,hit=cache.get(key);
if(hit){if(Date.now()-hit.at<=(hit.ttl||CACHE_TTL))return{reqId:reqSeq++,cached:hit.resp,promise:Promise.resolve(hit.resp)};cache.delete(key);}
const ex=inflight.get(key);if(ex)return{reqId:reqSeq++,promise:ex};
try{win.__agPrismInlineDiffResolve=onResolve;}catch{}
while(pending.size>=MAX_PENDING){const ok=pending.keys().next().value,o=pending.get(ok);pending.delete(ok);if(o?.timer)clearTimeout(o.timer);try{o?.resolve?.({ok:false,error:'evicted'});}catch{}}
const reqId=reqSeq++,ch=hints&&(hints.additions>0||hints.deletions>0||isCr)?{additions:Math.max(0,Math.trunc(Number(hints.additions)||0)),deletions:Math.max(0,Math.trunc(Number(hints.deletions)||0)),...(isCr?{isCreated:true}:{})}:undefined;
const promise=new Promise((resolve)=>{
const timer=setTimeout(()=>{if(!pending.delete(reqId))return;inflight.delete(key);resolve({ok:false,error:'timeout'});},TIMEOUT_MS);
pending.set(reqId,{resolve:(resp)=>{inflight.delete(key);if(isObj(resp)){const neg=(!resp.ok&&DET_ERR_RE.test(String(resp.error||resp.reason||'')))||(resp.ok&&resp.mode==='binary');if(resp.ok||neg){while(cache.size>=CACHE_MAX){const ok=cache.keys().next().value;if(ok===undefined)break;cache.delete(ok);}cache.set(key,{at:Date.now(),ttl:neg?NEG_TTL:CACHE_TTL,resp});}}resolve(resp);},timer});
const reqObj={id:reqId,action:'readInlineDiff',uri};if(ch)reqObj.hints=ch;if(expFlag)reqObj.expand=true;
try{win.__agPrismInlineDiffCall(JSON.stringify(reqObj));}
catch{const r=pending.get(reqId);if(r){pending.delete(reqId);if(r.timer)clearTimeout(r.timer);}inflight.delete(key);resolve({ok:false,error:'rpc-error'});}
});
if(inflight.size<16)inflight.set(key,promise);return{reqId,promise};
}

function createFloatActs(onOpenSb,onCollapse){
const mkB=(act,ic,lbl,fn)=>{const b=mk('button',P+'act-btn',null,mkSvg(ic,12));b.type='button';sa(b,'data-ag-diff-act',act);sa(b,'title',lbl);sa(b,'aria-label',lbl);b.addEventListener('click',(ev)=>{stopEv(ev);fn();});return b;};
return mk('div',P+'float-acts',null,mkB('sidebar','external',getUiText('inlineDiffOpenSidebar'),onOpenSb),mkB('collapse','close',getUiText('inlineDiffCollapse'),onCollapse));
}
function syncTop(topEl,actsEl,txt){
if(!doc||!topEl)return;
const old=qs(topEl,_C+'note');if(old)old.remove();
if(txt){topEl.className=P+'top';const nt=mk('div',P+'note',txt);if(actsEl&&actsEl.parentNode===topEl&&isFn(topEl.insertBefore))topEl.insertBefore(nt,actsEl);else topEl.appendChild(nt);}
else topEl.className=P+'top is-compact';
}
function pickFocusHunk(rows,mode,stObj,stepSt){
if(mode!=='git-diff')return-1;
const hm=new Map();for(let i=0;i<rows.length;i++){const r=rows[i];if(r.kind==='hunk')continue;let s=hm.get(r.hi);if(!s){s={idx:r.hi,a:0,d:0};hm.set(r.hi,s);}if(r.kind==='add')s.a++;else if(r.kind==='del')s.d++;}
const sf=stObj?.focusHunk;if(Number.isInteger(sf)&&sf>=0&&hm.has(sf))return sf;
if(!stObj?.cumulativeDiff||hm.size<2||!stepSt)return-1;
const hA=Math.max(0,Number(stepSt.additions)||0),hD=Math.max(0,Number(stepSt.deletions)||0);if(!hA&&!hD)return-1;
let bI=-1,bS=-Infinity;
for(const h of hm.values()){let sc=(hD>0?(h.d>0?10000:0)+(hA>0&&h.a>0&&h.d>0?5000:0):(hA>0&&h.a>0&&h.d===0?4000:0))+(h.a===hA&&h.d===hD?2000:0)-Math.abs(h.a-hA)*4-Math.abs(h.d-hD)*6-h.idx*.5;if(sc>bS){bS=sc;bI=h.idx;}}
return bI;
}
function scrollFocus(bodyEl,an){
if(!bodyEl||!an||isDead())return;
let top=0;
if(typeof an.offsetTop==='number'&&an.offsetTop>0){const bo=typeof bodyEl.offsetTop==='number'?bodyEl.offsetTop:0;top=an.offsetParent===bodyEl?an.offsetTop:Math.max(0,an.offsetTop-bo);}
else if(isFn(an.getBoundingClientRect)&&isFn(bodyEl.getBoundingClientRect)){const ar=an.getBoundingClientRect(),br=bodyEl.getBoundingClientRect();if(ar&&br&&Number.isFinite(ar.top)&&Number.isFinite(br.top))top=Math.max(0,(Number(bodyEl.scrollTop)||0)+ar.top-br.top);}
const tgt=Math.max(0,Math.round(top-10));
if(isFn(bodyEl.scrollTo)){try{bodyEl.scrollTo({top:tgt,behavior:shouldAnim()?'smooth':'auto'});}catch{bodyEl.scrollTop=tgt;}}else bodyEl.scrollTop=tgt;
}

function renderBody(bodyEl,lines,stateKind,metaMode,totalStats,opts=null){
if(!doc||!bodyEl)return{focusAnchor:null};
while(bodyEl.firstChild)bodyEl.removeChild(bodyEl.firstChild);
const topEl=opts?.topBar||null,actsEl=opts?.floatActs||null;
if(Array.isArray(lines)&&lines.length>0){
let notice='';
if(metaMode==='snapshot')notice=getUiText('inlineDiffSnapshotNotice');
else if(metaMode==='git-diff'&&totalStats?.cumulativeDiff===true)notice=getUiText('inlineDiffCumulativeNotice').replace('{a}',String(Number(totalStats.additions)||0)).replace('{d}',String(Number(totalStats.deletions)||0));
syncTop(topEl,actsEl,notice);
const allRows=[];let seen=false,gap=false,gapTitle='',hi=0;
for(let i=0;i<Math.min(lines.length,MAX_CLIENT_LINES);i++){
const r=lines[i];if(!isObj(r))continue;
const kind=r.kind==='add'||r.kind==='del'||r.kind==='hunk'?r.kind:'ctx';
if(kind==='hunk'){if(seen){gap=true;gapTitle=String(r.text||'');}continue;}
if(gap){gap=false;hi++;allRows.push({kind:'hunk',ln:'⋯',sign:'',text:gapTitle,nextHi:hi});gapTitle='';}
seen=true;allRows.push({kind,ln:String(r.ln??''),sign:String(r.sign??(kind==='add'?'+':kind==='del'?'-':' ')),text:trunc(r.text??''),hi});
}
const expanded=Boolean(opts?.expanded),onExpandAll=opts?.onExpandAll,onOpenSb=opts?.onOpenSb,rows=allRows.length>(expanded?MAX_CLIENT_LINES:PREVIEW_LIMIT)?allRows.slice(0,expanded?MAX_CLIENT_LINES:PREVIEW_LIMIT):allRows,llbl=getUiText('inlineDiffLongLinesTag','long line');
const fh=pickFocusHunk(rows,metaMode,totalStats,opts?.stepStats),stLbl=fh>=0?getUiText('inlineDiffStepBadge','This step'):'';
const mkTag=()=>{const t=mk('span',P+'step-tag',stLbl);sa(t,'data-ag-diff-focus-badge','1');return t;};
let f0=-1,f1=-1,focusAnchor=null;
if(fh>=0){
for(let i=0;i<rows.length;i++)if(rows[i].kind!=='hunk'&&rows[i].hi===fh){if(f0<0)f0=i;f1=i;}
if(fh===0&&f0>=0){const sep=mk('div',P+'focus-sep',null,mk('span',P+'ln','•'),mkTag(),mk('span',P+'gap-rule'));sa(sep,'data-ag-diff-focus','1');bodyEl.appendChild(sep);focusAnchor=sep;}
}
for(let i=0;i<rows.length;i++){
const r=rows[i];
if(r.kind==='hunk'){
const fs=fh>0&&r.nextHi===fh,hl=mk('div',P+(fs?'line is-hunk is-focus-sep':'line is-hunk'),null,mk('span',P+'ln','⋯'),fs?mkTag():null,mk('span',P+'gap-rule'));
if(r.text)sa(hl,'title',r.text);if(fs){sa(hl,'data-ag-diff-focus','1');focusAnchor=hl;}
bodyEl.appendChild(hl);continue;
}
const chg=r.kind==='add'||r.kind==='del',pSame=chg&&i>0&&rows[i-1].kind===r.kind,nSame=chg&&i+1<rows.length&&rows[i+1].kind===r.kind;
const gc=chg&&(pSame||nSame)?(!pSame?' is-grp-start':!nSame?' is-grp-end':' is-grp-mid'):'',isF=fh>=0&&r.hi===fh;
const fc=isF?` is-focus${i===f0?' is-focus-start':''}${i===f1?' is-focus-end':''}`:'';
const rn=mk('div',`${P}line is-${r.kind}${gc}${fc}`,null,mk('span',P+'ln',r.ln),mk('span',pSame?P+'sign is-cont':P+'sign',pSame?'┆':r.sign),mk('span',P+'code',r.text),r.text.endsWith('…')?mk('span',P+'wrap-tag',llbl):null);
if(isF){sa(rn,'data-ag-diff-focus','1');if(!focusAnchor&&i===f0)focusAnchor=rn;}
bodyEl.appendChild(rn);
}
const mkMore=(act,lbl,fn)=>{const b=mk('button',P+'more-bar',lbl);b.type='button';sa(b,'data-ag-diff-act',act);b.addEventListener('click',(ev)=>{stopEv(ev);fn(b);});bodyEl.appendChild(b);};
if(!expanded&&(allRows.length>PREVIEW_LIMIT||Boolean(totalStats?.truncated))&&isFn(onExpandAll)){
const rem=Math.max(0,Math.max(allRows.length,Number(totalStats?.totalLines)||0)-rows.length);
mkMore('expand-all',rem>0?getUiText('inlineDiffExpandAll','Expand all ({n} more lines)').replace('{n}',String(rem)):getUiText('inlineDiffExpandAllPlain','Expand all'),onExpandAll);
}else if(expanded&&(Boolean(totalStats?.truncated)||Number(totalStats?.totalLines)>rows.length||lines.length>=MAX_CLIENT_LINES)&&isFn(onOpenSb))mkMore('open-sidebar',getUiText('inlineDiffLargeExpandBtn'),onOpenSb);
return{focusAnchor};
}
syncTop(topEl,actsEl,'');
if(stateKind==='loading'){bodyEl.appendChild(mk('div',P+'loading',getUiText('inlineDiffLoading','Loading diff...')));return{focusAnchor:null};}
bodyEl.appendChild(mk('div',P+'empty',stateKind==='binary'?getUiText('inlineDiffBinary'):stateKind==='sensitive'?getUiText('inlineDiffSensitive'):getUiText('inlineDiffNoPreview')));
return{focusAnchor:null};
}

function findChipWrap(badgeEl){
if(!badgeEl)return null;
for(let d=0,cur=badgeEl.parentElement;d<4&&cur;d++,cur=cur.parentElement){
const tag=tagU(cur);if(tag==='BODY'||tag==='MAIN'||(cur.classList?.contains?.('group')&&cur.classList?.contains?.('w-full'))||ga(cur,'data-testid')==='tool-call-row')break;
if(Array.from(cur.childNodes||[]).some((n)=>n?.nodeType===3&&String(n.nodeValue||'').trim().length>0))continue;
const kids=Array.from(cur.children||[]).filter(isEl);
if(kids.length===2){const o=kids.find((k)=>k!==badgeEl&&!k.contains?.(badgeEl)),tx=String(o?.textContent||'').trim();const iv=Boolean(o&&!o.querySelector?.('[data-testid="entity-pill"], .inline-pill, svg, img')&&tx&&!tx.includes('.')&&!tx.includes('/')&&!tx.includes('\\')&&/^(?:created|edited|updated|deleted|modified|wrote|renamed|added|removed)$/i.test(tx));if(o&&!iv)return cur;}
}
return null;
}
function syncChips(scope=null){
if(isDead()||!doc?.querySelectorAll)return;
let badges;
if(scope&&scope!==doc){
const list=Array.isArray(scope)?scope:[scope],seen=new Set();
badges=[];
for(let i=0;i<list.length;i++){
const sc=list[i];if(!sc||sc.isConnected===false)continue;
if(ga(sc,'data-testid')==='diff-line-count'){if(!seen.has(sc)){seen.add(sc);badges.push(sc);}}
else if(isFn(sc.querySelectorAll))for(const b of qa(sc,S_CNT))if(!seen.has(b)){seen.add(b);badges.push(b);}
}
}else badges=qa(doc,S_CNT);
if(!badges.length)return;
mut(()=>{
for(const b of badges){
if(!b||cl(b,S_CHG))continue;
const bTxt=String(b.textContent||''),pc=b._agSyncedChip;
if(b._agSyncedTxt===bTxt&&!ga(b,'data-tooltip-id')&&(!pc||(pc.isConnected!==false&&ga(pc,'data-ag-diff-chip')==='1')))continue;
const tip=ga(b,'data-tooltip-id');if(tip){b._agOrigTooltipId=tip;ra(b,'data-tooltip-id');}
for(const sp of b.children||[]){if(!isEl(sp))continue;const st=String(sp.textContent||'').trim();if(/^\+[1-9]\d*/.test(st))setA(sp,'data-ag-diff-stat','add');else if(/^-[1-9]\d*/.test(st))setA(sp,'data-ag-diff-stat','del');else if(/^[+-]?0$/.test(st))setA(sp,'data-ag-diff-stat','zero');}
const chip=findChipWrap(b);b._agSyncedTxt=bTxt;b._agSyncedChip=chip||null;if(!chip)continue;
setA(chip,'data-ag-diff-chip','1');
for(let k=0,anc=chip.parentElement;k<3&&anc;k++,anc=anc.parentElement){if(anc.classList?.contains?.('w-full'))break;const cls=String(anc.className||'');if(cls.includes('overflow-hidden')||cls.includes('truncate'))setA(anc,'data-ag-diff-chip-row','1');}
for(const ch of chip.children||[]){if(!isEl(ch)||ch===b||ch.contains?.(b))continue;setA(ch,'data-ag-diff-chip-file','1');const ct=ga(ch,'data-tooltip-id');if(ct){ch._agOrigTooltipId=ct;ra(ch,'data-tooltip-id');}}
}
});
}
function closeCtxMenu(){if(!ctxMenu)return false;const el=ctxMenu;ctxMenu=null;mut(()=>{try{el.remove();}catch{}});return true;}
function openCtxMenu(ev,badgeEl){
if(isDead()||!doc?.body||!badgeEl)return false;
closeCtxMenu();
if(isFn(win?.dispatchEvent)){try{const C=win.CustomEvent||(typeof CustomEvent==='function'?CustomEvent:null);win.dispatchEvent(C?new C('ag-prism:ctx-open',{detail:{source:'inline-diff'}}):{type:'ag-prism:ctx-open',detail:{source:'inline-diff'}});}catch{}}
const rowEl=findHostRow(badgeEl),isOpen=ga(badgeEl,'data-ag-inline-diff-open')==='1',payload=extractInlineDiffPayload(badgeEl,rowEl,win);
const menu=markNoTrOwned(mk('div','ag-cs-diff-ctx-menu'));sa(menu,'role','menu');
const addItem=(ic,lbl,fn)=>{const b=mk('button','ag-cs-diff-ctx-item',null,mkSvg(ic,13),mk('span','',lbl));b.type='button';sa(b,'role','menuitem');b.addEventListener('click',(e)=>{stopEv(e);closeCtxMenu();fn();});menu.appendChild(b);};
addItem(isOpen?'close':'chevDown',isOpen?getUiText('inlineDiffMenuCollapse'):getUiText('inlineDiffMenuExpand'),()=>toggleInlineDiffPreview(badgeEl));
addItem('external',getUiText('inlineDiffOpenSidebar'),()=>{allowNative=true;try{badgeEl.click?.();}finally{allowNative=false;}});
if(payload.uri)addItem('moreDots',getUiText('inlineDiffMenuCopyPath'),()=>{try{win?.navigator?.clipboard?.writeText?.(String(payload.uri).replace(/^file:\/\/\/?/i,''));}catch{}});
const vw=Number(win?.innerWidth)||1280,vh=Number(win?.innerHeight)||800;
if(menu.style){menu.style.left=`${Math.max(8,Math.min(vw-208,Math.round(Number(ev?.clientX)||0)))}px`;menu.style.top=`${Math.max(8,Math.min(vh-124,Math.round(Number(ev?.clientY)||0)))}px`;menu.style.pointerEvents='auto';menu.style.contain='layout style';}
mut(()=>{const host=ensurePortal();if(host)host.appendChild(menu);});ctxMenu=menu;return true;
}
function shouldAnim(){
if(!win?.requestAnimationFrame||!doc?.getElementById)return false;
if(!byId(INLINE_DIFF_STYLE_ID)&&!byId('ag-prism-css')&&!byId('prism-style'))return false;
if((getCfg()||{}).motionLevel==='off'||ga(doc.documentElement,'data-ag-cs-motion')==='off')return false;
if(isFn(win.__agPrismReducedMotion))return!win.__agPrismReducedMotion(doc,win);
return ga(doc.documentElement,'data-ag-cs-ignore-rm')==='1'||!win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}
function clearBoxTimers(b){
if(!b)return;
for(const k of['_agCloseTimer','_agSettleTimer'])if(b[k]){clearTimeout(b[k]);animTimers.delete(b[k]);b[k]=0;}
if(b._agFocusRaf){try{win?.cancelAnimationFrame?.(b._agFocusRaf);}catch{}focusRafs.delete(b._agFocusRaf);b._agFocusRaf=0;}
}

function toggleInlineDiffPreview(chipOrBadge,opts=null){
if(isDead()||!doc||!chipOrBadge)return false;
const badgeEl=ga(chipOrBadge,'data-testid')==='diff-line-count'?chipOrBadge:qs(chipOrBadge,S_CNT)||chipOrBadge;if(!badgeEl)return false;
const rowEl=findHostRow(badgeEl);if(!rowEl?.parentNode)return false;
const chipEl=cl(badgeEl,'[data-ag-diff-chip="1"]')||findChipWrap(badgeEl);
const AO='data-ag-inline-diff-open',AH='data-ag-inline-diff-host',AA='data-ag-diff-anim',AS='data-ag-diff-state',BC=P+'box';
const nextSib=rowEl.nextElementSibling,noAnim=Boolean(opts&&opts.noAnim===true),allowAnim=!noAnim&&shouldAnim();
const schedSettle=(b,chk)=>{const tid=setTimeout(()=>{animTimers.delete(tid);b._agSettleTimer=0;if(!isDead()&&b.isConnected!==false&&(!chk||ga(b,AS)==='open'))mut(()=>ra(b,AA));},165);b._agSettleTimer=tid;animTimers.add(tid);};
if(nextSib?.classList?.contains(BC)&&nextSib._agDiffBadge===badgeEl){
if((ga(nextSib,AS)||'open')==='closing'){
if(opts&&opts.closeOnly)return true;
clearBoxTimers(nextSib);
mut(()=>{if(allowAnim)sa(nextSib,AA,'1');sa(nextSib,AS,'open');sa(badgeEl,AO,'1');if(chipEl)sa(chipEl,AO,'1');sa(rowEl,AH,'1');});
if(allowAnim)schedSettle(nextSib,false);stats.inlineDiffToggleCount++;return true;
}
if(opts&&opts.openOnly)return true;
clearBoxTimers(nextSib);nextSib._agDiffReqId=0;
if(allowAnim){
mut(()=>{ra(badgeEl,AO);if(chipEl)ra(chipEl,AO);sa(nextSib,AA,'1');sa(nextSib,AS,'closing');});
const tid=setTimeout(()=>{animTimers.delete(tid);nextSib._agCloseTimer=0;if(!isDead())mut(()=>{if(nextSib.parentNode)nextSib.remove();if(!rowEl.nextElementSibling?.classList?.contains(BC))ra(rowEl,AH);});},130);
nextSib._agCloseTimer=tid;animTimers.add(tid);
}else mut(()=>{nextSib.remove();ra(badgeEl,AO);if(chipEl)ra(chipEl,AO);ra(rowEl,AH);});
stats.inlineDiffToggleCount++;return true;
}
if(opts&&opts.closeOnly)return false;
const payload=extractInlineDiffPayload(badgeEl,rowEl,win);
if(!payload.lines.length&&!(payload.uri&&isFn(win?.__agPrismInlineDiffCall)))return false;
const stepStats={additions:payload.additions||0,deletions:payload.deletions||0,isCreated:Boolean(payload.isCreated)};
const openSb=()=>{allowNative=true;try{badgeEl.click?.();}finally{allowNative=false;}};
const floatActs=createFloatActs(openSb,()=>toggleInlineDiffPreview(badgeEl,{closeOnly:true,noAnim})),topBar=mk('div',P+'top is-compact',null,floatActs);
const body=mk('div',P+'body'),box=markNoTrOwned(mk('div',BC,null,mk('div',P+'card',null,topBar,body)));
sa(box,'data-ag-cs-inline-diff','1');box._agDiffBadge=badgeEl;box._agDiffReqId=0;
let curLines=[],curMode='',curTotalStats=null,expanded=false,didFocus=false,initAnchor=null;
const schedFocus=(an)=>{
if(!an||didFocus||isDead()||box.isConnected===false||!box.parentNode)return;
didFocus=true;
const run=()=>{if(box._agFocusRaf){focusRafs.delete(box._agFocusRaf);box._agFocusRaf=0;}if(!isDead()&&box.isConnected!==false&&an.parentNode===body)scrollFocus(body,an);};
if(isFn(win?.requestAnimationFrame)){const rid=win.requestAnimationFrame(run);box._agFocusRaf=rid;focusRafs.add(rid);}else run();
};
const draw=(defer)=>{const res=renderBody(body,curLines,'lines',curMode,curTotalStats,{expanded,onExpandAll,onOpenSb:openSb,topBar,floatActs,stepStats});if(defer)initAnchor=res.focusAnchor;else schedFocus(res.focusAnchor);};
const onExpandAll=(btnEl)=>{
if(expanded)return;
const done=(r)=>{expanded=true;mut(()=>{sa(box,'data-ag-diff-expanded','1');if(r?.ok&&Array.isArray(r.lines)&&r.lines.length){curLines=r.lines;curMode=r.mode||curMode;curTotalStats=r;}draw(false);});};
if(!curTotalStats?.truncated||!payload.uri||!isFn(win?.__agPrismInlineDiffCall)){done(null);return;}
if(btnEl){btnEl.disabled=true;btnEl.textContent=getUiText('inlineDiffLoading','Loading diff...');}
const req=requestDaemon(payload.uri,stepStats,true);if(!req){done(null);return;}
const eid=req.reqId;box._agDiffReqId=eid;
const finish=(r)=>{if(!isDead()&&box.isConnected!==false&&box._agDiffReqId===eid)done(r);};
if(req.cached)finish(req.cached);else req.promise.then(finish);
};
const applyResp=(resp,defer)=>{
if(resp?.ok&&Array.isArray(resp.lines)&&resp.lines.length>0){curLines=resp.lines;curMode=resp.mode||'git-diff';curTotalStats=resp;draw(defer);}
else renderBody(body,[],resp?.mode==='binary'?'binary':resp?.error==='blocked_sensitive'?'sensitive':'empty','',null,{topBar,floatActs});
};
let pendingRpc=null;
if(payload.lines.length){curLines=payload.lines;curMode=payload.source||'step-patch';curTotalStats={totalLines:payload.totalLines||payload.lines.length,truncated:false};draw(true);}
else{pendingRpc=requestDaemon(payload.uri,stepStats,false);if(pendingRpc?.cached){applyResp(pendingRpc.cached,true);pendingRpc=null;}else{renderBody(body,[],'loading','',null,{topBar,floatActs});if(pendingRpc)box._agDiffReqId=pendingRpc.reqId;}}
sa(box,AS,'open');if(allowAnim)sa(box,AA,'1');
mut(()=>{if(nextSib?.classList?.contains(BC)){clearBoxTimers(nextSib);nextSib._agDiffReqId=0;nextSib.remove();}rowEl.parentNode.insertBefore(box,rowEl.nextElementSibling||null);sa(badgeEl,AO,'1');if(chipEl)sa(chipEl,AO,'1');sa(rowEl,AH,'1');});
if(initAnchor)schedFocus(initAnchor);
if(allowAnim)schedSettle(box,true);
if(pendingRpc){const eid=pendingRpc.reqId;pendingRpc.promise.then((r)=>{if(!isDead()&&box.isConnected!==false&&box._agDiffReqId===eid)mut(()=>applyResp(r,false));});}
stats.inlineDiffToggleCount++;return true;
}

function resolveBadge(t){if(!t?.closest)return null;const d=cl(t,S_CNT);if(d&&!cl(d,S_CHG))return d;const b=qs(cl(t,'[data-ag-diff-chip="1"]'),S_CNT);return b&&!cl(b,S_CHG)?b:cl(t,_C+'box')?._agDiffBadge||null;}
const clearHover=()=>{if(hoverTmr){clearTimeout(hoverTmr);hoverTmr=0;}};
const onClick=(ev)=>{try{const t=ev?.target;if(isDead()||!t?.closest)return;if(ctxMenu&&!cl(t,'.ag-cs-diff-ctx-menu'))closeCtxMenu();if(!allowNative&&!cl(t,_C+'box')){const db=resolveBadge(t);if(db){if(toggleInlineDiffPreview(db))stopEv(ev);return;}}if(cl(t,'button, [role="button"]')){if(syncTmr)clearTimeout(syncTmr);syncTmr=setTimeout(()=>{syncTmr=0;if(!isDead())syncChips();},24);}}catch{}};
const onPtrDown=(ev)=>{try{if(!isDead()&&ctxMenu&&(!ev?.target?.closest||!cl(ev.target,'.ag-cs-diff-ctx-menu')))closeCtxMenu();}catch{}};
const onCtxMenu=(ev)=>{try{if(isDead()||!ev?.target?.closest)return;const t=ev.target,db=resolveBadge(t);if(!db||ev.shiftKey){closeCtxMenu();return;}if(cl(t,_C+'box')&&String(win?.getSelection?.()||'').trim().length>0){closeCtxMenu();return;}if(openCtxMenu(ev,db))stopEv(ev);}catch{}};
const onKeyDown=(ev)=>{try{if(!isDead()&&ev?.key==='Escape'&&ctxMenu&&closeCtxMenu())stopEv(ev);}catch{}};
const onPtrOver=(ev)=>{try{const t=ev?.target;if(isDead()||!t?.closest)return;if(!isFn(win?.__agPrismInlineDiffCall)){clearHover();return;}const hit=cl(t,`${_C}box, ${S_CNT}, [data-ag-diff-chip="1"]`);if(!hit||hit.classList?.contains?.(P+'box')||cl(hit,S_CHG)){clearHover();return;}const db=ga(hit,'data-testid')==='diff-line-count'?hit:qs(hit,S_CNT);if(!db||ga(db,'data-ag-inline-diff-open')==='1'){clearHover();return;}clearHover();hoverTmr=setTimeout(()=>{hoverTmr=0;if(isDead()||db.isConnected===false)return;const p=extractInlineDiffPayload(db,findHostRow(db),win);if(p.uri&&!p.lines.length)requestDaemon(p.uri,{additions:p.additions||0,deletions:p.deletions||0,isCreated:Boolean(p.isCreated)},false);},110);}catch{}};
const onPtrOut=(ev)=>{try{if(hoverTmr&&(!ev?.relatedTarget?.closest||!resolveBadge(ev.relatedTarget)))clearHover();}catch{}};
const onScroll=(ev)=>{try{if(ctxMenu&&!(ev?.target&&ctxMenu.contains?.(ev.target)))closeCtxMenu();}catch{}};
const onBlur=()=>{try{if(ctxMenu)closeCtxMenu();}catch{}};
const onBus=(ev)=>{try{if(ev?.detail?.source!=='inline-diff')closeCtxMenu();}catch{}};
const EVS=[['click',onClick,true],['pointerdown',onPtrDown,true],['contextmenu',onCtxMenu,true],['keydown',onKeyDown,true],['pointerover',onPtrOver,{passive:true}],['pointerout',onPtrOut,{passive:true}],['scroll',onScroll,{capture:true,passive:true}],['blur',onBlur,false],['resize',onBlur,false],['ag-prism:ctx-open',onBus,false]];
if(isFn(win?.addEventListener))for(const[t,fn,o]of EVS)win.addEventListener(t,fn,o);
ensureStyle();

function unbindHooks(){hookT=baseT;hookGetLang=baseGetLang;hookMut=baseMut;hookSetA=baseSetA;}
function sync(nextCfg,hooks){if(isDead())return;if(isObj(nextCfg))cfg={...cfg,...nextCfg};if(isObj(hooks)){if(isFn(hooks.t))hookT=hooks.t;if(isFn(hooks.getLang))hookGetLang=hooks.getLang;if(isFn(hooks.runGuardedMut))hookMut=hooks.runGuardedMut;if(isFn(hooks.setAttrIfChanged))hookSetA=hooks.setAttrIfChanged;}ensureStyle();syncChips(hooks?.scope||hooks?.scopes||null);}
function destroy(){
if(dead)return;dead=true;
for(const tid of animTimers)clearTimeout(tid);animTimers.clear();
for(const rid of focusRafs){try{win?.cancelAnimationFrame?.(rid);}catch{}}focusRafs.clear();clearHover();
if(syncTmr){clearTimeout(syncTmr);syncTmr=0;}closeCtxMenu();
for(const e of pending.values()){if(e?.timer)clearTimeout(e.timer);try{e?.resolve?.(null);}catch{}}pending.clear();inflight.clear();cache.clear();
if(win&&win.__agPrismInlineDiffResolve===onResolve){try{delete win.__agPrismInlineDiffResolve;}catch{}}
if(isFn(win?.removeEventListener))for(const[t,fn,o]of EVS){try{win.removeEventListener(t,fn,o);}catch{}}
if(isFn(doc?.querySelectorAll)){
mut(()=>{
for(const s of[_C+'box','.ag-cs-diff-ctx-menu'])qa(doc,s).forEach((n)=>n.remove());
const pt=byId(PORTAL_ID)||qs(doc.body,'#'+PORTAL_ID);if(pt&&ga(pt,'data-ag-owned')==='1'&&!(pt.children&&pt.children.length))pt.remove();
qa(doc,`${S_CNT}, [data-ag-diff-chip-file="1"]`).forEach((el)=>{if(el._agOrigTooltipId){sa(el,'data-tooltip-id',el._agOrigTooltipId);delete el._agOrigTooltipId;}delete el._agSyncedTxt;delete el._agSyncedChip;});
for(const k of'diff-chip|diff-chip-file|diff-chip-row|diff-stat|diff-focus|diff-focus-badge|inline-diff-open|inline-diff-host|diff-anim|diff-state|diff-expanded|cs-inline-diff'.split('|'))qa(doc,`[data-ag-${k}]`).forEach((el)=>ra(el,'data-ag-'+k));
});
}
mut(()=>{try{(byId(INLINE_DIFF_STYLE_ID)||styleEl)?.remove?.();}catch{}});
styleEl=null;unbindHooks();
if(win&&win.__agPrismInlineDiff===selfApi){try{delete win.__agPrismInlineDiff;}catch{}}
if(G&&G.__agPrismInlineDiff===selfApi){try{delete G.__agPrismInlineDiff;}catch{}}
}

selfApi={sync,unbindHooks,toggleInlineDiffPreview,closeMenuIfOpen:closeCtxMenu,getDebugState:()=>({inlineDiffToggleCount:stats.inlineDiffToggleCount,cacheSize:cache.size,pendingSize:pending.size,menuOpen:Boolean(ctxMenu),styleMounted:Boolean(byId(INLINE_DIFF_STYLE_ID)),destroyed:Boolean(dead)}),destroy,extractInlineDiffPayload:(b,r)=>extractInlineDiffPayload(b,r,win)};
return selfApi;
}

const W=typeof window!=='undefined'?window:G,D=typeof document!=='undefined'?document:W?.document||null;
if(W){try{W.__agPrismInlineDiffFactory=createInlineDiffClient;}catch{}}
if(G&&G!==W){try{G.__agPrismInlineDiffFactory=createInlineDiffClient;}catch{}}
if(W&&D&&isFn(D.createElement)){try{W.__agPrismInlineDiff?.destroy?.();}catch{}try{const inst=createInlineDiffClient({win:W,doc:D});W.__agPrismInlineDiff=inst;if(G&&G!==W)G.__agPrismInlineDiff=inst;inst.sync();}catch{}}
if(typeof module==='object'&&module.exports){module.exports={STYLE_ID:INLINE_DIFF_STYLE_ID,PORTAL_ID,INLINE_DIFF_CSS,parseUnifiedDiffLines,buildPairDiffLines,extractInlineDiffPayload,createInlineDiffClient};}
})(typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:this);
