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
  // пальцев. Остальные клавиши и раньше ничего не делали до старта.
  if (!state.started && !e.repeat && introPress(e.code)) return;
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
  toast('КОМБО ' + combo().id + ' · ' + combo().keyName);
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
  initAudio();
  const overlay = $('startOverlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.classList.remove('fade');
  }
  state.started = true;
  startSession();
}
// ===== Стартовый экран: проба десяти клавиш =====
// Сессия начинается не по клику, а после того, как игрок положил пальцы на
// десять игровых клавиш и нажал их. Порядок любой — важна каждая клавиша:
// Q W E R F держат гармонию, J I O P [ ведут мелодию. Проба учит раскладку до
// старта и заодно даёт браузеру жест, после которого разрешён звук.
const INTRO_KEYS = CHORD_CODES.concat(NOTE_KEYS);
const intro = { hit: {}, count: 0, total: INTRO_KEYS.length, done: false, timer: 0 };
function clearIntroTimer() {
  if (!intro.timer) return;
  clearTimeout(intro.timer);
  intro.timer = 0;
}
function introKeyEl(code) {
  return document.querySelector('#startOverlay .kb-key[data-key="' + code + '"]');
}
// Прогресс показывает сама схема: нажатая клавиша получает класс hit (✓ и
// свечение), а строка над клавиатурой — только счётчик. Отдельной дорожки из
// десяти подписанных точек и кнопки «старт» нет: они дублировали клавиши,
// отнимали место у схемы, а кнопку всё равно нельзя было нажать раньше времени.
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
// именно десять разных клавиш. Возвращает true, если клавиша принадлежит пробе.
function introPress(code) {
  if (intro.done || INTRO_KEYS.indexOf(code) === -1) return false;
  const overlay = $('startOverlay');
  if (!overlay || overlay.style.display === 'none') return false;
  introPreview(code);
  if (intro.hit[code]) return true;
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
// Проба пройдена: окно гаснет, и только после паузы начинается сессия —
// последняя клавиша успевает вспыхнуть до того, как сцена займёт экран.
function introFinish() {
  if (intro.done) return;
  intro.done = true;
  syncIntroDrill();
  const overlay = $('startOverlay');
  if (overlay) overlay.classList.add('fade');
  intro.timer = setTimeout(beginFromOverlay, CFG.introFadeMs);
}
function introState() {
  return {
    count: intro.count, total: intro.total, done: intro.done,
    hit: INTRO_KEYS.filter(code => intro.hit[code])
  };
}
syncIntroDrill();
$('startOverlay').addEventListener('click', (e) => {
  // Клик мимо клавиш ничего не запускает: вход — только через пробу.
  const key = e.target.closest ? e.target.closest('.kb-key[data-key]') : null;
  if (key) introPress(key.dataset.key);
});
$('mResume').addEventListener('click', () => setPaused(false));
$('mRestart').addEventListener('click', () => { initAudio(); startSession(); });

$('pMidiIn').addEventListener('change', (e) => Midi.select(e.target.value));
