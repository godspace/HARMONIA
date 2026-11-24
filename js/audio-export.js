/* HARMONIA · js/audio-export.js — сохранение записи в WAV без внешних библиотек
   Модуль без сборки: подключается <script> после video.js и до research.js.
   Suno и другие сервисы не принимают MIDI, поэтому рядом с видео нужен звуковой
   файл. Запись хранит события, а не семплы: WAV собирается тем же синтезатором
   по recordingTimeline(), как прослушивание и ролик. Захват идёт с
   audioCaptureStream() (после компрессора, до mute): ScriptProcessorNode пишет
   PCM в память, audioPcmTrim() срезает тишину по краям, затем audioPcmToWav()
   добавляет RIFF/WAVE-заголовок. Всё работает на file:// и GitHub Pages,
   зависимостей нет. */

const AUDIO_LEAD_MS = 0;       // первая нота звучит с первого сэмпла файла
const AUDIO_TAIL_MS = 1600;    // запас на затухание; тишину после него срезаем
const AUDIO_FLUSH_MS = 220;    // даём живым ударам прозвучать вне файла
const AUDIO_MIN_MS = AUDIO_LEAD_MS + AUDIO_TAIL_MS;
const AUDIO_SILENCE = 0.003;   // порог цифровой тишины (≈ −50 dBFS)
const AUDIO_KEEP_HEAD_MS = 30; // запас перед атакой, чтобы не щёлкнуть
const AUDIO_KEEP_TAIL_MS = 140; // запас после последнего слышимого сэмпла
const AUDIO_LOOKAHEAD = 0.35;
const AUDIO_BUFFER = 4096;

let audioJob = null;
let audioStarting = false;
let audioToken = 0;

