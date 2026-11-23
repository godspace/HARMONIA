/* HARMONIA · js/ui-hud.js — HUD, индикатор возврата, «Слышу», палитра, подсказки, пэд, тост
   Модуль без сборки: подключается <script> в index.html до main.js.
   Все модули делят глобальную область — имена функций/констант уникальны. */

// ===== Гармоническая панель: Q W E R F =====
let chordCards = [];
let chordHoldTimer = null;
let chordHoldCode = null;
function markChordCard(code, on) {
  if (!code) return;
  const card = chordCards.find(el => el.dataset.code === code);
  if (card) card.classList.toggle('active', !!on);
}
function clearActiveCards() {
  chordCards.forEach(card => card.classList.remove('active'));
}
function stopChordHold() {
  if (chordHoldTimer) { clearInterval(chordHoldTimer); chordHoldTimer = null; }
  // Мышиный пэд не проходит через keyup, поэтому отпускание карточки должно
  // снять и state.keysDown, и подсветку. Иначе зажатой навсегда осталась бы
  // «левая рука», а adaptive-раскладка больше не смогла бы перестроиться.
  if (chordHoldCode) {
    const code = chordHoldCode;
    chordHoldCode = null;
    releaseCode(code);
  }
  if (typeof scheduleAdaptiveApply === 'function') scheduleAdaptiveApply();
}
function startChordHold(code) {
  stopChordHold();
  chordHoldCode = code;
  pressCode(code);
  // Мышь/тап: удержание карточки повторяет аккорд тем же пульсом, что и клавиша.
  chordHoldTimer = setInterval(() => {
    if (!playable()) { stopChordHold(); return; }
    playHarmonic(INPUT.chordIndex(code));
  }, CFG.holdPulseMs);
}
function buildChordPad() {
  const pad = $('chordPad');
  const list = harmonicChords();
  pad.innerHTML = list.map(h =>
    `<button class="chord-card${h.tonic ? ' tonic' : ''}" data-code="${h.code}" data-deg="${h.degree.toLowerCase()}" title="${h.hint}: ${h.names.join('-')}">` +
      `<span class="cc-head"><span class="cc-deg">${h.degree}</span><span class="cc-key">${KEY_CAP[h.code]}</span></span>` +
      `<span class="cc-name">${h.name}</span>` +
    `</button>`).join('');
  chordCards = Array.from(pad.querySelectorAll('.chord-card'));
  chordCards.forEach(card => {
    card.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      card.classList.add('active');
      startChordHold(card.dataset.code);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
      card.addEventListener(ev, () => { card.classList.remove('active'); stopChordHold(); }));
    card.addEventListener('contextmenu', e => e.preventDefault());
  });
  paintChordPad();
}
// Q может сменить ступень без пересборки всего пэда: у пьесы цель такта
// меняется на границе такта, а у тренажёра — после сыгранного шага. Обновляем
// только текст карточки, чтобы не терять pointer-события и активное удержание.
function syncChordPadLabels() {
  if (!chordCards.length) return;
  const list = harmonicChords();
  if (list.length !== chordCards.length) return;
  chordCards.forEach((card, i) => {
    const h = list[i];
    if (!h) return;
    const deg = h.degree.toLowerCase();
    if (card.dataset.deg === deg) return;
    card.dataset.deg = deg;
    card.classList.toggle('tonic', !!h.tonic);
    card.title = h.hint + ': ' + h.names.join('-');
    const degEl = card.querySelector('.cc-deg');
    const nameEl = card.querySelector('.cc-name');
    if (degEl) degEl.textContent = h.degree;
    if (nameEl) nameEl.textContent = h.name;
  });
}
function paintChordPad() {
  if (!chordCards.length) return;
  syncChordPadLabels();
  const guide = combo().degrees[state.chordIndex].toLowerCase();
  // Прогресс шагов теперь живёт на самих карточках: чипсы из старого HUD
  // больше не нужны, а зелёная галочка показывает уже сыгранные ступени.
  const done = new Set();
  combo().degrees.forEach((deg, i) => { if (state.visited[i]) done.add(deg.toLowerCase()); });
  chordCards.forEach(card => {
    card.classList.toggle('next', card.dataset.deg === guide);
    card.classList.toggle('done', done.has(card.dataset.deg));
  });
}
function flashTonicCard() {
  const card = chordCards.find(el => el.classList.contains('tonic'));
  if (!card) return;
  card.classList.remove('home-flash');
  void card.offsetWidth;
  card.classList.add('home-flash');
  setTimeout(() => card.classList.remove('home-flash'), 700);
}
function flashTonicPanel() {
  const el = $('homePanel');
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 760);
}

