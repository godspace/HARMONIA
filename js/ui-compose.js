/* HARMONIA · js/ui-compose.js — панель и HUD необязательной формы
   Свободный джем не меняется: пока state.form.enabled = false, HUD скрыт,
   а транспорт не запущен. Все элементы формы строятся из CFG.composition. */

let formBarCells = [];
let formBeatCells = [];
let formSectionEls = [];

function buildFormHud() {
  const sectionsEl = $('formSections');
  const barsEl = $('formBars');
  if (!sectionsEl || !barsEl) return;
  sectionsEl.textContent = '';
  barsEl.textContent = '';
  formSectionEls = [];
  formBarCells = [];

  CFG.composition.sections.forEach(sec => {
    const el = document.createElement('span');
    el.className = 'form-section-label sec-' + sec.id;
    el.style.flex = String(sec.to - sec.from + 1);
    el.textContent = sec.label;
    el.title = 'Такты ' + sec.from + '–' + sec.to + ' · ' + sec.hint;
    sectionsEl.appendChild(el);
    formSectionEls.push(el);
  });

  for (let bar = 1; bar <= Composition.totalBars(); bar++) {
    const sec = Composition.sectionForBar(bar);
    const cell = document.createElement('i');
    cell.className = 'sec-' + sec.id;
    cell.title = 'Такт ' + bar + ' · ' + sec.label + ' · ' + sec.hint;
    barsEl.appendChild(cell);
    formBarCells.push(cell);
  }

  buildFormBeats();
  paintFormToggle();
  updateFormHUD();
}

function buildFormBeats() {
  const el = $('formBeats');
  if (!el) return;
  const bpb = Number(state.transport.beatsPerBar) === 3 ? 3 :
    (Number(P.formMeter) === 3 ? 3 : 4);
  el.textContent = '';
  formBeatCells = [];
  for (let i = 0; i < bpb; i++) {
    const dot = document.createElement('i');
    el.appendChild(dot);
    formBeatCells.push(dot);
  }
}

function formTargetKey(h) {
  if (!h) return '';
  if (h.pcsKey) return h.pcsKey;
  return Array.isArray(h.pcs) ? h.pcs.slice().sort((a, b) => a - b).join(',') : '';
}
// Подпись на карточке переводится сразу, а не ждёт MutationObserver: иначе
// paintFormTargets() на каждой доле возвращал бы русское слово в английский DOM.
function formTargetLabel(value) {
  return typeof I18N !== 'undefined' && I18N.enabled() &&
    typeof I18N.text === 'function' ? I18N.text(value) : value;
}
// Единственная подсказка «сейчас → дальше» живёт на карточках и
// мини-клавиатурах внизу сцены:
//   • current — цель звучащего такта, бейдж «сейчас»;
//   • upcoming — следующая цель, бейдж «дальше»;
//   • prep — вторая половина такта: у следующей карточки тёплая подложка;
//   • hit — цель такта уже взята, бейдж «✓».
// После попадания «дальше» не загорается сразу: первая половина такта остаётся
// у текущего аккорда, чтобы его можно было послушать. Верхний HUD только
// показывает прогресс, поэтому взгляд не раздваивается.
// Ничего не звучит и не начисляется: paint только показывает состояние.
function paintFormTargets(target, next, phase) {
  const playing = phase === 'playing';
  const countin = phase === 'countin';
  const current = playing || phase === 'paused' ? target : null;
  const upcoming = countin || playing ? (countin ? target : next) : null;
  const currentKey = formTargetKey(current);
  const nextKey = formTargetKey(upcoming);
  const same = !!nextKey && nextKey === currentKey;
  const hit = !!state.form.barTargetHit;
  const cueOpen = typeof Composition !== 'undefined' &&
    typeof Composition.nextCueOpen === 'function' && Composition.nextCueOpen();
  const showNext = !!upcoming && !same && (countin || (playing && cueOpen));
  document.body.classList.toggle('form-prep', showNext);

  if (chordCards.length) {
    chordCards.forEach(card => {
      const key = card.dataset.pcsKey || '';
      const isCurrent = !!currentKey && key === currentKey;
      const isNext = !!nextKey && key === nextKey && !isCurrent;
      const showCurrent = isCurrent && (playing || phase === 'paused');
      card.classList.toggle('form-current', showCurrent);
      card.classList.toggle('form-next', isNext && showNext);
      card.classList.toggle('form-hit', isCurrent && hit && playing);
      let label = '';
      if (showCurrent) label = hit && playing ? '✓' : 'сейчас';
      else if (isNext && showNext) label = 'дальше';
      card.dataset.formCue = label === '✓' ? 'hit' :
        label === 'сейчас' ? 'now' : label === 'дальше' ? 'next' : '';
      const cue = card.querySelector('.cc-cue');
      const shown = label ? formTargetLabel(label) : '';
      if (cue && cue.textContent !== shown) cue.textContent = shown;
    });
  }
  const kmHost = $('keyMap');
  if (kmHost) {
    const currentPcs = current && Array.isArray(current.pcs)
      ? current.pcs.slice().sort((a, b) => a - b).join(',') : '';
    const nextPcs = upcoming && Array.isArray(upcoming.pcs)
      ? upcoming.pcs.slice().sort((a, b) => a - b).join(',') : '';
    kmHost.querySelectorAll('.km-item').forEach(item => {
      const key = item.dataset.pcs || '';
      item.classList.toggle('form-current', !!currentPcs && key === currentPcs);
      item.classList.toggle('form-next',
        !!nextPcs && key === nextPcs && key !== currentPcs && showNext);
    });
  }
}

