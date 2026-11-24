/* HARMONIA · js/recorder.js — запись, выбор, удаление и прослушивание мелодий
   Модуль без сборки: подключается <script> в index.html после ui-hud.js.
   Запись хранит не семплы, а события игры (аккорд/нота + момент времени), поэтому
   занимает мало места и воспроизводится тем же синтезатором. Все модули делят
   глобальную область — имена функций/констант уникальны. */

const REC_KEY = 'rithm.recordings.v1';
const REC_MAX_ITEMS = 30;
const REC_MAX_EVENTS = 6000;
const REC_MAX_MS = 180000;
let recordings = [];
let recEvents = [];
// Барабаны — отдельная дорожка: удар не мелодическое событие, и MIDI по-прежнему
// собирается только из rec.events. Пустой массив drums — метка формата: у старых
// записей поля нет, и видео честно предупреждает, что ударных в ней не было.
let recDrums = [];
let recStartedAt = 0;
let recTicker = null;
let recFormMeta = null;
// Снимок станции и темпа на момент старта ручной записи. Если игрок сменит
// комбо во время игры, запись всё равно будет подписана тем, с чего началась.
let recSessionMeta = null;
let recCountInTimers = [];
let recCountInToken = 0;
let playbackTimers = [];
let playbackEndTimer = null;
let playbackToken = 0;
let selectedRecId = null;
// Автозапись станции живёт рядом с ручной, а не вместо неё: гость может нажать
// «● Запись» в любой момент, а фоновая запись всё равно соберёт посещение.
// autoRec.active снимается при смене комбо/паузе, чтобы пустые визиты не
// попадали в список.
let autoRec = null;

