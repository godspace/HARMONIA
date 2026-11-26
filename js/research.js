/* HARMONIA · js/research.js — необязательный сбор оценок комбо
   Модуль без сборки: подключается <script> в index.html после recorder.js.
   Все модули делят глобальную область — имена функций/констант уникальны.

   Зачем этот слой. Игра уже знает, что прозвучало, но не знает, понравилось ли
   это игроку. Чтобы настраивать характеры станций (STATION_TOUCH, голоса, бас,
   октаву) по слуху, а не по догадке, нужен маленький честный опрос: после
   Space-перехода в новое комбо показать одну карточку с оценкой 1–5 и
   необязательным комментарием. Всё остальное — поведение — записывается само:
   сколько игрок держал комбо, что сыграл, каким был счёт и как он вышел.

   Границы, которые важны:
     · исследование ВКЛЮЧЕНО по умолчанию, поэтому обычный игрок видит карточку
       после Space-перехода; выключают его ?research=0, консоль или панель.
       Старые настройки без version один раз мигрируют на enabled: true;
     · карточка появляется только на Space-переходе (advanceCombo); ручные
       переходы (стрелки, выбор комбо, круг, лад) закрывают посещение молча;
     · модуль — наблюдатель: он не меняет ни pitch class, ни очки, ни раскладку;
     · прослушивание записи (state.replay) не пишется;
     · данные лежат в localStorage и уходят только скачанным JSON-файлом.

   Что такое посещение (segment). Вход в комбо открывает сегмент; первое
   музыкальное событие материализует его (пустые визиты выбрасываются). При
   выходе считаются dwellMs (весь визит), playMs (от первой ноты/аккорда),
   counts, score и exit.via. Оценка приходит позже и дописывается в тот же
   сегмент — так один визит остаётся одной строкой данных. */

