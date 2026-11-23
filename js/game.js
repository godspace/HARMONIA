/* HARMONIA · js/game.js — сессия, комбо, счёт, chordEvent/triggerBall, pressCode
   Модуль без сборки: подключается <script> в index.html до main.js.
   Все модули делят глобальную область — имена функций/констант уникальны. */

// ===== Логика симулятора =====
// Снять все удержания: пауза, смена комбо, старт сессии, выключение sustain.
function releaseAllHolds() {
  stopChordHold();
  // Запланированное автотрезвучие не должно «догнать» уже остановленную игру:
  // пауза, смена комбо и старт сессии отменяют его до срабатывания таймера.
  if (typeof cancelPendingNoteChord === 'function') cancelPendingNoteChord();
  // Отложенная перестройка smart-раскладки тоже ждёт следующей реальной игры,
  // а не меняет карточки за спиной паузы или загрузки другого комбо.
  cancelAdaptiveSwitch();
  // Отпущенная педаль (кнопка панели или MIDI CC64) гасит и «хвосты» уже
  // сыгранных аккордов/нот, а не только тянущиеся голоса: выключение слышно
  // сразу, без ожидания затухания.
  if (typeof dampPedalVoices === 'function') dampPedalVoices();
  // Клавиши могли остаться зажатыми при смене комбо/паузе: раскладка правой руки
  // зависит от комбо, поэтому старый код не должен «дотягивать» уже другую ноту.
  state.keysDown = {};
  document.querySelectorAll('#noteRow .key-badge').forEach(el => el.classList.remove('held'));
  balls.forEach(b => { b.midiHeld = false; b.sustainLatch = false; b.sustainAt = 0; holdStop(b); });
  // MIDI-ноты и педаль живут в своём реестре: без сброса после паузы они «залипли» бы.
  if (typeof Heard !== 'undefined') Heard.clear();
}
// ===== Smart-раскладка: anchor следует за текущим аккордом =====
// Перестройка не должна происходить под зажатой рукой: иначе бейдж, на который
// игрок смотрел в момент нажатия, внезапно сыграет другую ступень. Поэтому
// anchor сначала становится pending, а применяется после отпускания всех
// клавиш (клавиатура, пэд, MIDI) и с небольшой задержкой.
function cancelAdaptiveSwitch() {
  if (state.adaptive.switchTimer) {
    clearTimeout(state.adaptive.switchTimer);
    state.adaptive.switchTimer = null;
  }
  state.adaptive.pendingAnchor = null;
  state.adaptive.pendingRefresh = false;
}
function resetAdaptive() {
  cancelAdaptiveSwitch();
  state.adaptive.anchor = 0;
  state.adaptive.window = [];
  state.adaptive.chordAnchorAt = 0;
  state.adaptive.lastNoteAt = 0;
  // Обе кэш-строки зависят от anchor: без сброса HUD показал бы старую раскладку.
  handKey = '';
  harmonyKey = '';
}
function adaptiveBlocked() {
  if (!playable() || state.replay) return true;
  if (chordHoldTimer) return true;
  if (Object.keys(state.keysDown).some(code => state.keysDown[code])) return true;
  // MIDI-ноты не зависят от окна правой руки, но перестройка карточек под
  // зажатым аккордом всё равно выглядит как «прыжок» интерфейса.
  if (typeof Heard !== 'undefined' && Heard.notes.size > 0) return true;
  // Только что сыгранная нота ещё звучит: не меняем под ней гармонию окна
  // мгновенно, иначе нота и её автотрезвучие окажутся из разных аккордов.
  if (state.adaptive.lastNoteAt &&
      performance.now() - state.adaptive.lastNoteAt < (CFG.adaptiveNoteGuardMs || 0)) return true;
  return false;
}
function paintAdaptiveHand() {
  if (typeof buildChordPad === 'function') buildChordPad();
  if (typeof updateNoteBadges === 'function') updateNoteBadges();
  if (typeof updateNoteHints === 'function') updateNoteHints();
  if (typeof updateHUD === 'function' && state.started) updateHUD();
}
function computeAdaptiveWindow(idx) {
  const palette = diatonicPalette();
  const anchor = palette[idx] || palette[0];
  const current = state.harmony && state.harmony.lastTriad &&
    state.harmony.lastTriad.pcs && (!state.harmony.lastTriad.kind ||
      state.harmony.lastTriad.kind === 'diatonic')
    ? state.harmony.lastTriad : anchor;
  return smartNoteWindow(idx, {
    chord: current,
    target: smartTargetHarmony(),
    prev: state.adaptive.window
  });
}
function applyPendingAdaptiveAnchor() {
  const next = state.adaptive.pendingAnchor;
  if (next == null) return;
  if (adaptiveBlocked()) return; // повторная попытка будет на отпускании клавиш
  state.adaptive.pendingAnchor = null;
  state.adaptive.pendingRefresh = false;
  if (next !== state.adaptive.anchor) state.adaptive.anchor = next;
  // Окно пересобирается из безопасных ступеней вокруг нового anchor. Оно
  // сохраняется в state, чтобы handNoteBalls и Q-аккорд видели одну и ту же
  // гармонию, а не два независимых расчёта.
  state.adaptive.window = computeAdaptiveWindow(next);
  handKey = '';
  harmonyKey = '';
  paintAdaptiveHand();
}
function scheduleAdaptiveApply() {
  const next = state.adaptive.pendingAnchor;
  if (next == null) return;
  if (next === state.adaptive.anchor && !state.adaptive.pendingRefresh) {
    state.adaptive.pendingAnchor = null;
    return;
  }
  if (adaptiveBlocked() || state.adaptive.switchTimer) return;
  state.adaptive.switchTimer = setTimeout(() => {
    state.adaptive.switchTimer = null;
    applyPendingAdaptiveAnchor();
  }, CFG.adaptiveSwitchMs);
}
function requestAdaptiveAnchor(idx) {
  if (!P.smartHand) return;
  const n = diatonicPalette().length;
  if (!n) return;
  const a = ((Math.round(idx) % n) + n) % n;
  state.adaptive.pendingAnchor = a;
  // Даже при том же anchor цель тренажёра могла смениться и переселить Q:
  // просим пересобрать карточки после отпускания клавиш.
  state.adaptive.pendingRefresh = true;
  scheduleAdaptiveApply();
}
// Явная перестройка для консоли/тестов: не ждёт отпускания клавиш.
function setAdaptiveAnchor(idx) {
  const n = diatonicPalette().length;
  if (!n) return;
  // Старый таймер не должен применить отложенный anchor поверх нового.
  if (state.adaptive.switchTimer) {
    clearTimeout(state.adaptive.switchTimer);
    state.adaptive.switchTimer = null;
  }
  state.adaptive.anchor = ((Math.round(idx) % n) + n) % n;
  state.adaptive.window = computeAdaptiveWindow(state.adaptive.anchor);
  state.adaptive.pendingAnchor = null;
  state.adaptive.pendingRefresh = false;
  handKey = '';
  harmonyKey = '';
  paintAdaptiveHand();
}
// Сброс накопленного гармонического напряжения: смена комбо, старт сессии, настройки.
function resetHarmony() {
  resetAdaptive();
  state.harmony.last = null;
  state.harmony.lastTriad = null;
  state.harmony.lastPcs = [];
  state.harmony.steps = 0;
  state.harmony.lastBonus = 0;
  state.harmony.lastReturnAt = 0;
  state.harmony.moves = [];
  state.harmony.phrase = [];
  state.harmony.lastBeauty = 0;
  state.harmony.lastBeautyAt = 0;
  state.harmony.lastBeautyText = '';
}
// Энергия копится по шарам (по ступеням), поэтому её длина — длина balls.
function resetEnergy() { state.energy = balls.map(() => 0); }
function loadCombo(idx, keepPen) {
  if (typeof stopPlayback === 'function') stopPlayback();
  if ((state.recording || state.recordingCountIn) &&
      typeof stopRecording === 'function') stopRecording(true);
  releaseAllHolds();
  const len = ORDER[state.mode].length;
  state.comboIdx = ((idx % len) + len) % len;
  // Вошли в комбо — ячейка на полосе прогресса светлеет сразу, задолго до того,
  // как собран цикл из четырёх аккордов (полоса живёт в ui-hud.js).
  if (state.entered && state.entered[state.mode]) state.entered[state.mode][state.comboIdx] = true;
  // У каждого комбо собственный счёт: при входе в новое комбо он начинается с нуля.
  state.score = 0;
  state.chordIndex = 0;
  state.visited = [false, false, false, false];
  resetHarmony();
  state.explored = new Set();
  buildBalls();
  applyPalette();
  buildChordPad();
  if (!keepPen) clearPen();
  updateHUD();
}
// Смена лада сохраняет номер комбо: мажор и минор одной пары — соседние
// строки COMBOLIST, поэтому ручной выбор лада не прыгает в начало.
function applyComboRoute(mode, idx, keepPen) {
  state.mode = mode === 'minor' ? 'minor' : 'major';
  const sel = $('modeSel');
  if (sel) sel.value = state.mode;
  fillComboSelect();
  buildWheel();
  loadCombo(idx, keepPen);
}
function setMode(mode) {
  mode = mode === 'minor' ? 'minor' : 'major';
  if (state.mode === mode) return;
  applyComboRoute(mode, state.comboIdx, false);
  toast('Лад: ' + (mode === 'major' ? 'мажор' : 'минор'), 'good');
}
// Новое комбо чередует лад: мажор → минор той же пары, минор → мажор
// следующей. Так игрок проходит пары COMBOLIST, не застревая в одном ладу.
// Prev — обратный маршрут, поэтому ↑/↓ и Enter/Backspace остаются взаимно
// обратимыми; ручные ←/→ и выбор в топбаре по-прежнему задают лад напрямую.
function nextComboTarget() {
  if (state.mode === 'major') {
    return { mode: 'minor', idx: state.comboIdx % ORDER.minor.length };
  }
  return { mode: 'major', idx: (state.comboIdx + 1) % ORDER.major.length };
}
function prevComboTarget() {
  if (state.mode === 'minor') {
    return { mode: 'major', idx: state.comboIdx % ORDER.major.length };
  }
  return {
    mode: 'minor',
    idx: (state.comboIdx - 1 + ORDER.minor.length) % ORDER.minor.length
  };
}
// Space открывает переход только после рубежа счёта. Ручные Enter/↑ и
// кнопки комбо остаются свободной навигацией для изучения материала.
function comboAdvanceReady() {
  return state.started && state.running && !state.replay &&
    state.score >= CFG.comboAdvanceAt;
}
function canAdvanceCombo() {
  return comboAdvanceReady() && !state.paused;
}
function advanceCombo() {
  if (!canAdvanceCombo()) return false;
  nextCombo();
  return true;
}
function nextCombo() {
  const target = nextComboTarget();
  applyComboRoute(target.mode, target.idx, true);
  toast('КОМБО ' + combo().id + ' · ' + keyNameOf(combo()), 'good');
}
function prevCombo() {
  const target = prevComboTarget();
  applyComboRoute(target.mode, target.idx, true);
  toast('КОМБО ' + combo().id + ' · ' + keyNameOf(combo()));
}
function startSession() {
  if (typeof discardRecording === 'function') discardRecording();
  if (typeof stopPlayback === 'function') stopPlayback();
  releaseAllHolds();
  state.score = 0; state.rings = 0;
  resetEnergy();
  state.keysDown = {}; state.clock = 0; state.energyAcc = 0;
  state.harmony.returns = 0;
  resetHarmony();
  state.explored = new Set();
  state.played.major = state.played.major.map(() => false);
  state.played.minor = state.played.minor.map(() => false);
  state.entered.major = state.entered.major.map(() => false);
  state.entered.minor = state.entered.minor.map(() => false);
  state.running = true; state.paused = false;
  // Стартовый экран прятал меню: возвращаем хром в том виде, в каком игрок его
  // оставил (проба пальцев панели не открывает насильно).
  if (typeof setDrawerIntro === 'function') setDrawerIntro(false);
  $('modal').style.display = 'none';
  $('pauseBtn').textContent = '⏸ Пауза';
  loadCombo(0, false);
  if (typeof Composition !== 'undefined') Composition.onSessionStart();
  if (typeof Groove !== 'undefined') Groove.onSessionStart();
  toast('КОМБО ' + combo().id + ' · ' + keyNameOf(combo()), 'good');
}
function setPaused(p) {
  if (!state.running) return;
  // Результат пьесы — модальный экран: клик по «Пауза» или уход фокуса окна
  // не должен открывать второе окно поверх него. Кнопки результата остаются
  // доступны, а возврат в джем/повтор убирают его явно.
  const formResult = document.getElementById('formResult');
  if (p && formResult && formResult.classList.contains('show')) return;
  if (p && typeof stopRecording === 'function' &&
      (state.recording || state.recordingCountIn)) stopRecording(true);
  if (p && typeof stopPlayback === 'function') stopPlayback();
  state.paused = p;
  stopChordHold();
  state.keysDown = {};
  document.querySelectorAll('.key-badge').forEach(el => el.classList.remove('held'));
  clearActiveCards();
  if (p) releaseAllHolds();
  if (p) Midi.panic();
  if (typeof Composition !== 'undefined') Composition.setPaused(p);
  // Барабаны останавливаются вместе с сессией: пауза — это тишина, а не «только
  // без гармонии». После продолжения грув встаёт на то же место.
  if (typeof Groove !== 'undefined') Groove.setPaused(p);
  $('pauseBtn').textContent = p ? '▶ Продолжить' : '⏸ Пауза';
  if (p) {
    $('modalTitle').textContent = 'Пауза';
    $('modalText').textContent = 'Орбиты и звук остановлены. Продолжение — с того же места.';
    $('modalStats').textContent = `Счёт комбо: ${state.score} · Кольца: ${state.rings} · ${keyNameOf(combo())}`;
    $('modal').style.display = 'flex';
  } else {
    $('modal').style.display = 'none';
  }
  updateHUD();
}
// Полный оборот — только визуальное событие. Очки за пассивное вращение не
// начисляются: счёт растёт от игры (энергия нот, красота переходов и возврат).
function ringEvent(b, now) {
  state.rings += 1;
  flashes.push({ r: b.r, color: b.color, start: now });
  ripples.push({ x: b.x, y: b.y, color: b.color, start: now, big: true });
  updateHUD();
}
// Единственная точка записи счёта. Space-кнопка обновляется сразу: иначе
// очки формы, начисленные вне chordEvent, не зажгли бы готовность к переходу.
function addScore(n) {
  if (!(n > 0) || state.replay) return;
  state.score += n;
  if (typeof updateSpaceNext === 'function') updateSpaceNext();
}
// Очки за красоту перехода: число уходит в тот же счёт комбо, а на сцене
// появляется мота у корня аккорда. HUD читает lastBeauty, поэтому игрок видит,
// за что именно начислено, а не только итоговое число.
function addBeautyScore(beauty, h) {
  if (!beauty || !(beauty.points > 0) || state.replay) return;
  addScore(beauty.points);
  state.harmony.lastBeauty = beauty.points;
  state.harmony.lastBeautyAt = performance.now();
  state.harmony.lastBeautyText = beauty.label || '';
  const root = h && h.rootPc;
  const b = balls.find(ball => ball.pc === root);
  if (b) {
    motes.push({ x: b.x, y: b.y, text: '+' + beauty.points, color: b.color, start: performance.now() });
    b.radius = Math.max(b.radius, 18);
  }
}
function scoreHarmonyStep(prev, next) {
  if (state.replay || !prev || !next) return;
  if (prev.kind === 'chroma' || next.kind === 'chroma') return;
  const key = harmonyTransitionKey(prev, next);
  const repeats = state.harmony.moves.filter(k => k === key).length;
  const beauty = harmonyTransitionBeauty(prev, next, repeats);
  state.harmony.moves.push(key);
  if (state.harmony.moves.length > 12) state.harmony.moves.shift();
  if (beauty.points > 0) addBeautyScore(beauty, next);
}
function scoreHarmonyOpening(h) {
  if (state.replay) return;
  const beauty = harmonyOpeningBeauty(h);
  if (beauty.points > 0) addBeautyScore(beauty, h);
}
function cashEnergy() {
  if (state.replay) return;
  let sum = 0;
  balls.forEach(b => {
    const e = state.energy[b.idx];
    if (e > 0) {
      sum += e;
      motes.push({ x: b.x, y: b.y, text: '+' + e, color: b.color, start: performance.now() });
      ripples.push({ x: b.x, y: b.y, color: b.color, start: performance.now(), big: false });
    }
  });
  if (sum > 0) {
    addScore(sum);
    resetEnergy();
    toast('+' + sum + ' в счёт комбо');
  }
}
// Звук аккорда: бас и мягкая подложка. Отдельно от счётно-визуальной части:
// аккорд, распознанный с пианино, уже звучит сам, и дублировать его нельзя.
function playChordAudio(h, vel, baseMidi, when) {
  // baseMidi запоминается вместе с записью: прослушивание сохраняет исходную
  // высоту, даже если сейчас открыто другое комбо.
  const T = baseMidi == null ? rootMidi() : baseMidi;
  const v = vel == null ? 1 : Math.max(0.3, Math.min(1, vel));
  const offset = h.offset == null
    ? ((h.rootPc - (T % 12) + 12) % 12)
    : h.offset;
  // Характер станции решает бас: инвертировать ли аккорд ради плавной линии
  // ('nearest' — прежнее поведение) или держать корень в басу. Прослушивание
  // записи идёт с эталонной подачей: запись хранит высоты, а не характер, и
  // звучать должна так, как звучала в момент записи.
  const station = state.replay ? STATION_NEUTRAL : stationStyleFor(state.comboIdx);
  const bassOffset = stationBassOffset(h, offset, station);
  bass(T + 12 * P.bassOct + bassOffset, when);
  if (P.pad) {
    // Педаль продлевает аккорд, но не настолько, чтобы старые аккорды
    // наслаивались на новые: 0.8 вместо 1.2 и autoFadePedalVoice() дают
    // более короткий, «рояльный» хвост.
    const pedalHold = P.sustain ? 0.8 : 0;
    // Аккорд — подложка: мягче и тише нот, чтобы мелодия орбит читалась.
    // Расположение голосов — часть характера, но pitch class те же три.
    stationPadVoices(h, T, offset, station).forEach(([midi, gain, pan]) =>
      bell(midi, gain * v, pan, when == null ? null : when, 'chord', pedalHold));
  }
}
// Единое событие аккорда: шары, напряжение, состояние визуализации.
// Принимает любой аккорд из harmonicChords(), diatonicPalette() или describeTriad();
// MIDI-путь зовёт его без звука — пианино уже сыграло само.
// source: 'keys' (клавиатура/пэд), 'midi' (распознано с пианино) или 'replay'.
function chordEvent(h, vel, source) {
  if (!playable() || !h || !h.pcs) return;
  const replay = !!state.replay || source === 'replay';
  const prevTriad = state.harmony.lastTriad;
  if (!replay) {
    cashEnergy();
    // Сначала оцениваем сам ход: он не зависит от того, вернётся ли игрок
    // в тонику. Зачин ii/IV тоже получает небольшой бонус.
    if (prevTriad) scoreHarmonyStep(prevTriad, h);
    else scoreHarmonyOpening(h);
    if (source !== 'midi' && typeof recordChord === 'function') recordChord(h, vel);
    if (typeof Composition !== 'undefined') Composition.onChord(h);
  }
  const c = combo(), now = performance.now();
  // Орбиты, входящие в аккорд, откликаются импульсом.
  balls.forEach(b => {
    if (!h.pcs.includes(b.pc)) return;
    b.radius = Math.max(b.radius, 25);
    b.boost += P.boost * 0.35;
    ripples.push({ x: b.x, y: b.y, color: b.color, start: now, big: false });
  });

  // Тренажёр ведёт только по ступеням комбо; «краска» и вторичная доминанта
  // в шаги не засчитываются, но и не ломают порядок. При прослушивании записи
  // шаги и очки не меняются.
  const diatonic = h.kind !== 'chroma' && h.kind !== 'secondary';
  if (diatonic && !replay) {
    // Шаги отмечаются по ступени, порядок внутри комбо свободный.
    // Из одинаковых ступеней (I ... I) закрываем ближайшую незакрытую.
    const deg = h.degree.toLowerCase();
    let marked = -1;
    for (let i = 0; i < c.degrees.length; i++) {
      if (!state.visited[i] && c.degrees[i].toLowerCase() === deg) { marked = i; break; }
    }
    if (marked !== -1) {
      state.visited[marked] = true;
      const nextUnvisited = state.visited.findIndex(v => !v);
      state.chordIndex = nextUnvisited === -1 ? 0 : nextUnvisited;
      rhythmSprite.radius = Math.max(rhythmSprite.radius, 40);
    }
    if (state.explored) state.explored.add(h.degree);
    if (!state.played[state.mode][state.comboIdx] && state.visited.every(Boolean)) {
      state.played[state.mode][state.comboIdx] = true;
      toast('Цикл комбо собран ✓ · после ' + CFG.comboAdvanceAt + ' — Space', 'good');
    }
  }

  // Порядок важен: prevPcs/prevRoot — аккорд, прозвучавший до этого, на нём
  // строятся подсветка общих тонов и дуга перехода в режиме «Круг».
  state.harmony.prevPcs = state.harmony.lastPcs;
  state.harmony.prevRoot = state.harmony.lastRoot;
  state.harmony.last = h.degree;
  state.harmony.lastTriad = h;
  state.harmony.lastPcs = h.pcs;
  state.harmony.lastRoot = h.rootPc;
  state.harmony.lastAt = now;
  // Smart-раскладка: текущий аккорд задаёт окно правой руки и гармонию
  // автотрезвучий. Хроматика и вторичные доминанты не сдвигают anchor, иначе
  // окно уехало бы из лада.
  if (P.smartHand && !replay && h.kind !== 'chroma' && h.kind !== 'secondary') {
    // Уменьшённые трезвучия не становятся новым центром: smartAnchorForChord
    // оставляет окно на устойчивой функции с общими тонами.
    const idx = smartAnchorForChord(h);
    if (idx !== -1) {
      state.adaptive.chordAnchorAt = now;
      requestAdaptiveAnchor(idx);
    }
  }
  if (h.tonic) {
    const steps = state.harmony.steps;
    if (steps > 0) {
      // Возвращение в тонику: накопленное напряжение уходит в счёт, а фраза
      // добавляет бонус за разнообразие и дугу S→D. Это не отменяет прежний
      // возврат, а объясняет, почему последовательность была красивой.
      const phrase = harmonyPhraseBeauty(state.harmony.phrase);
      const bonus = CFG.tonicBonus * Math.min(CFG.tonicStepCap, steps) + phrase.points;
      if (!replay) {
        addScore(bonus);
        state.harmony.returns += 1;
        state.harmony.steps = 0;
        state.harmony.lastBonus = bonus;
        state.harmony.lastReturnAt = now;
        state.harmony.phrase = [];
        // Звуком событие не выпячиваем: тоника уже прозвучала своим аккордом.
        // Кольцо и вспышка остаются на сцене, а числовой «домой +N» теперь
        // живёт в постоянном индикаторе HUD, а не дублируется в центре.
        flashes.push({ r: CFG.rMax * 1.15, color: '#ffd166', start: now });
        ripples.push({ x: RING_CX, y: RING_CY, color: '#ffd166', start: now, big: true });
        rhythmSprite.radius = 56;
        flashTonicCard();
        flashTonicPanel();
        toast('Возврат в тонику · +' + bonus +
          (phrase.points ? ' · фраза +' + phrase.points : ''), 'good');
      }
    } else if (!replay) {
      rhythmSprite.radius = Math.max(rhythmSprite.radius, 44);
      state.harmony.phrase = [];
      toast('Тоника · ' + h.name);
    }
  } else if (!replay && h.kind === 'secondary') {
    // Вторичная доминанта — тоже напряжение: она тянет в свою ступень.
    state.harmony.steps = Math.min(6, state.harmony.steps + 1);
    state.harmony.phrase.push(h);
    toast('Вторичная доминанта · ' + h.degree + ' · ' + h.name);
  } else if (!replay && diatonic) {
    state.harmony.steps = Math.min(6, state.harmony.steps + 1);
    state.harmony.phrase.push(h);
    toast(h.degree + ' · ' + h.hint + ' · ' + h.name);
  } else if (!replay) {
    toast('Краска · ' + h.name + ' · вне лада');
  }
  if (state.harmony.phrase.length > 24) state.harmony.phrase.shift();
  updateHUD();
}
// Играет один из пяти аккордов тональности (клавиши и пэд). Повторять можно
// сколько угодно: аккорд не «расходуется» и не переключает комбо сам.
function playHarmonic(idx, vel) {
  if (!playable()) return;
  initAudio();
  const h = harmonicChords()[idx];
  if (!h) return;
  playChordAudio(h, vel);
  chordEvent(h, vel, 'keys');
}
// Нажата ли клавиша этой ступени правой рукой. Раскладка зависит от режима
// (безопасное окно или фиксированные корни) и от комбо, поэтому проверка идёт
// по handNoteBalls() и INPUT.noteIndex(), а не по статической карте
// «клавиша = шар».
function ballKeyDown(b) {
  const hand = handNoteBalls();
  return Object.keys(state.keysDown).some(code => {
    if (!state.keysDown[code]) return false;
    const i = INPUT.noteIndex(code);
    return i !== -1 && hand[i] === b.idx;
  });
}
function triggerBall(b, vel, withAudio) {
  if (!b || !playable()) return;
  state.adaptive.lastNoteAt = performance.now();
  // MIDI-путь озвучивает ноту сам (echoNote) на реальной высоте, поэтому шар
  // в этом случае только показывает её на сцене, а не играет свою октаву.
  if (withAudio !== false) {
    initAudio();
    const pan = Math.cos(b.phi) * 0.55;
    const noteVel = vel == null ? 0.8 : vel;
    // Октава нот — сдвиг мелодии относительно высоты шара. Сам шар остаётся на
    // своей ступени, поэтому геометрия сцены не прыгает; удержание и запись
    // получают уже сдвинутую высоту.
    const midi = b.midi + (P.noteOct || 0) * 12;
    b.playMidi = midi;
    // Педаль удлиняет хвост колокола: разница слышна уже на одной ноте,
    // но затухание остаётся быстрым (CFG.pedalFadeMs / autoFadePedalVoice).
    bell(midi, noteVel, pan, null, 'note', P.sustain ? 0.65 : 0);
    // Нота не звучит одиноко, но аккорд не спешит: он появится только если
    // нота осталась одна (CFG.noteChordSettleMs). Быстрое арпеджио отменяет
    // предыдущий план, поэтому сменяющиеся трезвучия не наслаиваются.
    scheduleNoteChord(midi, noteVel, pan);
    // MIDI пишет ноту сам (реальная высота), а клавиатура — здесь.
    if (!state.replay && typeof recordNote === 'function') recordNote(midi, noteVel, pan, true);
    // Мелодическая статистика пьесы: путь клавиатуры/шара. MIDI-ноты, у которых
    // нет шара, учитывает Midi.noteOn(), поэтому двойного счёта нет.
    if (!state.replay && typeof Composition !== 'undefined') Composition.onNote(midi, noteVel);
  }
  // Под педалью нота остаётся висеть после отпускания клавиши (как на рояле),
  // но не бесконечно: sustainAt запускает авто-затухание в render.js.
  b.sustainLatch = withAudio !== false && !!P.sustain;
  b.sustainAt = b.sustainLatch ? performance.now() : 0;
  b.holdVel = vel == null ? 0.85 : vel;
  b.radius = 26;
  b.boost += P.boost / Math.max(0.05, P.tau);
  ripples.push({ x: b.x, y: b.y, color: b.color, start: performance.now(), big: false });
  const lastPcs = state.harmony.lastPcs || [];
  if (!state.replay && lastPcs.includes(b.pc)) {
    state.energy[b.idx] += 2;
    b.radius = 30;
    motes.push({ x: b.x, y: b.y, text: '+2', color: b.color, start: performance.now() });
  }
  updateHUD();
}
// Нажатие аккорда: подсветка карточки + звук. Общий путь для клавиатуры,
// экранного пэда и MIDI (code === null, когда код клавиши неизвестен).
function chordDown(code, idx, vel) {
  if (code) {
    lastChordAt[code] = performance.now();
    markChordCard(code, true);
  }
  playHarmonic(idx, vel);
}
function markNoteBadge(code, on) {
  const el = document.querySelector('#noteRow .key-badge[data-code="' + code + '"]');
  if (el) el.classList.toggle('held', !!on);
}
// Сдвиг мелодии на октаву: клавиши − / = и селектор «Звук → Октава нот».
// Высота шара и его место на сцене не меняются — сдвигается только звук.
function shiftNoteOctave(delta) {
  const limit = CFG.noteOctLimit || 1;
  const now = P.noteOct || 0;
  const next = clamp(now + delta, -limit, limit);
  if (next === now) {
    toast('Октава нот: ' + (now > 0 ? '+' : '') + now + ' — предел');
    return;
  }
  P.noteOct = next;
  if (typeof syncAll === 'function') syncAll();
  if (typeof updateHUD === 'function') updateHUD();
  toast('Октава нот: ' + (next > 0 ? '+' : '') + next);
}
function pressCode(code, vel) {
  if (!playable()) return;
  state.keysDown[code] = true;
  const hIdx = INPUT.chordIndex(code);
  if (hIdx !== -1) { chordDown(code, hIdx, vel); return; }
  const nIdx = INPUT.noteIndex(code);
  if (nIdx === -1) return;
  // Бейджи нот подсвечиваются тем же нажатием, что и карточки аккордов.
  markNoteBadge(code, true);
  const ballIdx = handNoteBalls()[nIdx];
  if (ballIdx != null) triggerBall(balls[ballIdx], vel);
}
function releaseCode(code) {
  state.keysDown[code] = false;
  if (INPUT.chord.has(code)) markChordCard(code, false);
  markNoteBadge(code, false);
  // Если anchor ждал именно эту клавишу, теперь можно безопасно перестроить
  // карточки и бейджи — уже после отпускания, а не под пальцем.
  scheduleAdaptiveApply();
}
