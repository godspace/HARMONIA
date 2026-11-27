/* HARMONIA · js/state.js — состояние сессии и доступ к текущему комбо
   Модуль без сборки: подключается <script> в index.html до main.js.
   Все модули делят глобальную область — имена функций/констант уникальны. */

const state = {
  started: false, running: false, paused: false, muted: false,
  mode: 'major', comboIdx: 0, chordIndex: 0,
  visited: [false, false, false, false],
  played: { major: [], minor: [] },
  // entered — комбо, в которые игрок уже заходил в этой сессии. Полоса прогресса
  // вверху сцены показывает сначала «вошёл» (голубая ячейка), а played — «собрал
  // цикл из четырёх аккордов» (зелёная). Сбрасывается вместе с played.
  entered: { major: [], minor: [] },
  clock: 0, rings: 0,
  // score — счёт текущего комбо. loadCombo() начинает каждое комбо с нуля;
  // отдельного общего счёта сессии больше нет.
  score: 0,
  // replay/recording — проигрывание записи идёт без начисления очков; запись
  // пишет только реальную игру, а не собственное воспроизведение.
  // recordingCountIn — идёт отсчёт перед записью: state.recording ещё false,
  // поэтому случайные ноты во время отсчёта не попадут в запись.
  replay: false, recording: false, recordingCountIn: false, playingRecording: false,
  // videoExport/audioExport — идёт экспорт записи. В этих режимах живой грув и
  // ввод молчат: картинка/звук собираются только из записанного таймлайна.
  videoExport: false, audioExport: false,
  recCountInBeat: 0, recCountInTotal: 0,
  energy: [], keysDown: {}, energyAcc: 0,
  // echo — звучат ли ноты MIDI с ноутбука: контроллер без динамиков озвучиваем сами,
  // stage piano с колонками звучит сам. Выбор помнится по устройству (см. midi.js).
  echo: true,
  // heard — то, что приложение слышит прямо сейчас: pitch classes, трезвучие, педаль.
  heard: { pcs: [], triad: null, sustain: false },
  // explored — ступени лада, сыгранные в текущем комбо: импровизация ценится
  // не чек-листом, а широтой охвата (5/7).
  explored: new Set(),
  // last/prevPcs/prevRoot/lastRoot/lastAt — что визуализация знает об аккордах:
  // текущий аккорд, его общие тоны с предыдущим и момент звучания.
  // lastTriad — полное описание (в том числе распознанного с MIDI и «краски»),
  // поэтому колесо рисует любой аккорд, а не только пять аккордов пэда.
  // moves — последние переходы для защиты от фарма повторяющейся пары;
  // phrase — аккорды после последней тоники, по ним считается красота фразы;
  // lastBeauty — последний бонус за переход, чтобы HUD мог его показать.
  harmony: {
    last: null, lastTriad: null, lastPcs: [], prevPcs: [], prevRoot: null,
    lastRoot: null, lastAt: 0, steps: 0, returns: 0, lastBonus: 0, lastReturnAt: 0,
    moves: [], phrase: [], lastBeauty: 0, lastBeautyAt: 0, lastBeautyText: ''
  },
  // adaptive — smart-раскладка правой руки. anchor — ступень, от которой
  // строится безопасное окно из пяти нот; window — уже выбранные индексы
  // палитры (они применяются только после отпускания клавиш). pendingAnchor
  // ждёт, пока рука освободится, чтобы карточки и бейджи не перестраивались
  // под зажатой рукой. chordAnchorAt — когда реально звучал аккорд.
  adaptive: {
    anchor: 0, window: [], pendingAnchor: null, switchTimer: null,
    chordAnchorAt: 0, lastNoteAt: 0, pendingRefresh: false
  },
  // stationPlot — реактивный сюжет пары: фаза выбирается сыгранными аккордами,
  // а не часами. phase — текущая, lastPhase — с которой пришли (для HUD и
  // исследования), history — последние фазы. Сброс — stationPlotReset().
  stationPlot: {
    archetype: 'flat', phase: 'home', lastPhase: 'home',
    chords: 0, homeStreak: 0, returns: 0, history: []
  },
  // transport — часы необязательной формы. В свободном джеме running = false,
  // поэтому render.js даже не двигает музыкальное время.
  transport: {
    running: false, paused: false, bpm: 84, beatsPerBar: 4,
    bar: 0, beat: 0, beatInBar: -1, countIn: 0, phase: 'idle'
  },
  // form — состояние пьесы. enabled=false по умолчанию: джем остаётся джемом.
  // stats — текущая секция (Set уникальных аккордов не сериализуется, поэтому
  // наружу отдаём готовые summaries).
  form: {
    enabled: false, running: false, phase: 'off',
    bar: 0, beat: 0, countInBeat: 0,
    sectionId: null, sectionLabel: '',
    barChord: null, barHadChord: false, barTargetHit: false,
    prepared: null,
    stats: null, summaries: [], points: 0, lastAward: null,
    // Мелодия пьесы: количество нот, диапазон и охват ступеней. Это не очки,
    // а краткая обратная связь в экране результата.
    melody: { notes: 0, noteMin: null, noteMax: null, pcs: new Set() }
  }
};
ORDER.major.forEach(() => state.played.major.push(false));
ORDER.minor.forEach(() => state.played.minor.push(false));
ORDER.major.forEach(() => state.entered.major.push(false));
ORDER.minor.forEach(() => state.entered.minor.push(false));
const combo = () => COMBOS[ORDER[state.mode][state.comboIdx]];
// Транспорт станции: 48 (до третьей октавы) плюс тоника пары плюс октава
// характера (js/station.js). Вся станция звучит в своей октаве, а геометрия
// сцены остаётся относительной — радиусы считаются от верхней ступени комбо.
const rootMidi = () => 48 + combo().root +
  (typeof stationRegister === 'function' ? stationRegister(state.comboIdx) : 0);
// Единый «можно ли играть» — используется вводом, MIDI, аккордами и нотами.
const playable = () => state.started && state.running && !state.paused;
// Экспорт (видео или WAV) занимает общий таймлайн: второй экспорт, запись,
// прослушивание и игровые команды ждут его завершения.
const exportBusy = () => !!(state.videoExport || state.audioExport);
