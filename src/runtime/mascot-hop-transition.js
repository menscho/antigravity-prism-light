// 桌宠跨窗格注意力聚焦判定与「翻身潜入 -> 弹性蹦出」物理跃迁模块（Ch10 前置模块，0 外部依赖，0 innerHTML）
(function (root, factory) {
const api = factory(root);
if (typeof module === 'object' && module.exports) module.exports = api;
if (root && typeof root === 'object') {
root.__agPrismMascotHop = api;
try { if (root.window && root.window !== root) root.window.__agPrismMascotHop = api; } catch {}
}
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function (G) {
'use strict';

const STYLE_ID = 'ag-prism-mascot-hop-style';
const HOP_LAYER_CLASS = 'ag-prism-mascot-hop-layer';
const ATTR_HOP = 'data-ag-mascot-hop';
const ATTR_HOP_MODE = 'data-ag-mascot-hop-mode';
const ATTR_HOP_SELF = 'data-ag-mascot-hop-self';
const IGNORE_RM_ATTR = 'data-ag-cs-ignore-rm';
const MOTION_ATTR = 'data-ag-cs-motion';

const IGNORED_SCOPE_SEL = '#ag-cs-settings-sec, #ag-prism-periodic-picker-root, [role="dialog"]';
/* @host-compat host-selectors.cjs#HOST_INTERACTION_SELECTORS */
const TAKEOVER_BOX_SEL = '[data-testid="interaction-takeover-card"], .agy-takeover-frame, [data-testid="side-question-panel"]';
const COMPOSER_BOX_SEL = '.surface-composer-card, [data-testid="agent-input-box"], #antigravity\\.agentSidePanelInputBox, [data-composer-input], ' + TAKEOVER_BOX_SEL;
const INPUT_FIELD_SEL = '[contenteditable="true"], [contenteditable=""], [data-lexical-editor], textarea, input, [role="textbox"]';
const SIDE_PANEL_SEL = '#antigravity\\.agentSidePanelInputBox, [data-side-panel-focus-scope="true"], [data-side-panel-body], [data-side-panel-strip], [data-testid="side-question-panel"], [data-testid="agent-side-panel"], .agent-side-panel, .aux-drawer';
const SUBAGENT_SEL = '[data-testid="subagent-tab-conversation"], [data-testid="side-question-tab-conversation"]';
const PANE_SCOPE_SEL = '[data-testid="conversation-view"], [data-tiling-pane], [data-side-panel-body], [data-side-panel-focus-scope="true"]';

const HOP_CSS = [
':is(.ag-cs-dual-stage,.ag-cs-crab):is([data-ag-mascot-hop="dive-out"],[data-ag-mascot-hop="pop-in"]){clip-path:inset(-120px -72px 0 -72px);overflow:visible!important;pointer-events:none!important}',
':is(.ag-cs-dual-stage,.ag-cs-crab):is([data-ag-mascot-hop="hop-up"],[data-ag-mascot-hop="gravity-land"]){clip-path:none;overflow:visible!important;pointer-events:none!important}',
'.ag-cs-dual-stage[data-ag-mascot-hop] .ag-v2-mascot-actor{transition:none!important;pointer-events:none!important}',
'.ag-cs-dual-stage[data-ag-mascot-hop] .ag-v2-mascot-canvas{will-change:transform,opacity;transform-origin:50% 80%}',
'.ag-cs-dual-stage:is([data-ag-mascot-hop="hop-up"],[data-ag-mascot-hop="gravity-land"]) .ag-v2-mascot-canvas{transform-origin:50% 88%}',
'.ag-cs-dual-stage[data-ag-mascot-hop] .ag-v2-mini-crab-canvas{transition:none!important;will-change:transform,opacity;transform-origin:20px 26px;pointer-events:none!important}',
'.ag-cs-dual-stage[data-ag-mascot-hop] .ag-v2-habitat-prop{will-change:transform,opacity;transform-origin:50% 100%}',
'.ag-cs-dual-stage[data-ag-mascot-hop="dive-out"] .ag-v2-mascot-actor::after{opacity:0!important;transition:opacity 90ms ease-out!important}',
'.ag-cs-dual-stage[data-ag-mascot-hop="pop-in"] .ag-v2-mascot-actor::after{animation:ag-prism-hop-shadow-in var(--ag-prism-hop-dur,280ms) ease-out var(--ag-prism-hop-delay,0ms) both}',
'.ag-cs-dual-stage:is([data-ag-mascot-hop="hop-up"],[data-ag-mascot-hop="gravity-land"]) .ag-v2-mascot-actor::after{animation:ag-prism-roof-shadow var(--ag-prism-hop-dur,360ms) ease-out var(--ag-prism-hop-delay,0ms) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="dive-out"][data-ag-mascot-hop-mode="full"] .ag-v2-mascot-canvas{animation:ag-prism-mascot-dive-out var(--ag-prism-hop-dur,220ms) cubic-bezier(.32,0,.67,.22) var(--ag-prism-hop-delay,0ms) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="pop-in"][data-ag-mascot-hop-mode="full"] .ag-v2-mascot-canvas{animation:ag-prism-mascot-pop-in var(--ag-prism-hop-dur,280ms) cubic-bezier(.22,1,.36,1) var(--ag-prism-hop-delay,0ms) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="dive-out"][data-ag-mascot-hop-mode="subtle"] .ag-v2-mascot-canvas{animation:ag-prism-mascot-dive-subtle var(--ag-prism-hop-dur,140ms) ease-in var(--ag-prism-hop-delay,0ms) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="pop-in"][data-ag-mascot-hop-mode="subtle"] .ag-v2-mascot-canvas{animation:ag-prism-mascot-pop-subtle var(--ag-prism-hop-dur,170ms) cubic-bezier(.22,1,.36,1) var(--ag-prism-hop-delay,0ms) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="hop-up"][data-ag-mascot-hop-mode="full"] .ag-v2-mascot-canvas{animation:ag-prism-mascot-hop-up var(--ag-prism-hop-dur,320ms) cubic-bezier(.22,1,.36,1) var(--ag-prism-hop-delay,0ms) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="hop-up"][data-ag-mascot-hop-mode="subtle"] .ag-v2-mascot-canvas{animation:ag-prism-mascot-hop-up-subtle var(--ag-prism-hop-dur,180ms) ease-out var(--ag-prism-hop-delay,0ms) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="gravity-land"][data-ag-mascot-hop-mode="full"] .ag-v2-mascot-canvas{animation:ag-prism-mascot-gravity-land var(--ag-prism-hop-dur,380ms) linear var(--ag-prism-hop-delay,0ms) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="gravity-land"][data-ag-mascot-hop-mode="subtle"] .ag-v2-mascot-canvas{animation:ag-prism-mascot-gravity-land-subtle var(--ag-prism-hop-dur,210ms) ease-out var(--ag-prism-hop-delay,0ms) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="dive-out"][data-ag-mascot-hop-mode="full"] .ag-v2-mini-crab-canvas{animation:ag-prism-mini-dive-out var(--ag-prism-hop-dur,220ms) cubic-bezier(.32,0,.67,.22) var(--ag-prism-hop-delay,0ms) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="pop-in"][data-ag-mascot-hop-mode="full"] .ag-v2-mini-crab-canvas{animation:ag-prism-mini-pop-in var(--ag-prism-hop-dur,280ms) cubic-bezier(.22,1,.36,1) var(--ag-prism-hop-delay,0ms) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="dive-out"][data-ag-mascot-hop-mode="subtle"] .ag-v2-mini-crab-canvas{animation:ag-prism-mini-dive-subtle var(--ag-prism-hop-dur,140ms) ease-in var(--ag-prism-hop-delay,0ms) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="pop-in"][data-ag-mascot-hop-mode="subtle"] .ag-v2-mini-crab-canvas{animation:ag-prism-mini-pop-subtle var(--ag-prism-hop-dur,170ms) cubic-bezier(.22,1,.36,1) var(--ag-prism-hop-delay,0ms) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="hop-up"][data-ag-mascot-hop-mode="full"] .ag-v2-mini-crab-canvas{animation:ag-prism-mini-hop-up var(--ag-prism-hop-dur,320ms) cubic-bezier(.22,1,.36,1) var(--ag-prism-hop-delay,0ms) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="hop-up"][data-ag-mascot-hop-mode="subtle"] .ag-v2-mini-crab-canvas{animation:ag-prism-mini-hop-up-subtle var(--ag-prism-hop-dur,180ms) ease-out var(--ag-prism-hop-delay,0ms) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="gravity-land"][data-ag-mascot-hop-mode="full"] .ag-v2-mini-crab-canvas{animation:ag-prism-mini-gravity-land var(--ag-prism-hop-dur,380ms) linear var(--ag-prism-hop-delay,0ms) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="gravity-land"][data-ag-mascot-hop-mode="subtle"] .ag-v2-mini-crab-canvas{animation:ag-prism-mini-gravity-land-subtle var(--ag-prism-hop-dur,210ms) ease-out var(--ag-prism-hop-delay,0ms) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="dive-out"] .ag-v2-habitat-prop{animation:ag-prism-prop-dive-out var(--ag-prism-hop-dur,220ms) ease-in both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="pop-in"] .ag-v2-habitat-prop{animation:ag-prism-prop-pop-in var(--ag-prism-hop-dur,280ms) cubic-bezier(.22,1,.36,1) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="hop-up"] .ag-v2-habitat-prop{animation:ag-prism-prop-hop-up var(--ag-prism-hop-dur,320ms) cubic-bezier(.22,1,.36,1) both}',
'.ag-cs-dual-stage[data-ag-mascot-hop="gravity-land"] .ag-v2-habitat-prop{animation:ag-prism-prop-gravity-land var(--ag-prism-hop-dur,380ms) cubic-bezier(.22,1,.36,1) both}',
'.ag-cs-crab[data-ag-mascot-hop-self="1"]{will-change:transform,opacity;transform-origin:50% 80%}',
'.ag-cs-crab[data-ag-mascot-hop-self="1"]:is([data-ag-mascot-hop="hop-up"],[data-ag-mascot-hop="gravity-land"]){transform-origin:50% 88%}',
'.ag-cs-crab[data-ag-mascot-hop-self="1"][data-ag-mascot-hop="dive-out"][data-ag-mascot-hop-mode="full"]{animation:ag-prism-mascot-dive-out var(--ag-prism-hop-dur,220ms) cubic-bezier(.32,0,.67,.22) both}',
'.ag-cs-crab[data-ag-mascot-hop-self="1"][data-ag-mascot-hop="pop-in"][data-ag-mascot-hop-mode="full"]{animation:ag-prism-mascot-pop-in var(--ag-prism-hop-dur,280ms) cubic-bezier(.22,1,.36,1) both}',
'.ag-cs-crab[data-ag-mascot-hop-self="1"][data-ag-mascot-hop="dive-out"][data-ag-mascot-hop-mode="subtle"]{animation:ag-prism-mascot-dive-subtle var(--ag-prism-hop-dur,140ms) ease-in both}',
'.ag-cs-crab[data-ag-mascot-hop-self="1"][data-ag-mascot-hop="pop-in"][data-ag-mascot-hop-mode="subtle"]{animation:ag-prism-mascot-pop-subtle var(--ag-prism-hop-dur,170ms) cubic-bezier(.22,1,.36,1) both}',
'.ag-cs-crab[data-ag-mascot-hop-self="1"][data-ag-mascot-hop="hop-up"][data-ag-mascot-hop-mode="full"]{animation:ag-prism-mascot-hop-up var(--ag-prism-hop-dur,320ms) cubic-bezier(.22,1,.36,1) both}',
'.ag-cs-crab[data-ag-mascot-hop-self="1"][data-ag-mascot-hop="hop-up"][data-ag-mascot-hop-mode="subtle"]{animation:ag-prism-mascot-hop-up-subtle var(--ag-prism-hop-dur,180ms) ease-out both}',
'.ag-cs-crab[data-ag-mascot-hop-self="1"][data-ag-mascot-hop="gravity-land"][data-ag-mascot-hop-mode="full"]{animation:ag-prism-mascot-gravity-land var(--ag-prism-hop-dur,380ms) linear both}',
'.ag-cs-crab[data-ag-mascot-hop-self="1"][data-ag-mascot-hop="gravity-land"][data-ag-mascot-hop-mode="subtle"]{animation:ag-prism-mascot-gravity-land-subtle var(--ag-prism-hop-dur,210ms) ease-out both}',
'@keyframes ag-prism-mascot-dive-out{0%{transform:translate3d(0,0,0) rotate(0deg) scale(1,1);opacity:1}20%{transform:translate3d(0,5px,0) rotate(calc(-8deg * var(--ag-prism-hop-dir,1))) scale(1.12,.82);opacity:1}46%{transform:translate3d(calc(5px * var(--ag-prism-hop-dir,1)),-8px,0) rotate(calc(58deg * var(--ag-prism-hop-dir,1))) scale(.92,1.06);opacity:.96}78%{transform:translate3d(calc(11px * var(--ag-prism-hop-dir,1)),24px,0) rotate(calc(132deg * var(--ag-prism-hop-dir,1))) scale(.78,.74);opacity:.44}100%{transform:translate3d(calc(14px * var(--ag-prism-hop-dir,1)),48px,0) rotate(calc(168deg * var(--ag-prism-hop-dir,1))) scale(.68,.62);opacity:0}}',
'@keyframes ag-prism-mascot-pop-in{0%{transform:translate3d(calc(-10px * var(--ag-prism-hop-dir,1)),46px,0) rotate(calc(-36deg * var(--ag-prism-hop-dir,1))) scale(.74,1.12);opacity:0}24%{transform:translate3d(calc(-4px * var(--ag-prism-hop-dir,1)),4px,0) rotate(calc(-10deg * var(--ag-prism-hop-dir,1))) scale(.9,1.14);opacity:1}52%{transform:translate3d(0,-18px,0) rotate(calc(8deg * var(--ag-prism-hop-dir,1))) scale(.94,1.09);opacity:1}78%{transform:translate3d(0,4px,0) rotate(calc(-2deg * var(--ag-prism-hop-dir,1))) scale(1.13,.85);opacity:1}90%{transform:translate3d(0,-2px,0) rotate(0deg) scale(.97,1.04);opacity:1}100%{transform:translate3d(0,0,0) rotate(0deg) scale(1,1);opacity:1}}',
'@keyframes ag-prism-mascot-dive-subtle{0%{transform:translate3d(0,0,0) rotate(0deg) scale(1,1);opacity:1}30%{transform:translate3d(0,3px,0) rotate(calc(-4deg * var(--ag-prism-hop-dir,1))) scale(1.04,.94);opacity:1}100%{transform:translate3d(calc(5px * var(--ag-prism-hop-dir,1)),28px,0) rotate(calc(32deg * var(--ag-prism-hop-dir,1))) scale(.86,.82);opacity:0}}',
'@keyframes ag-prism-mascot-pop-subtle{0%{transform:translate3d(calc(-4px * var(--ag-prism-hop-dir,1)),26px,0) rotate(calc(-10deg * var(--ag-prism-hop-dir,1))) scale(.88,1.05);opacity:0}48%{transform:translate3d(0,-7px,0) rotate(calc(3deg * var(--ag-prism-hop-dir,1))) scale(.97,1.04);opacity:1}82%{transform:translate3d(0,2px,0) rotate(0deg) scale(1.05,.94);opacity:1}100%{transform:translate3d(0,0,0) rotate(0deg) scale(1,1);opacity:1}}',
'@keyframes ag-prism-mascot-hop-up{0%{transform:translate3d(0,var(--ag-prism-roof-dy,48px),0) scale(1.08,.9)}28%{transform:translate3d(0,calc(var(--ag-prism-roof-dy,48px) * .24 - 14px),0) scale(.93,1.1)}62%{transform:translate3d(0,-10px,0) scale(.96,1.05)}82%{transform:translate3d(0,3px,0) scale(1.09,.89)}92%{transform:translate3d(0,-1px,0) scale(.98,1.03)}100%{transform:translate3d(0,0,0) scale(1,1)}}',
'@keyframes ag-prism-mascot-hop-up-subtle{0%{transform:translate3d(0,calc(var(--ag-prism-roof-dy,48px) * .55),0) scale(1.03,.96)}65%{transform:translate3d(0,-4px,0) scale(.98,1.02)}100%{transform:translate3d(0,0,0) scale(1,1)}}',
'@keyframes ag-prism-mascot-gravity-land{0%{transform:translate3d(0,calc(-1 * var(--ag-prism-roof-dy,48px)),0) scale(.96,1.05)}18%{transform:translate3d(0,calc(-.88 * var(--ag-prism-roof-dy,48px)),0) scale(.95,1.06)}44%{transform:translate3d(0,calc(-.34 * var(--ag-prism-roof-dy,48px)),0) scale(.93,1.09)}64%{transform:translate3d(0,4px,0) scale(1.12,.86)}82%{transform:translate3d(0,-3px,0) scale(.96,1.05)}92%{transform:translate3d(0,1px,0) scale(1.03,.98)}100%{transform:translate3d(0,0,0) scale(1,1)}}',
'@keyframes ag-prism-mascot-gravity-land-subtle{0%{transform:translate3d(0,calc(-.6 * var(--ag-prism-roof-dy,48px)),0) scale(.98,1.02)}64%{transform:translate3d(0,2px,0) scale(1.06,.93)}84%{transform:translate3d(0,-1px,0) scale(.98,1.02)}100%{transform:translate3d(0,0,0) scale(1,1)}}',
'@keyframes ag-prism-mini-dive-out{0%{transform:translate3d(var(--ag-prism-hop-bx,0px),var(--ag-prism-hop-by,0px),0) rotate(0deg) scale(1,1);opacity:1}22%{transform:translate3d(var(--ag-prism-hop-bx,0px),calc(var(--ag-prism-hop-by,0px) + 3px),0) rotate(calc(-8deg * var(--ag-prism-hop-dir,1))) scale(1.12,.82);opacity:1}52%{transform:translate3d(calc(var(--ag-prism-hop-bx,0px) + 4px * var(--ag-prism-hop-dir,1)),calc(var(--ag-prism-hop-by,0px) - 5px),0) rotate(calc(68deg * var(--ag-prism-hop-dir,1))) scale(.92,1.04);opacity:.95}100%{transform:translate3d(calc(var(--ag-prism-hop-bx,0px) + 9px * var(--ag-prism-hop-dir,1)),calc(var(--ag-prism-hop-by,0px) + 34px),0) rotate(calc(162deg * var(--ag-prism-hop-dir,1))) scale(.66,.62);opacity:0}}',
'@keyframes ag-prism-mini-pop-in{0%{transform:translate3d(calc(var(--ag-prism-hop-bx,0px) - 7px * var(--ag-prism-hop-dir,1)),calc(var(--ag-prism-hop-by,0px) + 32px),0) rotate(calc(-34deg * var(--ag-prism-hop-dir,1))) scale(.74,1.12);opacity:0}26%{transform:translate3d(calc(var(--ag-prism-hop-bx,0px) - 2px * var(--ag-prism-hop-dir,1)),calc(var(--ag-prism-hop-by,0px) + 2px),0) rotate(calc(-8deg * var(--ag-prism-hop-dir,1))) scale(.9,1.12);opacity:1}56%{transform:translate3d(var(--ag-prism-hop-bx,0px),calc(var(--ag-prism-hop-by,0px) - 13px),0) rotate(calc(7deg * var(--ag-prism-hop-dir,1))) scale(.95,1.08);opacity:1}82%{transform:translate3d(var(--ag-prism-hop-bx,0px),calc(var(--ag-prism-hop-by,0px) + 3px),0) rotate(0deg) scale(1.12,.86);opacity:1}100%{transform:translate3d(var(--ag-prism-hop-bx,0px),var(--ag-prism-hop-by,0px),0) rotate(0deg) scale(1,1);opacity:1}}',
'@keyframes ag-prism-mini-dive-subtle{0%{transform:translate3d(var(--ag-prism-hop-bx,0px),var(--ag-prism-hop-by,0px),0) rotate(0deg) scale(1,1);opacity:1}100%{transform:translate3d(calc(var(--ag-prism-hop-bx,0px) + 4px * var(--ag-prism-hop-dir,1)),calc(var(--ag-prism-hop-by,0px) + 22px),0) rotate(calc(28deg * var(--ag-prism-hop-dir,1))) scale(.86,.82);opacity:0}}',
'@keyframes ag-prism-mini-pop-subtle{0%{transform:translate3d(calc(var(--ag-prism-hop-bx,0px) - 3px * var(--ag-prism-hop-dir,1)),calc(var(--ag-prism-hop-by,0px) + 20px),0) rotate(calc(-8deg * var(--ag-prism-hop-dir,1))) scale(.88,1.04);opacity:0}54%{transform:translate3d(var(--ag-prism-hop-bx,0px),calc(var(--ag-prism-hop-by,0px) - 5px),0) rotate(0deg) scale(.97,1.03);opacity:1}100%{transform:translate3d(var(--ag-prism-hop-bx,0px),var(--ag-prism-hop-by,0px),0) rotate(0deg) scale(1,1);opacity:1}}',
'@keyframes ag-prism-mini-hop-up{0%{transform:translate3d(var(--ag-prism-hop-bx,0px),calc(var(--ag-prism-hop-by,0px) + var(--ag-prism-roof-dy,48px)),0) scale(1.08,.9)}32%{transform:translate3d(var(--ag-prism-hop-bx,0px),calc(var(--ag-prism-hop-by,0px) + var(--ag-prism-roof-dy,48px) * .22 - 11px),0) scale(.94,1.08)}66%{transform:translate3d(var(--ag-prism-hop-bx,0px),calc(var(--ag-prism-hop-by,0px) - 8px),0) scale(.96,1.05)}84%{transform:translate3d(var(--ag-prism-hop-bx,0px),calc(var(--ag-prism-hop-by,0px) + 2px),0) scale(1.1,.88)}100%{transform:translate3d(var(--ag-prism-hop-bx,0px),var(--ag-prism-hop-by,0px),0) scale(1,1)}}',
'@keyframes ag-prism-mini-hop-up-subtle{0%{transform:translate3d(var(--ag-prism-hop-bx,0px),calc(var(--ag-prism-hop-by,0px) + var(--ag-prism-roof-dy,48px) * .5),0) scale(1.03,.96)}100%{transform:translate3d(var(--ag-prism-hop-bx,0px),var(--ag-prism-hop-by,0px),0) scale(1,1)}}',
'@keyframes ag-prism-mini-gravity-land{0%{transform:translate3d(var(--ag-prism-hop-bx,0px),calc(var(--ag-prism-hop-by,0px) - var(--ag-prism-roof-dy,48px)),0) scale(.96,1.05)}44%{transform:translate3d(var(--ag-prism-hop-bx,0px),calc(var(--ag-prism-hop-by,0px) - var(--ag-prism-roof-dy,48px) * .32),0) scale(.94,1.08)}64%{transform:translate3d(var(--ag-prism-hop-bx,0px),calc(var(--ag-prism-hop-by,0px) + 3px),0) scale(1.12,.86)}82%{transform:translate3d(var(--ag-prism-hop-bx,0px),calc(var(--ag-prism-hop-by,0px) - 2px),0) scale(.96,1.05)}100%{transform:translate3d(var(--ag-prism-hop-bx,0px),var(--ag-prism-hop-by,0px),0) scale(1,1)}}',
'@keyframes ag-prism-mini-gravity-land-subtle{0%{transform:translate3d(var(--ag-prism-hop-bx,0px),calc(var(--ag-prism-hop-by,0px) - var(--ag-prism-roof-dy,48px) * .55),0) scale(.98,1.02)}64%{transform:translate3d(var(--ag-prism-hop-bx,0px),calc(var(--ag-prism-hop-by,0px) + 2px),0) scale(1.06,.93)}100%{transform:translate3d(var(--ag-prism-hop-bx,0px),var(--ag-prism-hop-by,0px),0) scale(1,1)}}',
'@keyframes ag-prism-prop-dive-out{0%{transform:translate3d(0,0,0) scale(1);opacity:1}100%{transform:translate3d(0,16px,0) scale(.82);opacity:0}}',
'@keyframes ag-prism-prop-pop-in{0%{transform:translate3d(0,16px,0) scale(.82);opacity:0}65%{transform:translate3d(0,-3px,0) scale(1.04);opacity:1}100%{transform:translate3d(0,0,0) scale(1);opacity:1}}',
'@keyframes ag-prism-prop-hop-up{0%{transform:translate3d(0,var(--ag-prism-roof-dy,48px),0) scale(1.04,.94)}68%{transform:translate3d(0,-4px,0) scale(.98,1.03)}100%{transform:translate3d(0,0,0) scale(1,1)}}',
'@keyframes ag-prism-prop-gravity-land{0%{transform:translate3d(0,calc(-1 * var(--ag-prism-roof-dy,48px)),0) scale(.97,1.03)}64%{transform:translate3d(0,2px,0) scale(1.08,.9)}84%{transform:translate3d(0,-1px,0) scale(.98,1.02)}100%{transform:translate3d(0,0,0) scale(1,1)}}',
'@keyframes ag-prism-hop-shadow-in{0%,55%{opacity:0}85%{opacity:1}100%{opacity:1}}',
'@keyframes ag-prism-roof-shadow{0%,45%{opacity:.18;transform:translateX(-50%) scale(.72)}64%{opacity:1;transform:translateX(-50%) scale(1.14)}100%{opacity:1;transform:translateX(-50%) scale(1)}}',
].join('');

const isFn = (v) => typeof v === 'function';
const getDoc = (el, fallback) => fallback || el?.ownerDocument || (typeof document !== 'undefined' ? document : null);
const getWin = (doc, fallback) => fallback || doc?.defaultView || (typeof window !== 'undefined' ? window : G || null);
const safeAttr = (el, name) => { try { return el && isFn(el.getAttribute) ? el.getAttribute(name) : null; } catch { return null; } };
const safeClosest = (el, sel) => {
try {
const cur = el && el.nodeType !== 1 ? el.parentElement || el.parentNode || null : el;
return cur && isFn(cur.closest) ? cur.closest(sel) : null;
} catch { return null; }
};
const safeContains = (parent, child) => {
if (!parent || !child) return false;
if (parent === child) return true;
try { if (isFn(parent.contains)) return Boolean(parent.contains(child)); } catch {}
for (let cur = child; cur; cur = cur.parentElement || cur.parentNode || null) if (cur === parent) return true;
return false;
};
const safeQsa = (rootEl, sel) => { try { return rootEl && isFn(rootEl.querySelectorAll) ? Array.from(rootEl.querySelectorAll(sel)) : []; } catch { return []; } };

// Issue #101 共享契约：data-ag-cs-ignore-rm="1" 忽略系统 prefers-reduced-motion，仍尊重 motionLevel === 'off'
function isReducedMotionActive(opts = {}) {
const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
const win = getWin(doc, opts.win);
const rootEl = doc?.documentElement || null;
const rawLevel = typeof opts.motionLevel === 'string' && opts.motionLevel ? opts.motionLevel : safeAttr(rootEl, MOTION_ATTR) || '';
if (String(rawLevel).trim().toLowerCase() === 'off') return true;
if (safeAttr(rootEl, IGNORE_RM_ATTR) === '1') return false;
if (typeof opts.reducedMotion === 'boolean') return opts.reducedMotion;
try { if (win && isFn(win.__agPrismReducedMotion)) return Boolean(win.__agPrismReducedMotion()); } catch {}
try { if (win && isFn(win.matchMedia)) return Boolean(win.matchMedia('(prefers-reduced-motion: reduce)')?.matches); } catch {}
return false;
}

function resolveHopMotionProfile(opts = {}) {
const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
const rawLevel = typeof opts.motionLevel === 'string' && opts.motionLevel ? opts.motionLevel : safeAttr(doc?.documentElement, MOTION_ATTR) || 'standard';
const level = String(rawLevel).trim().toLowerCase();
if (level === 'off' || isReducedMotionActive({ ...opts, doc, motionLevel: level })) {
return { mode: 'off', enabled: false, diveMs: 0, popMs: 0, hopUpMs: 0, landMs: 0, miniStaggerMs: 0, actorStaggerMs: 0 };
}
if (level === 'subtle') {
return { mode: 'subtle', enabled: true, diveMs: 140, popMs: 170, hopUpMs: 180, landMs: 210, miniStaggerMs: 24, actorStaggerMs: 16 };
}
return { mode: 'full', enabled: true, diveMs: 220, popMs: 280, hopUpMs: 320, landMs: 380, miniStaggerMs: 42, actorStaggerMs: 28 };
}

// 判定节点是否属于侧边栏（agentSidePanel / 辅助会话面板）
function isSidePanelElement(el) {
if (!el) return false;
const start = el.nodeType === 1 ? el : el.parentElement || el.parentNode || null;
if (!start) return false;
if (safeClosest(start, SIDE_PANEL_SEL)) return true;
for (let cur = start, depth = 0; cur && cur.nodeType === 1 && depth < 24; cur = cur.parentElement, depth++) {
const id = String(cur.id || safeAttr(cur, 'id') || '');
const tid = String(safeAttr(cur, 'data-testid') || '');
const cls = String(typeof cur.className === 'string' ? cur.className : safeAttr(cur, 'class') || '');
if (/agentsidepanel|auxiliarybar|side-?panel/i.test(id) || /agentsidepanel|side-?panel/i.test(tid)) return true;
if (/(?:^|\s)(?:agent-side-panel|aux-side-panel|auxiliarybar|side-panel-body)(?:\s|$)/i.test(cls)) return true;
const parent = cur.parentElement;
if (parent && safeAttr(parent, 'data-testid') === 'aux-pane-split') {
const kids = Array.from(parent.children || []).filter((c) => c && c.nodeType === 1);
if (kids.length >= 2 && cur !== kids[0] && !safeClosest(start, '[data-main-content-body]')) return true;
}
}
return false;
}

// 判定 takeover/side-question 卡片是否与 targetCard 同对话/同窗格
function isSamePaneTakeover(tkEl, targetCard) {
if (!tkEl || !targetCard || safeClosest(tkEl, SUBAGENT_SEL) !== safeClosest(targetCard, SUBAGENT_SEL)) return false;
const ts = safeClosest(tkEl, PANE_SCOPE_SEL), cs = safeClosest(targetCard, PANE_SCOPE_SEL);
if (ts || cs) return Boolean(ts && cs && (ts === cs || (safeContains(ts, targetCard) && safeContains(cs, tkEl))));
for (let c = tkEl.parentElement, d = 0; c && c.nodeType === 1 && d < 5; c = c.parentElement, d++) {
const t = safeAttr(c, 'data-testid') || '';
if (t === 'aux-pane-split' || t === 'sidebar-split') break;
if (safeContains(c, targetCard)) return true;
}
return false;
}

function isComposerInputTarget(target, targetCard = null) {
if (!target) return false;
const el = target.nodeType === 1 ? target : target.parentElement || target.parentNode || null;
if (!el) return false;
const tk = safeClosest(el, TAKEOVER_BOX_SEL);
if (targetCard) {
if (safeContains(targetCard, el)) return true;
const box = safeClosest(targetCard, '[data-testid="agent-input-box"]') || safeClosest(targetCard, '#antigravity\\.agentSidePanelInputBox');
if ((box && safeContains(box, el)) || (tk && isSamePaneTakeover(tk, targetCard))) return true;
const inp = safeClosest(el, INPUT_FIELD_SEL);
return Boolean(inp && (safeContains(targetCard, inp) || (box && safeContains(box, inp))));
}
if (safeClosest(el, COMPOSER_BOX_SEL)) return true;
const inp = safeClosest(el, INPUT_FIELD_SEL);
return Boolean(inp && safeClosest(inp, '[data-testid="agent-input-box"], .surface-composer-card, #antigravity\\.agentSidePanelInputBox, [data-side-panel-focus-scope="true"]'));
}

function filterLiveMainCards(cards) {
if (!Array.isArray(cards)) return [];
const seen = new Set(), out = [];
for (const c of cards) {
if (!c || seen.has(c) || c.isConnected === false || c.hidden || c.style?.display === 'none' || safeClosest(c, SUBAGENT_SEL)) continue;
seen.add(c);
out.push(c);
}
return out;
}

function isMainPrimaryCard(card, cards = []) {
if (!card || isSidePanelElement(card)) return false;
const nonSide = filterLiveMainCards(cards).filter((c) => !isSidePanelElement(c));
if (nonSide.length <= 1) return nonSide.length === 0 || nonSide[0] === card;
const explicitMain = nonSide.find((c) => Boolean(safeClosest(c, '[data-main-content-body]')));
return explicitMain ? explicitMain === card : nonSide[0] === card;
}

// 桌宠跨窗格聚焦判定：单主会话保留任意区域点击；主会话共存可点正文留/回主会话；侧边栏与次分屏严格限定输入框
function shouldTransferMascotFocus(ctx = {}) {
const { target, targetCard = null, currentCard = null, doc = null } = ctx;
if (!target || !targetCard) return { allow: false, transfer: false, reason: 'missing-target' };
if (safeClosest(target, IGNORED_SCOPE_SEL)) return { allow: false, transfer: false, reason: 'ignored-overlay' };
if (safeClosest(targetCard, SUBAGENT_SEL)) return { allow: false, transfer: false, reason: 'subagent-excluded' };

const d = getDoc(targetCard, doc);
const rawCards = Array.isArray(ctx.cards)
? ctx.cards
: d ? safeQsa(d, '[data-testid="agent-input-box"] .surface-composer-card, .surface-composer-card') : [targetCard];
const liveCards = filterLiveMainCards(rawCards);
if (!liveCards.includes(targetCard) && targetCard.isConnected !== false) liveCards.push(targetCard);

const inComposer = isComposerInputTarget(target, targetCard);
const targetIsSide = isSidePanelElement(targetCard) || (!inComposer && isSidePanelElement(target));
const isSameCard = Boolean(currentCard && currentCard === targetCard);
if (liveCards.length <= 1 && !targetIsSide) {
return { allow: true, transfer: Boolean(currentCard && !isSameCard), reason: 'single-main-pane' };
}
if (isSameCard) return { allow: true, transfer: false, reason: 'same-card' };
if (targetIsSide) {
return inComposer
? { allow: true, transfer: true, reason: 'sidebar-composer-input' }
: { allow: false, transfer: false, reason: 'sidebar-non-input' };
}
if (isMainPrimaryCard(targetCard, liveCards)) {
return { allow: true, transfer: Boolean(currentCard && !isSameCard), reason: inComposer ? 'primary-composer-input' : 'primary-main-body' };
}
return inComposer
? { allow: true, transfer: true, reason: 'split-composer-input' }
: { allow: false, transfer: false, reason: 'split-non-input' };
}

function ensureStyle(doc) {
const d = doc || (typeof document !== 'undefined' ? document : null);
if (!d || !isFn(d.createElement)) return null;
try {
const existing = isFn(d.getElementById) ? d.getElementById(STYLE_ID) : null;
if (existing) {
if (existing.textContent !== HOP_CSS) existing.textContent = HOP_CSS;
return existing;
}
const styleEl = d.createElement('style');
styleEl.id = STYLE_ID;
styleEl.setAttribute?.('data-ag-owned', '1');
styleEl.textContent = HOP_CSS;
(d.head || d.documentElement || d.body)?.appendChild?.(styleEl);
return styleEl;
} catch { return null; }
}

function readRect(el) {
if (!el || !isFn(el.getBoundingClientRect)) return null;
try {
const r = el.getBoundingClientRect();
const width = Number(r?.width) || 0, height = Number(r?.height) || 0;
if (!r || !Number.isFinite(r.left) || !Number.isFinite(r.top) || width <= 0 || height <= 0) return null;
return {
left: r.left, top: r.top, width, height,
right: Number.isFinite(r.right) ? r.right : r.left + width,
bottom: Number.isFinite(r.bottom) ? r.bottom : r.top + height,
cx: r.left + width * 0.5, cy: r.top,
};
} catch { return null; }
}

function parseTranslate3dXY(transformStr) {
const m = /translate3d\(\s*([-\d.]+)(?:px)?\s*,\s*([-\d.]+)(?:px)?/i.exec(String(transformStr || ''));
return m ? { x: `${m[1]}px`, y: `${m[2]}px` } : { x: '0px', y: '0px' };
}

const setCssVar = (el, k, v) => { try { if (el?.style && isFn(el.style.setProperty)) el.style.setProperty(k, v); else if (el?.style) el.style[k] = v; } catch {} };
const removeCssVar = (el, k) => { try { if (el?.style && isFn(el.style.removeProperty)) el.style.removeProperty(k); else if (el?.style) delete el.style[k]; } catch {} };

const activeTimers = new Set();
const state = {
gen: 0, phase: 'idle', mode: 'off', dir: 1,
stageEl: null, fromAnchor: null, toAnchor: null, fromRect: null, toRect: null,
onCommitAnchor: null, onComplete: null, touchedNodes: [],
};

function scheduleTimer(win, ms, fn) {
const st = win && isFn(win.setTimeout) ? win.setTimeout.bind(win) : setTimeout;
const rec = { id: 0, win };
rec.id = st(() => { activeTimers.delete(rec); fn(); }, Math.max(0, Math.round(ms)));
activeTimers.add(rec);
return rec;
}

function clearAllTimers() {
for (const rec of activeTimers) {
try { (rec.win && isFn(rec.win.clearTimeout) ? rec.win.clearTimeout.bind(rec.win) : clearTimeout)(rec.id); } catch {}
}
activeTimers.clear();
}

function clearStageHopStyles(stageEl, touchedNodes = []) {
if (stageEl) {
try { stageEl.removeAttribute?.(ATTR_HOP); stageEl.removeAttribute?.(ATTR_HOP_MODE); stageEl.removeAttribute?.(ATTR_HOP_SELF); } catch {}
removeCssVar(stageEl, '--ag-prism-hop-dir');
removeCssVar(stageEl, '--ag-prism-hop-dur');
removeCssVar(stageEl, '--ag-prism-hop-delay');
removeCssVar(stageEl, '--ag-prism-roof-dy');
}
for (const node of touchedNodes) {
removeCssVar(node, '--ag-prism-hop-delay');
removeCssVar(node, '--ag-prism-hop-bx');
removeCssVar(node, '--ag-prism-hop-by');
}
}

function applyPhaseToStage(stageEl, phaseAttr, profile, dir, extraDurMs = 0) {
if (!stageEl) return { maxDelayMs: 0, touched: [] };
const touched = [];
const durMs = extraDurMs > 0
? extraDurMs
: phaseAttr === 'dive-out' ? profile.diveMs
: phaseAttr === 'hop-up' ? profile.hopUpMs
: phaseAttr === 'gravity-land' ? profile.landMs
: profile.popMs;
stageEl.setAttribute?.(ATTR_HOP, phaseAttr);
stageEl.setAttribute?.(ATTR_HOP_MODE, profile.mode);
setCssVar(stageEl, '--ag-prism-hop-dir', String(dir));
setCssVar(stageEl, '--ag-prism-hop-dur', `${durMs}ms`);

const mainCanvases = safeQsa(stageEl, '.ag-v2-mascot-canvas');
const miniCanvases = safeQsa(stageEl, '.ag-v2-mini-crab-canvas');
let maxDelayMs = 0;

if (mainCanvases.length === 0 && miniCanvases.length === 0) {
stageEl.setAttribute?.(ATTR_HOP_SELF, '1');
} else {
stageEl.removeAttribute?.(ATTR_HOP_SELF);
for (let i = 0; i < mainCanvases.length; i++) {
const delay = i * profile.actorStaggerMs;
if (delay > maxDelayMs) maxDelayMs = delay;
setCssVar(mainCanvases[i], '--ag-prism-hop-delay', `${delay}ms`);
touched.push(mainCanvases[i]);
}
const miniBaseDelay = mainCanvases.length > 0 ? Math.min(24, profile.actorStaggerMs) : 0;
for (let i = 0; i < miniCanvases.length; i++) {
const mc = miniCanvases[i], delay = miniBaseDelay + i * profile.miniStaggerMs;
if (delay > maxDelayMs) maxDelayMs = delay;
const { x, y } = parseTranslate3dXY(mc?.style?.transform || '');
setCssVar(mc, '--ag-prism-hop-bx', x);
setCssVar(mc, '--ag-prism-hop-by', y);
setCssVar(mc, '--ag-prism-hop-delay', `${delay}ms`);
touched.push(mc);
}
}
return { maxDelayMs, touched };
}

function resetStateToIdle() {
clearAllTimers();
clearStageHopStyles(state.stageEl, state.touchedNodes);
state.phase = 'idle'; state.mode = 'off';
state.stageEl = state.fromAnchor = state.toAnchor = state.onCommitAnchor = state.onComplete = null;
state.touchedNodes = [];
}

function cancelActiveTransition() {
state.gen += 1;
resetStateToIdle();
return { cancelled: true, gen: state.gen };
}

function cancelForStage(stageEl) {
if (!stageEl) return false;
if (state.stageEl === stageEl) { cancelActiveTransition(); return true; }
clearStageHopStyles(stageEl, [...safeQsa(stageEl, '.ag-v2-mascot-canvas'), ...safeQsa(stageEl, '.ag-v2-mini-crab-canvas')]);
return false;
}

function cleanupOrphanLayers(doc) {
const d = doc || (typeof document !== 'undefined' ? document : null);
if (!d) return;
for (const node of safeQsa(d, '.' + HOP_LAYER_CLASS)) { try { node.remove?.(); } catch {} }
}

// 两段式跃迁状态机：dive-flip-out -> commitAnchor -> hop-pop-in -> idle（transitionGen 防重入并发）
function runMascotHopTransition(opts = {}) {
const { stageEl, fromAnchor, toAnchor, onCommitAnchor = null, onComplete = null } = opts;
const doc = getDoc(stageEl || toAnchor || fromAnchor, opts.doc);
const win = getWin(doc, opts.win);
if (!stageEl || !toAnchor) { cancelActiveTransition(); return { animated: false, reason: 'missing-nodes' }; }

if (state.stageEl === stageEl && state.toAnchor === toAnchor && (state.phase === 'dive-flip-out' || state.phase === 'hop-pop-in')) {
if (isFn(onCommitAnchor)) state.onCommitAnchor = onCommitAnchor;
if (isFn(onComplete)) state.onComplete = onComplete;
return {
animated: true, reused: true, gen: state.gen, phase: state.phase, mode: state.mode, dir: state.dir,
fromRect: state.fromRect ? { ...state.fromRect } : null, toRect: state.toRect ? { ...state.toRect } : null,
};
}

const profile = resolveHopMotionProfile({ win, doc, motionLevel: opts.motionLevel, reducedMotion: opts.reducedMotion });
const actualParent = stageEl.parentElement || stageEl.parentNode || fromAnchor || null;
if (actualParent && actualParent === toAnchor) {
if (state.stageEl === stageEl && state.phase === 'dive-flip-out' && profile.enabled) {
const myGen = ++state.gen, revDir = -state.dir;
clearAllTimers();
clearStageHopStyles(stageEl, state.touchedNodes);
ensureStyle(doc);
state.phase = 'hop-pop-in'; state.mode = profile.mode; state.dir = revDir;
state.stageEl = stageEl; state.fromAnchor = actualParent; state.toAnchor = toAnchor;
state.onCommitAnchor = null; state.onComplete = onComplete;
const { maxDelayMs, touched } = applyPhaseToStage(stageEl, 'pop-in', profile, revDir);
state.touchedNodes = touched;
scheduleTimer(win, profile.popMs + maxDelayMs, () => {
if (state.gen !== myGen) return;
const doneCb = state.onComplete;
resetStateToIdle();
try { doneCb?.({ completed: true, gen: myGen }); } catch {}
});
return {
animated: true, reversed: true, gen: myGen, phase: 'hop-pop-in', mode: profile.mode, dir: revDir,
fromRect: state.fromRect ? { ...state.fromRect } : null, toRect: state.toRect ? { ...state.toRect } : null,
};
}
cancelForStage(stageEl);
return { animated: false, reason: 'same-anchor' };
}

if (!profile.enabled) { cancelActiveTransition(); return { animated: false, reason: 'motion-disabled' }; }
const effectiveFrom = actualParent || fromAnchor;
if (!effectiveFrom || effectiveFrom === toAnchor) { cancelActiveTransition(); return { animated: false, reason: 'no-source-anchor' }; }

const fromRect = opts.fromRect || readRect(effectiveFrom);
const toRect = opts.toRect || readRect(toAnchor);
if (!fromRect || !toRect) { cancelActiveTransition(); return { animated: false, reason: 'invisible-anchor' }; }
const dx = (toRect.cx ?? toRect.left + toRect.width * 0.5) - (fromRect.cx ?? fromRect.left + fromRect.width * 0.5);
const dy = toRect.top - fromRect.top;
if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) { cancelActiveTransition(); return { animated: false, reason: 'coincident-anchor' }; }

const myGen = ++state.gen;
clearAllTimers();
clearStageHopStyles(state.stageEl, state.touchedNodes);
if (state.stageEl && state.stageEl !== stageEl) clearStageHopStyles(stageEl, []);
cleanupOrphanLayers(doc);
ensureStyle(doc);

const dir = Math.abs(dx) > 4 ? (dx >= 0 ? 1 : -1) : dy >= 0 ? 1 : -1;
state.phase = 'dive-flip-out'; state.mode = profile.mode; state.dir = dir;
state.stageEl = stageEl; state.fromAnchor = effectiveFrom; state.toAnchor = toAnchor;
state.fromRect = { ...fromRect }; state.toRect = { ...toRect };
state.onCommitAnchor = onCommitAnchor; state.onComplete = onComplete;

const diveMeta = applyPhaseToStage(stageEl, 'dive-out', profile, dir);
state.touchedNodes = diveMeta.touched;
scheduleTimer(win, profile.diveMs + diveMeta.maxDelayMs, () => {
if (state.gen !== myGen) return;
clearStageHopStyles(stageEl, state.touchedNodes);
state.touchedNodes = [];
if (toAnchor.isConnected === false) { resetStateToIdle(); return; }
const commitCb = state.onCommitAnchor;
let committed = true;
if (isFn(commitCb)) { try { committed = commitCb() !== false; } catch { committed = false; } }
else if (isFn(toAnchor.appendChild)) { try { toAnchor.appendChild(stageEl); } catch { committed = false; } }
if (!committed || state.gen !== myGen) { if (state.gen === myGen) resetStateToIdle(); return; }
state.phase = 'hop-pop-in';
const popMeta = applyPhaseToStage(stageEl, 'pop-in', profile, dir);
state.touchedNodes = popMeta.touched;
scheduleTimer(win, profile.popMs + popMeta.maxDelayMs, () => {
if (state.gen !== myGen) return;
const doneCb = state.onComplete;
resetStateToIdle();
try { doneCb?.({ completed: true, gen: myGen }); } catch {}
});
});
return { animated: true, gen: myGen, phase: 'dive-flip-out', mode: profile.mode, dir, diveMs: profile.diveMs, popMs: profile.popMs, fromRect: { ...fromRect }, toRect: { ...toRect } };
}

// 排队窗口屋顶垂直升降动画：纯 GPU transform（hop-up / gravity-land，0 rAF、连点安全取消）
function runVerticalRoofTransition(opts = {}) {
const { stageEl, direction = 'gravity-land', deltaPx = 48, toAnchor = null, onComplete = null } = opts;
const doc = getDoc(stageEl || toAnchor, opts.doc);
const win = getWin(doc, opts.win);
if (!stageEl) { cancelActiveTransition(); return { animated: false, reason: 'missing-stage' }; }
const phaseAttr = direction === 'hop-up' ? 'hop-up' : 'gravity-land';
const profile = resolveHopMotionProfile({ win, doc, motionLevel: opts.motionLevel, reducedMotion: opts.reducedMotion });
if (!profile.enabled) { cancelForStage(stageEl); return { animated: false, reason: 'motion-disabled' }; }
const dyNum = Number(deltaPx), clampedDy = Math.round(Math.max(24, Math.min(128, Number.isFinite(dyNum) && dyNum > 0 ? dyNum : 48)));
const durMs = phaseAttr === 'hop-up' ? profile.hopUpMs : profile.landMs, myGen = ++state.gen;
clearAllTimers();
clearStageHopStyles(state.stageEl, state.touchedNodes);
if (state.stageEl && state.stageEl !== stageEl) clearStageHopStyles(stageEl, []);
ensureStyle(doc);
state.phase = phaseAttr; state.mode = profile.mode; state.dir = phaseAttr === 'hop-up' ? -1 : 1;
state.stageEl = stageEl; state.fromAnchor = opts.fromAnchor || null; state.toAnchor = toAnchor || stageEl.parentElement || null;
state.fromRect = state.toRect = state.onCommitAnchor = null; state.onComplete = onComplete;
setCssVar(stageEl, '--ag-prism-roof-dy', `${clampedDy}px`);
const meta = applyPhaseToStage(stageEl, phaseAttr, profile, state.dir, durMs);
state.touchedNodes = meta.touched;
scheduleTimer(win, durMs + meta.maxDelayMs, () => {
if (state.gen !== myGen) return;
const doneCb = state.onComplete;
resetStateToIdle();
try { doneCb?.({ completed: true, gen: myGen, phase: phaseAttr }); } catch {}
});
return { animated: true, gen: myGen, phase: phaseAttr, mode: profile.mode, dir: state.dir, deltaPx: clampedDy, durationMs: durMs, maxDelayMs: meta.maxDelayMs };
}

function getTransitionState() {
return {
gen: state.gen, phase: state.phase, mode: state.mode, dir: state.dir, active: state.phase !== 'idle',
fromRect: state.fromRect ? { ...state.fromRect } : null, toRect: state.toRect ? { ...state.toRect } : null,
toAnchor: state.toAnchor, timersCount: activeTimers.size,
};
}

function dispose(doc) {
cancelActiveTransition();
const d = doc || (typeof document !== 'undefined' ? document : null);
if (!d) return;
try { isFn(d.getElementById) && d.getElementById(STYLE_ID)?.remove?.(); } catch {}
cleanupOrphanLayers(d);
for (const node of safeQsa(d, `[${ATTR_HOP}], [${ATTR_HOP_MODE}], [${ATTR_HOP_SELF}]`)) {
clearStageHopStyles(node, [...safeQsa(node, '.ag-v2-mascot-canvas'), ...safeQsa(node, '.ag-v2-mini-crab-canvas')]);
}
}

return {
STYLE_ID, HOP_LAYER_CLASS, HOP_CSS,
isReducedMotionActive, resolveHopMotionProfile,
isSidePanelElement, isComposerInputTarget, isMainPrimaryCard, shouldTransferMascotFocus,
runMascotHopTransition, runVerticalRoofTransition, getTransitionState, cancelForStage, cancelActiveTransition, ensureStyle, dispose,
};
});
