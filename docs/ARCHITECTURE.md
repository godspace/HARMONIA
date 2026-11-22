# Архитектура HARMONIA

## Принципы

1. **Одна страница, ноль сборки.** `index.html` открывается двойным кликом. Поэтому
   модули — классические `<script>`, а не ES-модули: `import` с `file://` заблокирован.
2. **Порядок подключения = порядок зависимостей.** Верхнеуровневые `const` вычисляются
   при загрузке файла, поэтому `util.js` идёт первым, `main.js` — последним.
3. **Один источник правды для данных.** `data/COMBOLIST.csv` → `tools/combolist.py`
   → литерал в `js/data.js`. Парсер живёт рядом с литералом.
4. **Побочные эффекты — только в `main.js`.** Остальные модули объявляют функции;
   обработчики вешаются при загрузке `input.js` / `ui-panel.js`, когда DOM уже готов.

## Карта модулей

```
        util ── config ── data ── harmony ── state
                                     │         │
                              audio ─┴─ scene ──┤
                                                │
                                       viz ─────┤
                                                │
                 transport ── composition ── ui-compose
                        game ── listen ── ui-hud ── recorder ── ui-panel ── ui-drawers ── input
                          │        │          │
                        midi ──────┴── render ─┴── main
```

| Модуль | Отвечает за | Ключевые имена |
| --- | --- | --- |
| `util` | помощники без зависимостей | `$`, `cap`, `clamp`, `midiToFreq`, `notePc` |
| `config` | параметры и константы | `DEFAULTS`, `P`, `CFG`, `PALETTES`, `NOTE_KEYS`, `NOTE_CAP` |
| `data` | CSV и разбор | `CSV`, `COMBOS`, `ORDER` |
| `harmony` | аккорды комбо и весь лад | `HARMONY`, `PALETTE_SLOTS`, `INPUT`, `harmonicChords()`, `diatonicPalette()`, `handNoteBalls()`, `smartNoteWindow()`, `smartChordDegrees()`, `smartTargetDegree()`, `smartHarmonyForNote()`, `chordOnDegree()`, `classifyTriad()`, `describeTriad()`, `noteRole()` |
| `state` | изменяемое состояние сессии | `state`, `state.adaptive`, `combo()`, `rootMidi()`, `playable()` |
| `audio` | синтез и тракт | `initAudio`, `bell`, `noteChordPlan`, `noteChord`, `scheduleNoteChord`, `cancelPendingNoteChord`, `echoNote`, `holdStart/Stop`, `bass` |
| `transport` | часы необязательной формы | `Transport.start/update/pause/resume/stop`, `beatsPerBar`, `countInBeats`, `setBpm`, `setMetronome` |
| `composition` | драматургия и очки пьесы | `Composition.start/stop/restart`, `sectionForBar`, `targetForBar`, `onBeat`, `onNote`, `onChord`, `finishPiece` |
| `scene` | канвасы, семь шаров, частицы | `balls`, `buildBalls`, `applyPalette`, `clearPen` |
| `viz` | геометрия и картинка режима | `VIZ`, `VIZ_ORDER`, `viz()`, `setViz`, `vizDebug` |
| `game` | правила и счёт | `chordEvent`, `playChordAudio`, `playHarmonic`, `triggerBall`, `pressCode`, `setMode`, `advanceCombo`, `requestAdaptiveAnchor`, `setAdaptiveAnchor`, `resetAdaptive` |
| `listen` | слух приложения | `Heard` (`notes`, `latched`, `sustain`, `recognize()`) |
| `ui-hud` | отображение состояния | `updateHUD`, `updateHomeIndicator`, `renderPalette`, `renderHint`, `updateHeardChip`, `paintSoundChip` |
| `recorder` | запись и прослушивание | `recordChord/Note`, `startRecording`, `stopRecording`, `playSelected`, `deleteSelectedRecording` |
| `ui-panel` | настройки | `bindRange`, `bindSelect`, `bindToggle`, `syncAll`, `togglePedal` |
| `ui-drawers` | выдвижные панели | `drawers`, `drawerOpen`, `drawerIntro`, `setDrawer`, `toggleDrawer`, `setDrawerIntro`, `initDrawers` |
| `ui-compose` | HUD/панель формы и результат | `buildFormHud`, `updateFormHUD`, `resetFormHud`, `setFormEnabled`, `showFormResult`, `initCompose` |
| `input` | физический ввод | `runCommand`, `beginFromOverlay`, стартовая проба `INTRO_KEYS`/`introPress`/`introState`, стрелки `←/→` → `setMode`, `↑/↓` → комбо |
| `midi` | Web MIDI | `Midi`, `MIDI_CONTROLLER`/`MIDI_PIANO`, `resolveEcho` |
| `render` | кадр | `render`, `fitStage` |
| `main` | запуск | boot + `window.HARMONIA` |

