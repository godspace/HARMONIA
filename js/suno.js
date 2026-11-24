/* HARMONIA · js/suno.js — мостик к Suno без API
   Модуль без сборки: подключается <script> после audio-export.js и до research.js.
   Все модули делят глобальную область — имена функций/констант уникальны.

   Зачем два клика. Suno не принимает MIDI и не даёт документированного адреса
   с готовым промптом. Кросс-доменные ограничения не позволяют заполнить его
   форму со страницы HARMONIA, а официальный API требует аккаунт и сервер.
   Поэтому HARMONIA делает честную подготовку: первый клик собирает WAV тем же
   экспортом, что и **⬇ Аудио**, и копирует английский промпт; второй клик
   открывает suno.com/create. Пользователь сам загружает файл и вставляет текст.

   WAV рендерится в реальном времени через ScriptProcessorNode, поэтому окно
   Suno открывается только вторым кликом: отложенный window.open браузеры
   блокируют как всплывающее. Промпт — только английский: Suno лучше понимает
   его, а кириллица в промпте не нужна. */

const SUNO_CREATE_URL = 'https://suno.com/create';
const SUNO_CYRILLIC = /[\u0400-\u04FF]/;
// Тембр станции (rec.station.touch) — короткие английские слова, а не подписи
// интерфейса. Ноты и характер станции не меняются: это только описание звука.
const SUNO_TOUCH_WORDS = {
  bell: 'warm bell-like piano',
  glass: 'bright glassy piano',
  felt: 'soft felt piano',
  pluck: 'dry plucked piano'
};

// id записи, для которой WAV уже сохранён и промпт лежит в буфере обмена.
let sunoReady = null;

