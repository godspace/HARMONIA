/* HARMONIA · js/harmony.js — гармония текущего комбо + кэш harmonicChords()
   Модуль без сборки: подключается <script> в index.html до main.js.
   Все модули делят глобальную область — имена функций/констант уникальны. */

// ===== Гармония: пять аккордов на пять клавиш =====
// Ступени подобраны так, чтобы для любого комбо COMBOLIST было ровно
// пять консонантных аккордов в его тональности:
//   мажор — ii, IV, V, vi, I;   минор (с гармонической доминантой) — III, iv, V, VI, i.
const SHARP_NAMES = ['до', 'до#', 'ре', 'ре#', 'ми', 'фа', 'фа#', 'соль', 'соль#', 'ля', 'ля#', 'си'];
const HARMONY = {
  major: [
    { code: 'KeyQ', degree: 'ii', offset: 2, third: 3, hint: 'супертоника' },
    { code: 'KeyW', degree: 'IV', offset: 5, third: 4, hint: 'субдоминанта' },
    { code: 'KeyE', degree: 'V',  offset: 7, third: 4, hint: 'доминанта' },
    { code: 'KeyR', degree: 'vi', offset: 9, third: 3, hint: 'субмедианта' },
    { code: 'KeyF', degree: 'I',  offset: 0, third: 4, tonic: true, hint: 'тоника' }
  ],
  minor: [
    { code: 'KeyQ', degree: 'III', offset: 3, third: 4, hint: 'медианта' },
    { code: 'KeyW', degree: 'iv',  offset: 5, third: 3, hint: 'субдоминанта' },
    { code: 'KeyE', degree: 'V',   offset: 7, third: 4, hint: 'доминанта' },
    { code: 'KeyR', degree: 'VI',  offset: 8, third: 4, hint: 'субмедианта' },
    { code: 'KeyF', degree: 'i',   offset: 0, third: 3, tonic: true, hint: 'тоника' }
  ]
};
const CHORD_CODES = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyF'];
const KEY_CAP = { KeyQ: 'Q', KeyW: 'W', KeyE: 'E', KeyR: 'R', KeyF: 'F' };
const lastChordAt = {};

// ===== Реестр ввода: единственное место, где физические коды → действия =====
// Клавиатура, экранные карточки и MIDI проходят через одни и те же действия,
// поэтому новая привязка добавляется только здесь (или в INPUT.commands).
// P/Q/R заняты руками, поэтому пауза — Escape, очистка — C, рестарт — 0.
// Space — переход в новое комбо после 300 очков; педаль живёт на кнопке панели
// и MIDI CC64.
const INPUT = {
  chord: new Map(CHORD_CODES.map((code, i) => [code, i])),
  noteIndex(code) {
    return NOTE_KEYS.indexOf(code);
  },
  commands: {
    Enter: 'next', Backspace: 'prev',
    // Стрелки: ←/→ — лад, ↑/↓ — комбо. Enter/Backspace остаются для комбо.
    ArrowUp: 'next', ArrowDown: 'prev', ArrowLeft: 'major', ArrowRight: 'minor',
    KeyM: 'mute', KeyC: 'clear', Escape: 'pause', Digit0: 'restart', Space: 'comboAdvance',
    Minus: 'octDown', Equal: 'octUp',
    // Цифры выбирают визуализацию напрямую: 1 — орбиты, 2 — спектр, 3 — круг.
    // Порядок совпадает с VIZ_ORDER.
    Digit1: 'viz1', Digit2: 'viz2', Digit3: 'viz3'
  },
  chordIndex(code) { return this.chord.has(code) ? this.chord.get(code) : -1; }
};