function paintFormToggle() {
  const on = !!(state.form && state.form.enabled);
  const btn = $('formBtn');
  const panel = $('formToggle');
  if (btn) {
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? '🎼 Форма: пьеса' : '🎼 Форма: выкл';
  }
  if (panel) {
    panel.setAttribute('aria-pressed', String(on));
    panel.textContent = on ? 'Форма: пьеса включена' : 'Форма: свободный джем';
  }
  const stop = $('formStop');
  if (stop) stop.disabled = !on;
  const restart = $('formRestart');
  if (restart) {
    restart.textContent = state.form.phase === 'done' ? '↻ Ещё раз' :
      (state.form.running ? '↻ Начать заново' : '↻ Начать пьесу');
  }
}

function updateFormHUD() {
  const hud = $('formHud');
  paintFormToggle();
  if (!hud) return;
  const on = !!(state.form && state.form.enabled);
  hud.classList.toggle('on', on);
  document.body.classList.toggle('form-mode', on);
  if (!on) {
    const offStatus = $('formStatus');
    if (offStatus) offStatus.textContent = 'Свободный джем. Форма включится только по кнопке.';
    paintFormTargets(null, null, 'off');
    return;
  }

  const phase = state.form.phase;
  const bpb = Number(state.transport.beatsPerBar) === 3 ? 3 : (Number(P.formMeter) === 3 ? 3 : 4);
  const totalBars = Composition.totalBars();
  const cueBar = Math.max(1, state.form.bar || 1);
  const cueTarget = Composition.targetForBar(phase === 'countin' ? 1 : cueBar);
  const cueNext = phase === 'playing' ? Composition.nextTargetForBar(cueBar) : null;
  if (formBeatCells.length !== bpb) buildFormBeats();

  const tempo = $('formTempo');
  const pos = $('formPos');
  const secEl = $('formSection');
  const status = $('formStatus');
  const awardEl = $('formAward');

  if (tempo) tempo.textContent = `${state.transport.bpm || P.formBpm} BPM · ${bpb}/4`;

  if (phase === 'countin') {
    // Отсчёт может занимать 1 или 2 такта: показываем номер доли от общего
    // числа долей отсчёта, а не всегда «/4».
    const count = Math.max(1, state.form.countInBeat || 1);
    const totalCount = Math.max(count,
      Number(Transport.countInBeats) || (Number(P.formCountIn) || 1) * bpb);
    if (pos) pos.textContent = `Отсчёт ${count}/${totalCount}`;
    if (secEl) secEl.textContent = 'Отсчёт';
    if (status) status.textContent = `Отсчёт ${count}/${totalCount}. Пьеса начнётся с такта 1.`;
  } else if (phase === 'paused') {
    if (pos) pos.textContent = `Пауза · такт ${state.form.bar}/${totalBars}`;
    if (secEl) secEl.textContent = Composition.sectionForBar(Math.max(1, state.form.bar)).label;
    if (status) status.textContent = `Пауза · такт ${state.form.bar}/${totalBars}. Продолжение — с того же места.`;
  } else if (phase === 'done') {
    if (pos) pos.textContent = `${totalBars}/${totalBars} · финал`;
    if (secEl) secEl.textContent = 'Кода';
    if (status) status.textContent = `Пьеса завершена · форма +${state.form.points}. Можно начать ещё раз или вернуться в джем.`;
  } else {
    const bar = Math.max(1, state.form.bar || 1);
    const sec = Composition.sectionForBar(bar);
    if (pos) pos.textContent = `Такт ${bar}/${totalBars} · ${state.form.beat || 1}/${bpb}`;
    if (secEl) secEl.textContent = sec.label + (state.form.barTargetHit ? ' ✓' : '');
    if (status) status.textContent = `Пьеса: такт ${bar}/${totalBars} · ${sec.label}.`;
  }

  if (awardEl) {
    const award = state.form.lastAward;
    awardEl.textContent = award && performance.now() - award.at < 1200
      ? `+${award.points} · ${award.label}` : '';
  }

  const currentBar = state.form.bar || 0;
  const done = phase === 'done';
  formBarCells.forEach((cell, i) => {
    const bar = i + 1;
    cell.classList.toggle('done', done || bar < currentBar || (bar === currentBar && state.form.barTargetHit));
    cell.classList.toggle('current', !done && phase !== 'countin' && bar === currentBar);
  });
  formSectionEls.forEach(el => {
    const sec = CFG.composition.sections.find(s => el.classList.contains('sec-' + s.id));
    if (!sec) return;
    el.classList.toggle('active', !done && state.form.sectionId === sec.id);
    el.classList.toggle('done', done || currentBar > sec.to);
  });
  formBeatCells.forEach((dot, i) => {
    dot.classList.toggle('on', phase !== 'done' && phase !== 'countin' && i < (state.form.beat || 0));
  });
  paintFormTargets(cueTarget, cueNext, phase);
}


