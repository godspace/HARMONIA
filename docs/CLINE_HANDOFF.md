# HARMONIA — handoff для нового таска Cline

**Обновлено:** 2026-11-26
**Рабочая папка:** `C:\Users\godspace\Desktop\PROJECTS\HARMONIA`  
**Репозиторий:** <https://github.com/godspace/HARMONIA>  
**Ветка:** `main`  
**Базовый коммит (до добавления handoff):** `3c4d577 Add Google Search Console verification`  
**Синхронизация:** `main` = `origin/main`; точный хеш — `git log --oneline -1`.  
**Живой сайт:** <https://godspace.github.io/HARMONIA/>

> Папка `RITHM` удалена. Не восстанавливать её и не работать в ней.
> Этот файл — точка входа для нового таска Cline. Полная документация проекта —
> в `README.md`, карта модулей — в `docs/ARCHITECTURE.md`.

## 1. Текущее состояние

- HARMONIA — статический сайт без сборки и зависимостей: HTML + CSS + classic JS.
- GitHub Pages публикует корень ветки `main`; после `git push origin main` деплой
  запускается автоматически.
- В `index.html` добавлен независимый метатег Google Search Console:

  ```html
  <meta name="google-site-verification" content="WQZso1a4LcVn2_Adr-JlpDhe5KHCz_qSr4MS75SxeGc">
  ```

- В smoke-тест (`tools/_smoke_build.ps1`, шаг `seo`) добавлена проверка точного
  значения этого метатега.
- README обновлён: smoke-тест теперь явно проверяет метатег Google.
- Коммит `3c4d577` отправлен в `origin/main`; рабочее дерево чистое.
- Живой сайт отдаёт метатег, `sitemap.xml` отвечает HTTP 200.
- Google уже подтвердил владение через родительский ресурс
  `https://godspace.github.io/`, но HTML-тег даёт второй независимый способ
  подтверждения. Удалять его нельзя.
- Переключатель языков (`js/translate.js`, `#langSel` в топбаре) грузит
  Google Translate только после явного выбора посетителя; шаг `lang-switch`
  в smoke-тесте проверяет, что до выбора скрипт не подключён. Машинный
  перевод не индексируется.
- **Английский интерфейс — свой пакет** `js/i18n.js`, а не Google: словарь
  `MAP`, шаблоны `RULES`, наблюдатель за подписями и `I18N.text()` для canvas.
  Включается тем же `#langSel` (или `?lang=en`), работает без сети и на
  `file://`, переводит в том числе `title`/`aria-label`. Шаг `en-labels` ищет
  кириллицу в английском интерфейсе и падает, если строку забыли в словаре.
  Остальные языки по-прежнему идут через Google Translate.
- Англоязычная версия — отдельная статичная страница `en/index.html`
  (`css/landing.css`, без скриптов) с парой `hreflang` ru/en/x-default и
  `xhtml:link` в `sitemap.xml`. Вход — ссылка «EN» в топбаре (`#enLink`,
  внутри `.brand-group` рядом с названием, чтобы полоса не переносилась).
  Smoke-тест собирает и её (`en/smoke.html`): шаги `lang`, `head`, `hreflang`,
  `social`, `json-ld`, `content`, `no-scripts`, `console-errors`. Якоря
  `#suno` и `#space` объясняют отправку записи в Suno и роль пробела; шаг
  `content` проверяет, что оба раздела на месте.
- **Русский обзор проекта — `ru/index.html`** (`/ru/`): та же история, что на
  английской странице, но в исходном языке. Свой `canonical`, Open Graph и
  JSON-LD (`WebApplication` + `FAQPage`), в `sitemap.xml` — отдельная запись без
  `xhtml:link` (кластер `ru → /` уже занят канонической страницей). Вход —
  «О проекте» в панели настроек (`#aboutLink`, блок «Сессия») и подвал
  `en/index.html`. Smoke: `ru/smoke.html`, шаги `lang`, `head`, `links`,
  `content`, `json-ld`, `no-scripts`, `console-errors`.
