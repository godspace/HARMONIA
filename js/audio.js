/* HARMONIA · js/audio.js — тракт Web Audio: колокол, фортепиано MIDI, бас, реверб, mute
   Модуль без сборки: подключается <script> в index.html до main.js.
   Все модули делят глобальную область — имена функций/констант уникальны. */

// ===== Аудио: только музыкальные голоса =====
// Один тракт: голос → (пан) → шина нот/аккордов → master → лимитер → выход,
// плюс посыл в реверб. Тембры разделены: аккорд — мягкая подложка, нота орбиты —
// звонкий колокол.
// Одиночная нота при этом не одинока: noteChord() кладёт под неё диатоническое
// трезвучие той же мягкой подложкой, что и у левой руки.
let audioCtx = null, master = null, convolver = null, wetGain = null;
// Раздельные шины громкости: одиночная нота, аккордовая подложка и барабаны не
// должны бороться за один ползунок. Шины стоят до master и после голосов.
let noteGain = null, chordGain = null, drumGain = null;
// monitorGain — только прослушивание: mute гасит его, а запись видео берёт
// сигнал до него с лимитера. Так выключенный звук не делает ролик немым.
let monitorGain = null, limiterNode = null, captureDest = null;
// Активные «хвосты» под педалью: при выключении педали их можно погасить сразу.
let pedalVoices = [];
// Живые фортепианные голоса MIDI: note → голос. Карта нужна для note-off и
// CC64: отпущенная клавиша гасит свой голос, а педаль оставляет его до подъёма.
let midiVoices = new Map();
// Отложенное автотрезвучие: быстрая арпеджио-фраза отменяет предыдущий аккорд,
// поэтому под меняющимися нотами не остаётся слоёный гармонический «суп».
let noteChordTimer = null, noteChordPending = null;
// Анализатор выхода — источник для измерений (спектр, RMS, центр масс).
let analyser = null, specBuf = null, waveBuf = null;
const BELL_TIMBRES = {
  // [отношение к основной, доля, длина хвоста]; tone — [низ, размах] среза ФНЧ.
  // У ноты есть тело (0.5), «хор» (1.004 — биения ~7 центов) и обертоны до 5.43.
  note: {
    // decay 1.22 вместо 1.55: одиночная нота отпускает чуть быстрее, но нижний
    // порог ФНЧ выше — тело не становится «сухим». Огибающая ниже двухстадийная.
    peak: 0.26, decay: 1.22, wet: 0.5, tone: [1900, 8500], floor: 1050,
    partials: [[0.5, 0.16, 1.00], [1, 1.00, 1.00], [1.004, 0.55, 0.95],
               [2.002, 0.42, 0.80], [3.01, 0.22, 0.60], [4.16, 0.12, 0.42], [5.43, 0.06, 0.28]]
  },
  chord: {
    peak: 0.072, decay: 1.05, wet: 0.30, tone: [900, 2200], floor: 520,
    partials: [[1, 1.00, 1.00], [2, 0.32, 0.55], [3, 0.16, 0.32], [4, 0.07, 0.20]]
  }
};
// ===== Фортепианный голос MIDI =====
// Это не «ещё один колокол»: контроллер должен звучать привычно и управляемо.
// Аддитивный синтез с лёгкой негармоничностью струн, молоточковым шумом и
// раздельными огибающими партиалов даёт фортепианную атаку и хвост. Velocity
// меняет три вещи одновременно — громкость, яркость среза и долю верхних
// партиалов; поэтому тихая игра не просто тише, а мягче и темнее.
// Чтобы голос не звучал «игрушечным» набором синусов, у первых обертонов есть
// чуть расстроенная пара струн, а низ подпирает суб-октавное тело корпуса.
const PIANO_TIMBRE = {
  peak: 0.62,        // общий пик до шины нот (P.noteVol применяется дальше)
  partials: 12,      // выше 17 кГц партиалы не создаются
  inharmonicity: 0.00016,
  wet: 0.42,         // как у колокола ноты: сухой сигнал и реверб в балансе
  decayLow: 4.4,     // A0: длинная струна
  decayHigh: 0.92,   // C8: короткая
  cutoffLow: 460,
  cutoffHigh: 7600,
  body: 0.18,        // суб-октава корпуса, гаснет в верхнем регистре
  unisonCents: 3.4,  // расстройка пары струн: медленные биения вместо «пластика»
  hammer: 0.15
};
// Чистый план голоса без AudioNode: smoke-проверка может пройти все 88 клавиш
// и убедиться, что сила нажатия меняет громкость и тембр, а не только число.
function pianoPlan(midi, vel) {
  const raw = Number(midi);
  const note = clamp(Number.isFinite(raw) ? Math.round(raw) : 60, 0, 127);
  const v = clamp(vel == null ? 0.8 : vel, 0.05, 1);
  // 88-клавишный диапазон A0–C8 задаёт форму тембра; крайние MIDI-ноты
  // получают ближайшую к нему окраску, но остаются своей высотой.
  const key = clamp((note - 21) / 87, 0, 1);
  const freq = midiToFreq(note);
  const pan = clamp((note - 60) / 48, -0.8, 0.8);
  // Низкие клавиши держат звук дольше, высокие гаснут быстрее — как струны.
  const decay = PIANO_TIMBRE.decayLow +
    (PIANO_TIMBRE.decayHigh - PIANO_TIMBRE.decayLow) * key;
  const tone = typeof P !== 'undefined' && P.tone ? P.tone : 1;
  // Сила нажатия открывает фильтр; верхний регистр и так ярче нижнего.
  // Частота ноты участвует отдельно: даже тихая высокая нота не должна
  // превращаться в глухой «стук».
  const cutoff = clamp(Math.max(freq * 2.2, (PIANO_TIMBRE.cutoffLow +
    PIANO_TIMBRE.cutoffHigh * Math.pow(v, 1.25)) * (0.80 + 0.40 * key) * tone),
    440, 17000);
  const inharm = PIANO_TIMBRE.inharmonicity * (0.55 + key);
  const partials = [];
  for (let n = 1; n <= PIANO_TIMBRE.partials; n++) {
    // Струна не идеальна: верхние обертоны чуть выше точных кратных.
    const ratio = n * Math.sqrt(1 + inharm * n * n);
    if (freq * ratio >= 17000) break;
    // Верхние партиалы сильнее проявляются при жёстком ударе и гаснут раньше.
    // После нормировки это меняет именно баланс, а не только общую громкость.
    const highLift = n === 1 ? 0 : 0.78 * (v - 0.42);
    const gain = Math.pow(n, -1.18) * (0.56 + 0.44 * v) * (1 + highLift);
    const decayMul = 1 / (1 + 0.28 * (n - 1));
    // [отношение к основной, доля, множитель хвоста, detune в центах,
    // тип осциллятора, сдвиг панорамы]. Тип 'triangle' у основы даёт телу
    // мягкие нечётные гармоники; остальные — синусы, как у струн.
    partials.push([ratio, gain, decayMul, 0, n === 1 ? 'triangle' : 'sine', 0]);
    // Пара струн чуть расстроена: без неё сумма чистых синусов звучит
    // статично и «по-детски». Биения слышны на первых трёх обертонах.
    if (n <= 3) {
      partials.push([
        ratio,
        gain * (0.34 - 0.07 * (n - 1)),
        decayMul * 0.985,
        PIANO_TIMBRE.unisonCents,
        'sine',
        0.05 + 0.035 * n
      ]);
    }
  }
  // Суб-октава — не вторая нота, а резонанс корпуса: внизу она добавляет
  // тепла, в верхнем регистре почти исчезает и не мешает высоте.
  const bodyGain = PIANO_TIMBRE.body * (1 - 0.65 * key) * (0.55 + 0.45 * v);
  partials.push([0.5, bodyGain, 0.82, 0, 'sine', -0.04]);
  const total = partials.reduce((sum, p) => sum + p[1], 0) || 1;
  partials.forEach(p => { p[1] = p[1] / total; });
  const body = partials.find(p => p[0] < 0.75);
  return {
    note, freq, vel: v, pan,
    peak: PIANO_TIMBRE.peak * (0.14 + 0.86 * Math.pow(v, 1.3)),
    attack: 0.0015 + 0.0035 * (1 - v),
    decay, cutoff, partials,
    wet: PIANO_TIMBRE.wet,
    body: body ? body[1] : 0,
    unisonCents: PIANO_TIMBRE.unisonCents
  };
}
function makeImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  // Мягкий хвост + несколько ранних отражений: ревербератор звучит как
  // помещение, а не как ровный шум. left/right отличаются — появляется ширина.
  const taps = [0.011, 0.019, 0.031, 0.047, 0.071];
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const x = i / len;
      const fadeIn = Math.min(1, i / (rate * 0.004));
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, decay) * 0.72 * fadeIn;
    }
    taps.forEach((tap, j) => {
      const i = Math.floor((tap + (ch ? 0.003 : 0)) * rate);
      if (i < len) d[i] += (ch ? -1 : 1) * Math.pow(0.68, j) * 0.42;
    });
  }
  return buf;
}
// Громкость тембра: 0…2 (ползунки 0…150 % для запаса на тихие устройства).
function voiceVolume(name) {
  const v = name === 'note' ? P.noteVol : name === 'drum' ? P.drumVol : P.chordVol;
  return clamp(v == null ? 1 : v, 0, 2);
}
// Ползунки «Громкость нот / аккордов / барабанов» меняют шины сразу, не
// дожидаясь следующего звука. Старые реверб-посылы остаются на своей
// громкости — это незаметно на фоне коротких хвостов.
function applyVoiceVolumes() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  if (noteGain) noteGain.gain.setTargetAtTime(voiceVolume('note'), t, 0.04);
  if (chordGain) chordGain.gain.setTargetAtTime(voiceVolume('chord'), t, 0.04);
  if (drumGain) drumGain.gain.setTargetAtTime(voiceVolume('drum'), t, 0.04);
}
// Мягкий лимитер вместо DynamicsCompressor: у компрессора фиксированный
// look-ahead (около 6 мс), который задерживает весь выход, включая сухой сигнал.
// Кривая ниже прозрачна до 0.82 и плавно ограничивает пики; латентности у
// WaveShaperNode нет. Ограничение не раздувает тихие ноты — оно только страхует
// мастер от клиппинга при плотных аккордах и педали.
function makeLimiterCurve() {
  const n = 4096, curve = new Float32Array(n), knee = 0.82;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    curve[i] = x < 0 ? -y : y;
  }
  return curve;
}
function initAudio() {
  if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume(); return; }
  // latencyHint числом, а не 'interactive': браузер просит минимальный буфер
  // (CFG.audioLatencyHint = 4 мс). Значение остаётся подсказкой — если железо
  // не тянет, браузер сам выберет безопасный размер.
  const hint = CFG && CFG.audioLatencyHint != null ? CFG.audioLatencyHint : 0.004;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  try {
    audioCtx = new Ctx({ latencyHint: hint });
  } catch (e) {
    // Старый Safari может не понять числовой hint — контекст важнее подсказки.
    audioCtx = new Ctx();
  }
  master = audioCtx.createGain();
  master.gain.value = 0.9;
  noteGain = audioCtx.createGain();
  chordGain = audioCtx.createGain();
  drumGain = audioCtx.createGain();
  noteGain.gain.value = voiceVolume('note');
  chordGain.gain.value = voiceVolume('chord');
  drumGain.gain.value = voiceVolume('drum');
  noteGain.connect(master);
  chordGain.connect(master);
  drumGain.connect(master);
  limiterNode = audioCtx.createWaveShaper();
  limiterNode.curve = makeLimiterCurve();
  limiterNode.oversample = 'none';
  master.connect(limiterNode);
  // Мониторинг отделён от записи: mute закрывает только выход в колонки.
  monitorGain = audioCtx.createGain();
  monitorGain.gain.value = state.muted ? 0 : 1;
  limiterNode.connect(monitorGain);
  monitorGain.connect(audioCtx.destination);
  // Ответвление в анализатор: на выход не влияет, только читает сигнал.
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;
  monitorGain.connect(analyser);
  convolver = audioCtx.createConvolver();
  convolver.buffer = makeImpulse(audioCtx, 1.6, 2.6);
  wetGain = audioCtx.createGain();
  wetGain.gain.value = P.reverb;
  convolver.connect(wetGain); wetGain.connect(master);
  // Шумовой буфер нужен и барабанам, и молоточковой атаке пианино. Готовим его
  // вместе с трактом: первая нота не должна генерировать полсекунды шума.
  if (!noiseBuffer) noiseBuffer = makeNoiseBuffer(audioCtx);
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
// Поток для записи ролика: сигнал берётся после лимитера, но до monitorGain,
// поэтому mute и громкость колонок не влияют на дорожку видео. Узел создаётся
// только на время экспорта: постоянная копия тракта не нужна.
function audioCaptureStream() {
  if (!audioCtx) return null;
  if (!captureDest) {
    captureDest = audioCtx.createMediaStreamDestination();
    (limiterNode || master).connect(captureDest);
  }
  return captureDest.stream;
}
function releaseAudioCapture() {
  if (!captureDest) return;
  try { captureDest.disconnect(); } catch (e) { /* узел мог быть уже отключён */ }
  captureDest = null;
}
// ===== Измерения выхода: спектр, громкость, центр масс спектра =====
// Массив бинов в 0..255 (нормализованные дБ) или null, если звук ещё не стартовал.
function audioSpectrum() {
  if (!analyser) return null;
  if (!specBuf || specBuf.length !== analyser.frequencyBinCount) {
    specBuf = new Uint8Array(analyser.frequencyBinCount);
  }
  analyser.getByteFrequencyData(specBuf);
  return specBuf;
}
// Среднеквадратичная громкость 0..1 по осциллограмме.
function audioRms() {
  if (!analyser) return 0;
  if (!waveBuf || waveBuf.length !== analyser.fftSize) {
    waveBuf = new Uint8Array(analyser.fftSize);
  }
  analyser.getByteTimeDomainData(waveBuf);
  let sum = 0;
  for (let i = 0; i < waveBuf.length; i++) {
    const v = (waveBuf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / waveBuf.length);
}
// Центр масс спектра: μ = Σ f·p / Σ p, где p — мощность бина (a/255)².
// Это оценка по 8-битным бинам: абсолютные значения приблизительны,
// зато сдвиг μ при смене регистра/тембра виден однозначно.
function spectralCentroid() {
  const bins = audioSpectrum();
  if (!bins || !audioCtx || !analyser) return 0;
  const binHz = audioCtx.sampleRate / analyser.fftSize;
  let num = 0, den = 0;
  for (let i = 1; i < bins.length; i++) {
    const p = (bins[i] / 255) * (bins[i] / 255);
    num += i * binHz * p; den += p;
  }
  return den > 0 ? num / den : 0;
}
// Общий посыл в ревербератор: мокрый сигнал не зависит от панорамы.
function wetSend(node, wet) {
  if (!(wet > 0)) return;
  const s = audioCtx.createGain();
  s.gain.value = wet;
  node.connect(s); s.connect(convolver);
}
// ===== Барабаны: синтез без семплов =====
// Грув (js/groove.js) и MIDI-пэд на канале 10 приходят сюда. Каждый удар — это
// два-три узла, а шум берётся из одного кэшированного буфера: генерировать
// секунду шума на удар дорого и бессмысленно. Семплов и внешних файлов у
// проекта нет — барабаны такие же синтезированные, как колокол и подложка.
let noiseBuffer = null;
function makeNoiseBuffer(ctx) {
  const len = Math.floor(ctx.sampleRate * 0.5);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
function noiseSource() {
  if (!audioCtx) return null;
  if (!noiseBuffer || noiseBuffer.sampleRate !== audioCtx.sampleRate) {
    noiseBuffer = makeNoiseBuffer(audioCtx);
  }
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuffer;
  return src;
}
// Тембры: у бочки — падающая синусоида и щелчок атаки, у малого — шум с телом,
// у тарелок — только шум с ФВЧ. band — [срез, Q]; drop — [низ, верх] глиссандо
// по частоте; body — высота тонального тела удара.
const DRUM_TIMBRES = {
  kick:    { peak: 0.95, decay: 0.34, wet: 0.05, drop: [140, 46], click: 880 },
  snare:   { peak: 0.55, decay: 0.19, wet: 0.10, body: 186, band: [1500, 0.9] },
  hat:     { peak: 0.30, decay: 0.05, wet: 0.04, band: [7600, 0.8] },
  openhat: { peak: 0.28, decay: 0.24, wet: 0.06, band: [7000, 0.7] },
  rim:     { peak: 0.46, decay: 0.10, wet: 0.08, body: 420, band: [2200, 1.4] }
};
// План удара — чистая функция без AudioNode: тем же приёмом, что noteChordPlan,
// её проверяет smoke-тест, а drumHit() только назначает время.
function drumPlan(kind, vel) {
  const id = DRUM_TIMBRES[kind] ? kind : 'hat';
  const t = DRUM_TIMBRES[id];
  const v = clamp(vel == null ? 0.8 : vel, 0.05, 1);
  return {
    kind: id, vel: v,
    peak: t.peak * v,
    decay: t.decay,
    // Голос живёт на 60 мс дольше огибающей: без запаса узел обрывается щелчком.
    duration: t.decay + 0.06
  };
}
// Удар. Возвращает план (для проверок) или null, если тракт ещё не открыт:
// голова smoke-прогона работает без AudioContext, и это должно быть тишиной,
// а не ошибкой.
function drumHit(kind, when, vel) {
  if (!audioCtx || !drumGain) return null;
  const plan = drumPlan(kind, vel);
  const t = when == null ? audioCtx.currentTime : Math.max(when, audioCtx.currentTime);
  const tmb = DRUM_TIMBRES[plan.kind];
  const out = audioCtx.createGain();
  out.gain.value = 1;
  out.connect(drumGain);
  wetSend(out, voiceVolume('drum') * tmb.wet);

  // Бочка: падающая синусоида + короткий «щелчок педали» — он делает удар
  // слышимым на ноутбуке, где 46 Гц почти не воспроизводятся.
  if (tmb.drop) {
    const osc = audioCtx.createOscillator(), env = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(tmb.drop[0], t);
    osc.frequency.exponentialRampToValueAtTime(tmb.drop[1], t + 0.09);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(plan.peak, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + plan.decay);
    osc.connect(env); env.connect(out);
    osc.start(t); osc.stop(t + plan.duration);
    const click = audioCtx.createOscillator(), clickEnv = audioCtx.createGain();
    click.type = 'triangle';
    click.frequency.setValueAtTime(tmb.click, t);
    clickEnv.gain.setValueAtTime(plan.peak * 0.18, t);
    clickEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.014);
    click.connect(clickEnv); clickEnv.connect(out);
    click.start(t); click.stop(t + 0.02);
  }

  // Шум: малый и тарелки. Малый — полоса с телом, тарелки — срез сверху.
  const noise = noiseSource();
  if (noise && tmb.band) {
    const band = audioCtx.createBiquadFilter(), env = audioCtx.createGain();
    band.type = plan.kind === 'snare' || plan.kind === 'rim' ? 'bandpass' : 'highpass';
    band.frequency.value = tmb.band[0];
    band.Q.value = tmb.band[1];
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(plan.peak, t + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, t + plan.decay);
    noise.connect(band); band.connect(env); env.connect(out);
    noise.start(t); noise.stop(t + plan.duration);
  }

  // Тональное тело: у малого — «пластик», у рима — щелчок обода.
  if (tmb.body) {
    const body = audioCtx.createOscillator(), env = audioCtx.createGain();
    body.type = plan.kind === 'snare' ? 'triangle' : 'square';
    body.frequency.setValueAtTime(tmb.body, t);
    body.frequency.exponentialRampToValueAtTime(tmb.body * 0.72, t + plan.decay);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(plan.peak * 0.5, t + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, t + plan.decay);
    body.connect(env); env.connect(out);
    body.start(t); body.stop(t + plan.duration);
  }
  return plan;
}
// Отпускание педали: гасим все голоса, которым педаль продлила хвост.
// Список очищаем — новые ноты создадут свои записи.
function dampPedalVoices() {
  if (audioCtx && pedalVoices.length) {
    const t = audioCtx.currentTime;
    pedalVoices.forEach(v => {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0.0001, t, 0.035);
    });
  }
  pedalVoices = [];
  // MIDI-ноты под CC64 живут в своей карте: подъём педали гасит и их.
  pianoPedalUp();
}
// Педальный хвост: после короткого плато сам уходит в тишину. Это не «стоп»,
// а именно затухание — педаль слышна, но новые аккорды не тонут в старых.
function autoFadePedalVoice(voice, t, maxDur) {
  const fadeSec = Math.max(0.5, Math.min(CFG.pedalFadeMs / 1000, maxDur));
  // Плато короче (35 %): хвост под педалью слышно, но он быстро уступает
  // следующим аккордам. Это и есть «быстрее гаснет» при зажатой педали.
  const holdUntil = t + fadeSec * 0.35;
  voice.gain.setValueAtTime(1, t);
  voice.gain.setValueAtTime(1, holdUntil);
  voice.gain.exponentialRampToValueAtTime(0.0001, t + fadeSec);
  return t + fadeSec;
}
function routeVoice(sum, pan, wet, bus, wetVol) {
  let tail = sum;
  if (audioCtx.createStereoPanner) {
    const pn = audioCtx.createStereoPanner();
    pn.pan.value = pan; sum.connect(pn); tail = pn;
  }
  // Сухой сигнал идёт в шину тембра; реверб-посыл масштабируем той же
  // громкостью, чтобы при 0 % нота не оставалась слышна одним ревербом.
  tail.connect(bus || master);
  wetSend(tail, wet * (wetVol == null ? 1 : wetVol));
}
// Колокол: vel (0..1) задаёт и громкость, и яркость. timbre — 'note' | 'chord'.
// hold (0..1.x) — множитель длины: сустейн-педаль держит уже сыгранную ноту.
// shapeOverride — характер станции для прослушивания авто-записи: запись
// хранит touch, и он должен звучать так же, как в момент игры.
function bell(midi, vel, pan, when, timbreName, hold, shapeOverride) {
  if (!audioCtx) return;
  const t = when == null ? audioCtx.currentTime : when;
  const v = clamp(vel == null ? 1 : vel, 0.05, 1);
  const tail = 1 + Math.max(0, hold || 0);
  const name = timbreName === 'note' ? 'note' : 'chord';
  const timbre = BELL_TIMBRES[name];
  // Характер станции (js/station.js) — та же нота, другая подача: короче или
  // длиннее, ярче или темнее, суше или объёмнее. Ручная запись и обычное
  // прослушивание остаются нейтральными; авто-запись передаёт shapeOverride,
  // чтобы голос станции не зависел от того, какая станция открыта сейчас.
  const shape = shapeOverride ||
    ((typeof stationShape === 'function' && !state.replay) ? stationShape() : null);
  const shapeDecay = shape ? shape.decay : 1;
  const shapeTone = shape ? shape.tone : 1;
  const shapeWet = shape ? shape.wet : 1;
  const f = midiToFreq(midi);
  const sum = audioCtx.createGain(); sum.gain.value = 1;
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = name === 'note' ? 0.35 : 0.5;
  const toneScale = name === 'note' ? (P.tone || 1) : 1;
  const cutoff = clamp((timbre.tone[0] + timbre.tone[1] * v) * toneScale * shapeTone, 300, 16000);
  // Фильтр закрывается вместе с телом ноты: без резкого «обрыва» на хвосте.
  const filterTime = (name === 'note' ? 0.58 : 0.8) * shapeDecay *
    (name === 'note' && tail > 1 ? tail : 1);
  lp.frequency.setValueAtTime(cutoff, t);
  lp.frequency.exponentialRampToValueAtTime(Math.min(cutoff, timbre.floor), t + filterTime);
  lp.connect(sum);
  let maxDur = 0;
  timbre.partials.forEach(([ratio, g, durF]) => {
    const osc = audioCtx.createOscillator(), env = audioCtx.createGain();
    const level = Math.max(0.0002, timbre.peak * v * g);
    const body = (timbre.decay * shapeDecay * durF + 0.12) * tail;
    const attack = name === 'note' ? 0.006 + 0.007 * (1 - v) : 0.008;
    const stopAt = t + attack + body + 0.12;
    maxDur = Math.max(maxDur, attack + body);
    const tone = f * ratio;
    // Основная нота у колокола — треугольник: тело и мягкие нечётные гармоники.
    osc.type = name === 'note' && ratio === 1 ? 'triangle' : 'sine';
    if (name === 'note' && ratio === 1) {
      // Короткий подъём частоты на атаке — «щипок» вместо ровной синусоиды.
      osc.frequency.setValueAtTime(tone * 1.012, t);
      osc.frequency.exponentialRampToValueAtTime(tone, t + 0.05);
    } else {
      osc.frequency.setValueAtTime(tone, t);
    }
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(level, t + attack);
    if (name === 'note') {
      // Две стадии: быстрый «щипковый» спад, затем плавный хвост. Это звучит
      // естественнее одной длинной экспоненты и не оставляет щелчка в конце.
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, level * 0.42), t + attack + body * 0.34);
      env.gain.exponentialRampToValueAtTime(0.0001, t + attack + body);
    } else {
      env.gain.exponentialRampToValueAtTime(0.0001, t + attack + body);
    }
    osc.connect(env);
    // Лёгкая ширина по обертонам: низкие чуть левее, высокие чуть правее.
    // Основная панорама ноты по-прежнему приходит из позиции шара.
    if (name === 'note' && audioCtx.createStereoPanner) {
      const spread = clamp((ratio - 1) * 0.16, -0.15, 0.15);
      if (Math.abs(spread) > 0.005) {
        const pn = audioCtx.createStereoPanner();
        pn.pan.value = spread;
        env.connect(pn); pn.connect(lp);
      } else {
        env.connect(lp);
      }
    } else {
      env.connect(lp);
    }
    osc.start(t); osc.stop(stopAt);
  });
  // Голос с педальным хвостом проходит через отдельный gain: его можно
  // приглушить в момент отпускания педали, не дожидаясь естественного распада.
  let out = sum;
  if (hold > 0) {
    out = audioCtx.createGain();
    out.gain.value = 1;
    sum.connect(out);
    // Старые записи не нужны после естественного распада — не копим узлы.
    pedalVoices = pedalVoices.filter(v => v.stopAt > t);
    const fadeEnd = autoFadePedalVoice(out, t, maxDur);
    // Даже нажатая педаль не должна превращаться в хор из десятков хвостов:
    // самые старые голоса уступают место новым мягким приглушением.
    while (pedalVoices.length >= CFG.pedalMaxVoices) {
      const old = pedalVoices.shift();
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setTargetAtTime(0.0001, t, 0.03);
    }
    pedalVoices.push({ gain: out, stopAt: fadeEnd + 0.1 });
  }
  routeVoice(out, pan || 0, timbre.wet * shapeWet,
    name === 'note' ? noteGain : chordGain, voiceVolume(name));
}
// Фортепианный голос: тело из партиалов, молоточковый шум и отдельный gain
// отпускания. Голос запоминается по ноте, поэтому note-off гасит именно эту
// клавишу, не трогая остальные. `when` оставлен для будущего планирования:
// интерактивная MIDI-нота всегда стартует от текущего времени AudioContext.
function pianoNote(midi, vel, pan, when, hold) {
  if (!audioCtx || !noteGain) return null;
  const plan = pianoPlan(midi, vel);
  const t = when == null ? audioCtx.currentTime : Math.max(when, audioCtx.currentTime);
  const old = midiVoices.get(plan.note);
  if (old) pianoReleaseVoice(old, 0.02);
  const sum = audioCtx.createGain();
  sum.gain.value = 1;
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = 0.35;
  lp.frequency.setValueAtTime(plan.cutoff, t);
  // Фильтр темнеет вместе с хвостом, но не закрывается в «точку»: у рояля
  // после атаки остаётся воздух, иначе звук снова становится игрушечным.
  lp.frequency.exponentialRampToValueAtTime(
    Math.max(420, plan.cutoff * 0.45), t + Math.max(0.2, plan.decay * 1.05));
  lp.connect(sum);
  const oscs = [];
  let endAt = t;
  plan.partials.forEach(([ratio, gain, decayMul, detune, type, spread]) => {
    const osc = audioCtx.createOscillator(), env = audioCtx.createGain();
    const level = Math.max(0.0002, plan.peak * gain);
    const attack = plan.attack * (ratio > 3 ? 0.85 : 1);
    const body = plan.decay * decayMul;
    const stopAt = t + attack + body + 0.14;
    endAt = Math.max(endAt, stopAt);
    osc.type = type || 'sine';
    const tone = plan.freq * ratio;
    // У основы — очень короткий подъём высоты на атаке: струна «садится»
    // после удара, а не начинается идеально ровной синусоидой.
    if (!detune && ratio > 0.9 && ratio < 1.02) {
      osc.frequency.setValueAtTime(tone * 1.0015, t);
      osc.frequency.exponentialRampToValueAtTime(tone, t + 0.03);
    } else {
      osc.frequency.setValueAtTime(tone, t);
    }
    if (detune) osc.detune.setValueAtTime(detune, t);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(level, t + attack);
    // Три стадии, как у струны: быстрый спад после удара, тело и длинный хвост.
    // 58 % на первой стадии вместо прежних 26 % убирает «пластиковый» щелчок.
    env.gain.exponentialRampToValueAtTime(
      Math.max(0.0002, level * (ratio < 2 ? 0.58 : ratio < 5 ? 0.42 : 0.28)),
      t + attack + body * 0.18);
    env.gain.exponentialRampToValueAtTime(
      Math.max(0.0002, level * (ratio < 2 ? 0.16 : 0.08)),
      t + attack + body * 0.66);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + body);
    // Осциллятор обязан пройти через свою огибающую: без этого узла голос
    // замолкает сразу после молоточкового шума.
    osc.connect(env);
    let tailNode = env;
    // Лёгкая ширина: расстроенная пара струн и корпус уходят в сторону от
    // основной ноты. Это не сдвигает высоту, только раскрывает голос.
    if (spread && audioCtx.createStereoPanner) {
      const pn = audioCtx.createStereoPanner();
      pn.pan.value = spread;
      env.connect(pn); tailNode = pn;
    }
    tailNode.connect(lp);
    osc.start(t); osc.stop(stopAt);
    oscs.push(osc);
  });
  // Молоток: короткий шумовой щелчок, тем ярче и громче, чем сильнее удар.
  // Полоса зависит от высоты ноты: у баса удар глуше, у верха — звонче.
  const noise = noiseSource();
  if (noise) {
    const band = audioCtx.createBiquadFilter(), env = audioCtx.createGain();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(
      clamp(plan.freq * 1.8 + 700 + 3200 * plan.vel, 600, 11000), t);
    band.Q.value = 0.72;
    const level = Math.max(0.0002,
      plan.peak * PIANO_TIMBRE.hammer * Math.pow(plan.vel, 1.2));
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(level, t + 0.0025);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    noise.connect(band); band.connect(env); env.connect(sum);
    noise.start(t); noise.stop(t + 0.07);
  }
  // Отдельный выход отпускания: note-off не обрывает хвост щелчком, а гасит его.
  const out = audioCtx.createGain();
  out.gain.value = 1;
  sum.connect(out);
  const p = pan == null ? plan.pan : clamp(pan, -0.8, 0.8);
  routeVoice(out, p, plan.wet, noteGain, voiceVolume('note'));
  const voice = {
    note: plan.note, gain: out, oscs,
    stopAt: endAt, pedaled: false, released: false
  };
  midiVoices.set(plan.note, voice);
  // Карта не должна хранить давно остывший голос: следующая нота заменит его.
  setTimeout(() => {
    if (midiVoices.get(plan.note) === voice) midiVoices.delete(plan.note);
  }, Math.max(250, (endAt - t + 0.4) * 1000));
  // hold остаётся в подписи ради совместимости: длину под педалью теперь
  // определяет не множитель, а реальный note-off/CC64.
  return voice;
}
function pianoReleaseVoice(voice, fade) {
  if (!voice || voice.released) return;
  voice.released = true;
  if (midiVoices.get(voice.note) === voice) midiVoices.delete(voice.note);
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const sec = fade == null ? 0.08 : fade;
  voice.gain.gain.cancelScheduledValues(t);
  voice.gain.gain.setTargetAtTime(0.0001, t, Math.max(0.012, sec / 3));
  voice.oscs.forEach(o => {
    try { o.stop(t + sec + 0.05); } catch (e) { /* уже остановлен */ }
  });
}
// Отпускание клавиши. Под педалью голос помечается и продолжает звучать до
// CC64=0; без педали отпускание слышно сразу, как у настоящего инструмента.
function pianoRelease(note, pedal) {
  const raw = Number(note);
  const voice = midiVoices.get(clamp(Number.isFinite(raw) ? Math.round(raw) : 60, 0, 127));
  if (!voice) return false;
  if (pedal) { voice.pedaled = true; return true; }
  pianoReleaseVoice(voice);
  return true;
}
function pianoPedalUp() {
  Array.from(midiVoices.values()).forEach(v => {
    if (v.pedaled) pianoReleaseVoice(v);
  });
}
function pianoAllOff() {
  Array.from(midiVoices.values()).forEach(v => pianoReleaseVoice(v, 0.04));
  midiVoices.clear();
}
// Нота с MIDI: та же высота, что нажата (без октавных подмен), панорама — по
// высоте, как за роялем: низкие слева, высокие справа.
function echoNote(midi, vel, hold) {
  if (!audioCtx) return null;
  return pianoNote(midi, vel, null, null, hold);
}
// Оценка задержки тракта для диагностики: baseLatency — буфер графа,
// outputLatency — оценка вывода браузера. В консоли это HARMONIA.audioLatencyMs().
function audioLatencyMs() {
  if (!audioCtx) return 0;
  const base = Number(audioCtx.baseLatency);
  const out = Number(audioCtx.outputLatency);
  return Math.round(((isFinite(base) ? base : 0) + (isFinite(out) ? out : 0)) * 1000);
}
// Гармония под одиночной нотой. В smart-режиме приоритет у текущего аккорда
// левой руки: трезвучие строится от его корня, а не от случайной ноты правой
// руки. Если нота образует с аккордом малую секунду или тритон, автотрезвучие
// лучше не добавлять вовсе — короткая пауза чище, чем заведомо грязное
// сочетание. Без smart работает прежнее правило chordOnDegree(): у каждой
// ступени лада есть своё диатоническое трезвучие.
function noteChordHarmony(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const smart = typeof smartHarmonyForNote === 'function' ? smartHarmonyForNote(pc) : null;
  if (smart === false) return null;
  return smart || chordOnDegree(pc);
}
// План автотрезвучия без побочных эффектов: HUD/тесты могут проверить, какой
// аккорд и какие голоса прозвучат, не создавая AudioNode.
function noteChordPlan(midi, vel, pan) {
  const h = noteChordHarmony(midi);
  if (!h) return null;
  const pc = ((midi % 12) + 12) % 12;
  // Если гармония пришла от текущего аккорда, его корень может быть ниже ноты.
  // Берём ближайший корень не выше мелодии: C-major под нотой D даёт C-E-G,
  // а не D-F-A. Для chordOnDegree() h.rootPc совпадает с нотой, и поведение
  // остаётся прежним.
  const chordRoot = h.rootPc === pc ? midi : midi - ((midi - h.rootPc + 12) % 12);
  const v = clamp(vel == null ? 0.8 : vel, 0.05, 1);
  // [полутон, относительная громкость, сдвиг панорамы]: корень октавой ниже —
  // тело и опора, корень в унисон — лёгкое удвоение колокола, затем терция и квинта.
  const voices = [
    [chordRoot - 12, 0.55, -0.20],
    [chordRoot, 0.85, 0],
    [chordRoot + h.third, 0.75, 0.18],
    [chordRoot + h.fifth, 0.68, 0.34]
  ];
  return {
    h, voices,
    vel: v,
    // Под педалью автотрезвучие живёт заметно короче самой ноты: иначе
    // быстрые фразы оставляют после себя облако сменяющихся трезвучий.
    pedalHold: P.sustain ? CFG.noteChordTail : 0
  };
}
// Отмена запланированного автотрезвучия: пауза, смена комбо и новая нота
// не должны получить аккорд от уже ушедшей ноты.
function cancelPendingNoteChord() {
  if (noteChordTimer) {
    clearTimeout(noteChordTimer);
    noteChordTimer = null;
  }
  noteChordPending = null;
}
// Нота сначала звучит одна. Только если она задержалась (или осталась одна в
// аккорде), через noteChordSettleMs под ней появляется трезвучие. Следующая
// нота отменяет предыдущий план — это и убирает «музыкальный суп» из быстрых
// арпеджио, где каждая нота тянула за собой сменяющийся аккорд.
function scheduleNoteChord(midi, vel, pan, source) {
  if (!audioCtx || state.replay) { cancelPendingNoteChord(); return; }
  const fromMidi = source === 'midi';
  // Если игрок уже держит ещё одну MIDI-ноту, он играет настоящий аккорд.
  // Автотрезвучие под ним только дублировало бы голоса, поэтому умолкаем.
  if (fromMidi && typeof Heard !== 'undefined' && Heard.notes.size > 0) {
    cancelPendingNoteChord();
    return;
  }
  cancelPendingNoteChord();
  noteChordPending = { midi, vel, pan, source };
  noteChordTimer = setTimeout(() => {
    const p = noteChordPending;
    noteChordTimer = null;
    noteChordPending = null;
    if (!p || !playable()) return;
    // MIDI-нота могла отпуститься за эти 140 мс: не озвучиваем аккорд от
    // клавиши, которой уже нет. Под педалью она остаётся в Heard.latched —
    // тогда аккорд звучит. Клавиатура проверяется своим путём pressCode.
    if (p.source === 'midi' && typeof Heard !== 'undefined' &&
        Heard.midis().indexOf(p.midi) === -1) return;
    noteChord(p.midi, p.vel, p.pan);
  }, CFG.noteChordSettleMs);
}
// Немедленная версия для прослушивания записи и консоли. Возвращает трезвучие
// (или null), чтобы вызывающий код знал, что прозвучало.
function noteChord(midi, vel, pan, when) {
  cancelPendingNoteChord();
  if (!audioCtx) return null;
  const plan = noteChordPlan(midi, vel, pan);
  if (!plan) return null;
  plan.voices.forEach(([m, g, off]) =>
    bell(m, plan.vel * 0.7 * g, clamp((pan || 0) + off, -0.85, 0.85),
      when == null ? null : when, 'chord', plan.pedalHold));
  return plan.h;
}
// Удержание ноты — не «тихий орган», а тот же колокольный тембр: тело, обертон
// и очень мягкий авто-пан. Терция и квинта здесь больше не тянутся: аккорд уже
// приходит отдельным коротким автотрезвучием, а длинный сустейн остаётся чистым.
// Заодно это убирает яркий «космический» призвук, который копился на тонике
// после возврата домой и на любых долгих нотах.
function holdStart(b) {
  if (!audioCtx || b.hold) return;
  // playMidi выставляет triggerBall с учётом сдвига октавы; обычная высота шара —
  // запасной путь для старых вызовов.
  const midi = b.playMidi == null ? b.midi : b.playMidi;
  const t = audioCtx.currentTime, f = midiToFreq(midi);
  const v = clamp(b.holdVel == null ? 1 : b.holdVel, 0.2, 1);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.setTargetAtTime(0.075 * v, t, 0.05);
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = 0.6;
  // Ниже и темнее прежнего: длинная нота — продолжение колокола, а не яркий
  // синтетический тембр. Обертон 3.01 убран, 2.003 приглушён.
  lp.frequency.value = 1500 + 1700 * (P.tone || 1);
  const specs = [[f / 2, 'sine', 0.14], [f, 'triangle', 1], [f * 2.003, 'sine', 0.18]];
  const oscs = specs.map(([freq, type, level]) => {
    const o = audioCtx.createOscillator(), env = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    env.gain.value = level;
    o.connect(env); env.connect(lp);
    return o;
  });
  lp.connect(g);
  let tail = g, panner = null, lfo = null;
  if (audioCtx.createStereoPanner) {
    panner = audioCtx.createStereoPanner();
    panner.pan.value = Math.cos(b.phi) * 0.45;
    g.connect(panner); tail = panner;
    lfo = audioCtx.createOscillator(); lfo.frequency.value = 0.18;
    const depth = audioCtx.createGain(); depth.gain.value = 0.12;
    lfo.connect(depth); depth.connect(panner.pan);
    lfo.start(t);
  }
  tail.connect(noteGain || master);
  wetSend(tail, 0.26 * voiceVolume('note'));
  oscs.forEach(o => o.start(t));
  b.hold = { oscs, g, lfo };
}
function holdStop(b) {
  if (!b.hold) return;
  const h = b.hold; b.hold = null;
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  h.g.gain.cancelScheduledValues(t);
  h.g.gain.setTargetAtTime(0.0001, t, 0.05);
  h.oscs.forEach(o => o.stop(t + 0.3));
  if (h.lfo) h.lfo.stop(t + 0.3);
}
function bass(midi, when) {
  if (!audioCtx) return;
  const t = when == null ? audioCtx.currentTime : when, f = midiToFreq(midi), dur = 2.4;
  const sum = audioCtx.createGain(); sum.gain.value = 1;
  const tri = audioCtx.createOscillator(), triG = audioCtx.createGain();
  tri.type = 'triangle'; tri.frequency.setValueAtTime(f, t);
  triG.gain.setValueAtTime(0.0001, t);
  triG.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
  triG.gain.exponentialRampToValueAtTime(0.15, t + 0.25);
  triG.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  tri.connect(triG); triG.connect(sum); tri.start(t); tri.stop(t + dur + 0.05);
  const sub = audioCtx.createOscillator(), subG = audioCtx.createGain();
  sub.type = 'sine'; sub.frequency.setValueAtTime(f / 2, t);
  subG.gain.setValueAtTime(0.0001, t);
  subG.gain.exponentialRampToValueAtTime(0.20, t + 0.03);
  subG.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  sub.connect(subG); subG.connect(sum); sub.start(t); sub.stop(t + dur + 0.05);
  const saw = audioCtx.createOscillator(), lp = audioCtx.createBiquadFilter(), sawG = audioCtx.createGain();
  saw.type = 'sawtooth'; saw.frequency.setValueAtTime(f, t);
  lp.type = 'lowpass'; lp.Q.value = 0.7;
  lp.frequency.setValueAtTime(750, t);
  lp.frequency.exponentialRampToValueAtTime(220, t + 0.5);
  sawG.gain.setValueAtTime(0.0001, t);
  sawG.gain.exponentialRampToValueAtTime(0.10, t + 0.015);
  sawG.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  saw.connect(lp); lp.connect(sawG); sawG.connect(sum); saw.start(t); saw.stop(t + dur + 0.05);
  routeVoice(sum, 0, 0.06, chordGain, voiceVolume('chord'));
}
// Метроном формы: короткий сухой тик мимо шин нот/аккордов, но через master —
// значит, кнопка «Звук» и общий mute действуют и на него. when позволяет
// транспорт планировать удар заранее по часам AudioContext.
function metronomeClick(when, accent) {
  if (!audioCtx || !master) return;
  const t = when == null ? audioCtx.currentTime : when;
  const osc = audioCtx.createOscillator();
  const env = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(accent ? 1568 : 1046.5, t);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(accent ? 0.14 : 0.09, t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
  osc.connect(env); env.connect(master);
  osc.start(t); osc.stop(t + 0.07);
}
function applyMute() {
  // master остаётся неизменным: mute — это только мониторинг, а не запись.
  if (audioCtx && monitorGain) {
    monitorGain.gain.setTargetAtTime(state.muted ? 0 : 1, audioCtx.currentTime, 0.03);
  } else if (audioCtx && master && !monitorGain) {
    // Совместимость с очень старым трактом без monitorGain.
    master.gain.setTargetAtTime(state.muted ? 0 : 0.9, audioCtx.currentTime, 0.03);
  }
  const b = $('muteBtn');
  b.textContent = state.muted ? '🔇 Звук: выкл' : '🔊 Звук: вкл';
  b.setAttribute('aria-pressed', String(state.muted));
}
function toggleMute() { state.muted = !state.muted; applyMute(); }
