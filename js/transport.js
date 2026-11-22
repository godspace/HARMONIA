/* HARMONIA · js/transport.js — часы необязательной формы
   Модуль не запускается в свободном джеме. Transport хранит только время,
   отсчёт и метроном; музыкальную драматургию и очки ведёт composition.js.
   Визуальное время берём из performance.now(), а тики планируем по часам
   AudioContext, чтобы метроном не зависел от частоты кадров. */

const Transport = {
  running: false,
  paused: false,
  bpm: 84,
  beatsPerBar: 4,
  countInBeats: 0,
  lengthBeats: 0,
  metronome: true,
  onBeat: null,
  onEnd: null,
  _t0: 0,
  _nextClick: 0,
  _lastBeat: null,
  _pausedPos: 0,

  _spb() { return 60 / Math.max(30, this.bpm); },
  _now() { return performance.now() / 1000; },
  _pos() { return (this._now() - this._t0) / this._spb(); },

  start(opts) {
    const o = opts || {};
    this.stop();
    initAudio();
    this.bpm = clamp(Number(o.bpm) || P.formBpm || 84, 40, 200);
    this.beatsPerBar = Number(o.beatsPerBar) === 3 ? 3 : 4;
    this.countInBeats = Math.max(0, Math.round(Number(o.countInBeats) || 0));
    this.lengthBeats = Math.max(1, Math.round(Number(o.lengthBeats) || 0));
    this.metronome = o.metronome !== false;
    this.onBeat = typeof o.onBeat === 'function' ? o.onBeat : null;
    this.onEnd = typeof o.onEnd === 'function' ? o.onEnd : null;
    this._t0 = this._now();
    this._nextClick = -this.countInBeats;
    this._lastBeat = null;
    this._pausedPos = 0;
    this.running = true;
    this.paused = false;
    state.transport.running = true;
    state.transport.paused = false;
    this.update();
  },

  // Вызывается каждый кадр из render.js, пока сессия live и не на паузе.
  // Возвращает true, если часы всё ещё идут.
  update() {
    if (!this.running || this.paused) return false;
    const now = this._now();
    const pieceBeat = this._pos() - this.countInBeats;
    this._syncState(pieceBeat);

    if (pieceBeat >= this.lengthBeats) {
      // Кадр мог перескочить последнюю долю (вкладка была неактивна).
      // Доводим её до конца, затем честно останавливаем часы.
      this._dispatch(this.lengthBeats - 0.000001);
      this.running = false;
      state.transport.running = false;
      state.transport.phase = 'idle';
      const done = this.onEnd;
      if (done) done();
      return false;
    }

    this._dispatch(pieceBeat);
    if (!this.running) return false;
    this._scheduleClicks(now, pieceBeat);
    return true;
  },

  _syncState(pieceBeat) {
    const beat = Math.floor(pieceBeat + 0.0000001);
    const bpb = this.beatsPerBar;
    const inBar = beat < 0 ? -1 : ((beat % bpb) + bpb) % bpb;
    state.transport.bpm = this.bpm;
    state.transport.beatsPerBar = bpb;
    state.transport.bar = beat < 0 ? 0 : Math.floor(beat / bpb) + 1;
    state.transport.beat = beat < 0 ? 0 : inBar + 1;
    state.transport.beatInBar = inBar;
    state.transport.countIn = Math.max(0, Math.min(this.countInBeats, -beat));
    state.transport.phase = this.paused ? 'paused' : (beat < 0 ? 'countin' : 'playing');
  },

  _dispatch(pieceBeat) {
    const current = Math.floor(pieceBeat + 0.0000001);
    if (this._lastBeat == null) this._lastBeat = current - 1;
    while (this.running && this._lastBeat < current) {
      this._lastBeat += 1;
      if (this.onBeat) this.onBeat(this._lastBeat);
    }
  },

  _scheduleClicks(now, pieceBeat) {
    if (!this.metronome || !audioCtx) return;
    const current = Math.floor(pieceBeat + 0.0000001);
    // Если метроном включили позже, не пытаемся «догнать» пропущенные доли.
    if (this._nextClick < current) this._nextClick = current;
    const horizon = 0.12;
    const spb = this._spb();
    let guard = 0;
    while (guard++ < 8) {
      const wall = this._t0 + (this._nextClick + this.countInBeats) * spb;
      if (wall > now + horizon) break;
      if (wall >= now - 0.04) {
        const accent = ((this._nextClick % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar === 0;
        metronomeClick(audioCtx.currentTime + Math.max(0, wall - now), accent);
      }
      this._nextClick += 1;
    }
  },

  pause() {
    if (!this.running || this.paused) return;
    this._pausedPos = this._pos();
    this.paused = true;
    state.transport.paused = true;
    state.transport.phase = 'paused';
  },

  resume() {
    if (!this.running || !this.paused) return;
    this._t0 = this._now() - this._pausedPos * this._spb();
    this.paused = false;
    this._nextClick = Math.floor(this._pausedPos - this.countInBeats + 0.0000001) + 1;
    state.transport.paused = false;
    state.transport.phase = 'playing';
    this.update();
  },

  setBpm(value) {
    const next = clamp(Number(value) || 84, 40, 200);
    if (next === this.bpm) return;
    if (this.running) {
      const pos = this.paused ? this._pausedPos : this._pos();
      this.bpm = next;
      this._t0 = this._now() - pos * this._spb();
      if (this.paused) this._pausedPos = pos;
      this._nextClick = Math.floor(pos - this.countInBeats + 0.0000001) + 1;
    } else {
      this.bpm = next;
    }
    state.transport.bpm = this.bpm;
  },

  setMetronome(on) {
    this.metronome = !!on;
    if (this.metronome && this.running && !this.paused) {
      this._nextClick = Math.floor(this._pos() - this.countInBeats + 0.0000001) + 1;
    }
  },

  stop() {
    this.running = false;
    this.paused = false;
    this.onBeat = null;
    this.onEnd = null;
    state.transport.running = false;
    state.transport.paused = false;
    state.transport.bar = 0;
    state.transport.beat = 0;
    state.transport.beatInBar = -1;
    state.transport.countIn = 0;
    state.transport.phase = 'idle';
  }
};
