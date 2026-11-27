// Beta.4 独立 9 语种扩展词典（Issue #98 自定义字体 + Issue #101 忽略系统减弱动效 + 性能模式）
// 严格遵循 9 语种规范：zh-CN / zh-TW / en / ja / ko / es / fr / de / tr；非 CJK 语种 0 汉字、0 yue、0 禁用词
(function (root, factory) {
  const api = factory();
  if (root) root.__agPrismI18nExtBeta4 = api;
  if (typeof window !== 'undefined' && window && window !== root) {
    window.__agPrismI18nExtBeta4 = api;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  const LOCALES = Object.freeze(['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'tr']);
  const LOCALE_INDEX = Object.freeze(Object.fromEntries(LOCALES.map((l, i) => [l, i])));

  // 列序严格对齐 LOCALES：[zh-CN, zh-TW, en, ja, ko, es, fr, de, tr]
  const TABLE = Object.freeze({
    setPerformanceModeTitle: [
      '性能模式',
      '效能模式',
      'Performance Mode',
      'パフォーマンスモード',
      '성능 모드',
      'Modo de rendimiento',
      'Mode de performance',
      'Leistungsmodus',
      'Performans Modu',
    ],
    setPerformanceModeDesc: [
      '无损调节运行期帧率上限、渲染分辨率与瞬态模糊，不改写您的动效、波纹或宠物设置，随时切回原样恢复。',
      '無損調節執行期影格率上限、渲染解析度與瞬態模糊，不改寫您的動效、波紋或寵物設定，隨時切回原樣恢復。',
      'Losslessly caps runtime FPS, render DPR, and heavy blur without altering your motion, ripple, or mascot settings; switch back anytime to restore.',
      'モーション・波紋・マスコット設定を変更せず、実行時の FPS 上限・DPR・高負荷ブラーを非破壊で調整します。いつでも元に戻せます。',
      '모션, 물결, 마스코트 설정을 덮어쓰지 않고 실행 시 FPS 상한, DPR 및 무거운 블러를 무손실로 조절합니다. 언제든 원래대로 복원됩니다.',
      'Ajusta sin pérdidas el límite de FPS, DPR y desenfoque intenso en ejecución sin modificar tus ajustes de movimiento, ondas ni mascota.',
      'Ajuste sans perte la limite de FPS, le DPR et le flou intense sans modifier vos réglages d’animation, d’onde ou de mascotte.',
      'Begrenzt FPS, DPR und starken Weichzeichner verlustfrei zur Laufzeit, ohne Animations-, Wellen- oder Maskottchen-Einstellungen zu überschreiben.',
      'Hareket, dalga veya maskot ayarlarınızı değiştirmeden çalışma zamanı FPS sınırını, DPR ve yoğun bulanıklığı kayıpsız ayarlar; istediğiniz zaman geri dönebilirsiniz.',
    ],
    optPerfPerformance: [
      '极速省电',
      '極速省電',
      'Performance',
      'パフォーマンス',
      '성능 우선',
      'Rendimiento',
      'Performance',
      'Leistung',
      'Performans',
    ],
    optPerfBalanced: [
      '均衡',
      '均衡',
      'Balanced',
      'バランス',
      '균형',
      'Equilibrado',
      'Équilibré',
      'Ausgewogen',
      'Dengeli',
    ],
    optPerfQuality: [
      '全效',
      '全效',
      'Quality',
      '高品質',
      '최고 품질',
      'Calidad',
      'Qualité',
      'Qualität',
      'Kalite',
    ],
    setIgnoreReducedMotionTitle: [
      '忽略系统减弱动效',
      '忽略系統減弱動效',
      'Ignore System Reduced Motion',
      'システムの視差効果を減らす設定を無視',
      '시스템 동작 줄이기 무시',
      'Ignorar reducción de movimiento del sistema',
      'Ignorer la réduction des animations système',
      'Systemeinstellung für reduzierte Bewegung ignorieren',
      'Sistem Azaltılmış Hareketini Yoksay',
    ],
    setIgnoreReducedMotionDesc: [
      '关闭 Windows/macOS 系统动画时，仍允许 Prism 按所选动效档位播放；「动效关闭」仍完全禁用全部动效。',
      '關閉 Windows/macOS 系統動畫時，仍允許 Prism 依所選動效檔位播放；「動效關閉」仍會完全停用所有動效。',
      'Allow Prism animations to play at the selected Motion Level even when OS animations are disabled. Motion Level "Off" always disables all animations.',
      'Windows/macOS のシステムアニメーションが無効でも、選択したモーション強度で Prism アニメーションを再生します。「オフ」時は常に完全無効です。',
      'Windows/macOS 시스템 애니메이션이 꺼져 있어도 선택한 모션 강도로 Prism 애니메이션을 재생합니다. 모션 강도 "끄기"는 항상 모든 애니메이션을 비활성화합니다.',
      'Permite reproducir animaciones de Prism según el nivel elegido aunque el sistema operativo las desactive. El nivel "Desactivado" siempre las deshabilita por completo.',
      'Autorise les animations Prism selon le niveau choisi même lorsque les animations système sont désactivées. Le niveau « Désactivé » coupe toujours toute animation.',
      'Erlaubt Prism-Animationen gemäß gewählter Animationsstufe, auch wenn OS-Animationen deaktiviert sind. Die Stufe „Aus“ deaktiviert Animationen weiterhin vollständig.',
      'İşletim sistemi animasyonları kapalı olsa bile Prism animasyonlarının seçilen hareket düzeyinde oynatılmasına izin verir. "Kapalı" düzeyi her zaman tüm animasyonları devre dışı bırakır.',
    ],
    setChatFontTitle: [
      '会话正文字体',
      '對話正文字型',
      'Chat Body Font',
      'チャット本文フォント',
      '채팅 본문 글꼴',
      'Fuente del texto del chat',
      'Police du texte du chat',
      'Chat-Textschriftart',
      'Sohbet Metni Yazı Tipi',
    ],
    setChatFontDesc: [
      '自定义会话消息正文与输入框字体，不干扰代码等宽字体与界面图标，缺失字形自动回退系统字体。',
      '自訂對話訊息正文與輸入框字型，不影響程式碼等寬字型與介面圖示，缺少字形時自動回退系統字型。',
      'Customize chat message body and input font without affecting monospace code blocks or UI icons. Missing glyphs fall back automatically.',
      'チャット本文と入力欄のフォントを設定します。コード等幅フォントやアイコンには影響せず、不足グリフは自動でフォールバックします。',
      '코드 고정폭 글꼴과 UI 아이콘에 영향을 주지 않고 채팅 본문과 입력창 글꼴을 설정합니다. 없는 글리프는 시스템 글꼴로 자동 대체됩니다.',
      'Personaliza la fuente del texto y del cuadro de entrada sin afectar bloques de código ni iconos. Los glifos faltantes usan respaldo automático.',
      'Personnalise la police des messages et de la saisie sans altérer le code ni les icônes. Les glyphes manquants basculent automatiquement.',
      'Passt die Schriftart für Chat-Nachrichten und Eingabefeld an, ohne Codeblöcke oder Symbole zu verändern. Fehlende Glyphen nutzen automatischen Fallback.',
      'Eş aralıklı kod bloklarını veya arayüz simgelerini etkilemeden sohbet metni ve giriş kutusu yazı tipini özelleştirir. Eksik glifler otomatik olarak sistem yazı tipine döner.',
    ],
    optChatFontDefault: [
      '宿主默认',
      '宿主預設',
      'Host Default',
      'ホスト既定',
      '호스트 기본값',
      'Predeterminada',
      'Par défaut',
      'Standard',
      'Ana Varsayılan',
    ],
    optChatFontSystemSans: [
      '系统无衬线',
      '系統無襯線',
      'System Sans',
      'システム Sans',
      '시스템 산세리프',
      'Sans del sistema',
      'Sans système',
      'System-Sans',
      'Sistem Sans',
    ],
    optChatFontNotoSans: [
      '思源黑体 (Noto Sans)',
      '思源黑體 (Noto Sans)',
      'Noto Sans',
      'Noto Sans',
      'Noto Sans',
      'Noto Sans',
      'Noto Sans',
      'Noto Sans',
      'Noto Sans',
    ],
    optChatFontInter: [
      'Inter',
      'Inter',
      'Inter',
      'Inter',
      'Inter',
      'Inter',
      'Inter',
      'Inter',
      'Inter',
    ],
    optChatFontHarmony: [
      '鸿蒙黑体 (HarmonyOS Sans)',
      '鴻蒙黑體 (HarmonyOS Sans)',
      'HarmonyOS Sans',
      'HarmonyOS Sans',
      'HarmonyOS Sans',
      'HarmonyOS Sans',
      'HarmonyOS Sans',
      'HarmonyOS Sans',
      'HarmonyOS Sans',
    ],
    optFontCustom: [
      '自定义',
      '自訂',
      'Custom',
      'カスタム',
      '사용자 지정',
      'Personalizada',
      'Personnalisée',
      'Benutzerdefiniert',
      'Özel',
    ],
    chatFontCustomPlaceholder: [
      '输入字体名称，多个以逗号分隔（如 LXGW WenKai, PingFang SC）',
      '輸入字型名稱，多個以逗號分隔（如 LXGW WenKai, PingFang TC）',
      'Font family names, comma-separated (e.g. Inter, Segoe UI)',
      'フォント名を入力（カンマ区切り、例: BIZ UDPGothic, Inter）',
      '글꼴 이름 입력, 쉼표로 구분 (예: Pretendard, Inter)',
      'Nombres de fuentes separados por comas (ej. Inter, Segoe UI)',
      'Noms de polices séparés par des virgules (ex. Inter, Segoe UI)',
      'Schriftartnamen, kommagetrennt (z. B. Inter, Segoe UI)',
      'Virgülle ayrılmış yazı tipi adları (örn. Inter, Segoe UI)',
    ],
    codeFontCustomPlaceholder: [
      '输入等宽字体名，逗号分隔（如 Maple Mono, Fira Code）',
      '輸入等寬字型名，逗號分隔（如 Maple Mono, Fira Code）',
      'Monospace font families, comma-separated (e.g. Maple Mono, Fira Code)',
      '等幅フォント名を入力（カンマ区切り、例: HackGen, Fira Code）',
      '고정폭 글꼴 이름 입력, 쉼표로 구분 (예: D2Coding, Fira Code)',
      'Fuentes monoespaciadas separadas por comas (ej. Maple Mono, Fira Code)',
      'Polices à chasse fixe séparées par des virgules (ex. Maple Mono, Fira Code)',
      'Monospace-Schriftarten, kommagetrennt (z. B. Maple Mono, Fira Code)',
      'Virgülle ayrılmış eş aralıklı yazı tipleri (örn. Maple Mono, Fira Code)',
    ],
    btnLoadLocalFonts: [
      '读取本机字体',
      '讀取本機字型',
      'Load Local Fonts',
      'ローカルフォント読込',
      '로컬 글꼴 불러오기',
      'Cargar fuentes locales',
      'Charger les polices locales',
      'Lokale Schriften laden',
      'Yerel Yazı Tiplerini Yükle',
    ],
    btnResetFontDefault: [
      '恢复默认',
      '恢復預設',
      'Reset Default',
      '既定に戻す',
      '기본값 복원',
      'Restablecer',
      'Réinitialiser',
      'Zurücksetzen',
      'Varsayılana Sıfırla',
    ],
    fontLocalLoading: [
      '正在读取本机字体…',
      '正在讀取本機字型…',
      'Loading local fonts...',
      'ローカルフォントを読み込み中…',
      '로컬 글꼴을 불러오는 중...',
      'Cargando fuentes locales...',
      'Chargement des polices locales...',
      'Lokale Schriften werden geladen...',
      'Yerel yazı tipleri yükleniyor...',
    ],
    fontLocalLoaded: [
      '已加载 {n} 个本机字体，可在输入框下拉选择',
      '已載入 {n} 個本機字型，可在輸入框下拉選擇',
      'Loaded {n} local fonts for autocomplete',
      '{n} 件のローカルフォントを読み込みました',
      '로컬 글꼴 {n}개를 불러왔습니다',
      'Se cargaron {n} fuentes locales para autocompletar',
      '{n} polices locales chargées pour la saisie',
      '{n} lokale Schriftarten für die Auswahl geladen',
      'Otomatik tamamlama için {n} yerel yazı tipi yüklendi',
    ],
    fontLocalUnsupported: [
      '当前宿主不支持读取本机字体，请直接手动输入字体名称',
      '目前宿主不支援讀取本機字型，請直接手動輸入字型名稱',
      'Local font enumeration is unavailable here; type font names manually',
      'この環境ではローカルフォント一覧を取得できません。手動で入力してください',
      '이 환경에서는 로컬 글꼴 조회를 지원하지 않습니다. 직접 입력해 주세요',
      'La detección de fuentes locales no está disponible; escribe el nombre manualmente',
      'La détection des polices locales est indisponible ; saisissez le nom manuellement',
      'Lokale Schrifterkennung ist nicht verfügbar; bitte Namen manuell eingeben',
      'Bu ortamda yerel yazı tipi listeleme kullanılamıyor; yazı tipi adlarını el ile girin',
    ],
    fontLocalDenied: [
      '未授权访问本机字体，已回退为手动输入',
      '未授權存取本機字型，已回退為手動輸入',
      'Font permission was declined; you can still enter font names manually',
      'フォント一覧へのアクセスが拒否されました。手動入力を利用できます',
      '글꼴 권한이 거부되었습니다. 수동 입력을 계속 사용할 수 있습니다',
      'Permiso de fuentes denegado; puedes seguir ingresando nombres manualmente',
      'Autorisation refusée ; vous pouvez toujours saisir les polices manuellement',
      'Schriftzugriff verweigert; manuelle Eingabe bleibt weiterhin möglich',
      'Yazı tipi izni reddedildi; yazı tipi adlarını el ile girmeye devam edebilirsiniz',
    ],
    fontSanitizedNotice: [
      '已自动过滤不安全字符，仅保留有效字体名',
      '已自動過濾不安全字元，僅保留有效字型名',
      'Unsafe characters were stripped; only valid font family names are applied',
      '安全でない文字を除外し、有効なフォント名のみ適用しました',
      '안전하지 않은 문자를 제거하고 유효한 글꼴 이름만 적용했습니다',
      'Se filtraron caracteres no seguros; solo se aplican nombres válidos',
      'Les caractères non sûrs ont été filtrés ; seuls les noms valides sont appliqués',
      'Unsichere Zeichen wurden entfernt; nur gültige Schriftartnamen werden angewendet',
      'Güvenli olmayan karakterler temizlendi; yalnızca geçerli yazı tipi adları uygulandı',
    ],
    setTelemetryQuotaModeTitle: [
      '底栏配额显示',
      '底欄配額顯示',
      'Footer Quota Display',
      'フッター枠表示',
      '하단 할당량 표시',
      'Cuota en barra inferior',
      'Affichage du quota',
      'Kontingent-Anzeige',
      'Alt Çubuk Kota Görünümü',
    ],
    setTelemetryQuotaModeDesc: [
      '控制输入框底部栏配额槽位：紧凑单槽仅显示更吃紧的窗口（5h 或周），悬停或点击即可查看全部详情；双槽模式在宽度充裕时同时显示 5h 与周。',
      '控制輸入框底部欄配額槽位：精簡單槽僅顯示較吃緊的視窗（5h 或週），懸停或點擊即可檢視完整詳情；雙槽模式在寬度充裕時同時顯示 5h 與週。',
      'Controls quota slots in the composer footer: Compact shows only the tighter window (5h or Weekly) with full details on hover/click; Both shows 5h and Weekly side by side when space allows.',
      '入力欄フッターの枠表示を制御します。コンパクトは残量が少ない窓（5h または週）のみを表示し、ホバー／クリックで全詳細を確認できます。両方表示は幅に余裕がある時に 5h と週を同時表示します。',
      '입력창 하단 할당량 슬롯을 제어합니다. 간략 모드는 더 빠듯한 창(5h 또는 주간)만 표시하며 호버/클릭 시 전체 세부 정보를 봅니다. 모두 표시는 너비가 충분할 때 5h와 주간을 함께 표시합니다.',
      'Controla las cuotas en la barra inferior: Compacto muestra solo la ventana más ajustada (5h o Semanal) con detalles al pasar o hacer clic; Ambas muestra 5h y Semanal cuando hay espacio.',
      'Contrôle l’affichage du quota en bas : Compact n’affiche que la fenêtre la plus tendue (5h ou Hebdo) avec détails au survol/clic ; Les deux affiche 5h et Hebdo côte à côte si la largeur suffit.',
      'Steuert Kontingent-Anzeigen in der Fußleiste: Kompakt zeigt nur das knappere Fenster (5h oder Woche) mit Details bei Hover/Klick; Beide zeigt 5h und Woche bei genug Breite nebeneinander.',
      'Alt çubuktaki kota yuvalarını denetler: Kompakt yalnızca daha sıkışık pencereyi (5s veya Haftalık) gösterir ve üzerine gelince/tıklayınca tüm ayrıntıları açar; İkisi birden yer varsa 5s ve Haftalık değerlerini yan yana gösterir.',
    ],
    optQuotaCompact: [
      '紧凑单槽',
      '精簡單槽',
      'Compact',
      'コンパクト',
      '간략',
      'Compacto',
      'Compact',
      'Kompakt',
      'Kompakt',
    ],
    optQuotaBoth: [
      '5h + 周双槽',
      '5h + 週雙槽',
      'Both (5h + Wk)',
      '両方 (5h + 週)',
      '모두 (5h + 주)',
      'Ambas (5h + Sem)',
      'Les deux (5h + Heb)',
      'Beide (5h + W)',
      'İkisi (5s + Hf)',
    ],
  });

  function normalizeLocale(lang) {
    const raw = typeof lang === 'string' ? lang.trim().toLowerCase().replace(/_/g, '-') : '';
    if (!raw || raw === 'auto') return 'en';
    if (raw === 'zh-tw' || raw === 'zh-hk' || raw === 'zh-mo' || raw === 'zh-hant' || raw.startsWith('zh-hant-')) return 'zh-TW';
    if (raw === 'zh' || raw === 'zh-cn' || raw === 'zh-hans' || raw.startsWith('zh-') || raw === 'yue' || raw.startsWith('yue-')) return 'zh-CN';
    if (raw === 'ja' || raw.startsWith('ja-')) return 'ja';
    if (raw === 'ko' || raw.startsWith('ko-')) return 'ko';
    if (raw === 'es' || raw.startsWith('es-')) return 'es';
    if (raw === 'fr' || raw.startsWith('fr-')) return 'fr';
    if (raw === 'de' || raw.startsWith('de-')) return 'de';
    if (raw === 'tr' || raw.startsWith('tr-') || raw === 'turkish' || raw === 'türkçe' || raw === 'turkce') return 'tr';
    return 'en';
  }

  function getStrings(lang) {
    const idx = LOCALE_INDEX[normalizeLocale(lang)] ?? 2;
    const out = {};
    for (const key of Object.keys(TABLE)) {
      out[key] = TABLE[key][idx];
    }
    return out;
  }

  function mergeIntoUiStrings(baseUi, lang) {
    return Object.assign({}, baseUi || {}, getStrings(lang));
  }

  return {
    LOCALES,
    TABLE,
    normalizeLocale,
    getStrings,
    mergeIntoUiStrings,
  };
});