var Research = (function () {
  'use strict';

  const CFG_R = (typeof CFG !== 'undefined' && CFG.research) || {};
  const RES_KEY = 'harmonia.research.v1';
  const SETTINGS_KEY = 'harmonia.research.settings';
  const SETTINGS_VERSION = 2;
  const SCHEMA = 'harmonia.research.v1';
  const ASK_MS = CFG_R.askMs || 12000;
  const COMMENT_MAX = CFG_R.commentMax || 160;
  const MAX_SEGMENTS = CFG_R.maxSegments || 400;
  const MAX_EVENTS = CFG_R.maxEvents || 4000;
  const MAX_BYTES = CFG_R.maxBytes || 3500000;
  // Пауза внутри игры, после которой время перестаёт считаться «активным».
  // playMs — весь визит от первой ноты, activePlayMs — только те промежутки,
  // где игрок действительно играл: долгие остановки не раздувают плотность.
  const ACTIVE_GAP_MS = CFG_R.activeGapMs || 5000;
  // Сколько эталонных визитов нужно, чтобы переносить профиль на другие
  // тональности по ступеням (до этого — только та же тональность/гипотеза).
  const REF_TRANSFER_REFS = (typeof CFG !== 'undefined' && CFG.guide &&
    CFG.guide.transferRefs) || 3;
  // Клавиши оценки: J — «отлично», [ — «плохо». Это же игровые клавиши,
  // поэтому карточка перехватывает их только пока открыта.
  const RATE_KEYS = { KeyJ: 5, KeyI: 4, KeyO: 3, KeyP: 2, BracketLeft: 1 };
  // Слова, которыми игрок сам называет эталонное звучание. 5/5 без слов
  // остаётся высокой оценкой, но не получает флаг reference: «люблю» — это
  // не то же самое, что «неплохо».
  const REFERENCE_WORDS = /(люб|нрав|тёпл|тепл|мягк|красив|обним|любим|love|warm|beautiful|cozy|moved)/i;

  let settings = { enabled: true, ask: true, version: SETTINGS_VERSION };
  let segments = [];
  let seg = null;            // открытое посещение
  let enterPerf = 0;         // performance.now() входа: для dwell/play
  let playFromPerf = 0;      // performance.now() первого события
  let lastMusicPerf = 0;     // последняя нота/аккорд: activePlayMs и tailMs
  let runState = null;       // текущий run одного аккорда
  let fingerChordDegree = ''; // предыдущая ступень для fingerprint-переходов
  let dataVersion = 0;       // меняется при сохранении: кэш профиля у Guide
  let pendingExit = '';      // причина следующего выхода (space/next/pause…)
  let lastClosed = null;     // последнее закрытое посещение — для карточки
  let session = null;        // общая метка сессии: группировка посещений
  let visit = 0;
  let askSeg = null;         // посещение, которое ждёт оценки
  let askPerf = 0;
  let askTimer = 0;
  let askHeld = false;       // таймер карточки стоит, пока идёт рендер видео
  let clearArmedAt = 0;

  // ===== Хранилище =====
  // localStorage может быть недоступен (приватный режим) или переполнен —
  // исследование не должно из-за этого ронять игру.
  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }
  function loadSettings() {
    const raw = readJson(SETTINGS_KEY);
    if (!raw || typeof raw !== 'object') {
      settings = { enabled: true, ask: true, version: SETTINGS_VERSION };
      saveSettings();
      return;
    }
    // version 2 — явный выбор игрока (в том числе enabled:false). Настройки
    // старого формата не знали версии: один раз включаем сбор, чтобы после
    // обновления карточка появилась у всех, кто ещё не делал выбора в новой
    // схеме. ?research=0 и панель сразу запишут version 2 и больше не тронутся.
    const version = Number(raw.version) || 0;
    settings.enabled = version >= SETTINGS_VERSION ? !!raw.enabled : true;
    settings.ask = raw.ask !== false;
    settings.version = SETTINGS_VERSION;
    saveSettings();
  }
  function saveSettings() {
    writeJson(SETTINGS_KEY, {
      version: SETTINGS_VERSION,
      enabled: !!settings.enabled,
      ask: !!settings.ask
    });
  }
  function loadSegments() {
    const raw = readJson(RES_KEY);
    if (!Array.isArray(raw)) {
      segments = [];
      return;
    }
    segments = raw.filter(s => s && typeof s === 'object' && Array.isArray(s.events));
    if (segments.length > MAX_SEGMENTS) segments = segments.slice(segments.length - MAX_SEGMENTS);
    segments.sort((a, b) => (a.enteredAt || 0) - (b.enteredAt || 0));
  }
  // Запись под давлением квоты: сначала уходят самые старые посещения, затем
  // (если и это не помогло) массив очищается — лучше потерять данные, чем
  // оставить игрока без звука из-за исключения в обработчике клавиши.
  function saveSegments() {
    dataVersion += 1;
    while (segments.length > MAX_SEGMENTS) segments.shift();
    let json = JSON.stringify(segments);
    let guard = 0;
    while (json.length > MAX_BYTES && segments.length > 1 && guard++ < MAX_SEGMENTS) {
      segments.shift();
      json = JSON.stringify(segments);
    }
    try {
      localStorage.setItem(RES_KEY, json);
      return true;
    } catch (e) {
      while (segments.length > 1) {
        segments.shift();
        try {
          localStorage.setItem(RES_KEY, JSON.stringify(segments));
          return true;
        } catch (ignore) { /* уступаем ещё одно посещение */ }
      }
      try { localStorage.setItem(RES_KEY, '[]'); } catch (ignore) { /* приватный режим */ }
      if (typeof toast === 'function') {
        toast('Хранилище исследования заполнено — старые данные удалены');
      }
      return false;
    }
  }

  function totals() {
    let rated = 0, skipped = 0, events = 0;
    segments.forEach(s => {
      events += (s.events || []).length;
      const r = s.rating || {};
      if (typeof r.score === 'number' && r.score >= 1 && r.score <= 5) rated += 1;
      else if (r.skipped) skipped += 1;
    });
    if (seg) events += seg.events.length;
    return { visits: segments.length, rated, skipped, events };
  }

  function status() {
    const t = totals();
    return {
      enabled: !!settings.enabled,
      ask: !!settings.ask,
      version: SETTINGS_VERSION,
      visits: t.visits,
      rated: t.rated,
      skipped: t.skipped,
      events: t.events,
      open: !!seg,
      waiting: !!askSeg,
      dataVersion
    };
  }

  // ===== Панель =====
  // Тело секции скрыто, пока исследование выключено: игрок не должен читать
  // служебные счётчики, а исследователь включает его одной кнопкой.
  function paint() {
    const toggle = $('researchToggle');
    const askBtn = $('researchAskToggle');
    const body = $('researchBody');
    const statusEl = $('researchStatus');
    const exportBtn = $('researchExport');
    const clearBtn = $('researchClear');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(!!settings.enabled));
      toggle.textContent = settings.enabled ? 'Исследование: вкл' : 'Исследование: выкл';
    }
    if (askBtn) {
      askBtn.setAttribute('aria-pressed', String(!!settings.ask));
      askBtn.textContent = settings.ask ? 'Спрашивать оценку: вкл' : 'Спрашивать оценку: выкл';
      askBtn.disabled = !settings.enabled;
    }
    if (body) body.hidden = !settings.enabled;
    if (statusEl) {
      const t = totals();
      statusEl.textContent = 'Посещений: ' + t.visits + ' · оценок: ' + t.rated +
        ' · событий: ' + t.events + (t.skipped ? ' · пропусков: ' + t.skipped : '');
    }
    if (exportBtn) exportBtn.disabled = !segments.length;
    if (clearBtn) {
      clearBtn.disabled = !segments.length;
      // «Ещё раз — очистить» держится четыре секунды, затем возвращается
      // обычная подпись: случайный клик не стирает данные молча.
      if (clearArmedAt && performance.now() - clearArmedAt > 4000) {
        clearArmedAt = 0;
        clearBtn.textContent = 'Очистить';
      }
    }
  }

  function enable(opts) {
    const o = opts || {};
    settings.enabled = true;
    if (o.ask != null) settings.ask = !!o.ask;
    saveSettings();
    if (o.open) {
      const pg = $('researchPg');
      if (pg) pg.open = true;
    }
    // Включение посреди игры начинает визит сразу, а не со следующего комбо.
    if (!seg && state.started && state.running && !state.paused) enterCombo();
    paint();
    return true;
  }

  function disable() {
    // Сегмент, открытый до выключения, сохраняется как обычное посещение:
    // иначе последняя сыгранная минута пропала бы из данных.
    if (seg) leaveCombo('off');
    closeAsk(true);
    settings.enabled = false;
    saveSettings();
    paint();
    return true;
  }

  function setAsk(on) {
    settings.ask = !!on;
    saveSettings();
    if (!settings.ask) closeAsk(true);
    paint();
    return settings.ask;
  }

  function clear() {
    segments = [];
    lastClosed = null;
    // Открытый визит тоже стирается: иначе он записался бы на следующем
    // переходе и «Очистить» выглядело бы частичным.
    seg = null;
    playFromPerf = 0;
    lastMusicPerf = 0;
    runState = null;
    fingerChordDegree = '';
    dataVersion += 1;
    pendingExit = '';
    closeAsk(true);
    try { localStorage.removeItem(RES_KEY); } catch (e) { /* приватный режим */ }
    paint();
    // Если игрок чистит данные прямо в комбо, сбор продолжается с нового
    // визита — иначе «Очистить» молча выключал бы запись до следующего перехода.
    if (settings.enabled && state.started && state.running) enterCombo();
    return true;
  }

  // ===== Посещение комбо =====
  // Причина выхода ставится до перехода: loadCombo закрывает сегмент, а
  // Space-переход должен успеть пометить его как 'space' до ручного 'next'.
  function exitHint(via) {
    if (!pendingExit) pendingExit = via || 'load';
  }
  function onSessionStart() {
    session = {
      id: 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      startedAt: Date.now()
    };
    visit = 0;
    pendingExit = '';
    lastClosed = null;
  }
  function comboSnapshot() {
    const c = combo();
    const st = stationStyleFor(state.comboIdx);
    const plot = typeof stationPlotArchetype === 'function' ? stationPlotArchetype() : null;
    const gesture = typeof stationGesture === 'function' ? stationGesture(st) : null;
    return {
      combo: {
        id: c.id, mode: c.mode, keyName: c.keyName,
        keyNameLatin: c.keyNameLatin, root: c.root,
        degrees: (c.degrees || []).slice(),
        // Тоническое трезвучие: по нему карточка и видео подписывают комбо
        // без служебных слов «станция» и «эталон».
        chords: (c.chords || []).map(ch => ch.slice())
      },
      station: {
        id: st.id, label: st.label, voicing: st.voicing,
        bass: st.bass, register: st.register, touch: st.touch,
        gesture: gesture ? { id: gesture.id, label: gesture.label, delays: gesture.delays.slice() } : null
      },
      // Сюжет пары — отдельный снимок: через месяц STATION_PLOT_BY_STYLE может
      // измениться, а старые ответы должны оставаться читаемыми.
      plot: plot ? { id: plot.id, label: plot.label } : null
    };
  }
  // Журнал сюжета внутри посещения: сколько аккордов в каждой фазе, как
  // менялись фазы и сколько времени игрок провёл «дома». Это наблюдатель:
  // ни звук, ни очки от него не зависят.
  function initialPlotLog(now) {
    const phase = typeof stationPlotPhase === 'function' ? stationPlotPhase() : 'home';
    const plot = typeof stationPlotArchetype === 'function' ? stationPlotArchetype() : null;
    return {
      enabled: typeof stationPlotEnabled === 'function' ? !!stationPlotEnabled() : false,
      archetype: plot ? plot.id : '',
      label: plot ? plot.label : '',
      phases: {},
      phaseSeq: [phase],
      phaseMs: {},
      transitions: 0,
      lastPhase: phase,
      phaseSince: now
    };
  }
  function trackPlotChord(now, fromPhase, phase) {
    const p = seg && seg.plot;
    if (!p) return;
    if (!p.phases) p.phases = {};
    if (!p.phaseMs) p.phaseMs = {};
    const to = phase || 'home';
    const from = fromPhase || to;
    p.phases[to] = (p.phases[to] || 0) + 1;
    if (from === to) return;
    p.transitions = (p.transitions || 0) + 1;
    p.phaseSeq.push(to);
    const since = Number(p.phaseSince) || now;
    p.phaseMs[from] = (p.phaseMs[from] || 0) + Math.max(0, now - since);
    p.phaseSince = now;
    p.lastPhase = to;
  }
  function finishPlotLog(current, now) {
    const p = current && current.plot;
    if (!p) return;
    const last = p.lastPhase || 'home';
    const since = Number(p.phaseSince) || now;
    p.phaseMs[last] = (p.phaseMs[last] || 0) + Math.max(0, now - since);
    p.phaseSince = now;
    const total = Object.keys(p.phaseMs).reduce((sum, key) => sum + (Number(p.phaseMs[key]) || 0), 0);
    const chords = Object.keys(p.phases).reduce((sum, key) => sum + (Number(p.phases[key]) || 0), 0);
    p.totalMs = Math.round(total);
    p.homeMs = Math.round(p.phaseMs.home || 0);
    p.homeShareMs = total ? Math.round((p.homeMs / total) * 1000) / 1000 : 0;
    p.chords = chords;
    p.homeShare = chords ? Math.round(((p.phases.home || 0) / chords) * 1000) / 1000 : 0;
  }
  // ===== P0a: телеметрия визита =====
  // Всё, что ниже, считается до проверки лимита событий. Поэтому даже визит
  // с overflow:true (4000 событий) сохраняет честные агрегаты: плотность,
  // длиннейший аккордовый run, гистограмму высот и последовательность ступеней.
  function newTiming() {
    return {
      firstEventAt: 0, lastEventAt: 0, lastNoteAt: null,
      activePlayMs: 0, tailMs: 0, playMs: 0,
      recordingDurationMs: null, recordingCoverage: null,
      recordingTruncated: false,
      notesPerSec: 0, chordChangesPerSec: 0
    };
  }
  function newFingerprint() {
    return {
      notePitchClasses: new Array(12).fill(0),
      chordPitchClasses: new Array(12).fill(0),
      pitchClasses: new Array(12).fill(0),
      octaves: {},
      velSum: 0, velCount: 0, panSum: 0, panCount: 0,
      meanVelocity: 0, meanPan: 0,
      chordSeq: [], transitions: {},
      uniquePcs: 0, uniqueChords: 0
    };
  }
  function newHints() {
    return { requested: 0, stuck: 0, shown: 0, picked: 0, ignored: 0 };
  }
  function roundMs(value) { return Math.max(0, Math.round(Number(value) || 0)); }
  function round2(value) { return Math.round((Number(value) || 0) * 100) / 100; }
  function round3(value) { return Math.round((Number(value) || 0) * 1000) / 1000; }
  // Время музыки. activePlayMs растёт только на коротких промежутках: пауза
  // «отойду на минуту» не делает визит плотнее, а tailMs показывает, сколько
  // игрок молчал после последней ноты до выхода из комбо.
  function trackMusicTime(now, isNote) {
    if (!seg) return;
    const timing = seg.timing;
    const t = roundMs(now - enterPerf);
    if (!timing.firstEventAt) timing.firstEventAt = t;
    if (lastMusicPerf) {
      const gap = Math.max(0, now - lastMusicPerf);
      if (gap <= ACTIVE_GAP_MS) timing.activePlayMs += gap;
    }
    lastMusicPerf = now;
    timing.lastEventAt = t;
    if (isNote) timing.lastNoteAt = t;
  }
  function fingerprintNote(midi, vel, pan) {
    if (!seg) return;
    const f = seg.fingerprint;
    const m = Math.max(0, Math.min(127, Math.round(Number(midi) || 0)));
    const pc = ((m % 12) + 12) % 12;
    f.notePitchClasses[pc] += 1;
    f.pitchClasses[pc] += 1;
    const oct = Math.floor(m / 12) - 1;
    f.octaves[oct] = (f.octaves[oct] || 0) + 1;
    const v = Number(vel);
    const p = Number(pan);
    if (Number.isFinite(v)) { f.velSum += clamp(v, 0, 1); f.velCount += 1; }
    if (Number.isFinite(p)) { f.panSum += clamp(p, -1, 1); f.panCount += 1; }
  }
  function fingerprintChord(h) {
    if (!seg || !h) return;
    const f = seg.fingerprint;
    (h.pcs || []).forEach(raw => {
      const pc = ((raw % 12) + 12) % 12;
      f.chordPitchClasses[pc] += 1;
      f.pitchClasses[pc] += 1;
    });
    const label = h.degree || h.name || '?';
    if (fingerChordDegree) {
      const key = fingerChordDegree + '>' + label;
      f.transitions[key] = (f.transitions[key] || 0) + 1;
    }
    fingerChordDegree = label;
    if (f.chordSeq.length < 64) f.chordSeq.push(label);
  }
  function chordRunKey(h) {
    return (h.pcs || []).slice().sort((a, b) => a - b).join(',');
  }
  function startChordRun(now, h, pcsKey) {
    runState = {
      id: (seg.runs.length || 0) + 1,
      startedPerf: now,
      startScore: state.score,
      pcsKey,
      degree: h.degree || '',
      name: h.name || '',
      chordHits: 1,
      notes: 0,
      lastEvent: null
    };
  }
  // Закрыть текущий run: агрегат живёт в seg.runs, а последнее событие run
  // получает runEndedBy. Так по JSON видно не только «был длинный run», но и
  // чем он закончился — сменой аккорда, паузой, переходом или выходом.
  function finishChordRun(now, endedBy) {
    if (!seg || !runState) return null;
    const run = runState;
    const durationMs = roundMs(now - run.startedPerf);
    const density = durationMs > 0 ? round2(run.notes / (durationMs / 1000)) : 0;
    const item = {
      runId: run.id,
      runIndex: (seg.runs.length || 0) + 1,
      degree: run.degree,
      name: run.name,
      pcsKey: run.pcsKey,
      startT: roundMs(run.startedPerf - enterPerf),
      durationMs,
      notes: run.notes,
      chordHits: run.chordHits,
      noteDensity: density,
      scoreDelta: Math.round(state.score - run.startScore),
      endedBy: endedBy || ''
    };
    if (run.lastEvent) run.lastEvent.runEndedBy = item.endedBy;
    seg.runs.push(item);
    if (durationMs > (seg.counts.longestChordRun || 0)) {
      seg.counts.longestChordRun = durationMs;
    }
    runState = null;
    return item;
  }
  // Итоговое время и сжатый отпечаток. Отпечаток переживает overflow: он
  // считается на лету, а не восстанавливается из усечённого events[].
  function finishTiming(current) {
    const timing = current.timing;
    timing.playMs = Math.max(0, Math.round(current.playMs || 0));
    timing.activePlayMs = roundMs(timing.activePlayMs);
    timing.tailMs = lastMusicPerf ? roundMs(performance.now() - lastMusicPerf) : 0;
    const activeSec = Math.max(0.001, timing.activePlayMs / 1000);
    timing.notesPerSec = round2((current.counts.notes || 0) / activeSec);
    timing.chordChangesPerSec = round2((current.counts.chordChanges || 0) / activeSec);
    const f = current.fingerprint;
    f.meanVelocity = f.velCount ? round2(f.velSum / f.velCount) : 0;
    f.meanPan = f.panCount ? round2(f.panSum / f.panCount) : 0;
    f.uniquePcs = f.pitchClasses.filter(n => n > 0).length;
    f.uniqueChords = new Set(f.chordSeq || []).size;
    const rec = current.recordingId && typeof recordingById === 'function'
      ? recordingById(current.recordingId) : null;
    if (rec) {
      timing.recordingDurationMs = roundMs(rec.duration);
      const events = Array.isArray(rec.events) ? rec.events : [];
      let first = -1, last = 0;
      events.forEach(ev => {
        const t = Math.max(0, Number(ev && ev.t) || 0);
        if (first < 0 || t < first) first = t;
        if (t > last) last = t;
      });
      const span = first >= 0 ? last - first : 0;
      timing.recordingCoverage = timing.playMs > 0
        ? round3(clamp(span / timing.playMs, 0, 1)) : 0;
      const maxEvents = typeof REC_MAX_EVENTS !== 'undefined' ? REC_MAX_EVENTS : 6000;
      const maxMs = typeof REC_MAX_MS !== 'undefined' ? REC_MAX_MS : 180000;
      timing.recordingTruncated = events.length >= maxEvents ||
        timing.recordingDurationMs >= maxMs;
    }
  }
  function moodReference(score, comment) {
    return score === 5 && REFERENCE_WORDS.test(String(comment || ''));
  }

  // Вход в комбо. Если сегмент уже открыт (прямой loadCombo), он сначала
  // закрывается: данные не должны теряться из-за обходного пути.
  function enterCombo() {
    if (!settings.enabled) {
      seg = null;
      return null;
    }
    if (seg) leaveCombo(pendingExit || 'load');
    if (!session) onSessionStart();
    const snap = comboSnapshot();
    visit += 1;
    seg = {
      id: 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      sessionId: session.id,
      visit,
      enteredAt: Date.now(),
      combo: snap.combo,
      station: snap.station,
      // Условия игры: по ним видно, что именно оценивал игрок — характер
      // станции, нотацию, октавы, форму, грув.
      context: {
        stationStyle: P.stationStyle,
        stationPlot: P.stationPlot,
        stationGesture: P.stationGesture,
        notation: P.notation,
        smartHand: !!P.smartHand,
        noteOct: P.noteOct,
        bassOct: P.bassOct,
        form: !!(state.form && state.form.enabled),
        formBpm: state.form && state.form.enabled
          ? (state.transport.bpm || P.formBpm) : null,
        formMeter: state.form && state.form.enabled
          ? (Number(state.transport.beatsPerBar) || Number(P.formMeter) || 4) : null,
        groove: typeof Groove !== 'undefined' && !!Groove.on
      },
      scoreStart: state.score,
      // id фоновой записи этого визита: карточка оценки сможет отдать в видео
      // именно сыгранное комбо, даже если в панели выбрана другая запись.
      recordingId: '',
      events: [],
      counts: { notes: 0, chords: 0, chordChanges: 0, longestChordRun: 0 },
      runs: [],
      timing: newTiming(),
      fingerprint: newFingerprint(),
      hints: newHints(),
      overflow: false
    };
    enterPerf = performance.now();
    lastMusicPerf = 0;
    runState = null;
    fingerChordDegree = '';
    seg.plot = initialPlotLog(enterPerf);
    // Если исследование включили посреди визита, авто-дорожка уже идёт:
    // подхватываем её id из recorder.js.
    if (typeof autoRecordStatus === 'function') {
      const active = autoRecordStatus();
      if (active && active.id) seg.recordingId = active.id;
    }
    playFromPerf = 0;
    pendingExit = '';
    return seg;
  }
  // loadCombo зовёт это сразу после autoRecordStart(): сегмент и запись
  // начинаются в один момент, поэтому карточка оценки знает точный адрес.
  function linkRecording(id) {
    const key = String(id || '');
    if (seg && key) seg.recordingId = key;
    return seg ? (seg.recordingId || '') : '';
  }
  // Выход из комбо. keepAsk нужен паузе: карточка оценки не должна исчезать
  // из-за ухода фокуса окна — пауза лишь останавливает её таймер.
  function leaveCombo(via, keepAsk) {
    if (!keepAsk) closeAsk(true);
    const current = seg;
    const reason = via || pendingExit || 'load';
    pendingExit = '';
    lastClosed = null;
    if (!current || !current.events.length) {
      seg = null;
      playFromPerf = 0;
      lastMusicPerf = 0;
      runState = null;
      fingerChordDegree = '';
      return null;
    }
    const leftPerf = performance.now();
    current.leftAt = Date.now();
    current.dwellMs = Math.max(0, Math.round(leftPerf - enterPerf));
    current.playFrom = playFromPerf ? Math.round(playFromPerf - enterPerf) : null;
    current.playMs = playFromPerf ? Math.max(0, Math.round(leftPerf - playFromPerf)) : 0;
    current.score = state.score;
    current.exit = { via: reason };
    current.rating = null;
    // Run и время считаются до обнуления seg: им нужны агрегаты и lastMusicPerf.
    finishChordRun(leftPerf, reason);
    finishTiming(current);
    finishPlotLog(current, leftPerf);
    seg = null;
    segments.push(current);
    saveSegments();
    lastClosed = current;
    playFromPerf = 0;
    lastMusicPerf = 0;
    runState = null;
    fingerChordDegree = '';
    paint();
    return current;
  }

  // ===== События игры =====
  // t — миллисекунды от входа в комбо: сегмент самодостаточен, и инструмент
  // анализа не зависит от абсолютного времени.
  function recordEvent(ev) {
    if (!seg) return false;
    if (!playFromPerf) playFromPerf = performance.now();
    if (seg.events.length >= MAX_EVENTS) {
      seg.overflow = true;
      return false;
    }
    ev.t = Math.max(0, Math.round(performance.now() - enterPerf));
    seg.events.push(ev);
    return true;
  }
  function onChord(h, vel, source) {
    if (!settings.enabled || !seg || !h || !h.pcs) return;
    const now = performance.now();
    const plotState = state.stationPlot || {};
    const fromPhase = plotState.lastPhase || '';
    const phase = plotState.phase || 'home';
    trackPlotChord(now, fromPhase, phase);
    trackMusicTime(now, false);
    fingerprintChord(h);
    const style = typeof stationPlotStyle === 'function' ? stationPlotStyle() : null;
    const pcsKey = chordRunKey(h);
    const changed = !runState || runState.pcsKey !== pcsKey;
    if (changed) {
      if (runState) finishChordRun(now, 'change');
      // Первый аккорд — не смена: chordChanges считает именно переходы.
      if ((seg.counts.chords || 0) > 0) seg.counts.chordChanges += 1;
      startChordRun(now, h, pcsKey);
    } else {
      runState.chordHits += 1;
    }
    const sinceChangeMs = roundMs(now - runState.startedPerf);
    const runDensity = sinceChangeMs > 0
      ? round2(runState.notes / (sinceChangeMs / 1000)) : 0;
    const event = {
      type: 'chord',
      degree: h.degree || '',
      name: h.name || '',
      kind: h.kind || '',
      tonic: !!h.tonic,
      rootPc: h.rootPc,
      pcs: h.pcs.slice(),
      // Сюжет: по этим полям tools/research.py считает переходы фаз и время
      // «дома». window — снимок того, что реально было под правой рукой.
      plot: plotState.archetype || '',
      phase,
      fromPhase,
      // Источник важен для анализа: экранная клавиатура/пэд и распознанный
      // с пианино аккорд звучат по-разному, хотя попадают в один визит.
      source: source === 'midi' ? 'midi' : 'keys',
      motif: style && style.motif ? style.motif : '',
      window: P.smartHand && state.adaptive && state.adaptive.window
        ? state.adaptive.window.slice() : [],
      vel: vel == null ? 1 : Math.round(clamp(vel, 0.05, 1) * 100) / 100,
      // Run одного аккорда: по нему анализ отличает «долго держу тепло» от
      // «застрял на одном аккорде». Поля пишутся даже при overflow.
      runId: runState.id,
      runIndex: runState.chordHits,
      chordChanged: changed,
      sinceChangeMs,
      runNotes: runState.notes,
      runChordHits: runState.chordHits,
      runNoteDensity: runDensity,
      runScoreDelta: Math.round(state.score - runState.startScore),
      runEndedBy: ''
    };
    // counts — честные музыкальные итоги, а events[] может быть усечён лимитом.
    seg.counts.chords += 1;
    if (recordEvent(event)) runState.lastEvent = event;
  }
  function onNote(midi, vel, pan, withChord) {
    if (!settings.enabled || !seg || midi == null) return;
    const now = performance.now();
    trackMusicTime(now, true);
    if (runState) runState.notes += 1;
    fingerprintNote(midi, vel, pan);
    seg.counts.notes += 1;
    recordEvent({
      type: 'note',
      midi: Math.round(midi),
      vel: vel == null ? 0.8 : Math.round(clamp(vel, 0.05, 1) * 100) / 100,
      pan: Math.round((pan == null ? 0 : clamp(pan, -1, 1)) * 100) / 100,
      phase: state.stationPlot ? state.stationPlot.phase : '',
      // Midi.noteOn зовёт onNote(..., false): это нота, которую игрок сыграл
      // на пианино. triggerBall с withChord=true — экранная клавиатура.
      source: withChord === false ? 'midi' : 'keys',
      withChord: withChord !== false
    });
  }

  // ===== Подсказки на карточках: события =====
  // Инлайн-подсказки сами ничего не играют. Они фиксируют, что было показано
  // (hintShown) и выбрал ли игрок подсвеченный аккорд (hintPicked). Старые
  // ключи requested/stuck/ignored остаются в схеме для совместимости данных.
  const HINT_KEYS = {
    hintRequested: 'requested', stuckMarked: 'stuck', hintShown: 'shown',
    hintPicked: 'picked', hintIgnored: 'ignored'
  };
  function compactHintMoves(moves) {
    return (moves || []).slice(0, 4).map(m => ({
      role: m.role || '',
      degree: m.degree || '',
      name: m.name || '',
      target: !!m.target
    }));
  }
  function logHint(type, data) {
    if (!settings.enabled || !seg || !type) return false;
    if (!seg.hints) seg.hints = newHints();
    const countKey = HINT_KEYS[type] || type;
    if (seg.hints[countKey] == null) seg.hints[countKey] = 0;
    seg.hints[countKey] += 1;
    // Подсказка до первой ноты не должна материализовать пустой визит.
    if (!seg.events.length) return false;
    const d = data || {};
    const event = {
      type: 'hint',
      hint: type,
      chord: String(d.chord || ''),
      played: String(d.played || ''),
      via: String(d.via || ''),
      target: d.target == null ? null : !!d.target,
      afterMs: d.afterMs == null ? null : roundMs(d.afterMs),
      moves: compactHintMoves(d.moves)
    };
    return recordEvent(event);
  }

  // ===== Эталонный профиль для компаса =====
  // Строится только из оценённых визитов (4–5 или явный reference). Если
  // эталон один и он в другой тональности, это гипотеза, а не перенос:
  // абсолютные ноты нельзя тащить в другую тональность. После трёх эталонов
  // ступени уже можно переносить, потому что «I → IV» значит одно и то же
  // в любой тональности.
  function segmentChordSeq(s) {
    const f = s && s.fingerprint;
    if (f && Array.isArray(f.chordSeq) && f.chordSeq.length) {
      return f.chordSeq.map(x => String(x || '?')).filter(Boolean).slice(0, 64);
    }
    return (s && Array.isArray(s.events) ? s.events : [])
      .filter(e => e && e.type === 'chord')
      .map(e => String(e.degree || e.name || '?'))
      .slice(0, 64);
  }
  function segmentKeyLabel(s) {
    const c = s && s.combo;
    return String((c && (c.keyNameLatin || c.keyName)) || '—');
  }
  function isStrictReference(s) {
    const r = (s && s.rating) || {};
    if (r.reference) return true;
    return moodReference(r.score, r.comment);
  }
  function profileWeight(s) {
    const r = (s && s.rating) || {};
    if (isStrictReference(s)) return 3;
    if (r.score === 5) return 2;
    if (r.score === 4) return 1;
    return 0;
  }
  function normalizeWeights(obj) {
    const total = Object.keys(obj).reduce((sum, key) => sum + (Number(obj[key]) || 0), 0);
    if (!total) return obj;
    const out = {};
    Object.keys(obj).forEach(key => {
      out[key] = Math.round(((Number(obj[key]) || 0) / total) * 1000) / 1000;
    });
    return out;
  }
  function referenceProfile(opts) {
    const o = opts || {};
    const current = o.combo || (typeof combo === 'function' ? combo() : null);
    const mode = o.mode || state.mode;
    const root = ((Number(o.root != null ? o.root : (current && current.root)) || 0) % 12 + 12) % 12;
    const rated = segments.filter(s => s && s.combo && profileWeight(s) > 0);
    const high = rated.filter(s => {
      const score = Number(s.rating && s.rating.score);
      return isStrictReference(s) || score >= 4;
    });
    const strong = high.filter(isStrictReference);
    const sameKey = high.filter(s => {
      const c = s.combo;
      return c && String(c.mode) === String(mode) &&
        ((Number(c.root) || 0) % 12 + 12) % 12 === root;
    });
    const transfer = sameKey.length ? 'same-key'
      : (high.length >= REF_TRANSFER_REFS ? 'degree' : 'hypothesis');
    const sources = transfer === 'same-key' ? sameKey : (transfer === 'degree' ? high : []);
    const degrees = {}, transitions = {};
    sources.forEach(s => {
      const w = profileWeight(s);
      const seq = segmentChordSeq(s);
      seq.forEach((degree, i) => {
        degrees[degree] = (degrees[degree] || 0) + w;
        if (i > 0) {
          const key = seq[i - 1] + '>' + degree;
          transitions[key] = (transitions[key] || 0) + w;
        }
      });
    });
    let pitchClasses = null;
    if (transfer === 'same-key') {
      const sum = new Array(12).fill(0);
      sameKey.forEach(s => {
        const f = s.fingerprint;
        if (!f || !Array.isArray(f.pitchClasses)) return;
        const total = f.pitchClasses.reduce((a, b) => a + (Number(b) || 0), 0);
        if (!total) return;
        const w = profileWeight(s);
        f.pitchClasses.forEach((n, pc) => {
          sum[pc] += ((Number(n) || 0) / total) * w;
        });
      });
      const pcTotal = sum.reduce((a, b) => a + b, 0);
      if (pcTotal) pitchClasses = sum.map(v => Math.round((v / pcTotal) * 1000) / 1000);
    }
    let label = '';
    if (transfer === 'same-key') {
      label = (strong.length ? 'эталон' : 'высокая оценка') + ' · ' + segmentKeyLabel(sameKey[0]);
    } else if (transfer === 'degree') {
      label = 'эталоны: ' + high.length + ' · по ступеням';
    } else if (high.length) {
      label = 'гипотеза · ' + segmentKeyLabel((strong[0] || high[0]));
    }
    return {
      visits: rated.length,
      highVisits: high.length,
      referenceVisits: strong.length,
      sameKeyVisits: sameKey.length,
      transfer,
      usable: !!sources.length,
      label,
      degrees: normalizeWeights(degrees),
      transitions: normalizeWeights(transitions),
      pitchClasses,
      keys: Array.from(new Set(high.map(segmentKeyLabel)))
    };
  }

  // ===== Карточка оценки =====
  // Подписи карточки в двух состояниях: до оценки и после. После оценки
  // карточка не закрывается: игрок успевает скачать видео этого комбо и
  // закрыть её кнопкой «Готово»/Space/Esc.
  const ASK_HINT = 'J I O P [ — оценка · Space / Esc — пропустить';
  const ASK_HINT_RATED = 'Можно сохранить видео, аудио, JSON или нажать «Готово»';
  function askMeta(s) {
    const sec = Math.max(1, Math.round((s.playMs || 0) / 1000));
    const key = P.notation === 'letters' ? s.combo.keyNameLatin : s.combo.keyName;
    return key + ' · ' + sec + ' с в комбо · ' + s.counts.notes + ' нот · ' + s.score + ' очков';
  }
  function paintAskState(s) {
    const score = s && s.rating && typeof s.rating.score === 'number'
      ? s.rating.score : 0;
    const kicker = $('researchAskKicker');
    const title = $('researchAskTitle');
    const hint = $('researchAskHint');
    const skipBtn = $('researchAskSkip');
    if (kicker) kicker.textContent = 'Комбо · оценка';
    if (score >= 1 && score <= 5) {
      if (title) title.textContent = 'Оценка сохранена · ' + score + '/5';
      if (hint) hint.textContent = ASK_HINT_RATED;
      if (skipBtn) skipBtn.textContent = 'Готово';
    } else {
      if (title) title.textContent = 'Как звучало комбо?';
      if (hint) hint.textContent = ASK_HINT;
      if (skipBtn) skipBtn.textContent = 'Пропустить';
    }
    document.querySelectorAll('#researchAsk [data-score]').forEach(btn => {
      const active = score >= 1 && parseInt(btn.dataset.score, 10) === score;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('selected', active);
    });
    paintAskButtons();
  }
  function commentEl() { return $('researchAskComment'); }
  function readComment() {
    const el = commentEl();
    if (!el) return '';
    return String(el.value || '').replace(/\s+/g, ' ').trim().slice(0, COMMENT_MAX);
  }
  function commentBusy() {
    const el = commentEl();
    return !!el && (document.activeElement === el || !!el.value.trim());
  }
  // Запись, к которой относится открытая карточка. Это не «выбранная в панели»
  // запись: оценка привязана к конкретному визиту через seg.recordingId.
  function askRecording() {
    if (!askSeg || !askSeg.recordingId) return null;
    return typeof recordingById === 'function'
      ? recordingById(askSeg.recordingId) : null;
  }
  // Кнопки экспорта живут рядом с оценкой, но не мешают ей: пока видео или WAV
  // собираются, карточка остаётся открытой, а её таймер стоит (holdAsk).
  function paintAskButtons() {
    paintAskVideo();
    paintAskAudio();
    paintAskJson();
    paintAskSuno();
  }
  // Suno — тот же WAV, но с английским промптом и переходом на suno.com/create.
  // Вся логика в js/suno.js; карточка только просит кнопку перерисоваться.
  function paintAskSuno() {
    if (typeof sunoPaint === 'function') sunoPaint();
  }
  function paintAskVideo() {
    const btn = $('researchAskVideo');
    if (!btn) return;
    const rec = askRecording();
    const available = !!rec && Array.isArray(rec.events) && rec.events.length > 0;
    const supported = typeof videoSupported === 'function' ? videoSupported() : false;
    const busy = exportBusy() || !!state.recording || !!state.recordingCountIn ||
      !!state.playingRecording;
    btn.disabled = !available || !supported || busy;
    btn.textContent = '⬇ Видео';
    if (!available) {
      btn.title = 'Запись этого комбо не сохранилась — включите автозапись станции.';
    } else if (!supported) {
      btn.title = 'Браузер не поддерживает запись видео.';
    } else if (busy) {
      btn.title = 'Дождитесь окончания записи или экспорта.';
    } else {
      btn.title = 'Сохранить это комбо как вертикальное видео 9:16 (WebM)';
    }
  }
  function paintAskAudio() {
    const btn = $('researchAskAudio');
    if (!btn) return;
    const rec = askRecording();
    const available = !!rec && Array.isArray(rec.events) && rec.events.length > 0;
    const supported = typeof audioSupported === 'function' ? audioSupported() : false;
    const busy = exportBusy() || !!state.recording || !!state.recordingCountIn ||
      !!state.playingRecording;
    btn.disabled = !available || !supported || busy;
    btn.textContent = '⬇ Аудио';
    if (!available) {
      btn.title = 'Запись этого комбо не сохранилась — включите автозапись станции.';
    } else if (!supported) {
      btn.title = 'Браузер не поддерживает запись аудио.';
    } else if (busy) {
      btn.title = 'Дождитесь окончания записи или экспорта.';
    } else {
      btn.title = 'Сохранить это комбо как WAV-файл';
    }
  }
  // JSON есть всегда, когда у визита есть события: автозапись — приятный
  // бонус, а не условие экспорта. Поэтому кнопка не зависит от recordingId.
  function paintAskJson() {
    const btn = $('researchAskJson');
    if (!btn) return;
    const ready = !!askSeg && Array.isArray(askSeg.events) && askSeg.events.length > 0;
    btn.disabled = !ready;
    btn.textContent = '⬇ JSON';
    btn.title = ready
      ? 'Скачать этот визит: ноты, аккорды, оценку и автозапись в JSON'
      : 'В этом комбо ещё нет данных для JSON';
  }
  function exportAskJson() {
    const s = askSeg;
    if (!s || !Array.isArray(s.events) || !s.events.length) {
      toast('В этом комбо ещё нет данных');
      paintAskButtons();
      return '';
    }
    const rec = askRecording();
    // Комментарий, уже набранный в карточке, должен попасть в файл так же, как
    // он попал бы в localStorage при «Готово». До оценки он идёт черновиком.
    let opts = null;
    if (s.rating) {
      s.rating.comment = readComment();
    } else {
      const draft = readComment();
      if (draft) opts = { commentDraft: draft };
    }
    const name = visitFileName(s);
    return saveJsonFile(name, exportVisitData(s, rec, opts), 'JSON комбо сохранён · ' + name);
  }
  // Связанные визиты выбранной записи: закрытые сегменты плюс открытая карточка,
  // если она относится к той же дорожке. Так ручная запись без визита остаётся
  // валидным файлом с пустым segments.
  function linkedSegmentsFor(rec) {
    const id = rec && rec.id;
    if (!id) return [];
    const out = segments.filter(s => s && s.recordingId === id);
    if (askSeg && askSeg.recordingId === id && !out.some(s => s.id === askSeg.id)) {
      out.push(askSeg);
    }
    return out;
  }
  function exportSelectedJson() {
    const rec = typeof selectedRecording === 'function' ? selectedRecording() : null;
    if (!rec) {
      toast('Запись не выбрана');
      return '';
    }
    const hasEvents = Array.isArray(rec.events) && rec.events.length > 0;
    const hasDrums = Array.isArray(rec.drums) && rec.drums.length > 0;
    if (!hasEvents && !hasDrums) {
      toast('В записи нет событий');
      return '';
    }
    if (exportBusy() || state.recording || state.recordingCountIn ||
        state.playingRecording) {
      toast('Дождитесь окончания записи или экспорта.');
      return '';
    }
    const name = recordingJsonName(rec);
    return saveJsonFile(name, exportRecordingData(rec, linkedSegmentsFor(rec)),
      'JSON записи сохранён · ' + name);
  }
  function exportAskVideo() {
    const rec = askRecording();
    if (!rec) {
      toast('Запись этого комбо не сохранилась');
      paintAskButtons();
      return '';
    }
    if (typeof startVideoExport !== 'function') {
      toast('Видео не поддерживается браузером');
      return '';
    }
    const job = startVideoExport(rec);
    paintAskButtons();
    return job;
  }
  function exportAskAudio() {
    const rec = askRecording();
    if (!rec) {
      toast('Запись этого комбо не сохранилась');
      paintAskButtons();
      return '';
    }
    if (typeof startAudioExport !== 'function') {
      toast('Аудио не поддерживается браузером');
      return '';
    }
    const job = startAudioExport(rec);
    paintAskButtons();
    return job;
  }
  function exportAskSuno() {
    const rec = askRecording();
    if (!rec) {
      toast('Запись этого комбо не сохранилась');
      paintAskButtons();
      return '';
    }
    if (typeof sunoStart !== 'function') {
      toast('Suno недоступен в этой сборке');
      return '';
    }
    const done = typeof sunoState === 'function' ? sunoState() : null;
    const ready = !!done && done.ready && done.id === rec.id;
    const result = ready && typeof sunoOpen === 'function'
      ? sunoOpen(rec) : sunoStart(rec);
    paintAskButtons();
    return result;
  }
  // Экспорт занимает реальное время, а автопропуск карточки — 12 секунд.
  // Пока файл собирается, таймер стоит; после — снова идёт с полным окном.
  function holdAsk(on) {
    askHeld = !!on;
    if (askHeld) stopTimer();
    else {
      paintAskButtons();
      armTimer();
    }
    return askHeld;
  }
  function stopTimer() {
    if (askTimer) {
      clearTimeout(askTimer);
      askTimer = 0;
    }
  }
  // Автопропуск не должен срабатывать, пока игрок пишет комментарий: поле
  // в фокусе или непустое — таймер стоит.
  function armTimer() {
    stopTimer();
    if (!askSeg || askHeld) return;
    // После сохранённой оценки автозакрытия нет: игрок решает сам, когда
    // закончить с видео и нажать «Готово».
    if (askSeg.rating && typeof askSeg.rating.score === 'number') return;
    if (commentBusy()) return;
    askTimer = setTimeout(() => {
      askTimer = 0;
      skip(true);
    }, ASK_MS);
  }
  function openAsk(s) {
    const el = $('researchAsk');
    if (!el || !s) return false;
    askSeg = s;
    askPerf = performance.now();
    const meta = $('researchAskMeta');
    const field = commentEl();
    if (meta) meta.textContent = askMeta(s);
    if (field) field.value = '';
    el.classList.add('show');
    el.setAttribute('aria-hidden', 'false');
    const card = $('researchAskCard');
    if (card && card.focus) card.focus();
    paintAskState(s);
    armTimer();
    return true;
  }
  function offerLast() {
    if (!settings.enabled || !settings.ask) return false;
    const s = lastClosed;
    if (!s || !s.events.length || s.rating) return false;
    return openAsk(s);
  }
  function closeAsk(storeSkip) {
    const el = $('researchAsk');
    const field = commentEl();
    const s = askSeg;
    if (s && storeSkip && !s.rating) {
      s.rating = {
        score: null,
        comment: readComment(),
        skipped: true,
        at: Date.now(),
        answerMs: Math.max(0, Math.round(performance.now() - askPerf))
      };
      saveSegments();
    }
    askSeg = null;
    stopTimer();
    askHeld = false;
    if (el) {
      el.classList.remove('show');
      el.setAttribute('aria-hidden', 'true');
    }
    if (field) field.value = '';
    paintAskButtons();
    paint();
    return !!s;
  }
  function rate(n) {
    const s = askSeg;
    if (!s) return false;
    const score = clamp(Math.round(n), 1, 5);
    const comment = readComment();
    s.rating = {
      score,
      comment,
      reference: moodReference(score, comment),
      at: Date.now(),
      answerMs: Math.max(0, Math.round(performance.now() - askPerf))
    };
    saveSegments();
    // Не закрываем карточку: следом игрок может сохранить видео этого комбо.
    // Повторная оценка просто обновит уже сохранённую.
    paintAskState(s);
    stopTimer();
    toast('Оценка сохранена: ' + score + '/5', 'good');
    return true;
  }
  function skip(silent) {
    const s = askSeg;
    if (!s) return false;
    const rated = !!(s.rating && typeof s.rating.score === 'number' &&
      s.rating.score >= 1 && s.rating.score <= 5);
    if (rated) {
      // «Готово» после оценки не должно затирать её пропуском; комментарий,
      // добавленный уже после оценки, всё равно сохраняем.
      if (commentEl()) s.rating.comment = readComment();
      if (s.rating.score === 5) {
        s.rating.reference = moodReference(s.rating.score, s.rating.comment);
      }
      saveSegments();
    } else {
      s.rating = {
        score: null,
        comment: readComment(),
        skipped: true,
        at: Date.now(),
        answerMs: Math.max(0, Math.round(performance.now() - askPerf))
      };
      saveSegments();
    }
    closeAsk(false);
    if (!silent && !rated) toast('Оценка пропущена');
    return true;
  }

  // ===== Клавиатура карточки =====
  // input.js спрашивает gateKey() до всех игровых команд. Пока карточка
  // открыта, J I O P [ — оценки, Space/Esc — пропуск, а в поле комментария
  // те же клавиши остаются обычными буквами (target — input, поэтому
  // возвращаем false и не мешаем печати).
  function gateKey(e) {
    if (!askSeg || !e) return false;
    const el = $('researchAsk');
    if (!el || !el.classList.contains('show')) return false;
    const field = commentEl();
    const typing = !!field && (e.target === field || document.activeElement === field);
    if (e.code === 'Escape') {
      e.preventDefault();
      if (!e.repeat) skip();
      return true;
    }
    if (typing) {
      // Enter в поле заканчивает ввод: фокус уходит, и J..[ снова оценки.
      if (e.code === 'Enter') {
        e.preventDefault();
        field.blur();
        return true;
      }
      return false;
    }
    if (e.code === 'Space') {
      // Автоповтор удержанного пробела не должен мгновенно пропустить карточку.
      e.preventDefault();
      if (!e.repeat) skip();
      return true;
    }
    const score = RATE_KEYS[e.code];
    if (score != null) {
      e.preventDefault();
      if (!e.repeat) rate(score);
      return true;
    }
    return false;
  }

  // ===== Экспорт =====
  // В файл попадает не только история, но и таблицы, по которым она звучала:
  // характер станции и библиотека комбо. Через месяц данные можно разобрать,
  // даже если STATION_STYLES успели поменять.
  function comboCatalogue() {
    const out = { major: [], minor: [] };
    ['major', 'minor'].forEach(mode => {
      (typeof ORDER !== 'undefined' ? ORDER[mode] : []).forEach(id => {
        const c = COMBOS[id];
        if (!c) return;
        out[mode].push({
          id: c.id, mode: c.mode, keyName: c.keyName,
          keyNameLatin: c.keyNameLatin, root: c.root,
          degrees: (c.degrees || []).slice(),
          chords: (c.chords || []).map(ch => ch.slice()),
          triads: (c.triads || []).map(t => t.slice())
        });
      });
    });
    return out;
  }
  function cloneJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }
  // Общая часть всех JSON-файлов: таблицы, по которым звучала история. Через
  // месяц данные можно разобрать, даже если STATION_STYLES успели поменять.
  function exportBase() {
    const styles = typeof STATION_STYLES !== 'undefined' ? STATION_STYLES : [];
    const touch = typeof STATION_TOUCH !== 'undefined' ? STATION_TOUCH : {};
    const plots = typeof STATION_PLOT_ARCHETYPES !== 'undefined' ? STATION_PLOT_ARCHETYPES : {};
    const plotByStyle = typeof STATION_PLOT_BY_STYLE !== 'undefined' ? STATION_PLOT_BY_STYLE : {};
    const gestures = typeof STATION_GESTURES !== 'undefined' ? STATION_GESTURES : {};
    const plotGestures = typeof STATION_PLOT_GESTURES !== 'undefined' ? STATION_PLOT_GESTURES : {};
    return {
      schema: SCHEMA,
      app: 'HARMONIA',
      exportedAt: new Date().toISOString(),
      settings: { enabled: !!settings.enabled, ask: !!settings.ask, version: SETTINGS_VERSION },
      stationStyles: cloneJson(styles),
      stationTouch: cloneJson(touch),
      stationGestures: cloneJson(gestures),
      stationPlotGestures: cloneJson(plotGestures),
      // Таблицы сюжета — рядом с характерами: старые сегменты можно разобрать,
      // даже если архетипы или их привязка к станциям успели измениться.
      stationPlots: cloneJson(plots),
      stationPlotByStyle: cloneJson(plotByStyle),
      combos: comboCatalogue()
    };
  }
  function exportData() {
    return Object.assign(exportBase(), {
      segments: segments.map(cloneJson)
    });
  }
  // Файл одного визита: карточка оценки скачивает именно его, не дожидаясь,
  // пока в localStorage накопится вся история. recordingMissing помогает
  // отличить «автозапись отключена» от «автозапись потерялась».
  function exportVisitData(s, rec, opts) {
    const visit = s && typeof s === 'object' ? cloneJson(s) : null;
    const out = exportBase();
    out.exportScope = 'visit';
    out.segments = visit ? [visit] : [];
    out.recording = rec ? cloneJson(rec) : null;
    out.recordingMissing = !!(visit && visit.recordingId &&
      (!rec || rec.id !== visit.recordingId));
    if (opts && opts.commentDraft) {
      out.commentDraft = String(opts.commentDraft)
        .replace(/\s+/g, ' ').trim().slice(0, COMMENT_MAX);
    }
    return out;
  }
  // Файл записи: ручная запись может быть не связана ни с одним визитом,
  // поэтому segments — честный массив (иногда пустой), а не выдуманный сегмент.
  function exportRecordingData(rec, linked) {
    const out = exportBase();
    out.exportScope = 'recording';
    out.segments = Array.isArray(linked) ? linked.filter(Boolean).map(cloneJson) : [];
    out.recording = rec ? cloneJson(rec) : null;
    out.recordingMissing = false;
    return out;
  }
  function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function slugPart(value, fallback) {
    const text = String(value == null ? '' : value).toLowerCase()
      .replace(/♭/g, 'b').replace(/♯/g, 'sharp')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return text.slice(0, 24) || fallback;
  }
  function visitFileName(s) {
    const c = (s && s.combo) || {};
    const id = c.id == null ? 'combo' : String(c.id).padStart(2, '0');
    return 'harmonia-combo-' + slugPart(id, 'combo') + '-' +
      slugPart(c.keyNameLatin || c.keyName, 'key') + '-' + stamp() + '.json';
  }
  function recordingJsonName(rec) {
    // Общая база с MIDI/WAV/видео: «D major · … .json».
    return typeof recordingFileName === 'function'
      ? recordingFileName(rec, 'json')
      : 'harmonia-recording-' + stamp() + '.json';
  }
  function saveJsonFile(name, payload, okMessage) {
    try {
      const text = JSON.stringify(payload, null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast(okMessage || 'JSON сохранён', 'good');
      return name;
    } catch (e) {
      // Очень старый браузер без Blob: данные всё равно остаются в localStorage.
      if (typeof console !== 'undefined') console.warn('research: json download failed', e);
      toast('JSON не удалось сохранить');
      return '';
    }
  }
  function download() {
    const name = 'harmonia-research-' + stamp() + '.json';
    return saveJsonFile(name, exportData(), 'Файл исследования сохранён · ' + name);
  }

  // ===== Запуск =====
  // Очистка — в два нажатия: первый клик только взводит кнопку.
  function clearClick() {
    const now = performance.now();
    const btn = $('researchClear');
    if (now - clearArmedAt > 4000) {
      clearArmedAt = now;
      if (btn) btn.textContent = 'Ещё раз — очистить';
      setTimeout(paint, 4200);
      return;
    }
    clearArmedAt = 0;
    clear();
    toast('Данные исследования очищены');
  }

  function initResearch() {
    loadSettings();
    loadSegments();
    const ask = $('researchAsk');
    const field = commentEl();
    if (field) {
      field.addEventListener('focus', stopTimer);
      field.addEventListener('blur', armTimer);
      field.addEventListener('input', () => {
        if (field.value.length > COMMENT_MAX) field.value = field.value.slice(0, COMMENT_MAX);
        armTimer();
      });
    }
    if (ask) {
      // Клик по затемнению — такой же пропуск, как Space.
      ask.addEventListener('click', (e) => { if (e.target === ask) skip(); });
      ask.querySelectorAll('[data-score]').forEach(btn => {
        btn.addEventListener('click', () => rate(parseInt(btn.dataset.score, 10)));
      });
      const skipBtn = $('researchAskSkip');
      if (skipBtn) skipBtn.addEventListener('click', () => skip());
      const videoBtn = $('researchAskVideo');
      if (videoBtn) videoBtn.addEventListener('click', exportAskVideo);
      const audioBtn = $('researchAskAudio');
      if (audioBtn) audioBtn.addEventListener('click', exportAskAudio);
      const jsonBtn = $('researchAskJson');
      if (jsonBtn) jsonBtn.addEventListener('click', exportAskJson);
      const sunoBtn = $('researchAskSuno');
      if (sunoBtn) sunoBtn.addEventListener('click', exportAskSuno);
    }
    const toggle = $('researchToggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        if (settings.enabled) disable();
        else enable({ open: true });
      });
    }
    const askToggle = $('researchAskToggle');
    if (askToggle) askToggle.addEventListener('click', () => setAsk(!settings.ask));
    const exportBtn = $('researchExport');
    if (exportBtn) exportBtn.addEventListener('click', download);
    const clearBtn = $('researchClear');
    if (clearBtn) clearBtn.addEventListener('click', clearClick);
    // Панель записи: тот же JSON, но для выбранной дорожки и связанных визитов.
    const recJson = $('recJson');
    if (recJson) recJson.addEventListener('click', exportSelectedJson);
    // Фокус окна: таймер карточки не должен тикать, пока игрок отошёл.
    window.addEventListener('blur', stopTimer);
    window.addEventListener('focus', armTimer);
    // Закрытие вкладки не должно терять уже сыгранный визит: pagehide успевает
    // записать localStorage синхронно, в отличие от асинхронного beforeunload.
    window.addEventListener('pagehide', () => {
      if (seg || askSeg) leaveCombo('unload');
    });
    // Возврат из bfcache: состояние игры сохранилось, а сегмент закрыт pagehide.
    window.addEventListener('pageshow', (e) => {
      if (e.persisted && settings.enabled && state.started && state.running &&
          !state.paused && !seg) enterCombo();
    });
    // ?research=1 включает сбор, ?research=0 — выключает, не трогая уже
    // собранные данные. Без параметра действует сохранённый выбор (по умолчанию вкл).
    const m = /[?&]research=(1|0|on|off|true|false)/i.exec(location.search);
    if (m && /^(1|on|true)$/i.test(m[1])) enable({ ask: true, open: true });
    else if (m) disable();
    paint();
  }
  initResearch();

  return {
    // Настройки
    enable, disable, setAsk, clear,
    // Жизненный цикл посещения и события — их зовут game.js/midi.js
    onSessionStart, exitHint, enterCombo, leaveCombo, linkRecording, onChord, onNote,
    // Компас: события подсказок и эталонный профиль для js/guide.js.
    logHint, referenceProfile, moodReference,
    dataVersion: () => dataVersion,
    // Карточка
    offerLast, gateKey, rate, skip, askRecording, exportAskVideo, exportAskAudio,
    exportAskJson, exportAskSuno, holdAsk, refreshAsk: paintAskButtons,
    // Данные
    status, totals, exportData, exportVisitData, exportRecordingData, download,
    exportSelectedJson, visitFileName, recordingJsonName, paint,
    // Лимиты пригодятся инструменту анализа и тестам
    limits: { askMs: ASK_MS, commentMax: COMMENT_MAX, maxSegments: MAX_SEGMENTS,
      maxEvents: MAX_EVENTS, maxBytes: MAX_BYTES }
  };
})();