## Поток данных

```
клавиша / MIDI / клик по пэду
        │
        ▼
INPUT.commands ──► runCommand ──► nextCombo / setMode / setPaused / togglePedal / mute …
MIDI ──► Midi.noteOn/noteOff ──► echoNote (если звучит ноутбук) ──► Heard.on/off
                                          │  пауза CFG.recognizeMs
                                          ▼
                            describeTriad(pcs) ──► chordEvent ──► scene + HUD
INPUT.chord(code) ──► pressCode ──► chordDown ──► playHarmonic ──► audio + scene + HUD
INPUT.noteIndex(code) ──► pressCode ──► handNoteBalls() ──► triggerBall ──► bell('note') + scheduleNoteChord + энергия
        │
        ├── recordChord / recordNote (если идёт запись; replay не пишется)
        ├── Composition.onChord / onNote (только form.enabled + form.running + phase 'playing')
        ▼
state (visited, chordIndex, harmony, heard, explored, adaptive, score, energy, replay, form)
        │
        ├── Transport.update() в rAF (только transport.running) ──► Composition.onBeat ──► HUD
        ├── noteChordSettleMs ──► noteChordPlan() ──► noteChord() (если нота задержалась)
        ├── chordEvent() ──► requestAdaptiveAnchor() ──► adaptiveSwitchMs + adaptiveNoteGuardMs ──► окно/пэд правой руки
        ▼
updateHUD() + updateFormHUD() + render()  (один rAF-цикл, dt = 0 на паузе)
```

## Инварианты

- `harmonicChords()` кэшируется по
  `state.mode + '#' + state.comboIdx + '#smart:<anchor>:<targetDegree>:<window>:<chord>`
  (или `#roots`); после смены лада/комбо, режима правой руки, anchor, безопасного
  окна, звучащего аккорда или цели Q (такт пьесы / следующий шаг тренажёра) кэш
  инвалидируется автоматически (ключ другой) — руками сбрасывать не нужно.
  `handNoteBalls()` кэшируется так же, но для smart-режима — по anchor, окну и цели.
- `viz()` — единственная точка правды геометрии: `project()` режима используют шары,
  след и вспышка оборота, поэтому режим не может «разъехаться» сам с собой.
- Режим меняется только через `setViz()`: он подсвечивает меню, тостит название и при
  реальной смене сбрасывает `hist` шаров и след (`resetVizLayers`) — старые точки в новой
  геометрии не имеют смысла. `P.viz` руками не пишут.
- `state.visited` — трекер шагов комбо, `state.chordIndex` — ближайший незакрытый шаг.
  Аккорд не «расходуется» и не переключает комбо сам.
- `playable()` — единственная проверка «можно играть» (старт + запущено + не пауза).
  Ею пользуются клавиатура, MIDI, пэд, `playHarmonic` и `triggerBall`.
- `state.started` поднимает только `beginFromOverlay()`: стартовое окно нельзя
  закрыть кликом мимо клавиш. Пока оно открыто, клавиатура отдаёт десять
  `INTRO_KEYS` пробе `introPress()` (повтор не считается, каждая клавиша отвечает
  звуком до старта); десятая вызывает `introFinish()` — окно получает класс
  `fade`, и через `CFG.introFadeMs` стартует сессия. Клик по клавише на схеме
  идёт тем же путём, поэтому проба работает и без физической клавиатуры.
  Экран почти без текста: `h1` + одна строка инструкции со счётчиком
  `#introCount`; прогресс несут сами клавиши (`introKeyEl()` ставит `.hit` и
  снимает `.need`), дорожки точек и кнопки старта больше нет. `#startOverlay`
  лежит на уровне `body`, вне `#game-container`: `fitStage()` масштабирует только
  сцену, иначе клавиши на телефоне сжимались бы до нечитаемых.
  MIDI-нота, запись и пьеса тоже входят через `beginFromOverlay()` — это
  единственная точка старта сессии. `startSession()` при этом снимает режим
  пробы (`setDrawerIntro(false)`): панели остаются свёрнутыми, а у краёв сцены
  появляются табы — игрок сразу играет и открывает меню только по необходимости.
