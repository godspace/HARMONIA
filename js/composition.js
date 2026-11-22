/* HARMONIA · js/composition.js — необязательная форма поверх джема
   Форма не заставляет играть последовательность: она даёт часы, секции и
   мягкие цели по тактам. Игрок может игнорировать цели — джем остаётся джемом,
   а очки формы лишь отмечают, как сыграна драматургия. */

const Composition = {
  totalBars() {
    return Math.max(1, Math.round(Number(CFG.composition.bars) || 16));
  },

  sectionForBar(bar) {
    const n = Math.max(1, Math.round(Number(bar) || 1));
    const sections = CFG.composition.sections;
    return sections.find(s => n >= s.from && n <= s.to) || sections[sections.length - 1];
  },

  // Цель такта берём из плана текущего лада. При смене лада или комбо
  // функция просто вернёт аккорд из актуальной диатонической палитры.
  targetForBar(bar) {
    const plan = CFG.composition.plans[state.mode] || CFG.composition.plans.major;
    const n = Math.max(1, Math.min(plan.length, Math.round(Number(bar) || 1)));
    const degree = plan[n - 1];
    const palette = diatonicPalette();
    return palette.find(h => h.degree === degree) || palette[0];
  },

  start() {
    if (!state.started) return false;
    this.stop();
    state.form.enabled = true;
    state.form.running = true;
    state.form.phase = P.formCountIn > 0 ? 'countin' : 'playing';
    state.form.bar = 0;
    state.form.beat = 0;
    state.form.countInBeat = 0;
    state.form.sectionId = null;
    state.form.sectionLabel = '';
    state.form.barChord = null;
    state.form.barHadChord = false;
    state.form.barTargetHit = false;
    state.form.stats = null;
    state.form.summaries = [];
    state.form.points = 0;
    state.form.lastAward = null;
    this.resetMelody();
    this.hideResult();
    // Перезапуск из панели идёт не через setFormEnabled(), поэтому полосу
    // тактов чистим здесь: иначе «done» прошлой пьесы остаются на новой.
    if (typeof resetFormHud === 'function') resetFormHud();

    const bpb = Number(P.formMeter) === 3 ? 3 : 4;
    const bars = this.totalBars();
    Transport.start({
      bpm: P.formBpm,
      beatsPerBar: bpb,
      countInBeats: Math.max(0, Number(P.formCountIn) || 0) * bpb,
      lengthBeats: bars * bpb,
      metronome: !!P.formMetronome,
      onBeat: beat => Composition.onBeat(beat),
      onEnd: () => Composition.finishPiece()
    });
    this.updateHUD();
    return true;
  },

  restart() {
    return this.start();
  },

  stop(disable) {
    if (typeof Transport !== 'undefined') Transport.stop();
    state.form.running = false;
    state.form.phase = disable ? 'off' : 'idle';
    state.form.stats = null;
    state.form.bar = 0;
    state.form.beat = 0;
    state.form.countInBeat = 0;
    state.form.sectionId = null;
    state.form.sectionLabel = '';
    state.form.barChord = null;
    state.form.barHadChord = false;
    state.form.barTargetHit = false;
    if (disable) {
      state.form.enabled = false;
      this.resetMelody();
      this.hideResult();
    }
    this.updateHUD();
  },

  onSessionStart() {
    if (state.form.enabled) this.start();
    else this.stop(false);
  },

  setPaused(paused) {
    if (!state.form.running) return;
    if (paused) {
      state.form.phase = 'paused';
      Transport.pause();
    } else {
      state.form.phase = state.form.bar >= 1 ? 'playing' : 'countin';
      Transport.resume();
    }
    this.updateHUD();
  },

  onBeat(beat) {
    if (!state.form.enabled || !state.form.running) return;
    if (beat < 0) {
      const count = Math.max(0, Math.min(Transport.countInBeats, beat + Transport.countInBeats));
      state.form.phase = 'countin';
      state.form.countInBeat = count + 1;
      state.form.beat = 0;
      this.updateHUD();
      return;
    }

    const bpb = Transport.beatsPerBar;
    const bar = Math.floor(beat / bpb) + 1;
    if (bar > this.totalBars()) return;

    if (bar !== state.form.bar) {
      const prev = state.form.bar;
      if (prev >= 1) this.finishBar(prev);
      state.form.bar = bar;
      state.form.beat = beat % bpb + 1;
      state.form.barChord = null;
      state.form.barHadChord = false;
      state.form.barTargetHit = false;

      const section = this.sectionForBar(bar);
      if (section.id !== state.form.sectionId) {
        if (state.form.sectionId) this.finishSection(state.form.sectionId);
        this.beginSection(section);
      }
      state.form.phase = 'playing';
      this.accentBeat();
    } else {
      state.form.beat = beat % bpb + 1;
    }
    this.updateHUD();
  },

  resetMelody() {
    // Set не сериализуется, но живёт только в state: экран результата читает
    // готовое число ступеней. Новая пьеса всегда начинает мелодию с нуля.
    state.form.melody = { notes: 0, noteMin: null, noteMax: null, pcs: new Set() };
  },

  // Вызывается из game.triggerBall() и Midi.noteOn() только для живой игры.
  // Во время отсчёта, паузы и прослушивания записи нот не считаем.
  onNote(midi, vel) {
    if (state.replay) return;
    if (!state.form.enabled || !state.form.running || state.form.phase !== 'playing') return;
    const n = Math.round(Number(midi));
    if (!Number.isFinite(n)) return;
    const pc = ((n % 12) + 12) % 12;
    const melody = state.form.melody;
    melody.notes += 1;
    melody.noteMin = melody.noteMin == null ? n : Math.min(melody.noteMin, n);
    melody.noteMax = melody.noteMax == null ? n : Math.max(melody.noteMax, n);
    melody.pcs.add(pc);

    const st = state.form.stats;
    if (!st) return;
    st.notes += 1;
    st.noteMin = st.noteMin == null ? n : Math.min(st.noteMin, n);
    st.noteMax = st.noteMax == null ? n : Math.max(st.noteMax, n);
    st.notePcs.add(pc);
  },

  // Вызывается из game.chordEvent() только для живого ввода, не для replay.
  onChord(h) {
    if (!h || !state.form.enabled || !state.form.running || state.form.phase !== 'playing') return;
    const bar = state.form.bar;
    if (bar < 1 || !state.form.stats) return;

    const pcsKey = h.pcsKey || (h.pcs ? h.pcs.slice().sort((a, b) => a - b).join(',') : '');
    const snapshot = {
      degree: h.degree || '',
      name: h.name || '',
      hint: h.hint || '',
      tonic: !!h.tonic,
      rootPc: h.rootPc,
      pcsKey
    };
    state.form.barChord = snapshot;
    state.form.barHadChord = true;
    state.form.stats.chords += 1;
    state.form.stats.lastChord = snapshot;
    if (!state.form.stats.firstChord) state.form.stats.firstChord = snapshot;
    if (pcsKey) state.form.stats.unique.add(pcsKey);

    const target = this.targetForBar(bar);
    if (!state.form.barTargetHit && target && snapshot.degree === target.degree) {
      state.form.barTargetHit = true;
      state.form.stats.hits += 1;
      this.award(CFG.composition.targetBonus, 'цель ' + target.degree, snapshot);
    }
    this.updateHUD();
  },

  beginSection(section) {
    state.form.sectionId = section.id;
    state.form.sectionLabel = section.label;
    state.form.stats = {
      firstChord: null, lastChord: null,
      chords: 0, hits: 0, playedBars: 0,
      unique: new Set(),
      notes: 0, noteMin: null, noteMax: null, notePcs: new Set()
    };
  },

  finishBar(bar) {
    const st = state.form.stats;
    if (!st) return;
    if (state.form.barHadChord) st.playedBars += 1;
    if (state.form.barChord) st.lastChord = state.form.barChord;
    st.lastBar = bar;
  },

  finishSection(sectionId) {
    const st = state.form.stats;
    const section = CFG.composition.sections.find(s => s.id === sectionId);
    if (!section || !st) return;
    if (state.form.summaries.some(s => s.id === sectionId)) return;

    const totalBars = section.to - section.from + 1;
    let bonus = 0;
    if (st.chords > 0) {
      bonus += CFG.composition.sectionDone;
      if (st.hits >= Math.ceil(totalBars / 2)) bonus += CFG.composition.sectionTarget;
      if (st.unique.size >= 3) bonus += CFG.composition.sectionVariety;
      if (section.id === 'coda') {
        if (st.lastChord && st.lastChord.tonic) bonus += CFG.composition.finalTonic;
        else if (st.lastChord && st.lastChord.hint === 'доминанта') bonus += CFG.composition.finalDominant;
      }
    }

    const summary = {
      id: section.id,
      label: section.label,
      from: section.from,
      to: section.to,
      bars: totalBars,
      chords: st.chords,
      playedBars: st.playedBars,
      hits: st.hits,
      unique: st.unique.size,
      notes: st.notes,
      noteMin: st.noteMin,
      noteMax: st.noteMax,
      notePcs: st.notePcs.size,
      targetPoints: st.hits * CFG.composition.targetBonus,
      bonus,
      points: st.hits * CFG.composition.targetBonus + bonus
    };
    state.form.summaries.push(summary);
    if (bonus > 0) this.award(bonus, section.label + ' · форма', null);
    this.updateHUD();
  },

  finishPiece() {
    if (!state.form.enabled || state.form.phase === 'done') return;
    if (state.form.bar >= 1) this.finishBar(state.form.bar);
    if (state.form.sectionId) this.finishSection(state.form.sectionId);
    state.form.running = false;
    state.form.phase = 'done';
    state.form.stats = null;
    Transport.stop();
    this.updateHUD();
    if (typeof showFormResult === 'function') showFormResult();
    toast('Пьеса завершена · форма +' + state.form.points, 'good');
  },

  award(points, label, chord) {
    if (!(points > 0) || state.replay) return;
    if (typeof addScore === 'function') addScore(points);
    else state.score += points;
    state.form.points += points;
    state.form.lastAward = { points, label, at: performance.now() };
    const scoreEl = document.getElementById('scoreVal');
    if (scoreEl) scoreEl.textContent = state.score;
    if (chord && typeof balls !== 'undefined' && Array.isArray(balls) &&
        typeof motes !== 'undefined' && Array.isArray(motes)) {
      const pc = ((chord.rootPc % 12) + 12) % 12;
      const b = balls.find(ball => ball.pc === pc);
      if (b) {
        motes.push({ x: b.x, y: b.y, text: '+' + points, color: b.color, start: performance.now() });
        b.radius = Math.max(b.radius || 0, 18);
      }
    }
  },

  accentBeat() {
    const el = document.getElementById('formHud');
    if (!el) return;
    el.classList.remove('beat');
    void el.offsetWidth;
    el.classList.add('beat');
  },

  hideResult() {
    if (typeof hideFormResult === 'function') hideFormResult();
  },

  updateHUD() {
    if (typeof updateFormHUD === 'function') updateFormHUD();
  }
};
