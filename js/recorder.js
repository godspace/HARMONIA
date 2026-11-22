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
let recStartedAt = 0;
let recTicker = null;
let recFormMeta = null;
let recCountInTimers = [];
let recCountInToken = 0;
let playbackTimers = [];
let playbackEndTimer = null;
let playbackToken = 0;
let selectedRecId = null;

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
function recordOptionText(rec) {
  const form = rec.form ? ' · пьеса ' + rec.form.bpm + ' BPM' : '';
  return rec.name + ' · ' + recDurationLabel(rec.duration) +
    ' · ' + rec.events.length + ' соб.' + form;
}
function paintRecorder() {
  const btn = $('recBtn'), play = $('playBtn'), del = $('recDel');
  const list = $('recList'), status = $('recStatus');
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
  const busy = !!state.recording || countIn;
  btn.textContent = countIn ? '✕ Отмена' : state.recording ? '■ Стоп' : '● Запись';
  btn.setAttribute('aria-pressed', String(busy));
  btn.classList.toggle('live', busy);
  play.textContent = state.playingRecording ? '■ Стоп' : '▶ Прослушать';
  const hasSelected = !!selectedRecording();
  play.disabled = busy || (!hasSelected && !state.playingRecording);
  del.disabled = busy || state.playingRecording || !hasSelected;
  list.disabled = busy || state.playingRecording;
  status.className = 'rec-status' +
    (countIn ? ' countin' : state.recording ? ' live' : state.playingRecording ? ' playing' : '');
  if (countIn) {
    status.textContent = '⏱ Отсчёт ' + Math.max(1, state.recCountInBeat || 1) + '/' +
      Math.max(1, state.recCountInTotal || 1) + ' · запись начнётся с 1-го такта';
  } else if (state.recording) {
    status.textContent = '● Запись · ' + recDurationLabel(performance.now() - recStartedAt) +
      ' · ' + recEvents.length + ' соб.';
  } else if (state.playingRecording) {
    const rec = selectedRecording();
    status.textContent = '▶ Прослушивание' + (rec ? ' · ' + rec.name : '') +
      (P.recLoop ? ' · повтор' : '') + '…';
  } else if (hasSelected) {
    const rec = selectedRecording();
    const form = rec.form ? ' · пьеса ' + rec.form.bpm + ' BPM' : '';
    status.textContent = 'Выбрано: ' + rec.name + ' · ' + recDurationLabel(rec.duration) +
      ' · ' + rec.events.length + ' соб.' + form;
  } else {
    status.textContent = 'Нажмите «Запись», чтобы сохранить мелодию.';
  }
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
  if (state.recording || state.recordingCountIn) return;
  if (!state.started) { initAudio(); beginFromOverlay(); }
  if (state.paused) setPaused(false);
  stopPlayback();
  recEvents = [];
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
    paintRecorder();
    if (save !== false) toast('Отсчёт отменён');
    return;
  }
  if (!state.recording) return;
  state.recording = false;
  if (recTicker) { clearInterval(recTicker); recTicker = null; }
  const duration = Math.max(0, performance.now() - recStartedAt);
  const events = recEvents;
  recEvents = [];
  if (save !== false && events.length) {
    const created = Date.now();
    const rec = {
      id: 'rec-' + created + '-' + Math.random().toString(36).slice(2, 6),
      name: 'Запись ' + recCreatedLabel(created),
      created, duration, events
    };
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
  paintRecorder();
}
function discardRecording() {
  if (state.recordingCountIn) {
    clearRecordCountIn();
    recFormMeta = null;
    paintRecorder();
    return;
  }
  if (state.recording) stopRecording(false);
}
function recordEvent(ev) {
  if (!state.recording || state.replay) return;
  const t = Math.max(0, performance.now() - recStartedAt);
  if (t >= REC_MAX_MS || recEvents.length >= REC_MAX_EVENTS) {
    stopRecording(true);
    return;
  }
  ev.t = t;
  if (state.form && state.form.running && state.form.bar >= 1) {
    ev.form = {
      bar: state.form.bar,
      beat: state.form.beat,
      section: state.form.sectionId || ''
    };
  }
  recEvents.push(ev);
  if (recEvents.length % 8 === 0) paintRecorder();
}
function recordChord(h, vel) {
  if (!state.recording || state.replay || !h) return;
  // h — снимок без функций: JSON.stringify сохранит только музыкальные поля.
  recordEvent({
    type: 'chord',
    h: {
      degree: h.degree, hint: h.hint, name: h.name, kind: h.kind,
      tonic: !!h.tonic, rootPc: h.rootPc, pcs: (h.pcs || []).slice(),
      third: h.third, fifth: h.fifth, offset: h.offset, quality: h.quality
    },
    base: rootMidi(),
    vel: vel == null ? 1 : clamp(vel, 0.05, 1)
  });
}
function recordNote(midi, vel, pan, withChord) {
  if (!state.recording || state.replay) return;
  recordEvent({
    type: 'note', midi,
    vel: vel == null ? 0.8 : clamp(vel, 0.05, 1),
    pan: pan == null ? 0 : pan,
    // MIDI-путь не гармонизирует ноты — прослушивание не должно добавлять
    // подложку, которой не было в оригинале.
    withChord: withChord !== false
  });
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
function playRecordedEvent(ev) {
  if (!ev) return;
  if (ev.type === 'chord' && ev.h) {
    // base из записи сохраняет исходную тональность прослушивания.
    playChordAudio(ev.h, ev.vel, ev.base);
    chordEvent(ev.h, ev.vel, 'replay');
    return;
  }
  if (ev.type !== 'note' || ev.midi == null) return;
  const midi = ev.midi, vel = ev.vel == null ? 0.8 : ev.vel;
  const pan = ev.pan == null ? clamp((midi - 60) / 48, -0.8, 0.8) : ev.pan;
  bell(midi, vel, pan, null, 'note', 0);
  if (ev.withChord !== false) noteChord(midi, vel, pan);
  const ball = ballForMidi(midi);
  // withAudio=false: звук уже создан выше, шар только показывает ноту.
  if (ball) triggerBall(ball, vel, false);
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
}
function stopPlayback() {
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
  const events = rec.events.slice().sort((a, b) => a.t - b.t);
  events.forEach(ev => {
    playbackTimers.push(setTimeout(() => {
      if (token !== playbackToken || !state.playingRecording) return;
      playRecordedEvent(ev);
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
  if (!rec || !rec.events.length || state.recording || state.recordingCountIn) return;
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
function deleteSelectedRecording() {
  const rec = selectedRecording();
  if (!rec || state.recording || state.recordingCountIn || state.playingRecording) return;
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
  list.addEventListener('change', (e) => {
    selectedRecId = e.target.value || null;
    paintRecorder();
  });
  paintRecorder();
}
initRecorder();
