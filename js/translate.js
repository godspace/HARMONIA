/* HARMONIA · js/translate.js — язык интерфейса (Google Translate)
   Модуль без сборки: подключается <script> в index.html до main.js.
   Все модули делят глобальную область — имена функций/констант уникальны.

   Подход взят из соседнего проекта godspace/math-6-grade (assets/analytics.js):
   официальный виджет Google Translate переводит текст прямо в DOM, поэтому
   своих словарей и отдельных языковых страниц не нужно — доступны все языки
   виджета. Отличия продиктованы игрой:

   · скрипт Google грузится только после явного выбора языка: поисковик видит
     русскую страницу, а сцена не платит за чужой iframe при каждом запуске;
   · английский идёт мимо Google: у него свой пакет (js/i18n.js) с точными
     подписями и подсказками, поэтому en не грузит виджет и работает даже с
     диска (file://). Остальные языки — машинный перевод, как раньше;
   · выбор запоминается (cookie googtrans + localStorage), поэтому на сайте
     язык применяется сам при следующем визите; ?lang=en тоже работает;
   · на file:// перевод выключен — без сети он не работает;
   · возврат на русский перезагружает страницу: Google дописывает DOM, и
     «отменить» перевод без перезагрузки нельзя.

   Границы: это удобство для уже пришедших, а не поиск. Машинный перевод не
   создаёт индексируемых страниц на других языках, и hreflang на него вешать
   нельзя — см. README «Языки интерфейса» и docs/ARCHITECTURE.md. */