// Тональность записи в латинской нотации. Снимок combo есть у новых записей;
// у старых его может не быть — тогда пробуем COMBOS по id, затем аккорды.
function sunoKeyName(rec) {
  const c = rec && rec.combo;
  if (!c) return 'C major';
  let key = c.keyNameLatin;
  if (!key && c.id != null && typeof COMBOS !== 'undefined' && COMBOS[c.id]) {
    key = COMBOS[c.id].keyNameLatin;
  }
  if ((!key || SUNO_CYRILLIC.test(key)) &&
      Array.isArray(c.chords) && Array.isArray(c.chords[0]) &&
      c.chords[0].length && typeof letterNoteName === 'function') {
    key = letterNoteName(c.chords[0][0]) + (c.mode === 'minor' ? ' minor' : ' major');
  }
  key = String(key || '').trim();
  return (!key || SUNO_CYRILLIC.test(key)) ? 'C major' : key;
}
function sunoBpm(rec) {
  const raw = rec && (rec.bpm || (rec.form && rec.form.bpm));
  const bpm = Number(raw || (typeof P !== 'undefined' ? P.formBpm : 0)) || 84;
  return Math.round(typeof clamp === 'function' ? clamp(bpm, 40, 200) : bpm);
}
function sunoMeter(rec) {
  const raw = rec && ((rec.form && rec.form.beatsPerBar) || rec.beatsPerBar);
  const beats = Number(raw || (typeof P !== 'undefined' ? P.formMeter : 0)) === 3 ? 3 : 4;
  return beats + '/4';
}
function sunoTimbre(rec) {
  const touch = rec && rec.station && rec.station.touch;
  return SUNO_TOUCH_WORDS[touch] || 'warm piano';
}
function sunoDrums(rec) {
  return rec && Array.isArray(rec.drums) && rec.drums.length
    ? 'soft brushed drums' : 'no drums';
}
// Чистая функция для теста и буфера обмена: только английский текст, без
// undefined у записей старого формата. Шаблон повторяет то, что уже звучит:
// инструментал, мелодия из WAV, тональность, темп, размер, тембр и барабаны.
function sunoPrompt(rec) {
  if (!rec) return '';
  return 'Instrumental, no vocals. Build around the uploaded piano melody. ' +
    sunoKeyName(rec) + ', ' + sunoBpm(rec) + ' BPM, ' + sunoMeter(rec) + '. ' +
    sunoTimbre(rec) + ', ' + sunoDrums(rec) +
    '. Calm, minimal harmony study; clean mix.';
}
// Синхронное копирование из жеста пользователя: работает на file:// и в
// браузерах без navigator.clipboard. Тот же приём, что у подписи видео.
function sunoCopyText(text) {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand && document.execCommand('copy');
    area.remove();
    return !!ok;
  } catch (e) {
    return false;
  }
}
function sunoCopyAsync(text) {
  if (typeof navigator === 'undefined' || !navigator.clipboard ||
      typeof navigator.clipboard.writeText !== 'function') {
    return Promise.resolve(false);
  }
  try {
    return navigator.clipboard.writeText(text).then(() => true, () => false);
  } catch (e) {
    return Promise.resolve(false);
  }
}
function sunoButtonState(rec) {
  const available = !!rec && Array.isArray(rec.events) && rec.events.length > 0;
  const supported = typeof audioSupported === 'function' ? audioSupported() : false;
  const busy = (typeof exportBusy === 'function' && exportBusy()) ||
    !!state.recording || !!state.recordingCountIn || !!state.playingRecording;
  const status = typeof audioExportStatus === 'function' ? audioExportStatus() : null;
  const exporting = !!status && status.purpose === 'suno' &&
    !!rec && status.id === rec.id;
  const ready = available && !!sunoReady && sunoReady.id === rec.id;
  return { available, supported, busy, exporting, ready, status };
}
function paintSunoButton(btn, rec, card) {
  if (!btn) return;
  const s = sunoButtonState(rec);
  btn.disabled = !s.available || !s.supported || s.busy;
  btn.classList.toggle('suno-ready', s.ready && !s.busy);
  btn.classList.toggle('suno-busy', s.exporting);
  if (s.exporting && s.status) {
    btn.textContent = '🎧 WAV для Suno · ' + recDurationLabel(s.status.elapsed) +
      ' / ' + recDurationLabel(s.status.duration);
  } else if (s.ready) {
    btn.textContent = '↗ Suno';
  } else {
    btn.textContent = '🎛 Suno';
  }
  if (!s.available) {
    btn.title = card
      ? 'Запись этого комбо не сохранилась — включите автозапись станции.'
      : 'Сначала выберите запись с нотами.';
  } else if (!s.supported) {
    btn.title = 'Браузер не поддерживает запись аудио.';
  } else if (s.busy) {
    btn.title = 'Дождитесь окончания записи или экспорта.';
  } else if (s.ready) {
    btn.title = 'Открыть Suno и скопировать промпт заново';
  } else {
    btn.title = 'Подготовить WAV и английский промпт для Suno';
  }
}
// Панель и карточка оценки делят одно состояние: WAV и промпт привязаны к id
// записи, поэтому выбор другой записи просто возвращает кнопку к «🎛 Suno».
function sunoPaint() {
  const panelRec = typeof selectedRecording === 'function' ? selectedRecording() : null;
  const askRec = (typeof Research !== 'undefined' && Research &&
    typeof Research.askRecording === 'function') ? Research.askRecording() : null;
  paintSunoButton($('recSuno'), panelRec, false);
  paintSunoButton($('researchAskSuno'), askRec, true);
}
function sunoState() {
  return {
    ready: !!sunoReady,
    id: sunoReady ? sunoReady.id : '',
    prompt: sunoReady ? sunoReady.prompt : ''
  };
}
// Второй клик: копируем промпт и сразу открываем Suno. window.open стоит в том
// же жесте, что и копирование, иначе браузер сочтёт окно всплывающим.
function sunoOpen(rec) {
  if (!rec) {
    toast('Сначала выберите запись с нотами.');
    return '';
  }
  const prompt = (sunoReady && sunoReady.id === rec.id)
    ? sunoReady.prompt : sunoPrompt(rec);
  if (!prompt) return '';
  const copied = sunoCopyText(prompt);
  let win = null;
  try { win = window.open(SUNO_CREATE_URL, '_blank'); } catch (e) { win = null; }
  if (win) {
    try { win.opener = null; } catch (e) { /* окно уже закрыто */ }
  }
  if (!win) {
    toast('Suno не открылся — браузер заблокировал окно. Откройте suno.com/create вручную.');
    return prompt;
  }
  if (copied) {
    toast('Промпт скопирован · загрузите WAV и вставьте его в Suno', 'good');
  } else {
    sunoCopyAsync(prompt).then(ok => {
      toast(ok ? 'Промпт скопирован · загрузите WAV и вставьте его в Suno'
        : 'Не удалось скопировать промпт', ok ? 'good' : undefined);
    });
  }
  return prompt;
}
// Первый клик: копируем промпт и запускаем обычный WAV-экспорт с пометкой
// purpose: 'suno'. Файл и его имя не меняются — меняется только подпись
// прогресса и то, что после сохранения кнопка становится «↗ Suno».
function sunoStart(target) {
  const rec = target ||
    (typeof selectedRecording === 'function' ? selectedRecording() : null);
  if (!rec || !Array.isArray(rec.events) || !rec.events.length) {
    toast('В записи нет нот');
    return '';
  }
  if ((typeof exportBusy === 'function' && exportBusy()) ||
      state.recording || state.recordingCountIn || state.playingRecording) {
    toast('Дождитесь окончания записи или экспорта.');
    return '';
  }
  if (typeof startAudioExport !== 'function' ||
      (typeof audioSupported === 'function' && !audioSupported())) {
    toast('Аудио не поддерживается браузером');
    return '';
  }
  const prompt = sunoPrompt(rec);
  sunoReady = null;
  sunoCopyText(prompt);
  startAudioExport(rec, {
    purpose: 'suno',
    onDone: function (info) {
      if (info && info.name) {
        sunoReady = { id: rec.id, prompt: prompt };
        toast('WAV для Suno готов — нажмите «↗ Suno»', 'good');
      } else if (info && !info.canceled) {
        toast('Не удалось подготовить WAV для Suno');
      }
      if (typeof paintRecorder === 'function') paintRecorder();
      else sunoPaint();
    }
  });
  sunoPaint();
  return prompt;
}
function initSuno() {
  const btn = $('recSuno');
  if (btn) {
    btn.addEventListener('click', () => {
      const rec = typeof selectedRecording === 'function' ? selectedRecording() : null;
      if (!rec) {
        toast('Сначала выберите запись с нотами.');
        return;
      }
      if (sunoReady && sunoReady.id === rec.id) sunoOpen(rec);
      else sunoStart(rec);
    });
  }
  sunoPaint();
}
initSuno();