// Возврат в джем/перезапуск не должен оставлять на полосе тактов след
// прошлой пьесы: пересобираем HUD до старта, иначе текущий такт старой
// формы успевает мигнуть на новой.
function resetFormHud() {
  buildFormHud();
  formSectionEls.forEach(el => el.classList.remove('active', 'done'));
  formBarCells.forEach(cell => cell.classList.remove('current', 'done'));
  formBeatCells.forEach(dot => dot.classList.remove('on'));
  const award = $('formAward');
  if (award) award.textContent = '';
}

function setFormEnabled(on) {
  if (!on) {
    Composition.stop(true);
    resetFormHud();
    updateFormHUD();
    return;
  }
  state.form.enabled = true;
  resetFormHud();
  if (!state.started) {
    beginFromOverlay();
    if (!state.form.running) Composition.start();
  } else if (state.form.running) {
    Composition.restart();
  } else {
    Composition.start();
  }
  updateFormHUD();
}

// Итог пьесы рисуется отдельно от показа: смена языка/нотации (translate.js →
// applyLanguageNotation) перерисовывает открытый экран, иначе в нём остались бы
// названия нот прежней нотации.
function renderFormResult() {
  const result = $('formResult');
  if (!result) return false;
  const score = $('formResultScore');
  const melodyEl = $('formResultMelody');
  const list = $('formResultSections');
  const kicker = $('formResultKicker');
  const totalBars = Composition.totalBars();
  if (kicker) kicker.textContent = `Форма · ${totalBars} ${totalBars === 1 ? 'такт' : 'тактов'}`;
  if (score) score.textContent = 'Форма +' + state.form.points;
  if (melodyEl) {
    const melody = state.form.melody || { notes: 0, noteMin: null, noteMax: null, pcs: new Set() };
    if (!melody.notes) {
      melodyEl.textContent = 'Мелодия: нот не было — пьеса держалась на аккордах.';
    } else {
      const lo = midiNoteName(melody.noteMin);
      const hi = midiNoteName(melody.noteMax);
      const range = lo === hi ? lo : lo + '–' + hi;
      melodyEl.innerHTML = `Мелодия: <b>${melody.notes}</b> нот · диапазон <b>${range}</b>` +
        ` · разных звуков <b>${melody.pcs.size}</b>`;
    }
  }
  if (list) {
    list.textContent = '';
    state.form.summaries.forEach(s => {
      const row = document.createElement('div');
      row.className = 'fr-row';
      const name = document.createElement('span');
      name.className = 'fr-name';
      name.textContent = s.label;
      const meta = document.createElement('span');
      meta.className = 'fr-meta';
      meta.textContent = `${s.bars} т. · цели ${s.hits}/${s.bars} · аккордов ${s.chords}` +
        (s.notes ? ` · нот ${s.notes}` : '');
      const points = document.createElement('b');
      points.textContent = '+' + s.points;
      row.append(name, meta, points);
      list.appendChild(row);
    });
  }
  return true;
}

