// Obsidian Prism — Model Glyph & Orchestrator Crystal Bar (model-glyph-crystal.js)

(function (root) {
  'use strict';
  const G = root || (typeof globalThis !== 'undefined' ? globalThis : window);
  if (!G) return;

  const BRAND_PATHS = {
    gemini:
      'M24 12.024c-6.437.388-11.59 5.539-11.977 11.976h-.047C11.588 17.563 6.436 12.412 0 12.024v-.047C6.437 11.588 11.588 6.437 11.976 0h.047c.388 6.437 5.54 11.588 11.977 11.977z',
    claude:
      'm4.714 15.956l4.718-2.648l.079-.23l-.08-.128h-.23l-.79-.048l-2.695-.073l-2.337-.097l-2.265-.122l-.57-.121l-.535-.704l.055-.353l.48-.321l.685.06l1.518.104l2.277.157l1.651.098l2.447.255h.389l.054-.158l-.133-.097l-.103-.098l-2.356-1.596l-2.55-1.688l-1.336-.972l-.722-.491L2 6.223l-.158-1.008l.656-.722l.88.06l.224.061l.893.686l1.906 1.476l2.49 1.833l.364.304l.146-.104l.018-.072l-.164-.274l-1.354-2.446l-1.445-2.49l-.644-1.032l-.17-.619a3 3 0 0 1-.103-.729L6.287.133L6.7 0l.995.134l.42.364l.619 1.415L9.735 4.14l1.555 3.03l.455.898l.243.832l.09.255h.159V9.01l.127-1.706l.237-2.095l.23-2.695l.08-.76l.376-.91l.747-.492l.583.28l.48.685l-.067.444l-.286 1.851l-.558 2.903l-.365 1.942h.213l.243-.242l.983-1.306l1.652-2.064l.728-.82l.85-.904l.547-.431h1.032l.759 1.129l-.34 1.166l-1.063 1.347l-.88 1.142l-1.263 1.7l-.79 1.36l.074.11l.188-.02l2.853-.606l1.542-.28l1.84-.315l.832.388l.09.395l-.327.807l-1.967.486l-2.307.462l-3.436.813l-.043.03l.049.061l1.548.146l.662.036h1.62l3.018.225l.79.522l.473.638l-.08.485l-1.213.62l-1.64-.389l-3.825-.91l-1.31-.329h-.183v.11l1.093 1.068l2.003 1.81l2.508 2.33l.127.578l-.321.455l-.34-.049l-2.204-1.657l-.85-.747l-1.925-1.62h-.127v.17l.443.649l2.343 3.521l.122 1.08l-.17.353l-.607.213l-.668-.122l-1.372-1.924l-1.415-2.168l-1.141-1.943l-.14.08l-.674 7.254l-.316.37l-.728.28l-.607-.461l-.322-.747l.322-1.476l.388-1.924l.316-1.53l.285-1.9l.17-.632l-.012-.042l-.14.018l-1.432 1.967l-2.18 2.945l-1.724 1.845l-.413.164l-.716-.37l.066-.662l.401-.589l2.386-3.036l1.439-1.882l.929-1.086l-.006-.158h-.055L4.138 18.56l-1.13.146l-.485-.456l.06-.746l.231-.243l1.907-1.312Z',
    openai:
      'M20.562 10.188c.25-.688.313-1.376.25-2.063c-.062-.687-.312-1.375-.625-2c-.562-.937-1.375-1.687-2.312-2.125c-1-.437-2.063-.562-3.125-.312c-.5-.5-1.063-.938-1.688-1.25S11.687 2 11 2a5.17 5.17 0 0 0-3 .938c-.875.624-1.5 1.5-1.813 2.5c-.75.187-1.375.5-2 .875c-.562.437-1 1-1.375 1.562c-.562.938-.75 2-.625 3.063a5.44 5.44 0 0 0 1.25 2.874a4.7 4.7 0 0 0-.25 2.063c.063.688.313 1.375.625 2c.563.938 1.375 1.688 2.313 2.125c1 .438 2.062.563 3.125.313c.5.5 1.062.937 1.687 1.25S12.312 22 13 22a5.17 5.17 0 0 0 3-.937c.875-.625 1.5-1.5 1.812-2.5a4.54 4.54 0 0 0 1.938-.875c.562-.438 1.062-.938 1.375-1.563c.562-.937.75-2 .625-3.062c-.125-1.063-.5-2.063-1.188-2.876m-7.5 10.5c-1 0-1.75-.313-2.437-.875c0 0 .062-.063.125-.063l4-2.312a.5.5 0 0 0 .25-.25a.57.57 0 0 0 .062-.313V11.25l1.688 1v4.625a3.685 3.685 0 0 1-3.688 3.813M5 17.25c-.438-.75-.625-1.625-.438-2.5c0 0 .063.063.125.063l4 2.312a.56.56 0 0 0 .313.063c.125 0 .25 0 .312-.063l4.875-2.812v1.937l-4.062 2.375A3.7 3.7 0 0 1 7.312 19c-1-.25-1.812-.875-2.312-1.75M3.937 8.563a3.8 3.8 0 0 1 1.938-1.626v4.751c0 .124 0 .25.062.312a.5.5 0 0 0 .25.25l4.875 2.813l-1.687 1l-4-2.313a3.7 3.7 0 0 1-1.75-2.25c-.25-.937-.188-2.062.312-2.937M17.75 11.75l-4.875-2.812l1.687-1l4 2.312c.625.375 1.125.875 1.438 1.5s.5 1.313.437 2.063a3.7 3.7 0 0 1-.75 1.937c-.437.563-1 1-1.687 1.25v-4.75c0-.125 0-.25-.063-.312c0 0-.062-.126-.187-.188m1.687-2.5s-.062-.062-.125-.062l-4-2.313c-.125-.062-.187-.062-.312-.062s-.25 0-.313.062L9.812 9.688V7.75l4.063-2.375c.625-.375 1.312-.5 2.062-.5c.688 0 1.375.25 2 .688c.563.437 1.063 1 1.313 1.625s.312 1.375.187 2.062m-10.5 3.5l-1.687-1V7.063c0-.688.187-1.438.562-2C8.187 4.438 8.75 4 9.375 3.688a3.37 3.37 0 0 1 2.062-.313c.688.063 1.375.375 1.938.813c0 0-.063.062-.125.062l-4 2.313a.5.5 0 0 0-.25.25c-.063.125-.063.187-.063.312zm.875-2L12 9.5l2.187 1.25v2.5L12 14.5l-2.188-1.25z',
    zcode:
      'M12.082 4.2L10.383 6.503H3.149L4.847 4.2zM20.778 17.497L19.081 19.8H11.872L13.568 17.497zM21.36 4.2L9.866 19.8H2.64L14.134 4.2z',
    deepseek:
      'M22 5c0 0-1 1-1 1-1 0-2 1-2 1 0-1-1-1-1-1-1 0-1-1-2-2 0 0-1 1-1 2 0 1 1 2 2 3 0 0-1 0-2 0-1-1-1-2-2-2 0 0-1-2-1-2 1 0-2 0-3 0 0 0-2 0-3 0-1 0-3 1-4 2 0 2-1 4 0 6 0 2 1 3 3 5 1 1 3 2 5 2 2-1 3-1 5-2 0 0 1 0 1 0 1 0 1 0 2 0 0 0-1-1-2-1 1-2 3-3 3-7 0 0 1-1 2-1 1-1 2-2 2-3 0 0 0 0 0-1zM12 17c-2-1-3-2-3-2-1 0 0 2 0 2 0 0-2 0-2 0-1 0-2-1-3-3-1-1-1-2-1-4 0 0 1 0 2 0 1 0 3 1 4 2 1 1 2 2 2 3 1 1 2 2 2 2 1 1-1 1-1 1zM12.5 11.6a.3.3 0 1 1 .6 0 .3.3 0 1 1-.6 0z',
  };

  const PANEL_MODEL_ROW_RE = /orchestrator|编排|调度|gemini|claude|sonnet|opus|haiku|gpt|openai|\bo[134]\b|deepseek|深度求索|zcode|chatglm|zhipu|\bglm\d*|z\.ai|智谱/i;
  const ZH_EFFORT_PAREN_RE = /\s*[（(]\s*(超高|极高|超深|高思考|中思考|低思考|极低|最低|深度思考|思考中?|中等|高|中|低|自动)\s*[)）]/g;

  const stripTranslatedEffortSuffix = (s) => String(s || '').replace(ZH_EFFORT_PAREN_RE, '').trim();
  const normalizeModelEffortLabel = (s) =>
    String(s || '').replace(ZH_EFFORT_PAREN_RE, (_, t) =>
      /超高|极高|超深/.test(t) ? ' (xhigh)' : t[0] === '中' ? ' (medium)' : t.includes('低') ? ' (low)' : t === '自动' ? ' (auto)' : ' (high)'
    );

  const readButtonLabelWithoutGlyph = (e) => {
    if (!e) return '';
    const p = [], g = (n) => n?.classList?.contains?.('ag-cs-model-glyph') || n?.classList?.contains?.('ag-pp-mini-keycap');
    const c = (n) => {
      if (!n || g(n)) return;
      if (n.nodeType === 3) { p.push(n.nodeValue || ''); return; }
      if (n.childNodes?.length > 0) { for (const x of n.childNodes) c(x); return; }
      if (n.children?.length > 0) {
        let k = 0;
        for (const x of n.children) if (!g(x)) { k++; c(x); }
        if (!k && typeof n._text === 'string' && n._text) p.push(n._text);
        return;
      }
      p.push(n.textContent || '');
    };
    c(e);
    return p.join(' ').trim() || (e.getAttribute?.('data-model-label') || '').trim() || (e.getAttribute?.('aria-label') || '').replace(/,\s*(?:model )?cannot be changed.*$/i, '').trim();
  };

  const RE_CL = /\b(claude|anthropic|sonnet|opus|haiku)\b/;
  const RE_GPT = /\b(gpt|openai|o[134]|codex)\b/;
  const RE_DS = /\bdeepseek\b/;
  const RE_ZC = /\b(zcode|chatglm|zhipu|glm\d*)\b|z\.ai|智谱/;

  const parseModelLabelInfo = (rawText) => {
    const norm = normalizeModelEffortLabel(rawText).toLowerCase();
    const base = stripTranslatedEffortSuffix(rawText).toLowerCase();
    const isOrchestrator = /\borchestrator\b|编排|调度器/.test(base);
    let brand = 'gemini';
    if (RE_CL.test(base)) brand = 'claude';
    else if (RE_ZC.test(base)) brand = 'zcode';
    else if (RE_DS.test(base) || base.includes('深度求索')) brand = 'deepseek';
    else if (RE_GPT.test(base)) brand = 'openai';
    else if (isOrchestrator || (/\bantigravity\b/.test(base) && !/\b(gemini|neon|argon|carbon|hydrogen|flash)\b/.test(base))) brand = 'antigravity';

    const tier = /\b(gpt-oss|fixed)\b|固定/.test(norm) ? 'fixed'
      : /\b(xhigh|extra)\b|超高|极高|超深/.test(norm) ? 'xhigh'
      : /\b(high|max|thinking)\b|深度思考|高思考|思考|高/.test(norm) ? 'high'
      : /\b(low|lite|minimal)\b|低思考|极低|最低|低/.test(norm) ? 'low'
      : /\b(medium|med)\b|中思考|中等|中/.test(norm) ? 'medium'
      : isOrchestrator ? 'auto' : 'medium';
    return { brand, tier, isOrchestrator, camp: brand === 'claude' ? 'claude' : 'gemini' };
  };

  const resolveMascotCamp = (rawText) => {
    const b = stripTranslatedEffortSuffix(rawText).toLowerCase();
    return RE_CL.test(b) ? 'claude' : RE_DS.test(b) || b.includes('深度求索') ? 'deepseek' : RE_GPT.test(b) ? 'gpt' : 'gemini';
  };

  const createModelGlyphCrystalController = ({
    animatedIcons, crystalPrismCore, isDestroyed, isComposerRestyleEnabled, isZh, isDarkTheme,
    motionReduced, getMinFrameGapMs, canMountRealCanvas, getLastPointerPos, setAttrIfChanged, getCfg,
  }) => {
    let mPanel = null, mOv = null, mBar = null, mTrk = null, mCv = null, mInst = null,
      mRaf = 0, mMountRaf = 0, mLastMs = 0, mWasOrch = false, mHideLock = false,
      mWakeTrk = null, mWakeFn = null, mMountedAt = 0, mKnob = null, mKnobRect = null,
      mKnobRectAt = 0, mKnobFillSig = '', mTrkWidth = 0, mStepFillRatio = null;

    const svgProto = new Map();
    const K_IC = 'isConnected', K_PE = 'parentElement', K_CL = 'classList', A_AH = 'aria-hidden', A_OW = 'data-ag-owned', A_OC = 'data-orch-crystal-canvas',
      A_MO = 'data-ag-cs-model-overlay', A_OA = 'data-ag-cs-orch-active', A_NI = 'data-ag-no-i18n', A_RH = 'data-row-hidden', A_MS = 'data-ces-model-selected', C_OT = 'ag-cs-orch-track';
    const isF = Number.isFinite, pF = parseFloat, nowMs = () => performance.now(), clamp01 = (v) => Math.max(0, Math.min(1, v));
    const ga = (e, k) => e?.getAttribute?.(k);
    const sa = (e, k, v = '') => e?.setAttribute?.(k, String(v));
    const ra = (e, k) => e?.removeAttribute?.(k);
    const ha = (e, k) => Boolean(e?.hasAttribute?.(k));
    const qs = (e, s) => e?.querySelector?.(s) || null;
    const qa = (e, s) => e?.querySelectorAll?.(s) || [];
    const cl = (e, s) => e?.closest?.(s) || null;
    const sp = (e, k, v) => e?.style?.setProperty?.(k, v);
    const clHas = (e, c) => Boolean(e?.[K_CL]?.contains?.(c));
    const rc = (e) => e?.getBoundingClientRect?.() || null;
    const docOf = () => (typeof document !== 'undefined' ? document : null);
    const isHid = () => docOf()?.hidden;
    const rAF = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : 0);
    const cAF = (id) => { if (id && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); };
    const mk = (tag, cls, txt) => {
      const e = docOf().createElement(tag);
      if (cls) e.className = cls;
      if (txt !== undefined) e.textContent = txt;
      return e;
    };
    const markNoTr = (el) => {
      if (!el) return el;
      const fn = G.AntigravityCodexEffortSlider?.markNoTranslate;
      if (fn) return fn(el);
      for (const k of ['data-ag-i18n-skip', 'data-ag-no-tr', 'data-no-translate']) sa(el, k, '1');
      sa(el, 'data-translate', 'no'); sa(el, 'translate', 'no'); el[K_CL]?.add?.('notranslate');
      return el;
    };

    const getRootHtml = () => docOf()?.documentElement || null;

    const syncModelMenuAttrs = (panel) => {
      const h = getRootHtml(), ov = cl(panel, '.agy-overlay');
      if (panel) {
        h && setAttrIfChanged(h, 'data-ag-cs-model-menu', '1');
        mOv && mOv !== ov && ra(mOv, A_MO);
        ov && setAttrIfChanged(ov, A_MO, '1');
        mOv = ov;
      } else {
        ra(h, 'data-ag-cs-model-menu'); ra(mOv, A_MO); mOv = null;
        qa(docOf(), `[${A_MO}]`).forEach((e) => ra(e, A_MO));
      }
    };

    const readRootAccentTone = () => ga(getRootHtml(), 'data-ag-cs-accent') || 'follow';

    const resolveCrystalAccentMode = (dk) => {
      const h = getRootHtml(), t = ga(h, 'data-ag-cs-accent') || 'follow';
      if (/^(mono|cobalt|iris|amber)$/.test(t)) return t;
      const p = ga(h, 'data-ag-cs-palette') || 'obsidian';
      return p === 'warm' || p === 'claude' || (!dk && p === 'obsidian' && ga(h, 'data-ag-cs-light-preset') === 'alabaster') ? 'warm' : 'default';
    };
    const isEffortSliderOff = () => ga(getRootHtml(), 'data-ag-cs-effort-slider') === 'off' || getCfg?.()?.effortSliderModule === 'off';
    const readRootAmbientFloat = () => {
      const r = ga(getRootHtml(), 'data-ag-cs-ambient');
      if (G.__agPrismRipple?.parseAmbientScale) return G.__agPrismRipple.parseAmbientScale(r);
      if (r == null || r === '') return 1;
      const n = Number(r);
      return !isF(n) ? 1 : n <= 0 ? 0 : n > 1 ? Math.min(1, n / 100) : n;
    };

    const NS = 'http://www.w3.org/2000/svg';
    const mountNode = (h, n) => {
      if (!h) return;
      if (h.replaceChildren) return n ? h.replaceChildren(n) : h.replaceChildren();
      for (let c; (c = h.firstChild || h.children?.[0]); ) h.removeChild ? h.removeChild(c) : (h.children.length = 0);
      if (n) h.appendChild?.(n);
    };
    const parseSvgElement = (s, d = docOf()) => {
      const src = String(s || '').trim(); if (!src || !d) return null;
      if (typeof DOMParser === 'function') try {
        const r = new DOMParser().parseFromString(/\bxmlns=/.test(src) ? src : src.replace(/<svg\b/i, `<svg xmlns="${NS}"`), 'image/svg+xml')?.documentElement;
        if (r && !/parsererror/i.test(r.nodeName)) return d.importNode ? d.importNode(r, true) : r;
      } catch {}
      const st = []; let rt = null, m, a;
      for (const re = /<(\/?)([\w:-]+)([^>]*?)(\/?)>/g; (m = re.exec(src)); ) {
        if (m[1]) { st.pop(); continue; }
        const e = d.createElementNS ? d.createElementNS(NS, m[2]) : d.createElement(m[2]);
        for (const ar = /([\w:.-]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g; (a = ar.exec(m[3])); ) { const k = a[1], v = a[2] ?? a[3] ?? ''; if (k === 'class') e.className = v; sa(e, k, v); }
        st.length ? st[st.length - 1].appendChild?.(e) : rt || (rt = e);
        if (!m[4]) st.push(e);
      }
      return rt;
    };
    G.__agPrismSvgUtil = { parse: parseSvgElement, mount: mountNode };
    const cloneCachedSvgElement = (k, s) => {
      if (!s) return null;
      let p = svgProto.get(k);
      if (!p) { p = parseSvgElement(s); if (!p) return null; if (!p.cloneNode) return p; if (svgProto.size > 64) svgProto.clear(); svgProto.set(k, p); }
      return p.cloneNode(true);
    };

    const parseModelTriggerInfo = (b) => {
      const r = readButtonLabelWithoutGlyph(b), i = parseModelLabelInfo(r);
      i.mascotCamp = resolveMascotCamp(r);
      if (i.isOrchestrator && ga(b, 'data-ces-orch-b') === 'claude') i.brand = i.camp = i.mascotCamp = 'claude';
      return i;
    };

    const svgW = (c, z, v, i) => `<svg${c ? ` class="${c}"` : ''} width="${z}" height="${z}" viewBox="${v}" fill="none" aria-hidden="true">${i}</svg>`;

    const renderSparkSvg = (z = 16, t = 'auto', m = false, c = '') =>
      animatedIcons?.renderGoogleSparkOrbitSvg?.({ size: z, tier: t, monochrome: m, className: c }) ||
      svgW(c, z, '0 0 24 24', `<path d="M12 1.2c.25 0 .47.17.53.41c.21.79.48 1.56.8 2.31c1.23 2.86 3.39 5.02 6.25 6.25c.75.32 1.52.59 2.31.8c.24.06.41.28.41.53s-.17.47-.41.53a16 16 0 0 0-2.31.8c-2.86 1.23-5.02 3.39-6.25 6.25c-.32.75-.59 1.52-.8 2.31a.55.55 0 0 1-.53.41a.55.55 0 0 1-.53-.41a16 16 0 0 0-.8-2.31c-1.23-2.86-3.39-5.02-6.25-6.25a16 16 0 0 0-2.31-.8A.55.55 0 0 1 1.2 12c0-.25.17-.47.41-.53c.79-.21 1.56-.48 2.31-.8c2.86-1.23 5.02-3.39 6.25-6.25c.32-.75.59-1.52.8-2.31c.06-.24.28-.41.53-.41Z" fill="${m ? 'currentColor' : '#669DF6'}"/>`);

    const buildBrandMarkSvg = (b, z = 14, t = 'auto', m = false) =>
      b === 'antigravity' ? renderSparkSvg(z, t, !!(m || readRootAccentTone() === 'mono'), '') : svgW('', z, '0 0 24 24', `<path d="${BRAND_PATHS[b] || BRAND_PATHS.gemini}" fill="currentColor" fill-rule="evenodd"/>`);

    const buildModelGlyphInnerSvg = (b, t, m = false) =>
      b === 'antigravity'
        ? renderSparkSvg(16, t || 'auto', m, 'ag-cs-model-glyph-svg')
        : svgW('ag-cs-model-glyph-svg', 16, '-4 -4 32 32',
            '<g class="ag-cs-glyph-orbit-group"><ellipse class="ag-cs-glyph-orbit" cx="12" cy="12" rx="14.5" ry="6.2" transform="rotate(-24 12 12)"/><circle class="ag-cs-glyph-sat is-a" cx="25.2" cy="6.1" r="1.65"/><circle class="ag-cs-glyph-sat is-b" cx="-1.2" cy="17.9" r="1.25"/></g>' +
            `<path class="ag-cs-glyph-body" d="${BRAND_PATHS[b] || BRAND_PATHS.gemini}" fill-rule="evenodd"/><circle class="ag-cs-glyph-core" cx="12" cy="12" r="${b === 'gemini' ? '2.7' : '2.1'}"/>` +
            (t === 'fixed' ? '<g class="ag-cs-glyph-lock"><rect x="15.2" y="16.2" width="8.6" height="6.8" rx="1.6"/><path d="M17.3 16.2v-1.7a2.2 2.2 0 1 1 4.4 0v1.7" fill="none" stroke-width="1.5"/></g>' : ''));

    const syncModelGlyphOnButton = (b) => {
      if (!b) return null;
      qa(b, '.ag-cs-effort-badge, [data-ag-cs-effort]').forEach((e) => { ra(e, 'data-ag-cs-effort'); e[K_CL].remove('ag-cs-effort-badge'); });
      const i = parseModelTriggerInfo(b);
      if (!isComposerRestyleEnabled()) { qa(b, '.ag-cs-model-glyph').forEach((n) => n.remove()); return i; }
      let g = qs(b, '.ag-cs-model-glyph'), cr = false;
      if (!g) { g = mk('span', 'ag-cs-model-glyph'); sa(g, 'data-icon', '1'); sa(g, A_AH, 'true'); sa(g, A_NI); sa(g, A_OW, '1'); cr = true; }
      if (b.firstChild !== g) b.insertBefore(g, b.firstChild);
      const isM = readRootAccentTone() === 'mono', ms = isM ? '1' : '0', pm = ga(g, 'data-mono');
      if (cr || ga(g, 'data-brand') !== i.brand || ga(g, 'data-tier') !== i.tier || pm !== ms) {
        sa(g, 'data-brand', i.brand); sa(g, 'data-tier', i.tier); sa(g, 'data-mono', ms);
        mountNode(g, cloneCachedSvgElement(`mg:${i.brand}:${i.tier}:${ms}`, buildModelGlyphInnerSvg(i.brand, i.tier, isM)));
        if (!cr && pm === ms && !motionReduced()) { g[K_CL].remove('is-pulsing'); rAF(() => { if (g[K_IC]) g[K_CL].add('is-pulsing'); }); }
      }
      return i;
    };

    const buildPanelRowGlyphSvg = (b, t, s, m = false) =>
      b === 'antigravity'
        ? renderSparkSvg(15, s ? t || 'auto' : 'low', !s || m, 'ag-cs-model-glyph-svg')
        : svgW('ag-cs-model-glyph-svg', 15, '0 0 24 24', `<path d="${BRAND_PATHS[b] || BRAND_PATHS.gemini}" ${s && !m ? 'style="fill:var(--glyph-color-hi);fill-opacity:1"' : `fill="currentColor" fill-opacity="${s ? '0.95' : '0.72'}"`} fill-rule="evenodd"/>`);

    const clearPanelRowGlyphs = (r = docOf()) => qa(r, '.ag-cs-panel-row-glyph').forEach((n) => n.remove());
    const isPanelRowSelected = (r) => !r ? false : ga(r, 'data-selected') === 'true' || ga(r, 'aria-checked') === 'true' || ga(r, 'data-state') === 'checked' || (ha(r, A_MS) ? ga(r, A_MS) === 'true' : clHas(r, 'text-foreground') && !clHas(r, 'text-secondary-foreground'));

    const syncPanelRowGlyphs = (p) => {
      if (!p) return;
      for (const r of qa(p, '[role="menuitem"], [role="option"], button')) {
        if (cl(r, '.ces-ag-section, [data-testid="orchestrator-effort-bar"]') || cl(r[K_PE], '[role="menuitem"], [role="option"], button')) continue;
        const lbl = readButtonLabelWithoutGlyph(r);
        if (!PANEL_MODEL_ROW_RE.test(lbl)) { clearPanelRowGlyphs(r); continue; }
        const i = parseModelLabelInfo(lbl), sel = isPanelRowSelected(r);
        let fc = null; if (r.children) for (const c of r.children) if (!clHas(c, 'ag-cs-model-glyph')) { fc = c; break; }
        const tp = fc && (qs(fc, '[data-testid="model-selector-effort-group"]') || /\bflex\b|\bitems-center\b/.test(String(fc.className || ''))) ? fc : r;
        let g = qs(r, '.ag-cs-panel-row-glyph'), cr = false;
        if (!g) { g = mk('span', 'ag-cs-model-glyph ag-cs-panel-row-glyph'); sa(g, A_NI); sa(g, A_AH, 'true'); sa(g, A_OW, '1'); cr = true; }
        if (g[K_PE] !== tp || tp.firstChild !== g) tp.insertBefore(g, tp.firstChild);
        const ss = sel ? 'true' : 'false', isM = readRootAccentTone() === 'mono', ms = isM ? '1' : '0';
        if (cr || ga(g, 'data-brand') !== i.brand || ga(g, 'data-tier') !== i.tier || ga(g, 'data-selected') !== ss || ga(g, 'data-mono') !== ms) {
          sa(g, 'data-brand', i.brand); sa(g, 'data-tier', i.tier); sa(g, 'data-selected', ss); sa(g, 'data-mono', ms);
          mountNode(g, cloneCachedSvgElement(`pr:${i.brand}:${i.tier}:${ss}:${ms}`, buildPanelRowGlyphSvg(i.brand, i.tier, sel, isM)));
          sp(g, 'opacity', sel ? '1' : '0.78'); sp(g, 'filter', sel && i.brand !== 'openai' && !isM ? 'drop-shadow(0 0 3px var(--glyph-glow))' : 'none');
        }
      }
    };

    const detachSliderWake = () => {
      if (mWakeTrk && mWakeFn) try { mWakeTrk.removeEventListener('pointerdown', mWakeFn); } catch {}
      mWakeTrk = mWakeFn = null;
    };

    const EFF_ROW_SEL = '.ces-ag-effort-row:not([data-testid="orchestrator-effort-bar"])';
    const ORCH_CV_SEL = 'canvas[data-orch-crystal-canvas="true"]';

    const clearSliderPrismOverlay = (p) => {
      detachSliderWake();
      if (!p) return;
      qa(p, '.ces-ag-effort-row[data-ag-orch-p]').forEach((r) => {
        ra(r, 'data-ag-orch-p');
        const t = qs(r, '.ces-track');
        if (t) {
          t[K_CL].remove(C_OT); qa(t, ORCH_CV_SEL).forEach((c) => c.remove());
          const k = qs(t, '.ces-knob'); k && (k.style.removeProperty('--knob-px'), k.style.removeProperty('--knob-py'));
        }
      });
    };

    const getCachedKnob = (trk) => {
      if (!trk || trk[K_IC] === false) return null;
      if (mKnob && mKnob[K_IC] !== false && (mKnob[K_PE] === trk || trk.contains?.(mKnob))) return mKnob;
      return (mKnob = qs(trk, '.ces-knob'));
    };

    const readTrackFillRatio = (t) => {
      if (!t) return 1;
      let w = t === mTrk && mTrkWidth > 4 ? mTrkWidth : 0;
      if (!(w > 4)) { w = t.clientWidth || rc(t)?.width || 220; if (t === mTrk && w > 4) mTrkWidth = w; }
      const s = t.style?.getPropertyValue?.('--ces-fill')?.trim() || '';
      if (s && w > 4) {
        const m = s.match(/calc\(\s*([0-9.]+)px\s*\+\s*\(100%\s*-\s*([0-9.]+)px\)\s*\*\s*([0-9.eE+-]+)\s*\)/);
        if (m) { const r = pF(m[1]), sp = pF(m[2]), p = pF(m[3]); if (isF(r) && isF(sp) && isF(p)) return clamp01((r + (w - sp) * p) / w); }
        const px = pF(s); if (isF(px)) return clamp01(px / w);
      }
      const k = t === mTrk ? getCachedKnob(t) : qs(t, '.ces-knob');
      if (k && typeof k.offsetLeft === 'number' && k.offsetLeft > 0 && w > 4) return clamp01(k.offsetLeft / w);
      if (w > 4) { const mx = pF(ga(t, 'aria-valuemax')), nv = pF(ga(t, 'aria-valuenow')); if (isF(mx) && mx > 0 && isF(nv)) return clamp01((14 + (w - 28) * (nv / mx)) / w); }
      return 1;
    };

    let kpHot = false;
    const syncKnobPrismPointer = (cx, cy) => {
      const t = mHideLock ? mTrk : null, k = getCachedKnob(t);
      if (!k) { kpHot = false; mKnobRect = null; return; }
      const clr = () => { if (kpHot) { sp(k, '--knob-px', '-9999px'); sp(k, '--knob-py', '-9999px'); kpHot = false; } };
      if (motionReduced() || readRootAmbientFloat() <= 0.001 || !(cx > -1000 && cy > -1000)) { clr(); return; }
      const fs = t?.style?.getPropertyValue?.('--ces-fill') || '', nw = nowMs();
      let r = mKnobRect;
      if (!r || fs !== mKnobFillSig || nw - mKnobRectAt > 120) { r = rc(k); mKnobRect = r && r.width >= 4 ? r : null; mKnobRectAt = nw; mKnobFillSig = fs; }
      if (!r || r.width < 4) return;
      const lx = cx - r.left, ly = cy - r.top;
      if (Math.hypot(lx - r.width * 0.5, ly - r.height * 0.5) <= 56) { sp(k, '--knob-px', `${lx.toFixed(1)}px`); sp(k, '--knob-py', `${ly.toFixed(1)}px`); kpHot = true; } else clr();
    };

    const cancelMountRaf = () => { if (mMountRaf) { cAF(mMountRaf); mMountRaf = 0; } };
    const cancelStepRaf = () => { if (mRaf) { cAF(mRaf); mRaf = 0; } };

    const resetKnobCache = () => {
      mKnob = mKnobRect = null; mTrkWidth = mKnobRectAt = 0; mKnobFillSig = ''; mStepFillRatio = null;
    };

    const stopCrystalOnPanel = (p) => {
      detachSliderWake(); cancelMountRaf(); cancelStepRaf(); try { mInst?.dispose?.(); } catch {}
      if (p) { clearSliderPrismOverlay(p); ra(p, A_OA); qa(p, EFF_ROW_SEL).forEach((r) => { ra(r, A_RH); ra(r, A_AH); }); }
      if (mBar?.[K_PE]) mBar.remove();
      mPanel = mBar = mTrk = mCv = mInst = null; mRaf = mMountRaf = mLastMs = mMountedAt = 0; resetKnobCache(); mWasOrch = mHideLock = false;
    };
    const teardownCrystalMount = () => { const p = mPanel?.[K_IC] ? mPanel : null; if (p) clearPanelRowGlyphs(p); stopCrystalOnPanel(p); clearPanelRowGlyphs(); syncModelMenuAttrs(null); mOv = null; };
    const ORCH_LBL_RE = /\borchestrator\b|编排|调度器/i;
    const isOrchRowLbl = (e) => ORCH_LBL_RE.test(stripTranslatedEffortSuffix(readButtonLabelWithoutGlyph(e)));
    const detectPanelIsOrchestrator = (p, fb) => {
      const cs = p && qs(p, `[${A_MS}="true"]`);
      if (cs) return ga(cs, 'data-testid') === 'model-selector-orchestrator' || Boolean(qs(cs, '[data-testid="model-selector-orchestrator"]')) || isOrchRowLbl(cs);
      if (fb && typeof fb.isOrchestrator === 'boolean') return fb.isOrchestrator;
      if (p) {
        let s = qs(p, `[data-selected="true"], [aria-checked="true"], [data-state="checked"], [${A_MS}="true"]`);
        if (!s) for (const r of qa(p, '[role="menuitem"], [role="option"], button')) if (isPanelRowSelected(r)) { s = r; break; }
        if (s) return isOrchRowLbl(s);
      }
      return false;
    };
    const cSt = { prismStrength: 1 };
    const stepCrystalLoop = (now) => {
      mRaf = 0; if (isDestroyed() || !mInst || !mPanel?.[K_IC] || !mWasOrch) return;
      const mg = Math.max(getMinFrameGapMs(), mInst.isMotionHot?.() === false ? 32 : 0);
      if (mg > 0 && mLastMs > 0 && now - mLastMs < mg) { if (!motionReduced() && !isHid()) mRaf = rAF(stepCrystalLoop); return; }
      const dt = mLastMs > 0 ? Math.min(0.05, Math.max(0.002, (now - mLastMs) / 1000)) : 0.016; mLastMs = now;
      mStepFillRatio = mHideLock ? readTrackFillRatio(mTrk) : -1;
      const ptr = getLastPointerPos?.(); if (ptr) syncKnobPrismPointer(ptr.x, ptr.y);
      try { mInst.step(dt); } catch {} finally { mStepFillRatio = null; }
      if (!mInst.isIdle?.() && !isHid()) mRaf = rAF(stepCrystalLoop);
    };
    const syncModelSelectorPanel = (prim) => {
      const p = qs(docOf(), '[data-testid="model-selector-panel"]'); syncModelMenuAttrs(p);
      if (!isComposerRestyleEnabled() || !p) { clearPanelRowGlyphs(); if (mPanel || mBar) { teardownCrystalMount(); if (p) syncModelMenuAttrs(p); } return; }
      if (mPanel && mPanel !== p) { teardownCrystalMount(); syncModelMenuAttrs(p); }
      syncPanelRowGlyphs(p);
      if (isEffortSliderOff()) { qa(p, '[data-testid="orchestrator-effort-bar"]').forEach((b) => b.remove?.()); stopCrystalOnPanel(p); return; }
      const isO = detectPanelIsOrchestrator(p, prim), isOT = isO && ga(p, 'data-ces-orch-tunable') === 'true', cs = qs(p, '.ces-ag-section');
      if (cs) { if (ga(cs, 'data-effort-slot') !== 'true') sa(cs, 'data-effort-slot', 'true'); qs(cs, '[role="separator"]') ? setAttrIfChanged(cs, 'data-has-sep', '1') : ha(cs, 'data-has-sep') && ra(cs, 'data-has-sep'); }
      const slot = cs || p;
      let bar = qs(p, '[data-testid="orchestrator-effort-bar"]');
      if (!bar) {
        bar = markNoTr(mk('div', 'ces-ag-effort-row ag-cs-orch-row')); sa(bar, 'data-testid', 'orchestrator-effort-bar'); sa(bar, A_NI); sa(bar, A_OW, '1');
        const hd = markNoTr(mk('div', 'ces-ag-effort-head ag-cs-orch-head'));
        hd.appendChild(markNoTr(mk('span', 'ces-ag-effort-title', isZh() ? '推理等级' : 'Reasoning Effort')));
        hd.appendChild(markNoTr(mk('span', 'ces-ag-effort-value ag-cs-orch-value', 'Auto')));
        const inl = markNoTr(mk('div', 'ces-inline')), trk = mk('div', C_OT), cv = mk('canvas', 'ag-cs-orch-canvas');
        sa(trk, 'role', 'status'); sa(trk, 'aria-label', 'Orchestrator Auto'); sa(cv, A_OC, 'true'); sa(cv, A_AH, 'true');
        trk.appendChild(cv); inl.appendChild(trk); bar.appendChild(hd); bar.appendChild(inl); slot.appendChild(bar);
      } else if (bar[K_PE] !== slot) slot.appendChild(bar);
      const sR = qs(p, EFF_ROW_SEL), sT = sR && qs(sR, '.ces-track'), useSP = !!(isO && isOT && sR && sT), useA = !!(isO && !useSP);
      let tT = qs(bar, '.' + C_OT), tC = qs(bar, ORCH_CV_SEL);
      if (useSP) {
        setAttrIfChanged(sR, 'data-ag-orch-p', '1'); sT[K_CL].add(C_OT);
        let c = qs(sT, ORCH_CV_SEL);
        if (!c) { c = mk('canvas', 'ag-cs-orch-canvas'); sa(c, A_OC, 'true'); sa(c, A_AH, 'true'); sa(c, A_OW, '1'); sT.insertBefore(c, sT.firstChild); }
        tT = sT; tC = c;
        if (mWakeTrk !== sT) {
          detachSliderWake();
          const onW = (ev) => { mKnobRect = null; if (ev && typeof ev.clientX === 'number') syncKnobPrismPointer(ev.clientX, ev.clientY); if (!mRaf && mInst && !isHid()) { mLastMs = nowMs(); mRaf = rAF(stepCrystalLoop); } };
          try { sT.addEventListener('pointerdown', onW, { passive: true }); } catch {}
          mWakeTrk = sT; mWakeFn = onW;
        }
      } else clearSliderPrismOverlay(p);
      if (mInst && mCv && mCv !== tC) { cancelMountRaf(); cancelStepRaf(); try { mInst.dispose?.(); } catch {} mInst = null; }
      if (mTrk !== tT) resetKnobCache();
      mPanel = p; mBar = bar; mTrk = tT; mCv = tC; mHideLock = useSP;
      useA ? setAttrIfChanged(p, A_OA, '1') : ra(p, A_OA);
      const uS = String(useA), bS = String(!useA);
      qa(p, EFF_ROW_SEL).forEach((r) => { setAttrIfChanged(r, A_RH, uS); setAttrIfChanged(r, A_AH, uS); });
      const sw = isO && !mWasOrch; mWasOrch = isO;
      setAttrIfChanged(bar, A_RH, bS); setAttrIfChanged(bar, A_AH, bS);
      if (isO) {
        const kick = () => {
          if (isDestroyed() || isEffortSliderOff() || !mWasOrch || mPanel !== p || !p[K_IC] || !mCv) return;
          const red = motionReduced(), amb = readRootAmbientFloat();
          if (!mInst && crystalPrismCore?.mountCrystalPrismBar && canMountRealCanvas(mCv)) try { mInst = crystalPrismCore.mountCrystalPrismBar(mCv, { reduceMotion: red, getState: () => { const dk = isDarkTheme(); cSt.isDark = dk; cSt.ambientIntensity = readRootAmbientFloat(); cSt.accentTone = resolveCrystalAccentMode(dk); cSt.reduceMotion = motionReduced(); cSt.hideLock = !!mHideLock; cSt.fillRatio = mStepFillRatio !== null ? mStepFillRatio : mHideLock ? readTrackFillRatio(mTrk) : -1; return cSt; } }); } catch { mInst = null; }
          if (!mInst) return;
          mInst.setReduceMotion?.(red); mStepFillRatio = mHideLock ? readTrackFillRatio(mTrk) : -1;
          const ptr = getLastPointerPos?.();
          ptr && ptr.x > -1000 ? (mInst.setPointerClient(ptr.x, ptr.y), syncKnobPrismPointer(ptr.x, ptr.y)) : syncKnobPrismPointer(-9999, -9999);
          if (sw || !mMountedAt) { mMountedAt = nowMs(); if (!red && amb > 0.001) mInst.wake?.(); }
          try { mInst.step(0.016); } catch {} finally { mStepFillRatio = null; }
          if (mInst.isIdle?.() || isHid()) cancelStepRaf(); else if (!mRaf) { mLastMs = nowMs(); mRaf = rAF(stepCrystalLoop); }
        };
        if (mInst) kick(); else if (!mMountRaf) { mMountRaf = rAF(() => { mMountRaf = 0; kick(); }); if (!mMountRaf) kick(); }
      } else { cancelMountRaf(); cancelStepRaf(); }
    };

    return {
      readButtonLabelWithoutGlyph, stripTranslatedEffortSuffix, normalizeModelEffortLabel, parseModelLabelInfo, resolveMascotCamp,
      parseModelTriggerInfo, renderSparkSvg, buildBrandMarkSvg, parseSvgElement, mountNode, cloneCachedSvgElement,
      syncModelGlyphOnButton, syncPanelRowGlyphs, clearPanelRowGlyphs, teardownCrystalMount, syncModelSelectorPanel,
      getActiveCrystalTrack: () => (mTrk && mWasOrch && mTrk[K_IC] !== false ? mTrk : null),
      setCrystalPointerClient: (x, y) => {
        syncKnobPrismPointer(x, y);
        if (mInst?.setPointerClient) {
          mInst.setPointerClient(x, y);
          if (!mRaf && mWasOrch && mPanel?.[K_IC] !== false && !motionReduced() && !isHid() && !mInst.isIdle?.()) { mLastMs = nowMs(); mRaf = rAF(stepCrystalLoop); }
        }
      },
    };
  };

  const api = { BRAND_PATHS, readButtonLabelWithoutGlyph, stripTranslatedEffortSuffix, normalizeModelEffortLabel, parseModelLabelInfo, resolveMascotCamp, createModelGlyphCrystalController };
  if (typeof module === 'object' && module.exports) module.exports = api;
  G.__agPrismModelGlyphCrystal = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
