/* HARMONIA · js/station.js — характер станции: подача гармонии по паре комбо
   Модуль без сборки: подключается <script> в index.html до main.js.
   Все модули делят глобальную область — имена функций/константы уникальны.

   Зачем этот слой. 24 комбо — это 12 пар (мажор и минор одного ключевого знака)
   на кварто-квинтовом круге. Внутри пары звучит один и тот же материал, а между
   станциями менялась только высота: те же пять функций, та же закрытая позиция
   пэда, ближайший бас, одна октава и два тембра. Из-за этого дальние станции
   слышались как «то же самое, транспонированное», и переход не читался как
   приезд в другое место.

   Что меняет характер — только подачу:
     · voicing  — расположение голосов пэда (закрыто / широко / первая инверсия /
                  децима);
     · bass     — позиция баса (ближайшая / корень / квинта / терция);
     · register — октава станции (0 или +12);
     · touch    — огибающая и яркость колокола (bell / glass / felt / pluck);
     · gesture  — жест атаки: блок, вверх, вниз, арфа, искры (задержки голосов).
   Ни один звуковой класс не добавляется и не убирается: пэд по-прежнему играет
   ровно {корень, терция, квинта} тональности, а правая рука — то же безопасное
   окно из пяти ступеней. Поэтому гарантия «почти любая нота звучит красиво»
   остаётся доказанной, а не ослабленной: smoke-шаг `station-style` проверяет
   набор pitch class у каждого аккорда каждой станции.

   Пара 0 (до мажор / ля минор) — эталон: `neutral` повторяет прежний звук один
   в один, чтобы было с чем сравнивать. Соседние станции различаются минимум
   по двум осям, иначе шаг по кругу снова звучал бы одинаково. */

// Подача колокола: множители огибающей, яркости и реверб-посыла. Единица —
// прежний звук; поэтому neutral не требует отдельной ветки в audio.js.
const STATION_TOUCH = {
  bell:  { decay: 1.00, tone: 1.00, wet: 1.00 }, // тело и хвост как раньше
  glass: { decay: 0.72, tone: 1.35, wet: 0.80 }, // короче, ярче, суше — «стекло»
  felt:  { decay: 1.55, tone: 0.70, wet: 1.25 }, // длиннее, темнее, объёмнее — «войлок»
  pluck: { decay: 0.50, tone: 1.10, wet: 0.45 }  // почти без хвоста — «щипок»
};

// Жест атаки пэда: те же три голоса {корень, терция, квинта}, но с разной
// задержкой удара. Это не ноты и не ритм: меняется только момент, в который
// звучит каждый голос внутри одного аккорда. delays — миллисекунды по порядку
// высоты (низкий → средний → высокий), поэтому один и тот же рисунок сам
// подстраивается под любую позицию аккорда.
const STATION_GESTURES = {
  neutral: { id: 'block',       label: 'блок',           delays: [0, 0, 0] },
  wide:    { id: 'up',          label: 'вверх',          delays: [0, 45, 90] },
  shimmer: { id: 'sparkle',     label: 'искры',          delays: [0, 22, 58] },
  felt:    { id: 'down',        label: 'вниз',           delays: [95, 50, 0] },
  wood:    { id: 'harp',        label: 'арфа',           delays: [0, 82, 40] },
  deep:    { id: 'deep-up',     label: 'глубокий вверх', delays: [0, 75, 150] },
  ice:     { id: 'snap',        label: 'щелчок',         delays: [0, 0, 38] },
  pulse:   { id: 'pulse',       label: 'пульс',          delays: [0, 70, 25] },
  bronze:  { id: 'slow-down',   label: 'медленный вниз', delays: [130, 75, 0] },
  air:     { id: 'slow-up',     label: 'медленный вверх', delays: [0, 105, 180] },
  velvet:  { id: 'middle',      label: 'середина',       delays: [0, 62, 30] },
  crystal: { id: 'crystal',     label: 'кристалл',       delays: [25, 0, 68] }
};
// Сюжет меняет не только голоса, но и рисунок удара: уход «разворачивает»
// аккорд вверх, поворот — вниз, тень собирает его почти в кластер, возврат
// снова ведёт к свету. Это по-прежнему только задержки, а не другие ноты.
const STATION_PLOT_GESTURES = {
  departure: [0, 50, 100],
  turn:      [85, 40, 0],
  shadow:    [0, 0, 45],
  return:    [0, 65, 125]
};