- `drawers` (`ui-drawers.js`) — единственный источник правды о выдвижных панелях:
  `topbar`/`panel` хранят состояние панели (`false` по умолчанию: сессия
  начинается с чистой сцены), `intro` — режим стартового экрана.
  Читать состояние можно только через `drawerOpen(name)` / `drawerIntro()`:
  во время пробы закрыто всё, включая табы. Пишут только `setDrawer()` и
  `setDrawerIntro()` — они же красят классы, табы и `aria-expanded` в
  `paintDrawers()` и зовут `fitStage()`. Закрытая панель получает
  `display: none`, поэтому `fitStage()` считает место по `drawerOpen()`, а не по
  фиксированным 288 px: освободившиеся пиксели уходят в масштаб сцены. Класс
  `body.intro` стоит в `index.html` (меню не мелькает при загрузке) и прячет
  ещё и статус-строку. Состояние панелей живёт в памяти страницы: после пробы
  обе свёрнуты, открыть их можно только табами.
- `releaseAllHolds()` вызывается на паузе, смене комбо, старте сессии и выключении
  sustain: снимает удержания шаров, таймер повтора карточки и педальные хвосты
  (`dampPedalVoices()`), чтобы выключение педали было слышно сразу.
- Кнопка **Педаль** и MIDI CC64 меняют один и тот же `P.sustain`: при нажатой
  педали аккорды/ноты получают удлинённый хвост, при отпущенной —
  `releaseAllHolds()` гасит удержания. `b.sustainLatch` держит ноту правой руки
  после отпускания клавиши, но `CFG.pedalLatchMs` автоматически снимает защёлку,
  чтобы голоса не копились. Педаль включена по умолчанию; `Space` ею больше не
  управляет. Это демо-клавиатура; MIDI-сустейн CC64 по-прежнему живёт в
  `Heard.latched`.
- `setMode()` — путь ручной смены лада для топбара и стрелок `←`/`→`: сохраняет
  номер комбо (мажор и минор одной пары — соседние строки COMBOLIST),
  пересобирает колесо и шары. `nextCombo()`/`prevCombo()` идут по чередующемуся
  маршруту: мажор → минор той же пары, минор → мажор следующей. Ручные
  `Enter`/`↑` и `Backspace`/`↓` доступны всегда, а `advanceCombo()` (Space или
  кнопка под аккордами) проверяет `comboAdvanceReady()`: `state.score` должен
  достичь `CFG.comboAdvanceAt` (1000), игра не должна стоять на паузе или
  проигрывать запись. `updateSpaceNext()` показывает прогресс, включает кнопку
  и пульсацию после рубежа.
- `state.score` — счёт текущего комбо, а не всей сессии: `loadCombo()` обнуляет его
  при каждом входе в комбо. HUD справа — индикатор возврата в тонику: ступень,
  шкала `state.harmony.steps` и число `state.harmony.returns`; прогресс шагов
  показывают галочки на карточках аккордов.
- Красота последовательности считается в `harmony.js`: `harmonyFunction()` делит
  аккорды на T/S/D, `harmonyTransitionBeauty(prev, next, repeats)` складывает
  функцию, общие тоны, шаг корня и разрешение вводного тона, а `harmonyOpeningBeauty()`
  даёт зачин с ii/IV. `chordEvent()` вызывает их до обновления `lastTriad`, поэтому
  очки за ход не зависят от возврата в тонику. `state.harmony.moves` (последние 12
  переходов) ослабляет повтор пары, `state.harmony.phrase` хранит аккорды после
  последней тоники, а `harmonyPhraseBeauty()` добавляет бонус за разнообразие и
  дугу S→D к возврату. Итог виден в `lastBeauty`/`lastBonus` и в статусе HUD
  (`красиво +N` / `домой +N`). Веса — `CFG.beauty`.
- `state.keysDown` — демо-клавиатура, `b.midiHeld` — подсветка шара от MIDI: источники
  разные и не глушат друг друга.
