/* HARMONIA · js/ui-panel.js — привязка ползунков и кнопок панели
   Модуль без сборки: подключается <script> в index.html до main.js.
   Все модули делят глобальную область — имена функций/констант уникальны. */

// ===== Панель параметров =====
const syncers = [];
function bindRange(id, vid, key, scale, fmt, after) {
  const el = $(id), out = $(vid);
  const apply = () => {
    const v = parseFloat(el.value);
    P[key] = v * scale;
    out.textContent = fmt(v);
    if (after) after();
  };
  el.addEventListener('input', apply);
  syncers.push(() => { el.value = String(P[key] / scale); apply(); });
  apply();
}
function bindToggle(id, key, onText, offText, after) {
  const el = $(id);
  const paint = () => {
    el.setAttribute('aria-pressed', String(!!P[key]));
    el.textContent = P[key] ? onText : offText;
    if (after) after();
  };
  el.addEventListener('click', () => { P[key] = !P[key]; paint(); });
  syncers.push(paint);
  paint();
}
function bindSelect(id, key, parse, after) {
  const el = $(id);
  const apply = () => { P[key] = parse(el.value); if (after) after(); };
  el.addEventListener('change', apply);
  syncers.push(() => { el.value = String(P[key]); apply(); });
  apply();
}
function syncAll() { syncers.forEach(fn => fn()); }
// Переключение «умное переключение аккордов / фиксированные корни». Оба режима
// используют одни и те же пять клавиш J I O P [, поэтому массив NOTE_KEYS не
// пересобирается. Зажатые ноты гасим, чтобы старая раскладка не оставила
// «висящий» звук. Guard не даёт syncAll() (педаль, сброс) пересобирать
// раскладку и обрывать удержание без реальной смены.
let noteLayoutKey = null;
function applyNoteLayout() {
  const key = P.smartHand ? 'smart' : 'roots';
  if (key === noteLayoutKey) return;
  noteLayoutKey = key;
  if (typeof stopChordHold === 'function') stopChordHold();
  if (typeof cancelPendingNoteChord === 'function') cancelPendingNoteChord();
  handKey = '';
  harmonyKey = '';
  state.keysDown = {};
  if (typeof balls !== 'undefined') {
    balls.forEach(b => {
      b.sustainLatch = false;
      b.sustainAt = 0;
      b.playMidi = b.midi;
      if (typeof holdStop === 'function') holdStop(b);
    });
  }
  // Пока smart выключен, anchor не обновлялся, а окно могло остаться от
  // аккорда, который играл до переключения. При возврате синхронизируем anchor
  // с последним звучавшим аккордом и пересобираем окно — иначе бейджи и
  // автотрезвучия стартовали бы с устаревшей гармонией.
  if (P.smartHand) {
    if (typeof smartAnchorForChord === 'function' && state.harmony && state.harmony.lastTriad) {
      const idx = smartAnchorForChord(state.harmony.lastTriad);
      if (idx !== -1) state.adaptive.anchor = idx;
    }
    if (typeof computeAdaptiveWindow === 'function') {
      state.adaptive.window = computeAdaptiveWindow(state.adaptive.anchor);
    }
  }
  // Левая рука тоже зависит от режима: smart собирает Q из текущего anchor,
  // roots — прежние пять корней. Без пересборки карточки остались бы старыми.
  if (typeof buildChordPad === 'function') buildChordPad();
  if (typeof buildNoteRow === 'function') buildNoteRow();
  if (typeof updateNoteHints === 'function') updateNoteHints();
  if (typeof updateHUD === 'function' && state.started) updateHUD();
}