// Эталон: закрытая позиция, ближайший бас, своя октава, прежний колокол.
// Именно это играл playChordAudio до появления характеров.
const STATION_NEUTRAL = {
  id: 'neutral', label: 'эталон',
  voicing: 'closed', bass: 'nearest', register: 0, touch: 'bell'
};

// 12 станций в порядке пар COMBOLIST (кварто-квинтовый круг). Индекс — это
// state.comboIdx, а не строка таблицы: мажор и минор одной пары делят характер,
// различаясь только ладом. Соседи по кругу отличаются минимум по двум осям.
const STATION_STYLES = [
  { id: 'neutral', label: 'эталон',   voicing: 'closed', bass: 'nearest', register: 0,  touch: 'bell' },
  { id: 'wide',    label: 'широко',   voicing: 'spread', bass: 'root',    register: 0,  touch: 'bell' },
  { id: 'shimmer', label: 'мерцание', voicing: 'closed', bass: 'fifth',   register: 12, touch: 'glass' },
  { id: 'felt',    label: 'войлок',   voicing: 'first',  bass: 'nearest', register: 0,  touch: 'felt' },
  { id: 'wood',    label: 'дерево',   voicing: 'tenth',  bass: 'root',    register: 0,  touch: 'pluck' },
  { id: 'deep',    label: 'глубина',  voicing: 'spread', bass: 'fifth',   register: 12, touch: 'felt' },
  { id: 'ice',     label: 'лёд',      voicing: 'closed', bass: 'nearest', register: 0,  touch: 'glass' },
  { id: 'pulse',   label: 'пульс',    voicing: 'first',  bass: 'root',    register: 12, touch: 'pluck' },
  { id: 'bronze',  label: 'бронза',   voicing: 'tenth',  bass: 'fifth',   register: 0,  touch: 'bell' },
  { id: 'air',     label: 'воздух',   voicing: 'spread', bass: 'nearest', register: 12, touch: 'pluck' },
  { id: 'velvet',  label: 'бархат',   voicing: 'closed', bass: 'root',    register: 0,  touch: 'felt' },
  { id: 'crystal', label: 'хрусталь', voicing: 'first',  bass: 'fifth',   register: 12, touch: 'glass' }
];