- Блок счёта на сцене называет комбо музыкально: под числом стоит `#comboKey`
  (`До мажор` / `C major`). Маршрут и переход живут в одном верхнем виджете
  `#comboStrip` между счётом и «Домой»: две строки по двенадцать ячеек в порядке
  круга, ячейка светлеет при входе в комбо (`seen`), зеленеет после сыгранного
  цикла (`done`), текущая мигает золотом (`current`). В нижней строке того же
  виджета — кнопка `#spaceNext`: до 300 она показывает `N / 300`, после —
  `готово` и пульсирует. На рубеже 300 и на +150/+300 сверх него виджет дважды
  подсвечивается (`nudgeSpace`), кнопка подпрыгивает; модальных окон и тостов
  нет (карточка исследования — отдельный необязательный слой после перехода).
  Круг тональностей повторяет имя комбо в центре (`№1 · До мажор · 0/12`).
  Под карточками аккордов — `#keyMap`: пять мини-клавиатур с зажжёнными нотами
  аккорда и золотым корнем, только для визуальной ориентации (`aria-hidden`,
  `pointer-events:none`). Smoke-шаги `space-hint`, `combo-strip`, `key-map`.
- Нотация подписей — `P.notation` (`sol` | `letters`), переключатель
  **Звук → Нотация**. Язык выбирает её сам: латиница — `C-D-E` / `C major`,
  русский и украинский — `до-ре-ми`. Строка `#comboKey` помечена
  `notranslate` и входит в `SHIELD`, чтобы Google не превращал «До мажор» в
  «Before major». Smoke-шаги `space-hint`, `combo-strip` и `notation` держат это
  поведение.
- **Барабаны · грув** — второй необязательный слой (после формы), в `DEFAULTS`
  выключен, но включает его игрок: `Enter` запускает барабаны на стартовой пробе
  (`Groove.startPreview()` — грув звучит до первой ноты) и он же включает и
  выключает их в игре. Комбо живут на `↑`/`↓`, `Backspace` и `Space` после 300;
  `Enter` больше не дублирует их. Данные — `CFG.groove.patterns` (строки шагов
  `o`/`x`/`g`/`.`), часы и
  планировщик — `js/groove.js`, звук — `drumHit()`/`DRUM_TIMBRES` в `js/audio.js`,
  отдельная шина `drumGain` (`P.drumVol`, 20 %), фигура по умолчанию — баллада.
  Панель — `#groovePg`
  (`bindGroove` в `ui-panel.js`); пока идёт пьеса, барабаны ведут её темп и размер
  (ползунок темпа гаснет), в джеме считают `P.grooveBpm`. Ручная игра — только
  MIDI-пэд канала 10 (`DRUM_MAP` в `midi.js`): пэд звучит, но не становится нотой,
  поэтому не попадает ни в слух, ни в счёт; в записи он и автоматические удары
  живут отдельной дорожкой `drums`. Smoke: `groove-patterns`,
  `groove-toggle`, `groove-enter`, `groove-follows-form`, `groove-hits`.
- Стартовый экран знакомит с клавишами тремя шагами: десять клавиш → `Enter`
  (барабаны, класс `.drums`) → `Space`. Подсказка `#kbTip` объясняет двенадцать
  игровых клавиш при наведении и нажатии (`data-tip`, переводится языковым
  пакетом), стрелки оставлены с прежней подписью «лад / комбо». Smoke:
  `intro-tips` и обновлённый `intro-drill`.
- Про барабаны рассказано на обоих лендингах: карточка в списке возможностей,
  раздел «Барабаны» рядом с «Записью» и вопрос в FAQ (`Are there drums?` /
  `Есть ли барабаны?`). Вопрос продублирован в JSON-LD `FAQPage` дословно —
  иначе Google считает разметку несоответствующей странице.
- **Характер станции** (`js/station.js`) — ответ на «все станции звучат одинаково».
  Двенадцать пар круга получили разные подачи: расположение голосов пэда
  (`voicing`), позицию баса (`bass`), октаву станции (`register`) и огибающую
  колокола (`touch`: `bell`/`glass`/`felt`/`pluck`). Набор нот при этом не меняется:
  пэд играет те же {корень, терция, квинта}, правая рука — то же окно из пяти
  ступеней, поэтому smart-режим и автотрезвучия остаются безопасными. Первая пара
  (до мажор / ля минор) звучит как раньше — эталон; прослушивание записи тоже идёт
  с эталонной подачей. Ручной выбор — `P.stationStyle` (по умолчанию `'auto'`) или
  `HARMONIA.setStationStyle('glass')`. Smoke-шаг `station-style` держит таблицу,
  различие соседей по кругу, неизменный pitch class у всех аккордов всех станций и
  шары в октаве станции.