// Снимок станции попадает в запись: через месяц по имени «Станция 3 · войлок»
// видно, где она сделана, даже если STATION_STYLES успели поменять.
function autoRecordSnapshot() {
  const c = combo();
  const st = stationStyleFor(state.comboIdx);
  const plot = typeof stationPlotArchetype === 'function' ? stationPlotArchetype() : null;
  const gesture = typeof stationGesture === 'function' ? stationGesture(st) : null;
  return {
    combo: {
      id: c.id, mode: c.mode, keyName: c.keyName,
      keyNameLatin: c.keyNameLatin, root: c.root,
      // Тоническое трезвучие — заголовок ролика и подписи. Копия нужна,
      // чтобы старые записи читались даже после правки COMBOLIST.
      chords: (c.chords || []).map(ch => ch.slice())
    },
    station: {
      id: st.id, label: st.label, voicing: st.voicing,
      bass: st.bass, register: st.register, touch: st.touch
    },
    plot: plot ? { id: plot.id, label: plot.label } : null,
    gesture: gesture ? { id: gesture.id, label: gesture.label, delays: gesture.delays.slice() } : null
  };
}
function autoRecordingName(a) {
  // Только номер и характер: название тональности меняется вместе с нотацией,
  // а имя записи должно читаться в обоих языках. Номер комбо различает мажор
  // и минор одной пары (1…12 и 13…24).
  return 'Станция ' + a.combo.id + ' · ' + a.station.label;
}
// ===== Общие подписи и имена файлов =====
// MIDI, видео и WAV — три формата одной записи. Имя у них одно: тоническое
// трезвучие комбо («Ля-До-Ми.mid» / «A-C-E.wav»), а не служебное имя авто-
// записи «Станция 13 · эталон». Старые записи без снимка аккордов получают
// прежнее имя (rec.name), поэтому экспорт не ломается.
function recordingTonic(rec) {
  const c = rec && rec.combo;
  if (!c) return '';
  let names = null;
  if (Array.isArray(c.chords) && Array.isArray(c.chords[0])) names = c.chords[0];
  else if (Array.isArray(c.tonicChord)) names = c.tonicChord;
  else if (c.id != null && typeof COMBOS !== 'undefined' && COMBOS[c.id] &&
           Array.isArray(COMBOS[c.id].chords)) names = COMBOS[c.id].chords[0];
  if (names && names.length) {
    return typeof chordLabel === 'function' ? chordLabel(names) : names.join('-');
  }
  const key = (typeof usingLetterNames === 'function' && usingLetterNames())
    ? (c.keyNameLatin || c.keyName) : c.keyName;
  return recordingText(String(key || ''));
}
function recordingText(value) {
  const s = String(value == null ? '' : value);
  return (typeof I18N !== 'undefined' && typeof I18N.enabled === 'function' &&
    I18N.enabled() && typeof I18N.text === 'function') ? I18N.text(s) : s;
}
function recordingTitle(rec) {
  return recordingTonic(rec) || recordingText(rec && rec.name || 'HARMONIA');
}
function recordingFileName(rec, ext) {
  const base = String(recordingTitle(rec) || 'harmonia')
    .replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'harmonia';
  const suffix = String(ext || 'bin').replace(/^\.+/, '').replace(/[^a-z0-9]+/gi, '') || 'bin';
  return base + '.' + suffix.toLowerCase();
}
function autoRecordStart() {
  if (!P.autoRecord || state.replay || !state.started || !state.running || state.paused) return null;
  if (autoRec && autoRec.active) {
    if (typeof Research !== 'undefined' &&
        typeof Research.linkRecording === 'function') {
      Research.linkRecording(autoRec.id);
    }
    return autoRec;
  }
  const meta = autoRecordSnapshot();
  const created = Date.now();
  autoRec = {
    active: true,
    // id выдаётся в начале визита, а не при сохранении: карточка оценки
    // открывается уже после finalize, и ей нужен точный адрес этой записи.
    id: 'auto-' + created + '-' + Math.random().toString(36).slice(2, 6),
    events: [],
    drums: [],
    startedAt: performance.now(),
    created,
    combo: meta.combo,
    station: meta.station,
    plot: meta.plot,
    gesture: meta.gesture,
    bpm: recordingBpm(),
    beatsPerBar: recordingBeatsPerBar(),
    form: state.form && state.form.enabled ? {
      bpm: state.transport.bpm || P.formBpm,
      beatsPerBar: Number(state.transport.beatsPerBar) === 3 ? 3 : 4,
      bars: typeof Composition !== 'undefined' ? Composition.totalBars() : CFG.composition.bars
    } : null
  };
  paintRecorder();
  // Текущий визит исследования получает id этой дорожки. Так карточка оценки
  // умеет отдать в видео именно сыгранное комбо, а не выбранную запись панели.
  if (typeof Research !== 'undefined' &&
      typeof Research.linkRecording === 'function') {
    Research.linkRecording(autoRec.id);
  }
  return autoRec;
}
// save=false — отмена (например, «Сессия заново»): недописанное посещение не
// нужно. Пустое посещение не сохраняется: в списке остаются только реальные
// фразы, а не каждая пройденная станция.
function autoRecordFinalize(save) {
  const a = autoRec;
  autoRec = null;
  if (!a || !a.active) { paintRecorder(); return null; }
  a.active = false;
  const events = a.events;
  const drums = Array.isArray(a.drums) ? a.drums : [];
  // Пустой визит определяется мелодией: одни удары без нот интересны как ритм,
  // но запись станции — это сыгранная фраза, а не метроном.
  if (save === false || !events.length) { paintRecorder(); return null; }
  const created = a.created;
  const duration = Math.max(0, performance.now() - a.startedAt);
  const rec = {
    id: a.id || ('auto-' + created + '-' + Math.random().toString(36).slice(2, 6)),
    name: autoRecordingName(a),
    created,
    duration,
    events,
    drums,
    auto: true,
    combo: a.combo,
    station: a.station,
    plot: a.plot,
    gesture: a.gesture
  };
  if (a.form) rec.form = a.form;
  recordings.unshift(rec);
  recordings = recordings.slice(0, REC_MAX_ITEMS);
  // Не отбираем выбор у ручной записи: автосохранение — фон, а не действие
  // игрока. Если же ничего не выбрано, показываем новую станцию.
  if (!recordings.some(r => r.id === selectedRecId)) selectedRecId = rec.id;
  saveRecordings();
  paintRecorder();
  return rec;
}
// Ручное A/B и панель: включение начинает запись сразу, выключение сохраняет
// уже сыгранное и больше не пишет.
function setAutoRecord(on) {
  P.autoRecord = !!on;
  if (P.autoRecord) autoRecordStart();
  else autoRecordFinalize();
  paintRecorder();
  toast(P.autoRecord ? 'Автозапись станции: вкл' : 'Автозапись станции: выкл');
  return P.autoRecord;
}
function autoRecordStatus() {
  if (!autoRec || !autoRec.active) return null;
  return {
    active: true,
    id: autoRec.id,
    combo: autoRec.combo,
    station: autoRec.station,
    plot: autoRec.plot,
    events: autoRec.events.length,
    drums: Array.isArray(autoRec.drums) ? autoRec.drums.length : 0
  };
}