var Translate = (function () {
  'use strict';

  const SOURCE = 'ru';
  const COOKIE = 'googtrans';
  const STORE_KEY = 'harmonia.lang';
  const MOUNT_ID = 'google_translate_element';
  const SCRIPT_SRC = 'https://translate.google.com/translate_a/element.js?cb=__harmoniaTranslateInit';
  const COMBO_WAIT_MS = 6000;

  // Быстрый выбор: часто нужные языки первыми. Код — как у Google Translate,
  // подпись — на самом языке, чтобы её понял его носитель.
  const LANGS = [
    { code: '', label: 'Русский' },
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Español' },
    { code: 'pt', label: 'Português' },
    { code: 'de', label: 'Deutsch' },
    { code: 'fr', label: 'Français' },
    { code: 'it', label: 'Italiano' },
    { code: 'pl', label: 'Polski' },
    { code: 'uk', label: 'Українська' },
    { code: 'nl', label: 'Nederlands' },
    { code: 'tr', label: 'Türkçe' },
    { code: 'ar', label: 'العربية' },
    { code: 'hi', label: 'हिन्दी' },
    { code: 'id', label: 'Bahasa Indonesia' },
    { code: 'vi', label: 'Tiếng Việt' },
    { code: 'th', label: 'ไทย' },
    { code: 'zh-CN', label: '中文（简体）' },
    { code: 'zh-TW', label: '中文（繁體）' },
    { code: 'ja', label: '日本語' },
    { code: 'ko', label: '한국어' },
    { code: 'sv', label: 'Svenska' },
    { code: 'nb', label: 'Norsk bokmål' },
    { code: 'da', label: 'Dansk' },
    { code: 'fi', label: 'Suomi' },
    { code: 'cs', label: 'Čeština' },
    { code: 'sk', label: 'Slovenčina' },
    { code: 'hu', label: 'Magyar' },
    { code: 'ro', label: 'Română' },
    { code: 'el', label: 'Ελληνικά' },
    { code: 'he', label: 'עברית' }
  ];

  let scriptRequested = false;  // скрипт Google уже запрошен
  let widgetReady = false;      // виджет отдал <select class="goog-te-combo">
  let failed = false;           // сеть/виджет не сработали — молчим, игра важнее
  let pending = '';             // язык, который применим сразу после инициализации
  let current = '';             // '' — русский, без перевода
  let comboDeadline = 0;

  function byId(id) { return document.getElementById(id); }

  function isFile() { return location.protocol === 'file:'; }

  // toast() живёт в ui-hud.js и подключается раньше — но модуль не должен
  // падать, если его вдруг нет (отдельный харнесс, консоль).
  function say(message) { if (typeof toast === 'function') toast(message); }

  // ===== Свой языковой пакет (js/i18n.js) =====
  // Английский переводит игра, а не Google: подписи точные, title-подсказки
  // тоже переводятся, и всё работает без сети. Остальные языки — виджет.
  function packFor(code) {
    return !!code && typeof I18N !== 'undefined' && I18N.supports(code);
  }
  function packOn() {
    return typeof I18N !== 'undefined' && I18N.enabled();
  }
  function enablePack(code) {
    remember(code);
    // Пакет не использует Google: старая cookie и неудача виджета не мешают.
    dropCookie();
    if (failed) { failed = false; scriptRequested = false; }
    // Сначала подписи и нотация: пады, колесо, список комбо и итог пьесы
    // пересобираются в C-D-E, и словарь переводит уже их. Потом — сам словарь.
    if (typeof applyLanguageNotation === 'function') applyLanguageNotation(code);
    if (typeof refreshNotation === 'function') refreshNotation();
    return I18N.enable(code);
  }

  function readCookie(name) {
    const parts = ('; ' + document.cookie).split('; ' + name + '=');
    return parts.length === 2 ? parts.pop().split(';').shift() : '';
  }

  // Google Translate читает эту cookie при инициализации: «/ru/<код>».
  // Срок жизни обязателен: без него cookie сессионная, и выбор умирает вместе
  // с вкладкой — а игрок ждёт, что язык запомнится.
  function writeCookie(value) {
    const live = ';path=/;max-age=31536000;SameSite=Lax';
    document.cookie = COOKIE + '=' + value + live;
    const host = location.hostname;
    if (host && host.indexOf('.') !== -1) {
      document.cookie = COOKIE + '=' + value + live + ';domain=.' + host;
    }
  }

  function dropCookie() {
    const dead = ';path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT';
    document.cookie = COOKIE + '=' + dead;
    const host = location.hostname;
    if (host && host.indexOf('.') !== -1) {
      document.cookie = COOKIE + '=' + dead + ';domain=.' + host;
    }
  }

  // Что показывать при загрузке: сначала localStorage, затем cookie виджета.
  function stored() {
    let code = '';
    try { code = localStorage.getItem(STORE_KEY) || ''; } catch (e) { code = ''; }
    if (code) return normalize(code);
    const match = /^\/[^/]+\/(.+)$/.exec(readCookie(COOKIE));
    return match ? normalize(match[1]) : '';
  }

  // Поддержка ссылок вида ?lang=de — удобно делиться игрой на нужном языке.
  function queryLang() {
    const match = /[?&]lang=([\w-]+)/.exec(location.search);
    return match ? match[1] : '';
  }
  // «ru» — это исходный язык, то есть отсутствие перевода.
  function normalize(code) {
    const value = String(code || '');
    return value === SOURCE ? '' : value;
  }

  // Выбор живёт в localStorage: cookie виджета может быть отключена, а язык
  // должен остаться и после закрытия вкладки.
  function remember(code) {
    try {
      if (code) localStorage.setItem(STORE_KEY, code);
      else localStorage.removeItem(STORE_KEY);
    } catch (e) { /* приватный режим: выбор просто не запомнится */ }
  }

  function ensureOption(code) {
    const sel = byId('langSel');
    if (!sel || !code) return;
    const options = Array.prototype.slice.call(sel.options);
    if (options.some(opt => opt.value === code)) return;
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = code;
    sel.appendChild(opt);
  }

  function syncSelect() {
    const sel = byId('langSel');
    if (!sel) return;
    ensureOption(current);
    if (sel.value !== current) sel.value = current;
  }

  // Скрытый <select> виджета — единственный публичный способ сменить язык.
  function pick(code) {
    const combo = document.querySelector('.goog-te-combo');
    if (!combo) { pending = code; return false; }
    combo.value = code;
    combo.dispatchEvent(new Event('change'));
    return true;
  }

  function fail(reason) {
    failed = true;
    pending = '';
    say(reason);
    syncSelect();
  }

  function loadWidget() {
    if (scriptRequested || failed) return;
    scriptRequested = true;
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onerror = () => fail('Google Translate не загрузился — проверьте соединение.');
    document.body.appendChild(script);
  }

  function waitForCombo() {
    if (document.querySelector('.goog-te-combo')) {
      widgetReady = true;
      const code = pending || current;
      pending = '';
      if (code) pick(code);
      syncSelect();
      return;
    }
    if (Date.now() > comboDeadline) {
      fail('Google Translate не ответил — интерфейс остался русским.');
      return;
    }
    setTimeout(waitForCombo, 120);
  }

  // Колбэк element.js (имя зашито в SCRIPT_SRC) — только он создаёт виджет.
  function initWidget() {
    if (!window.google || !google.translate || !google.translate.TranslateElement) {
      fail('Google Translate не загрузился — интерфейс остался русским.');
      return;
    }
    try {
      new google.translate.TranslateElement({ pageLanguage: SOURCE, autoDisplay: false }, MOUNT_ID);
    } catch (e) {
      fail('Google Translate не смог стартовать — интерфейс остался русским.');
      return;
    }
    comboDeadline = Date.now() + COMBO_WAIT_MS;
    waitForCombo();
  }
  window.__harmoniaTranslateInit = initWidget;

  // Музыкальные обозначения машинный перевод только портит: «соль» — это и нота,
  // и соль, а клавиша «J» превращается в «ICH». Такие узлы помечаем notranslate.
  // Строка тональности рядом со счётом входит сюда же: её нотация выбирается
  // игрой (P.notation), а Google перевёл бы «До мажор» как «Before major».
  // Ячейки полосы комбо — те же ноты, что и на колесе: их подписи тоже ставит игра.
  const SHIELD = [
    '#noteRow', '#chordPad', '#fifthsWheel', '#homeDeg', '#homeNote', '#comboKey',
    '#stationPlot', '#comboStrip .cs-cells', '#startOverlay .kb-key',
    '#spaceNext .sn-key', '.hints kbd'
  ];

  function shieldSymbols() {
    SHIELD.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        el.classList.add('notranslate');
        el.setAttribute('translate', 'no');
      });
    });
  }

  // Общий путь перед запуском виджета: защитить обозначения, запомнить выбор
  // и поставить cookie, которую Google читает при инициализации.
  function arm(code) {
    shieldSymbols();
    remember(code);
    writeCookie('/' + SOURCE + '/' + code);
    // Ручной выбор языка — новый шанс после сетевой неудачи.
    if (failed) { failed = false; scriptRequested = false; }
  }

  function apply(code) {
    const next = normalize(code);
    if (next === current && (widgetReady || !next)) return true;
    current = next;

    // Свой пакет включается сразу: ни сети, ни перезагрузки не нужно. Нотацию
    // и подписи пересобирает enablePack — общий путь ниже его пропускает.
    if (packFor(next)) {
      // Из машинного перевода в пакет — только через перезагрузку: Google уже
      // переписал DOM на чужой язык, и русских строк в нём больше нет.
      if (widgetReady || scriptRequested) {
        remember(next);
        dropCookie();
        location.reload();
        return true;
      }
      enablePack(next);
      syncSelect();
      return true;
    }
    // Нотация подписей следует за языком: Google Translate не переводит
    // до-ре-ми, поэтому C-D-E подставляет сама игра (см. ui-panel.js).
    if (typeof applyLanguageNotation === 'function') applyLanguageNotation(next);
    // Из пакета обратно на машинный перевод (или на русский): текст в DOM уже
    // английский, отменить это без перезагрузки нельзя.
    if (packOn()) {
      remember(next);
      dropCookie();
      location.reload();
      return true;
    }
    if (isFile()) {
      say('Перевод работает только на сайте: при открытии файла с диска Google Translate недоступен.');
      syncSelect();
      return false;
    }

    // Назад на русский: Google уже переписал DOM, поэтому перезагружаем страницу.
    if (!next) {
      remember('');
      dropCookie();
      if (widgetReady || scriptRequested) location.reload();
      return true;
    }

    arm(next);
    if (widgetReady) return pick(next);
    pending = next;
    loadWidget();
    return true;
  }

  function mount() {
    const sel = byId('langSel');
    if (!sel) return false;
    sel.addEventListener('change', () => apply(sel.value));

    const saved = normalize(queryLang()) || stored();
    if (!saved) return true;
    ensureOption(saved);
    current = saved;
    sel.value = saved;
    // Свой пакет не требует сети: включаем и на file://, и до загрузки виджета.
    if (packFor(saved)) { enablePack(saved); return true; }
    // На file:// виджет не запускаем: без cookie и сети будет только шум.
    if (isFile()) return true;
    // Возвращающийся англоязычный игрок видит ту же нотацию, что и в прошлый
    // раз: язык помнится, значит и буквы должны включиться сразу.
    if (typeof applyLanguageNotation === 'function') applyLanguageNotation(saved);
    arm(saved);
    pending = saved;
    loadWidget();
    return true;
  }

  function snapshot() {
    return {
      code: current, loaded: scriptRequested, ready: widgetReady,
      failed: failed, pack: packOn()
    };
  }

  return {
    source: SOURCE,
    languages: LANGS,
    mount: mount,
    apply: apply,
    state: snapshot
  };
})();