function showFormResult() {
  const result = $('formResult');
  if (!result) return;
  if (!renderFormResult()) return;
  result.classList.add('show');
  result.setAttribute('aria-hidden', 'false');
  const again = $('formResultAgain');
  if (again) again.focus();
}

function hideFormResult() {
  const result = $('formResult');
  if (!result) return;
  result.classList.remove('show');
  result.setAttribute('aria-hidden', 'true');
}

// DOM-привязки формы живут в отдельной функции: её вызывает main.js после
// разбора страницы, поэтому скрипт можно грузить в <head> без гонки с разметкой.
function initCompose() {
  $('formBtn').addEventListener('click', () => setFormEnabled(!state.form.enabled));
  $('formToggle').addEventListener('click', () => setFormEnabled(!state.form.enabled));
  $('formRestart').addEventListener('click', () => {
    if (!state.started) setFormEnabled(true);
    else {
      state.form.enabled = true;
      Composition.restart();
    }
  });
  $('formStop').addEventListener('click', () => setFormEnabled(false));
  $('formResultAgain').addEventListener('click', () => {
    hideFormResult();
    state.form.enabled = true;
    Composition.restart();
  });
  $('formResultJam').addEventListener('click', () => setFormEnabled(false));

  // ===== Привязки панели =====
  // binding helpers объявлены в ui-panel.js, поэтому скрипт подключается после него.
  bindRange('formBpm', 'formBpmOut', 'formBpm', 1, v => v + ' BPM', () => {
    Transport.setBpm(P.formBpm);
    updateFormHUD();
  });
  bindSelect('formMeter', 'formMeter', v => parseInt(v, 10), () => {
    if (state.form.running && Transport.beatsPerBar !== Number(P.formMeter)) Composition.restart();
    else updateFormHUD();
  });
  bindSelect('formCountIn', 'formCountIn', v => parseInt(v, 10), updateFormHUD);
  bindToggle('formMetronome', 'formMetronome', 'Метроном: вкл', 'Метроном: выкл', () => {
    Transport.setMetronome(!!P.formMetronome);
    updateFormHUD();
  });
}