function audioSupported() {
  const Ctx = typeof window !== 'undefined'
    ? (window.AudioContext || window.webkitAudioContext) : null;
  return !!Ctx && typeof Ctx.prototype.createScriptProcessor === 'function' &&
    typeof audioCaptureStream === 'function' && typeof MediaStream !== 'undefined';
}
// Длительность WAV повторяет логику видео, но без финальной карточки: файл
// начинается с первой сыгранной ноты, затем идёт содержание и запас на
// затухание. Границы берутся по мелодии: фоновый грув до/после игры не
// растягивает файл. Тишину по краям окончательно срезает audioPcmTrim().
function audioDuration(rec) {
  const take = recordingExportTimeline(rec);
  if (!take.timeline.length) return 0;
  return Math.round(Math.max(AUDIO_MIN_MS,
    AUDIO_LEAD_MS + Math.max(0, take.lastEventAt - take.firstEventAt) +
    AUDIO_TAIL_MS));
}
function audioFileName(rec) {
  return recordingFileName(rec, 'wav');
}
function audioSampleToPcm16(value) {
  const v = Math.max(-1, Math.min(1, Number(value) || 0));
  return Math.round(v < 0 ? v * 0x8000 : v * 0x7FFF);
}
// Чистая функция для теста и скачивания: Float32 или Int16 каналы → RIFF/WAVE
// 16-bit PCM. Данные кладутся little-endian, каналы чередуются.
function audioPcmToWav(channels, sampleRate) {
  const list = Array.isArray(channels) ? channels : [channels];
  const count = Math.max(1, Math.min(2, list.length));
  let frames = 0;
  for (let i = 0; i < count; i++) {
    if (list[i] && list[i].length) frames = Math.max(frames, list[i].length);
  }
  const rate = Math.max(8000, Math.round(Number(sampleRate) || 48000));
  const blockAlign = count * 2;
  const dataSize = frames * blockAlign;
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);
  const put = (offset, text) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i) & 255;
  };
  put(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, count, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  put(36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let ch = 0; ch < count; ch++) {
      const src = list[ch];
      let sample = 0;
      if (src && frame < src.length) {
        sample = src instanceof Int16Array
          ? src[frame]
          : audioSampleToPcm16(src[frame]);
      }
      view.setInt16(offset, Math.max(-32768, Math.min(32767, sample)), true);
      offset += 2;
    }
  }
  return out;
}
function audioPcmJoin(chunks, frames) {
  const out = new Int16Array(frames);
  let offset = 0;
  for (let i = 0; i < chunks.length && offset < frames; i++) {
    const chunk = chunks[i];
    if (!chunk || !chunk.length) continue;
    const n = Math.min(chunk.length, frames - offset);
    out.set(chunk.subarray(0, n), offset);
    offset += n;
  }
  return out;
}
// Запас AUDIO_TAIL_MS нужен, чтобы длинное затухание успело записаться, но если
// оно короче, файл не должен заканчиваться секундами пустоты. Ищем первый и
// последний слышимый сэмпл и оставляем маленькие поля, чтобы атака и хвост не
// обрезались щелчком. Полностью немой захват не трогаем.
function audioPcmTrim(channels, sampleRate) {
  const list = Array.isArray(channels) ? channels : [channels];
  const left = list[0];
  if (!left || !left.length) return channels;
  const right = list[1] && list[1].length ? list[1] : left;
  const frames = Math.max(left.length, right.length);
  const scale = left instanceof Int16Array ? 32768 : 1;
  const floor = scale * AUDIO_SILENCE;
  const loud = i => Math.abs(left[i] || 0) >= floor ||
    Math.abs(right[i] || 0) >= floor;
  let first = -1;
  for (let i = 0; i < frames; i++) {
    if (!loud(i)) continue;
    first = i;
    break;
  }
  if (first < 0) return channels;
  let last = first;
  for (let i = frames - 1; i >= first; i--) {
    if (!loud(i)) continue;
    last = i;
    break;
  }
  const rate = Math.max(8000, Math.round(Number(sampleRate) || 48000));
  const from = Math.max(0,
    first - Math.round(rate * AUDIO_KEEP_HEAD_MS / 1000));
  const to = Math.min(frames,
    last + 1 + Math.round(rate * AUDIO_KEEP_TAIL_MS / 1000));
  if (to <= from) return channels;
  return list.map(ch => ch && typeof ch.subarray === 'function'
    ? ch.subarray(from, to) : ch);
}
function audioExportStatus() {
  if (!audioJob) return null;
  return {
    active: true,
    id: audioJob.rec && audioJob.rec.id ? audioJob.rec.id : '',
    // purpose различает обычный WAV и подготовку для Suno: файл и имя те же,
    // меняется только подпись прогресса и кнопка после завершения.
    purpose: audioJob.purpose || 'audio',
    name: recordingTitle(audioJob.rec),
    elapsed: Math.max(0, performance.now() -
      (audioJob.startedAt || performance.now())),
    duration: audioJob.duration
  };
}
function showAudioOverlay() {
  const el = $('audioExport');
  if (el) el.hidden = false;
}
function hideAudioOverlay() {
  const el = $('audioExport');
  if (el) el.hidden = true;
}
function updateAudioOverlay(job) {
  const text = $('audioExportText');
  if (!text || !job) return;
  const suno = job.purpose === 'suno';
  const title = document.querySelector('#audioExport .ve-title');
  if (title) title.textContent = suno ? '🎧 WAV для Suno' : '🎧 Аудио';
  const elapsed = Math.min(job.duration, Math.max(0, performance.now() -
    (job.startedAt || performance.now())));
  text.textContent = (suno ? '🎧 WAV для Suno · ' : '🎧 Аудио · ') +
    recDurationLabel(elapsed) + ' / ' + recDurationLabel(job.duration);
}
// Звук ставится по часам AudioContext с упреждением: setTimeout не отвечает за
// ритм, поэтому захват не зависит от частоты кадров.
function scheduleAudioExport(job) {
  if (!job || audioJob !== job || job.canceled || !audioCtx) return;
  const horizon = audioCtx.currentTime + AUDIO_LOOKAHEAD;
  const first = Number(job.firstEventAt) || 0;
  while (job.audioIdx < job.timeline.length) {
    const ev = job.timeline[job.audioIdx];
    const contentAt = Math.max(0, (Number(ev.t) || 0) - first);
    const at = job.audioStart + contentAt / 1000;
    if (at > horizon) break;
    playRecordedAudio(ev, job.rec, Math.max(at, audioCtx.currentTime));
    job.audioIdx += 1;
  }
}
function clearAudioTimers(job) {
  if (!job) return;
  if (job.scheduler) { clearInterval(job.scheduler); job.scheduler = null; }
  if (job.progress) { clearInterval(job.progress); job.progress = null; }
  if (job.endTimer) { clearTimeout(job.endTimer); job.endTimer = null; }
}
function downloadAudioJob(job) {
  if (!job) return '';
  try {
    const frames = Math.max(1, Math.round(job.duration / 1000 * job.sampleRate));
    const left = audioPcmJoin(job.left, frames);
    const right = audioPcmJoin(job.right.length ? job.right : job.left, frames);
    const pcm = audioPcmTrim([left, right], job.sampleRate);
    const wav = audioPcmToWav(pcm, job.sampleRate);
    const blob = new Blob([wav], { type: 'audio/wav' });
    const name = audioFileName(job.rec);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast((job.purpose === 'suno' ? 'WAV для Suno сохранён' : 'Аудио сохранено') +
      ' · ' + name, 'good');
    return name;
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('audio: download failed', e);
    toast('Аудио не удалось сохранить');
    return '';
  }
}
// Завершение идемпотентно: таймер конца и отмена могут прийти в любом порядке.
function finishAudioExport(job, save, silent) {
  if (!job || job.finished) return '';
  job.finished = true;
  job.capturing = false;
  clearAudioTimers(job);
  if (job.processor) {
    job.processor.onaudioprocess = null;
    try { job.processor.disconnect(); } catch (e) { /* уже отключён */ }
  }
  if (job.source) { try { job.source.disconnect(); } catch (e) { /* уже отключён */ } }
  if (job.silent) { try { job.silent.disconnect(); } catch (e) { /* уже отключён */ } }
  if (job.stream) {
    job.stream.getTracks().forEach(track => { try { track.stop(); } catch (e) {} });
  }
  releaseAudioCapture();
  if (audioJob === job) audioJob = null;
  job.processor = null;
  job.source = null;
  job.silent = null;
  job.stream = null;
  state.audioExport = false;
  state.replay = false;
  state.playingRecording = false;
  if (typeof cancelPendingNoteChord === 'function') cancelPendingNoteChord();
  if (typeof dampPedalVoices === 'function') dampPedalVoices();
  hideAudioOverlay();
  paintRecorder();
  let name = '';
  if (save && !job.canceled) name = downloadAudioJob(job);
  else if (job.canceled && !silent) toast('Экспорт аудио отменён');
  // Соло-подготовка для Suno ждёт имя файла: по нему кнопка становится «↗ Suno».
  // Колбэк не должен ломать завершение экспорта, поэтому ошибки только в консоль.
  if (typeof job.onDone === 'function') {
    try {
      job.onDone({
        name: name,
        canceled: !!job.canceled,
        rec: job.rec,
        purpose: job.purpose || 'audio'
      });
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('audio: onDone failed', e);
    }
  }
  // После файла возвращаем фоновую автозапись и таймер карточки оценки.
  if (typeof autoRecordStart === 'function') autoRecordStart();
  if (typeof Research !== 'undefined' &&
      typeof Research.holdAsk === 'function') Research.holdAsk(false);
  return name;
}
function cancelAudioExport() {
  const job = audioJob;
  if (!job) return;
  job.canceled = true;
  finishAudioExport(job, false);
}
async function startAudioExport(target, options) {
  // Без аргумента — выбранная запись панели; с аргументом — запись карточки
  // оценки. Имя файла то же, что у MIDI и видео. options.purpose/onDone
  // использует js/suno.js: WAV остаётся тем же, меняется только подпись.
  const opts = options || {};
  const rec = target || selectedRecording();
  if (audioJob || audioStarting || exportBusy() || !rec || !rec.events || !rec.events.length) {
    if (rec && (!rec.events || !rec.events.length)) toast('В записи нет нот');
    return '';
  }
  if (state.recording || state.recordingCountIn || state.playingRecording) return '';
  if (!audioSupported()) {
    toast('Аудио не поддерживается браузером');
    return '';
  }
  let job = null;
  audioStarting = true;
  try {
    if (!state.started) { initAudio(); beginFromOverlay(); }
    if (state.paused) setPaused(false);
    stopPlayback();
    if (typeof autoRecordFinalize === 'function') autoRecordFinalize();
    initAudio();
    if (!audioCtx) throw new Error('audio is not ready');
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const take = recordingExportTimeline(rec);
    const timeline = take.timeline;
    if (!timeline.length) {
      toast('В записи нет нот');
      return '';
    }
    const duration = audioDuration(rec);
    const token = ++audioToken;
    job = {
      token, rec, timeline,
      purpose: opts.purpose || 'audio',
      onDone: typeof opts.onDone === 'function' ? opts.onDone : null,
      firstEventAt: take.firstEventAt,
      duration, sampleRate: audioCtx.sampleRate || 48000,
      left: [], right: [], audioIdx: 0,
      capturing: false, canceled: false, finished: false, save: false
    };
    audioJob = job;
    state.audioExport = true;
    state.replay = true;
    if (typeof Research !== 'undefined' &&
        typeof Research.holdAsk === 'function') Research.holdAsk(true);
    paintRecorder();
    showAudioOverlay();
    updateAudioOverlay(job);
    // Даём уже запланированным живым ударам прозвучать до захвата.
    await new Promise(resolve => setTimeout(resolve, AUDIO_FLUSH_MS));
    if (audioJob !== job || job.canceled) return '';
    const stream = audioCaptureStream();
    if (!stream) throw new Error('audio capture is unavailable');
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(AUDIO_BUFFER, 2, 2);
    const silent = audioCtx.createGain();
    silent.gain.value = 0;
    source.connect(processor);
    processor.connect(silent);
    silent.connect(audioCtx.destination);
    job.stream = stream;
    job.source = source;
    job.processor = processor;
    job.silent = silent;
    processor.onaudioprocess = (e) => {
      if (audioJob !== job || job.canceled || !job.capturing) return;
      const input = e.inputBuffer;
      const frames = input.length;
      const l = input.getChannelData(0);
      const r = input.numberOfChannels > 1 ? input.getChannelData(1) : l;
      const l16 = new Int16Array(frames);
      const r16 = new Int16Array(frames);
      for (let i = 0; i < frames; i++) {
        l16[i] = audioSampleToPcm16(l[i]);
        r16[i] = audioSampleToPcm16(r[i]);
      }
      job.left.push(l16);
      job.right.push(r16);
      // ScriptProcessor обязан куда-то писать выход; в колонки он не идёт.
      const output = e.outputBuffer;
      for (let ch = 0; ch < output.numberOfChannels; ch++) {
        output.getChannelData(ch).fill(0);
      }
    };
    job.capturing = true;
    job.startedAt = performance.now();
    job.audioStart = audioCtx.currentTime + AUDIO_LEAD_MS / 1000;
    scheduleAudioExport(job);
    job.scheduler = setInterval(() => scheduleAudioExport(job), 40);
    job.progress = setInterval(() => {
      if (audioJob !== job) return;
      updateAudioOverlay(job);
      paintRecorder();
    }, 250);
    job.endTimer = setTimeout(() => {
      if (audioJob !== job || job.canceled) return;
      finishAudioExport(job, true);
    }, duration + 80);
    toast((opts.purpose === 'suno' ? '🎧 WAV для Suno: ' : '🎧 Аудио: ') +
      recordingTitle(rec));
    return rec.id;
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('audio: export failed', e);
    if (job && audioJob === job) finishAudioExport(job, false, true);
    else {
      state.audioExport = false;
      state.replay = false;
      hideAudioOverlay();
      releaseAudioCapture();
      paintRecorder();
    }
    toast('Аудио не удалось сохранить');
    return '';
  } finally {
    audioStarting = false;
  }
}
function initAudioExport() {
  const btn = $('recAudio');
  const cancel = $('audioCancel');
  if (btn) btn.addEventListener('click', () => { startAudioExport(); });
  if (cancel) cancel.addEventListener('click', cancelAudioExport);
  window.addEventListener('beforeunload', () => {
    if (audioJob) {
      audioJob.canceled = true;
      finishAudioExport(audioJob, false, true);
    }
  });
}
initAudioExport();