// ===== Круг тональностей (навигация по комбо) =====
const SVGNS = 'http://www.w3.org/2000/svg';
let wheelNodes = [], wheelCenter = null, wheelSub = null;
function buildWheel() {
  const svg = $('fifthsWheel');
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  wheelNodes = [];
  const cx = 130, cy = 130, R = 103;
  const guide = document.createElementNS(SVGNS, 'circle');
  guide.setAttribute('cx', cx); guide.setAttribute('cy', cy); guide.setAttribute('r', R);
  guide.setAttribute('fill', 'none');
  guide.setAttribute('stroke', 'rgba(164,85,227,0.28)');
  guide.setAttribute('stroke-width', '1');
  guide.setAttribute('stroke-dasharray', '3 4');
  svg.appendChild(guide);
  ORDER[state.mode].forEach((id, i) => {
    const a = (-90 + i * 360 / ORDER[state.mode].length) * RAD;
    const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'wnode');
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('cx', x.toFixed(2)); c.setAttribute('cy', y.toFixed(2)); c.setAttribute('r', 16);
    const label = cap(noteLabel(COMBOS[id].chords[0][0])) + (state.mode === 'minor' ? 'm' : '');
    const t = document.createElementNS(SVGNS, 'text');
    t.setAttribute('x', x.toFixed(2)); t.setAttribute('y', (y + 3.4).toFixed(2));
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-size', label.length > 4 ? '7.6' : label.length > 3 ? '8.6' : '9.6');
    t.setAttribute('font-weight', '800');
    t.textContent = label;
    g.appendChild(c); g.appendChild(t);
    g.addEventListener('click', () => {
      loadCombo(i, true);
      toast('КОМБО ' + combo().id + ' · ' + keyNameOf(combo()));
    });
    svg.appendChild(g);
    wheelNodes.push({ g, c, t });
  });
  wheelCenter = document.createElementNS(SVGNS, 'text');
  wheelCenter.setAttribute('x', cx); wheelCenter.setAttribute('y', cy - 2);
  wheelCenter.setAttribute('text-anchor', 'middle');
  wheelCenter.setAttribute('font-size', '22'); wheelCenter.setAttribute('font-weight', '800');
  wheelCenter.setAttribute('fill', '#ffd166');
  svg.appendChild(wheelCenter);
  wheelSub = document.createElementNS(SVGNS, 'text');
  wheelSub.setAttribute('x', cx); wheelSub.setAttribute('y', cy + 18);
  wheelSub.setAttribute('text-anchor', 'middle');
  wheelSub.setAttribute('font-size', '10.5'); wheelSub.setAttribute('font-weight', '700');
  wheelSub.setAttribute('fill', '#9aa4c2');
  svg.appendChild(wheelSub);
}
function paintWheel() {
  wheelNodes.forEach((n, i) => {
    const cur = i === state.comboIdx;
    const played = state.played[state.mode][i];
    n.c.setAttribute('fill', cur ? '#ffd166' : played ? 'rgba(116,204,61,0.22)' : 'rgba(255,255,255,0.06)');
    n.c.setAttribute('stroke', cur ? '#ffd166' : played ? 'rgba(116,204,61,0.75)' : 'rgba(255,255,255,0.2)');
    n.c.setAttribute('stroke-width', cur ? '2.4' : '1.2');
    n.t.setAttribute('fill', cur ? '#12141d' : played ? '#74cc3d' : '#9aa4c2');
    n.g.style.filter = cur ? 'drop-shadow(0 0 7px rgba(255,209,102,0.85))' : 'none';
  });
  if (wheelCenter) {
    wheelCenter.textContent = '№' + combo().id;
    // Тональность словами — то, чего не хватало блоку «Комбо»: «№1» без
    // «До мажор» не говорит, в какой тональности играет колесо. Число после
    // точки — сколько комбо этого лада уже сыграно (зелёные узлы на круге).
    wheelSub.textContent = keyNameOf(combo()) + ' · ' +
      state.played[state.mode].filter(Boolean).length + '/' + ORDER[state.mode].length;
  }
}