- **Сюжет пары** (`js/station.js`) — следующий слой после характера: аккорды
  переводят станцию через `home → departure → turn → shadow → return`, а
  `STATION_PLOT_ARCHETYPES` меняет `voicing`, `bass` и `spread` окна правой руки.
  Это не таймер и не фиксированная мелодия: фаза — функция от сыгранной
  гармонии. `P.stationPlot` (`'auto'`/`'off'`) и `HARMONIA.setStationPlot('off')`
  дают A/B; при `off` звучит только базовый характер. HUD показывает
  `#stationPlot` («арка · уход · 1–5–6–5»), исследование пишет `seg.plot` и
  `phase`/`fromPhase`/`motif`/`window` аккордов. Smoke-шаг `station-plot` держит
  фазы, `off`, HUD, неизменный pitch class и октаву у всех фаз всех станций.
- **Жест атаки станции** — шестая ось характера в `js/station.js`:
  `STATION_GESTURES` задаёт задержки трёх голосов пэда (`block` / `up` / `down` /
  `harp` / `sparkle`…), `stationVoiceDelays()` раздаёт их по высоте, а
  `playChordAudio()` прибавляет к `AudioContext.currentTime`. Ноты не меняются;
  первая пара остаётся блоком. `STATION_PLOT_GESTURES` меняет рисунок по фазе
  сюжета. A/B — `P.stationGesture` / `HARMONIA.setStationGesture('off')`.
  Smoke-шаг `station-gesture`.
- **Запись, MIDI, аудио и видео** — `js/recorder.js` + `js/video.js` +
  `js/audio-export.js`. Фоновая дорожка
  пишется параллельно ручной: `autoRecordStart()` в конце `loadCombo()`,
  `autoRecordFinalize()` при смене станции, паузе и `beforeunload`; пустые визиты
  не сохраняются. Запись хранит `auto`, `combo`, `station`, `plot`, `gesture`,
  `events`, `drums` и называется «Станция 3 · войлок»; при прослушивании
  возвращает сохранённый характер станции (`rec.station` + `STATION_TOUCH`),
  ручная запись остаётся эталонной. Кнопка **Автозапись станции** и
  `P.autoRecord` управляют слоем. Удар — отдельное событие `drums`:
  `recordDrumAt()` пишет его в момент фактического звучания, а
  `recordingTimeline()` объединяет мелодию и ритм для прослушивания, WAV и видео.
  **⬇ MIDI** собирает SMF format 0 (PPQ 480) только из `rec.events` — барабаны
  туда не входят. **⬇ Аудио** (`startAudioExport`) сохраняет WAV 16-bit PCM через
  `audioCaptureStream()` и `ScriptProcessorNode`: Suno не принимает MIDI, а звук
  идёт по тому же таймлайну. WAV стартует с первой ноты, `audioPcmTrim()`
  срезает цифровую тишину по краям, а фоновый грув вне мелодии не попадает в
  файл. **⬇ Видео**
  (`startVideoExport`) снимает канвасы и звук по
  тому же таймлайну в вертикальный WebM 720×1280 (9:16): бренд сверху,
  метаданные и текущий аккорд, прогресс с тиками и финальная карточка со
  ссылкой. Разметка живёт в сетке 1080×1920 и уменьшается transform'ом.
  Звук и картинка считаются от одного `mediaT0` на часах AudioContext:
  `videoMediaElapsed()` задаёт подписи и прогресс, `videoStepVisual()` включает
  вспышки нот до отрисовки sprite-слоя, а композит кадра собирает
  `videoFrameStep()` на отдельном таймере 30 fps; `captureStream(30)` снимает
  готовый 720p-холст. Поэтому `MediaRecorder.start()`,
  `setTimeout` и даже остановка rAF не оставляют картинку замершей при живом
  звуке. Возврат в тонику в replay зовёт `flashTonicReturn()` и повторяет
  золотую вспышку игры. Края ролика задаёт мелодия: фоновый грув до первой ноты
  и после последней отбрасывается, первая нота идёт в кадр 0, затем короткий
  музыкальный хвост и финальная карточка. Заголовок кадра и подписи —
  тоническое трезвучие (`Ля-До-Ми` / `A-C-E`), а не «Станция 13 · эталон».
  Новые ручные записи сохраняют `combo` (включая аккорды), `bpm` и
  `beatsPerBar` для подписи кадра. **📋 Подпись** копирует готовое описание для
  соцсетей. Живой грув на время рендера выключен, старые записи без `drums`
  рендерятся без ударных с предупреждением. В карточке исследования есть
  **⬇ Аудио** и **⬇ Видео**: `recordingId` сегмента указывает на
  авто-запись этого визита, поэтому экспорт не зависит от выбора в панели.
  Smoke-шаги `station-auto-record-midi` и `record-drums-video`.