bindRange('pSpeed', 'vSpeed', 'speed', 1, v => v === 0 ? 'стоят' : v + '°/с');
bindRange('pBoost', 'vBoost', 'boost', 1, v => v + '°');
bindRange('pTau', 'vTau', 'tau', 0.01, v => (v / 100).toFixed(2) + ' с');
bindRange('pPenW', 'vPenW', 'penW', 1, v => v + ' px');
bindRange('pFade', 'vFade', 'fade', 1, v => v + '%/с');
bindRange('pGlow', 'vGlow', 'glow', 1, v => String(v));
bindRange('pParticles', 'vParticles', 'particles', 1, v => String(v), syncParticles);
bindRange('pReverb', 'vReverb', 'reverb', 0.01, v => v + '%', () => {
  if (wetGain && audioCtx) wetGain.gain.setTargetAtTime(P.reverb, audioCtx.currentTime, 0.05);
});
// Яркость нот: срез ФНЧ колокола (0.5…1.8 от базового). Слышно на следующей ноте.
bindRange('pNoteTone', 'vNoteTone', 'tone', 0.01, v => v + '%');
// Раздельная громкость: ноты и аккорды — независимые шины audio.js. Слайдер
// меняет и уже звучащие сухие голоса, и следующие; реверб-хвосты — по мере
// пересоздания голосов.
bindRange('pNoteVol', 'vNoteVol', 'noteVol', 0.01, v => v + '%', applyVoiceVolumes);
bindRange('pChordVol', 'vChordVol', 'chordVol', 0.01, v => v + '%', applyVoiceVolumes);
// Барабаны — своя шина: громкость не должна спорить с нотами и аккордами.
bindRange('pDrumVol', 'vDrumVol', 'drumVol', 0.01, v => v + '%', applyVoiceVolumes);
// Октава мелодии: высота нот сдвигается, а шар остаётся на своей ступени.
bindSelect('pNoteOct', 'noteOct', v => parseInt(v, 10), () => {
  if (typeof updateNoteBadges === 'function') updateNoteBadges();
});
// ===== Нотация подписей: до-ре-ми / C-D-E =====
// Русский интерфейс живёт на сольфеджио, латинские языки ждут букв. Google
// Translate нотацию не переводит (и не должен: «соль» — это ещё и соль),
// поэтому нотацию переключает игра: выбор языка зовёт applyLanguageNotation(),
// а панель даёт ручной выбор. Смена нотации не трогает ни звук, ни геометрию:
// шары не пересобираются, меняются только подписи.
function refreshNotation() {
  if (typeof resetNotationCaches === 'function') resetNotationCaches();
  if (typeof balls !== 'undefined' && balls.length) {
    const c = combo();
    balls.forEach((b, i) => { b.name = noteLabel(c.scaleNames[i + 1]); });
  }
  if (typeof buildWheel === 'function') buildWheel();
  // Подписи ячеек полосы — те же ноты, что и на колесе, поэтому нотация у них
  // общая: пересобираем полосу вместе с колесом, а классы прогресса расставит
  // updateHUD ниже.
  if (typeof buildComboStrip === 'function') buildComboStrip();
  if (typeof fillComboSelect === 'function') fillComboSelect();
  if (typeof buildChordPad === 'function') buildChordPad();
  // Итог пьесы тоже показывает ноты (диапазон мелодии): перерисовываем его,
  // чтобы в нём не осталась прежняя нотация. Показ/скрытие — не его дело.
  if (typeof renderFormResult === 'function') renderFormResult();
  if (typeof updateHUD === 'function') updateHUD();
}
function setNotation(mode) {
  const next = mode === 'letters' ? 'letters' : 'sol';
  const sel = $('pNotation');
  if (sel && sel.value !== next) sel.value = next;
  if (P.notation === next) return false;
  P.notation = next;
  refreshNotation();
  return true;
}
// Кириллические языки остаются на до-ре-ми, всем остальным — буквы: так ждёт
// европейский и американский игрок, и так подписи не приходится переводить.
function notationForLang(code) {
  const base = String(code || '').split('-')[0].toLowerCase();
  return base === '' || SOLFEGE_LANGS[base] ? 'sol' : 'letters';
}
function applyLanguageNotation(code) { setNotation(notationForLang(code)); }
if ($('pNotation')) {
  $('pNotation').addEventListener('change', () => {
    if (!setNotation($('pNotation').value)) return;
    toast(P.notation === 'letters' ? 'Нотация: C-D-E' : 'Нотация: до-ре-ми');
  });
}
syncers.push(() => { if ($('pNotation')) $('pNotation').value = P.notation; });
bindToggle('pGuides', 'guides', 'Направляющие: вкл', 'Направляющие: выкл');
bindToggle('pTails', 'tails', 'Кометные хвосты: вкл', 'Кометные хвосты: выкл');
bindToggle('pPad', 'pad', 'Подложка аккорда: вкл', 'Подложка аккорда: выкл');
// Запись: отсчёт и повтор — параметры сессии, а не свойства конкретной записи.
// Повтор можно включить и после старта прослушивания — проверка P.recLoop
// происходит в конце каждого круга (recorder.js).
bindSelect('recCountIn', 'recCountIn', v => parseInt(v, 10));
bindToggle('recLoop', 'recLoop', 'Повтор: вкл', 'Повтор: выкл', () => {
  if (typeof paintRecorder === 'function') paintRecorder();
});
// Правая рука: две взаимоисключающие раскладки. Smart — пять безопасных нот
// вокруг текущего аккорда (по умолчанию), иначе — привычные J I O P [.
const handBtn = $('pSmartHand');
function paintHandMode() {
  handBtn.textContent = P.smartHand
    ? 'Умное переключение: вкл'
    : 'Умное переключение: выкл';
  handBtn.setAttribute('aria-pressed', String(!!P.smartHand));
  handBtn.title = P.smartHand
    ? 'Smart: пять безопасных нот вокруг аккорда, Q следует за гармонией. Клик — выключить.'
    : 'Без smart: фиксированные корни J I O P [, автотрезвучия от самой ноты. Клик — включить.';
}
handBtn.addEventListener('click', () => {
  P.smartHand = !P.smartHand;
  applyNoteLayout();
  paintHandMode();
  toast(P.smartHand
    ? 'Умное переключение: вкл · 5 безопасных нот вокруг аккорда'
    : 'Умное переключение: выкл · 5 фиксированных корней');
});
syncers.push(() => { paintHandMode(); applyNoteLayout(); });
paintHandMode();
// Педаль: кнопка панели (и MIDI CC64). При отпускании сразу гасим хвосты,
// при нажатии аккорды и ноты получают удлинённый хвост (см. playChordAudio/triggerBall).
const sustainBtn = $('pSustain');
function paintSustain() {
  sustainBtn.setAttribute('aria-pressed', String(!!P.sustain));
  sustainBtn.textContent = P.sustain ? 'Педаль: нажата' : 'Педаль: отпущена';
}
sustainBtn.addEventListener('click', () => togglePedal());
syncers.push(paintSustain); paintSustain();
function togglePedal() {
  P.sustain = !P.sustain;
  syncAll();
  if (!P.sustain) releaseAllHolds();
  toast(P.sustain ? 'Педаль: нажата · хвост длиннее' : 'Педаль: отпущена · звук гаснет');
}
const dirBtn = $('pDir');
function paintDir() {
  dirBtn.setAttribute('aria-pressed', String(P.dir === 1));
  dirBtn.textContent = P.dir === 1 ? '⟳ Направление: по часовой' : '⟲ Направление: против часовой';
}
dirBtn.addEventListener('click', () => { P.dir = -P.dir; paintDir(); });
syncers.push(paintDir); paintDir();
bindSelect('pQuality', 'quality', v => v);
bindSelect('pPalette', 'palette', v => v, applyPalette);
bindSelect('pBassOct', 'bassOct', v => parseInt(v, 10));
// ===== Барабаны · грув =====
// Состояние живёт в Groove: ему нужны часы и сетка, а P хранит только выбор
// игрока, чтобы «Сброс параметров» возвращал и его. Список фигур собирается из
// CFG.groove.patterns — новая фигура появляется без правок разметки.
function bindGroove() {
  const toggle = $('grooveToggle');
  const sel = $('groovePattern');
  if (sel) {
    sel.textContent = '';
    Object.keys(CFG.groove.patterns).forEach(id => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = CFG.groove.patterns[id].label;
      sel.appendChild(opt);
    });
    sel.value = P.groovePattern;
    sel.addEventListener('change', () => Groove.setPattern(sel.value));
  }
  if (toggle) {
    toggle.addEventListener('click', () => {
      // Клик — пользовательский жест: можно открывать аудиотракт.
      initAudio();
      Groove.setOn(!Groove.on);
    });
  }
  // Темп джема: в пьесе ползунок выключен, барабаны ведёт Transport.
  const bpm = $('pGrooveBpm');
  if (bpm) bpm.addEventListener('input', () => Groove.setBpm(parseFloat(bpm.value)));
  syncers.push(() => {
    Groove.setPattern(P.groovePattern);
    Groove.setOn(P.grooveOn);
    Groove.setBpm(P.grooveBpm);
    Groove.paint();
  });
  Groove.patternId = CFG.groove.patterns[P.groovePattern] ? P.groovePattern : 'straight';
  Groove.on = !!P.grooveOn;
  Groove.paint();
}
bindGroove();
// ===== Меню визуализации =====
// Кнопки собираются из реестра VIZ, поэтому новый режим появляется в панели
// без правок разметки: достаточно добавить запись в VIZ и ключ в VIZ_ORDER.
function paintVizMenu() {
  $('vizMenu').querySelectorAll('[data-viz]').forEach(el => {
    const on = el.dataset.viz === P.viz;
    el.setAttribute('aria-pressed', String(on));
  });
}
function buildVizMenu() {
  const menu = $('vizMenu');
  menu.textContent = '';
  VIZ_ORDER.forEach((key, i) => {
    const mode = VIZ[key];
    if (!mode) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'viz-btn';
    btn.dataset.viz = key;
    btn.title = mode.hint || mode.label;
    btn.setAttribute('aria-label', 'Визуализация: ' + mode.label + ' (клавиша ' + (i + 1) + ')');
    btn.innerHTML = '<span class="viz-key">' + (i + 1) + '</span><span class="viz-name">' + mode.label + '</span>';
    menu.appendChild(btn);
  });
  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-viz]');
    if (btn) setViz(btn.dataset.viz);
  });
  syncers.push(paintVizMenu);
  paintVizMenu();
}