- MIDI не переводится в аккорд по таблице: `Midi.noteOn` звучит своей высотой
  (`echoNote`), регистрируется в `Heard` и через `CFG.recognizeMs` складывается в
  трезвучие. `describeTriad()` возвращает `kind: 'diatonic' | 'secondary' | 'chroma'`,
  а `chordEvent()` принимает любой из них без ветвлений — колесо рисует и «краску».
- Шаров семь — по одному на ступень лада (`diatonicPalette()`): `buildBalls()` берёт
  смещения палитры, поэтому любой аккорд лада зажигает ровно три ступени
  (в «орбитах» — три шара). У правой руки два режима, взаимоисключающий флаг
  `P.smartHand`; кнопка **Звук → Умное переключение** переключает `true/false`:
  - **smart (по умолчанию).** `J I O P [` играют `smartNoteWindow(anchor)` —
    безопасное окно из пяти ступеней. Это не обязательно подряд идущие ноты:
    из всех 21 наборов выбирается тот, где больше тонов текущего аккорда и
    меньше малых секунд/тритонов к уже звучащим нотам. `handNoteBalls()` отдаёт
    индексы этого окна, поэтому бейдж всегда показывает реальную ступень.
  - **без smart.** Пять фиксированных корней аккордов пэда снизу вверх;
    `NOTE_KEYS` не меняется.
  Клавиши `−`/`=` меняют `P.noteOct` (±1 октава): `triggerBall()` играет сдвинутую
  высоту, `holdStart()` берёт её из `b.playMidi`, запись хранит реальный midi.
  Сами шары остаются на своих ступенях. MIDI играет всё.
- Smart-окно двигает `state.adaptive` (см. `state.js`): `anchor` — ступень,
  от которой строится окно, `window` — уже выбранные индексы палитры,
  `pendingAnchor` — куда оно должно переехать, `switchTimer` — отложенное
  применение, `lastNoteAt` — защита от перестройки под только что сыгранной
  нотой, `chordAnchorAt` — время последнего аккорда. `chordEvent()` после
  диатонического аккорда (не chroma/secondary) зовёт `requestAdaptiveAnchor()`
  через `smartAnchorForChord()`: уменьшённое трезвучие не становится новым
  центром, а выбирает устойчивую функцию с максимальным числом общих тонов.
  Применение ждёт `adaptiveSwitchMs`, отпускания клавиш/MIDI и `adaptiveNoteGuardMs`
  после ноты, чтобы карточки не менялись под зажатой рукой. `pendingRefresh`
  пересобирает окно и Q, даже если anchor не изменился, а сменилась цель
  тренажёра/пьесы.
- Левая рука в smart-режиме: `smartChordDegrees(anchor, target)` ставит на Q
  адаптивную ступень. Цель тренажёра/пьесы имеет приоритет, но уменьшённые
  ступени без явной цели не выбираются: среди остальных Q максимизирует общие
  тоны с текущим аккордом, anchor и безопасным окном, учитывает красоту
  перехода и штрафует полутоновые/тритоновые столкновения. `W E R F` остаются
  фиксированными IV · V · vi · I (iv · V · VI · i), поэтому привычные функции
  не прыгают. `smartTargetDegree()` берёт цель такта пьесы, пока форма играет,
  иначе — следующий шаг тренажёра; `harmonicChords()` кэширует цель, окно и
  звучащий аккорд, а `paintChordPad()` сверяет текст карточек и меняет Q без
  пересоздания DOM, поэтому цель видна на границе такта, даже если игрок ещё
  не взял аккорд.
- Скорость покоя `DEFAULTS.speed = 0`: без нажатий шары стоят (импульс от ноты/аккорда
  затухает), а полный оборот больше не начисляет очки. Счёт растёт только от игры:
  энергия удержанных нот, красота переходов и возврат в тонику, причём отдельно
  для каждого комбо.
  `DEFAULTS.boost = 150°`,
  `DEFAULTS.tau = 1.00 с`, `DEFAULTS.fade = 35` и `DEFAULTS.reverb = 1` — движение,
  затухание пера и реверберация по умолчанию.
- Звук нот MIDI — `state.echo`: контроллер без динамиков озвучивает ноутбук, stage
  piano — нет. Выбор помнится в `localStorage` по `input.id` (`Midi.resolveEcho`).
- Сустейн CC64 живёт в `Heard.latched`: отпущенные ноты продолжают участвовать в
  распознавании, пока педаль нажата. `Heard.recognize()` сначала пробует зажатые ноты,
  затем всё звучащее; CC123 и потеря фокуса окна вызывают `Midi.panic()` → `Heard.clear()`.