- **Suno без API** — `js/suno.js`. `sunoPrompt(rec)` собирает только английский
  текст из `combo.keyNameLatin`, `bpm`/`form.bpm`, `beatsPerBar`,
  `station.touch` и `drums`; старые записи получают `C major`, 84 BPM, 4/4,
  `warm piano`, `no drums`. Первый клик **🎛 Suno** копирует промпт и зовёт
  `startAudioExport(rec, {purpose:'suno', onDone})` — WAV и имя файла те же, что
  у **⬇ Аудио**. После сохранения кнопка становится **↗ Suno**; второй клик
  копирует промпт и сразу открывает `https://suno.com/create` (отложенный
  `window.open` блокируется). В панели и карточке оценки кнопки
  `#recSuno` / `#researchAskSuno` делят `sunoReady`, но привязаны к id записи.
  Официальный API Suno не используется: он требует ключ и сервер, а форма на
  чужом домене недоступна. Free-план: 50 кредитов/день, загрузка до 8 минут,
  без скачивания и коммерческих прав (проверено 24.11.2026); запись HARMONIA
  ограничена 3 минутами. Smoke-шаг `suno-handoff`.
- **Исследование оценок комбо** — `js/research.js`, по умолчанию включено
  (`harmonia.research.settings`, `version: 2`). Выключается `?research=0`,
  `HARMONIA.research.disable()` или секцией
  **Исследование · оценки комбо** в панели. После Space-перехода (advanceCombo)
  открывается карточка `#researchAsk`: оценка `1–5` (J I O P [ = 5 4 3 2 1),
  необязательный комментарий (≤160), **⬇ JSON** / **⬇ Аудио** / **⬇ Видео** для
  этой авто-записи; ручные переходы карточку не открывают. **⬇ JSON** пишет один
  визит (`exportScope: 'visit'`), его события с `source` (`keys`/`midi`), оценку
  и `recording`; автозапись необязательна. После оценки карточка остаётся
  открытой, показывает `Оценка сохранена · N/5`, меняет «Пропустить» на «Готово»
  и выключает автопропуск — так файл успевает сохраниться. Закрытие —
  «Готово»/Space/Esc; на время экспорта автопропуск также стоит (`holdAsk`),
  после — возвращается только для ещё не оценённой карточки.
  В `localStorage` (`harmonia.research.v1`, настройка
  `harmonia.research.settings` с `version: 2`) лежат посещения: `dwellMs`, `playMs`, ноты и
  аккорды, счёт, `exit.via`, `recordingId` авто-записи, характер станции,
  нотация, октавы, форма, грув и оценка. Экспорт — `harmonia-research-*.json` с
  `STATION_STYLES`, `STATION_TOUCH` и библиотекой комбо; точечные выгрузки —
  **⬇ JSON** карточки (`harmonia-combo-*.json`, `exportScope: 'visit'`) и панели
  записи (`exportScope: 'recording'`, запись + связанные визиты, у ручной записи
  `segments: []`). `recordingMissing` отмечает потерянную автозапись. Разбор —
  `tools/research.py` (`--md`, `--csv`, `--min-n`, `--self-test`). Smoke-шаг
  `research-rating` проверяет запись, клавиши, комментарий, Esc, связь с
  авто-записью, форму JSON и очистку.
  P0a добавил в визит `timing` (`activePlayMs`, `tailMs`, `recordingCoverage`),
  `runs[]` (`durationMs`, `notes`, `chordHits`, `noteDensity`, `endedBy`),
  `counts.chordChanges/longestChordRun` и `fingerprint` (pitch class/октавы,
  `chordSeq`, переходы). Эти агрегаты считаются до `MAX_EVENTS`, поэтому
  `overflow: true` их не теряет. `tools/research.py` теперь различает `flow`,
  `productive_struggle`, `stuck`, `local_stuck`, `short` и печатает эталоны.
- **Инлайн-подсказки на карточках** — `js/guide.js` (P0c). Отдельного меню и
  `H` больше нет: подсказки живут на пяти карточках `#chordPad`. Названия нот
  разбиты на `.cc-note[data-pc]` и красятся по роли для баса под текущим
  аккордом: золотой корень, зелёные терция/квинта, янтарная мягкая краска,
  приглушённые трение/вне лада. Нижняя полоска карточки показывает роль её
  корня, а самая низкая зажатая MIDI-нота получает `bn-live` — видно, где
  левая рука. Следующий аккорд из тех же 2–3 ходов получает `.guide-next`
  (зелёная рамка и стрелка); в пьесе приоритет у цели такта, затем Develop,
  Hold, Contrast. `hintShown` пишется автоматически при смене подсвеченного
  аккорда, `hintPicked` — если игрок сыграл именно его. Эталонный профиль
  строится из оценок 4–5/`rating.reference`: один эталон в другой тональности —
  `hypothesis`, три и больше — перенос по ступеням. Smoke-шаг `guide-inline`.

## 2. Что осталось сделать вручную

Это действия в браузере, не в репозитории:

1. **Google Search Console → свойство `https://godspace.github.io/HARMONIA/`**
   → **Settings → Ownership verification → HTML tag → Verify**.
2. **Indexing → Sitemaps** → отправить
   `https://godspace.github.io/HARMONIA/sitemap.xml`.
3. **URL Inspection** → проверить `https://godspace.github.io/HARMONIA/`
   → **Request indexing**.
4. **URL Inspection** → `https://godspace.github.io/HARMONIA/en/` →
   **Test live URL**, затем **Request indexing**: новая страница попадает
   в очередь только после ручного запроса, `hreflang`-кластер Google
   склеивает уже после индексации обеих версий.
5. Через 1–7 дней проверить **Indexing → Pages** и статус sitemap
   (для обеих страниц), поиск `site:godspace.github.io/HARMONIA/`.

Если HTML-тег не подтверждается:

- открыть исходный код живой страницы и убедиться, что метатег есть в `<head>`;
- в URL Inspection запустить **Test live URL**;
- проверить, что GitHub Pages задеплоил последний коммит;
- не удалять метатег и не менять его значение.

### Яндекс.Вебмастер

- Яндекс работает с хостом, а не с путём: `https://godspace.github.io` и
  `https://godspace.github.io/HARMONIA/` для него один сайт.
- Sitemap добавлять в существующем хосте `https://godspace.github.io`:
  **Индексирование → Файлы Sitemap** →
  `https://godspace.github.io/HARMONIA/sitemap.xml`.
- Затем **Индексирование → Переобход страниц** для главной.
- Счётчик Яндекс.Метрики: `114504272`.

### Важно про `robots.txt`

`robots.txt` в этом репозитории не управляет корнем `godspace.github.io`.
Для хоста поисковики читают `https://godspace.github.io/robots.txt` из
отдельного репозитория `godspace.github.io`. Чтобы HARMONIA находилась
автоматически, там нужна строка:

```text
Sitemap: https://godspace.github.io/HARMONIA/sitemap.xml
```

## 3. Карта проекта

```text
index.html            разметка, SEO/Open Graph/JSON-LD, Google-метатег
en/index.html         англоязычная страница: статичный текст, без скриптов
ru/index.html         русский обзор проекта (/ru/): статичный текст, без скриптов
css/                  base, stage, overlays, panel, landing (en/ и ru/)
js/                   приложение: harmony, audio, groove, scene, viz, game, midi, render, i18n, translate, research, main
data/COMBOLIST.csv    единственный источник правды для 24 комбо
tools/combolist.py    генератор js/data.js и проверка --check
tools/research.py     разбор выгрузки оценок: --md, --csv, --min-n, --self-test
tools/_smoke_build.ps1 smoke-тест: игра + en/smoke.html + ru/smoke.html
docs/ARCHITECTURE.md  карта модулей и потоков данных
docs/screenshot.png   скриншот для README и Open Graph русских страниц
docs/screenshot-en.png английский скриншот: `en/index.html`, его og:image,
                       twitter:image и JSON-LD
sitemap.xml           карта сайта: главная + en/ (xhtml:link) + ru/
robots.txt            правила для пути HARMONIA
.nojekyll             отключает Jekyll на GitHub Pages
```

## 4. Команды

```powershell
# локальный запуск
python -m http.server 8080
# открыть http://localhost:8080/

# проверка данных COMBOLIST
python tools/combolist.py --check

# проверка расчёта исследования и разбор выгрузки
python tools/research.py --self-test
python tools/research.py --md report.md --csv rows.csv   # найдёт выгрузки сам

# smoke-тест: создаёт smoke.html, en/smoke.html и ru/smoke.html
powershell -ExecutionPolicy Bypass -File tools/_smoke_build.ps1

# состояние git
git status --short --branch

# публикация
git add <files>
git commit -m "<message>"
git push origin main
```

`smoke.html` и временные `_*.txt` уже в `.gitignore`; коммитить их не нужно.

`tools/_smoke_build.ps1` хранится в UTF-8 **с BOM**. Без BOM PowerShell 5.1
читает скрипт как cp1251, кириллица внутри шагов попадает в `smoke.html`
кракозябрами, и точное сравнение русской подписи (`#vGrooveBpm`) падает без
видимой причины. Сохранять файл с BOM.

## 5. Правила проекта

- Не удалять и не менять `google-site-verification`, canonical, `robots`,
  Open Graph и JSON-LD без явной просьбы.
- Канонический URL — строго `https://godspace.github.io/HARMONIA/`.
- Не переводить `js/*.js` на ES-модули: classic `<script>` нужен для работы
  через `file://`.
- `data/COMBOLIST.csv` — единственный источник правды. После правки запускать
  `python tools/combolist.py`, затем `--check`.
- При изменении `sitemap.xml` обновлять `lastmod`.
- При замене `docs/screenshot.png` обновить `og:image`, `twitter:image` и
  JSON-LD-изображение в `index.html`.
- Не добавлять сборку, npm-зависимости или фреймворки без согласования.
- Локальные запуски (`file://`, `localhost`, `127.0.0.1`) не должны отправлять
  статистику Яндекс.Метрики.

## 6. Как начать новый таск

1. В VS Code: **File → Open Folder →**
   `C:\Users\godspace\Desktop\PROJECTS\HARMONIA`.
2. Если окно ещё показывает RITHM — перезагрузить окно или открыть HARMONIA
   в новом окне.
3. В Cline нажать **`+`** и создать новый таск.
4. Первым действием попросить Cline выполнить `Get-Location`; путь должен
   заканчиваться на `HARMONIA`. Если виден `RITHM` — таск всё ещё старый,
   закрыть его и создать новый из окна HARMONIA.

Первый промпт для нового таска:

```text
Прочитай docs/CLINE_HANDOFF.md, README.md и docs/ARCHITECTURE.md.
Проверь git status --short --branch и Get-Location.
Работаем в HARMONIA; папка RITHM удалена.
Сначала кратко подтверди состояние проекта и следующие шаги по Search Console,
без изменений кода до согласования.
```

## 7. Критерии готовности следующего таска

- `Get-Location` показывает HARMONIA.
- `git status --short --branch` — чисто, ветка `main` синхронизирована с
  `origin/main`.
- `python tools/combolist.py --check` завершается с кодом 0.
- Smoke-тест выдаёт `ok: true` и находит точный Google-метатег: основная страница
  — 50 шагов, `en/smoke.html` — 8, `ru/smoke.html` — 7.
- `python tools/research.py --self-test` завершается с кодом 0.
- `https://godspace.github.io/HARMONIA/sitemap.xml` отвечает HTTP 200.
- Папка RITHM отсутствует и не используется.

