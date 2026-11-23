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
     · touch    — огибающая и яркость колокола (bell / glass / felt / pluck).
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
  if (st.bass === 'fifth') return ((offset + (h.fifth || 7) + 6) % 12) - 6;
  if (st.bass === 'third') return ((offset + (h.third == null ? 4 : h.third) + 6) % 12) - 6;
  return offset > 6 ? offset - 12 : offset;
}
// Подача колокола текущей станции — множители к BELL_TIMBRES.
function stationShape() {
  const st = stationStyleFor(state.comboIdx);
  return STATION_TOUCH[st.touch] || STATION_TOUCH.bell;
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