- `VIZ_SAFE_Y` — вертикальная полоса сцены, свободная от карточек HUD. Любая геометрия
  и любая подпись обязаны в неё попадать: `vizDebug()` проверяет это для каждого режима,
  `vizPickLabel()` штрафует кандидатов за выход из полосы и за наложение на соседний шар.

## Визуализации

Режим — объект в `VIZ` с пятью методами и необязательным флагом `pen: false`
(«круг» не рисует шары и перо). По умолчанию `DEFAULTS.viz = 'orbits'`; порядок
цифр задаёт `VIZ_ORDER` (`orbits`, `spectrum`, `circle`). Физика общая (`render.js`):

| Метод | Что делает |
| --- | --- |
| `project(b, angle)` | экранная точка шара для угла орбиты — ею же рисуется след и вспышка оборота |
| `guides(ctx, now)` | фон режима: направляющие, оси, пояс аккорда |
| `center(ctx, now, live)` | центр сцены: солнце тоники или спектр сигнала |
| `ball(ctx, b, now)` | хвост, тело и подпись шара (в `circle` метод пустой: шаров нет) |
| `ring(ctx, f, alpha)` | вспышка полного оборота орбиты |

| Режим | Геометрия |
| --- | --- |
| `orbits` | угол — `phi` от физики плюс постоянный сдвиг `orbitSpread()` (круг делится на число шаров, иначе все на одном луче), радиус — `b.r`; режим по умолчанию (`DEFAULTS.viz`) |
| `spectrum` | шары по орбитам, в центре — `AnalyserNode`: лучи по бинам (`SPEC_SPOKES`), кольцо `SPEC_R1`, плашка с центром масс μ |
| `circle` | угол — `vizFifthsStep(pc)` (Δ·7 mod 12 — биекция Z₁₂), радиус — `vizCircleRadius(midi)` с якорем `rootMidi()+11`; вибрато в полутонах не меняет радиус, поэтому «радиус = высота»; на поясе `CFG.chordBelt` — треугольник аккорда; имена нот подписаны на станциях (`vizCircleStations`), шары и перо выключены (`pen: false`), чтобы картинка не шумела |

Музыкальные примитивы режима «круг» — `vizTonicPc()`, `vizFifthsStep()`,
`vizCirclePoint()`, цвет аккорда `vizChordColor()` (T золотая, S голубая, D красная),
дуга перехода `vizTransitionArc()`. Активный аккорд берётся из
`state.harmony.lastTriad/lastAt` и гаснет за `CFG.chordFadeMs`, поэтому оверлей не зависит от
того, кто его сыграл: клавиатура, MIDI или пэд.

## Форма-пьеса

Форма — необязательный слой: `state.form.enabled = false` по умолчанию, поэтому
свободный джем не запускает ни транспорт, ни HUD, ни очки формы. Включение —
`setFormEnabled()` / `Composition.start()`; выключение — `Composition.stop(true)`.
`totalBars()` берёт длину из `CFG.composition.bars`, поэтому 16 тактов не зашиты
в старт, `onBeat` и финал.

- **Часы.** `Transport` хранит BPM, размер, длину в долях, отсчёт и метроном.
  `Transport.update()` вызывается из `render.js` только когда `state.transport.running`
  и сессия live; `_dispatch()` догоняет пропущенные доли, если вкладка была неактивна.
  Метроном планируется по часам `AudioContext` (`_scheduleClicks`), а не по кадрам, и
  идёт через мастер-шину, поэтому учитывает mute. `pause/resume` сохраняют позицию;
  `stop()` полностью сбрасывает `state.transport` (`bar`, `beat`, `beatInBar`, `countIn`,
  `phase='idle'`), чтобы после финала не осталось «живого» такта.
- **Драматургия.** `Composition.sectionForBar()` раскладывает такты по секциям
  (`intro`, `a`, `b`, `ap`, `coda`), `beginSection/finishSection` собирают статистику
  секции. `targetForBar()` возвращает ступень из `CFG.composition.plans[state.mode]`
  и ищет её в актуальной `diatonicPalette()`, поэтому смена лада/комбо посреди пьесы
  не оставляет цель «из прошлой тональности».