// Имена нот берём из самого комбо, чтобы в бемольных тональностях
// не появлялись диезы; для недостающих ступеней — диезный запас.
// Возвращает исходные (русские) имена CSV: нотация применяется при подписи,
// а не при разборе данных.
function comboNoteNames() {
  const c = combo(), map = {};
  c.chords.forEach((names, ci) => names.forEach((n, ni) => {
    const pc = c.triads[ci][ni];
    if (!(pc in map)) map[pc] = n;
  }));
  return map;
}
// Смена нотации меняет только подписи, но кэши держат уже готовые строки:
// их нужно сбросить, иначе HUD покажет имена в прежней нотации.
function resetNotationCaches() {
  scaleNameKey = '';
  scaleNameMap = null;
  paletteKey = '';
  harmonyKey = '';
  handKey = '';
}
// ===== Умная раскладка: пять безопасных нот из семи =====
// Правая рука не получает «все подряд» ступени: из семи нот лада выбираются
// пять так, чтобы под пальцами были тоны текущего аккорда, а самые острые
// столкновения (малая секунда и тритон) оставались за пределами окна.
// Окно не обязано быть непрерывным: для V в до мажоре это G-A-B-D-E, а не
// G-A-B-C-D, потому что C — «ловушка» над B. Физических клавиш по-прежнему
// пять: NOTE_KEYS не меняется.
const SMART_HAND_SIZE = 5;
const SMART_FIXED_DEGREES = {
  major: ['IV', 'V', 'vi', 'I'],
  minor: ['iv', 'V', 'VI', 'i']
};
// Интервальная «шершавость»: 1 — малая секунда/большая септима, 6 — тритон.
// Мягкие секунды и кварты почти не мешают, но всё же получают небольшой вес.
function smartIntervalTension(a, b) {
  const d = Math.abs((((a - b) % 12) + 12) % 12);
  const ic = Math.min(d, 12 - d);
  if (ic === 1) return 3.2;
  if (ic === 6) return 2.4;
  if (ic === 2) return 0.45;
  if (ic === 5) return 0.12;
  return 0;
}
function paletteIndexForChord(h) {
  if (!h || h.rootPc == null) return -1;
  return diatonicPalette().findIndex(slot => slot.rootPc === h.rootPc);
}
function smartSongAnchor() {
  const n = diatonicPalette().length || 1;
  const raw = state.adaptive && state.adaptive.anchor != null ? state.adaptive.anchor : 0;
  return ((Math.round(raw) % n) + n) % n;
}
function smartCombinations(n, k) {
  const out = [];
  const pick = (start, acc) => {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = start; i <= n - (k - acc.length); i++) {
      acc.push(i);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  pick(0, []);
  return out;
}
function smartTargetHarmony() {
  const degree = typeof smartTargetDegree === 'function' ? smartTargetDegree() : '';
  if (!degree) return null;
  return diatonicPalette().find(slot => slot.degree.toLowerCase() === String(degree).toLowerCase()) || null;
}
// Оценка набора из пяти ступеней. Чем больше тонов текущего аккорда и чем
// меньше острых интервалов к уже звучащим нотам, тем безопаснее окно.
function smartWindowScore(set, opts) {
  const palette = diatonicPalette();
  const chord = opts.chord;
  const chordPcs = chord && chord.pcs ? chord.pcs : [];
  const pcs = set.map(i => palette[i].rootPc);
  let score = 0;
  const chordHits = pcs.filter(pc => chordPcs.indexOf(pc) !== -1).length;
  score += chordHits * 18;
  if (chordPcs.length) score += chordHits * 4 / chordPcs.length;
  if (chord && chord.rootPc != null && pcs.indexOf(chord.rootPc) !== -1) score += 4;
  if (set.indexOf(opts.anchor) !== -1) score += 3;
  if (opts.target && opts.target.pcs) {
    score += pcs.filter(pc => opts.target.pcs.indexOf(pc) !== -1).length * 3;
    if (pcs.indexOf(opts.target.rootPc) !== -1) score += 2;
  }
  if (opts.prevPcs) {
    score += pcs.filter(pc => opts.prevPcs.indexOf(pc) !== -1).length * 4;
  }
  // Текущий аккорд уже звучит: его тоны — опора, а не источник трения.
  const sounding = chordPcs.slice();
  (opts.soundingPcs || []).forEach(pc => { if (sounding.indexOf(pc) === -1) sounding.push(pc); });
  pcs.forEach(pc => {
    if (chordPcs.indexOf(pc) !== -1) return;
    sounding.forEach(sp => { score -= smartIntervalTension(pc, sp) * 4; });
  });
  // Тритон внутри окна тоже слышен как «размытое» созвучие.
  for (let i = 0; i < pcs.length; i++) {
    for (let j = i + 1; j < pcs.length; j++) {
      const d = Math.abs((((pcs[i] - pcs[j]) % 12) + 12) % 12);
      if (Math.min(d, 12 - d) === 6) score -= 0.8;
    }
  }
  return score;
}
// Пять индексов палитры в порядке высоты. opts.chord задаёт гармонию, от
// которой считается безопасность; без opts функция строит окно от аккорда
// самой ступени anchor — так её можно проверять без побочных эффектов.
function smartNoteWindow(anchorIdx, opts) {
  const palette = diatonicPalette();
  const n = palette.length;
  if (!n) return [];
  const a = ((Math.round(anchorIdx == null ? smartSongAnchor() : anchorIdx) % n) + n) % n;
  if (n <= SMART_HAND_SIZE) return palette.map((_, i) => i);
  const options = opts || {};
  const chord = options.chord && options.chord.pcs ? options.chord : palette[a];
  const target = options.target === undefined ? smartTargetHarmony() : options.target;
  const prev = options.prev;
  const prevPcs = prev && prev.length
    ? prev.map(i => palette[i] && palette[i].rootPc).filter(pc => pc != null)
    : null;
  const candidates = smartCombinations(n, SMART_HAND_SIZE);
  let best = null, bestScore = -Infinity;
  candidates.forEach(set => {
    const score = smartWindowScore(set, {
      chord, target, anchor: a, prevPcs,
      soundingPcs: options.soundingPcs || (chord && chord.pcs) || []
    });
    if (score > bestScore) { best = set; bestScore = score; }
  });
  return (best || candidates[0]).slice();
}
// Diminished-аккорд — проходящий, а не новый центр. Он не двигает anchor на
// уменьшённую ступень: окно и Q остаются на устойчивой функции с общими тонами.
function smartAnchorForChord(h) {
  const palette = diatonicPalette();
  const direct = paletteIndexForChord(h);
  if (direct === -1) return -1;
  const slot = palette[direct];
  if (slot.fifth !== 6) return direct;
  const current = smartSongAnchor();
  let best = current, bestScore = -Infinity;
  palette.forEach((cand, i) => {
    if (cand.fifth === 6) return;
    let score = cand.pcs.filter(pc => h.pcs.indexOf(pc) !== -1).length * 10;
    if (i === current) score += 3;
    if (cand.hint === slot.hint) score += 4;
    if (cand.hint === 'доминанта') score += 1;
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return best;
}
// Какая адаптивная ступень сядет на Q. Цель тренажёра/пьесы имеет приоритет,
// но не ценой заведомо уменьшённого аккорда: среди оставшихся ступеней
// выбирается та, что делит больше тонов с текущим аккордом и правой рукой.
function smartAdaptiveDegree(anchorIdx, targetDegree) {
  const palette = diatonicPalette();
  const fixed = SMART_FIXED_DEGREES[state.mode] || SMART_FIXED_DEGREES.major;
  const target = targetDegree
    ? palette.find(slot => slot.degree.toLowerCase() === String(targetDegree).toLowerCase())
    : null;
  const candidates = palette.filter(slot => fixed.indexOf(slot.degree) === -1);
  if (!candidates.length) return palette[0].degree;
  const anchorChord = palette[smartSongAnchor()] || palette[0];
  const current = state.harmony && state.harmony.lastTriad && state.harmony.lastTriad.pcs
    ? state.harmony.lastTriad : anchorChord;
  const window = state.adaptive && state.adaptive.window && state.adaptive.window.length
    ? state.adaptive.window
    : smartNoteWindow(anchorIdx);
  const windowPcs = window.map(i => palette[i] && palette[i].rootPc).filter(pc => pc != null);
  let best = candidates[0], bestScore = -Infinity;
  candidates.forEach(h => {
    let score = 0;
    if (target && h.degree.toLowerCase() === target.degree.toLowerCase()) score += 80;
    // Уменьшённое трезвучие само по себе звучит напряжённо: без явной цели
    // предпочитаем консонансный вариант.
    score += h.fifth === 6 ? -18 : 12;
    score += harmonyCommonTones(current, h) * 6;
    score += harmonyCommonTones(anchorChord, h) * 2;
    score += h.pcs.filter(pc => windowPcs.indexOf(pc) !== -1).length * 3;
    score += harmonyTransitionBeauty(current, h, 0).raw * 0.6;
    if (harmonyRootStep(anchorChord, h) === 6) score -= 8;
    if (h.hint === 'субдоминанта' || h.hint === 'супертоника') score += 2;
    // Полутоновые и тритоновые столкновения с текущим аккордом — минус.
    h.pcs.forEach(pc => {
      if (current.pcs.indexOf(pc) !== -1) return;
      current.pcs.forEach(cp => { score -= smartIntervalTension(pc, cp) * 2; });
    });
    if (score > bestScore) { best = h; bestScore = score; }
  });
  return best.degree;
}
// Пять ступеней левой руки в smart-режиме: Q — адаптивная, W/E/R/F — якоря
// IV/V/vi/I (в миноре iv/V/VI/i), чтобы привычные функции оставались на месте.
function smartChordDegrees(anchorIdx, targetDegree) {
  const fixed = SMART_FIXED_DEGREES[state.mode] || SMART_FIXED_DEGREES.major;
  return [smartAdaptiveDegree(anchorIdx, targetDegree)].concat(fixed);
}
// Цель для Q: во время пьесы — её цель такта, иначе — следующий шаг тренажёра.
// Функция живёт в harmony.js, но Composition/state читаются только в момент
// вызова, когда все модули уже подключены.
function smartTargetDegree() {
  if (state.form && state.form.enabled && state.form.running &&
      state.form.phase === 'playing' && typeof Composition !== 'undefined') {
    const goal = Composition.targetForBar(state.form.bar || 1);
    if (goal && goal.degree) return goal.degree;
  }
  return combo().degrees[state.chordIndex];
}
function adaptiveChordList() {
  const palette = diatonicPalette();
  const target = smartTargetDegree();
  const degrees = smartChordDegrees(smartSongAnchor(), target);
  return degrees.map((degree, i) => {
    const h = palette.find(slot => slot.degree.toLowerCase() === degree.toLowerCase());
    if (!h) return null;
    return Object.assign({}, h, {
      code: CHORD_CODES[i],
      key: KEY_CAP[CHORD_CODES[i]]
    });
  }).filter(Boolean);
}
let harmonyKey = '';
let harmonyList = [];
function harmonicChords() {
  // Кэш: функция зовётся из HUD, ввода и MIDI — пересчёт только при смене
  // лада/комбо, режима правой руки, anchor, безопасного окна или звучащего
  // аккорда (Q зависит от общих тонов с ним).
  const chordKey = state.harmony && state.harmony.lastTriad
    ? harmonyPcsKey(state.harmony.lastTriad) : '';
  const modeKey = P.smartHand
    ? 'smart:' + smartSongAnchor() + ':' + smartTargetDegree() + ':' +
      (state.adaptive.window || []).join(',') + ':' + chordKey
    : 'roots';
  const key = state.mode + '#' + state.comboIdx + '#' + (usingLetterNames() ? 'letters' : 'sol') +
    '#' + modeKey;
  if (key === harmonyKey) return harmonyList;
  if (P.smartHand) {
    harmonyList = adaptiveChordList();
  } else {
    const c = combo(), base = c.root, map = comboNoteNames();
    harmonyList = HARMONY[state.mode].map(slot => {
      const rootPc = (base + slot.offset) % 12;
      const pcs = [0, slot.third, 7].map(iv => (rootPc + iv) % 12);
      // map хранит имена CSV; недостающие ступени берём по pitch class.
      const names = pcs.map(pc => map[pc] || sharpLabel(pc));
      return Object.assign({}, slot, {
        rootPc, pcs, names,
        name: chordLabel(names)
      });
    });
  }
  harmonyKey = key;
  return harmonyList;
}

// ===== Лад целиком: семь трезвучий, классификация и роли нот =====
// Комбо задаёт тональность и четыре шага тренажёра. Импровизация живёт шире:
// в ладу семь трезвучий, и у каждого своя функция. hint — тот же язык, что
// у HARMONY, поэтому цвет функции (vizChordColor) работает и здесь.
// fifth = 6 только у уменьшённых: vii° в мажоре и ii°/vii° в гармоническом миноре.
const PALETTE_SLOTS = {
  major: [
    { degree: 'I',    offset: 0,  third: 4, fifth: 7, hint: 'тоника',      tonic: true },
    { degree: 'ii',   offset: 2,  third: 3, fifth: 7, hint: 'супертоника' },
    { degree: 'iii',  offset: 4,  third: 3, fifth: 7, hint: 'медианта' },
    { degree: 'IV',   offset: 5,  third: 4, fifth: 7, hint: 'субдоминанта' },
    { degree: 'V',    offset: 7,  third: 4, fifth: 7, hint: 'доминанта' },
    { degree: 'vi',   offset: 9,  third: 3, fifth: 7, hint: 'субмедианта' },
    { degree: 'vii°', offset: 11, third: 3, fifth: 6, hint: 'доминанта' }
  ],
  minor: [
    { degree: 'i',    offset: 0,  third: 3, fifth: 7, hint: 'тоника',      tonic: true },
    { degree: 'ii°',  offset: 2,  third: 3, fifth: 6, hint: 'субдоминанта' },
    { degree: 'III',  offset: 3,  third: 4, fifth: 7, hint: 'медианта' },
    { degree: 'iv',   offset: 5,  third: 3, fifth: 7, hint: 'субдоминанта' },
    { degree: 'V',    offset: 7,  third: 4, fifth: 7, hint: 'доминанта' },
    { degree: 'VI',   offset: 8,  third: 4, fifth: 7, hint: 'субмедианта' },
    { degree: 'vii°', offset: 11, third: 3, fifth: 6, hint: 'доминанта' }
  ]
};
// Четыре формы трезвучий: [терция, квинта]. По ним классифицируется всё, что
// пришло с MIDI, — без таблицы «какая клавиша какой аккорд».
const TRIAD_SHAPES = [
  { quality: 'maj', third: 4, fifth: 7 },
  { quality: 'min', third: 3, fifth: 7 },
  { quality: 'dim', third: 3, fifth: 6 },
  { quality: 'aug', third: 4, fifth: 8 }
];
// Семь тонов лада: объединение трезвучий комбо (I, IV, V покрывают все ступени).
function scalePcs() {
  const pcs = [];
  combo().triads.forEach(triad => triad.forEach(pc => {
    if (pcs.indexOf(pc) === -1) pcs.push(pc);
  }));
  return pcs;
}
// Имена семи ступеней берём из самого комбо: CSV хранит правильное написание
// (до/ре♭/соль#), поэтому в палитре нет случайных диезов. Подпись проходит через
// noteLabel(), поэтому в буквенной нотации карта сразу содержит C/D♭/G♯.
let scaleNameKey = '', scaleNameMap = null;
function scaleNoteNames() {
  const key = state.mode + '#' + state.comboIdx + '#' + (usingLetterNames() ? 'letters' : 'sol');
  if (key === scaleNameKey) return scaleNameMap;
  const c = combo(), t = c.triads, sn = c.scaleNames, map = {};
  const put = (k, pc) => { if (!(pc in map)) map[pc] = noteLabel(sn[k]); };
  put(1, t[0][0]); put(3, t[0][1]); put(5, t[0][2]);
  put(4, t[1][0]); put(6, t[1][1]);
  put(7, t[2][1]); put(2, t[2][2]);
  scaleNameKey = key; scaleNameMap = map;
  return map;
}
// Палитра импровизации: семь аккордов лада с именами, функциями и цветом.
let paletteKey = '', paletteList = [];
function diatonicPalette() {
  const key = state.mode + '#' + state.comboIdx + '#' + (usingLetterNames() ? 'letters' : 'sol');
  if (key === paletteKey) return paletteList;
  const c = combo(), base = ((c.root % 12) + 12) % 12, map = scaleNoteNames();
  paletteList = PALETTE_SLOTS[state.mode].map((slot, i) => {
    const rootPc = (base + slot.offset) % 12;
    const pcs = [0, slot.third, slot.fifth].map(iv => (rootPc + iv) % 12);
    const names = pcs.map(pc => map[pc] || sharpLabel(pc));
    return Object.assign({ idx: i, kind: 'diatonic' }, slot, {
      rootPc, pcs, names, name: chordLabel(names),
      pcsKey: pcs.slice().sort((a, b) => a - b).join(',')
    });
  });
  paletteKey = key;
  return paletteList;
}
// ===== Правая рука: пять безопасных нот =====
// smart — окно из пяти безопасных ступеней (по умолчанию), roots — прежние
// корни пяти аккордов пэда. Обе раскладки используют одни и те же пять клавиш,
// поэтому сцена и бейджи остаются согласованными.
let handKey = '', handBalls = [];
function handNoteBalls() {
  const mode = P.smartHand ? 'smart' : 'roots';
  const saved = state.adaptive && state.adaptive.window ? state.adaptive.window : null;
  const key = state.mode + '#' + state.comboIdx + '#' +
    (mode === 'smart'
      ? mode + ':' + smartSongAnchor() + ':' + (saved ? saved.join(',') : '') +
        ':' + smartTargetDegree()
      : mode);
  if (key === handKey) return handBalls;
  const palette = diatonicPalette();
  if (mode === 'smart') {
    // Окно уже упорядочено снизу вверх. Пока первая смена аккорда не пришла,
    // строим его на месте от текущего anchor — без записи в state.
    handBalls = saved && saved.length ? saved.slice() : smartNoteWindow();
  } else {
    handBalls = harmonicChords()
      .map(h => palette.findIndex(slot => slot.rootPc === h.rootPc))
      .filter(i => i !== -1)
      .sort((a, b) => palette[a].offset - palette[b].offset);
  }
  handKey = key;
  return handBalls;
}
// Аккорд, «висящий» на одной ноте: диатоническое трезвучие с этим корнем.
// У всех семи ступеней лада такой аккорд есть, поэтому одиночная нота шара
// всегда может звучать трезвучием — как аккорд левой руки.
function chordOnDegree(pc) {
  const p = ((pc % 12) + 12) % 12;
  return diatonicPalette().find(h => h.rootPc === p) || null;
}
// Гармония, под которую сейчас играет правая рука. В smart-режиме это последний
// реально сыгранный аккорд (левая рука или MIDI), а не догадка по одной ноте.
// false — сигнал «аккорд не добавлять»: нота образует с текущим трезвучием
// малую секунду или тритон, и пауза звучит чище, чем спор двух функций.
function smartHarmonyForNote(pc) {
  if (!P.smartHand || !state.adaptive) return null;
  const h = state.harmony.lastTriad;
  if (!h || !h.pcs || (h.kind && h.kind !== 'diatonic')) return null;
  const p = ((pc % 12) + 12) % 12;
  if (h.pcs.indexOf(p) !== -1) return h;
  let tension = 0;
  h.pcs.forEach(cp => { tension += smartIntervalTension(p, cp); });
  return tension >= 3 ? false : h;
}
// Классифицируем любой набор из трёх pitch classes. Возвращает корень, форму и
// канонический порядок тонов; null — если это не трезвучие (две ноты, кластер).
// Увеличенное трезвучие симметрично, поэтому корнем выбираем тон лада.
function classifyTriad(pcs) {
  const set = [];
  (pcs || []).forEach(raw => {
    const pc = ((raw % 12) + 12) % 12;
    if (set.indexOf(pc) === -1) set.push(pc);
  });
  if (set.length !== 3) return null;
  const scale = scalePcs(), cands = [];
  set.forEach(rootPc => TRIAD_SHAPES.forEach(shape => {
    if (set.indexOf((rootPc + shape.third) % 12) === -1) return;
    if (set.indexOf((rootPc + shape.fifth) % 12) === -1) return;
    cands.push({
      rootPc, third: shape.third, fifth: shape.fifth, quality: shape.quality,
      pcs: [rootPc, (rootPc + shape.third) % 12, (rootPc + shape.fifth) % 12]
    });
  }));
  if (!cands.length) return null;
  return cands.filter(cd => scale.indexOf(cd.rootPc) !== -1)[0] || cands[0];
}
// Описание сыгранного: ступень лада, вторичная доминанта или краска вне лада.
// Результат — тот же объект, что у harmonicChords(), поэтому chordEvent()
// принимает его без ветвлений.
function describeTriad(pcs) {
  const triad = classifyTriad(pcs);
  if (!triad) return { kind: 'unknown', pcs: (pcs || []).slice() };
  const palette = diatonicPalette();
  const key = triad.pcs.slice().sort((a, b) => a - b).join(',');
  const hit = palette.find(h => h.pcsKey === key);
  if (hit) return Object.assign({ kind: 'diatonic' }, hit);
  const names = scaleNoteNames();
  const list = triad.pcs.map(pc => names[pc] || sharpLabel(pc));
  const formName = usingLetterNames()
    ? (triad.quality === 'maj' ? 'major' : triad.quality === 'min' ? 'minor'
      : triad.quality === 'dim' ? 'diminished' : 'augmented')
    : (triad.quality === 'maj' ? 'мажор' : triad.quality === 'min' ? 'минор'
      : triad.quality === 'dim' ? 'уменьшённое' : 'увеличенное');
  const out = {
    kind: 'chroma', degree: 'краска', hint: 'краска', quality: triad.quality,
    rootPc: triad.rootPc, third: triad.third, fifth: triad.fifth,
    pcs: triad.pcs, names: list, name: cap(list[0]) + ' ' + formName
  };
  // Мажорное трезвучие на квинту выше ступени лада — вторичная доминанта (V/x).
  if (triad.quality === 'maj') {
    const target = palette.find(h => h.rootPc === (triad.rootPc + 5) % 12);
    if (target) {
      out.kind = 'secondary';
      out.degree = 'V/' + target.degree;
      out.hint = 'доминанта';
    }
  }
  return out;
}
// Роль ноты относительно звучащего аккорда: тон аккорда, ступень лада или краска.
function noteRole(pc, chordPcs) {
  const p = ((pc % 12) + 12) % 12;
  if ((chordPcs || []).some(c => ((c % 12) + 12) % 12 === p)) return 'chord';
  return scalePcs().indexOf(p) !== -1 ? 'scale' : 'outside';
}
// ===== Оценка музыкальной последовательности =====
// Это не «угадай порядок комбо», а оценка того, как аккорды соединяются:
// функция (T/S/D), общие тоны (голосоведение), движение корней и разрешение
// вводного тона. Первый аккорд фразы тоже получает небольшой зачин, поэтому
// начать с ii/IV не менее выгодно, чем с тоники. Повтор пары ослабляется:
// state.harmony.moves хранит последние переходы, а не всю историю.
function harmonyFunction(h) {
  if (!h) return 'unknown';
  if (h.tonic) return 'tonic';
  if (h.hint === 'доминанта') return 'dominant';
  if (h.hint === 'субдоминанта' || h.hint === 'супертоника') return 'predominant';
  if (h.hint === 'медианта' || h.hint === 'субмедианта') return 'mediant';
  return 'color';
}
// Расстояние между корнями по кратчайшей дуге: 0…6 полутонов.
function harmonyRootStep(a, b) {
  if (!a || !b || a.rootPc == null || b.rootPc == null) return 6;
  const d = Math.abs((((b.rootPc - a.rootPc) % 12) + 12) % 12);
  return Math.min(d, 12 - d);
}
function harmonyCommonTones(a, b) {
  if (!a || !b || !a.pcs || !b.pcs) return 0;
  const seen = new Set();
  return a.pcs.filter(pc => {
    if (seen.has(pc)) return false;
    seen.add(pc);
    return b.pcs.indexOf(pc) !== -1;
  }).length;
}
function harmonyPcsKey(h) {
  if (!h || !h.pcs) return '';
  return h.pcsKey || h.pcs.slice().sort((a, b) => a - b).join(',');
}
function harmonyTransitionKey(a, b) {
  return harmonyPcsKey(a) + '>' + harmonyPcsKey(b);
}
// Возвращает { points, label, raw, factor }. raw — «идеальная» оценка перехода,
// factor — ослабление за повтор этой же пары в последних ходах.
function harmonyTransitionBeauty(prev, next, repeatCount) {
  const empty = { points: 0, label: '', raw: 0, factor: 1 };
  if (!prev || !next || !prev.pcs || !next.pcs) return empty;
  if (prev.kind === 'chroma' || next.kind === 'chroma') return empty;
  if (harmonyPcsKey(prev) === harmonyPcsKey(next)) return empty;
  const B = CFG.beauty;
  const pf = harmonyFunction(prev), nf = harmonyFunction(next);
  let pts = B.base;
  if (next.tonic) {
    if (pf === 'dominant') pts += B.authentic;
    else if (pf === 'predominant') pts += B.plagal;
    else pts += B.tonic;
  } else if (pf === 'dominant' && nf === 'mediant') {
    pts += B.deceptive;
  } else if (pf === 'predominant' && nf === 'dominant') {
    pts += B.preparation;
  } else if (nf === 'dominant') {
    pts += B.dominant;
  } else if (nf === 'predominant') {
    pts += B.subdominant;
  }
  pts += harmonyCommonTones(prev, next) * B.common;
  const step = harmonyRootStep(prev, next);
  if (step === 5) pts += B.fifth;
  else if (step <= 2) pts += B.step;
  else if (step === 6) pts += B.tritone;
  // Вводный тон VII ступени, уходящий в тонику, — самое слышимое тяготение.
  const tonicPc = ((combo().root % 12) + 12) % 12;
  const leadingPc = (tonicPc + 11) % 12;
  if (prev.pcs.indexOf(leadingPc) !== -1 && next.pcs.indexOf(tonicPc) !== -1) {
    pts += B.leading;
  }
  const repeats = Math.max(0, repeatCount || 0);
  const factor = Math.max(B.repeatFloor, 1 / (1 + repeats * B.repeatPenalty));
  const points = Math.max(0, Math.round(Math.min(B.max, pts) * factor));
  const from = prev.degree || prev.hint || '?';
  const to = next.degree || next.hint || '?';
  return { points, label: from + ' → ' + to, raw: Math.max(0, pts), factor };
}
// Зачин фразы: ii/IV — это подготовка, а не «недостача» очков.
function harmonyOpeningBeauty(h) {
  if (!h || h.tonic || h.kind === 'chroma') return { points: 0, label: '' };
  const points = harmonyFunction(h) === 'predominant' ? CFG.beauty.opening : 0;
  return { points, label: points ? 'зачин ' + h.degree : '' };
}
// Бонус к возврату в тонику: разнообразие фразы и наличие S→D внутри неё.
// Сам возврат остаётся отдельным событием, поэтому база не теряется.
function harmonyPhraseBeauty(phrase) {
  const list = phrase || [];
  if (!list.length) return { points: 0, label: '' };
  const B = CFG.beauty;
  const keys = new Set(list.map(harmonyPcsKey).filter(Boolean));
  const funcs = new Set(list.map(harmonyFunction));
  let points = keys.size * B.phraseUnique;
  if (funcs.has('predominant') && funcs.has('dominant')) points += B.phraseArc;
  points = Math.min(B.phraseCap, points);
  const degrees = [];
  list.forEach(h => { if (h.degree && degrees.indexOf(h.degree) === -1) degrees.push(h.degree); });
  return { points, label: degrees.length ? 'фраза ' + degrees.join(' → ') : 'фраза' };
}
// Самопроверка слуха: 48 форм (12 корней × 4 трезвучия) классифицируются,
// палитра замкнута на себя, роли нот определены. Вызывается из vizDebug().
function harmonyDebug() {
  let triads = 0, missed = 0;
  for (let root = 0; root < 12; root++) {
    TRIAD_SHAPES.forEach(shape => {
      triads++;
      const found = classifyTriad([root, (root + shape.third) % 12, (root + shape.fifth) % 12]);
      // Увеличенное трезвучие симметрично: другой корень — не ошибка.
      if (!found || found.quality !== shape.quality) missed++;
      else if (found.rootPc !== root && shape.quality !== 'aug') missed++;
    });
  }
  const palette = diatonicPalette();
  const roundTrip = palette.filter(h => {
    const d = describeTriad(h.pcs);
    return d.kind === 'diatonic' && d.degree === h.degree && d.rootPc === h.rootPc;
  }).length;
  const tonic = palette[0];
  const nonChord = scalePcs().find(pc => tonic.pcs.indexOf(pc) === -1);
  const outside = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].find(pc => scalePcs().indexOf(pc) === -1);
  return {
    triads, missed,
    palette: palette.length,
    paletteRoundTrip: roundTrip === palette.length,
    distinctChords: new Set(palette.map(h => h.pcsKey)).size === palette.length,
    rootOnStation: palette.every(h => h.pcs[0] === h.rootPc),
    roles: {
      chord: noteRole(tonic.pcs[0], tonic.pcs) === 'chord',
      scale: nonChord != null && noteRole(nonChord, tonic.pcs) === 'scale',
      outside: outside != null && noteRole(outside, tonic.pcs) === 'outside'
    }
  };
}

