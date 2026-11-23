/* HARMONIA · js/input.js — клавиатура, мышь, кнопки интерфейса, стартовый экран
   Модуль без сборки: подключается <script> в index.html до main.js.
   Все модули делят глобальную область — имена функций/констант уникальны. */

// ===== Ввод: клавиатура =====
// Команды (Enter / Backspace / стрелки / M / C / Esc / 0 / Space) живут в INPUT.commands —
// их же сможет вызывать MIDI-контроллер или экранная кнопка.
function runCommand(id) {
  switch (id) {
    case 'next': if (state.started && state.running) nextCombo(); break;
    case 'prev': if (state.started && state.running) prevCombo(); break;
    // Space — не педаль, а переход в новое комбо после рубежа счёта.
    case 'comboAdvance': advanceCombo(); break;
    // Enter — барабаны: тот же слой, что и кнопка панели, но под рукой.
    // На стартовом экране Enter перехватывает проба (introPress), поэтому
    // здесь команда работает уже в сессии.
    case 'groove': if (state.started) toggleGroove(); break;
    case 'mute': toggleMute(); break;
    case 'pause': setPaused(!state.paused); break;
    case 'clear': clearPen(); toast('След очищен'); break;
    // «Сессия заново» до старта не обходит пробу пальцев: окно ещё открыто.
    case 'restart': if (state.started) { initAudio(); startSession(); } break;
    case 'pedal': togglePedal(); break;
    case 'octDown': shiftNoteOctave(-1); break;
    case 'octUp': shiftNoteOctave(1); break;
    case 'major': setMode('major'); break;
    case 'minor': setMode('minor'); break;
    // viz1…viz3 — прямой выбор режима цифрами по порядку VIZ_ORDER.
    case 'viz1': case 'viz2': case 'viz3':
      setViz(VIZ_ORDER[Number(id.slice(3)) - 1]); break;
  }
}
window.addEventListener('keydown', (e) => {
  // Ctrl/⌘/Alt + клавиша — команда браузера, а не игра (Ctrl+R, Ctrl+M, ⌘Q…).
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Стартовый экран: пока сессия не начата, десять игровых клавиш — это проба
  // пальцев, а пробел — подтверждение старта после неё. Тот же жест в игре
  // открывает новое комбо, поэтому реакция закрепляется ещё до первой ноты.
  if (!state.started && !e.repeat) {
    if (e.code === 'Space') {
      if (introStart()) { e.preventDefault(); return; }
    } else if (introPress(e.code)) {
      return;
    }
  }
  // Пока открыт результат пьесы, игровые команды спят: кнопки диалога
  // активируются браузером сами, а Space/Enter/Esc не меняют сцену за ним.
  const formResult = document.getElementById('formResult');
  if (formResult && formResult.classList.contains('show')) return;
  // В открытом select/ползунке стрелки и Space принадлежат элементу, не игре.
  if (e.target && e.target.matches && e.target.matches('select, input, textarea')) return;
  // Space/Enter на кнопке записи — её действие, а не переход/следующее комбо.
  if (e.target && e.target.closest && e.target.closest('#recPg') &&
      (e.code === 'Space' || e.code === 'Enter')) return;
  if (['Space', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  const chordIdx = INPUT.chordIndex(e.code);
  if (e.repeat) {
    // Удержание аккордовой клавиши повторяет аккорд пульсом, но без шквала событий.
    if (chordIdx !== -1 && playable()) {
      const now = performance.now();
      if (now - (lastChordAt[e.code] || 0) > CFG.keyRepeatMs) {
        lastChordAt[e.code] = now;
        playHarmonic(chordIdx);
      }
    }
    return;
  }
  const cmd = INPUT.commands[e.code];
  if (cmd) { runCommand(cmd); return; }
  pressCode(e.code);
});
window.addEventListener('keyup', (e) => releaseCode(e.code));
window.addEventListener('pointerup', stopChordHold);
window.addEventListener('blur', () => {
  state.keysDown = {};
  notePointerCode = null;
  stopChordHold();
  document.querySelectorAll('.key-badge').forEach(el => el.classList.remove('held'));
  clearActiveCards();
  Midi.panic();
  if (state.running && !state.paused) setPaused(true);
});
// Ряд нот пересобирается при смене раскладки, поэтому события живут на контейнере,
// а не на каждой кнопке. Так «7 нот / 5 корней» переключается без перепривязки.
let notePointerCode = null;
const noteRowEl = $('noteRow');
if (noteRowEl) {
  noteRowEl.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.key-badge');
    if (!el) return;
    e.preventDefault();
    notePointerCode = el.dataset.code;
    el.classList.add('held');
    pressCode(notePointerCode);
  });
  noteRowEl.addEventListener('pointerout', (e) => {
    const el = e.target.closest('.key-badge');
    if (!el || el.contains(e.relatedTarget)) return;
    if (notePointerCode === el.dataset.code) notePointerCode = null;
    el.classList.remove('held');
    releaseCode(el.dataset.code);
  });
  noteRowEl.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.key-badge')) e.preventDefault();
  });
}
function releasePointerNote() {
  if (!notePointerCode) return;
  const code = notePointerCode;
  notePointerCode = null;
  const el = document.querySelector('#noteRow .key-badge[data-code="' + code + '"]');
  if (el) el.classList.remove('held');
  releaseCode(code);
}
window.addEventListener('pointerup', releasePointerNote);
window.addEventListener('pointercancel', releasePointerNote);
$('muteBtn').addEventListener('click', () => { initAudio(); toggleMute(); });
$('soundChip').addEventListener('click', () => { initAudio(); toggleSound(true); });
$('pauseBtn').addEventListener('click', () => setPaused(!state.paused));
$('restartBtn').addEventListener('click', () => {
  if (!state.started) return;
  initAudio();
  startSession();
});
$('modeSel').addEventListener('change', (e) => setMode(e.target.value));
$('comboSel').addEventListener('change', (e) => {
  loadCombo(parseInt(e.target.value, 10), true);
  toast('КОМБО ' + combo().id + ' · ' + keyNameOf(combo()));
});
$('comboPrev').addEventListener('click', prevCombo);
$('comboNext').addEventListener('click', nextCombo);
$('pPrevCombo').addEventListener('click', prevCombo);
$('pNextCombo').addEventListener('click', nextCombo);
$('spaceNext').addEventListener('click', () => advanceCombo());
function beginFromOverlay() {
  // Единственная точка входа в сессию из стартового окна. Её же зовут MIDI-нота,
  // запись и пьеса, поэтому окно закрывается и там, где клик по кнопке не нужен.
  if (state.started) return;
  clearIntroTimer();
  hideKeyTip();
  initAudio();
  const overlay = $('startOverlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.classList.remove('fade', 'ready', 'drums');
  }
  state.started = true;
  startSession();
}
// ===== Стартовый экран: проба десяти клавиш, барабаны, пробел =====
// Сессия начинается не по клику, а после того, как игрок положил пальцы на
// десять игровых клавиш и нажал их. Порядок любой — важна каждая клавиша:
// Q W E R F держат гармонию, J I O P [ ведут мелодию. Проба учит раскладку до
// старта и заодно даёт браузеру жест, после которого разрешён звук.
// Второй шаг — Enter: он включает барабаны, и игрок слышит грув ещё до первой
// ноты. Только после этого пробел становится активным, и сессия начинается
// тем же жестом, которым в игре открывается новое комбо.
const INTRO_KEYS = CHORD_CODES.concat(NOTE_KEYS);
const intro = {
  hit: {}, count: 0, total: INTRO_KEYS.length,
  done: false,        // десять клавиш собраны
  drums: false,       // Enter включил барабаны — грув уже звучит
  ready: false,       // пробел стал активным, но ещё не нажат
  starting: false,    // окно гаснет, сессия стартует через CFG.introFadeMs
  timer: 0
};
function clearIntroTimer() {
  if (!intro.timer) return;
  clearTimeout(intro.timer);
  intro.timer = 0;
}
function introKeyEl(code) {
  return document.querySelector('#startOverlay .kb-key[data-key="' + code + '"]');
}
// ===== Подсказки на схеме: за что отвечает клавиша =====
// Игрок знакомится с клавишами руками, поэтому объяснение появляется на самой
// клавише: навёл курсор — прочитал; нажал — прочитал ещё раз. Стрелки не
// подписаны намеренно: у них уже есть название «лад / комбо» и свои title.
// Текст живёт в data-tip (языковой пакет переводит его как любой атрибут), а
// пузырёк рисуется один на всё окно и не перехватывает мышь.
let keyTipTimer = 0;
function hideKeyTip() {
  if (keyTipTimer) { clearTimeout(keyTipTimer); keyTipTimer = 0; }
  const tip = $('kbTip');
  if (!tip) return;
  tip.classList.remove('show');
  tip.setAttribute('aria-hidden', 'true');
}
function showKeyTip(el, holdMs) {
  const tip = $('kbTip'), overlay = $('startOverlay');
  if (!tip || !overlay || !el) return false;
  const raw = el.dataset.tip || el.getAttribute('title') || '';
  if (!raw) return false;
  const label = typeof I18N !== 'undefined' && I18N.enabled()
    ? I18N.text(raw) : raw;
  if (tip.textContent !== label) tip.textContent = label;
  // Позиция — в координатах окна: #startOverlay фиксирован и сам является
  // контейнером для absolute, но может прокручиваться на телефоне.
  const r = el.getBoundingClientRect(), box = overlay.getBoundingClientRect();
  const pad = Math.max(48, Math.min(150, box.width / 2 - 8));
  const x = r.left - box.left + overlay.scrollLeft + r.width / 2;
  const y = r.top - box.top + overlay.scrollTop - 6;
  tip.style.left = Math.min(Math.max(x, pad), box.width - pad) + 'px';
  tip.style.top = y + 'px';
  tip.classList.add('show');
  tip.setAttribute('aria-hidden', 'false');
  if (keyTipTimer) clearTimeout(keyTipTimer);
  keyTipTimer = holdMs ? setTimeout(hideKeyTip, holdMs) : 0;
  return true;
}
// Прогресс показывает сама схема: нажатая клавиша получает класс hit (✓ и
// свечение), а строка над клавиатурой — только счётчик. Отдельной дорожки из
// десяти подписанных точек и кнопки «старт» нет: они дублировали клавиши,
// отнимали место у схемы, а кнопку всё равно нельзя было нажать раньше времени.
// После 10 / 10 счётчик зеленеет, а строку инструкции сменяет просьба о пробеле
// (класс ready на окне; текст живёт в index.html, не в JS).
function syncIntroDrill() {
  const count = $('introCount');
  if (count) count.textContent = intro.count + ' / ' + intro.total;
}
// Отклик на каждую нажатую клавишу: аккорд звучит подложкой, нота — колоколом.
// Это не игра: ни очков, ни шагов, ни записи — только проверка «клавиша слышна».
function introPreview(code) {
  initAudio();
  const chordIdx = INPUT.chordIndex(code);
  if (chordIdx !== -1) {
    const h = harmonicChords()[chordIdx];
    if (h) playChordAudio(h, 0.5);
    return;
  }
  const noteIdx = INPUT.noteIndex(code);
  if (noteIdx === -1) return;
  const ballIdx = handNoteBalls()[noteIdx];
  const b = ballIdx == null ? null : balls[ballIdx];
  const midi = (b ? b.midi : rootMidi()) + (P.noteOct || 0) * 12;
  bell(midi, 0.7, 0, null, 'note', P.sustain ? 0.5 : 0);
}
// Одна клавиша пробы. Повторное нажатие звучит, но счёт не двигает: считаются
// именно десять разных клавиш. Enter — отдельный шаг: он включает барабаны
// (introDrums), а не играет ноту. Возвращает true, если клавиша занята пробой.
function introPress(code) {
  if (code === 'Enter') return introDrums();
  if (INTRO_KEYS.indexOf(code) === -1) return false;
  const overlay = $('startOverlay');
  if (!overlay || overlay.style.display === 'none') return false;
  // Окно уже гаснет по пробелу: клавиши молчат, чтобы не звучать «в пустоту».
  if (intro.starting) return true;
  introPreview(code);
  // Нажал — объяснение всплыло: новичок видит роль клавиши, не читая легенду.
  showKeyTip(introKeyEl(code), 2400);
  if (intro.done || intro.hit[code]) return true;
  intro.hit[code] = true;
  intro.count += 1;
  const key = introKeyEl(code);
  if (key) {
    key.classList.add('hit');
    key.classList.remove('need');
  }
  syncIntroDrill();
  if (intro.count >= intro.total) introFinish();
  return true;
}
// Проба пройдена, но сессия ещё не начата: окно получает класс drums и просит
// нажать Enter — барабаны включаются здесь же, до первой ноты. Так грув
// перестаёт быть «кнопкой в панели, которую никто не нашёл»: его слышно на
// знакомстве с клавиатурой, а в игре Enter работает как переключатель.
function introFinish() {
  if (intro.done) return;
  intro.done = true;
  syncIntroDrill();
  const overlay = $('startOverlay');
  // Если грув уже включён (игрок нажал Enter раньше), второй шаг не нужен.
  if (typeof Groove !== 'undefined' && Groove.on) { introDrumsReady(); return; }
  if (overlay) overlay.classList.add('drums');
  const enter = introKeyEl('Enter');
  if (enter) enter.classList.add('need');
  showKeyTip(enter, 3200);
}
// Enter на стартовом экране: барабаны включаются сейчас, а проба закрывает
// второй шаг. До десяти клавиш Enter тоже звучит, но окно продолжает ждать
// остальные — так клавиша не выглядит «сломанной».
function introDrums() {
  if (state.started || intro.starting) return false;
  const overlay = $('startOverlay');
  if (!overlay || overlay.style.display === 'none') return false;
  if (typeof Groove !== 'undefined') Groove.startPreview();
  const enter = introKeyEl('Enter');
  if (intro.done) {
    if (enter) { enter.classList.add('hit'); enter.classList.remove('need'); }
    introDrumsReady();
  }
  showKeyTip(enter, 2400);
  return true;
}
// Барабаны включены — теперь активен пробел. Текст обоих состояний живёт в
// index.html (.ip-drums / .ip-after), JS только переключает классы.
function introDrumsReady() {
  if (intro.drums) return;
  intro.drums = true;
  intro.ready = true;
  syncIntroDrill();
  const overlay = $('startOverlay');
  if (overlay) {
    overlay.classList.remove('drums');
    overlay.classList.add('ready');
  }
  hideKeyTip();
}
// Пробел после пробы: окно гаснет, и через CFG.introFadeMs начинается сессия —
// последняя вспышка Space успевает погаснуть до того, как сцена займёт экран.
// Клик по клавише Space на схеме идёт сюда же; повторное нажатие ничего не
// ускоряет и не сбрасывает. До барабанов пробел молчит: вместо тишины он
// показывает подсказку на Enter — так игрок понимает, чего не хватает.
function introStart() {
  if (state.started || intro.starting) return false;
  if (!intro.ready) {
    if (intro.done) showKeyTip(introKeyEl('Enter'), 2800);
    return false;
  }
  intro.starting = true;
  clearIntroTimer();
  hideKeyTip();
  const overlay = $('startOverlay');
  if (overlay) overlay.classList.add('fade');
  intro.timer = setTimeout(beginFromOverlay, CFG.introFadeMs);
  return true;
}
function introState() {
  return {
    count: intro.count, total: intro.total,
    done: intro.done, drums: intro.drums, ready: intro.ready,
    starting: intro.starting,
    hit: INTRO_KEYS.filter(code => intro.hit[code])
  };
}
syncIntroDrill();
$('startOverlay').addEventListener('click', (e) => {
  // Клик мимо клавиш ничего не запускает: вход — только через пробу и пробел.
  const key = e.target.closest ? e.target.closest('.kb-key[data-key]') : null;
  if (!key) return;
  if (key.dataset.key === 'Space') introStart();
  else introPress(key.dataset.key);
});
// Наведение мышью объясняет клавишу, уход — гасит пузырёк. Слушатели на окне,
// а не на клавишах: разметка остаётся статичной, а подсказки работают и для
// клавиш, которые появятся в схеме позже.
$('startOverlay').addEventListener('pointerover', (e) => {
  const key = e.target.closest ? e.target.closest('.kb-key[data-tip]') : null;
  if (key) showKeyTip(key, 0);
});
$('startOverlay').addEventListener('pointerout', (e) => {
  const key = e.target.closest ? e.target.closest('.kb-key[data-tip]') : null;
  if (!key) return;
  const to = e.relatedTarget;
  if (to && key.contains(to)) return;
  hideKeyTip();
});
// Смена размера окна двигает клавиши, а пузырёк стоит по старым координатам —
// проще спрятать его, чем пересчитывать на каждом кадре.
window.addEventListener('resize', hideKeyTip);
$('mResume').addEventListener('click', () => setPaused(false));
$('mRestart').addEventListener('click', () => { initAudio(); startSession(); });

$('pMidiIn').addEventListener('change', (e) => Midi.select(e.target.value));