- **События.** `chordEvent()` зовёт `Composition.onChord()`, а `triggerBall()` /
  `Midi.noteOn()` — `Composition.onNote()`; оба пути пропускают replay и требуют
  `enabled`, `running`, `phase === 'playing'`. Поэтому аккорд или нота во время
  отсчёта, паузы или после `stop()` не могут засчитаться. `onNote()` копит
  `state.form.melody` (ноты, диапазон, разные звуки) и ту же статистику в текущей секции.
  `onBeat()` также требует `enabled + running`; последний такт и `finishPiece()`
  ограничены `totalBars()`.
- **Очки.** Цель такта — `CFG.composition.targetBonus`; в конце секции —
  `sectionDone`, `sectionTarget` (половина целей), `sectionVariety` (≥3 разных
  аккорда), в коде — `finalTonic` / `finalDominant`. `award()` пишет и в общий счёт
  комбо (`addScore`), и в `state.form.points`, а результат отдаёт `showFormResult()`.
- **Пауза и результат.** `setPaused()` вызывает `Composition.setPaused()` только для
  запущенной пьесы. Пока `#formResult.show`, `input.js` игнорирует игровые клавиши, а
  `setPaused()` не открывает паузу: законченную пьесу нельзя «продолжить» случайным
  `Esc`. `resetFormHud()` пересобирает полосу тактов перед стартом, поэтому `done` и
  `current` прошлой пьесы не мигают на новой.
- **Запись.** `startRecording()` сохраняет `rec.form` (`bpm`, `beatsPerBar`, `bars`,
  `points`), а `recordEvent()` добавляет к событию `form: { bar, beat, section }`,
  если пьеса идёт. Это метаданные, а не отдельный формат аудио.

## Звук

`initAudio()` строит `master → компрессор → destination` и параллельный посыл в
свёрточный реверб (`wetGain` ← `P.reverb`). Перед `master` стоят две шины громкости:
`noteGain` (`P.noteVol`, по умолчанию 0.25) и `chordGain` (`P.chordVol`, 1).
`routeVoice()` отправляет сухой сигнал в нужную шину, а реверб-посыл масштабирует
той же громкостью; `applyVoiceVolumes()` меняет шины на лету из панели **Звук**.
Голоса:

- `bell(midi, vel, pan, when, timbre, hold)` — таблица `BELL_TIMBRES`:
  `note` (тело 0.5, «хор» 1.004, обертоны до 5.43, двухстадийная огибающая и
  лёгкая стереоширина по обертонам) и `chord` (4 обертона, короткий хвост, тише).
  `vel` задаёт и громкость, и срез ФНЧ;
  у нот срез дополнительно масштабируется `P.tone` («Яркость нот»). `hold` — множитель
  длины для сустейн-педали: педальный хвост получает `autoFadePedalVoice()`
  (`CFG.pedalFadeMs` = 1.4 с, плато 35 %), а число одновременных хвостов ограничено
  `CFG.pedalMaxVoices`, поэтому старые голоса не наслаиваются в «кашу».
- `echoNote(midi, vel, hold)` — нота с MIDI: своя высота, панорама по питчу
  (`(midi−60)/48`), `latencyHint: 'interactive'` у AudioContext. Вызывается только
  когда `state.echo`, иначе пианино звучит само.
- `scheduleNoteChord(midi, vel, pan)` — путь клавиатуры и озвученного MIDI:
  нота сначала звучит одна, а через `CFG.noteChordSettleMs` (140 мс) получает
  автотрезвучие. Следующая нота, пауза, смена раскладки и `stopPlayback()`
  отменяют таймер (`cancelPendingNoteChord()`), поэтому быстрые арпеджио не
  оставляют облако сменяющихся аккордов. Отдельного флага «Аккорды на нотах»
  нет: автотрезвучия всегда включены.
- `noteChordPlan(midi, vel, pan)` — чистый план без AudioNode. В smart-режиме
  `smartHarmonyForNote(pc)` берёт последний диатонический аккорд левой руки;
  если нота даёт с ним малую секунду или тритон, возвращается `false` и
  автотрезвучие не звучит вовсе. Без smart `chordOnDegree()` даёт трезвучие
  самой ступени. Корень ставится не выше мелодии (`C` под `D` даёт `C-E-G`,
  а не `D-F-A`). `noteChord()` исполняет план: `bell('chord')` играет корень
  октавой ниже, унисон, терцию и квинту; под педалью хвост укорачивается через
  `CFG.noteChordTail`. MIDI гармонизируется только когда приложение само его
  озвучивает (`state.echo`), а не когда звучит пианино.