// ===== HUD =====
let toastTimer = null;
function toast(msg, kind) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'show' + (kind ? ' ' + kind : '');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 1900);
}
// Индикатор «домой»: тоника пары, шкала накопленного напряжения и счётчик
// возвратов. Это замена правому блоку с названием аккорда и чипсами.
let homeFreshTimer = null;
function updateHomeIndicator() {
  const panel = $('homePanel');
  if (!panel) return;
  const c = combo();
  const tonicDeg = (c.degrees && c.degrees.length ? c.degrees[0] : 'I');
  const tonicNote = c.chords && c.chords[0] && c.chords[0][0] ? noteLabel(c.chords[0][0]) : '—';
  const steps = Math.max(0, Math.min(CFG.tonicStepCap, state.harmony.steps || 0));
  const phrase = harmonyPhraseBeauty(state.harmony.phrase || []);
  const bonus = CFG.tonicBonus * steps + phrase.points;
  const now = performance.now();
  const returnAge = state.harmony.lastReturnAt ? now - state.harmony.lastReturnAt : Infinity;
  const beautyAge = state.harmony.lastBeautyAt ? now - state.harmony.lastBeautyAt : Infinity;
  const fresh = returnAge < 1300;
  const beautyFresh = beautyAge < 1200;
  $('homeCount').textContent = '↩ ' + state.harmony.returns;
  $('homeTitle').textContent = state.harmony.steps > 0 ? 'Домой' : 'Тоника';
  $('homeDeg').textContent = tonicDeg;
  $('homeNote').textContent = tonicDeg + ' · ' + tonicNote;
  $('homeMeter').innerHTML = Array.from({ length: CFG.tonicStepCap }, (_, i) =>
    `<i class="${i < steps ? 'on' : ''}"></i>`).join('');
  $('homeStatus').textContent = steps > 0
    ? (beautyFresh ? 'красиво +' + state.harmony.lastBeauty + ' · ' : '') +
      'домой +' + bonus
    : fresh
      ? 'домой +' + state.harmony.lastBonus
      : beautyFresh
        ? 'красиво +' + state.harmony.lastBeauty
        : 'дома · всё разрешено';
  panel.classList.toggle('away', state.harmony.steps > 0);
  panel.classList.toggle('fresh', !!fresh);
  panel.classList.toggle('beauty', !!beautyFresh && !fresh);
  const left = Math.max(
    fresh ? 1300 - returnAge : 0,
    beautyFresh ? 1200 - beautyAge : 0
  );
  if (left > 0 && !homeFreshTimer) {
    homeFreshTimer = setTimeout(() => {
      homeFreshTimer = null;
      updateHUD();
    }, Math.min(1400, left + 80));
  }
  // Подсказка собрана через « · », а не точками: так её можно перевести по
  // частям (js/i18n.js) и не заводить шаблон на каждое сочетание счётчиков.
  panel.title = 'Возврат в тонику: ' +
    (steps > 0 ? 'напряжение ' + steps + '/' + CFG.tonicStepCap + ' · возврат даст +' + bonus : 'напряжения нет') +
    (phrase.points ? ' · бонус фразы +' + phrase.points : '') +
    ' · возвратов: ' + state.harmony.returns +
    (beautyFresh ? ' · последний переход дал +' + state.harmony.lastBeauty : '');
}
function noteOctSuffix() {
  const oct = P.noteOct || 0;
  return oct ? ' · октава ' + (oct > 0 ? '+' : '') + oct : '';
}
function updateNoteBadges() {
  const row = $('noteRow');
  if (!row) return;
  const hand = handNoteBalls();
  const palette = diatonicPalette();
  const anchor = P.smartHand ? palette[smartSongAnchor()] : null;
  row.querySelectorAll('.key-badge').forEach(el => {
    const code = el.dataset.code;
    const i = NOTE_KEYS.indexOf(code);
    if (i === -1) return;
    const ballIdx = hand[i];
    const b = ballIdx == null ? null : balls[ballIdx];
    const degree = ballIdx == null || !palette[ballIdx] ? '' : palette[ballIdx].degree;
    el.innerHTML = `<span class="k">${NOTE_CAP[code] || ''}</span><span class="t">${b ? b.name : '—'}</span>`;
    el.title = b
      ? `Правая рука: ${degree ? degree + ' · ' : ''}${b.name}${noteOctSuffix()}` +
        (anchor ? ' · окно от ' + anchor.degree : '')
      : 'Правая рука';
  });
}
// Ряд нот строится из NOTE_KEYS. В обоих режимах это одни и те же пять клавиш,
// меняется только смысл ступеней: безопасное окно или фиксированные корни.
function buildNoteRow() {
  const row = $('noteRow');
  if (!row) return;
  row.textContent = '';
  NOTE_KEYS.forEach(code => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'key-badge';
    btn.dataset.code = code;
    row.appendChild(btn);
  });
  const anchor = P.smartHand ? diatonicPalette()[smartSongAnchor()] : null;
  row.setAttribute('aria-label', P.smartHand
    ? 'Ноты правой руки — безопасное окно вокруг ступени ' + (anchor ? anchor.degree : '')
    : 'Ноты правой руки — пять фиксированных корней комбо');
  updateNoteBadges();
}
function updateNoteHints() {
  const el = $('noteHints');
  if (!el) return;
  el.innerHTML = NOTE_KEYS.map(code => `<kbd>${NOTE_CAP[code] || ''}</kbd>`).join(' ');
  const anchor = P.smartHand ? diatonicPalette()[smartSongAnchor()] : null;
  el.title = P.smartHand
    ? 'Пять безопасных нот вокруг текущего аккорда' +
      (anchor ? ': ' + anchor.degree + ' ' + anchor.name : '')
    : 'Пять фиксированных корней комбо';
}
function updateHUD() {
  $('scoreVal').textContent = state.score;
  // Тональность стоит рядом со счётом: счёт принадлежит комбо, а комбо — это
  // тональность («До мажор»). Так игрок видит, где он на круге, не открывая меню.
  const keyEl = $('comboKey');
  if (keyEl) keyEl.textContent = keyNameOf(combo());
  const cycleDone = state.played[state.mode][state.comboIdx];
  updateHomeIndicator();
  renderPalette();
  renderHint();
  updateHeardChip();
  paintSoundChip();
  updateNoteBadges();
  updateNoteHints();
  if ($('comboSel').value !== String(state.comboIdx)) $('comboSel').value = String(state.comboIdx);
  $('comboNext').classList.toggle('pulse', cycleDone && state.running && !state.paused);
  $('pNextCombo').classList.toggle('pulse', cycleDone && state.running && !state.paused);
  paintChordPad();
  paintWheel();
  if (typeof updateFormHUD === 'function') updateFormHUD();
  updateSpaceNext();
}
// ===== Напоминание о пробеле =====
// Очки игрок видит в левом верхнем углу, а кнопка перехода живёт внизу под
// аккордами — и после 300 очков её легко не заметить: руки заняты, взгляд на
// счёте. Рядом со счётом появляется короткая строка «Space · ещё N», после
// рубежа — «Space → новое комбо». Это не модальное окно и не тост (тост занят
// названием аккорда), а тихое напоминание в том месте, куда игрок и так смотрит.
// Блок счёта мягко подсвечивается на рубеже и ещё дважды, если игрок решил
// играть дальше; после третьего раза мигалка замолкает до смены комбо.
let spaceNudgeKey = '', spaceNudgeStage = 0, spaceNudgeTimer = null;
function resetSpaceNudge(key) {
  if (spaceNudgeTimer) { clearTimeout(spaceNudgeTimer); spaceNudgeTimer = null; }
  document.querySelectorAll('.score-box.attn, #spaceNext.attn')
    .forEach(el => el.classList.remove('attn'));
  spaceNudgeKey = key;
  spaceNudgeStage = 0;
}
function updateSpaceHint(ready, threshold) {
  const hint = $('spaceHint');
  const text = $('spaceHintText');
  if (!hint || !text) return;
  hint.classList.toggle('ready', !!ready);
  // До рубежа — сколько очков осталось, после — что именно сделает пробел.
  text.textContent = ready
    ? '→ новое комбо'
    : 'ещё ' + Math.max(0, threshold - Math.min(state.score, threshold));
}
function nudgeSpace(ready, threshold) {
  const key = state.mode + '#' + state.comboIdx;
  if (key !== spaceNudgeKey) resetSpaceNudge(key);
  if (!ready) return;
  // Этапы: рубеж, +половина рубежа, +рубеж. Дальше не напоминаем: игрок,
  // который сознательно тянет длинное комбо, не должен получать мигалку.
  const step = Math.max(1, Math.round(threshold / 2));
  const stage = Math.min(3, 1 + Math.floor((state.score - threshold) / step));
  if (stage <= spaceNudgeStage) return;
  spaceNudgeStage = stage;
  const targets = [document.querySelector('.score-box'), $('spaceNext')].filter(Boolean);
  targets.forEach(el => {
    el.classList.remove('attn');
    void el.offsetWidth;
    el.classList.add('attn');
  });
  if (spaceNudgeTimer) clearTimeout(spaceNudgeTimer);
  spaceNudgeTimer = setTimeout(() => {
    spaceNudgeTimer = null;
    targets.forEach(el => el.classList.remove('attn'));
  }, 3200);
}
// Кнопка Space под аккордами: до рубежа показывает прогресс, после —
// включает пульсацию готовности. Переход выполняет advanceCombo(), который
// сам проверяет порог, поэтому клик и клавиша идут одним путём.
function updateSpaceNext() {
  const btn = $('spaceNext');
  if (!btn || typeof nextComboTarget !== 'function') return;
  const target = nextComboTarget();
  const next = COMBOS[ORDER[target.mode][target.idx]];
  const threshold = CFG.comboAdvanceAt;
  const ready = typeof comboAdvanceReady === 'function' && comboAdvanceReady();
  btn.disabled = !ready;
  btn.classList.toggle('ready', ready);
  btn.dataset.mode = target.mode;
  const label = $('spaceNextText');
  const progress = $('spaceNextProgress');
  if (label) label.textContent = 'новое комбо · ' + keyNameOf(next);
  if (progress) progress.textContent = ready ? 'готово' : Math.min(state.score, threshold) + ' / ' + threshold;
  const hint = ready
    ? 'Пробел — перейти в КОМБО ' + next.id + ' · ' + keyNameOf(next)
    : 'После ' + threshold + ' очков пробел переключит на КОМБО ' + next.id + ' · ' + keyNameOf(next);
  btn.title = hint;
  btn.setAttribute('aria-label', hint);
  btn.setAttribute('aria-disabled', String(!ready));
  updateSpaceHint(ready, threshold);
  nudgeSpace(ready, threshold);
}
function fillComboSelect() {
  $('comboSel').innerHTML = ORDER[state.mode]
    .map((id, i) => `<option value="${i}">КОМБО ${id} · ${keyNameOf(COMBOS[id])}</option>`)
    .join('');
  $('comboSel').value = String(state.comboIdx);
}

