# HARMONIA — handoff для нового таска Cline

**Обновлено:** 2026-11-23  
**Рабочая папка:** `C:\Users\godspace\Desktop\PROJECTS\HARMONIA`  
**Репозиторий:** <https://github.com/godspace/HARMONIA>  
**Ветка:** `main`  
**Базовый коммит (до добавления handoff):** `3c4d577 Add Google Search Console verification`  
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
  `social`, `json-ld`, `content`, `no-scripts`, `console-errors`.
- **Русский обзор проекта — `ru/index.html`** (`/ru/`): та же история, что на
  английской странице, но в исходном языке. Свой `canonical`, Open Graph и
  JSON-LD (`WebApplication` + `FAQPage`), в `sitemap.xml` — отдельная запись без
  `xhtml:link` (кластер `ru → /` уже занят канонической страницей). Вход —
  «О проекте» в панели настроек (`#aboutLink`, блок «Сессия») и подвал
  `en/index.html`. Smoke: `ru/smoke.html`, шаги `lang`, `head`, `links`,
  `content`, `json-ld`, `no-scripts`, `console-errors`.
- Блок счёта на сцене называет комбо музыкально: под числом стоит `#comboKey`
  (`До мажор` / `C major`). Подсказка о пробеле живёт не здесь, а в полосе
  маршрута `#comboStrip` (`Space · ещё N` → `Space → новое комбо`). Полоса стоит
  в верхней середине сцены между счётом и «Домой»: две строки по двенадцать
  ячеек в порядке круга, ячейка светлеет при входе в комбо (`seen`), зеленеет
  после сыгранного цикла (`done`), текущая мигает золотом (`current`). На рубеже
  300 и на +150/+300 сверх него полоса дважды подсвечивается (`nudgeSpace`),
  кнопка Space подпрыгивает; модальных окон и тостов нет. Круг тональностей
  повторяет имя комбо в центре (`№1 · До мажор · 0/12`).
- Нотация подписей — `P.notation` (`sol` | `letters`), переключатель
  **Звук → Нотация**. Язык выбирает её сам: латиница — `C-D-E` / `C major`,
  русский и украинский — `до-ре-ми`. Строка `#comboKey` помечена
  `notranslate` и входит в `SHIELD`, чтобы Google не превращал «До мажор» в
  «Before major». Smoke-шаги `space-hint`, `combo-strip` и `notation` держат это
  поведение.

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
js/                   приложение: harmony, audio, scene, viz, game, midi, render, i18n, translate, main
data/COMBOLIST.csv    единственный источник правды для 24 комбо
tools/combolist.py    генератор js/data.js и проверка --check
tools/_smoke_build.ps1 smoke-тест: игра + en/smoke.html + ru/smoke.html
docs/ARCHITECTURE.md  карта модулей и потоков данных
docs/screenshot.png   скриншот для README и og:image
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
- Smoke-тест выдаёт `ok: true` и находит точный Google-метатег.
- `https://godspace.github.io/HARMONIA/sitemap.xml` отвечает HTTP 200.
- Папка RITHM отсутствует и не используется.

