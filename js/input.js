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
    case 'restart': initAudio(); startSession(); break;
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
$('restartBtn').addEventListener('click', () => { initAudio(); startSession(); });
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
  initAudio();
  $('startOverlay').style.display = 'none';
  state.started = true;
  startSession();
}
$('startBtn').addEventListener('click', (e) => { e.stopPropagation(); beginFromOverlay(); });
$('startOverlay').addEventListener('click', beginFromOverlay);
$('mResume').addEventListener('click', () => setPaused(false));
$('mRestart').addEventListener('click', () => { initAudio(); startSession(); });

$('pMidiIn').addEventListener('change', (e) => Midi.select(e.target.value));