function recDurationLabel(ms) {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}
function recCreatedLabel(created) {
  try {
    return new Date(created).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  } catch (e) {
    return 'запись';
  }
}
function loadRecordings() {
  try {
    const raw = JSON.parse(localStorage.getItem(REC_KEY) || '[]');
    recordings = Array.isArray(raw) ? raw.filter(r =>
      r && typeof r.id === 'string' && Array.isArray(r.events)).slice(0, REC_MAX_ITEMS) : [];
  } catch (e) {
    recordings = [];
  }
  recordings.sort((a, b) => (b.created || 0) - (a.created || 0));
}
function saveRecordings() {
  const write = () => localStorage.setItem(REC_KEY, JSON.stringify(recordings));
  try {
    write();
  } catch (e) {
    // Хранилище может быть переполнено: старые записи уступают новым.
    recordings = recordings.slice(0, Math.max(1, recordings.length - 5));
    try { write(); } catch (ignore) { /* приватный режим */ }
  }
}
function selectedRecording() {
  return recordings.find(r => r.id === selectedRecId) || null;
}
// Оценка комбо хранит id авто-записи, поэтому карточке нужен доступ к записи
// по id, а не к той, что выбрана в панели. Неизвестный id — null.
function recordingById(id) {
  const key = String(id || '');
  return key ? (recordings.find(r => r.id === key) || null) : null;
}
function recordDrumCount(rec) {
  return rec && Array.isArray(rec.drums) ? rec.drums.length : 0;
}
function recordDrumSuffix(rec) {
  const n = recordDrumCount(rec);
  return n ? ' · ' + n + ' уд.' : '';
}
function recordOptionText(rec) {
  const form = rec.form ? ' · пьеса ' + rec.form.bpm + ' BPM' : '';
  return rec.name + ' · ' + recDurationLabel(rec.duration) +
    ' · ' + rec.events.length + ' соб.' + recordDrumSuffix(rec) + form;
}
function paintRecorder() {
  const btn = $('recBtn'), play = $('playBtn'), del = $('recDel');
  const list = $('recList'), status = $('recStatus');
  const midi = $('recMidi'), video = $('recVideo'), audio = $('recAudio');
  const caption = $('recCaption'), autoBtn = $('recAuto');
  const suno = $('recSuno');
  if (!btn || !play || !del || !list || !status) return;
  if (!recordings.some(r => r.id === selectedRecId)) {
    selectedRecId = recordings.length ? recordings[0].id : null;
  }
  list.textContent = '';
  if (!recordings.length) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '— нет записей —';
    list.appendChild(empty);
  } else {
    recordings.forEach(rec => {
      const opt = document.createElement('option');
      opt.value = rec.id;
      opt.textContent = recordOptionText(rec);
      list.appendChild(opt);
    });
    list.value = selectedRecId || '';
  }
  const countIn = !!state.recordingCountIn;
  const videoBusy = !!state.videoExport;
  const audioBusy = !!state.audioExport;
  const busy = !!state.recording || countIn || videoBusy || audioBusy;
  btn.textContent = countIn ? '✕ Отмена' : state.recording ? '■ Стоп' : '● Запись';
  btn.setAttribute('aria-pressed', String(busy));
  btn.classList.toggle('live', busy);
  play.textContent = state.playingRecording ? '■ Стоп' : '▶ Прослушать';
  const hasSelected = !!selectedRecording();
  play.disabled = busy || (!hasSelected && !state.playingRecording);
  del.disabled = busy || state.playingRecording || !hasSelected;
  list.disabled = busy || state.playingRecording;
  if (midi) midi.disabled = busy || state.playingRecording || !hasSelected;
  if (video) video.disabled = busy || state.playingRecording || !hasSelected;
  if (audio) audio.disabled = busy || state.playingRecording || !hasSelected;
  if (suno) suno.disabled = busy || state.playingRecording || !hasSelected;
  if (caption) caption.disabled = busy || state.playingRecording || !hasSelected;
  if (autoBtn) {
    autoBtn.disabled = videoBusy || audioBusy || !!state.recording || countIn;
    autoBtn.setAttribute('aria-pressed', String(!!P.autoRecord));
    autoBtn.textContent = P.autoRecord ? 'Автозапись станции: вкл' : 'Автозапись станции: выкл';
  }
  status.className = 'rec-status' +
    (countIn ? ' countin' : state.recording ? ' live' : state.playingRecording ? ' playing' : '');
  if (countIn) {
    status.textContent = '⏱ Отсчёт ' + Math.max(1, state.recCountInBeat || 1) + '/' +
      Math.max(1, state.recCountInTotal || 1) + ' · запись начнётся с 1-го такта';
  } else if (state.recording) {
    status.textContent = '● Запись · ' + recDurationLabel(performance.now() - recStartedAt) +
      ' · ' + recEvents.length + ' соб.' + (recDrums.length ? ' · ' + recDrums.length + ' уд.' : '');
  } else if (state.audioExport) {
    const a = typeof audioExportStatus === 'function' ? audioExportStatus() : null;
    const label = a && a.purpose === 'suno' ? '🎧 WAV для Suno' : '🎧 Аудио';
    status.textContent = a
      ? label + ' · ' + recDurationLabel(a.elapsed) + ' / ' + recDurationLabel(a.duration)
      : label + ' · запись…';
  } else if (state.videoExport) {
    const v = typeof videoExportStatus === 'function' ? videoExportStatus() : null;
    status.textContent = v
      ? '🎬 Видео · ' + recDurationLabel(v.elapsed) + ' / ' + recDurationLabel(v.duration)
      : '🎬 Видео · рендер…';
  } else if (state.playingRecording) {
    const rec = selectedRecording();
    status.textContent = '▶ Прослушивание' + (rec ? ' · ' + rec.name : '') +
      (P.recLoop ? ' · повтор' : '') + '…';
  } else if (hasSelected) {
    const rec = selectedRecording();
    const form = rec.form ? ' · пьеса ' + rec.form.bpm + ' BPM' : '';
    status.textContent = 'Выбрано: ' + rec.name + ' · ' + recDurationLabel(rec.duration) +
      ' · ' + rec.events.length + ' соб.' + recordDrumSuffix(rec) + form;
  } else {
    status.textContent = 'Нажмите «Запись», чтобы сохранить мелодию.';
  }
  // Кнопка Suno живёт в js/suno.js и знает про готовый WAV; панель только
  // просит её перерисоваться после смены записи или экспорта.
  if (typeof sunoPaint === 'function') sunoPaint();
}
function recordingBeatsPerBar() {
  if (Number(state.transport.beatsPerBar) === 3) return 3;
  return Number(P.formMeter) === 3 ? 3 : 4;
}
function recordingBpm() {
  // Если идёт пьеса, отсчёт идёт в её темпе; в свободном джеме — в темпе панели
  // «Форма», чтобы запись можно было начать без включения самой пьесы.
  const live = state.transport && state.transport.running;
  return clamp(Number(live ? state.transport.bpm : P.formBpm) || 84, 40, 200);
}
// Снять таймеры отсчёта и вернуть поля состояния в «не занято». Токен нужен,
// чтобы уже поставленные setTimeout не начали запись после отмены.
function clearRecordCountIn() {
  recCountInToken += 1;
  recCountInTimers.forEach(id => clearTimeout(id));
  recCountInTimers = [];
  state.recordingCountIn = false;
  state.recCountInBeat = 0;
  state.recCountInTotal = 0;
  if (recTicker) { clearInterval(recTicker); recTicker = null; }
}
function beginRecordingNow() {
  clearRecordCountIn();
  state.recording = true;
  recStartedAt = performance.now();
  recEvents = [];
  recDrums = [];
  if (recTicker) clearInterval(recTicker);
  recTicker = setInterval(paintRecorder, 250);
  paintRecorder();
  toast('● Запись начата — играйте мелодию');
}
// Отсчёт — не часть записи: state.recording остаётся false, поэтому recordNote()
// и recordChord() во время тиков молчат. Запись стартует ровно на следующей
// сильной доле после последнего клика.
function startRecordCountIn(bars) {
  const bpb = recordingBeatsPerBar();
  const total = Math.max(1, bars * bpb);
  const spb = 60000 / recordingBpm();
  const token = ++recCountInToken;
  state.recordingCountIn = true;
  state.recCountInBeat = 0;
  state.recCountInTotal = total;
  if (recTicker) clearInterval(recTicker);
  recTicker = setInterval(paintRecorder, 250);
  initAudio();
  for (let i = 0; i < total; i++) {
    recCountInTimers.push(setTimeout(() => {
      if (token !== recCountInToken || !state.recordingCountIn) return;
      state.recCountInBeat = i + 1;
      metronomeClick(null, i % bpb === 0);
      paintRecorder();
    }, i * spb));
  }
  recCountInTimers.push(setTimeout(() => {
    if (token !== recCountInToken || !state.recordingCountIn) return;
    beginRecordingNow();
  }, total * spb));
  paintRecorder();
  toast('⏱ Отсчёт · ' + bars + (bars === 1 ? ' такт' : ' такта') + ' до записи');
}
function startRecording() {
  if (state.recording || state.recordingCountIn || exportBusy()) return;
  if (!state.started) { initAudio(); beginFromOverlay(); }
  if (state.paused) setPaused(false);
  stopPlayback();
  recEvents = [];
  recDrums = [];
  const snapshot = autoRecordSnapshot();
  recSessionMeta = {
    combo: snapshot.combo,
    station: snapshot.station,
    plot: snapshot.plot,
    gesture: snapshot.gesture,
    bpm: recordingBpm(),
    beatsPerBar: recordingBeatsPerBar()
  };
  recFormMeta = state.form && state.form.enabled ? {
    bpm: state.transport.bpm || P.formBpm,
    beatsPerBar: Number(state.transport.beatsPerBar) === 3 ? 3 : 4,
    bars: typeof Composition !== 'undefined' ? Composition.totalBars() : CFG.composition.bars,
    points: state.form.points
  } : null;
  const bars = Math.max(0, Math.min(2, Math.round(Number(P.recCountIn) || 0)));
  if (bars > 0) startRecordCountIn(bars);
  else beginRecordingNow();
}
// save=false — отмена (например, «Сессия заново»): недописанный фрагмент не нужен.
function stopRecording(save) {
  if (state.recordingCountIn) {
    clearRecordCountIn();
    recFormMeta = null;
    recSessionMeta = null;
    paintRecorder();
    if (save !== false) toast('Отсчёт отменён');
    return;
  }
  if (!state.recording) return;
  state.recording = false;
  if (recTicker) { clearInterval(recTicker); recTicker = null; }
  const duration = Math.max(0, performance.now() - recStartedAt);
  const events = recEvents;
  const drums = recDrums;
  const sessionMeta = recSessionMeta;
  recEvents = [];
  recDrums = [];
  if (save !== false && events.length) {
    const created = Date.now();
    const rec = {
      id: 'rec-' + created + '-' + Math.random().toString(36).slice(2, 6),
      name: 'Запись ' + recCreatedLabel(created),
      created, duration, events, drums
    };
    // Снимок нужен видео: тональность и темп попали в кадр, даже если после
    // записи игрок успел сменить комбо. Старые записи просто не имеют полей.
    if (sessionMeta) {
      rec.combo = sessionMeta.combo;
      rec.station = sessionMeta.station;
      rec.plot = sessionMeta.plot;
      rec.gesture = sessionMeta.gesture;
      rec.bpm = sessionMeta.bpm;
      rec.beatsPerBar = sessionMeta.beatsPerBar;
    }
    if (recFormMeta) rec.form = recFormMeta;
    recordings.unshift(rec);
    recordings = recordings.slice(0, REC_MAX_ITEMS);
    selectedRecId = rec.id;
    saveRecordings();
    toast('Запись сохранена · ' + recDurationLabel(duration), 'good');
  } else if (save === false) {
    toast('Запись отменена');
  } else {
    toast('Запись пустая — сыграйте хотя бы одну ноту');
  }
  recFormMeta = null;
  recSessionMeta = null;
  paintRecorder();
}
function discardRecording() {
  if (state.recordingCountIn) {
    clearRecordCountIn();
    recFormMeta = null;
    recSessionMeta = null;
    paintRecorder();
    return;
  }
  if (state.recording) stopRecording(false);
}
// Один и тот же снимок события пишется в две независимые дорожки: ручную
// (recEvents) и авто-дорожку текущей станции. Время считается от старта каждой,
// поэтому позже начатая ручная запись не сдвигает авто-посещение.
function pushRecordEvent(target, ev, now, startedAt, onLimit) {
  const t = Math.max(0, now - startedAt);
  if (t >= REC_MAX_MS || target.length >= REC_MAX_EVENTS) {
    if (typeof onLimit === 'function') onLimit();
    return false;
  }
  const item = Object.assign({}, ev, { t });
  if (state.form && state.form.running && state.form.bar >= 1) {
    item.form = {
      bar: state.form.bar,
      beat: state.form.beat,
      section: state.form.sectionId || ''
    };
  }
  target.push(item);
  return true;
}
function recordEvent(ev) {
  if (state.replay || !ev) return;
  const now = performance.now();
  if (state.recording) {
    pushRecordEvent(recEvents, ev, now, recStartedAt, () => stopRecording(true));
    if (recEvents.length % 8 === 0) paintRecorder();
  }
  if (autoRec && autoRec.active) {
    pushRecordEvent(autoRec.events, ev, now, autoRec.startedAt, () => autoRecordFinalize());
    if (autoRec && autoRec.events.length % 8 === 0) paintRecorder();
  }
}
function recordChord(h, vel) {
  if (state.replay || !h) return;
  // h — снимок без функций: JSON.stringify сохранит только музыкальные поля.
  const T = rootMidi();
  const offset = h.offset == null ? ((h.rootPc - (T % 12) + 12) % 12) : h.offset;
  // Бас пишется отдельным полем: MIDI-экспорт не должен восстанавливать его
  // по текущим настройкам, если запись сделана на другой станции.
  const station = stationStyleFor(state.comboIdx);
  const bassMidi = T + 12 * (Number(P.bassOct) || 0) +
    (typeof stationBassOffset === 'function' ? stationBassOffset(h, offset, station) : 0);
  recordEvent({
    type: 'chord',
    h: {
      degree: h.degree, hint: h.hint, name: h.name, kind: h.kind,
      tonic: !!h.tonic, rootPc: h.rootPc, pcs: (h.pcs || []).slice(),
      third: h.third, fifth: h.fifth, offset: h.offset, quality: h.quality
    },
    base: T,
    bass: bassMidi,
    vel: vel == null ? 1 : clamp(vel, 0.05, 1)
  });
}
function recordNote(midi, vel, pan, withChord) {
  if (state.replay) return;
  recordEvent({
    type: 'note', midi,
    vel: vel == null ? 0.8 : clamp(vel, 0.05, 1),
    pan: pan == null ? 0 : pan,
    // MIDI-путь не гармонизирует ноты — прослушивание не должно добавлять
    // подложку, которой не было в оригинале.
    withChord: withChord !== false
  });
}
// Удар записывается в момент, когда он реально звучит, а не когда его
// запланировал Groove: у планировщика упреждение 150 мс, и время удара в
// записи должно совпадать со слухом. Поэтому будущий удар ждёт короткий
// setTimeout — к моменту срабатывания запись уже открыта, если её начали.
function recordDrum(kind, vel, atMs) {
  if (state.replay || exportBusy()) return false;
  const now = performance.now();
  const at = Number.isFinite(Number(atMs)) ? Number(atMs) : now;
  const plan = typeof drumPlan === 'function' ? drumPlan(kind, vel) : null;
  const ev = {
    type: 'drum',
    kind: plan ? plan.kind : (kind || 'hat'),
    vel: plan ? plan.vel : clamp(vel == null ? 0.8 : vel, 0.05, 1)
  };
  let wrote = false;
  // Событие, прозвучавшее до старта дорожки, не принадлежит ей. Допуск 20 мс
  // гасит разницу часов performance.now() и таймера.
  if (state.recording && at >= recStartedAt - 20) {
    wrote = pushRecordEvent(recDrums, ev, at, recStartedAt, () => stopRecording(true)) || wrote;
  }
  if (autoRec && autoRec.active && at >= autoRec.startedAt - 20) {
    wrote = pushRecordEvent(autoRec.drums, ev, at, autoRec.startedAt,
      () => autoRecordFinalize()) || wrote;
  }
  if (wrote && state.recording && recDrums.length % 8 === 0) paintRecorder();
  return wrote;
}
function recordDrumAt(kind, vel, atMs) {
  if (state.replay || exportBusy()) return null;
  const now = performance.now();
  const at = Number.isFinite(Number(atMs)) ? Math.max(now, Number(atMs)) : now;
  const delay = at - now;
  // Ближайший удар пишем сразу; будущий — после того, как он прозвучит.
  // Таймер не отменяется при «Стоп»: запись сама проверит, открыта ли дорожка,
  // а авто-дорожка может остаться активной.
  if (delay <= 2) return recordDrum(kind, vel, now);
  const id = setTimeout(() => recordDrum(kind, vel, at), Math.min(1000, delay));
  return id;
}
// Один таймлайн для прослушивания и видео: мелодия и удары сортируются по
// записанному времени. Массив не меняется — копии событий остаются в записи.
function recordingTimeline(rec) {
  const list = [];
  if (rec && Array.isArray(rec.events)) {
    rec.events.forEach(ev => { if (ev) list.push(ev); });
  }
  if (rec && Array.isArray(rec.drums)) {
    rec.drums.forEach(ev => { if (ev) list.push(ev); });
  }
  return list.sort((a, b) =>
    (Number(a.t) || 0) - (Number(b.t) || 0));
}
// Границы того, что игрок реально сыграл. Фоновая дорожка барабанов может
// звучать с момента входа на станцию и после последней ноты, поэтому экспорт
// не должен считать её края началом и концом записи: иначе заминки до первой
// ноты и после неё остаются в видео и WAV. Если мелодии нет (старый формат или
// запись только с MIDI-пэда), границы берутся по общему таймлайну.
function recordingContentSpan(rec) {
  const melody = rec && Array.isArray(rec.events) ? rec.events : [];
  let first = -1;
  let last = 0;
  melody.forEach(ev => {
    if (!ev) return;
    const t = Math.max(0, Number(ev.t) || 0);
    if (first < 0 || t < first) first = t;
    if (t > last) last = t;
  });
  if (first >= 0) return { first, last, melodic: true };
  const timeline = recordingTimeline(rec);
  timeline.forEach(ev => {
    const t = Math.max(0, Number(ev && ev.t) || 0);
    if (first < 0 || t < first) first = t;
    if (t > last) last = t;
  });
  return first < 0
    ? { first: 0, last: 0, melodic: false }
    : { first, last, melodic: false };
}
// Таймлайн для видео и WAV: мелодия задаёт окно, барабаны остаются только
// внутри него. Удар, записанный до первой ноты или после последней, не
// растягивает файл и не превращает бездействие игрока в «музыку».
function recordingExportTimeline(rec) {
  const timeline = recordingTimeline(rec);
  const span = recordingContentSpan(rec);
  const list = span.melodic
    ? timeline.filter(ev => {
        const t = Math.max(0, Number(ev && ev.t) || 0);
        return t >= span.first && t <= span.last;
      })
    : timeline;
  return {
    timeline: list,
    firstEventAt: span.first,
    lastEventAt: span.last
  };
}
function ballForMidi(midi) {
  const pc = ((midi % 12) + 12) % 12;
  let best = null;
  balls.forEach(b => {
    if (b.pc !== pc) return;
    if (!best || Math.abs(b.midi - midi) < Math.abs(best.midi - midi)) best = b;
  });
  return best;
}
function recordedStation(rec) {
  // Авто-запись хранит характер станции: прослушивание возвращает её голос,
  // а не подачу той станции, которая открыта сейчас. Ручная запись остаётся
  // нейтральной, как раньше.
  return rec && rec.auto && rec.station ? rec.station : null;
}
function recordedShape(rec) {
  const station = recordedStation(rec);
  return station && typeof STATION_TOUCH !== 'undefined'
    ? (STATION_TOUCH[station.touch] || null) : null;
}
// Звук события отдельно от картинки: видео планирует звук по часам AudioContext
// с упреждением, а шары и HUD включает в момент события на экране.
function playRecordedAudio(ev, rec, when) {
  if (!ev) return;
  const station = recordedStation(rec);
  const shape = recordedShape(rec);
  if (ev.type === 'drum') {
    if (typeof drumHit === 'function') drumHit(ev.kind, when, ev.vel);
    return;
  }
  if (ev.type === 'chord' && ev.h) {
    // base из записи сохраняет исходную тональность прослушивания.
    playChordAudio(ev.h, ev.vel, ev.base, when, station, shape);
    return;
  }
  if (ev.type !== 'note' || ev.midi == null) return;
  const midi = ev.midi, vel = ev.vel == null ? 0.8 : ev.vel;
  const pan = ev.pan == null ? clamp((midi - 60) / 48, -0.8, 0.8) : ev.pan;
  bell(midi, vel, pan, when, 'note', 0, shape);
  if (ev.withChord !== false) noteChord(midi, vel, pan, when);
}
function playRecordedVisual(ev, rec) {
  if (!ev) return;
  if (ev.type === 'chord' && ev.h) {
    chordEvent(ev.h, ev.vel, 'replay');
    return;
  }
  if (ev.type !== 'note' || ev.midi == null) return;
  const ball = ballForMidi(ev.midi);
  // withAudio=false: звук уже создан выше, шар только показывает ноту.
  if (ball) triggerBall(ball, ev.vel == null ? 0.8 : ev.vel, false);
}
function playRecordedEvent(ev, rec, when) {
  playRecordedAudio(ev, rec, when);
  playRecordedVisual(ev, rec);
}
function finishPlayback(token) {
  if (token !== playbackToken) return;
  state.playingRecording = false;
  state.replay = false;
  playbackTimers.forEach(id => clearTimeout(id));
  playbackTimers = [];
  if (playbackEndTimer) { clearTimeout(playbackEndTimer); playbackEndTimer = null; }
  balls.forEach(b => { b.sustainLatch = false; b.sustainAt = 0; });
  paintRecorder();
  // После прослушивания авто-запись возвращается к текущей станции.
  if (typeof autoRecordStart === 'function') autoRecordStart();
}
function stopPlayback(resumeAuto) {
  playbackToken += 1;
  playbackTimers.forEach(id => clearTimeout(id));
  playbackTimers = [];
  if (playbackEndTimer) { clearTimeout(playbackEndTimer); playbackEndTimer = null; }
  if (typeof cancelPendingNoteChord === 'function') cancelPendingNoteChord();
  state.replay = false;
  if (state.playingRecording) {
    state.playingRecording = false;
    if (typeof dampPedalVoices === 'function') dampPedalVoices();
    paintRecorder();
    // «Стоп» прослушивания не должен выключать фоновую автозапись. При смене
    // станции/паузе вызывающий передаёт false: там новую дорожку откроет
    // loadCombo() или setPaused(false), уже с новым comboIdx.
    if (resumeAuto !== false && typeof autoRecordStart === 'function') autoRecordStart();
  }
}
// Один проход записи. При включённом P.recLoop финальный таймер запускает
// следующий проход с тем же token, поэтому «Стоп» и смена записи по-прежнему
// отменяют всё одной проверкой. Таймеры прошлого прохода снимаем, чтобы они
// не копились после каждого круга.
function startPlaybackCycle(rec, token) {
  playbackTimers.forEach(id => clearTimeout(id));
  playbackTimers = [];
  if (playbackEndTimer) { clearTimeout(playbackEndTimer); playbackEndTimer = null; }
  const events = recordingTimeline(rec);
  events.forEach(ev => {
    playbackTimers.push(setTimeout(() => {
      if (token !== playbackToken || !state.playingRecording) return;
      playRecordedEvent(ev, rec);
    }, Math.max(0, ev.t)));
  });
  // Конец прослушивания — по последнему событию, а не по «хвосту» тишины,
  // который мог остаться до нажатия «Стоп». Небольшой зазор даёт хвосту
  // последней ноты договорить перед повтором.
  const last = events.length ? events[events.length - 1].t : 0;
  playbackEndTimer = setTimeout(() => {
    if (token !== playbackToken || !state.playingRecording) return;
    if (P.recLoop) startPlaybackCycle(rec, token);
    else finishPlayback(token);
  }, last + 220);
}
function playSelected() {
  const rec = selectedRecording();
  if (!rec || !rec.events.length || state.recording || state.recordingCountIn || exportBusy()) return;
  if (!state.started) { initAudio(); beginFromOverlay(); }
  if (state.paused) setPaused(false);
  stopPlayback();
  initAudio();
  state.playingRecording = true;
  state.replay = true;
  const token = ++playbackToken;
  startPlaybackCycle(rec, token);
  paintRecorder();
  toast('▶ ' + rec.name + (P.recLoop ? ' · повтор' : ''));
}
// ===== MIDI-экспорт =====
// Запись хранит готовые высоты, поэтому SMF собирается без зависимостей и без
// обращения к текущей станции. Формат 0 (один трек), PPQ 480: этого достаточно
// для любого редактора, а аккорд, бас и мелодия остаются раздельными нотами.
function midiVarLen(value) {
  let v = Math.max(0, Math.round(Number(value) || 0));
  const bytes = [v & 0x7F];
  v = Math.floor(v / 128);
  while (v > 0) {
    bytes.unshift((v & 0x7F) | 0x80);
    v = Math.floor(v / 128);
  }
  return bytes;
}
function midiU32(value) {
  const v = Math.max(0, Math.round(Number(value) || 0));
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
}
function midiAscii(text) {
  return String(text || '').replace(/[^\x20-\x7E]/g, '?').split('')
    .map(ch => ch.charCodeAt(0) & 0x7F);
}
// События для теста и для сборки файла: note-on/note-off с тиками, BPM и PPQ.
// Длительность аккорда берётся до следующего события (120…1500 мс), ноты —
// короче (120…900 мс), чтобы мелодия не «заливала» следующие доли.
function midiRecordingEvents(rec) {
  const list = (rec && rec.events ? rec.events : []).filter(ev => ev && ev.type !== 'drum')
    .slice()
    .sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0));
  const bpm = clamp(Number(rec && rec.form && rec.form.bpm) || Number(P.formBpm) || 84, 40, 200);
  const ppq = 480;
  const toTick = ms => Math.max(0, Math.round((Number(ms) || 0) * bpm / 60000 * ppq));
  const out = [];
  list.forEach((ev, i) => {
    if (!ev) return;
    const t = Math.max(0, Number(ev.t) || 0);
    const nextT = i + 1 < list.length ? Math.max(t, Number(list[i + 1].t) || 0) : t + 800;
    const gap = nextT - t;
    const dur = Math.max(120, Math.min(1500, gap || 700));
    const vel = Math.max(1, Math.min(127, Math.round((ev.vel == null ? 0.8 : ev.vel) * 127)));
    if (ev.type === 'chord' && ev.h) {
      const h = ev.h;
      const base = ev.base == null ? 60 : Number(ev.base);
      const offset = h.offset == null ? 0 : Number(h.offset);
      const root = (Number.isFinite(base) ? base : 60) + 12 +
        (Number.isFinite(offset) ? offset : 0);
      const third = h.third == null ? 4 : Number(h.third);
      const fifth = h.fifth == null ? 7 : Number(h.fifth);
      const notes = [root, root + third, root + fifth];
      if (ev.bass != null && Number.isFinite(Number(ev.bass))) notes.push(Number(ev.bass));
      const uniq = Array.from(new Set(notes.map(n =>
        Math.max(0, Math.min(127, Math.round(n))))));
      uniq.forEach(midi => {
        out.push({ tick: toTick(t), on: true, midi, vel });
        out.push({ tick: toTick(t + dur), on: false, midi, vel: 0 });
      });
    } else if (ev.type === 'note' && Number.isFinite(Number(ev.midi))) {
      const midi = Math.max(0, Math.min(127, Math.round(Number(ev.midi))));
      out.push({ tick: toTick(t), on: true, midi, vel });
      out.push({ tick: toTick(t + Math.max(120, Math.min(900, dur))), on: false, midi, vel: 0 });
    }
  });
  // Note-off раньше note-on на том же тике: иначе соседние одинаковые ноты
  // могли бы «погасить» только что начатую.
  out.sort((a, b) => a.tick - b.tick ||
    (a.on === b.on ? a.midi - b.midi : (a.on ? 1 : -1)));
  return { events: out, bpm, ppq };
}
function buildMidiFile(rec) {
  const data = midiRecordingEvents(rec);
  const beats = rec && rec.form && Number(rec.form.beatsPerBar) === 3 ? 3 : 4;
  const track = [];
  const push = bytes => { bytes.forEach(b => track.push(b & 255)); };
  const event = (delta, bytes) => {
    push(midiVarLen(delta));
    push(bytes);
  };
  const name = midiAscii('HARMONIA');
  event(0, [0xFF, 0x03].concat(midiVarLen(name.length), name));
  const mpqn = Math.round(60000000 / data.bpm);
  event(0, [0xFF, 0x51, 0x03, (mpqn >> 16) & 255, (mpqn >> 8) & 255, mpqn & 255]);
  event(0, [0xFF, 0x58, 0x04, beats, 2, 24, 8]);
  // Акустическое пианино: нейтральная программа, которую понимает любой плеер.
  event(0, [0xC0, 0x00]);
  let lastTick = 0;
  data.events.forEach(e => {
    event(Math.max(0, e.tick - lastTick), [e.on ? 0x90 : 0x80, e.midi, e.on ? e.vel : 0]);
    lastTick = e.tick;
  });
  event(0, [0xFF, 0x2F, 0x00]);
  const header = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1,
    (data.ppq >> 8) & 255, data.ppq & 255];
  return new Uint8Array(header.concat([0x4D, 0x54, 0x72, 0x6B],
    midiU32(track.length), track));
}
function midiFileName(rec) {
  // Общая база с видео и WAV: «Ля-До-Ми.mid».
  return recordingFileName(rec, 'mid');
}
function exportSelectedMidi() {
  const rec = selectedRecording();
  if (!rec || !rec.events || !rec.events.length || exportBusy()) return '';
  const bytes = buildMidiFile(rec);
  const name = midiFileName(rec);
  try {
    const blob = new Blob([bytes], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('MIDI сохранён', 'good');
    return name;
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('midi: download failed', e);
    toast('MIDI не удалось сохранить');
    return '';
  }
}
function deleteSelectedRecording() {
  const rec = selectedRecording();
  if (!rec || state.recording || state.recordingCountIn || state.playingRecording || exportBusy()) return;
  recordings = recordings.filter(r => r.id !== rec.id);
  selectedRecId = recordings.length ? recordings[0].id : null;
  saveRecordings();
  paintRecorder();
  toast('Запись удалена');
}
function initRecorder() {
  loadRecordings();
  selectedRecId = recordings.length ? recordings[0].id : null;
  const btn = $('recBtn'), play = $('playBtn'), del = $('recDel'), list = $('recList');
  const midi = $('recMidi'), autoBtn = $('recAuto');
  if (!btn || !play || !del || !list) return;
  btn.addEventListener('click', () => {
    // Во время отсчёта кнопка работает как отмена, а не как повторный старт.
    if (state.recordingCountIn) stopRecording(false);
    else if (state.recording) stopRecording(true);
    else startRecording();
  });
  play.addEventListener('click', () => {
    if (state.playingRecording) stopPlayback();
    else playSelected();
  });
  del.addEventListener('click', deleteSelectedRecording);
  if (midi) midi.addEventListener('click', exportSelectedMidi);
  if (autoBtn) autoBtn.addEventListener('click', () => setAutoRecord(!P.autoRecord));
  list.addEventListener('change', (e) => {
    selectedRecId = e.target.value || null;
    paintRecorder();
  });
  // Закрытие вкладки не должно терять уже сыгранное посещение: сохраняем только
  // непустую авто-дорожку, ручная запись по-прежнему требует «Стоп».
  window.addEventListener('beforeunload', () => autoRecordFinalize());
  paintRecorder();
}
initRecorder();