// ===== Сюжет станции: фазы и архетипы =====
// Пара задаёт не только тембр, но и маленькую драматургию. Аккорды игрока
// переводят станцию из «дома» в уход/поворот/тень и обратно; это не таймер и
// не фиксированная последовательность, а реакция на гармонию. Сюжет меняет
// только подачу: расположение голосов, позицию баса и предпочтение широкого
// окна правой руки. Набор pitch class остаётся тем же, поэтому безопасность
// smart-окна не ослабляется.
const STATION_PLOT_PHASES = {
  home:      { id: 'home',      label: 'дом',     motif: '1–3–5' },
  departure: { id: 'departure', label: 'уход',    motif: '1–5–6–5' },
  turn:      { id: 'turn',      label: 'поворот', motif: '5–7–2–5' },
  shadow:    { id: 'shadow',    label: 'тень',    motif: '6–1–3–6' },
  return:    { id: 'return',    label: 'возврат', motif: '5–3–1' }
};
// phases — надстройка над STATION_STYLES. Поле spread — мягкий перевес в
// сторону более широкого окна правой руки (0…1.5), а не смена безопасных нот.
const STATION_PLOT_ARCHETYPES = {
  flat: {
    id: 'flat', label: 'ровно', phases: {}
  },
  arch: {
    id: 'arch', label: 'арка',
    phases: {
      home:      { voicing: 'closed', bass: 'root',    spread: 0,   motif: '1–3–5' },
      departure: { voicing: 'spread', bass: 'nearest', spread: 1,   motif: '1–5–6–5' },
      turn:      { voicing: 'first',  bass: 'fifth',   spread: 1,   motif: '5–7–2–5' },
      shadow:    { voicing: 'first',  bass: 'third',   spread: 0,   motif: '6–1–3–6' },
      return:    { voicing: 'closed', bass: 'root',    spread: 0.5, motif: '5–3–1' }
    }
  },
  drift: {
    id: 'drift', label: 'дрейф',
    phases: {
      home:      { voicing: 'spread', bass: 'root',    spread: 1,   motif: '1–5–3–5' },
      departure: { voicing: 'spread', bass: 'nearest', spread: 1.5, motif: '1–3–6–5' },
      turn:      { voicing: 'first',  bass: 'fifth',   spread: 1,   motif: '5–7–3–5' },
      shadow:    { voicing: 'first',  bass: 'third',   spread: 0,   motif: '6–3–1–6' },
      return:    { voicing: 'spread', bass: 'root',    spread: 1,   motif: '5–1–3–1' }
    }
  },
  pedal: {
    id: 'pedal', label: 'педаль',
    phases: {
      home:      { voicing: 'closed', bass: 'root',  spread: 0,   motif: '1–1–5–1' },
      departure: { voicing: 'spread', bass: 'root',  spread: 1,   motif: '1–5–1–6' },
      turn:      { voicing: 'first',  bass: 'root',  spread: 0.5, motif: '1–7–1–5' },
      shadow:    { voicing: 'closed', bass: 'root',  spread: 0,   motif: '1–6–1–3' },
      return:    { voicing: 'closed', bass: 'root',  spread: 0,   motif: '1–5–1' }
    }
  },
  descent: {
    id: 'descent', label: 'спуск',
    phases: {
      home:      { voicing: 'tenth',  bass: 'root',    spread: 1, motif: '1–5–3–1' },
      departure: { voicing: 'first',  bass: 'nearest', spread: 0, motif: '3–5–6–5' },
      turn:      { voicing: 'closed', bass: 'root',    spread: 0, motif: '5–7–2–5' },
      shadow:    { voicing: 'first',  bass: 'third',   spread: 0, motif: '6–3–1–6' },
      return:    { voicing: 'tenth',  bass: 'root',    spread: 1, motif: '5–3–1' }
    }
  },
  call: {
    id: 'call', label: 'зов',
    phases: {
      home:      { voicing: 'closed', bass: 'root',    spread: 0,   motif: '1–3–1–5' },
      departure: { voicing: 'spread', bass: 'nearest', spread: 1,   motif: '1–5–3–5' },
      turn:      { voicing: 'first',  bass: 'fifth',   spread: 1,   motif: '5–2–7–5' },
      shadow:    { voicing: 'closed', bass: 'third',   spread: 0,   motif: '6–1–6–3' },
      return:    { voicing: 'closed', bass: 'root',    spread: 0.5, motif: '5–1–5–1' }
    }
  },
  breath: {
    id: 'breath', label: 'вдох',
    phases: {
      home:      { voicing: 'closed', bass: 'root',  spread: 0,   motif: '1–3–1' },
      departure: { voicing: 'tenth',  bass: 'root',  spread: 1,   motif: '1–5–1–6' },
      turn:      { voicing: 'first',  bass: 'fifth', spread: 0.5, motif: '5–7–5' },
      shadow:    { voicing: 'tenth',  bass: 'third', spread: 0,   motif: '6–1–6' },
      return:    { voicing: 'closed', bass: 'root',  spread: 0,   motif: '1–5–1' }
    }
  }
};
// Архетип следует за характером пары: у каждой станции свой сюжет, но
// мажор/минор одной пары делят его. Первая пара — эталон, поэтому flat.
const STATION_PLOT_BY_STYLE = {
  neutral: 'flat',
  wide: 'drift',
  shimmer: 'pedal',
  felt: 'arch',
  wood: 'breath',
  deep: 'descent',
  ice: 'call',
  pulse: 'breath',
  bronze: 'descent',
  air: 'drift',
  velvet: 'arch',
  crystal: 'pedal'
};

