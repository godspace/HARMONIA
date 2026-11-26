$ErrorActionPreference = 'Stop'
$html = [IO.File]::ReadAllText((Join-Path $PWD 'index.html'), [Text.Encoding]::UTF8)
$pre = @'
<script>
window.__smokeErrors = [];
window.addEventListener('error', function (e) {
  window.__smokeErrors.push('error: ' + (e.message || e.type) + (e.filename ? ' @ ' + e.filename + ':' + e.lineno : ''));
});
window.addEventListener('unhandledrejection', function (e) {
  window.__smokeErrors.push('rejection: ' + String(e.reason));
});
// Прогон должен начинаться по-русски: выбор языка прошлой сессии (пакет или
// виджет) иначе включится до проверок и сдвинет нотацию, как у живого игрока.
try {
  localStorage.removeItem('harmonia.lang');
  // Настройки исследования прошлого прогона не должны влиять на проверку
  // нового дефолта: без записи в localStorage сбор обязан включиться сам.
  localStorage.removeItem('harmonia.research.settings');
  localStorage.removeItem('harmonia.research.v1');
  document.cookie = 'googtrans=;path=/;max-age=0';
} catch (e) { /* приватный режим */ }
</script>
'@
$post = @'
<script>
(function () {
  var results = [];
  function check(name, cond, extra) {
    results.push({ name: name, ok: !!cond, extra: extra == null ? '' : String(extra) });
  }
  function step(name, fn) {
    try { fn(); check(name, true); }
    catch (e) { check(name, false, (e && e.stack) || e); }
  }
  function $(id) { return document.getElementById(id); }

  step('boot', function () {
    if (!window.HARMONIA) throw new Error('HARMONIA API is missing');
    if (HARMONIA.state.form.enabled) throw new Error('form must be off by default');
    if (HARMONIA.state.form.running) throw new Error('form transport must be off by default');
    if (HARMONIA.Transport.running) throw new Error('Transport must be off by default');
    if ($('formHud').classList.contains('on')) throw new Error('form HUD must be hidden by default');
    // Исследование включено по умолчанию; настройка без version не должна
    // выключать его при первом запуске новой версии.
    var research = HARMONIA.research.status();
    if (!research.enabled) throw new Error('research must be on by default');
    if (research.version !== 2) throw new Error('research settings version is not 2');
  });

  step('branding', function () {
    var brand = document.querySelector('.brand');
    var desc = document.querySelector('meta[name="description"]');
    if (document.title.indexOf('COMBOLIST') !== -1) throw new Error('COMBOLIST is still in the page title');
    if (!brand || brand.textContent.indexOf('COMBOLIST') !== -1) {
      throw new Error('COMBOLIST is still in the header brand');
    }
    if (!desc || desc.content.indexOf('COMBOLIST') !== -1) {
      throw new Error('COMBOLIST is still in the meta description');
    }
  });

  step('seo', function () {
    var canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical || canonical.href !== 'https://godspace.github.io/HARMONIA/') {
      throw new Error('canonical URL is missing or wrong');
    }
    // Языковой кластер: русский оригинал + англоязычная страница. hreflang
    // должен указывать только на настоящие страницы, а не на машинный перевод.
    var alts = {};
    Array.prototype.forEach.call(
      document.querySelectorAll('link[rel="alternate"][hreflang]'),
      function (l) { alts[l.getAttribute('hreflang')] = l.getAttribute('href'); }
    );
    if (alts.ru !== 'https://godspace.github.io/HARMONIA/') {
      throw new Error('hreflang ru is missing or wrong');
    }
    if (alts.en !== 'https://godspace.github.io/HARMONIA/en/') {
      throw new Error('hreflang en is missing or wrong');
    }
    if (alts['x-default'] !== 'https://godspace.github.io/HARMONIA/') {
      throw new Error('hreflang x-default is missing or wrong');
    }
    var enLink = document.getElementById('enLink');
    if (!enLink || enLink.getAttribute('href') !== 'en/') {
      throw new Error('link to the English page is missing from the top bar');
    }
    // Ссылка EN стоит рядом с названием, а не в ряду управления: ряд
    // .top-controls уже переносится на 1440 px, и лишняя кнопка вырастила бы
    // полосу ещё на строку, отняв высоту у сцены.
    if (!document.querySelector('.brand-group #enLink')) {
      throw new Error('EN link must sit inside .brand-group, beside the brand');
    }
    var robots = document.querySelector('meta[name="robots"]');
    if (!robots || robots.content.indexOf('index') === -1) throw new Error('robots meta is missing');
    var googleVerification = document.querySelector('meta[name="google-site-verification"]');
    if (!googleVerification || googleVerification.content !== 'WQZso1a4LcVn2_Adr-JlpDhe5KHCz_qSr4MS75SxeGc') {
      throw new Error('Google site verification meta is missing or wrong');
    }
    var ogTitle = document.querySelector('meta[property="og:title"]');
    if (!ogTitle || ogTitle.content.indexOf('HARMONIA') === -1) throw new Error('og:title is missing');
    var ogImage = document.querySelector('meta[property="og:image"]');
    if (!ogImage || ogImage.content.indexOf('/docs/screenshot.png') === -1) {
      throw new Error('og:image is missing');
    }
    var ld = document.querySelector('script[type="application/ld+json"]');
    if (!ld) throw new Error('JSON-LD is missing');
    var data = JSON.parse(ld.textContent);
    if (data['@type'] !== 'WebApplication' || data.name !== 'HARMONIA') {
      throw new Error('JSON-LD WebApplication is malformed');
    }
    var metrika = Array.prototype.some.call(document.scripts, function (s) {
      return /mc\.yandex\.ru\/metrika\/tag\.js\?id=114504272/.test(s.src) ||
        /ym\(114504272/.test(s.textContent);
    });
    if (!metrika) throw new Error('Yandex Metrika 114504272 is missing');
    var icon = document.querySelector('link[rel="icon"]');
    if (!icon || icon.href.indexOf('favicon.svg') === -1) throw new Error('favicon is missing');
    if (location.protocol === 'file:' && document.querySelector('script[src*="mc.yandex.ru"]')) {
      throw new Error('Metrika must not load from file://');
    }
    if (document.documentElement.lang !== 'ru') throw new Error('html lang is not ru');
  });

  step('site-links', function () {
    // Двери наружу из панели настроек: русский обзор проекта и английская
    // страница. Адреса постоянные — их видят и поисковик, и игрок.
    var ru = document.getElementById('aboutLink');
    var en = document.getElementById('enSiteLink');
    if (!ru || ru.getAttribute('href') !== 'ru/') {
      throw new Error('link to the Russian overview is missing from the panel');
    }
    if (!en || en.getAttribute('href') !== 'en/') {
      throw new Error('link to the English overview is missing from the panel');
    }
    if (!ru.closest('#panel') || !en.closest('#panel')) {
      throw new Error('the overview links belong in the settings panel');
    }
  });

  step('lang-switch', function () {
    // Язык интерфейса: тот же приём, что в godspace/math-6-grade — виджет
    // Google Translate, но подключённый по требованию. Поисковик и file://
    // не должны получать чужой скрипт при загрузке.
    var sel = $('langSel');
    if (!sel) throw new Error('langSel is missing');
    if (sel.options.length < 20) throw new Error('language list is too short: ' + sel.options.length);
    if (sel.options[0].value !== '') throw new Error('the first language must be Russian');
    if (!HARMONIA.Translate || typeof HARMONIA.Translate.state !== 'function') {
      throw new Error('Translate API is missing');
    }
    var st = HARMONIA.Translate.state();
    if (st.loaded) throw new Error('Google Translate must load on demand only');
    if (st.ready) throw new Error('Google Translate widget must not be ready before the drill');
    if (!$('google_translate_element')) throw new Error('translate mount point is missing');
    if (document.querySelector('script[src*="translate_a/element.js"]')) {
      throw new Error('translate script is present before the user picks a language');
    }
    if (HARMONIA.Translate.source !== 'ru') throw new Error('translate source language must be ru');
  });

  step('default-sound', function () {
    var P = HARMONIA.P;
    if (P.reverb !== 1 || Number($('pReverb').value) !== 100) throw new Error('reverb default is not 100%');
    if (P.tone !== 1 || Number($('pNoteTone').value) !== 100) throw new Error('note tone default is not 100%');
    if (P.noteVol !== 0.25 || Number($('pNoteVol').value) !== 25) {
      throw new Error('note volume default is not 25%: ' + P.noteVol);
    }
    if (P.chordVol !== 1 || Number($('pChordVol').value) !== 100) {
      throw new Error('chord volume default is not 100%');
    }
    if (P.noteOct !== 1 || $('pNoteOct').value !== '1') {
      throw new Error('note octave default is not +1: ' + P.noteOct);
    }
    if (P.bassOct !== -1 || $('pBassOct').value !== '-1') {
      throw new Error('bass octave default is not -1: ' + P.bassOct);
    }
    if (!P.sustain || $('pSustain').getAttribute('aria-pressed') !== 'true') {
      throw new Error('sustain pedal must be on by default');
    }
    if (HARMONIA.INPUT.commands.Space !== 'comboAdvance') {
      throw new Error('Space must advance the combo, not toggle the pedal');
    }
    if ($('scalePrompt')) throw new Error('old scale prompt modal is still in the DOM');
    if (!$('spaceNext')) throw new Error('Space transition button is missing');
    if ($('chordPad').nextElementSibling !== $('guideLine')) {
      throw new Error('the guide line is not directly under the chord chips');
    }
    if ($('guideLine').nextElementSibling !== $('spaceNext')) {
      throw new Error('Space button is not directly under the guide line');
    }
  });

  step('drawers-intro', function () {
    // Проба пальцев: меню не нужно, сцена занимает экран. Табы панелей тоже
    // спрятаны — во время знакомства с клавишами открывать нечего.
    if (!document.body.classList.contains('intro')) throw new Error('body.intro is missing before the drill');
    if (!HARMONIA.drawerIntro()) throw new Error('drawer intro mode is off before the drill');
    if (window.getComputedStyle($('topbar')).display !== 'none') throw new Error('topbar is visible on the intro screen');
    if (window.getComputedStyle($('panel')).display !== 'none') throw new Error('panel is visible on the intro screen');
    if (window.getComputedStyle($('status-row')).display !== 'none') {
      throw new Error('status row is visible on the intro screen');
    }
    if ($('topbarTab').classList.contains('show')) throw new Error('topbar tab must stay hidden during the drill');
    if ($('panelTab').classList.contains('show')) throw new Error('panel tab must stay hidden during the drill');
  });

  step('intro-tips', function () {
    // Знакомство с клавишами — не чтение легенды: у каждой игровой клавиши
    // есть подсказка, и она всплывает над клавишей при наведении.
    var tips = document.querySelectorAll('#startOverlay .kb-key[data-tip]');
    if (tips.length !== 12) throw new Error('the scheme must explain twelve keys, got ' + tips.length);
    Array.prototype.forEach.call(tips, function (el) {
      if (!el.dataset.tip || el.dataset.tip.length < 8) {
        throw new Error('empty tip on ' + el.textContent);
      }
      // Две подсказки сразу (native title и своя) спорили бы друг с другом.
      if (el.getAttribute('title')) throw new Error('native title fights the custom tip on ' + el.textContent);
    });
    // Стрелки не объясняем: у них уже есть подпись «лад / комбо».
    if (document.querySelectorAll('#startOverlay .kb-arrow[data-tip]').length) {
      throw new Error('arrows must not get a tooltip');
    }
    var tip = $('kbTip');
    if (!tip) throw new Error('the intro tooltip element is missing');
    if (tip.classList.contains('show')) throw new Error('the tip must start hidden');
    var q = document.querySelector('#startOverlay .kb-key[data-key="KeyQ"]');
    q.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    if (!tip.classList.contains('show')) throw new Error('hovering a key must show its tip');
    if (tip.getAttribute('aria-hidden') !== 'false') {
      throw new Error('the visible tip is still hidden from screen readers');
    }
    if (tip.textContent !== q.dataset.tip && tip.textContent !== HARMONIA.I18N.text(q.dataset.tip)) {
      throw new Error('the tip does not explain the key: ' + tip.textContent);
    }
    // Пузырёк стоит над клавишей и не вылезает за окно.
    var box = document.querySelector('#startOverlay').getBoundingClientRect();
    var r = q.getBoundingClientRect(), t = tip.getBoundingClientRect();
    if (!t.width || !t.height) throw new Error('the tip has no size');
    if (t.bottom > r.top + 1) throw new Error('the tip must sit above the key');
    if (t.left < box.left - 1 || t.right > box.right + 1) throw new Error('the tip left the screen');
    q.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
    if (tip.classList.contains('show')) throw new Error('leaving the key must hide the tip');
  });

  step('intro-drill', function () {
    var overlay = $('startOverlay');
    if (!overlay || overlay.style.display === 'none') throw new Error('start overlay must be visible before start');
    if (HARMONIA.state.started) throw new Error('session must not start before the finger drill');
    if (HARMONIA.INTRO_KEYS.length !== 10) throw new Error('intro drill must ask for ten keys');
    // data-key есть и у стартового Space: считаем только десять клавиш пробы.
    var marked = Array.prototype.filter.call(
      document.querySelectorAll('#startOverlay .kb-key[data-key]'),
      function (el) { return HARMONIA.INTRO_KEYS.indexOf(el.dataset.key) !== -1; }
    ).length;
    if (marked !== 10) throw new Error('intro keyboard does not mark ten playable keys');
    // Текста на старте минимум: заголовок и одна строка инструкции со счётчиком.
    // Длинное описание умного режима, список горячих клавиш, дорожка точек и
    // кнопка «старт» убраны: их не читают, а место принадлежит клавиатуре.
    if (document.querySelectorAll('#startOverlay p').length !== 1) {
      throw new Error('intro screen must keep a single instruction line');
    }
    if (document.querySelector('#startOverlay .intro-copy, #startOverlay #startBtn, #startOverlay #introDots')) {
      throw new Error('verbose intro blocks are back');
    }
    var count = $('introCount');
    if (!count || count.textContent.indexOf('0 / 10') === -1) throw new Error('intro counter must start at 0 / 10');
    // Клавиатура — главный элемент: во всю ширину окна и заметно выше строки текста.
    var box = overlay.getBoundingClientRect();
    var board = document.querySelector('#startOverlay .kb-board').getBoundingClientRect();
    var textH = document.querySelector('#startOverlay .intro-title').getBoundingClientRect().height +
      document.querySelector('#startOverlay .intro-lead').getBoundingClientRect().height;
    if (board.width < Math.min(box.width, 1360) * 0.85) {
      throw new Error('intro keyboard is too narrow: ' + Math.round(board.width) + ' of ' + Math.round(box.width));
    }
    if (board.height < textH * 2) {
      throw new Error('intro keyboard must dominate the text: ' + Math.round(board.height) + ' vs ' + Math.round(textH));
    }
    // Пробел до пробы молчит: старт открывает только десятая клавиша.
    function pressSpace() {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'Space', key: ' ', bubbles: true, cancelable: true
      }));
    }
    pressSpace();
    if (HARMONIA.introState().starting || HARMONIA.state.started) {
      throw new Error('Space started the session before the ten keys');
    }
    // Клик по стартовому Space до пробы тоже ничего не открывает.
    document.querySelector('#startOverlay .kb-space[data-key="Space"]').click();
    if (HARMONIA.introState().starting || HARMONIA.state.started) {
      throw new Error('the intro Space key started the session before the ten keys');
    }
    HARMONIA.INTRO_KEYS.slice(0, 9).forEach(function (code) { HARMONIA.introPress(code); });
    var st = HARMONIA.introState();
    if (st.done || st.count !== 9) throw new Error('drill counted ' + st.count + ' instead of 9 keys');
    if (st.ready) throw new Error('Space armed before the tenth key');
    if (count.textContent.indexOf('9 / 10') === -1) throw new Error('intro counter did not follow: ' + count.textContent);
    HARMONIA.introPress(HARMONIA.INTRO_KEYS[0]);
    if (HARMONIA.introState().count !== 9) throw new Error('a repeated key must not count twice');
    HARMONIA.introPress(HARMONIA.INTRO_KEYS[9]);
    st = HARMONIA.introState();
    if (!st.done || st.count !== 10) throw new Error('drill did not finish after ten keys');
    // Десять клавиш — ещё не старт: второй шаг пробы — Enter и барабаны.
    if (st.drums || st.ready || st.starting) throw new Error('ten keys must not arm Space before the drums');
    if (count.textContent.indexOf('10 / 10') === -1) throw new Error('intro counter did not finish: ' + count.textContent);
    if (!overlay.classList.contains('drums') || overlay.classList.contains('ready')) {
      throw new Error('the overlay must ask for Enter after the drill');
    }
    if (overlay.classList.contains('fade')) throw new Error('start overlay must wait for Enter');
    if (window.getComputedStyle(document.querySelector('#startOverlay .ip-drums')).display === 'none') {
      throw new Error('the drums prompt is hidden after the drill');
    }
    if (window.getComputedStyle(document.querySelector('#startOverlay .ip-before')).display !== 'none') {
      throw new Error('drill prompt must give way to the drums prompt');
    }
    if (document.querySelectorAll('#startOverlay .kb-key.hit').length !== 10) {
      throw new Error('pressed keys are not marked on the keyboard');
    }
    // Пробел до барабанов молчит: он только напоминает, что нужен Enter.
    pressSpace();
    if (HARMONIA.introState().starting || HARMONIA.state.started) {
      throw new Error('Space started the session before the drums');
    }
    if (HARMONIA.Groove.on) throw new Error('Space must not turn the drums on');
    // Enter включает барабаны прямо на стартовом экране — грув звучит до ноты.
    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'Enter', key: 'Enter', bubbles: true, cancelable: true
    }));
    st = HARMONIA.introState();
    if (!HARMONIA.Groove.on || !HARMONIA.P.grooveOn) throw new Error('Enter did not turn the drums on');
    if (!HARMONIA.Groove.preview) throw new Error('the intro groove must run in preview mode');
    if (!st.drums || !st.ready || st.starting) throw new Error('Enter must arm Space after the drums');
    if (!overlay.classList.contains('ready') || overlay.classList.contains('drums')) {
      throw new Error('the overlay must arm Space after the drums');
    }
    if (!document.querySelector('#startOverlay .kb-enter.hit')) throw new Error('Enter is not marked on the keyboard');
    if (window.getComputedStyle(document.querySelector('#startOverlay .ip-after')).display === 'none') {
      throw new Error('Space prompt is hidden after the drums');
    }
    if (window.getComputedStyle(document.querySelector('#startOverlay .ip-drums')).display !== 'none') {
      throw new Error('drums prompt must give way to the Space prompt');
    }
    if (HARMONIA.state.started) throw new Error('drill must not start the session without Space');
    // Пробел — не подсказка, а единственный путь дальше: клавиша на схеме
    // подсвечена и подписана «начать», а строка инструкции сменилась.
    var spaceKey = document.querySelector('#startOverlay .kb-space[data-key="Space"]');
    if (!spaceKey) throw new Error('the intro Space key is not wired for the start');
    HARMONIA.introPress(HARMONIA.INTRO_KEYS[0]);
    if (HARMONIA.introState().count !== 10) throw new Error('drill recounted after it finished');
    pressSpace();
    st = HARMONIA.introState();
    if (!st.starting) throw new Error('Space did not confirm the start');
    if (!overlay.classList.contains('fade')) throw new Error('start overlay must fade after Space');
    if (HARMONIA.state.started) throw new Error('session must start only after the fade');
    pressSpace();
    if (!HARMONIA.introState().starting) throw new Error('repeated Space broke the start');
  });

  step('form-before-start', function () {
    $('formBtn').click();
    if (!HARMONIA.state.started || !HARMONIA.state.running) throw new Error('form button did not start the session');
    if (!HARMONIA.state.form.enabled || !HARMONIA.state.form.running) throw new Error('form did not start before session');
    $('formStop').click();
    if (HARMONIA.state.form.enabled) throw new Error('form did not stop');
    if (!HARMONIA.state.running) throw new Error('returning to jam stopped the session');
  });

  step('free-jam-start', function () {
    if (!HARMONIA.state.started) HARMONIA.beginFromOverlay();
    if (!HARMONIA.state.started || !HARMONIA.state.running) throw new Error('session did not start');
    if (HARMONIA.state.form.enabled) throw new Error('form enabled itself in free jam');
    if ($('formHud').classList.contains('on')) throw new Error('form HUD visible in free jam');
    // Проба включала барабаны: сессия подхватывает их, но уже без preview —
    // дальше грув живёт по обычным правилам (пауза, часы, выключение).
    if (HARMONIA.Groove.preview) throw new Error('the intro preview outlived the session start');
    if (!HARMONIA.Groove.on) throw new Error('the drums from the intro must keep playing');
  });

  step('drawers-after-start', function () {
    // После пробы хром не возвращается: панели остаются свёрнутыми, у краёв
    // сцены только табы. Игрок сразу играет и открывает меню по необходимости.
    if (document.body.classList.contains('intro')) throw new Error('intro chrome is still on after the start');
    if (HARMONIA.drawerIntro()) throw new Error('drawer intro mode is still on after the start');
    if (HARMONIA.drawerOpen('topbar') || HARMONIA.drawerOpen('panel')) {
      throw new Error('drawers must stay closed after the drill');
    }
    if (window.getComputedStyle($('topbar')).display !== 'none') {
      throw new Error('topbar is visible right after the start');
    }
    if (window.getComputedStyle($('panel')).display !== 'none') {
      throw new Error('panel is visible right after the start');
    }
    if (!$('topbarTab').classList.contains('show')) throw new Error('topbar tab is missing after the start');
    if (!$('panelTab').classList.contains('show')) throw new Error('panel tab is missing after the start');
    if (window.getComputedStyle($('topbarTab')).display === 'none') throw new Error('topbar tab is not rendered');
    if (window.getComputedStyle($('panelTab')).display === 'none') throw new Error('panel tab is not rendered');
    if (window.getComputedStyle($('status-row')).display === 'none') throw new Error('status row did not come back');
  });

  step('drawers-toggle', function () {
    var stage = $('game-container');
    var wide = window.innerWidth >= 1120;
    var cleanSize = stage.style.transform;
    // Таб возвращает панель: колонка снова занимает место, сцена уступает.
    $('panelTab').click();
    if ($('panel').classList.contains('closed')) throw new Error('panel tab did not open the panel');
    if (window.getComputedStyle($('panel')).display === 'none') throw new Error('opened panel takes no space');
    if ($('panelTab').classList.contains('show')) throw new Error('panel tab stayed visible after opening');
    if ($('panelHide').getAttribute('aria-expanded') !== 'true') throw new Error('panel aria-expanded did not flip');
    if (wide && stage.style.transform === cleanSize) throw new Error('stage did not yield space to the panel');
    // …и сворачивает её обратно: пиксели возвращаются сцене.
    $('panelHide').click();
    if (!$('panel').classList.contains('closed')) throw new Error('panel hide button did not close the panel');
    if (window.getComputedStyle($('panel')).display !== 'none') throw new Error('closed panel still takes space');
    if (!$('panelTab').classList.contains('show')) throw new Error('panel tab did not appear');
    if ($('panelHide').getAttribute('aria-expanded') !== 'false') throw new Error('panel aria-expanded did not flip back');
    if (wide && stage.style.transform !== cleanSize) throw new Error('stage did not grow into the freed panel space');
    var top = $('topbar');
    $('topbarTab').click();
    if (top.classList.contains('closed')) throw new Error('topbar tab did not open the menu');
    if (window.getComputedStyle(top).display === 'none') throw new Error('opened topbar takes no space');
    if ($('topbarTab').classList.contains('show')) throw new Error('topbar tab stayed visible after opening');
    $('topbarHide').click();
    if (!top.classList.contains('closed')) throw new Error('topbar hide button did not close the menu');
    if (window.getComputedStyle(top).display !== 'none') throw new Error('closed topbar still takes space');
    if (!$('topbarTab').classList.contains('show')) throw new Error('topbar tab did not appear');
    if (HARMONIA.drawerOpen('topbar') || HARMONIA.drawerOpen('panel')) {
      throw new Error('drawers must be closed at the end of the toggle test');
    }
    // Остальным проверкам нужен открытый хром — возвращаем панели табами.
    $('panelTab').click();
    $('topbarTab').click();
    if (!HARMONIA.drawerOpen('panel') || !HARMONIA.drawerOpen('topbar')) {
      throw new Error('tabs did not restore both drawers for the rest of the suite');
    }
  });

  step('space-combo-advance', function () {
    var st = HARMONIA.state;
    function dispatchSpace() {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'Space', key: ' ', bubbles: true, cancelable: true
      }));
    }
    HARMONIA.setMode('major');
    HARMONIA.loadCombo(0, false);
    // Порог берём из конфига: 300 очков, а не 1000 — одна правка в CFG меняет
    // и текст кнопки, и этот тест.
    var gate = HARMONIA.CFG.comboAdvanceAt;
    st.score = gate - 1;
    HARMONIA.updateHUD();
    var btn = $('spaceNext');
    if (!btn.disabled) throw new Error('Space transition is enabled below ' + gate);
    if (btn.classList.contains('ready')) throw new Error('Space transition pulses below ' + gate);
    if ($('spaceNextProgress').textContent.indexOf(String(gate - 1)) === -1) {
      throw new Error('Space progress did not show ' + (gate - 1) + ': ' + $('spaceNextProgress').textContent);
    }
    if (HARMONIA.advanceCombo() !== false) throw new Error('advanceCombo ignored the ' + gate + ' gate');
    var mode = st.mode, idx = st.comboIdx;
    var before = HARMONIA.COMBOS[HARMONIA.ORDER[mode][idx]].id;
    dispatchSpace();
    if (st.mode !== mode || st.comboIdx !== idx) {
      throw new Error('Space changed combo before ' + gate);
    }
    st.score = gate;
    HARMONIA.updateHUD();
    if (btn.disabled) throw new Error('Space transition is disabled at ' + gate);
    if (!btn.classList.contains('ready')) throw new Error('Space transition does not pulse at ' + gate);
    if ($('spaceNextProgress').textContent.indexOf('\u0433\u043e\u0442\u043e\u0432\u043e') === -1) {
      throw new Error('Space readiness text is missing: ' + $('spaceNextProgress').textContent);
    }
    dispatchSpace();
    if (st.mode !== 'minor' || st.comboIdx !== 0) {
      throw new Error('major should lead to the minor pair, got ' + st.mode + ':' + st.comboIdx);
    }
    var minorId = HARMONIA.COMBOS[HARMONIA.ORDER[st.mode][st.comboIdx]].id;
    if (minorId !== before + 12) throw new Error('minor pair id mismatch: ' + before + ' -> ' + minorId);
    if (st.score !== 0) throw new Error('new combo did not reset the score');
    if (!btn.disabled || btn.classList.contains('ready')) {
      throw new Error('Space stayed ready after changing combo');
    }
    st.score = HARMONIA.CFG.comboAdvanceAt;
    HARMONIA.updateHUD();
    dispatchSpace();
    if (st.mode !== 'major' || st.comboIdx !== 1) {
      throw new Error('minor should lead to the next major pair, got ' + st.mode + ':' + st.comboIdx);
    }
    if (HARMONIA.COMBOS[HARMONIA.ORDER[st.mode][st.comboIdx]].id !== 2) {
      throw new Error('next major pair is not COMBO 2');
    }
    HARMONIA.setMode('major');
    HARMONIA.loadCombo(0, false);
    st.score = 0;
    HARMONIA.updateHUD();
  });

  step('space-hint', function () {
    // Подсказка о пробеле живёт в полосе комбо (верх по центру): до рубежа там
    // остаток очков, после — что сделает пробел. На рубеже полоса мягко
    // подсвечивается (класс attn), чтобы подсказку заметили без тоста.
    var st = HARMONIA.state;
    var gate = HARMONIA.CFG.comboAdvanceAt;
    HARMONIA.setMode('major');
    HARMONIA.loadCombo(0, false);
    st.score = 0;
    HARMONIA.updateHUD();
    var hint = $('spaceHint');
    var text = $('spaceHintText');
    var strip = $('comboStrip');
    if (!hint || !text) throw new Error('the combo strip has no Space hint');
    if (!strip || !strip.contains(hint)) throw new Error('the Space hint must live in the combo strip');
    if (hint.classList.contains('ready')) throw new Error('Space hint is armed at zero score');
    if (text.textContent.indexOf(String(gate)) === -1) {
      throw new Error('Space hint lost the remaining points: ' + text.textContent);
    }
    if (strip.classList.contains('attn')) throw new Error('the combo strip nudged below the gate');
    st.score = gate - 25;
    HARMONIA.updateHUD();
    if (text.textContent.indexOf('25') === -1) {
      throw new Error('Space hint did not count down: ' + text.textContent);
    }
    st.score = gate;
    HARMONIA.updateHUD();
    if (!hint.classList.contains('ready')) throw new Error('Space hint is not ready at ' + gate);
    if (!strip.classList.contains('attn')) throw new Error('the combo strip did not nudge at ' + gate);
    var keyEl = $('comboKey');
    var comboName = HARMONIA.keyNameOf(HARMONIA.COMBOS[HARMONIA.ORDER[st.mode][st.comboIdx]]);
    if (!keyEl || keyEl.textContent !== comboName) {
      throw new Error('the score block does not name the combo key: ' +
        (keyEl && keyEl.textContent) + ' vs ' + comboName);
    }
    if (keyEl.getAttribute('translate') !== 'no' || !keyEl.classList.contains('notranslate')) {
      throw new Error('the key name must stay out of machine translation');
    }
    if (keyEl.textContent.indexOf('\u043c\u0430\u0436\u043e\u0440') === -1) {
      throw new Error('the key name is not musical: ' + keyEl.textContent);
    }
    if ($('fifthsWheel').textContent.indexOf(comboName) === -1) {
      throw new Error('the circle of fifths does not show the key name');
    }
    st.score = 0;
    HARMONIA.updateHUD();
    if (hint.classList.contains('ready')) throw new Error('Space hint stayed ready after the score reset');
  });

  step('combo-strip', function () {
    // Верх сцены показывает весь маршрут по 12 × 2 комбо: ячейка светлеет при
    // входе в комбо, зеленеет после собранного цикла, а текущая мягко мигает —
    // это и есть напоминание, на каком этапе игрок, без отдельной строки.
    var st = HARMONIA.state;
    HARMONIA.setMode('major');
    HARMONIA.loadCombo(0, false);
    var strip = $('comboStrip');
    if (!strip) throw new Error('the combo strip is missing');
    var cells = strip.querySelectorAll('.cs-cell');
    if (cells.length !== 24) throw new Error('the strip must show 24 combos, got ' + cells.length);
    var current = strip.querySelectorAll('.cs-cell.current');
    if (current.length !== 1) throw new Error('exactly one cell must mark the current combo');
    var cur = current[0];
    if (cur.dataset.mode !== 'major' || Number(cur.dataset.idx) !== st.comboIdx) {
      throw new Error('the blinking cell is not the current combo');
    }
    if (!st.entered.major[0]) throw new Error('entering a combo did not mark it on the strip');
    if (!cur.classList.contains('seen')) throw new Error('the entered combo is not lit on the strip');
    // Цикл из четырёх аккордов: ступень становится пройденной (зелёной).
    st.played.major[0] = true;
    HARMONIA.updateHUD();
    if (!cur.classList.contains('done')) throw new Error('a collected cycle is not marked done');
    st.played.major[0] = false;
    // Переход переносит мигалку: старое место гаснет, новое загорается.
    HARMONIA.loadCombo(5, false);
    var moved = strip.querySelectorAll('.cs-cell.current');
    if (moved.length !== 1) throw new Error('the strip lost its current combo after the move');
    if (Number(moved[0].dataset.idx) !== 5) throw new Error('the current cell did not follow the combo');
    if (cur.classList.contains('current')) throw new Error('the old cell is still marked current');
    if (!moved[0].textContent.trim()) throw new Error('a strip cell has no key label');
    // Ряды названы ладом — иначе двадцать четыре ноты не прочитать.
    if (strip.textContent.toLowerCase().indexOf('\u043c\u0430\u0436\u043e\u0440') === -1) {
      throw new Error('the strip does not name its rows by mode');
    }
    // Прогресс для скринридера считает собранные циклы, максимум — 24.
    var bar = $('comboProgress');
    var played = st.played.major.filter(Boolean).length + st.played.minor.filter(Boolean).length;
    if (!bar || Number(bar.getAttribute('aria-valuemax')) !== 24) {
      throw new Error('the strip progressbar is missing its maximum');
    }
    if (Number(bar.getAttribute('aria-valuenow')) !== played) {
      throw new Error('the strip progress did not follow the played combos: ' +
        bar.getAttribute('aria-valuenow') + ' vs ' + played);
    }
    // В пьесе центр занимает форма: полоса уступает ей место и возвращается.
    $('formBtn').click();
    if (window.getComputedStyle(strip).display !== 'none') {
      throw new Error('the strip must step aside for the form HUD');
    }
    $('formStop').click();
    if (window.getComputedStyle(strip).display === 'none') {
      throw new Error('the strip did not come back after the form');
    }
    HARMONIA.loadCombo(0, false);
  });

  step('notation', function () {
    // Автоматический перевод не трогает названия нот: до-ре-ми для латинских
    // языков заменяет сама игра (P.notation), иначе англоязычный игрок видит
    // «до-ми-соль» вместо C-E-G.
    var P = HARMONIA.P;
    HARMONIA.setMode('major');
    HARMONIA.loadCombo(0, false);
    function tonicName() {
      var el = document.querySelector('#chordPad .chord-card.tonic .cc-name');
      return el ? el.textContent : '';
    }
    if (P.notation !== 'sol') throw new Error('notation must start as solfège');
    if (tonicName() !== '\u0414\u043e-\u041c\u0438-\u0421\u043e\u043b\u044c') {
      throw new Error('solfège chord names are missing: ' + tonicName());
    }
    if ($('comboKey').textContent !== '\u0414\u043e \u043c\u0430\u0436\u043e\u0440') {
      throw new Error('solfège key name is wrong: ' + $('comboKey').textContent);
    }
    HARMONIA.applyLanguageNotation('en');
    if (!HARMONIA.usingLetterNames()) throw new Error('English did not switch to letter notation');
    if (P.notation !== 'letters') throw new Error('P.notation did not follow the language');
    if (tonicName() !== 'C-E-G') throw new Error('tonic chord is not C-E-G: ' + tonicName());
    if ($('comboKey').textContent !== 'C major') {
      throw new Error('the key name is not C major: ' + $('comboKey').textContent);
    }
    if ($('comboSel').options[0].textContent.indexOf('C major') === -1) {
      throw new Error('the combo list did not switch notation: ' + $('comboSel').options[0].textContent);
    }
    if ($('pNotation').value !== 'letters') throw new Error('the panel did not follow the notation');
    if ($('fifthsWheel').textContent.indexOf('C major') === -1) {
      throw new Error('the circle of fifths stayed in solfège');
    }
    var ballNames = HARMONIA.getBalls().map(function (b) { return b.name; }).join(',');
    if (ballNames !== 'C,D,E,F,G,A,B') throw new Error('stage labels are not letters: ' + ballNames);
    if (HARMONIA.diatonicPalette()[4].name !== 'G-B-D') {
      throw new Error('palette name is not G-B-D: ' + HARMONIA.diatonicPalette()[4].name);
    }
    if (HARMONIA.scaleNoteNames()[0] !== 'C') throw new Error('scale names are not letters');
    if (HARMONIA.handNoteBalls().length !== 5) throw new Error('notation changed the right hand');
    $('pNotation').value = 'sol';
    $('pNotation').dispatchEvent(new Event('change', { bubbles: true }));
    if (P.notation !== 'sol') throw new Error('the panel switch did not return to solfège');
    if (tonicName() !== '\u0414\u043e-\u041c\u0438-\u0421\u043e\u043b\u044c') {
      throw new Error('solfège names did not come back: ' + tonicName());
    }
    HARMONIA.applyLanguageNotation('ru');
    if (P.notation !== 'sol') throw new Error('Russian did not keep solfège');
    HARMONIA.applyLanguageNotation('de');
    if (P.notation !== 'letters') throw new Error('Latin languages must use letters');
    HARMONIA.applyLanguageNotation('');
    if (P.notation !== 'sol') throw new Error('empty language must mean Russian');
    HARMONIA.updateHUD();
  });

  step('melody-layout', function () {
    if (!HARMONIA.P.smartHand) {
      throw new Error('free jam must start with smart chord switching');
    }
    if (HARMONIA.P.noteVol !== 0.25) throw new Error('note volume default is not 25%: ' + HARMONIA.P.noteVol);
    if (Number($('pNoteVol').value) !== 25) throw new Error('note volume slider is not 25');
    if (HARMONIA.NOTE_KEYS.length !== 5) throw new Error('layout has ' + HARMONIA.NOTE_KEYS.length + ' keys');
    if ($('noteRow').children.length !== 5) throw new Error('note row does not show five keys');
    if (HARMONIA.INPUT.noteIndex('KeyJ') !== 0) throw new Error('J is not the first note in smart mode');
    if (HARMONIA.INPUT.noteIndex('KeyY') !== -1) throw new Error('Y should be inactive');
    if (HARMONIA.handNoteBalls().length !== 5) throw new Error('smart hand is not five notes');
    if (HARMONIA.handNoteBalls().join(',') !== HARMONIA.smartNoteWindow(0).join(',')) {
      throw new Error('smart hand is not the safe window from the tonic');
    }
    $('pSmartHand').click();
    if (HARMONIA.P.smartHand) throw new Error('smart hand did not turn off');
    if (HARMONIA.NOTE_KEYS.length !== 5 || $('noteRow').children.length !== 5) {
      throw new Error('fixed-root mode changed the key count');
    }
    if (HARMONIA.handNoteBalls().length !== 5) throw new Error('fixed-root hand is not five notes');
    if (HARMONIA.INPUT.noteIndex('KeyJ') !== 0) throw new Error('J stopped working in fixed-root mode');
    if (HARMONIA.P.noteOct !== 1) throw new Error('note octave default is not +1');
    HARMONIA.shiftNoteOctave(1);
    if (HARMONIA.P.noteOct !== 1) throw new Error('octave moved above its +1 limit');
    HARMONIA.shiftNoteOctave(-1);
    if (HARMONIA.P.noteOct !== 0) throw new Error('octave down did not apply');
    HARMONIA.shiftNoteOctave(1);
    if (HARMONIA.P.noteOct !== 1) throw new Error('octave up did not return');
    $('pSmartHand').click();
    if (!HARMONIA.P.smartHand) throw new Error('smart hand did not come back');
    if (HARMONIA.handNoteBalls().join(',') !== HARMONIA.smartNoteWindow(0).join(',')) {
      throw new Error('smart mode did not restore the safe window');
    }
    if (HARMONIA.INPUT.noteIndex('KeyJ') !== 0) throw new Error('J stopped working in smart mode');
  });

  step('smart-hand-window', function () {
    var palette = HARMONIA.diatonicPalette();
    var win = HARMONIA.smartNoteWindow(4);
    var degrees = win.map(function (i) { return palette[i].degree; }).join(',');
    if (degrees !== 'ii,iii,V,vi,vii' + '\u00b0') {
      throw new Error('V safe window should skip C and F: ' + degrees);
    }
    win.forEach(function (i) {
      if (palette[i].degree === 'I' || palette[i].degree === 'IV') {
        throw new Error('V safe window kept a semitone/tritone trap: ' + palette[i].degree);
      }
    });
    if (HARMONIA.handNoteBalls().join(',') !== HARMONIA.smartNoteWindow(HARMONIA.state.adaptive.anchor).join(',')) {
      throw new Error('hand balls did not follow the current smart window');
    }
    HARMONIA.state.harmony.lastTriad = null;
    var left = HARMONIA.smartChordDegrees(4, 'I');
    if (left[0] === 'I' || left[0] === 'IV' || left[0] === 'V' || left[0] === 'vi') {
      throw new Error('Q duplicated a fixed left-hand degree: ' + left[0]);
    }
    if (left.slice(1).join(',') !== 'IV,V,vi,I') {
      throw new Error('fixed left-hand degrees changed: ' + left.slice(1).join(','));
    }
    if (HARMONIA.smartChordDegrees(0, 'ii')[0] !== 'ii') {
      throw new Error('trainer target ii did not reach Q');
    }
    HARMONIA.setAdaptiveAnchor(4);
    if (HARMONIA.handNoteBalls().join(',') !== win.join(',')) {
      throw new Error('hand balls did not follow anchor V');
    }
    var q = HARMONIA.harmonicChords()[0].degree;
    if (q === 'vii' + '\u00b0') throw new Error('Q picked the diminished passing chord');
    if (q !== left[0]) throw new Error('left Q did not follow the safe window: ' + q);
    HARMONIA.setAdaptiveAnchor(0);
  });

  step('smart-resume-window', function () {
    var palette = HARMONIA.diatonicPalette();
    HARMONIA.setAdaptiveAnchor(4);
    $('pSmartHand').click();
    if (HARMONIA.P.smartHand) throw new Error('smart hand did not turn off');
    var stale = HARMONIA.state.adaptive.window.slice();
    HARMONIA.state.harmony.lastTriad = palette[0];
    $('pSmartHand').click();
    if (!HARMONIA.P.smartHand) throw new Error('smart hand did not turn back on');
    if (HARMONIA.state.adaptive.anchor !== 0) {
      throw new Error('resumed smart mode kept the old anchor: ' + HARMONIA.state.adaptive.anchor);
    }
    if (HARMONIA.state.adaptive.window.indexOf(0) === -1) {
      throw new Error('resumed window lost the tonic root');
    }
    if (HARMONIA.state.adaptive.window.join(',') === stale.join(',')) {
      throw new Error('resumed window was not rebuilt for the current chord');
    }
    HARMONIA.state.harmony.lastTriad = null;
    HARMONIA.resetAdaptive();
    HARMONIA.setAdaptiveAnchor(0);
  });

  step('diminished-anchor', function () {
    var palette = HARMONIA.diatonicPalette();
    var dim = palette[6];
    var anchor = HARMONIA.smartAnchorForChord(dim);
    if (anchor === 6) throw new Error('diminished chord became the new anchor');
    if (anchor < 0 || !palette[anchor]) throw new Error('anchor is missing: ' + anchor);
    var common = palette[anchor].pcs.filter(function (pc) { return dim.pcs.indexOf(pc) !== -1; });
    if (!common.length) throw new Error('stable anchor shares no tones with vii' + '\u00b0');
  });

  step('smart-form-target', function () {
    var st = HARMONIA.state;
    var saved = { enabled: st.form.enabled, running: st.form.running, phase: st.form.phase, bar: st.form.bar };
    HARMONIA.setMode('major');
    HARMONIA.setAdaptiveAnchor(0);
    st.form.enabled = true;
    st.form.running = true;
    st.form.phase = 'playing';
    st.form.bar = 8;
    var goal = HARMONIA.Composition.targetForBar(8);
    if (!goal || goal.degree !== 'ii') throw new Error('bar 8 target is not ii: ' + (goal && goal.degree));
    if (HARMONIA.smartTargetDegree() !== 'ii') {
      throw new Error('piece target did not reach smartTargetDegree');
    }
    if (HARMONIA.harmonicChords()[0].degree !== 'ii') {
      throw new Error('Q did not follow the piece target: ' + HARMONIA.harmonicChords()[0].degree);
    }
    HARMONIA.updateHUD();
    var q = document.querySelector('#chordPad .chord-card[data-code="KeyQ"] .cc-deg');
    if (!q || q.textContent !== 'ii') {
      throw new Error('Q card did not repaint for the piece target: ' + (q && q.textContent));
    }
    st.form.enabled = saved.enabled;
    st.form.running = saved.running;
    st.form.phase = saved.phase;
    st.form.bar = saved.bar;
    HARMONIA.resetAdaptive();
    HARMONIA.updateHUD();
  });

  step('adaptive-defer', function () {
    var before = HARMONIA.state.adaptive.anchor;
    HARMONIA.state.keysDown.KeyJ = true;
    HARMONIA.requestAdaptiveAnchor(4);
    HARMONIA.applyPendingAdaptiveAnchor();
    if (HARMONIA.state.adaptive.anchor !== before) {
      throw new Error('anchor moved while a key was held');
    }
    HARMONIA.releaseCode('KeyJ');
    HARMONIA.setAdaptiveAnchor(0);
    if (HARMONIA.state.adaptive.anchor !== 0) throw new Error('anchor did not reset');
    if (HARMONIA.state.adaptive.switchTimer) throw new Error('explicit anchor left a pending timer');
    if (HARMONIA.state.adaptive.pendingAnchor != null) throw new Error('explicit anchor left a pending anchor');
  });

  step('note-chord-harmony', function () {
    HARMONIA.state.harmony.lastTriad = null;
    var alone = HARMONIA.noteChordPlan(62, 0.8, 0);
    if (!alone || alone.voices.length !== 4) throw new Error('note chord plan is incomplete');
    if (alone.h.degree !== 'ii') throw new Error('note D should get ii without a current chord');
    var palette = HARMONIA.diatonicPalette();
    HARMONIA.chordEvent(palette[4], 0.9, 'keys');
    var held = HARMONIA.noteChordPlan(62, 0.8, 0);
    if (!held || held.h.degree !== 'V') throw new Error('note D should follow the current V chord');
    if (held.voices[1][0] !== 55) throw new Error('current chord root should be G3, got ' + held.voices[1][0]);
    if (HARMONIA.noteChordPlan(60, 0.8, 0) !== null) {
      throw new Error('C over V should suppress the auto-triad (minor second)');
    }
    HARMONIA.P.smartHand = false;
    var roots = HARMONIA.noteChordPlan(62, 0.8, 0);
    if (!roots || roots.h.degree !== 'ii') {
      throw new Error('fixed-root mode should harmonize D as ii, got ' + (roots && roots.h.degree));
    }
    HARMONIA.P.smartHand = true;
    HARMONIA.cancelPendingNoteChord();
    HARMONIA.resetAdaptive();
    HARMONIA.setAdaptiveAnchor(0);
    HARMONIA.state.harmony.lastTriad = null;
  });

  step('melody-octave-record', function () {
    function take(oct) {
      HARMONIA.P.noteOct = oct;
      HARMONIA.startRecording();
      HARMONIA.pressCode('KeyJ', 0.8);
      HARMONIA.releaseCode('KeyJ');
      HARMONIA.stopRecording(true);
      var rec = HARMONIA.getRecordings()[0];
      var ev = rec && rec.events.find(function (e) { return e.type === 'note'; });
      if (!ev) throw new Error('note was not recorded at octave ' + oct);
      return ev.midi;
    }
    var base = take(0);
    var high = take(1);
    HARMONIA.P.noteOct = 1;
    if (high - base !== 12) {
      throw new Error('octave shift did not reach recording: ' + base + ' -> ' + high);
    }
  });

  step('recording-options', function () {
    var st = HARMONIA.state;
    HARMONIA.P.recCountIn = 1;
    HARMONIA.startRecording();
    if (!st.recordingCountIn) throw new Error('record count-in did not start');
    if (st.recording) throw new Error('recording began during count-in');
    if ($('recStatus').textContent.indexOf('\u041e\u0442\u0441\u0447\u0451\u0442') === -1) {
      throw new Error('count-in status is not visible');
    }
    HARMONIA.stopRecording(false);
    if (st.recordingCountIn || st.recording) throw new Error('count-in did not cancel');
    HARMONIA.P.recCountIn = 0;
    $('recLoop').click();
    if (!HARMONIA.P.recLoop) throw new Error('loop toggle did not turn on');
    $('recLoop').click();
    if (HARMONIA.P.recLoop) throw new Error('loop toggle did not turn off');
  });

  step('form-enable', function () {
    var meter = $('formCountIn');
    meter.value = '0';
    meter.dispatchEvent(new Event('change', { bubbles: true }));
    $('formBtn').click();
    if (!HARMONIA.state.form.enabled || !HARMONIA.state.form.running) throw new Error('form did not start');
    if (!HARMONIA.Transport.running) throw new Error('Transport did not start');
    if (!$('formHud').classList.contains('on')) throw new Error('form HUD is hidden while form is on');
    if (HARMONIA.state.form.bar !== 1) throw new Error('first bar not reached: ' + HARMONIA.state.form.bar);
  });

  step('count-in-two-bars', function () {
    var st = HARMONIA.state;
    var ci = $('formCountIn');
    ci.value = '2';
    ci.dispatchEvent(new Event('change', { bubbles: true }));
    $('formStop').click();
    $('formBtn').click();
    if (st.form.phase !== 'countin') throw new Error('count-in did not enter countin phase');
    if ($('formPos').textContent.indexOf('/8') === -1) {
      throw new Error('count-in total is not two bars: ' + $('formPos').textContent);
    }
    $('formStop').click();
    ci.value = '0';
    ci.dispatchEvent(new Event('change', { bubbles: true }));
    $('formBtn').click();
    if (st.form.bar !== 1) throw new Error('form did not restart at bar 1');
  });

  step('pause-resume', function () {
    HARMONIA.Composition.setPaused(true);
    if (HARMONIA.state.form.phase !== 'paused') throw new Error('form did not pause');
    HARMONIA.Composition.setPaused(false);
    if (HARMONIA.state.form.phase === 'paused') throw new Error('form did not resume');
  });

  step('full-piece', function () {
    var st = HARMONIA.state;
    var before = st.score;
    HARMONIA.Transport.stop();
    HARMONIA.Transport.beatsPerBar = 4;
    HARMONIA.Transport.countInBeats = 0;
    for (var b = 0; b < 64; b++) {
      HARMONIA.Composition.onBeat(b);
      var bar = Math.floor(b / 4) + 1;
      var target = HARMONIA.Composition.targetForBar(bar);
      if (!target) throw new Error('target missing for bar ' + bar);
      HARMONIA.Composition.onChord({
        degree: target.degree, name: target.name, hint: target.hint,
        tonic: !!target.tonic, rootPc: target.rootPc, pcs: target.pcs,
        pcsKey: target.pcsKey
      });
    }
    HARMONIA.Composition.onNote(60, 0.8);
    HARMONIA.Composition.onNote(67, 0.8);
    HARMONIA.Composition.finishPiece();
    if (st.form.phase !== 'done') throw new Error('piece did not finish');
    if (st.form.summaries.length !== 5) throw new Error('expected 5 sections, got ' + st.form.summaries.length);
    if (!(st.form.points > 0)) throw new Error('form points are zero');
    if (!(st.score > before)) throw new Error('form points did not reach the score');
    if (st.form.melody.notes !== 2) throw new Error('melody notes were not counted');
    if (st.form.melody.pcs.size !== 2) throw new Error('melody pitch classes were not counted');
    if ($('formResultMelody').textContent.indexOf('\u041c\u0435\u043b\u043e\u0434\u0438\u044f') === -1) {
      throw new Error('melody summary is missing from the result');
    }
    if (!$('formResult').classList.contains('show')) throw new Error('result screen is hidden');
  });

  step('result-modal-lock', function () {
    var st = HARMONIA.state;
    $('pauseBtn').click();
    if (st.paused) throw new Error('result screen let pause through');
    if (!$('formResult').classList.contains('show')) throw new Error('result screen closed unexpectedly');
    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'Escape', key: 'Escape', bubbles: true, cancelable: true
    }));
    if (st.paused) throw new Error('result screen let Escape through');
    if (st.form.phase !== 'done') throw new Error('result screen changed the finished piece');
  });

  step('return-to-jam', function () {
    $('formResultJam').click();
    if (HARMONIA.state.form.enabled) throw new Error('form still enabled');
    if ($('formHud').classList.contains('on')) throw new Error('form HUD still visible');
    if ($('formResult').classList.contains('show')) throw new Error('result still visible');
  });

  step('restart-clears-strip', function () {
    var st = HARMONIA.state;
    $('formRestart').click();
    if (!st.form.running || st.form.bar !== 1) throw new Error('restart did not start at bar 1');
    var stale = 0;
    var bars = $('formBars').children;
    for (var i = 0; i < bars.length; i++) {
      if (bars[i].classList.contains('done')) stale += 1;
    }
    if (stale) throw new Error('old bars still marked done: ' + stale);
    $('formStop').click();
  });

  step('three-four-mode-meter', function () {
    var st = HARMONIA.state;
    var meter = $('formMeter');
    meter.value = '3';
    meter.dispatchEvent(new Event('change', { bubbles: true }));
    $('formBtn').click();
    if (!st.form.running || HARMONIA.Transport.beatsPerBar !== 3) throw new Error('3/4 did not start');
    if ($('formBeats').children.length !== 3) throw new Error('beat dots do not follow 3/4');
    HARMONIA.setMode('minor');
    var target = HARMONIA.Composition.targetForBar(1);
    if (!target || target.degree !== 'i') throw new Error('minor target is not tonic: ' + (target && target.degree));
    meter.value = '4';
    meter.dispatchEvent(new Event('change', { bubbles: true }));
    if (HARMONIA.Transport.beatsPerBar !== 4) throw new Error('meter change did not restart transport');
    if ($('formBeats').children.length !== 4) throw new Error('beat dots do not follow 4/4');
    $('formMetronome').click();
    if (HARMONIA.Transport.metronome !== HARMONIA.P.formMetronome) throw new Error('metronome toggle did not reach Transport');
    $('formStop').click();
    if (st.form.enabled) throw new Error('stop did not return to jam');
  });

  step('record-form-meta', function () {
    var st = HARMONIA.state;
    $('formBtn').click();
    if (!st.form.enabled || st.form.bar !== 1) throw new Error('form did not start for recording');
    HARMONIA.startRecording();
    var target = HARMONIA.Composition.targetForBar(1);
    HARMONIA.chordEvent(target, 0.9, 'keys');
    HARMONIA.stopRecording(true);
    var rec = HARMONIA.getRecordings().filter(function (r) {
      return r.events && r.events.some(function (ev) { return ev.form; });
    })[0];
    if (!rec || !rec.form) throw new Error('form metadata missing from recording');
    if (rec.form.bpm !== HARMONIA.P.formBpm) throw new Error('recording bpm mismatch');
    if (rec.form.beatsPerBar !== 4 || rec.form.bars !== 16) {
      throw new Error('recording meter/bars mismatch');
    }
    var ev = rec.events.find(function (e) { return e.form; });
    if (!ev || ev.form.bar !== 1 || !ev.form.section) {
      throw new Error('recording event lost its bar/section');
    }
    $('formStop').click();
    if (st.form.enabled) throw new Error('form did not stop after recording test');
  });

  step('station-auto-record-midi', function () {
    // Автозапись — отдельная дорожка посещения: она пишется параллельно ручной,
    // хранит combo/station/plot и не создаёт запись для пустого визита.
    // MIDI собирается из тех же событий; проверяем заголовок SMF и парность
    // note-on/note-off, а не только наличие байтов.
    var H = HARMONIA, P = H.P, st = H.state;
    var savedAuto = P.autoRecord, savedMode = st.mode, savedIdx = st.comboIdx;
    if (st.recording || st.recordingCountIn) H.stopRecording(true);
    H.stopPlayback();
    if (!st.running) H.beginFromOverlay();
    if (st.paused) $('mResume').click();
    try {
      // Выключенный слой не пишет даже при смене станции и сыгранном аккорде.
      H.setAutoRecord(false);
      H.loadCombo(0, false);
      var offCount = H.getRecordings().length;
      H.chordEvent(H.harmonicChords()[0], 0.8, 'keys');
      if (H.autoRecordStatus() !== null || H.autoRecordFinalize() !== null ||
          H.getRecordings().length !== offCount) {
        throw new Error('P.autoRecord=false still records the station');
      }
      P.autoRecord = true;
      H.loadCombo(0, false);
      H.chordEvent(H.harmonicChords()[0], 0.8, 'keys');
      var auto = H.autoRecordFinalize();
      if (!auto || !auto.auto) throw new Error('the station visit was not auto-recorded');
      if (!auto.station || !auto.station.id || !auto.combo || !auto.combo.id) {
        throw new Error('the auto recording lost its station metadata');
      }
      if (!auto.events.length || auto.events[0].t < 0) {
        throw new Error('the auto recording has no timed events');
      }
      if (auto.name.indexOf('Станция ') !== 0) {
        throw new Error('the auto recording is not labelled by station: ' + auto.name);
      }
      // Пустой визит не должен попадать в список.
      var count = H.getRecordings().length;
      H.loadCombo(1, false);
      if (H.autoRecordFinalize() !== null || H.getRecordings().length !== count) {
        throw new Error('an empty station visit was saved');
      }
      // SMF: MThd, длина 6, format 0, один трек, PPQ 480, длина MTrk совпадает.
      var bytes = H.buildMidiFile(auto);
      if (!(bytes instanceof Uint8Array) || bytes.length < 22) {
        throw new Error('MIDI file is too short');
      }
      function ascii(from, to) {
        var s = '';
        for (var i = from; i < to; i++) s += String.fromCharCode(bytes[i]);
        return s;
      }
      if (ascii(0, 4) !== 'MThd') throw new Error('MIDI header is missing');
      if ((bytes[4] << 24 | bytes[5] << 16 | bytes[6] << 8 | bytes[7]) !== 6) {
        throw new Error('MIDI header length is wrong');
      }
      if (bytes[8] !== 0 || bytes[9] !== 0 || bytes[10] !== 0 || bytes[11] !== 1) {
        throw new Error('MIDI must be format 0 with one track');
      }
      if (((bytes[12] << 8) | bytes[13]) !== 480) throw new Error('MIDI PPQ is not 480');
      if (ascii(14, 18) !== 'MTrk') throw new Error('MIDI track chunk is missing');
      var trackLen = (bytes[18] << 24 | bytes[19] << 16 | bytes[20] << 8 | bytes[21]);
      if (trackLen !== bytes.length - 22) throw new Error('MIDI track length is wrong');
      var midi = H.midiRecordingEvents(auto).events;
      var ons = midi.filter(function (e) { return e.on; }).length;
      var offs = midi.filter(function (e) { return !e.on; }).length;
      if (!ons || ons !== offs) throw new Error('MIDI note-on/note-off are unbalanced');
      var midiName = H.midiFileName(auto);
      var wavName = H.audioFileName(auto);
      var videoName = H.videoFileName(auto);
      if (midiName.slice(-4) !== '.mid') throw new Error('MIDI file name is wrong');
      if (wavName.slice(-4) !== '.wav') throw new Error('WAV file name is wrong');
      if (videoName.slice(-5) !== '.webm') throw new Error('video file name is wrong');
      if (midiName.slice(0, -4) !== wavName.slice(0, -4) ||
          wavName.slice(0, -4) !== videoName.slice(0, -5)) {
        throw new Error('MIDI, WAV and video names must share one base: ' +
          midiName + ' / ' + wavName + ' / ' + videoName);
      }
    } finally {
      P.autoRecord = savedAuto;
      st.mode = savedMode;
      st.comboIdx = savedIdx;
      H.loadCombo(0, false);
    }
  });

  step('record-drums-video', function () {
    // Ударные — отдельная дорожка: время удара пишется в момент звучания,
    // таймлайн для прослушивания/видео объединяет её с мелодией, а MIDI
    // по-прежнему собирается только из rec.events.
    var H = HARMONIA, st = H.state;
    if (st.recording || st.recordingCountIn) H.stopRecording(true);
    H.stopPlayback();
    if (!st.running) H.beginFromOverlay();
    if (st.paused) $('mResume').click();
    var savedAuto = H.P.autoRecord, savedCountIn = H.P.recCountIn;
    try {
      H.setAutoRecord(false);
      H.P.recCountIn = 0;
      H.startRecording();
      if (!st.recording) throw new Error('the drum take did not start');
      H.recordDrumAt('kick', 0.9, performance.now());
      H.recordDrumAt('snare', 0.7, performance.now());
      H.recordNote(60, 0.8, 0, false);
      H.recordChord(H.harmonicChords()[0], 0.9);
      H.stopRecording(true);
      var rec = H.getRecordings()[0];
      if (!rec || !Array.isArray(rec.drums) || rec.drums.length !== 2) {
        throw new Error('drum hits did not reach the separate track');
      }
      if (!rec.combo || !rec.combo.keyName || !(rec.bpm >= 40)) {
        throw new Error('the take lost its key or tempo metadata');
      }
      if (rec.drums[0].type !== 'drum' || rec.drums[0].kind !== 'kick') {
        throw new Error('the drum event lost its kind');
      }
      var timeline = H.recordingTimeline(rec);
      if (timeline.length !== rec.events.length + rec.drums.length) {
        throw new Error('the recording timeline lost events');
      }
      for (var i = 1; i < timeline.length; i++) {
        if ((timeline[i].t || 0) < (timeline[i - 1].t || 0)) {
          throw new Error('the recording timeline is not sorted');
        }
      }
      if (!timeline.some(function (ev) { return ev.type === 'drum'; })) {
        throw new Error('the merged timeline has no drums');
      }
      var withDrums = H.midiRecordingEvents(rec).events.length;
      var withoutDrums = H.midiRecordingEvents(Object.assign({}, rec, { drums: [] })).events.length;
      if (withDrums !== withoutDrums) throw new Error('MIDI export included the drum track');
      if (!H.videoLegacyWarning({ name: 'old', events: rec.events })) {
        throw new Error('old recordings must warn about missing drums');
      }
      if (H.videoLegacyWarning(rec) !== '') {
        throw new Error('a new recording was mistaken for an old one');
      }
      if (H.videoFileName(rec).slice(-5) !== '.webm') throw new Error('video file name is wrong');
      if (H.audioFileName(rec).slice(-4) !== '.wav') throw new Error('WAV file name is wrong');
      if (!(H.audioDuration(rec) >= 1500)) throw new Error('audio duration is too short');
      var wav = H.audioPcmToWav([
        new Float32Array([0, 0.5, -0.5]),
        new Float32Array([0, -0.5, 0.5])
      ], 48000);
      function wavAscii(from, to) {
        var s = '';
        for (var wi = from; wi < to; wi++) s += String.fromCharCode(wav[wi]);
        return s;
      }
      if (!(wav instanceof Uint8Array)) throw new Error('WAV result must be a byte array');
      if (wavAscii(0, 4) !== 'RIFF') throw new Error('WAV RIFF header is missing');
      if (wavAscii(8, 12) !== 'WAVE') throw new Error('WAV WAVE header is missing');
      if (wavAscii(12, 16) !== 'fmt ') throw new Error('WAV fmt chunk is missing');
      if (wavAscii(36, 40) !== 'data') throw new Error('WAV data chunk is missing');
      var wavView = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      if (wavView.getUint32(4, true) !== wav.length - 8) throw new Error('WAV RIFF size is wrong');
      if (wavView.getUint16(20, true) !== 1) throw new Error('WAV must be PCM');
      if (wavView.getUint16(22, true) !== 2) throw new Error('WAV must be stereo');
      if (wavView.getUint32(24, true) !== 48000) throw new Error('WAV sample rate is wrong');
      if (wavView.getUint16(34, true) !== 16) throw new Error('WAV must be 16-bit');
      if (wavView.getUint32(40, true) !== 12) throw new Error('WAV data length is wrong');
      if (wavView.getInt16(46, true) !== 0 ||
          wavView.getInt16(48, true) !== 16384 ||
          wavView.getInt16(50, true) !== -16384) {
        throw new Error('WAV samples are not interleaved/quantized');
      }
      if (!$('recAudio') || !$('researchAskAudio') || !$('audioExport')) {
        throw new Error('the audio UI is missing');
      }
      if (!$('audioExport').hidden) throw new Error('the audio overlay must start hidden');
      if (H.audioSupported() && $('recAudio').disabled) {
        throw new Error('the audio button is disabled with a ready recording');
      }
      if (!(H.videoDuration(rec) >= 1400)) throw new Error('video duration is too short');
      var spec = H.videoSize();
      if (!spec || spec.width !== 720 || spec.height !== 1280) {
        throw new Error('video frame is not 720x1280');
      }
      if (spec.width * 16 !== spec.height * 9) throw new Error('video frame is not 9:16');
      // Статичная рамка тоже должна строиться в 720×1280, а не остаться 1080p:
      // вся разметка внутри уменьшается transform'ом.
      var baseProbe = videoBuildBase({
        rec: rec, duration: H.videoDuration(rec),
        timeline: timeline,
        firstEventAt: timeline.length ? Math.max(0, Number(timeline[0].t) || 0) : 0
      });
      if (!baseProbe || baseProbe.width !== 720 || baseProbe.height !== 1280) {
        throw new Error('the static video frame is not 720x1280');
      }
      // Ролик стартует с первого события и после короткого хвоста показывает
      // финальную карточку: заминки записи не растягивают видео.
      var trimmed = H.videoDuration({
        events: [
          { type: 'note', t: 5000, midi: 60 },
          { type: 'note', t: 25000, midi: 64 }
        ],
        drums: [], duration: 60000
      });
      if (trimmed < 21200 || trimmed > 21700) {
        throw new Error('the video did not trim the recording edges: ' + trimmed);
      }
      // Фоновый грув не задаёт края: удар на входе (t=0) и удар после последней
      // ноты (t=14000) не должны вернуть в ролик четыре секунды бездействия.
      var background = {
        events: [
          { type: 'note', t: 5000, midi: 60 },
          { type: 'note', t: 9000, midi: 64 }
        ],
        drums: [
          { type: 'drum', t: 0, kind: 'kick' },
          { type: 'drum', t: 14000, kind: 'snare' }
        ],
        duration: 15000
      };
      var backgroundTake = H.recordingExportTimeline(background);
      if (backgroundTake.firstEventAt !== 5000 || backgroundTake.lastEventAt !== 9000) {
        throw new Error('the melody did not set the export window');
      }
      if (backgroundTake.timeline.length !== 2 ||
          backgroundTake.timeline.some(function (ev) { return ev.type === 'drum'; })) {
        throw new Error('background drums leaked into the export timeline');
      }
      var backgroundVideo = H.videoDuration(background);
      if (backgroundVideo < 5400 || backgroundVideo > 5500) {
        throw new Error('background drums stretched the video: ' + backgroundVideo);
      }
      var backgroundAudio = H.audioDuration(background);
      if (backgroundAudio < 5550 || backgroundAudio > 5650) {
        throw new Error('background drums stretched the WAV: ' + backgroundAudio);
      }
      // WAV-захват длиннее затухания: цифровая тишина по краям срезается, а
      // слышимые сэмплы и небольшие поля вокруг них остаются.
      var pcm = new Int16Array(48000);
      pcm[12000] = 3000;
      pcm[24000] = -3000;
      var trimmedPcm = H.audioPcmTrim([pcm], 48000);
      if (!trimmedPcm || !trimmedPcm[0] || !(trimmedPcm[0] instanceof Int16Array)) {
        throw new Error('audioPcmTrim lost the channel');
      }
      if (trimmedPcm[0].length >= pcm.length || trimmedPcm[0].length < 10000) {
        throw new Error('audioPcmTrim kept the silent edges: ' + trimmedPcm[0].length);
      }
      if (trimmedPcm[0][1440] !== 3000 || trimmedPcm[0][13440] !== -3000) {
        throw new Error('audioPcmTrim moved the audible samples');
      }
      var single = H.videoDuration({
        events: [{ type: 'note', t: 60000, midi: 60 }], drums: [], duration: 60000
      });
      if (single < 1400 || single > 1500) {
        throw new Error('one-event video must keep only a short tail: ' + single);
      }
      var caption = H.videoCaption(rec);
      if (!caption || caption.indexOf('https://godspace.github.io/HARMONIA/') === -1) {
        throw new Error('the social caption lost the canonical link');
      }
      var tonic = H.chordLabel(rec.combo.chords[0]);
      if (!tonic || caption.indexOf('HARMONIA · ' + tonic) !== 0) {
        throw new Error('the caption must start with the tonic chord: ' + caption);
      }
      if (caption.indexOf('Станция ') !== -1) {
        throw new Error('the caption still uses the station name');
      }
      if (!$('recVideo') || !$('recCaption') || !$('videoExport')) {
        throw new Error('the video UI is missing');
      }
      if (!$('videoExport').hidden) throw new Error('the video overlay must start hidden');
    } finally {
      H.P.autoRecord = savedAuto;
      H.P.recCountIn = savedCountIn;
      H.autoRecordFinalize();
      if (savedAuto) H.setAutoRecord(true);
    }
  });

  step('video-media-clock', function () {
    // Звук и картинка должны идти от одного mediaT0: первый визуальный тик
    // срабатывает в кадре 0, ровно на t первого события, и не повторяется
    // на следующем кадре. Отдельных setTimeout у видео больше нет.
    var calls = [];
    var savedPlay = playRecordedVisual;
    try {
      playRecordedVisual = function (ev) { calls.push(ev && ev.t); };
      var v = {
        timeline: [
          { type: 'note', t: 0 },
          { type: 'drum', t: 100 },
          { type: 'chord', t: 500 }
        ],
        firstEventAt: 0, visualIdx: 0, rec: {}
      };
      videoStepVisual(v, 0);
      if (calls.length !== 1 || calls[0] !== 0) {
        throw new Error('the first visual event did not fire at frame 0');
      }
      videoStepVisual(v, 99);
      if (calls.length !== 1) throw new Error('a visual event fired before its timestamp');
      videoStepVisual(v, 499);
      if (calls.length !== 1) throw new Error('the chord visual fired too early');
      videoStepVisual(v, 500);
      if (calls.length !== 2 || calls[1] !== 500) {
        throw new Error('the chord visual did not follow the media clock: ' + calls.join(','));
      }
      videoStepVisual(v, 500);
      if (calls.length !== 2) throw new Error('a visual event fired twice');
      var trimmed = {
        timeline: [{ type: 'note', t: 5000 }],
        firstEventAt: 5000, visualIdx: 0, rec: {}
      };
      videoStepVisual(trimmed, 0);
      if (calls.length !== 3 || calls[2] !== 5000) {
        throw new Error('the trimmed timeline lost its first event');
      }
      if (videoMediaElapsed({ mediaT0: null, startedAt: 0 }) !== 0) {
        throw new Error('the media clock must start at zero');
      }
      // Тонический возврат в ролике повторяет золотую вспышку игры, хотя
      // chordEvent() в replay не начисляет очки и не включает игровые эффекты.
      var tonicHits = 0;
      var savedFlash = flashTonicReturn;
      var savedPlayVisual = playRecordedVisual;
      try {
        playRecordedVisual = function () {};
        flashTonicReturn = function () { tonicHits += 1; };
        var harmonic = {
          timeline: [
            { type: 'chord', t: 0, h: { kind: 'major', tonic: false } },
            { type: 'chord', t: 200, h: { kind: 'major', tonic: true } },
            { type: 'chord', t: 400, h: { kind: 'major', tonic: true } }
          ],
          firstEventAt: 0, visualIdx: 0, tonicSteps: 0, rec: {}
        };
        videoStepVisual(harmonic, 0);
        if (tonicHits !== 0) throw new Error('tonic flashed without a return');
        videoStepVisual(harmonic, 200);
        if (tonicHits !== 1) {
          throw new Error('the tonic return flash did not follow the media clock');
        }
        videoStepVisual(harmonic, 400);
        if (tonicHits !== 1) throw new Error('the tonic flash repeated without tension');
      } finally {
        flashTonicReturn = savedFlash;
        playRecordedVisual = savedPlayVisual;
      }
    } finally {
      playRecordedVisual = savedPlay;
    }
  });

  step('suno-handoff', function () {
    // Suno без API: промпт — чистый английский текст, кнопки есть, WAV-экспорт
    // получает purpose 'suno'. Сам рендер в smoke не запускается: он реального
    // времени, как и WAV/видео.
    var H = HARMONIA;
    if (H.SUNO_CREATE_URL !== 'https://suno.com/create') {
      throw new Error('the Suno URL is wrong');
    }
    if (typeof H.sunoPrompt !== 'function' || typeof H.sunoState !== 'function') {
      throw new Error('the Suno API is missing');
    }
    if (!$('recSuno') || !$('researchAskSuno')) {
      throw new Error('the Suno UI is missing');
    }
    var probe = H.sunoPrompt({
      events: [{ type: 'note', t: 0, midi: 60 }],
      combo: { id: 1, mode: 'major', keyNameLatin: 'C major', chords: [['до', 'ми', 'соль']] },
      bpm: 84, beatsPerBar: 4,
      station: { touch: 'felt' },
      drums: [{ type: 'drum', t: 0, kind: 'kick' }]
    });
    if (probe.indexOf('Instrumental') !== 0) {
      throw new Error('the Suno prompt must start with Instrumental: ' + probe);
    }
    if (probe.indexOf('no vocals') === -1) throw new Error('the prompt lost "no vocals"');
    if (probe.indexOf('C major') === -1) throw new Error('the prompt lost the key');
    if (probe.indexOf('84 BPM') === -1) throw new Error('the prompt lost the tempo');
    if (probe.indexOf('4/4') === -1) throw new Error('the prompt lost the meter');
    if (probe.indexOf('soft felt piano') === -1) {
      throw new Error('the prompt lost the station timbre');
    }
    if (probe.indexOf('soft brushed drums') === -1) {
      throw new Error('the prompt lost the drum track');
    }
    if (/[\u0400-\u04FF]/.test(probe)) throw new Error('the Suno prompt must be English');
    if (/undefined|null/.test(probe)) throw new Error('the Suno prompt has an empty value');
    var quiet = H.sunoPrompt({
      events: [],
      combo: { id: 13, mode: 'minor', keyNameLatin: 'A minor', chords: [['ля', 'до', 'ми']] },
      form: { bpm: 72, beatsPerBar: 3 }, station: { touch: 'glass' }, drums: []
    });
    if (quiet.indexOf('A minor') === -1 || quiet.indexOf('72 BPM') === -1) {
      throw new Error('the prompt lost the minor key or form tempo: ' + quiet);
    }
    if (quiet.indexOf('3/4') === -1) throw new Error('the prompt ignored the 3/4 meter');
    if (quiet.indexOf('no drums') === -1) throw new Error('the prompt must say "no drums"');
    var ruKey = H.sunoPrompt({
      events: [], combo: { mode: 'minor', keyName: 'ля минор', chords: [['ля', 'до', 'ми']] }
    });
    if (ruKey.indexOf('A minor') === -1 || /[\u0400-\u04FF]/.test(ruKey)) {
      throw new Error('an old Russian-only combo did not become a Latin key: ' + ruKey);
    }
    var legacy = H.sunoPrompt({ events: [{ type: 'note', t: 0, midi: 60 }], name: 'old' });
    if (!legacy || /undefined|null/.test(legacy) || /[\u0400-\u04FF]/.test(legacy)) {
      throw new Error('the legacy prompt is not clean English: ' + legacy);
    }
    if (legacy.indexOf('C major') === -1 || legacy.indexOf('84 BPM') === -1) {
      throw new Error('the legacy prompt lost its safe defaults: ' + legacy);
    }
    if (H.sunoPrompt(null) !== '') throw new Error('an empty recording must give an empty prompt');
    var state = H.sunoState();
    if (state.ready || state.id || state.prompt) {
      throw new Error('the Suno hand-off must start without a ready WAV');
    }
    if (!H.audioSupported() && !$('recSuno').disabled) {
      throw new Error('the Suno button ignores browser audio support');
    }
    if (H.audioSupported() && $('recSuno').disabled) {
      throw new Error('the Suno button is disabled with a ready recording');
    }
    if (!$('researchAskSuno').disabled) {
      throw new Error('the rating card Suno button must wait for a recording');
    }
  });

  step('groove-patterns', function () {
    // Паттерны — это строки шагов: длина строки и есть размер такта. Опечатку
    // в строке звук не заметит (шаги добиваются точками), поэтому её ловим тут.
    var cfg = HARMONIA.CFG.groove;
    Object.keys(cfg.patterns).forEach(function (id) {
      var p = cfg.patterns[id];
      var want = p.meter === 3 ? 12 : 16;
      ['kick', 'snare', 'hat'].forEach(function (lane) {
        if (String(p[lane]).length !== want) {
          throw new Error(id + '.' + lane + ' must be ' + want + ' steps, got ' + String(p[lane]).length);
        }
      });
      if (!p.label) throw new Error(id + ' has no label');
    });
    function kinds(id, step, meter) {
      return HARMONIA.groovePlan(id, step, meter).map(function (h) { return h.kind; }).join(',');
    }
    if (kinds('straight', 0, 4) !== 'kick,hat') throw new Error('straight step 0 = ' + kinds('straight', 0, 4));
    if (kinds('straight', 4, 4) !== 'snare,hat') throw new Error('straight step 4 = ' + kinds('straight', 4, 4));
    // Акцент на сильной доле громче обычного удара: иначе бочка «плоская».
    if (HARMONIA.groovePlan('straight', 0, 4)[0].vel !== 1) throw new Error('downbeat is not accented');
    if (HARMONIA.groovePlan('straight', 8, 4)[0].vel >= 1) throw new Error('backbeat must be softer than the downbeat');
    // Шаг за тактом заворачивается в начало, а не пропадает.
    if (JSON.stringify(HARMONIA.groovePlan('straight', 16, 4)) !==
        JSON.stringify(HARMONIA.groovePlan('straight', 0, 4))) {
      throw new Error('step 16 must wrap to the start of the bar');
    }
    if (JSON.stringify(HARMONIA.groovePlan('waltz', 12, 3)) !==
        JSON.stringify(HARMONIA.groovePlan('waltz', 0, 3))) {
      throw new Error('the waltz bar must be 12 steps');
    }
    // План удара: velocity масштабирует громкость, неизвестный инструмент
    // становится тарелкой, а не тишиной.
    var soft = HARMONIA.drumPlan('kick', 0.2), hard = HARMONIA.drumPlan('kick', 1);
    if (!(hard.peak > soft.peak)) throw new Error('velocity does not scale the hit');
    if (HARMONIA.drumPlan('nope').kind !== 'hat') throw new Error('unknown kit piece must fall back to the hat');
    if (typeof HARMONIA.DRUM_TIMBRES !== 'object') throw new Error('drum timbres are missing');
    // drumHit без открытого тракта — тишина, а не ошибка (голова харнесса).
    var hit = HARMONIA.drumHit('rim', null, 0.5);
    if (hit && hit.kind !== 'rim') throw new Error('drumHit returned the wrong plan');
  });

  step('groove-toggle', function () {
    var G = HARMONIA.Groove;
    // Грув включается клавишей Enter на стартовой пробе, поэтому «по умолчанию»
    // проверяем по DEFAULTS, а не по текущему состоянию: панель должна работать
    // и после того, как игрок уже слышал барабаны.
    if (HARMONIA.DEFAULTS.grooveOn !== false) throw new Error('groove must be off in DEFAULTS');
    if (HARMONIA.DEFAULTS.groovePattern !== 'ballad') throw new Error('the ballad must be the default pattern');
    if (Math.abs(HARMONIA.DEFAULTS.drumVol - 0.2) > 1e-6) {
      throw new Error('the default drum volume must be 20 %');
    }
    G.setOn(false);
    if (G.on || HARMONIA.P.grooveOn) throw new Error('groove did not go quiet for the panel test');
    if ($('grooveToggle').getAttribute('aria-pressed') !== 'false') {
      throw new Error('toggle shows the wrong state');
    }
    $('grooveToggle').click();
    if (!G.on || !HARMONIA.P.grooveOn) throw new Error('toggle did not turn the groove on');
    if ($('grooveToggle').getAttribute('aria-pressed') !== 'true') throw new Error('toggle is not pressed');
    // Список фигур собран из CFG.groove.patterns — новая фигура не требует
    // правок разметки.
    var sel = $('groovePattern');
    if (sel.options.length !== Object.keys(HARMONIA.CFG.groove.patterns).length) {
      throw new Error('pattern list does not match CFG.groove.patterns');
    }
    sel.value = 'waltz';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (G.patternId !== 'waltz' || HARMONIA.P.groovePattern !== 'waltz') {
      throw new Error('pattern did not reach the groove');
    }
    if (G.meter() !== 3) throw new Error('the waltz must play in 3/4');
    var bpm = $('pGrooveBpm');
    bpm.value = '96';
    bpm.dispatchEvent(new Event('input', { bubbles: true }));
    if (Math.abs(HARMONIA.P.grooveBpm - 96) > 0.001) throw new Error('groove tempo did not reach P');
    if ($('vGrooveBpm').textContent.indexOf('96') !== 0) {
      throw new Error('tempo readout is wrong: ' + $('vGrooveBpm').textContent);
    }
    // Обратно в тишину: по умолчанию джем идёт без долей.
    $('grooveToggle').click();
    if (G.on || HARMONIA.P.grooveOn) throw new Error('toggle did not turn the groove off');
    sel.value = 'straight';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (G.patternId !== 'straight') throw new Error('pattern did not go back to straight');
  });

  step('groove-enter', function () {
    // Enter — тот же переключатель, что кнопка панели, но не ход по комбо:
    // маршрут остался у ↑/↓, Backspace и Space после 300.
    var G = HARMONIA.Groove, st = HARMONIA.state;
    function pressEnter() {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'Enter', key: 'Enter', bubbles: true, cancelable: true
      }));
    }
    G.setOn(false);
    var mode = st.mode, idx = st.comboIdx, score = st.score;
    pressEnter();
    if (!G.on || !HARMONIA.P.grooveOn) throw new Error('Enter did not turn the drums on');
    if ($('grooveToggle').getAttribute('aria-pressed') !== 'true') {
      throw new Error('the panel did not follow Enter');
    }
    if (st.mode !== mode || st.comboIdx !== idx || st.score !== score) {
      throw new Error('Enter must not touch the combo or the score');
    }
    pressEnter();
    if (G.on || HARMONIA.P.grooveOn) throw new Error('Enter did not turn the drums off');
    if (st.mode !== mode || st.comboIdx !== idx) throw new Error('Enter moved the combo');
  });

  step('groove-follows-form', function () {
    var st = HARMONIA.state, G = HARMONIA.Groove;
    $('grooveToggle').click();
    if (!G.on) throw new Error('groove did not turn on');
    // Джем: свои часы и свой темп из панели.
    if (G._clockSource() !== 'jam') throw new Error('the jam must use the groove clock');
    if (G.bpm() !== HARMONIA.P.grooveBpm) throw new Error('jam tempo is not the panel tempo');
    // Пьеса: темп и размер ведёт Transport, ползунок темпа гаснет.
    $('formBtn').click();
    if (!st.form.running) throw new Error('form did not start');
    G.paint();
    if (G._clockSource() !== 'form') throw new Error('the piece must drive the groove');
    if (G.bpm() !== HARMONIA.Transport.bpm) throw new Error('groove tempo does not follow the piece');
    if (G.meter() !== 4) throw new Error('groove meter does not follow the piece');
    if (!$('pGrooveBpm').disabled) throw new Error('jam tempo must be disabled while the piece runs');
    // Пока пьеса идёт, вместо своего темпа показываем «ведёт пьеса»: не «без BPM»,
    // а ровно эта строка — иначе подпись может остаться пустой и тест смолчит.
    if ($('vGrooveBpm').textContent !== 'ведёт пьеса') {
      throw new Error('readout must hand the tempo to the piece: ' + $('vGrooveBpm').textContent);
    }
    // Пауза останавливает грув вместе с сессией: планировщик молчит.
    $('pauseBtn').click();
    if (!st.paused) throw new Error('pause did not engage');
    if (G.update() !== false) throw new Error('paused groove still plans hits');
    $('pauseBtn').click();
    if (st.paused) throw new Error('resume did not work');
    // Возврат в джем отдаёт груву собственные часы.
    $('formStop').click();
    G.paint();
    if (G._clockSource() !== 'jam') throw new Error('groove did not return to the jam clock');
    if ($('pGrooveBpm').disabled) throw new Error('jam tempo must come back after the piece');
    // Возврат в джем показывает свой темп из панели — ровно то число, что в P.
    if ($('vGrooveBpm').textContent !== HARMONIA.P.grooveBpm + ' BPM') {
      throw new Error('readout did not return to the jam tempo: ' + $('vGrooveBpm').textContent);
    }
    $('grooveToggle').click();
    if (G.on) throw new Error('groove did not turn off');
  });

  // Планировщик, а не только панель: удары действительно рождаются, темп меняет
  // их количество, а выключенный грув молчит.
  step('groove-hits', function () {
    var G = HARMONIA.Groove, st = HARMONIA.state;
    if (!st.running || st.paused) throw new Error('the session must be live for the groove test');
    if (!G.on) $('grooveToggle').click();
    if (!G.on) throw new Error('groove did not turn on');
    if (typeof audioCtx === 'undefined' || !audioCtx) {
      throw new Error('turning the groove on must open the audio path');
    }
    // Часы грува свои, поэтому шагаем ими вручную по 50 мс: прогон не зависит
    // от частоты кадров headless-браузера.
    function walk(count) {
      var before = G.hits;
      for (var i = 0; i < count; i++) { G._ownT0 -= 0.05; G.update(); }
      return G.hits - before;
    }
    var slow = walk(40);
    if (slow < 4) throw new Error('the scheduler planned no hits: ' + slow);
    // Упреждение не должно повторять уже запланированный шаг: с тем же временем
    // кадра _mark стоит на месте, и новые удары не появляются.
    G.update();
    var stable = G.hits;
    G.update(); G.update();
    if (G.hits !== stable) {
      throw new Error('lookahead repeated a scheduled step: ' + stable + ' -> ' + G.hits);
    }
    // Тот же отрезок на быстром темпе даёт больше ударов: темп — это сетка,
    // а не только подпись в панели.
    $('pGrooveBpm').value = '168';
    $('pGrooveBpm').dispatchEvent(new Event('input', { bubbles: true }));
    var fast = walk(40);
    if (!(fast > slow)) throw new Error('tempo does not change the grid: ' + slow + ' vs ' + fast);
    // Выключенный грув не планирует ничего и не двигает счётчик.
    $('grooveToggle').click();
    var off = walk(20);
    if (off !== 0 || G.update() !== false) throw new Error('the switched-off groove still plans');
    // Часы и темп возвращаем на место: следующие шаги видят обычный джем.
    G._ownT0 = performance.now() / 1000;
    G._mark = null;
    $('pGrooveBpm').value = '96';
    $('pGrooveBpm').dispatchEvent(new Event('input', { bubbles: true }));
  });

  step('en-pack', function () {
    // Английский — свой пакет (js/i18n.js), а не машинный перевод: словарь
    // точный, подсказки тоже переводятся, и всё работает без сети.
    if (!HARMONIA.I18N) throw new Error('I18N is missing from the public API');
    if (!HARMONIA.I18N.supports('en')) throw new Error('the English pack is not registered');
    if (HARMONIA.I18N.supports('de')) throw new Error('German must stay on Google Translate');
    if (HARMONIA.I18N.enabled()) throw new Error('the pack must be off by default');
  });

  step('en-switch', function () {
    // Тот же путь, что и выбор языка в меню: пакет включает translate.js.
    HARMONIA.Translate.apply('en');
    if (!HARMONIA.I18N.enabled()) throw new Error('the pack did not turn on');
    if (document.documentElement.lang !== 'en') throw new Error('html lang did not switch to en');
    if (!HARMONIA.usingLetterNames()) throw new Error('English must use the C-D-E notation');
    var st = HARMONIA.Translate.state();
    if (st.code !== 'en' || st.pack !== true) throw new Error('translate state is wrong: ' + JSON.stringify(st));
    if (st.loaded || st.ready) throw new Error('the English pack must not load the Google widget');
    if ($('comboSel').options[0].textContent.indexOf('Combo ') !== 0) {
      throw new Error('combo list is not English: ' + $('comboSel').options[0].textContent);
    }
    if (!/[A-G][♯♭]? (major|minor)/.test($('comboKey').textContent)) {
      throw new Error('combo key is not in Latin notation: ' + $('comboKey').textContent);
    }
  });

  step('en-labels', function () {
    // Доводим интерфейс до состояния, где подписей больше всего: форма,
    // пауза, тосты, запись, панель. Затем ищем забытые строки словаря.
    var melodyAtStart = String($('formResultMelody').innerHTML);
    HARMONIA.setDrawer('panel', true);
    Array.prototype.forEach.call(document.querySelectorAll('#panel details'), function (d) { d.open = true; });
    $('formBtn').click();
    HARMONIA.nextCombo();
    HARMONIA.setMode('minor');
    HARMONIA.startRecording();
    var target = HARMONIA.Composition.targetForBar(1);
    if (target) HARMONIA.chordEvent(target, 0.9, 'keys');
    HARMONIA.stopRecording(true);
    $('pauseBtn').click();
    HARMONIA.updateHUD();
    // Подписи, поставленные пачкой за один тик, доводим синхронно: в игре их
    // догоняет MutationObserver, но шаг харнесса не ждёт микро-задач.
    HARMONIA.I18N.refresh();
    var play = document.querySelector('#chordPad .chord-card');
    if (!play) throw new Error('chord pad is empty');

    var CYR = /[\u0400-\u04FF]/;
    var bad = [];
    function note(where, value) {
      if (bad.length < 8) bad.push(where + ': ' + String(value).trim().slice(0, 70));
    }
    if (CYR.test(document.title)) note('title', document.title);
    var walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          if (node.nodeType === 1) {
            var tag = node.nodeName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
            // Названия языков и сама нотация до-ре-ми — не текст интерфейса.
            if (node.hasAttribute('data-i18n-skip')) return NodeFilter.FILTER_REJECT;
            if (node.id === 'pMidiIn') return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    var node = walker.nextNode();
    while (node) {
      if (CYR.test(node.nodeValue)) {
        note('#' + ((node.parentNode && (node.parentNode.id || node.parentNode.className)) || '?'), node.nodeValue);
      }
      node = walker.nextNode();
    }
    Array.prototype.forEach.call(
      document.querySelectorAll('[title],[aria-label],[placeholder],[alt],[data-tip]'),
      function (el) {
        if (el.closest('[data-i18n-skip]') || el.id === 'pMidiIn') return;
        ['title', 'aria-label', 'placeholder', 'alt', 'data-tip'].forEach(function (name) {
          var value = el.getAttribute(name);
          if (value && CYR.test(value)) {
            note(name + ' #' + (el.id || el.className || el.nodeName), value);
          }
        });
      }
    );
    if (bad.length) {
      throw new Error('Russian text left in the English UI → ' + bad.join(' | ') +
        ' /// notation=' + HARMONIA.P.notation +
        ' atStart=' + melodyAtStart.slice(0, 90) +
        ' now=' + String($('formResultMelody').innerHTML).slice(0, 90));
    }
  });

  step('en-back-to-ru', function () {
    // Уход с пакета на машинный перевод/русский — перезагрузка (текст в DOM
    // уже английский). Проверяем только запись выбора: reload в харнессе
    // сломал бы прогон, поэтому apply('') не зовём.
    if (HARMONIA.I18N.lang() !== 'en') throw new Error('the pack forgot its language');
    if (HARMONIA.Translate.state().pack !== true) throw new Error('state lost the pack flag');
  });

  step('station-style', function () {
    // Характер станции меняет подачу (голоса, бас, октаву, тембр), но не ноты.
    // Шаг держит три инварианта: эталон на первой паре, различие соседей по
    // кругу и неизменный набор pitch class у каждого аккорда каждой станции.
    var H = HARMONIA, P = H.P;
    var S = H.STATION_STYLES;
    if (!S || S.length !== 12) throw new Error('expected twelve station characters');
    var axes = ['voicing', 'bass', 'register', 'touch'];
    var base = H.stationStyleAt(0);
    if (base.id !== 'neutral' || base.voicing !== 'closed' || base.bass !== 'nearest' ||
        base.register !== 0 || base.touch !== 'bell') {
      throw new Error('the first pair must sound exactly like before: ' + JSON.stringify(base));
    }
    var ids = S.map(function (s) { return s.id; });
    if (ids.filter(function (id, i) { return ids.indexOf(id) === i; }).length !== 12) {
      throw new Error('station ids are not unique');
    }
    S.forEach(function (s, i) {
      if (s.register !== 0 && s.register !== 12) {
        throw new Error('bad station octave: ' + s.register);
      }
      var prev = S[(i + S.length - 1) % S.length];
      var diff = axes.filter(function (k) { return prev[k] !== s[k]; }).length;
      if (diff < 2) {
        throw new Error('stations ' + ((i + S.length - 1) % S.length) + '/' + i +
          ' differ only in ' + diff + ' axis');
      }
    });
    // Подача не добавляет и не убирает ни одного pitch class: у каждого аккорда
    // каждой станции набор тот же, что у трезвучия {корень, терция, квинта}.
    var savedStyle = P.stationStyle, savedMode = H.state.mode, savedIdx = H.state.comboIdx;
    P.stationStyle = 'auto';
    ['major', 'minor'].forEach(function (mode) {
      H.state.mode = mode;
      H.ORDER[mode].forEach(function (id, idx) {
        H.state.comboIdx = idx;
        var style = H.stationStyleFor(idx);
        var T = 48 + H.COMBOS[id].root + style.register;
        if (H.rootMidi() !== T) throw new Error('the station octave is not applied to rootMidi');
        H.harmonicChords().forEach(function (h) {
          var offset = h.offset == null ? ((h.rootPc - (T % 12) + 12) % 12) : h.offset;
          var got = H.stationPadVoices(h, T, offset, style).map(function (v) {
            return ((v[0] - T) % 12 + 12) % 12;
          }).sort(function (a, b) { return a - b; }).join(',');
          var want = [offset, offset + (h.third == null ? 4 : h.third), offset + (h.fifth || 7)]
            .map(function (iv) {
              return ((iv % 12) + 12) % 12;
            }).sort(function (a, b) { return a - b; }).join(',');
          if (got !== want) {
            throw new Error('station ' + idx + ' (' + style.id + ') changed the pad chord: ' +
              got + ' vs ' + want);
          }
          // Бас остаётся в пределах октавы от тоники — низ не «уезжает».
          var bassOffset = H.stationBassOffset(h, offset, style);
          if (bassOffset < -12 || bassOffset > 12) {
            throw new Error('the bass left the octave: ' + bassOffset);
          }
          // На тонике fifth не должен звучать квинтой: возврат домой обязан
          // слышаться как возврат, а не как «пустой» аккорд.
          if (style.bass === 'fifth' && h.tonic && bassOffset !== offset) {
            throw new Error('fifth bass missed the tonic root: ' + bassOffset + ' vs ' + offset);
          }
        });
      });
    });
    // Мажор и минор одной пары — один характер: меняется лад, а не станция.
    H.state.mode = 'minor';
    H.state.comboIdx = 5;
    var minorStyle = H.stationStyleFor(5);
    H.state.mode = 'major';
    if (minorStyle !== H.stationStyleFor(5)) throw new Error('the mode changed the character');
    // Ручная подача нужна для прослушивания: neutral глушит характеры, id строки
    // закрепляет одну подачу на всех станциях, неизвестное значение — auto.
    if (H.setStationStyle('neutral') !== 'neutral') throw new Error('neutral was not accepted');
    if (H.stationStyleFor(6).id !== 'neutral') throw new Error('the neutral override did not apply');
    if (H.setStationStyle('felt') !== 'felt') throw new Error('felt was not accepted');
    if (H.stationStyleFor(6).touch !== 'felt') throw new Error('the felt override did not apply');
    if (H.setStationStyle('nonsense') !== 'auto') throw new Error('unknown style must fall back');
    H.state.comboIdx = savedIdx;
    H.state.mode = savedMode;
    P.stationStyle = savedStyle;
    // loadCombo пересобирает шары в октаве станции: регистр слышен и на сцене,
    // а не только в звуке. Пара 2 (ре мажор / си минор) поднята на октаву.
    H.state.mode = 'major';
    H.loadCombo(2, false);
    if (H.getBalls()[0].midi !== H.rootMidi()) {
      throw new Error('the balls are not in the station octave');
    }
    if (H.getBalls()[0].midi !== 48 + H.COMBOS[H.ORDER.major[2]].root + 12) {
      throw new Error('pair 2 must sound an octave higher');
    }
    H.loadCombo(0, false);
  });

  step('station-plot', function () {
    // Сюжет — надстройка над характером: фазы выбираются аккордами, подача
    // меняется, но набор pitch class и октава станции остаются прежними.
    var H = HARMONIA, P = H.P;
    if (!H.STATION_PLOT_ARCHETYPES || !H.STATION_PLOT_PHASES) {
      throw new Error('the station plot tables are missing');
    }
    if (P.stationPlot !== 'auto') throw new Error('the plot must be on by default');
    var savedPlot = P.stationPlot, savedStyle = P.stationStyle;
    var savedMode = H.state.mode, savedIdx = H.state.comboIdx;
    try {
      var home = { tonic: true, hint: 'тоника' };
      var dep = { hint: 'субдоминанта' };
      var turn = { hint: 'доминанта' };
      var shadow = { hint: 'медианта' };
      if (H.stationPlotForChord(dep, home) !== 'departure') throw new Error('subdominant must depart');
      if (H.stationPlotForChord(turn, dep) !== 'turn') throw new Error('dominant must turn');
      if (H.stationPlotForChord(shadow, turn) !== 'shadow') throw new Error('mediant must shadow');
      if (H.stationPlotForChord(home, turn) !== 'return') throw new Error('V-I must return');
      if (H.stationPlotForChord(home, dep) !== 'home') throw new Error('IV-I must come home');
      // Первая пара — эталон: сюжет её не меняет.
      P.stationPlot = 'auto';
      P.stationStyle = 'auto';
      H.state.mode = 'major';
      H.state.comboIdx = 0;
      H.stationPlotReset();
      if (H.stationPlotArchetype(0).id !== 'flat') throw new Error('pair 0 must stay flat');
      if (H.stationPlotWindowBias(0, 'departure') !== 0) throw new Error('flat must not bias the window');
      // Вторая пара — дрейф: поворот меняет и голоса, и бас, и просит окно шире.
      H.state.comboIdx = 1;
      H.stationPlotReset();
      var base = H.stationStyleFor(1);
      var turned = H.stationPlotStyle(1, 'turn');
      if (turned.voicing !== 'first' || turned.bass !== 'fifth') {
        throw new Error('the plot did not override the pair: ' + JSON.stringify(turned));
      }
      if (!(H.stationPlotWindowBias(1, 'departure') > 0)) {
        throw new Error('the departure phase did not widen the window');
      }
      // 'off' возвращает ровно базовую подачу и молчит в HUD.
      P.stationPlot = 'off';
      var off = H.stationPlotStyle(1, 'turn');
      if (off.voicing !== base.voicing || off.bass !== base.bass) {
        throw new Error('P.stationPlot=off changed the station');
      }
      if (H.stationPlotWindowBias(1, 'turn') !== 0) throw new Error('off still biases the window');
      if (H.stationPlotText() !== '') throw new Error('off still writes the HUD line');
      P.stationPlot = 'auto';
      // Любая фаза любого архетипа сохраняет pitch class и октаву станции.
      var phases = Object.keys(H.STATION_PLOT_PHASES);
      H.ORDER.major.forEach(function (id, idx) {
        H.state.comboIdx = idx;
        var baseStyle = H.stationStyleFor(idx);
        var T = 48 + H.COMBOS[id].root + baseStyle.register;
        H.harmonicChords().forEach(function (h) {
          var offset = h.offset == null ? ((h.rootPc - (T % 12) + 12) % 12) : h.offset;
          var want = [offset, offset + (h.third == null ? 4 : h.third), offset + (h.fifth || 7)]
            .map(function (iv) { return ((iv % 12) + 12) % 12; })
            .sort(function (a, b) { return a - b; }).join(',');
          phases.forEach(function (phase) {
            var style = H.stationPlotStyle(idx, phase);
            if (style.register !== baseStyle.register) {
              throw new Error('the plot changed the station octave');
            }
            var got = H.stationPadVoices(h, T, offset, style).map(function (v) {
              return ((v[0] - T) % 12 + 12) % 12;
            }).sort(function (a, b) { return a - b; }).join(',');
            if (got !== want) {
              throw new Error('plot ' + idx + ' ' + phase + ' changed the pad chord: ' + got + ' vs ' + want);
            }
            var bassOffset = H.stationBassOffset(h, offset, style);
            if (bassOffset < -12 || bassOffset > 12) {
              throw new Error('the plot bass left the octave: ' + bassOffset);
            }
            if (style.bass === 'fifth' && h.tonic && bassOffset !== offset) {
              throw new Error('the plot fifth missed the tonic root');
            }
          });
        });
      });
      // HUD показывает сюжет пары и скрывает его при off.
      H.state.comboIdx = 1;
      H.stationPlotReset();
      H.updateHUD();
      var el = $('stationPlot');
      if (!el || el.hidden) throw new Error('the plot HUD line is hidden');
      if (el.textContent.indexOf('дрейф') === -1) {
        throw new Error('the plot HUD line is wrong: ' + el.textContent);
      }
      P.stationPlot = 'off';
      H.updateHUD();
      if (!el.hidden) throw new Error('the plot HUD line stayed visible when off');
    } finally {
      P.stationPlot = savedPlot;
      P.stationStyle = savedStyle;
      H.state.mode = savedMode;
      H.state.comboIdx = savedIdx;
      H.stationPlotReset();
      H.loadCombo(0, false);
    }
  });

  step('station-gesture', function () {
    // Жест — только задержки атаки: ноты, октава и набор pitch class прежние.
    // Держим три инварианта: эталонный блок у пары 0, разные рисунки соседей,
    // A/B через P.stationGesture и раздачу задержек по высоте голосов.
    var H = HARMONIA, P = H.P;
    var G = H.STATION_GESTURES;
    if (!G || Object.keys(G).length !== 12) throw new Error('expected twelve station gestures');
    if (!G.neutral || G.neutral.delays.join(',') !== '0,0,0') {
      throw new Error('the first pair must keep the block attack');
    }
    if (P.stationGesture !== 'auto') throw new Error('the gesture layer must be on by default');
    var savedGesture = P.stationGesture;
    var savedMode = H.state.mode, savedIdx = H.state.comboIdx;
    try {
      H.state.mode = 'major';
      H.state.comboIdx = 0;
      var neutral = H.stationGesture(H.stationStyleFor(0));
      if (neutral.id !== 'block' || neutral.delays.join(',') !== '0,0,0') {
        throw new Error('pair 0 must stay a block chord');
      }
      // Соседние станции не должны совпадать по рисунку: иначе шаг по кругу
      // снова слышится как транспозиция.
      var seen = {};
      H.STATION_STYLES.forEach(function (s) {
        var g = H.stationGesture(s);
        if (seen[g.id]) throw new Error('two stations share the gesture ' + g.id);
        seen[g.id] = true;
      });
      // stationPadVoices отдаёт голоса не по высоте (first начинается с терции),
      // поэтому задержка раздаётся по отсортированным midi, а не по индексу.
      var voices = [[72, 1, 0], [60, 1, 0], [66, 1, 0]];
      var delays = H.stationVoiceDelays(voices, { id: 'wide' });
      if (delays.join(',') !== '90,0,45') {
        throw new Error('gesture delays are not sorted by pitch: ' + delays.join(','));
      }
      // Фаза сюжета меняет рисунок поверх характера.
      H.state.comboIdx = 1;
      H.stationPlotReset();
      var turned = H.stationPlotStyle(1, 'turn');
      var plotGesture = H.stationGesture(turned);
      if (plotGesture.id !== 'plot-turn' || plotGesture.delays.join(',') !== '85,40,0') {
        throw new Error('the plot phase did not change the gesture: ' + JSON.stringify(plotGesture));
      }
      // 'off' — прежний блок; 'auto' возвращает рисунок.
      if (H.setStationGesture('off') !== 'off') throw new Error('gesture off was not accepted');
      if (H.stationGestureDelays({ id: 'wide' }).join(',') !== '0,0,0') {
        throw new Error('P.stationGesture=off still delays voices');
      }
      H.setStationGesture('auto');
      if (H.stationGestureDelays({ id: 'wide' }).join(',') !== '0,45,90') {
        throw new Error('gesture auto did not come back');
      }
    } finally {
      P.stationGesture = savedGesture;
      H.state.mode = savedMode;
      H.state.comboIdx = savedIdx;
      H.stationPlotReset();
      H.loadCombo(0, false);
    }
  });

  step('guide-compass', function () {
    // Компас: 2–3 объяснимых хода, «Держать тепло» не сводится к V→I,
    // H пишет hintRequested/hintShown, клик — hintPicked, а цель такта
    // в пьесе имеет приоритет.
    var H = HARMONIA, G = H.Guide, R = H.research;
    if (!G) throw new Error('Guide API is missing');
    if (!R) throw new Error('research API is missing');
    R.enable();
    R.clear();
    if (H.state.form.enabled) H.setFormEnabled(false);
    if (!H.state.running) H.beginFromOverlay();
    if (H.state.paused) $('mResume').click();
    H.setMode('major');
    H.loadCombo(0, false);
    var tonic = H.diatonicPalette()[0];
    H.chordEvent(tonic, 0.8, 'keys');
    if (!G.request()) throw new Error('H did not request the compass');
    var st = G.state();
    if (!st.open) throw new Error('the compass did not open');
    if (st.moves.length < 2 || st.moves.length > 3) {
      throw new Error('the compass must show 2–3 moves, got ' + st.moves.length);
    }
    var hold = st.moves.filter(function (m) { return m.role === 'hold'; })[0];
    if (!hold) throw new Error('the compass has no Hold move');
    if (hold.degree === 'V') throw new Error('Hold must not default to V→I');
    if (['IV', 'ii', 'vi', 'iii'].indexOf(hold.degree) === -1) {
      throw new Error('Hold did not keep the warm field: ' + hold.degree);
    }
    // События подсказок живут в визите; закрываем его, чтобы exportData видел данные.
    R.leaveCombo('guide');
    var data = R.exportData();
    var seg = data.segments[data.segments.length - 1];
    if (!seg || !seg.hints || seg.hints.requested < 1 || seg.hints.shown < 1) {
      throw new Error('hint events were not recorded: ' + JSON.stringify(seg && seg.hints));
    }
    // Клик по подсказке играет тот же аккорд и пишет hintPicked.
    H.loadCombo(0, false);
    H.chordEvent(tonic, 0.8, 'keys');
    G.request();
    st = G.state();
    var picked = st.moves[0];
    if (!picked) throw new Error('the compass lost its moves');
    if (!G.pick(0)) throw new Error('clicking a hint did not play the chord');
    R.leaveCombo('guide');
    data = R.exportData();
    seg = data.segments[data.segments.length - 1];
    if (!seg || !seg.hints || seg.hints.picked < 1) {
      throw new Error('hintPicked was not recorded');
    }
    // В пьесе цель такта важнее свободного ранжирования.
    H.loadCombo(0, false);
    H.chordEvent(tonic, 0.8, 'keys');
    var saved = {
      enabled: H.state.form.enabled, running: H.state.form.running,
      phase: H.state.form.phase, bar: H.state.form.bar
    };
    H.state.form.enabled = true;
    H.state.form.running = true;
    H.state.form.phase = 'playing';
    H.state.form.bar = 8;
    H.updateHUD();
    G.request();
    var targetMove = G.state().moves.filter(function (m) { return m.target; })[0];
    if (!targetMove || targetMove.degree !== 'ii') {
      throw new Error('the piece target did not lead the compass: ' +
        (targetMove && targetMove.degree));
    }
    H.state.form.enabled = saved.enabled;
    H.state.form.running = saved.running;
    H.state.form.phase = saved.phase;
    H.state.form.bar = saved.bar;
    H.updateHUD();
    R.clear();
  });

  step('research-rating', function () {
    // Исследование включено по умолчанию: проверяем это, затем выключаем и
    // очищаем, чтобы проверить запись посещений, карточку оценки и отсутствие
    // попапа на ручных переходах. В конце — выключаем и очищаем localStorage.
    var H = HARMONIA, R = H.research;
    if (!R) throw new Error('research API is missing');
    if (!R.status().enabled) throw new Error('research must be on by default');
    if (R.status().version !== 2) throw new Error('research settings version is wrong');
    R.disable();
    R.clear();
    if (R.status().enabled || R.status().visits) throw new Error('research must start empty');
    if (H.state.form.enabled) H.setFormEnabled(false);
    if (!H.state.running) H.beginFromOverlay();
    // setPaused() не входит в публичный API — кнопка паузы делает то же самое.
    if (H.state.paused) $('mResume').click();
    H.setMode('major');
    H.loadCombo(0, false);

    R.enable();
    if (!R.status().enabled) throw new Error('research did not turn on');
    if ($('researchBody').hidden) throw new Error('the research panel body stays hidden');
    if ($('researchToggle').getAttribute('aria-pressed') !== 'true') {
      throw new Error('the research toggle did not follow the state');
    }
    // Вход в комбо случился до включения — заходим снова, чтобы сегмент открылся.
    H.loadCombo(0, false);

    var chord = H.harmonicChords()[0];
    H.chordEvent(chord, 0.8, 'keys');
    H.pressCode('KeyJ', 0.8);
    H.releaseCode('KeyJ');
    H.state.score = H.CFG.comboAdvanceAt;
    H.updateHUD();
    if (H.advanceCombo() !== true) throw new Error('Space advance did not happen');

    var ask = $('researchAsk');
    if (!ask.classList.contains('show')) throw new Error('the rating card did not open on Space');
    if (ask.getAttribute('aria-hidden') !== 'false') {
      throw new Error('the rating card is hidden from screen readers');
    }
    // Карточка знает точную авто-запись этого визита и умеет отдать её видео.
    var askData = R.exportData();
    var askSeg = askData.segments[askData.segments.length - 1];
    if (!askSeg || !askSeg.recordingId) {
      throw new Error('the visit has no linked auto-recording');
    }
    var askRec = H.recordingById(askSeg.recordingId);
    if (!askRec || askRec.id !== askSeg.recordingId || !askRec.auto) {
      throw new Error('the linked auto-recording cannot be found');
    }
    // Панель записи: выбранная дорожка + её связанный визит в одном JSON.
    var recList = $('recList');
    var recJsonBtn = $('recJson');
    if (!recList || !recJsonBtn) throw new Error('the recording JSON UI is missing');
    recList.value = askRec.id;
    recList.dispatchEvent(new Event('change', { bubbles: true }));
    if (recJsonBtn.disabled) {
      throw new Error('the recording JSON button is disabled with a ready recording');
    }
    var recJson = R.exportRecordingData(askRec, [askSeg]);
    if (recJson.exportScope !== 'recording' || !recJson.recording ||
        recJson.recording.id !== askRec.id) {
      throw new Error('the recording JSON lost its recording');
    }
    if (!Array.isArray(recJson.segments) || recJson.segments.length !== 1 ||
        recJson.segments[0].id !== askSeg.id) {
      throw new Error('the recording JSON lost its linked visit');
    }
    if (recJson.recordingMissing) {
      throw new Error('a linked recording was marked missing');
    }
    var recJsonName = R.recordingJsonName(askRec);
    if (!recJsonName || recJsonName.slice(-5) !== '.json') {
      throw new Error('the recording JSON filename is wrong: ' + recJsonName);
    }
    if (R.exportRecordingData(askRec, []).segments.length !== 0) {
      throw new Error('manual recordings must keep an empty segments array');
    }
    var videoBtn = $('researchAskVideo');
    if (!videoBtn) throw new Error('the rating card has no video button');
    var jsonBtn = $('researchAskJson');
    if (!jsonBtn) throw new Error('the rating card has no JSON button');
    if (jsonBtn.disabled) {
      throw new Error('the rating card JSON button is disabled with a visit');
    }
    var audioBtn = $('researchAskAudio');
    if (!audioBtn) throw new Error('the rating card has no audio button');
    if (H.audioSupported() && audioBtn.disabled) {
      throw new Error('the rating card audio button is disabled with a ready recording');
    }
    if (!H.audioSupported() && !audioBtn.disabled) {
      throw new Error('the rating card audio button ignores browser support');
    }
    if (H.videoSupported() && videoBtn.disabled) {
      throw new Error('the rating card video button is disabled with a ready recording');
    }
    if (!H.videoSupported() && !videoBtn.disabled) {
      throw new Error('the rating card video button ignores browser support');
    }
    // J = 5: пока карточка открыта, клавиша оценивает, а не играет ноту.
    // После оценки карточка остаётся открытой, чтобы успеть сохранить файлы.
    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyJ', key: 'j', bubbles: true, cancelable: true
    }));
    if (!ask.classList.contains('show')) throw new Error('J closed the rating card');
    if ($('researchAskTitle').textContent.indexOf('5/5') === -1) {
      throw new Error('the rated card lost its score label');
    }
    if ($('researchAskSkip').textContent !== 'Готово') {
      throw new Error('the rated card did not switch Skip to Done');
    }
    if (H.videoSupported() && videoBtn.disabled) {
      throw new Error('the video button became disabled after the rating');
    }
    if (H.audioSupported() && audioBtn.disabled) {
      throw new Error('the audio button became disabled after the rating');
    }
    if (jsonBtn.disabled) {
      throw new Error('the JSON button became disabled after the rating');
    }
    var data = R.exportData();
    var seg = data.segments[data.segments.length - 1];
    if (!seg) throw new Error('the visit was not saved');
    if (!seg.rating || seg.rating.score !== 5) {
      throw new Error('the rating was not stored: ' + JSON.stringify(seg.rating));
    }
    // Файл одного визита — тот же сегмент и его автозапись, но без всей истории.
    var visitJson = R.exportVisitData(seg, askRec);
    if (visitJson.exportScope !== 'visit') {
      throw new Error('the visit JSON has the wrong scope: ' + visitJson.exportScope);
    }
    if (!Array.isArray(visitJson.segments) || visitJson.segments.length !== 1 ||
        visitJson.segments[0].id !== seg.id) {
      throw new Error('the visit JSON must contain exactly the rated visit');
    }
    if (!visitJson.segments[0].rating || visitJson.segments[0].rating.score !== 5) {
      throw new Error('the visit JSON lost the rating');
    }
    if (visitJson.segments[0].events.length !== seg.events.length) {
      throw new Error('the visit JSON lost events');
    }
    if (!visitJson.recording || visitJson.recording.id !== askRec.id) {
      throw new Error('the visit JSON lost the linked recording');
    }
    if (visitJson.recordingMissing) {
      throw new Error('the visit JSON marked its recording as missing');
    }
    var visitName = R.visitFileName(seg);
    if (!/^harmonia-combo-\d{2}-[a-z0-9-]+-\d{8}-\d{6}\.json$/.test(visitName)) {
      throw new Error('the visit JSON filename is wrong: ' + visitName);
    }
    var missingJson = R.exportVisitData(seg, null);
    if (!missingJson.recordingMissing || missingJson.recording !== null) {
      throw new Error('a lost recording was not marked missing');
    }
    $('researchAskSkip').click();
    if (ask.classList.contains('show')) throw new Error('Done did not close the rated card');
    data = R.exportData();
    seg = data.segments[data.segments.length - 1];
    if (!seg.rating || seg.rating.score !== 5 || seg.rating.skipped) {
      throw new Error('Done overwrote the saved rating with a skip');
    }
    if (seg.exit.via !== 'space') throw new Error('exit.via is not space: ' + seg.exit.via);
    if (seg.score !== H.CFG.comboAdvanceAt) {
      throw new Error('the score at exit was not captured: ' + seg.score);
    }
    if (!(seg.dwellMs >= 0) || !(seg.playMs >= 0)) {
      throw new Error('dwell/play timing is missing');
    }
    var types = seg.events.map(function (e) { return e.type; });
    if (types.indexOf('chord') === -1 || types.indexOf('note') === -1) {
      throw new Error('the visit lost its chords/notes: ' + types.join(','));
    }
    // Журнал сюжета пишется вместе с посещением: архетип, фазы и переходы.
    if (!seg.plot || seg.plot.archetype !== 'flat') {
      throw new Error('the visit plot log is missing: ' + JSON.stringify(seg.plot));
    }
    if (!seg.plot.phaseSeq || !seg.plot.phaseSeq.length ||
        !seg.plot.phases || !Object.keys(seg.plot.phases).length) {
      throw new Error('the visit plot has no phase data');
    }
    var chordEvents = seg.events.filter(function (e) { return e.type === 'chord'; });
    if (!chordEvents.length || !chordEvents[0].phase ||
        !Array.isArray(chordEvents[0].window)) {
      throw new Error('the chord event lost its plot snapshot');
    }
    if (chordEvents[0].source !== 'keys') {
      throw new Error('the chord event lost its source: ' + chordEvents[0].source);
    }
    var noteEvents = seg.events.filter(function (e) { return e.type === 'note'; });
    if (!noteEvents.length || noteEvents[0].source !== 'keys') {
      throw new Error('the note event lost its source: ' +
        (noteEvents.length ? noteEvents[0].source : 'no notes'));
    }
    if (!seg.combo || !seg.station || !seg.context) {
      throw new Error('the visit lost its context');
    }
    if (!data.stationStyles || data.stationStyles.length !== 12) {
      throw new Error('the export must embed the station table');
    }
    if (!data.combos || !data.combos.major || !data.combos.minor) {
      throw new Error('the export must embed the combo library');
    }
    if (!data.stationTouch || !data.stationTouch.bell) {
      throw new Error('the export must embed the station touch table');
    }
    // Ручной переход закрывает посещение, но карточку не открывает.
    H.chordEvent(chord, 0.8, 'keys');
    H.state.score = H.CFG.comboAdvanceAt;
    H.nextCombo();
    if (ask.classList.contains('show')) throw new Error('a manual transition opened the rating card');
    var visits = R.status().visits;
    if (visits < 2) throw new Error('the manual transition did not save the visit');

    // Replay не пишется: сегмент без событий отбрасывается.
    H.state.replay = true;
    H.chordEvent(chord, 0.8, 'replay');
    H.state.replay = false;
    H.nextCombo();
    if (R.status().visits !== visits) throw new Error('replay created a visit');

    // Комментарий: поле забирает буквы, а рейтинг сохраняет текст.
    H.chordEvent(chord, 0.8, 'keys');
    H.state.score = H.CFG.comboAdvanceAt;
    H.advanceCombo();
    if (!ask.classList.contains('show')) throw new Error('the rating card did not reopen');
    var field = $('researchAskComment');
    field.focus();
    field.value = 'мягко и тепло';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    // Пока поле в фокусе, O — это буква, а не оценка 3.
    field.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyO', key: 'o', bubbles: true, cancelable: true
    }));
    if (!ask.classList.contains('show')) {
      throw new Error('typing in the comment field submitted the card');
    }
    // Уходим из поля и ставим оценку мышью: комментарий сохраняется с ней.
    field.blur();
    ask.querySelector('[data-score="3"]').click();
    if (!ask.classList.contains('show')) throw new Error('the mouse rating closed the card');
    data = R.exportData();
    seg = data.segments[data.segments.length - 1];
    if (!seg.rating || seg.rating.score !== 3) throw new Error('the mouse rating was not stored');
    if (seg.rating.comment !== 'мягко и тепло') {
      throw new Error('the comment was not stored: ' + seg.rating.comment);
    }
    // Закрываем уже оценённую карточку кнопкой «Готово».
    $('researchAskSkip').click();
    if (ask.classList.contains('show')) throw new Error('Done did not close the mouse-rated card');

    // Esc пропускает: посещение остаётся, но без оценки.
    H.chordEvent(chord, 0.8, 'keys');
    H.state.score = H.CFG.comboAdvanceAt;
    H.advanceCombo();
    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'Escape', key: 'Escape', bubbles: true, cancelable: true
    }));
    data = R.exportData();
    seg = data.segments[data.segments.length - 1];
    if (!seg.rating || !seg.rating.skipped || seg.rating.score !== null) {
      throw new Error('Esc did not skip the rating');
    }

    // «Сессия заново» закрывает визит с реальным счётом, а не с нулём:
    // startSession сбрасывает state.score уже после закрытия сегмента.
    H.chordEvent(chord, 0.8, 'keys');
    H.state.score = H.CFG.comboAdvanceAt;
    H.startSession();
    data = R.exportData();
    seg = data.segments[data.segments.length - 1];
    if (seg.exit.via !== 'session') throw new Error('restart exit.via is not session: ' + seg.exit.via);
    if (seg.score !== H.CFG.comboAdvanceAt) {
      throw new Error('restart lost the score at exit: ' + seg.score);
    }

    // Закрытие вкладки (pagehide) сохраняет уже сыгранный визит.
    H.chordEvent(chord, 0.8, 'keys');
    H.state.score = H.CFG.comboAdvanceAt;
    window.dispatchEvent(new Event('pagehide'));
    data = R.exportData();
    seg = data.segments[data.segments.length - 1];
    if (seg.exit.via !== 'unload') throw new Error('pagehide exit.via is not unload: ' + seg.exit.via);
    if (seg.score !== H.CFG.comboAdvanceAt) {
      throw new Error('pagehide lost the score at exit: ' + seg.score);
    }

    // Панель: выключение прячет тело и оставляет данные.
    var saved = R.status().visits;
    R.disable();
    if (R.status().enabled) throw new Error('research did not turn off');
    if (!$('researchBody').hidden) throw new Error('the research panel body stayed visible');
    if (R.status().visits !== saved) throw new Error('disabling dropped the data');
    R.clear();
    if (R.status().visits !== 0) throw new Error('clear did not remove the visits');
    if ($('researchAsk').classList.contains('show')) throw new Error('the rating card stayed open');
  });

  check('console-errors', window.__smokeErrors.length === 0, window.__smokeErrors.join(' | '));
  var failed = results.filter(function (r) { return !r.ok; });
  document.body.innerHTML = '<pre id="smoke-result">' + JSON.stringify({
    ok: failed.length === 0,
    failed: failed,
    passed: results.filter(function (r) { return r.ok; }).map(function (r) { return r.name; }),
    errors: window.__smokeErrors
  }) + '</pre>';
})();
</script>
'@
$html = $html.Replace('<script src="js/util.js"></script>', $pre + '<script src="js/util.js"></script>')
$html = $html.Replace('</body>', $post + '</body>')
[IO.File]::WriteAllText((Join-Path $PWD 'smoke.html'), $html, (New-Object Text.UTF8Encoding($false)))