- `holdStart/holdStop` — удержанная нота: суб-октава, треугольник, тихий обертон
  2.003 и медленный авто-пан через LFO. Терция и квинта здесь больше не тянутся:
  длинный сустейн остаётся чистым, а аккорд приходит отдельным коротким
  автотрезвучием.
- `bass(midi, when)` — треугольник + суб + пила через ФНЧ с быстрым спадом;
  `when` позволяет внешнему коду запланировать голос заранее.
- Возврат в тонику не имеет отдельного звука: тоника уже сыграна аккордом, а
  событие остаётся визуальным (кольцо, вспышка и постоянный индикатор HUD).

Браузеры запускают AudioContext только после жеста, поэтому `initAudio()` вызывается
из стартовой пробы (`introPreview`), `beginFromOverlay`, кнопок и первого note-on.

## Запись и прослушивание

`recorder.js` пишет события, а не аудио: `recordChord(h, vel)` сохраняет снимок
аккорда с исходной `rootMidi()`, `recordNote(midi, vel, pan, withChord)` — реальную
высоту и признак «гармонизировать ли ноту». `chordEvent()` и `triggerBall()` вызывают
эти функции только между стартом и стопом записи; MIDI-ноты пишет `Midi.noteOn`
(без подложки), а распознанный с MIDI аккорд не дублируется (`source: 'midi'`). Записи лежат в `localStorage` (`rithm.recordings.v1`), список
ограничен 30 записями, 6000 событий и 3 минутами.

`playSelected()` ставит `state.replay = true` и запускает события по таймерам через
`playChordAudio()` / `bell()` + `noteChord()`. В этом режиме `addScore()`,
`cashEnergy()`, шаги и переход по Space не срабатывают: прослушивание не
зарабатывает очки. `stopPlayback()` отменяет таймеры и гасит педальные хвосты.

- **Отсчёт.** `startRecording()` читает `P.recCountIn` (0/1/2 такта). При ненулевом
  значении `state.recording` остаётся `false`, поэтому `recordNote/recordChord` не
  пишут случайные ноты; `state.recordingCountIn` и `recCountInBeat` показывают тик,
  а `metronomeClick()` идёт через мастер-шину. `beginRecordingNow()` стартует запись
  на следующей сильной доле и обнуляет `recEvents`. `stopRecording()` во время
  отсчёта отменяет таймеры, не создавая пустую запись.
- **Повтор.** `startPlaybackCycle(rec, token)` планирует один проход; в конце цикла
  при `P.recLoop` он вызывает себя снова, а иначе `finishPlayback()`. `playbackToken`
  и `state.playingRecording` остаются едиными для всех кругов, поэтому «Стоп»,
  смена записи и `stopPlayback()` отменяют повтор одной проверкой. Таймеры прошлого
  круга снимаются, чтобы они не копились.

## Точки расширения