// ===== Слух и импровизация в HUD =====
// «Слышу» — что приложение слышит прямо сейчас: ноты, аккорд и функция.
// Пока это честное отражение MIDI, а не догадка по нажатой клавише.
function updateHeardChip() {
  const el = $('heardVal');
  if (!el) return;
  const pcs = state.heard.pcs || [];
  const t = state.heard.triad;
  el.classList.toggle('live', pcs.length > 0);
  el.classList.toggle('pedal', !!state.heard.sustain);
  if (!pcs.length) { el.textContent = 'Слышу: —'; return; }
  const names = scaleNoteNames();
  const list = pcs.slice(0, 4).map(pc => names[pc] || sharpLabel(pc)).join('-') +
    (pcs.length > 4 ? ' …' : '');
  el.innerHTML = 'Слышу: <b>' + list + '</b>' +
    (t ? ' → <em>' + t.degree + '</em> · ' + t.hint : '');
}
// Палитра лада: семь ступеней и счётчик охвата. Сыгранная ступень гаснет как
// «изученная» — это и есть свободная импровизация без чек-листа комбо.
function renderPalette() {
  const el = $('palette');
  if (!el) return;
  const list = diatonicPalette();
  const used = state.explored || new Set();
  el.innerHTML = list.map(h => {
    const cls = 'pchip' + (used.has(h.degree) ? ' used' : '') + (h.tonic ? ' tonic' : '');
    return `<span class="${cls}" title="${h.hint}: ${h.name}">${h.degree}</span>`;
  }).join('') + `<span class="pcount">${used.size}/${list.length}</span>`;
}
// Подсказка «куда дальше»: два ближайших по общим тонам аккорда и тяготение
// функции. Совет считается из палитры, поэтому не знает про комбо шагов.
function renderHint() {
  const el = $('hintLine');
  if (!el) return;
  const act = state.harmony.lastTriad;
  const fresh = act && act.pcs && performance.now() - state.harmony.lastAt <= CFG.chordFadeMs;
  const palette = diatonicPalette();
  if (!fresh) { el.innerHTML = 'Играйте трезвучие — приложение назовёт функцию'; return; }
  if (!act.pcsKey) {
    el.innerHTML = 'Вне лада · <b>' + act.name + '</b>' +
      (act.kind === 'secondary' ? ' — вторичная доминанта' : '');
    return;
  }
  const near = palette.filter(h => h.pcsKey !== act.pcsKey)
    .map(h => ({ h, shared: h.pcs.filter(pc => act.pcs.includes(pc)).length }))
    .sort((a, b) => b.shared - a.shared)
    .slice(0, 2)
    .map(n => n.h.degree);
  const home = palette[0].degree;
  const pull = act.hint === 'доминанта' ? ' → ' + home
    : act.hint === 'субдоминанта' || act.hint === 'супертоника' ? ' → V'
    : '';
  el.innerHTML = 'Плавно: <b>' + near.join(' · ') + '</b>' + (pull ? ' · тянет' + pull : '');
}
// Кто звучит: ноутбук (контроллер без динамиков) или пианино (звучит само).
function paintSoundChip() {
  const el = $('soundChip');
  if (!el) return;
  el.textContent = state.echo ? '🔊 Ноутбук' : '🔈 Пианино';
  el.setAttribute('aria-pressed', String(!!state.echo));
  el.title = state.echo
    ? 'Ноты MIDI звучат с ноутбука — для контроллера без динамиков'
    : 'Приложение молчит: пианино звучит само (stage piano)';
}
function toggleSound(remember) {
  state.echo = !state.echo;
  if (remember && typeof Midi !== 'undefined') Midi.rememberEcho(state.echo);
  paintSoundChip();
  toast(state.echo ? 'Звук нот: ноутбук' : 'Звук нот: пианино');
}
