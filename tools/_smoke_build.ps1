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
    if ($('chordPad').nextElementSibling !== $('spaceNext')) {
      throw new Error('Space button is not directly under the chord chips');
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
    if (!st.ready || st.starting) throw new Error('ten keys must arm Space without starting');
    if (count.textContent.indexOf('10 / 10') === -1) throw new Error('intro counter did not finish: ' + count.textContent);
    if (!overlay.classList.contains('ready')) throw new Error('start overlay must arm Space after the drill');
    if (overlay.classList.contains('fade')) throw new Error('start overlay must wait for Space');
    if (document.querySelectorAll('#startOverlay .kb-key.hit').length !== 10) {
      throw new Error('pressed keys are not marked on the keyboard');
    }
    // Пробел — не подсказка, а единственный путь дальше: клавиша на схеме
    // подсвечена и подписана «начать», а строка инструкции сменилась.
    var spaceKey = document.querySelector('#startOverlay .kb-space[data-key="Space"]');
    if (!spaceKey) throw new Error('the intro Space key is not wired for the start');
    if (window.getComputedStyle(document.querySelector('#startOverlay .ip-after')).display === 'none') {
      throw new Error('Space prompt is hidden after the drill');
    }
    if (window.getComputedStyle(document.querySelector('#startOverlay .ip-before')).display !== 'none') {
      throw new Error('drill prompt must give way to the Space prompt');
    }
    if (HARMONIA.state.started) throw new Error('drill must not start the session without Space');
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
