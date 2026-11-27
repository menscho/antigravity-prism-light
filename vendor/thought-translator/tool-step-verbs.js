// Obsidian Prism — Static Tool-Step Action Verbs & v2.35 Collapsible Body Resolver
// Pure browser module prepended before thought-client.js by Channel 5 (src/channels/builders-addons.cjs).
(function (root) {
  'use strict';
  const W = root || (typeof window !== 'undefined' ? window : globalThis);
  if (!W) return;

  // Exact standalone Antigravity tool-step action verb prefixes (0 API cost, 0ms replace, full undo tracking)
  const TOOL_STEP_VERB_KEYS = Object.freeze([
    'Analyzed',
    'Searched',
    'Ran',
    'Running',
    'Edited',
    'Viewed',
    'Explored',
    'Created',
    'Updated',
    'Deleted',
    'Listed',
    'Checked',
    'Read',
    'Killed',
    'Posted',
    'Waiting',
    'Asking',
  ]);

  const TOOL_STEP_VERB_LOCALES = Object.freeze({
    'zh-CN': '已分析|已搜索|已运行|正在运行|已编辑|已查看|已探索|已创建|已更新|已删除|已列出|已检查|已读取|已终止|已发布|等待中|正在询问',
    'zh-TW': '已分析|已搜尋|已執行|執行中|已編輯|已檢視|已探索|已建立|已更新|已刪除|已列出|已檢查|已讀取|已終止|已發佈|等待中|正在詢問',
    ja: '分析済み|検索済み|実行済み|実行中|編集済み|閲覧済み|探索済み|作成済み|更新済み|削除済み|一覧取得|確認済み|読込済み|終了済み|投稿済み|待機中|質問中',
    ko: '분석함|검색함|실행함|실행 중|편집함|조회함|탐색함|생성함|업데이트함|삭제함|목록 조회|확인함|읽음|종료함|게시함|대기 중|질문 중',
    es: 'Analizado|Buscado|Ejecutado|Ejecutando|Editado|Visto|Explorado|Creado|Actualizado|Eliminado|Listado|Verificado|Leído|Detenido|Publicado|Esperando|Preguntando',
    fr: 'Analysé|Recherché|Exécuté|Exécution|Modifié|Consulté|Exploré|Créé|Mis à jour|Supprimé|Listé|Vérifié|Lu|Arrêté|Publié|En attente|Demande',
    de: 'Analysiert|Gesucht|Ausgeführt|Läuft|Bearbeitet|Angesehen|Erkundet|Erstellt|Aktualisiert|Gelöscht|Aufgelistet|Geprüft|Gelesen|Beendet|Gepostet|Wartet|Fragt',
    tr: 'İncelendi|Arandı|Çalıştırıldı|Çalışıyor|Düzenlendi|Görüntülendi|Keşfedildi|Oluşturuldu|Güncellendi|Silindi|Listelendi|Kontrol edildi|Okundu|Sonlandırıldı|Gönderildi|Bekleniyor|Soruluyor',
  });

  const TOOL_STEP_VERB_MAP = Object.create(null);
  for (const lk of Object.keys(TOOL_STEP_VERB_LOCALES)) {
    const vals = TOOL_STEP_VERB_LOCALES[lk].split('|');
    const m = Object.create(null);
    for (let i = 0; i < TOOL_STEP_VERB_KEYS.length; i++) {
      m[TOOL_STEP_VERB_KEYS[i].toLowerCase()] = vals[i];
    }
    TOOL_STEP_VERB_MAP[lk] = m;
  }

  function normalizeVerbLang(raw) {
    const s = String(raw || '').trim().toLowerCase().replace(/_/g, '-');
    if (!s || s === 'auto') return '';
    if (s === 'zh-tw' || s === 'zh-hk' || s === 'zh-mo' || s.startsWith('zh-hant')) return 'zh-TW';
    if (s === 'zh-cn' || s === 'zh' || s === 'yue' || s === 'zh-yue' || s.startsWith('zh-hans')) return 'zh-CN';
    if (s === 'ja' || s.startsWith('ja-')) return 'ja';
    if (s === 'ko' || s.startsWith('ko-')) return 'ko';
    if (s === 'es' || s.startsWith('es-')) return 'es';
    if (s === 'fr' || s.startsWith('fr-')) return 'fr';
    if (s === 'de' || s.startsWith('de-')) return 'de';
    if (s === 'tr' || s.startsWith('tr-') || s === 'turkish' || s === 'türkçe' || s === 'turkce') return 'tr';
    if (s === 'en' || s.startsWith('en-')) return 'en';
    return '';
  }

  function lookupStaticToolVerb(trimmed, targetLang) {
    if (!trimmed || trimmed.length < 3 || trimmed.length > 14 || /\s/.test(trimmed)) return null;
    const tl = normalizeVerbLang(targetLang);
    const map = tl ? TOOL_STEP_VERB_MAP[tl] : null;
    if (!map) return null;
    return map[trimmed.toLowerCase()] || null;
  }

  function ga(el, k) {
    return el && typeof el.getAttribute === 'function' ? el.getAttribute(k) : null;
  }

  function hasAttr(el, k) {
    if (!el) return false;
    return typeof el.hasAttribute === 'function' ? el.hasAttribute(k) : ga(el, k) !== null;
  }

  function nextSib(el) {
    return el ? el.nextElementSibling || null : null;
  }

  function parEl(el) {
    return el ? el.parentElement || null : null;
  }

  function isProseBoundaryEl(el) {
    if (!el || el.nodeType !== 1) return false;
    const tid = ga(el, 'data-testid') || '';
    if (tid === 'planner-response-text' || tid === 'user-message-bubble') return true;
    if (hasAttr(el, 'data-markdown-root')) return true;
    const cls = el.classList;
    if (cls && (cls.contains('prose') || cls.contains('markdown-body') || cls.contains('rendered-markdown'))) return true;
    return false;
  }

  function findToolCollapsibleBody(trig) {
    if (!trig) return null;
    const direct = nextSib(trig);
    if (direct && String(direct.tagName || '').toUpperCase() === 'DIV' && !isProseBoundaryEl(direct)) {
      return direct;
    }
    // Antigravity v2.35 may place [data-testid="step-plan-chip"] alongside worked-for-collapsible inside a flex header wrapper.
    let sib = direct ? nextSib(direct) : null;
    while (sib) {
      if (String(sib.tagName || '').toUpperCase() === 'DIV' && !isProseBoundaryEl(sib)) return sib;
      sib = nextSib(sib);
    }
    const parent = parEl(trig);
    if (parent && String(parent.tagName || '').toUpperCase() === 'DIV' && !isProseBoundaryEl(parent)) {
      const pNext = nextSib(parent);
      if (pNext && String(pNext.tagName || '').toUpperCase() === 'DIV' && !isProseBoundaryEl(pNext) && !hasAttr(pNext, 'data-step-index')) {
        return pNext;
      }
    }
    return null;
  }

  const api = Object.freeze({
    TOOL_STEP_VERB_KEYS,
    TOOL_STEP_VERB_LOCALES,
    TOOL_STEP_VERB_MAP,
    normalizeVerbLang,
    lookupStaticToolVerb,
    isProseBoundaryEl,
    findToolCollapsibleBody,
  });

  W.__agPrismToolStepVerbs = api;
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
