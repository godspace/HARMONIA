/* HARMONIA · js/i18n.js — свой языковой пакет английского интерфейса
   Модуль без сборки: подключается <script> в index.html сразу после util.js.
   Все модули делят глобальную область — имена функций/констант уникальны.

   Зачем пакет, если есть Google Translate (js/translate.js):
   машинный перевод годится как жест доброй воли, но английский — второй
   полноценный язык сайта (en/index.html — своя страница, а не перевод), и в
   интерфейсе он должен быть таким же точным. Виджет Google не переводит
   title-подсказки, иногда пропускает текст в свёрнутых панелях, а короткие
   строки вроде «Домой» переводит как «Houses». Поэтому английский идёт мимо
   Google: таблица ниже — единственный источник английских подписей.

   Как это работает:
   · «английский» выбирается в том же #langSel; translate.js вызывает
     I18N.enable('en') вместо загрузки скрипта Google;
   · переводятся и текст, и подсказки (title, aria-label, alt, placeholder);
   · игра переписывает подписи постоянно (счёт, такт, тосты), поэтому
     MutationObserver переводит всё, что появилось после включения;
   · нотация (C-D-E), ступени (I, IV) и названия аккордов не переводятся —
     их ставит игра, и пакет их не трогает: в таблице их просто нет;
   · числа и имена подставляются шаблонами (RULES): «ещё 300» → «300 to go»,
     «КОМБО 3 · C major» → «Combo 3 · C major». Составные строки вида
     «Пьеса: такт 5/16 · Интро · цель I» режутся по разделителям и
     переводятся по частям;
   · узлы с data-i18n-skip (#langSel с названиями языков, нотация до-ре-ми)
     остаются как есть — это не текст интерфейса, а сами языки.

   Словарь — источник истины для английского. Если строку забыли, это видно
   в smoke-тесте: шаг «en-labels» ищет в интерфейсе кириллицу и падает. */