# ===== Англоязычная страница (en/index.html) =====
# Это не приложение, а статичный обзор: у него нет ни одного скрипта, поэтому
# проверки здесь про разметку, кластер hreflang и соответствие FAQ-разметки
# видимому тексту. Отчёт кладётся в en/smoke.html — рядом с исходником, чтобы
# относительные пути ../css и ../docs работали так же, как на GitHub Pages.
$enSource = Join-Path $PWD 'en/index.html'
if (-not (Test-Path $enSource)) { throw 'en/index.html is missing' }
$enHtml = [IO.File]::ReadAllText($enSource, [Text.Encoding]::UTF8)
$enPost = @'
<script>
(function () {
  var results = [];
  function check(name, cond, extra) {
    results.push({ name: name, ok: !!cond, extra: extra == null ? '' : String(extra) });
  }
  function step(name, fn) {
    try { fn(); check(name, true); }
    catch (e) { check(name, false, (e && e.stack) || e); }
  }
  function attr(sel, name) {
    var el = document.querySelector(sel);
    return el ? el.getAttribute(name) : null;
  }
  function meta(sel) {
    var el = document.querySelector(sel);
    return el ? el.content : null;
  }
  var BASE = 'https://godspace.github.io/HARMONIA/';

  step('lang', function () {
    if (document.documentElement.lang !== 'en') throw new Error('html lang is not en');
  });

  step('head', function () {
    if (document.title.indexOf('HARMONIA') === -1) throw new Error('page title lost the name');
    if (document.title.indexOf('COMBOLIST') !== -1) throw new Error('COMBOLIST is in the page title');
    var desc = meta('meta[name="description"]');
    if (!desc || desc.length < 80) throw new Error('meta description is missing or too short');
    var robots = meta('meta[name="robots"]');
    if (!robots || robots.indexOf('index') === -1) throw new Error('robots meta is missing');
    var canonical = attr('link[rel="canonical"]', 'href');
    if (canonical !== BASE + 'en/') throw new Error('canonical URL is missing or wrong: ' + canonical);
    if (attr('link[rel="icon"]', 'href') !== '../favicon.svg') throw new Error('favicon is missing');
  });

  step('hreflang', function () {
    var alts = {};
    Array.prototype.forEach.call(
      document.querySelectorAll('link[rel="alternate"][hreflang]'),
      function (l) { alts[l.getAttribute('hreflang')] = l.getAttribute('href'); }
    );
    if (alts.en !== BASE + 'en/') throw new Error('hreflang en must point at this page');
    if (alts.ru !== BASE) throw new Error('hreflang ru is missing or wrong');
    if (alts['x-default'] !== BASE) throw new Error('hreflang x-default is missing or wrong');
  });

  step('social', function () {
    if (meta('meta[property="og:locale"]') !== 'en_US') throw new Error('og:locale is not en_US');
    if (meta('meta[property="og:url"]') !== BASE + 'en/') throw new Error('og:url is wrong');
    if (meta('meta[property="og:type"]') !== 'website') throw new Error('og:type is wrong');
    var img = meta('meta[property="og:image"]');
    if (!img || img.indexOf('/docs/screenshot-en.png') === -1) {
      throw new Error('og:image must use the English screenshot');
    }
    var twImg = meta('meta[name="twitter:image"]');
    if (!twImg || twImg.indexOf('/docs/screenshot-en.png') === -1) {
      throw new Error('twitter:image must use the English screenshot');
    }
    if (!meta('meta[property="og:image:alt"]')) throw new Error('og:image:alt is missing');
    if ((meta('meta[name="twitter:card"]') || '') !== 'summary_large_image') {
      throw new Error('twitter card is missing');
    }
  });

  step('json-ld', function () {
    var ld = document.querySelector('script[type="application/ld+json"]');
    if (!ld) throw new Error('JSON-LD is missing');
    var data = JSON.parse(ld.textContent);
    var nodes = (data['@graph'] || [data]);
    function findType(type) {
      return nodes.filter(function (n) { return n['@type'] === type; })[0];
    }
    var app = findType('WebApplication');
    if (!app || app.name !== 'HARMONIA') throw new Error('WebApplication node is missing');
    if (app.inLanguage !== 'en') throw new Error('WebApplication is not in English');
    if (app.url !== BASE + 'en/') throw new Error('WebApplication url is wrong');
    if (app.screenshot !== BASE + 'docs/screenshot-en.png') {
      throw new Error('WebApplication screenshot must be the English one');
    }
    if (app.offers && app.offers.price !== '0') throw new Error('the offer is not free');
    var faq = findType('FAQPage');
    if (!faq || !faq.mainEntity || faq.mainEntity.length < 5) {
      throw new Error('FAQPage node is missing or too short');
    }
    // Google считает разметку несоответствующей, если вопросов нет в тексте.
    var visible = Array.prototype.map.call(
      document.querySelectorAll('.faq summary'),
      function (s) { return s.textContent.trim(); }
    );
    faq.mainEntity.forEach(function (q) {
      if (visible.indexOf(q.name) === -1) throw new Error('FAQ question is not visible: ' + q.name);
      if (!q.acceptedAnswer || !q.acceptedAnswer.text) {
        throw new Error('FAQ answer is empty: ' + q.name);
      }
    });
  });

  step('content', function () {
    var h1 = document.querySelectorAll('h1');
    if (h1.length !== 1) throw new Error('the page must have exactly one h1');
    if (h1[0].textContent.indexOf('HARMONIA') === -1) throw new Error('h1 lost the name');
    if (document.querySelectorAll('main section').length < 5) {
      throw new Error('too few sections: the page is not a real landing');
    }
    // Оба сценария должны остаться на странице: запись → WAV → Suno и роль пробела.
    if (!document.getElementById('suno')) throw new Error('the Suno section is missing');
    if (!document.getElementById('space')) throw new Error('the Space explainer is missing');
    var cta = document.querySelector('a.cta[href="../index.html?lang=en"]');
    if (!cta) throw new Error('the CTA must open the simulator with ?lang=en');
    var ru = document.querySelector('a[href="../"][hreflang="ru"]');
    if (!ru) throw new Error('link back to the Russian version is missing');
    var img = document.querySelector('figure.shot img');
    if (!img || !img.getAttribute('alt') || img.getAttribute('alt').length < 40) {
      throw new Error('the screenshot needs a descriptive alt');
    }
    // Английская страница показывает английский интерфейс: своя картинка, а не
    // русская с оговоркой в подписи.
    if (img.getAttribute('src') !== '../docs/screenshot-en.png') {
      throw new Error('the English page must show the English screenshot');
    }
    if (img.getAttribute('alt').indexOf('English') === -1) {
      throw new Error('the English screenshot needs an alt that says so');
    }
    if (img.getAttribute('width') !== '1600' || img.getAttribute('height') !== '1000') {
      throw new Error('screenshot size is missing');
    }
  });

  step('no-scripts', function () {
    // Лендинг обязан оставаться статичным: виджет перевода и аналитика живут
    // только на странице игры.
    if (document.querySelectorAll('script[src]').length !== 0) {
      throw new Error('the landing page must not load external scripts');
    }
    if (document.getElementById('google_translate_element')) {
      throw new Error('the translate widget must not be mounted on the landing page');
    }
  });

  check('console-errors', window.__enSmokeErrors.length === 0, window.__enSmokeErrors.join(' | '));
  var failed = results.filter(function (r) { return !r.ok; });
  document.body.innerHTML = '<pre id="smoke-result">' + JSON.stringify({
    ok: failed.length === 0,
    failed: failed,
    passed: results.filter(function (r) { return r.ok; }).map(function (r) { return r.name; }),
    errors: window.__enSmokeErrors
  }) + '</pre>';
})();
</script>
'@
$enPre = @'
<script>
window.__enSmokeErrors = [];
window.addEventListener('error', function (e) {
  window.__enSmokeErrors.push('error: ' + (e.message || e.type));
});
window.addEventListener('unhandledrejection', function (e) {
  window.__enSmokeErrors.push('rejection: ' + String(e.reason));
});
</script>
'@
$enHtml = $enHtml.Replace('</body>', $enPre + $enPost + '</body>')
[IO.File]::WriteAllText((Join-Path $PWD 'en/smoke.html'), $enHtml, (New-Object Text.UTF8Encoding($false)))