// Строка таблицы по номеру пары. Отрицательные и большие индексы заворачиваются:
// loadCombo уже держит comboIdx в диапазоне, но чистые функции не должны падать.
function stationStyleAt(idx) {
  const n = STATION_STYLES.length;
  // Без числа (undefined/NaN) — эталон: функция не должна падать на опечатке.
  const i = Number.isFinite(idx) ? ((Math.round(idx) % n) + n) % n : 0;
  return STATION_STYLES[i];
}
// Принудительная подача для прослушивания: P.stationStyle = 'auto' — характер
// следует за парой, иначе — id строки (например, 'felt' или 'neutral').
function stationStyleById(id) {
  if (!id) return null;
  if (id === STATION_NEUTRAL.id) return STATION_NEUTRAL;
  for (let i = 0; i < STATION_STYLES.length; i++) {
    if (STATION_STYLES[i].id === id) return STATION_STYLES[i];
  }
  return null;
}
function stationStyleFor(idx) {
  const forced = P.stationStyle && P.stationStyle !== 'auto'
    ? stationStyleById(P.stationStyle) : null;
  return forced || stationStyleAt(idx);
}
// ===== Сюжет: чтение и обновление фаз =====
function stationPlotEnabled() {
  return P.stationPlot !== 'off' && P.stationPlot !== false;
}
function stationPlotPhase() {
  const phase = state.stationPlot && state.stationPlot.phase;
  return STATION_PLOT_PHASES[phase] ? phase : 'home';
}
// Фаза — чистая функция от аккорда и предыдущего: тоника возвращает домой
// (если пришли с доминанты — это возврат), субдоминанта уводит, доминанта
// поворачивает, медианта/субмедианта даёт тень, краска и вторичная доминанта
// работают как поворот. Никакого таймера здесь нет.
function stationPlotForChord(h, prev) {
  if (!h) return 'home';
  if (h.kind === 'chroma' || h.kind === 'secondary') return 'turn';
  if (h.tonic) {
    if (prev && (prev.hint === 'доминанта' || prev.kind === 'secondary')) return 'return';
    return 'home';
  }
  if (h.hint === 'субдоминанта' || h.hint === 'супертоника') return 'departure';
  if (h.hint === 'доминанта') return 'turn';
  if (h.hint === 'медианта' || h.hint === 'субмедианта') return 'shadow';
  return 'home';
}
// Архетип пары. Принудительный P.stationStyle тоже меняет сюжет: так удобно
// слушать один характер на всех станциях. P.stationPlot = 'off' отключает
// надстройку, оставляя только базовый STATION_STYLES.
function stationPlotArchetype(idx) {
  if (!stationPlotEnabled()) return STATION_PLOT_ARCHETYPES.flat;
  const style = stationStyleFor(idx == null ? state.comboIdx : idx);
  const id = STATION_PLOT_BY_STYLE[style.id] || 'flat';
  return STATION_PLOT_ARCHETYPES[id] || STATION_PLOT_ARCHETYPES.flat;
}
// Подача с учётом фазы. phaseOverride нужен для звука аккорда: playHarmonic
// знает новую фазу до того, как chordEvent запишет её в state. Возвращается
// новый объект, базовая строка STATION_STYLES не мутируется.
function stationPlotStyle(idx, phaseOverride) {
  const base = stationStyleFor(idx == null ? state.comboIdx : idx);
  const plot = stationPlotArchetype(idx);
  if (plot.id === 'flat') return base;
  const phase = STATION_PLOT_PHASES[phaseOverride] ? phaseOverride : stationPlotPhase();
  const over = plot.phases && plot.phases[phase];
  if (!over) return base;
  return Object.assign({}, base, {
    plotId: plot.id,
    plotLabel: plot.label,
    phase,
    voicing: over.voicing || base.voicing,
    bass: over.bass || base.bass,
    motif: over.motif || ''
  });
}
function stationPlotStyleForChord(h, prev, idx) {
  return stationPlotStyle(idx, stationPlotForChord(h, prev));
}
function stationPlotWindowBias(idx, phaseOverride) {
  if (!stationPlotEnabled()) return 0;
  const plot = stationPlotArchetype(idx);
  const phase = STATION_PLOT_PHASES[phaseOverride] ? phaseOverride : stationPlotPhase();
  const over = plot.phases && plot.phases[phase];
  const value = over && Number(over.spread);
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1.5, Math.min(1.5, value));
}
// Строка HUD: «арка · уход · 1–5–6–5». Для flat сюжет не меняет звук, поэтому
// показываем только «ровно · дом»; при выключенном сюжете строки нет.
function stationPlotText() {
  if (!stationPlotEnabled()) return '';
  const plot = stationPlotArchetype();
  const phase = STATION_PLOT_PHASES[stationPlotPhase()];
  if (plot.id === 'flat') return plot.label + ' · ' + STATION_PLOT_PHASES.home.label;
  const over = plot.phases && plot.phases[phase.id];
  return plot.label + ' · ' + phase.label +
    (over && over.motif ? ' · ' + over.motif : '');
}
// Записать новый аккорд в сюжет. Вызывается из chordEvent до Research.onChord,
// чтобы исследование видело уже новую phase и lastPhase. В replay не зовётся.
function stationPlotAdvance(h, prev) {
  if (!state.stationPlot) stationPlotReset();
  const p = state.stationPlot;
  const from = stationPlotPhase();
  const next = stationPlotForChord(h, prev);
  p.lastPhase = from;
  p.phase = next;
  p.chords = (p.chords || 0) + 1;
  p.homeStreak = next === 'home' || next === 'return' ? (p.homeStreak || 0) + 1 : 0;
  if (next === 'return') p.returns = (p.returns || 0) + 1;
  if (!Array.isArray(p.history)) p.history = [];
  p.history.push(next);
  if (p.history.length > 24) p.history.shift();
  p.archetype = stationPlotArchetype().id;
  return next;
}
function stationPlotReset() {
  if (!state.stationPlot) state.stationPlot = {};
  const p = state.stationPlot;
  p.archetype = stationPlotArchetype().id;
  p.phase = 'home';
  p.lastPhase = 'home';
  p.chords = 0;
  p.homeStreak = 0;
  p.returns = 0;
  p.history = [];
}
// Ручное A/B: 'off' оставляет только характер пары, 'auto' возвращает сюжет.
function setStationPlot(mode) {
  P.stationPlot = mode === 'off' ? 'off' : 'auto';
  stationPlotReset();
  if (typeof updateHUD === 'function' && state.started) updateHUD();
  return P.stationPlot;
}
// Октава станции: 0 или +12. rootMidi() прибавляет её к тонике, поэтому вся
// станция (шары, пэд, бас, мелодия) звучит выше, а геометрия сцены остаётся
// относительной: радиусы считаются от верхней ступени текущего комбо.
function stationRegister(idx) {
  const style = stationStyleFor(idx == null ? state.comboIdx : idx);
  return style.register === 12 ? 12 : 0;
}
// Расположение голосов пэда. Возвращает тройки [midi, gain, pan], где gain —
// множитель к velocity аккорда. Набор pitch class у всех позиций одинаковый:
//   closed — корень, терция, квинта (прежний звук);
//   spread — корень, квинта, терция через октаву (шире, «открытее»);
//   first  — терция в басу, корень и квинта выше (первая инверсия);
//   tenth  — корень на октаву ниже, квинта и терция сверху (децима).
function stationPadVoices(h, T, offset, style) {
  const st = style || stationStyleFor(state.comboIdx);
  const root = T + 12 + offset;
  const third = h.third == null ? 4 : h.third;
  const fifth = h.fifth || 7;
  switch (st.voicing) {
    case 'spread':
      return [[root, 1, -0.32], [root + fifth, 0.82, 0], [root + third + 12, 0.82, 0.32]];
    case 'first':
      // Терция в басу звучит мягче, поэтому нижний голос чуть громче корня.
      return [[root + third - 12, 0.95, -0.32], [root, 0.9, 0], [root + fifth, 0.82, 0.32]];
    case 'tenth':
      return [[root - 12, 1, -0.32], [root + fifth, 0.78, 0], [root + third + 12, 0.8, 0.32]];
    default:
      return [[root, 1, -0.32], [root + third, 0.82, 0], [root + fifth, 0.82, 0.32]];
  }
}
// Позиция баса в полутонах от BASS-октавы (P.bassOct уже учтён вызывающим).
//   nearest — ближайшая к тонике позиция корня (прежнее поведение);
//   root    — корень без инверсий: бас ведёт себя как «блок-аккорды»;
//   fifth   — в басу квинта, аккорд мягче и «пустее»;
//   third   — в басу терция, ближе к первой инверсии.
// Все варианты остаются в пределах октавы от тоники, поэтому бас не уезжает
// в неразборчивый низ.
function stationBassOffset(h, offset, style) {
  const st = style || stationStyleFor(state.comboIdx);
  if (st.bass === 'root') return offset;
  // На тонике квинта в басу звучит как «пустой» аккорд без дома. Поэтому
  // fifth на тонике возвращает корень: остальные ступени сохраняют характер,
  // а точка возврата снова слышится как точка возврата.
  if (st.bass === 'fifth') {
    if (h && h.tonic) return offset;
    return ((offset + (h.fifth || 7) + 6) % 12) - 6;
  }
  if (st.bass === 'third') return ((offset + (h.third == null ? 4 : h.third) + 6) % 12) - 6;
  return offset > 6 ? offset - 12 : offset;
}
// Подача колокола текущей станции — множители к BELL_TIMBRES. Сюжет пока не
// меняет touch, но читает его через ту же подачу: будущая фаза с другим
// тембром не потребует второй ветки в audio.js.
function stationShape() {
  const st = typeof stationPlotStyle === 'function'
    ? stationPlotStyle()
    : stationStyleFor(state.comboIdx);
  return STATION_TOUCH[st.touch] || STATION_TOUCH.bell;
}
// ===== Жест атаки =====
// P.stationGesture = 'auto' — рисунок следует за станцией и фазой сюжета,
// 'off' — все три голоса звучат одновременно, как до появления жестов.
function stationGestureEnabled() {
  return P.stationGesture !== 'off' && P.stationGesture !== false;
}
// Возвращает объект с id/label/delays. Сюжет важнее характера: если style пришёл
// из stationPlotStyle(), у него уже есть phase, поэтому фаза задаёт рисунок,
// а не только voicing/bass.
function stationGesture(style) {
  const st = style || stationStyleFor(state.comboIdx);
  if (!stationGestureEnabled()) {
    return { id: 'off', label: 'выкл', delays: [0, 0, 0] };
  }
  if (st && st.plotId && st.phase && STATION_PLOT_GESTURES[st.phase]) {
    return {
      id: 'plot-' + st.phase,
      label: 'сюжет · ' + st.phase,
      delays: STATION_PLOT_GESTURES[st.phase].slice()
    };
  }
  const g = STATION_GESTURES[st && st.id] || STATION_GESTURES.neutral;
  return { id: g.id, label: g.label, delays: g.delays.slice() };
}
function stationGestureDelays(style) {
  return stationGesture(style).delays;
}
// stationPadVoices() возвращает голоса в порядке voicing, а delays заданы по
// высоте. Поэтому сортируем индексы по midi и раздаём задержки снизу вверх:
// «вверх» звучит от нижнего голоса к верхнему, «вниз» — наоборот.
function stationVoiceDelays(voices, style) {
  const delays = stationGestureDelays(style);
  const out = new Array(voices.length).fill(0);
  const order = voices.map((v, i) => i).sort((a, b) => voices[a][0] - voices[b][0]);
  order.forEach((voiceIndex, rank) => {
    out[voiceIndex] = delays[rank] || 0;
  });
  return out;
}
// Ручное A/B для консоли: 'off' — блок, 'auto' — жест станции и фазы.
function setStationGesture(mode) {
  P.stationGesture = mode === 'off' ? 'off' : 'auto';
  return P.stationGesture;
}

// Ручной выбор подачи (консоль, отладка, прослушивание): 'auto' возвращает
// поведение по паре, 'neutral' — эталон, остальное — id строки STATION_STYLES.
// Смена подачи меняет октаву станции, поэтому шары пересобираются, а звучащие
// удержания снимаются: иначе старая нота осталась бы в прежней октаве.
function setStationStyle(id) {
  const next = id && id !== 'auto' && stationStyleById(id) ? id : 'auto';
  P.stationStyle = next;
  if (typeof releaseAllHolds === 'function') releaseAllHolds();
  if (typeof buildBalls === 'function') buildBalls();
  if (typeof applyPalette === 'function') applyPalette();
  if (typeof updateHUD === 'function' && state.started) updateHUD();
  return P.stationStyle;
}