var I18N = (function () {
  'use strict';

  // Какие языки игра переводит сама. Остальные — через Google Translate.
  const PACKS = { en: 1 };
  const CYR = /[\u0400-\u04FF]/;
  const ATTRS = ['title', 'aria-label', 'placeholder', 'alt', 'data-tip'];
  // Составные подписи режутся по этим разделителям и переводятся по частям.
  // « · » в конце — для обрубков, которые начинаются прямо с точки: после
  // обрезки пробелов текст « · диапазон » приходит как «· диапазон».
  const SPLITS = [' · ', ': ', ' — ', ' / ', '· '];
  const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1 };

  // ===== Словарь: русская строка → английская =====
  // Ключ — ровно тот текст, который стоит в разметке или в литерале js
  // (без крайних пробелов: их сохраняет переводчик).
  const MAP = {
    // ===== Верхнее меню =====
    'HARMONIA — симулятор гармонии и тренажёр аккордов':
      'HARMONIA — harmony simulator and chord trainer',
    '· симулятор гармонии': '· harmony simulator',
    'Лад': 'Mode',
    'Мажор': 'Major',
    'Минор': 'Minor',
    'Предыдущее комбо (Backspace)': 'Previous combo (Backspace)',
    'Следующее комбо (Enter; Space после 300)': 'Next combo (Enter; Space after 300)',
    '🎼 Форма: выкл': '🎼 Form: off',
    '🎼 Форма: пьеса': '🎼 Form: piece',
    'Необязательный слой: 16-тактная пьеса поверх свободного джема':
      'Optional layer: a 16-bar piece on top of the free jam',
    '🔊 Ноутбук': '🔊 Laptop',
    '🔈 Пианино': '🔈 Piano',
    'Кто звучит: ноутбук или пианино': 'What plays the notes: the laptop or the piano',
    '🔊 Звук: вкл': '🔊 Sound: on',
    '🔇 Звук: выкл': '🔇 Sound: off',
    'Звук (M)': 'Sound (M)',
    '⏸ Пауза': '⏸ Pause',
    '▶ Продолжить': '▶ Continue',
    'Пауза (Esc)': 'Pause (Esc)',
    '↺ Сессия заново': '↺ New session',
    'Сессия заново (0)': 'New session (0)',
    'Язык интерфейса — английский встроен, остальные через Google Translate':
      'Interface language — English is built in, other languages use Google Translate',
    'Язык интерфейса': 'Interface language',
    'Свернуть верхнее меню — сцена займёт всё место': 'Collapse the top menu — the stage takes all the space',
    'Показать верхнее меню': 'Show the top menu',
    '⌄ Меню': '⌄ Menu',

    // ===== Счёт, индикатор возврата, подсказки сцены =====
    'Счёт комбо': 'Combo score',
    'Ход пьесы': 'Piece progress',
    'Возврат в тонику': 'Return to the tonic',
    // Сюжет пары (js/station.js): короткие подписи HUD. Мотив — числа ступеней,
    // он не переводится; разделитель « · » пакет режет сам.
    'ровно': 'flat',
    'арка': 'arch',
    'дрейф': 'drift',
    'педаль': 'pedal',
    'спуск': 'descent',
    'зов': 'call',
    'вдох': 'breath',
    // Характеры станций: те же двенадцать строк, что и STATION_STYLES. Они
    // попадают в имена авто-записей («Станция 3 · войлок»), поэтому переводятся
    // по частям, а не отдельным шаблоном на каждую комбинацию.
    'эталон': 'reference',
    'широко': 'wide',
    'мерцание': 'shimmer',
    'войлок': 'felt',
    'дерево': 'wood',
    'глубина': 'depth',
    'лёд': 'ice',
    'пульс': 'pulse',
    'бронза': 'bronze',
    'воздух': 'air',
    'бархат': 'velvet',
    'хрусталь': 'crystal',
    'дом': 'home',
    'уход': 'departure',
    'поворот': 'turn',
    'тень': 'shadow',
    'возврат': 'return',
    'Сколько раз возвращались в тонику': 'How many times you returned to the tonic',
    'Индикатор возврата в тонику': 'Return-to-the-tonic indicator',
    'Тоника': 'Tonic',
    'Домой': 'Home',
    'дома': 'home',
    'дома · всё разрешено': 'home · everything is allowed',
    'Ноты правой руки — ступени лада': 'Right-hand notes — scale degrees',
    'Ноты правой руки — пять фиксированных корней комбо':
      'Right-hand notes — the five fixed combo roots',
    'Гармоничные аккорды комбо': 'The chords of the combo',
    'Пробел — новое комбо после 300 очков': 'Space — a new combo after 300 points',
    'новое комбо': 'new combo',
    '→ новое комбо': '→ new combo',
    'готово': 'ready',
    // Полоса прогресса по 24 комбо: подпись для скринридера (сама aria-value —
    // числа, они не переводятся).
    'Пройдено комбо из 24': 'Combos completed out of 24',

    // ===== Итог пьесы и пауза =====
    'Пьеса завершена': 'Piece complete',
    '↻ Ещё раз': '↻ Once again',
    '↻ Начать заново': '↻ Start over',
    '↻ Начать пьесу': '↻ Start the piece',
    'В свободный джем': 'Back to the free jam',
    'Продолжить': 'Continue',
    'Пауза': 'Pause',
    'Орбиты и звук остановлены. Продолжение — с того же места.':
      'Orbits and sound are stopped. You will continue from the same place.',
    // ===== Панель настроек =====
    'Панель настроек': 'Settings panel',
    'Свернуть панель — сцена станет шире': 'Collapse the panel — the stage gets wider',
    'Показать панель настроек': 'Show the settings panel',
    '⚙ Настройки': '⚙ Settings',
    'Комбо · кварто-квинтовый круг': 'Combo · circle of fifths',
    'Выбор комбо по кругу тональностей': 'Pick a combo on the circle of fifths',
    '‹ Назад': '‹ Back',
    'Далее ›': 'Next ›',
    'Space после 300 · Backspace / ↑ / ↓ · клик по тональности — сразу':
      'Space after 300 · Backspace / ↑ / ↓ · click a key to jump there',
    'Форма · пьеса': 'Form · piece',
    'Форма: свободный джем': 'Form: free jam',
    'Форма: пьеса включена': 'Form: piece is on',
    'Свободный джем. Форма включится только по кнопке.':
      'Free jam. The form starts only from its button.',
    'Темп': 'Tempo',
    'Размер': 'Meter',
    'Отсчёт': 'Count-in',
    'без отсчёта': 'no count-in',
    '1 такт': '1 bar',
    '2 такта': '2 bars',
    'Метроном: вкл': 'Metronome: on',
    'Метроном: выкл': 'Metronome: off',
    'В джем': 'To the jam',
    'приготовиться': 'get ready',
    'пауза': 'paused',
    'пьеса сыграна': 'the piece is played',
    'финал': 'finale',

    // ===== Запись мелодии =====
    'Запись мелодии': 'Melody recording',
    '● Запись': '● Record',
    '■ Стоп': '■ Stop',
    '✕ Отмена': '✕ Cancel',
    '▶ Прослушать': '▶ Listen',
    '▶ Прослушивание': '▶ Playback',
    'Начать или остановить запись': 'Start or stop recording',
    'Прослушать выбранную запись': 'Listen to the selected recording',
    'Сколько тактов метронома звучит до начала записи':
      'How many metronome bars play before the recording starts',
    '0 — шары стоят; движение — только от нажатий':
      '0 — the balls stand still; they move only when you play',
    'Громкость одиночных нот, 0–150 %': 'Single-note volume, 0–150 %',
    'Громкость аккордовой подложки и баса, 0–150 %': 'Chord pad and bass volume, 0–150 %',
    'Сдвиг нот правой руки: −1, 0 или +1 октава': 'Right-hand note shift: −1, 0 or +1 octave',
    'Названия нот: до-ре-ми или C-D-E. Переключается вместе с языком интерфейса':
      'Note names: do-re-mi or C-D-E. Follows the interface language',
    'Повтор: вкл': 'Loop: on',
    'Повтор: выкл': 'Loop: off',
    'Повторять выбранную запись по кругу': 'Play the selected recording in a loop',
    'Автозапись станции: вкл': 'Station auto-record: on',
    'Автозапись станции: выкл': 'Station auto-record: off',
    'Автоматически записывать каждую станцию для прослушивания и MIDI':
      'Automatically record each station for playback and MIDI',
    'Скачать выбранную запись как MIDI-файл':
      'Download the selected recording as a MIDI file',
    'MIDI сохранён': 'MIDI saved',
    'MIDI не удалось сохранить': 'Could not save MIDI',
    'Запись': 'Recording',
    'Сохранённые записи': 'Saved recordings',
    '— нет записей —': '— no recordings —',
    '🗑 Удалить': '🗑 Delete',
    'Удалить выбранную запись': 'Delete the selected recording',
    'Нажмите «Запись», чтобы сохранить мелодию.': 'Press “Record” to capture a melody.',
    'Отсчёт отменён': 'Count-in cancelled',
    'Запись сохранена': 'Recording saved',
    'Запись отменена': 'Recording cancelled',
    'Запись пустая — сыграйте хотя бы одну ноту':
      'The recording is empty — play at least one note',
    'Запись удалена': 'Recording deleted',
    '● Запись начата — играйте мелодию': '● Recording started — play a melody',
    'запись начнётся с 1-го такта': 'the recording starts at bar 1',
    '⏱ Отсчёт': '⏱ Count-in',
    'Выбрано': 'Selected',
    'стоят': 'still',
    '%/с': '%/s',
    '°/с': '°/s',
    'Выбрано:': 'Selected:',
    'запись': 'recording',
    'пьеса': 'piece',
    'повтор': 'loop',
    'повтор…': 'loop…',
    'соб.': 'events',
    'Мелодия: нот не было — пьеса держалась на аккордах.':
      'Melody: no notes — the piece stood on the chords alone.',
    'Мелодия:': 'Melody:',
    'нот': 'notes',
    'диапазон': 'range',
    'разных звуков': 'distinct pitches',

    // ===== Исследование · оценки комбо =====
    // Секция панели и карточка оценки. Тексты видны и в английском интерфейсе:
    // шаг en-labels читает разметку даже у скрытых элементов, поэтому забытая
    // строка здесь сразу падает.
    'Исследование · оценки комбо': 'Research · combo ratings',
    'Исследование: выкл': 'Research: off',
    'Исследование: вкл': 'Research: on',
    'Собирать оценки комбо в этом браузере. Включается также адресом ?research=1':
      'Collect combo ratings in this browser. It also turns on with ?research=1',
    'Спрашивать оценку: вкл': 'Ask for a rating: on',
    'Спрашивать оценку: выкл': 'Ask for a rating: off',
    'Спрашивать оценку после Space-перехода в новое комбо':
      'Ask for a rating after a Space transition to a new combo',
    'Скачать JSON': 'Download JSON',
    'Скачать оценки и историю игры в JSON': 'Download ratings and play history as JSON',
    'Очистить': 'Clear',
    'Ещё раз — очистить': 'Click again to clear',
    'Удалить все сохранённые оценки': 'Delete all saved ratings',
    'Данные остаются в этом браузере — уходят только файлом.':
      'The data stays in this browser — it leaves only as a file.',
    'Комбо · оценка': 'Combo · rating',
    'Как звучало комбо?': 'How did the combo sound?',
    'Оценка комбо от 1 до 5': 'Combo rating from 1 to 5',
    'Комментарий (необязательно)': 'Comment (optional)',
    'Что понравилось или что не так?': 'What felt right or what felt wrong?',
    'Комментарий к комбо': 'Comment on the combo',
    'J I O P [ — оценка · Space / Esc — пропустить': 'J I O P [ — rate · Space / Esc — skip',
    'Пропустить': 'Skip',
    'Оценка сохранена': 'Rating saved',
    'Оценка пропущена': 'Rating skipped',
    'Данные исследования очищены': 'Research data cleared',
    'Файл исследования сохранён': 'Research file saved',
    'Хранилище исследования заполнено — старые данные удалены':
      'Research storage is full — the oldest data was removed',

    // ===== Визуализация =====
    'Визуализация': 'Visualisation',
    'Выбор визуализации сцены': 'Pick a scene visualisation',
    'Клик по режиму или': 'Click a mode or',
    '— сразу': '— applies at once',
    'Движение': 'Motion',
    'Скорость покоя': 'Idle speed',
    'Импульс': 'Kick',
    'Затухание': 'Decay',
    '⟳ Направление: по часовой': '⟳ Direction: clockwise',
    '⟲ Направление: против часовой': '⟲ Direction: counter-clockwise',
    'Направляющие орбит: вкл': 'Orbit guides: on',
    'Направляющие орбит: выкл': 'Orbit guides: off',
    'Направляющие: вкл': 'Guides: on',
    'Направляющие: выкл': 'Guides: off',
    'Кометные хвосты: вкл': 'Comet trails: on',
    'Кометные хвосты: выкл': 'Comet trails: off',
    'Перо': 'Pen',
    'Толщина': 'Width',
    'Затухание следа': 'Trail decay',
    'Свечение': 'Glow',
    'Точность дуг': 'Arc precision',
    'высокая': 'high',
    'обычная': 'normal',
    'Очистить след (C)': 'Clear the trail (C)',
    'Сцена': 'Stage',
    'Частицы': 'Particles',
    'Палитра': 'Palette',
    'Неон': 'Neon',
    'Аврора': 'Aurora',
    'Угли': 'Embers',
    'Круг': 'Circle',
    'Орбиты': 'Orbits',
    'Спектр': 'Spectrum',
    'Квинтовый круг: угол — квинты, радиус — высота тона, на поясе — аккорд':
      'Circle of fifths: angle — fifths, radius — pitch height, the chord sits on the belt',
    'Плоские орбиты: радиус — высота тона, угол — интеграл скорости':
      'Flat orbits: radius — pitch height, angle — the integral of speed',
    'Спектр выхода: солнце дышит по RMS, лучи — по бинам':
      'Output spectrum: the sun breathes with RMS, the rays follow the bins',
    'угол — квинты · радиус — высота': 'angle — fifths · radius — pitch',
    'спектр включится вместе со звуком': 'the spectrum starts together with the sound',
    'Аккорд': 'Chord',
    'кГц': 'kHz',
    'След очищен': 'Trail cleared',
    'Параметры сброшены': 'Settings reset',
    'Случайная конфигурация': 'Random configuration',
    'PNG сохранён': 'PNG saved',

    // ===== Звук, нотация, правая рука, педаль =====
    'Звук': 'Sound',
    'Реверберация': 'Reverb',
    'Яркость нот': 'Note brightness',
    'Громкость нот': 'Note volume',
    'Громкость аккордов': 'Chord volume',
    'Громкость барабанов': 'Drum volume',
    'Громкость синтезированных барабанов, 0–150 %':
      'Volume of the synthesized drums, 0–150 %',
    // ===== Барабаны · грув =====
    // Строку статуса игра собирает из частей через « · », поэтому переводим
    // слова и короткие фразы, а не целые предложения с числами.
    'Барабаны · грув': 'Drums · groove',
    'Барабаны: выкл': 'Drums: off',
    'Барабаны: вкл': 'Drums: on',
    'Барабаны играют сами по выбранному паттерну (Enter)':
      'The drums play themselves on the selected pattern (Enter)',
    'Паттерн': 'Pattern',
    'Фигура барабанов': 'Drum pattern',
    'прямой': 'straight',
    'полупустой': 'halftime',
    'шаффл': 'shuffle',
    'баллада': 'ballad',
    'вальс': 'waltz',
    'Темп грува': 'Groove tempo',
    'Темп джема; в пьесе барабаны ведёт форма':
      'Jam tempo; in a piece the form drives the drums',
    'ведёт пьеса': 'led by the piece',
    'свой темп': 'own tempo',
    'Грув': 'Groove',
    'Грув выключен: джем идёт без долей.':
      'Groove is off: the jam runs without beats.',
    'Октава нот': 'Note octave',
    'Октава баса': 'Bass octave',
    'Подложка аккорда: вкл': 'Chord pad: on',
    'Подложка аккорда: выкл': 'Chord pad: off',
    'Нотация': 'Notation',
    'Нотация: C-D-E': 'Notation: C-D-E',
    'Нотация: до-ре-ми': 'Notation: do-re-mi',
    'Умное переключение: вкл': 'Smart switching: on',
    'Умное переключение: выкл': 'Smart switching: off',
    'Умное переключение: вкл · 5 безопасных нот вокруг аккорда':
      'Smart switching: on · 5 safe notes around the chord',
    'Умное переключение: выкл · 5 фиксированных корней':
      'Smart switching: off · 5 fixed roots',
    'Smart: пять безопасных нот вокруг аккорда, Q следует за гармонией. Клик — выключить.':
      'Smart: five safe notes around the chord, Q follows the harmony. Click to turn it off.',
    'Без smart: фиксированные корни J I O P [, автотрезвучия от самой ноты. Клик — включить.':
      'No smart mode: the fixed roots J I O P [, automatic triads built from the note itself. Click to turn it on.',
    'Клик: умное переключение аккордов вкл → выкл → снова вкл. Без умного режима правая рука играет фиксированные корни J I O P [, а автотрезвучия строятся от самой ноты.':
      'Click: chord smart switching on → off → on again. Without the smart mode the right hand plays the fixed roots J I O P [ and automatic triads are built from the note itself.',
    'Педаль: нажата': 'Pedal: down',
    'Педаль: отпущена': 'Pedal: up',
    'Педаль: нажата · хвост длиннее': 'Pedal: down · longer tail',
    'Педаль: отпущена · звук гаснет': 'Pedal: up · the sound fades',
    'Педаль: нажата / отпущена (кнопка панели; MIDI CC64)':
      'Pedal: down / up (the panel button; MIDI CC64)',
    'Ноты MIDI звучат с ноутбука — для контроллера без динамиков':
      'MIDI notes sound from the laptop — for a controller without speakers',
    'Приложение молчит: пианино звучит само (stage piano)':
      'The app stays silent: the stage piano sounds on its own',
    'Звук нот: ноутбук': 'Note sound: laptop',
    'Звук нот: пианино': 'Note sound: piano',
    // ===== Стартовый экран =====
    'HARMONIA — симулятор гармонии · 24 комбо': 'HARMONIA — harmony simulator · 24 combos',
    'Нажмите': 'Press',
    'десять': 'ten',
    'подсвеченных клавиш — на клавиатуре или по схеме':
      'highlighted keys — on your keyboard or on the picture',
    // Второй шаг пробы: Enter включает барабаны, и только потом активен пробел.
    'Клавиши на месте — включите барабаны:':
      'All the keys are in place — start the drums:',
    'Клавиши на месте — нажмите': 'All the keys are in place — press',
    'пробел': 'Space',
    ', чтобы начать': ' to start',
    'Левая рука · аккорды': 'Left hand · chords',
    'Правая рука · ноты': 'Right hand · notes',
    'Схема клавиатуры: Q W E R F — аккорды левой руки, J I O P [ — ноты правой. Нажмите все десять подсвеченных клавиш, затем Enter — включатся барабаны, затем пробел, чтобы начать':
      'Keyboard map: Q W E R F play the left-hand chords, J I O P [ the right-hand notes. Press all ten highlighted keys, then Enter to start the drums, then Space to begin',
    'комбо': 'combo',
    'барабаны': 'drums',
    'начать': 'start',
    'лад / комбо': 'mode / combo',
    'Пробел — начать игру; в игре — новое комбо после 300 очков':
      'Space — start the game; in play — a new combo after 300 points',
    'Стрелки: лад и комбо': 'Arrows: mode and combo',
    '↑ — следующее комбо': '↑ — next combo',
    '← — мажор': '← — major',
    '↓ — предыдущее комбо': '↓ — previous combo',
    '→ — минор': '→ — minor',
    // Подсказки на схеме (data-tip): клавиша и её роль одной строкой.
    'Enter — барабаны: включить или выключить грув':
      'Enter — drums: turn the groove on or off',
    'Q · II — супертоника: шаг к доминанте': 'Q · II — supertonic: a step to the dominant',
    'W · IV — субдоминанта: уводит от тоники': 'W · IV — subdominant: leads away from the tonic',
    'E · V — доминанта: тянет назад в тонику': 'E · V — dominant: pulls back to the tonic',
    'R · VI — субмедианта: мягкий уход': 'R · VI — submediant: a soft detour',
    'F · I — тоника: дом, сюда возвращаются': 'F · I — tonic: home, where you return',
    'J · нота 1: безопасная ступень вокруг аккорда':
      'J · note 1: a safe step around the chord',
    'I · нота 2: безопасная ступень вокруг аккорда':
      'I · note 2: a safe step around the chord',
    'O · нота 3: безопасная ступень вокруг аккорда':
      'O · note 3: a safe step around the chord',
    'P · нота 4: безопасная ступень вокруг аккорда':
      'P · note 4: a safe step around the chord',
    '[ · нота 5: безопасная ступень вокруг аккорда':
      '[ · note 5: a safe step around the chord',

    // ===== Строка состояния =====
    'Web MIDI: проверка…': 'Web MIDI: checking…',
    '= аккорды ·': '= chords ·',
    '= ноты ·': '= notes ·',
    '= октава ·': '= octave ·',
    '= лад ·': '= mode ·',
    '= комбо ·': '= combo ·',
    '= барабаны ·': '= drums ·',
    '= новое комбо после 300 ·': '= new combo after 300 ·',
    '= визуализация ·': '= visualisation ·',
    '= пауза · MIDI: трезвучие = аккорд': '= pause · MIDI: triad = chord',

    // ===== MIDI =====
    'Вход': 'Input',
    '— нет —': '— none —',
    'MIDI-вход': 'MIDI input',
    'Web MIDI не поддерживается браузером': 'Web MIDI is not supported by this browser',
    'Этот браузер не умеет Web MIDI — играйте с клавиатуры.':
      'This browser has no Web MIDI — play on the computer keyboard.',
    'MIDI: доступ по первому нажатию': 'MIDI: access on the first press',
    'Браузер ждёт действия пользователя — нажмите любую клавишу или кнопку, чтобы разрешить MIDI.':
      'The browser waits for a user gesture — press any key or button to allow MIDI.',
    'Подключите клавиатуру — трезвучие станет аккордом, ноты — голосами.':
      'Connect a keyboard — a triad becomes a chord, its notes become voices.',
    'Играйте: трезвучие становится аккордом, ноты — голосами. Педаль (CC64) держит звук, паника — CC123.':
      'Play: a triad becomes a chord, its notes become voices. The pedal (CC64) holds the sound, panic is CC123.',
    'MIDI: вход не выбран': 'MIDI: no input selected',
    'MIDI не обнаружена': 'No MIDI device found',
    'Подключите клавиатуру — она подхватится автоматически.':
      'Connect a keyboard — it will be picked up automatically.',
    'педаль': 'pedal',

    // ===== Сессия =====
    'Сессия': 'Session',
    'Сброс параметров': 'Reset settings',
    'Случайно': 'Random',
    'Экспорт PNG': 'Export PNG',
    'О проекте': 'About the project (in Russian)',
    'Как устроена HARMONIA: обзор, горячие клавиши, вопросы':
      'How HARMONIA works: overview, hotkeys, questions',

    // ===== Функции гармонии и лад =====
    'тоника': 'tonic',
    'супертоника': 'supertonic',
    'субдоминанта': 'subdominant',
    'доминанта': 'dominant',
    'медианта': 'mediant',
    'субмедианта': 'submediant',
    'краска': 'colour',
    'Краска': 'Colour',
    'уменьшённое': 'diminished',
    'увеличенное': 'augmented',
    'мажор': 'major',
    'минор': 'minor',
    'заявить тонику': 'state the tonic',
    'тема': 'theme',
    'контраст': 'contrast',
    'возврат темы': 'the theme returns',
    'каданс': 'cadence',
    'Интро': 'Intro',
    'Кода': 'Coda',
    'зачин': 'opening',
    'фраза': 'phrase',
    'вне лада': 'outside the key',
    'Вне лада ·': 'Outside the key ·',
    '— вторичная доминанта': '— secondary dominant',
    'Вторичная доминанта': 'Secondary dominant',
    'Играйте трезвучие — приложение назовёт функцию':
      'Play a triad — the app will name its function',
    'Слышу:': 'Hearing:',
    'Плавно:': 'Smooth:',
    'тянет': 'pulls',
    'Правая рука': 'Right hand',
    'Правая рука:': 'Right hand:',
    'окно от': 'window from',
    'Пять фиксированных корней комбо': 'Five fixed combo roots',
    'Пять безопасных нот вокруг текущего аккорда':
      'Five safe notes around the current chord',
    'Форма': 'Form',
    'форма': 'form',
    'цель': 'target',
    'цели': 'targets',
    'аккордов': 'chords',
    'Такт': 'Bar',
    'такт': 'bar',
    'тактов': 'bars'
  };

  // ===== Шаблоны: строки с числами, нотами и названиями =====
  // Замена — либо строка с $1…$9, либо функция от захваченных групп.
  const RULES = [
    // ===== Числа, счёт, напряжение =====
    [/^ещё (\d+)$/, '$1 to go'],
    [/^\+(\d+) в счёт комбо$/, '+$1 to the combo score'],
    [/^Цикл комбо собран ✓ · после (\d+) — Space$/,
      'Combo cycle complete ✓ · Space after $1'],
    [/^Счёт комбо: (\d+)$/, 'Combo score: $1'],
    [/^Кольца: (\d+)$/, 'Rings: $1'],
    [/^Лад: (.+)$/, 'Mode: $1'],
    [/^домой \+(\d+)$/, 'home +$1'],
    [/^красиво \+(\d+)$/, 'nice +$1'],
    [/^Форма \+(\d+)$/, 'Form +$1'],
    [/^фраза \+(\d+)$/, 'phrase +$1'],
    [/^фраза (.+)$/, 'phrase $1'],
    [/^Октава нот: ([-+]?\d+) — предел$/, 'Note octave: $1 — the limit'],
    [/^Октава нот: ([-+]?\d+)$/, 'Note octave: $1'],
    [/^октава ([-+]\d+)$/, 'octave $1'],
    [/^напряжение (\d+)\/(\d+)$/, 'tension $1/$2'],
    [/^напряжения нет$/, 'no tension'],
    [/^возврат даст \+(\d+)$/, 'the return gives +$1'],
    [/^бонус фразы \+(\d+)$/, 'phrase bonus +$1'],
    [/^возвратов: (\d+)$/, 'returns: $1'],
    [/^последний переход дал \+(\d+)$/, 'the last move gave +$1'],

    // ===== Исследование: счётчики, метрики и карточка =====
    [/^Посещений: ([0-9]+)$/, 'Visits: $1'],
    [/^оценок: ([0-9]+)$/, 'ratings: $1'],
    [/^событий: ([0-9]+)$/, 'events: $1'],
    [/^пропусков: ([0-9]+)$/, 'skips: $1'],
    [/^Оценка сохранена: ([0-9])[/]5$/, 'Rating saved: $1/5'],
    [/^([0-9]+) с в комбо$/, '$1 s in the combo'],
    [/^([0-9]+) нот$/, '$1 notes'],
    [/^([0-9]+) очков$/, '$1 points'],
    [/^Оценка ([0-9]) из 5$/, 'Rating $1 out of 5'],

    // ===== Комбо и круг тональностей =====
    [/^HARMONIA · КОМБО (\d+) · (.+)$/, 'HARMONIA · combo $1 · $2'],
    [/^КОМБО (\d+) · (.+)$/, 'Combo $1 · $2'],
    [/^PNG сохранён · КОМБО (\d+)$/, 'PNG saved · combo $1'],
    [/^Пробел — перейти в КОМБО (\d+) · (.+)$/, 'Space — jump to combo $1 · $2'],
    [/^После (\d+) очков пробел переключит на КОМБО (\d+) · (.+)$/,
      'After $1 points Space switches to combo $2 · $3'],

    // ===== Форма, такты, цели =====
    [/^Форма · (\d+) тактов$/, 'Form · $1 bars'],
    [/^Пьеса завершена · форма \+(\d+)\. Можно начать ещё раз или вернуться в джем\.$/,
      'Piece complete · form +$1. Start again or go back to the jam.'],
    [/^Пьеса завершена · форма \+(\d+)$/, 'Piece complete · form +$1'],
    [/^Пьеса: такт (\d+)\/(\d+)$/, 'Piece: bar $1/$2'],
    [/^Такт (\d+)\/(\d+) · (\d+)\/(\d+)$/, 'Bar $1/$2 · beat $3/$4'],
    [/^Такт (\d+)\/(\d+)$/, 'Bar $1/$2'],
    [/^Такт (\d+)$/, 'Bar $1'],
    [/^такта? (\d+)\/(\d+)$/, 'bar $1/$2'],
    [/^([\d.,]+)%\/с$/, '$1%/s'],
    [/^([\d.,]+)°\/с$/, '$1°/s'],
    [/^Такты (\d+)–(\d+)$/, 'Bars $1–$2'],
    [/^(\d+) тактов$/, '$1 bars'],
    [/^(\d+) такт$/, '$1 bar'],
    [/^цели (\d+)\/(\d+)$/, 'targets $1/$2'],
    [/^цель (.+)$/, 'target $1'],
    [/^аккордов (\d+)$/, 'chords $1'],
    [/^нот (\d+)$/, 'notes $1'],
    [/^(\d+) т\.$/, '$1 bars'],
    [/^(\d+) соб\.$/, '$1 events'],

    // ===== Отсчёт и запись =====
    [/^⏱ Отсчёт (\d+)\/(\d+)$/, '⏱ Count-in $1/$2'],
    [/^Отсчёт (\d+)\/(\d+)\. Пьеса начнётся с такта 1\.$/,
      'Count-in $1/$2. The piece starts at bar 1.'],
    [/^Отсчёт (\d+)\/(\d+)$/, 'Count-in $1/$2'],
    [/^Пауза · такт (\d+)\/(\d+)\. Продолжение — с того же места\.$/,
      'Pause · bar $1/$2. You will continue from the same point.'],
    [/^(\d+) такта? до записи$/, '$1 bars before the recording'],
    [/^пьеса (\d+) BPM$/, 'piece $1 BPM'],
    // Имя записи — дата создания («Запись 23.11, 16:24»), а не любая фраза с
    // этого слова: иначе шаблон съедал бы «Запись сохранена» целиком.
    [/^Запись (\d{2}\.\d{2}, \d{2}:\d{2})$/, 'Recording $1'],
    [/^▶ Запись (\d{2}\.\d{2}, \d{2}:\d{2})$/, '▶ Recording $1'],
    // Авто-запись: «Станция 3 · войлок». Части переводятся отдельно, поэтому
    // шаблон нужен только для номера; характер — в MAP.
    [/^Станция (\d+)$/, 'Station $1'],
    [/^([\d.,]+) с$/, '$1 s'],

    // ===== Подписи правой руки и подсказки =====
    [/^Ноты правой руки — безопасное окно вокруг ступени (.+)$/,
      'Right-hand notes — a safe window around degree $1'],
    [/^Правая рука: (.+)$/, 'Right hand: $1'],
    [/^окно от (.+)$/, 'window from $1'],
    [/^Визуализация: (.+) \(клавиша (\d+)\)$/, 'Visualisation: $1 (key $2)'],
    [/^тянет → (.+)$/, 'pulls → $1'],
    [/^(.+) ✓$/, '$1 ✓']
  ];

  let on = false;
  let lang = '';
  let observer = null;

  // Перевод «ядра» строки без крайних пробелов; null — перевода нет.
  function core(s) {
    const hit = MAP[s];
    if (hit != null) return hit;
    for (let i = 0; i < RULES.length; i++) {
      const m = RULES[i][0].exec(s);
      if (m) return applyRule(RULES[i][1], m);
    }
    return parts(s);
  }

  // Составная строка: переводим по частям, если хотя бы одна часть перевелась.
  // Так «+2 · цель I» и «Пьеса: такт 5/16 · Интро · цель I» не требуют
  // отдельного шаблона на каждую перестановку.
  function parts(s) {
    for (let k = 0; k < SPLITS.length; k++) {
      const sep = SPLITS[k];
      if (s.indexOf(sep) === -1) continue;
      const list = s.split(sep);
      if (list.length < 2 || list.length > 6) continue;
      let changed = false;
      const out = list.map(part => {
        if (!CYR.test(part)) return part;      // числа, ноты, ключи — как есть
        const tr = core(part);
        if (tr == null) return part;
        changed = true;
        return tr;
      });
      if (changed) return out.join(sep);
    }
    return null;
  }

  function applyRule(rep, m) {
    const groups = [];
    for (let i = 1; i < m.length; i++) {
      const g = m[i];
      if (g == null) { groups.push(''); continue; }
      groups.push(CYR.test(g) ? (core(g) == null ? g : core(g)) : g);
    }
    if (typeof rep === 'function') return rep.apply(null, groups);
    return rep.replace(/\$(\d)/g, (all, d) => {
      const v = groups[Number(d) - 1];
      return v == null ? '' : v;
    });
  }

  // Перевод с сохранением крайних пробелов: « · цель I » остаётся в своей
  // строке, иначе соседние <b>/<kbd> слиплись бы.
  function text(s) {
    if (!s || !CYR.test(s)) return s;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    const body = m[2];
    if (!body) return s;
    const out = core(body);
    return out == null ? s : m[1] + out + m[3];
  }

  function skipped(node) {
    return !!(node.closest && node.closest('[data-i18n-skip]'));
  }

  function translateTextNode(node) {
    if (!node || node.nodeType !== 3) return;
    const parent = node.parentNode;
    if (!parent || SKIP_TAGS[parent.nodeName]) return;
    if (skipped(parent)) return;
    const next = text(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  function translateAttrs(el) {
    if (!el || el.nodeType !== 1 || skipped(el)) return;
    for (let i = 0; i < ATTRS.length; i++) {
      const name = ATTRS[i];
      const value = el.getAttribute(name);
      if (!value) continue;
      const next = text(value);
      if (next !== value) el.setAttribute(name, next);
    }
  }

  // Текст внутри поддерева: элементы не трогаем, но заходим в детей, кроме
  // служебных тегов и узлов с data-i18n-skip (их поддерево пропускается).
  function translateSubtree(root) {
    if (!root) return;
    if (root.nodeType === 3) { translateTextNode(root); return; }
    if (root.nodeType !== 1) return;
    translateAttrs(root);
    if (SKIP_TAGS[root.nodeName] || skipped(root)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === 1) {
          // Элемент нужен в обходе: у него свои title/aria-label.
          return SKIP_TAGS[node.nodeName] || node.hasAttribute('data-i18n-skip')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === 1) translateAttrs(node);
      else translateTextNode(node);
      node = walker.nextNode();
    }
  }

  // Игра переписывает подписи постоянно — переводим то, что появилось.
  // Наш собственный setAttribute/nodeValue тоже даёт запись: она приходит
  // сюда второй раз, перевода уже нет, и цикл на этом заканчивается.
  function onMutations(records) {
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (r.type === 'characterData') translateTextNode(r.target);
      else if (r.type === 'attributes') translateAttrs(r.target);
      else {
        for (let j = 0; j < r.addedNodes.length; j++) translateSubtree(r.addedNodes[j]);
      }
    }
  }

  function supports(code) {
    return !!PACKS[String(code || '').split('-')[0].toLowerCase()];
  }

  function enable(code) {
    const next = String(code || 'en').split('-')[0].toLowerCase();
    if (!PACKS[next] || on) return false;
    on = true;
    lang = next;
    const root = document.documentElement;
    root.setAttribute('lang', lang);
    root.classList.add('lang-' + lang);
    if (document.title) document.title = text(document.title);
    translateSubtree(document.body);
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS
    });
    return true;
  }

  function disable() {
    if (!on) return false;
    on = false;
    if (observer) { observer.disconnect(); observer = null; }
    document.documentElement.classList.remove('lang-' + lang);
    lang = '';
    return true;
  }

  // Повторный проход по готовой странице: нужен там, где подписи поставили
  // пачкой и ждать микро-задачу MutationObserver не хочется (smoke-тест,
  // будущие экраны, которые рисуются за один тик).
  function refresh() {
    if (!on) return false;
    if (document.title) document.title = text(document.title);
    translateSubtree(document.body);
    return true;
  }

  return {
    packs: Object.keys(PACKS),
    supports: supports,
    enable: enable,
    disable: disable,
    refresh: refresh,
    enabled: () => on,
    lang: () => lang,
    text: text               // для подписей на canvas и вне DOM
  };
})();