# ===== Русская страница о проекте (ru/index.html) =====
# Тот же принцип, что у английской: статичный обзор без скриптов. Проверяем
# адреса, ссылки на симулятор и английскую версию, а также совпадение
# FAQ-разметки с видимыми вопросами. Отчёт — ru/smoke.html, рядом с исходником,
# чтобы относительные пути ../css и ../docs работали как на GitHub Pages.
$ruSource = Join-Path $PWD 'ru/index.html'
if (-not (Test-Path $ruSource)) { throw 'ru/index.html is missing' }
$ruHtml = [IO.File]::ReadAllText($ruSource, [Text.Encoding]::UTF8)
$ruPost = @'
<script>
(function () {
  var results = [];
  function check(name, cond, extra) {
    results.push({ name: name, ok: !!cond, extra: extra == null ? '' : String(extra) });
  }
  function step(name, fn) {
    try { fn(); check(name, true); }
    catch (e) { check(name, false, (e && e.stack) || e); }
  }
  function attr(sel, name) {
    var el = document.querySelector(sel);
    return el ? el.getAttribute(name) : null;
  }
  function meta(sel) {
    var el = document.querySelector(sel);
    return el ? el.content : null;
  }
  var BASE = 'https://godspace.github.io/HARMONIA/';

  step('lang', function () {
    if (document.documentElement.lang !== 'ru') throw new Error('html lang is not ru');
  });

  step('head', function () {
    if (document.title.indexOf('HARMONIA') === -1) throw new Error('page title lost the name');
    if (document.title.indexOf('COMBOLIST') !== -1) throw new Error('COMBOLIST is in the page title');
    var desc = meta('meta[name="description"]');
    if (!desc || desc.length < 80) throw new Error('meta description is missing or too short');
    var robots = meta('meta[name="robots"]');
    if (!robots || robots.indexOf('index') === -1) throw new Error('robots meta is missing');
    if (attr('link[rel="canonical"]', 'href') !== BASE + 'ru/') {
      throw new Error('canonical URL is missing or wrong: ' + attr('link[rel="canonical"]', 'href'));
    }
    if (attr('link[rel="icon"]', 'href') !== '../favicon.svg') throw new Error('favicon is missing');
    if (meta('meta[property="og:locale"]') !== 'ru_RU') throw new Error('og:locale is not ru_RU');
    if (meta('meta[property="og:url"]') !== BASE + 'ru/') throw new Error('og:url is wrong');
    var img = meta('meta[property="og:image"]');
    if (!img || img.indexOf('/docs/screenshot.png') === -1) throw new Error('og:image is missing');
  });
  step('links', function () {
    // Страница ведёт к симулятору (в исходном языке страницы) и к английскому
    // обзору; обратно её видно из панели настроек и подвала en/index.html.
    if (!document.querySelector('a.cta[href="../index.html"]')) {
      throw new Error('the CTA must open the simulator');
    }
    if (!document.querySelector('a[href="../en/"][hreflang="en"]')) {
      throw new Error('link to the English overview is missing');
    }
    var fig = document.querySelector('figure.shot img');
    if (!fig || !fig.getAttribute('alt') || fig.getAttribute('alt').length < 40) {
      throw new Error('the screenshot needs a descriptive alt');
    }
    if (fig.getAttribute('src') !== '../docs/screenshot.png') throw new Error('screenshot path is wrong');
    if (fig.getAttribute('width') !== '1600' || fig.getAttribute('height') !== '1000') {
      throw new Error('screenshot size is missing');
    }
  });

  step('content', function () {
    var h1 = document.querySelectorAll('h1');
    if (h1.length !== 1) throw new Error('the page must have exactly one h1');
    if (h1[0].textContent.indexOf('HARMONIA') === -1) throw new Error('h1 lost the name');
    if (document.querySelectorAll('main section').length < 5) {
      throw new Error('too few sections: the page is not a real overview');
    }
    if (document.querySelectorAll('.faq details').length < 5) {
      throw new Error('the FAQ is too short');
    }
    // Русский обзор повторяет оба сценария: Suno и объяснение пробела.
    if (!document.getElementById('suno')) throw new Error('the Suno section is missing');
    if (!document.getElementById('space')) throw new Error('the Space explainer is missing');
  });

  step('json-ld', function () {
    var ld = document.querySelector('script[type="application/ld+json"]');
    if (!ld) throw new Error('JSON-LD is missing');
    var data = JSON.parse(ld.textContent);
    var nodes = (data['@graph'] || [data]);
    function findType(type) {
      return nodes.filter(function (n) { return n['@type'] === type; })[0];
    }
    var app = findType('WebApplication');
    if (!app || app.name !== 'HARMONIA') throw new Error('WebApplication node is missing');
    if (app.inLanguage !== 'ru') throw new Error('WebApplication is not in Russian');
    if (app.url !== BASE + 'ru/') throw new Error('WebApplication url is wrong');
    if (app.offers && app.offers.price !== '0') throw new Error('the offer is not free');
    var faq = findType('FAQPage');
    if (!faq || !faq.mainEntity || faq.mainEntity.length < 5) {
      throw new Error('FAQPage node is missing or too short');
    }
    var visible = Array.prototype.map.call(
      document.querySelectorAll('.faq summary'),
      function (s) { return s.textContent.trim(); }
    );
    faq.mainEntity.forEach(function (q) {
      if (visible.indexOf(q.name) === -1) throw new Error('FAQ question is not visible: ' + q.name);
      if (!q.acceptedAnswer || !q.acceptedAnswer.text) {
        throw new Error('FAQ answer is empty: ' + q.name);
      }
    });
  });

  step('no-scripts', function () {
    if (document.querySelectorAll('script[src]').length !== 0) {
      throw new Error('the overview page must not load external scripts');
    }
    if (document.getElementById('google_translate_element')) {
      throw new Error('the translate widget must not be mounted on the overview page');
    }
  });

  check('console-errors', window.__ruSmokeErrors.length === 0, window.__ruSmokeErrors.join(' | '));
  var failed = results.filter(function (r) { return !r.ok; });
  document.body.innerHTML = '<pre id="smoke-result">' + JSON.stringify({
    ok: failed.length === 0,
    failed: failed,
    passed: results.filter(function (r) { return r.ok; }).map(function (r) { return r.name; }),
    errors: window.__ruSmokeErrors
  }) + '</pre>';
})();
</script>
'@
$ruPre = @'
<script>
window.__ruSmokeErrors = [];
window.addEventListener('error', function (e) {
  window.__ruSmokeErrors.push('error: ' + (e.message || e.type));
});
window.addEventListener('unhandledrejection', function (e) {
  window.__ruSmokeErrors.push('rejection: ' + String(e.reason));
});
</script>
'@
$ruHtml = $ruHtml.Replace('</body>', $ruPre + $ruPost + '</body>')
[IO.File]::WriteAllText((Join-Path $PWD 'ru/smoke.html'), $ruHtml, (New-Object Text.UTF8Encoding($false)))
Write-Host 'smoke.html, en/smoke.html and ru/smoke.html are built'