$('pClear').addEventListener('click', () => { clearPen(); toast('След очищен'); });
$('pReset').addEventListener('click', () => {
  const vizBefore = P.viz;
  Object.assign(P, DEFAULTS);
  // Сброс мог вернуть режим по умолчанию: старые точки истории в другой геометрии не нужны.
  if (P.viz !== vizBefore) resetVizLayers();
  syncAll(); applyPalette(); syncParticles(); clearPen();
  // Нотация тоже вернулась к «до-ре-ми»: подписи нужно переписать сразу,
  // иначе карточки и шар останутся в прежней нотации до смены комбо.
  refreshNotation();
  if (!P.sustain) releaseAllHolds();
  toast('Параметры сброшены');
});
$('pRandom').addEventListener('click', () => {
  const rnd = (a, b) => a + Math.random() * (b - a);
  // Скорость покоя не рандомизируем: шары двигаются только от нажатий.
  P.speed = 0;
  P.boost = Math.round(rnd(10, 140) / 5) * 5;
  P.tau = Math.round(rnd(10, 80) / 5) * 5 / 100;
  P.penW = Math.round(rnd(1, 7) * 2) / 2;
  P.fade = Math.round(rnd(0, 60) / 5) * 5;
  P.glow = Math.round(rnd(4, 40) / 2) * 2;
  P.particles = Math.round(rnd(0, 120) / 6) * 6;
  P.dir = Math.random() < 0.5 ? 1 : -1;
  const keys = Object.keys(PALETTES);
  P.palette = keys[Math.floor(Math.random() * keys.length)];
  P.reverb = Math.round(rnd(0, 80) / 5) * 5 / 100;
  syncAll(); applyPalette(); syncParticles();
  toast('Случайная конфигурация', 'good');
});
$('pExport').addEventListener('click', () => {
  const ex = document.createElement('canvas');
  ex.width = 800; ex.height = 540;
  const c = ex.getContext('2d');
  const bg = c.createRadialGradient(400, 270, 40, 400, 270, 460);
  bg.addColorStop(0, '#1e2233'); bg.addColorStop(1, '#0e1017');
  c.fillStyle = bg; c.fillRect(0, 0, 800, 540);
  c.drawImage(penCanvas, 0, 0);
  c.drawImage(spriteCanvas, 0, 0);
  c.fillStyle = 'rgba(255,255,255,0.75)';
  c.font = '700 14px sans-serif'; c.textAlign = 'left';
  // Подпись на экспорте рисуется в canvas, поэтому идёт через языковой пакет.
  c.fillText(I18N.text('HARMONIA · КОМБО ' + combo().id + ' · ' + keyNameOf(combo())), 20, 520);
  const a = document.createElement('a');
  a.download = 'harmonia-combo-' + combo().id + '.png';
  a.href = ex.toDataURL('image/png');
  a.click();
  toast('PNG сохранён · КОМБО ' + combo().id, 'good');
});