| Задача | Куда смотреть |
| --- | --- |
| Новая горячая клавиша/команда | `INPUT.commands` + `runCommand()` |
| Другой набор аккордов пэда | `HARMONY` (ступень, терция, смещение) |
| Другая палитра лада | `PALETTE_SLOTS` (7 ступеней; `fifth: 6` у уменьшённых) |
| Другое правило распознавания | `TRIAD_SHAPES` + `describeTriad()` |
| Правило smart-окна/левой руки | `harmony.js`: `SMART_FIXED_DEGREES`, `smartNoteWindow`, `smartAdaptiveDegree`, `smartChordDegrees` |
| Момент переезда окна | `game.js`: `requestAdaptiveAnchor`, `scheduleAdaptiveApply`, `CFG.adaptiveSwitchMs` |
| Задержка/тембр автотрезвучий | `audio.js`: `scheduleNoteChord`, `noteChordPlan`, `noteChord`, `holdStart`; `CFG.noteChord*` |
| Звук нот MIDI / педаль | `Midi.resolveEcho`, `Heard.setSustain`, `echoNote` |
| Новый тембр ноты | `BELL_TIMBRES` в `audio.js` |
| MIDI CC / aftertouch / пэды | `Midi.handle()` |
| Новая палитра | `PALETTES` + `<option>` в `index.html` |
| Новая визуализация | `VIZ` + `VIZ_ORDER` (`project/guides/center/ball/ring`) — меню и цифры `1`–`3` строятся сами |
| Порог Space-перехода | `CFG.comboAdvanceAt` + `advanceCombo()` / `updateSpaceNext()` |
| Состав стартовой пробы | `INTRO_KEYS` + `introPress()` + `data-key` на клавишах в `index.html` |
| Веса красоты переходов/фраз | `CFG.beauty` + `harmonyTransitionBeauty()`, `harmonyPhraseBeauty()` |
| Громкость нот/аккордов | `P.noteVol`/`P.chordVol` + `noteGain`/`chordGain` в `audio.js` |
| Новый параметр панели | `DEFAULTS` → разметка `.prow` → `bindRange/bindToggle` |
| Длина/секции/цели пьесы | `CFG.composition` (`bars`, `sections`, `plans`, бонусы) |
| Темп, размер, отсчёт, метроном | `P.form*` + `Transport.start/setBpm/setMetronome` |
| Отсчёт/повтор записи | `P.recCountIn` / `P.recLoop` + `startRecordCountIn()` / `startPlaybackCycle()` |
| Мелодическая статистика пьесы | `Composition.onNote()` + `state.form.melody` + `showFormResult()` |
| Другой алгоритм очков формы | `Composition.onChord/finishBar/finishSection` |
| Экран результата | `showFormResult()` / `hideFormResult()` в `ui-compose.js` |
| Формат записи / лимиты | `recorder.js`: `REC_*`, `recordEvent`, `playRecordedEvent` |
| Другой источник данных | `data/COMBOLIST.csv` → `tools/combolist.py` |

## Проверка

- `python tools/combolist.py --check` — CSV музыкально корректен (I–IV–V–I, трезвучия
  в основной форме, ноты по терциям) и данные в коде совпадают с CSV.
- Консоль: `HARMONIA.state`, `HARMONIA.diatonicPalette()`, `HARMONIA.describeTriad([0,4,7])`,
  `HARMONIA.Midi.noteOn(60, 0.9)`, `HARMONIA.Heard.pcs()`, `HARMONIA.harmonyDebug()`,
  `HARMONIA.vizDebug()`, `HARMONIA.setViz('spectrum')`, `HARMONIA.cycleViz()`.
- Headless-прогон (Chrome): открыть `index.html`, пройти пробу
  (`HARMONIA.INTRO_KEYS.forEach(code => HARMONIA.introPress(code))`) или вызвать
  `HARMONIA.beginFromOverlay()`, проверить `HARMONIA.state.visited`, `score`,
  число `.chord-card`, отсутствие ошибок в консоли;
  затем `Midi.noteOn(60/64/67)` → `state.heard.triad.degree === 'I'`.
- `tools/_smoke_build.ps1` собирает `smoke.html` с шагами boot/intro-drill/
  free-jam/форма/запись/smart-раскладка; headless Chrome с `--dump-dom` оставляет в
  `<pre id="smoke-result">` строку `ok:true`. Шаг `intro-drill` держит стартовое
  окно открытым, пока не нажаты десять клавиш: одна строка инструкции и счётчик
  `0 / 10 → 10 / 10`, клавиатура не уже 85 % ширины окна и выше двух строк
  текста, повтор не двигает счёт, после десятой все клавиши `.hit` и появляется
  класс `fade`. Шаги `default-sound`,
  `melody-layout`,
  `space-combo-advance`, `smart-hand-window`, `smart-resume-window`,
  `diminished-anchor`, `smart-form-target`, `adaptive-defer` и
  `note-chord-harmony` проверяют стартовые настройки звука и педали, два режима
  одной кнопки, безопасное окно V (`ii iii V vi vii°`), проходящий vii°,
  пересборку окна при возврате в smart, цель такта пьесы и её карточку Q,
  отсутствие переезда под зажатой клавишей, подавление автотрезвучия на
  полутоновом столкновении, гармонизацию без smart и переход Space после 1000
  с чередованием мажора и минора.
- `tools/_visual_build.ps1` + headless `--screenshot` дают `visual.png` для
  быстрой проверки вёрстки без ручного клика.
- Форма: `HARMONIA.Composition.start()` → отсчёт, `state.form.phase === 'countin'`,
  затем `state.transport.bar === 1`; сыграть `targetForBar(1)` → `state.form.barTargetHit`;
  проверить финал, `#formResult.show`, блокировку `Esc` и возврат в джем.
