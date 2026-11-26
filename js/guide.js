/* HARMONIA · js/guide.js — инлайн-подсказки на карточках аккордов (P0c)
   Модуль без сборки: подключается <script> в index.html после research.js.
   Отдельного меню и клавиши H больше нет: игрок держит аккорд правой рукой,
   левой ищет бас, а карточки уже стоят перед глазами. Guide только красит
   названия нот по роли для баса и отмечает следующий аккорд. Это не генератор
   мелодии и не автопилот: ничего не звучит без нажатия игрока.
   Все решения объяснимы: общие тоны, функция, тяготение, недавний повтор и
   эталонный профиль из Research.
   Все модули делят глобальную область — имена функций/констант уникальны. */

var Guide = (function () {
  'use strict';

  const CFG_G = (typeof CFG !== 'undefined' && CFG.guide) || {};
  const MAX_MOVES = Math.max(2, Math.min(3, Number(CFG_G.maxMoves) || 3));
  const ROLE_LABEL = {
    hold: 'Держать тепло',
    develop: 'Развить',
    contrast: 'Контраст'
  };
  const BASS_LABEL = {
    root: 'корень аккорда',
    tone: 'тон аккорда',
    color: 'мягкая краска',
    clash: 'трение',
    outside: 'вне лада'
  };
  // «Тёплые» ступени: отсюда компас держит поле, а не тащит в каденцию.
  // V/vii° не входят в hold: их место — в «Развить», и только как один из
  // вариантов, а не как единственный «правильный» ход.
  const HOLD_DEGREES = {
    major: ['I', 'ii', 'iii', 'IV', 'vi'],
    minor: ['i', 'III', 'iv', 'VI']
  };

  let moves = [];
  let next = null;
  let profileCache = null;
  let profileKey = '';
  let lastSig = '';
  let lastCue = '';

  function mod12(value) {
    return ((Number(value) % 12) + 12) % 12;
  }
  function tr(s) {
    return typeof I18N !== 'undefined' && I18N.enabled() &&
      typeof I18N.text === 'function' ? I18N.text(s) : String(s == null ? '' : s);
  }
  function currentChord() {
    const act = state.harmony && state.harmony.lastTriad;
    return act && Array.isArray(act.pcs) && act.pcs.length ? act : null;
  }
  function heldPcs() {
    if (typeof Heard === 'undefined') return [];
    if (typeof Heard.heldPcs === 'function') {
      const held = Heard.heldPcs();
      if (held && held.length) return held;
    }
    return state.heard && Array.isArray(state.heard.pcs) ? state.heard.pcs.slice() : [];
  }
  // Активный бас — самая низкая зажатая/залипшая MIDI-нота. Правая рука
  // обычно выше, поэтому это именно левая. Без MIDI подсветки нет: клик по
  // карточке не должен выдавать её корень за «взятую» басовую ноту.
  function activeBassPc() {
    if (typeof Heard === 'undefined' || typeof Heard.midis !== 'function') return null;
    const midis = Heard.midis();
    return midis.length ? mod12(midis[0]) : null;
  }
  // Роль ноты как баса под текущим аккордом:
  //   root  — корень, tone — терция/квинта (устойчиво),
  //   color — ступень лада без острого трения (мягкая краска),
  //   clash — малая секунда/тритон к тону аккорда,
  //   outside — вне лада.
  function bassAffinity(pc, chord) {
    if (!chord || !Array.isArray(chord.pcs) || !chord.pcs.length) return '';
    const p = mod12(pc);
    if (chord.pcs.some(c => mod12(c) === p)) {
      return chord.rootPc != null && mod12(chord.rootPc) === p ? 'root' : 'tone';
    }
    if (typeof scalePcs === 'function' && scalePcs().indexOf(p) === -1) return 'outside';
    let nearest = 12;
    chord.pcs.forEach(c => {
      const d = Math.abs(p - mod12(c)) % 12;
      const interval = Math.min(d, 12 - d);
      if (interval < nearest) nearest = interval;
    });
    return nearest === 1 || nearest === 6 ? 'clash' : 'color';
  }
  function pieceTarget() {
    if (!state.form || !state.form.enabled || !state.form.running ||
        state.form.phase !== 'playing' || typeof Composition === 'undefined') return null;
    const goal = typeof Composition.targetForBar === 'function'
      ? Composition.targetForBar(state.form.bar || 1) : null;
    if (!goal || !goal.degree) return null;
    return diatonicPalette().find(h =>
      h.degree.toLowerCase() === String(goal.degree).toLowerCase()) || null;
  }
  // Профиль кэшируется по dataVersion Research: оценки меняются редко, а
  // updateHUD зовётся на каждую ноту. Один эталон в другой тональности —
  // только гипотеза; три и больше — перенос ступеней.
  function referenceProfile() {
    if (typeof Research === 'undefined' || typeof Research.referenceProfile !== 'function') {
      return null;
    }
    const version = typeof Research.dataVersion === 'function'
      ? Research.dataVersion() : Research.status().dataVersion;
    const key = version + '#' + state.mode + '#' + state.comboIdx;
    if (key === profileKey) return profileCache;
    profileKey = key;
    profileCache = Research.referenceProfile();
    return profileCache;
  }
  // Хроматический кандидат: тот же объект, который понимает chordEvent().
  function chromaticCandidate(offset, third, degree) {
    const base = ((combo().root % 12) + 12) % 12;
    const rootPc = (base + offset) % 12;
    const pcs = [0, third, 7].map(iv => (rootPc + iv) % 12);
    const names = pcs.map(pc => sharpLabel(pc));
    return {
      kind: 'chroma', degree, hint: 'краска', quality: third === 4 ? 'maj' : 'min',
      rootPc, third, fifth: 7, offset, pcs, names,
      name: chordLabel(names), pcsKey: pcs.slice().sort((a, b) => a - b).join(',')
    };
  }
  function borrowedCandidates(mode) {
    return mode === 'minor'
      ? [chromaticCandidate(5, 4, 'IV'), chromaticCandidate(1, 4, '♭II')]
      : [chromaticCandidate(5, 3, 'iv'), chromaticCandidate(10, 4, '♭VII')];
  }
  function candidatesFor(prev) {
    const seen = new Set();
    const prevKey = harmonyPcsKey(prev);
    const all = diatonicPalette().concat(borrowedCandidates(state.mode));
    return all.filter(h => {
      if (!h || !h.pcs) return false;
      const key = harmonyPcsKey(h);
      if (!key || key === prevKey || seen.has(key)) return false;
      seen.add(key);
      h.pcsKey = key;
      return true;
    });
  }
  function recentRepeats(prev, cand) {
    const key = harmonyTransitionKey(prev, cand);
    return (state.harmony.moves || []).filter(k => k === key).length;
  }
  function leadingResolves(prev, cand) {
    if (!prev || !cand) return false;
    const tonicPc = ((combo().root % 12) + 12) % 12;
    return (prev.pcs || []).indexOf((tonicPc + 11) % 12) !== -1 &&
      (cand.pcs || []).indexOf(tonicPc) !== -1;
  }
  function noteFit(cand, held) {
    if (!held.length) return 0;
    const hits = (cand.pcs || []).filter(pc => held.indexOf(pc) !== -1).length;
    if (!hits) return -2;
    return hits === held.length ? 12 : 3 * hits;
  }
  function referenceBias(prev, cand, profile, role) {
    if (!profile || !profile.usable) return 0;
    let score = 0;
    const degree = profile.degrees && profile.degrees[cand.degree];
    const trans = profile.transitions && profile.transitions[prev.degree + '>' + cand.degree];
    if (degree) score += degree * 6;
    if (trans) score += trans * 14;
    if (profile.pitchClasses && cand.pcs) {
      score += cand.pcs.reduce((sum, pc) => sum + (profile.pitchClasses[pc] || 0), 0) * 8;
    }
    if (role === 'hold') score *= 1.35;
    else if (role === 'develop') score *= 0.8;
    else score *= 0.35;
    return score;
  }

  function whyFor(role, cand, ctx, metrics) {
    if (role === 'hold') {
      if (metrics.common >= 2) return 'общие тоны';
      if (cand.hint === 'медианта' || cand.hint === 'субмедианта') return cand.hint;
      if (cand.hint === 'субдоминанта' || cand.hint === 'супертоника') return cand.hint;
      if (metrics.step === 5) return 'по кварте';
      return 'мягкий сдвиг';
    }
    if (role === 'develop') {
      if (ctx.target && harmonyPcsKey(cand) === harmonyPcsKey(ctx.target)) return 'цель такта';
      if (metrics.prevFn === 'predominant' && metrics.fn === 'dominant') {
        return 'подготовка доминанты';
      }
      if (metrics.prevFn === 'dominant' && cand.tonic) return 'разрешение в тонику';
      if (metrics.leading) return 'вводный тон';
      if (metrics.beauty.points >= 6) return 'красивый переход';
      return 'шаг вперёд';
    }
    if (cand.kind === 'chroma') return 'краска вне лада';
    if (cand.hint === 'медианта' || cand.hint === 'субмедианта') return 'медианта';
    if (metrics.step === 3 || metrics.step === 4) return 'сдвиг на терцию';
    if (metrics.common === 0) return 'новый цвет';
    return 'контраст';
  }
  function scoreCandidate(role, cand, ctx) {
    const prev = ctx.prev;
    const common = harmonyCommonTones(prev, cand);
    const step = harmonyRootStep(prev, cand);
    const repeats = recentRepeats(prev, cand);
    const beauty = harmonyTransitionBeauty(prev, cand, repeats);
    const prevFn = harmonyFunction(prev);
    const fn = harmonyFunction(cand);
    const leading = leadingResolves(prev, cand);
    let score = 0;
    score += common * (role === 'hold' ? 8 : role === 'develop' ? 2 : 1);
    score += beauty.raw * (role === 'develop' ? 0.7 : role === 'hold' ? 0.18 : 0.12);
    score += noteFit(cand, ctx.held);
    score += referenceBias(prev, cand, ctx.profile, role);
    score -= repeats * 6;

    if (role === 'hold') {
      if (fn === prevFn) score += 3;
      if (step <= 2) score += 3;
      if (step === 5) score += 2;
      if (cand.tonic && prevFn === 'dominant') score -= 10;
      if (fn === 'dominant' && !cand.tonic) score -= 3;
      if (cand.kind === 'chroma') score -= 4;
    } else if (role === 'develop') {
      if (ctx.target && harmonyPcsKey(cand) === harmonyPcsKey(ctx.target)) score += 100;
      if (prevFn === 'predominant' && fn === 'dominant') score += 14;
      if (prevFn === 'dominant' && cand.tonic) score += 8;
      if (leading) score += 10;
      if (fn === 'dominant') score += 4;
      if (cand.tonic && prevFn !== 'dominant') score -= 2;
      if (cand.kind === 'chroma') score -= 5;
    } else {
      if (fn === 'mediant') score += 8;
      if (cand.kind === 'chroma') score += 7;
      if (step === 3 || step === 4) score += 5;
      if (common === 0) score += 3;
      if (common >= 2) score -= 2;
      if (cand.tonic) score -= 6;
      if (fn === 'dominant') score -= 2;
      if (prevFn === 'dominant' && cand.tonic) score -= 8;
    }
    const metrics = { common, step, repeats, beauty, prevFn, fn, leading };
    return {
      cand, score,
      why: whyFor(role, cand, ctx, metrics),
      refHit: referenceBias(prev, cand, ctx.profile, role) >= 2
    };
  }
  function rankFor(role, pool, ctx) {
    return pool.map(cand => scoreCandidate(role, cand, ctx))
      .sort((a, b) => b.score - a.score || String(a.cand.degree).localeCompare(String(b.cand.degree)));
  }
  function asMove(role, hit) {
    const c = hit.cand;
    return {
      role, degree: c.degree, name: c.name,
      pcs: c.pcs.slice(), pcsKey: harmonyPcsKey(c),
      kind: c.kind || 'diatonic', why: hit.why,
      hint: c.hint || '', rootPc: c.rootPc, third: c.third, fifth: c.fifth,
      quality: c.quality || '', offset: c.offset, tonic: !!c.tonic,
      names: (c.names || []).slice(),
      target: false, refHit: !!hit.refHit,
      score: Math.round(hit.score * 10) / 10
    };
  }
  function computeMoves() {
    const prev = currentChord();
    if (!prev || !prev.pcs || !prev.pcs.length) return [];
    const all = candidatesFor(prev);
    if (!all.length) return [];
    const profile = referenceProfile();
    const target = pieceTarget();
    const ctx = { prev, held: heldPcs(), profile, target: null };
    if (target && harmonyPcsKey(target) !== harmonyPcsKey(prev)) ctx.target = target;
    const targetKey = ctx.target ? harmonyPcsKey(ctx.target) : '';
    const holdPool = all.filter(h => h.kind !== 'chroma' &&
      harmonyPcsKey(h) !== targetKey &&
      (HOLD_DEGREES[state.mode] || HOLD_DEGREES.major).indexOf(h.degree) !== -1);
    const pools = {
      hold: holdPool,
      develop: all,
      contrast: all
    };
    const used = new Set();
    const out = [];
    const roles = ['hold', 'develop', 'contrast'].slice(0, MAX_MOVES);
    roles.forEach(role => {
      let ranked = rankFor(role, pools[role], ctx);
      if (role === 'develop' && ctx.target) {
        const forced = ranked.find(h => harmonyPcsKey(h.cand) === harmonyPcsKey(ctx.target));
        if (forced && !used.has(harmonyPcsKey(forced.cand))) ranked = [forced].concat(ranked);
      }
      const hit = ranked.find(h => !used.has(harmonyPcsKey(h.cand)));
      if (!hit) return;
      used.add(harmonyPcsKey(hit.cand));
      const move = asMove(role, hit);
      move.target = !!ctx.target && move.pcsKey === harmonyPcsKey(ctx.target);
      out.push(move);
    });
    return out;
  }

  // Один «следующий» аккорд: цель такта важнее свободного ранжирования,
  // затем Развить, Держать, Контраст. Если такого аккорда нет на пяти
  // карточках, подсветка не появляется — ряд не обещает лишнего.
  function nextMove() {
    if (!moves.length) return null;
    const cardKeys = typeof harmonicChords === 'function'
      ? harmonicChords().map(h => harmonyPcsKey(h)) : [];
    const ordered = moves.filter(m => m.target)
      .concat(moves.filter(m => m.role === 'develop'))
      .concat(moves.filter(m => m.role === 'hold'))
      .concat(moves.filter(m => m.role === 'contrast'));
    const seen = new Set();
    const unique = ordered.filter(m => {
      if (!m || !m.pcsKey || seen.has(m.pcsKey)) return false;
      seen.add(m.pcsKey);
      return true;
    });
    return unique.find(m => cardKeys.indexOf(m.pcsKey) !== -1) || unique[0] || null;
  }
  function paintChordCards(chord, bassPc) {
    if (typeof chordCards === 'undefined' || !chordCards || !chordCards.length) return;
    const nextKey = next ? next.pcsKey : '';
    chordCards.forEach(card => {
      card.querySelectorAll('.cc-note[data-pc]').forEach(el => {
        const raw = el.getAttribute('data-pc');
        const pc = raw == null || raw === '' ? null : Number(raw);
        const role = pc == null ? '' : bassAffinity(pc, chord);
        el.classList.remove('bn-root', 'bn-tone', 'bn-color', 'bn-clash', 'bn-outside', 'bn-live');
        if (role) el.classList.add('bn-' + role);
        if (bassPc != null && pc != null && mod12(pc) === bassPc) el.classList.add('bn-live');
        if (role) el.title = tr(BASS_LABEL[role] || role);
        else el.removeAttribute('title');
      });
      const rootRaw = card.getAttribute('data-root-pc');
      const rootPc = rootRaw == null || rootRaw === '' ? null : Number(rootRaw);
      const rootRole = rootPc == null ? '' : bassAffinity(rootPc, chord);
      card.classList.remove('bass-root', 'bass-tone', 'bass-color', 'bass-clash',
        'bass-outside', 'bass-live');
      if (rootRole) card.classList.add('bass-' + rootRole);
      if (bassPc != null && rootPc != null && mod12(rootPc) === bassPc) {
        card.classList.add('bass-live');
      }
      const isNext = !!nextKey && card.dataset.pcsKey === nextKey;
      card.classList.toggle('guide-next', isNext);
      const base = card.dataset.baseTitle || '';
      const bassHint = rootRole
        ? ' · ' + tr('бас') + ': ' + tr(BASS_LABEL[rootRole] || rootRole) : '';
      card.title = base + bassHint + (isNext && next
        ? ' · ' + tr('следующий аккорд') + ': ' + tr(ROLE_LABEL[next.role] || next.role) +
          ' · ' + tr(next.why)
        : '');
    });
  }
  function paint(force) {
    if (typeof chordCards === 'undefined' || !chordCards || !chordCards.length) {
      moves = [];
      next = null;
      return moves;
    }
    const prev = currentChord();
    const profile = referenceProfile();
    const held = heldPcs();
    const bassPc = activeBassPc();
    const target = typeof smartTargetDegree === 'function' ? smartTargetDegree() : '';
    const sig = [
      state.mode, state.comboIdx, prev ? harmonyPcsKey(prev) : '',
      state.chordIndex, target, held.join(','),
      bassPc == null ? '' : bassPc, chordCards.length,
      state.form && state.form.bar ? state.form.bar : '',
      state.form && state.form.phase ? state.form.phase : '',
      profile && profile.label ? profile.label : ''
    ].join('|');
    if (!force && sig === lastSig) return moves;
    lastSig = sig;
    moves = prev ? computeMoves() : [];
    next = nextMove();
    paintChordCards(prev, bassPc);
    const cue = prev && next ? harmonyPcsKey(prev) + '>' + next.pcsKey : '';
    if (cue && cue !== lastCue && !state.replay && typeof Research !== 'undefined' &&
        typeof Research.logHint === 'function') {
      Research.logHint('hintShown', {
        chord: prev.degree, moves: [next], via: 'inline'
      });
    }
    lastCue = cue;
    return moves;
  }
  function onChord(h) {
    if (!h || !h.pcs) return;
    // chordEvent() зовёт это до обновления lastTriad: next — ещё подсказка
    // предыдущего аккорда. Если игрок сыграл именно её, это hintPicked.
    if (next && next.pcsKey === harmonyPcsKey(h) &&
        typeof Research !== 'undefined' && typeof Research.logHint === 'function') {
      Research.logHint('hintPicked', {
        chord: currentChord() ? currentChord().degree : '',
        played: h.degree || h.name || '',
        moves: [next], via: 'inline'
      });
    }
  }
  function stateOf() {
    const profile = referenceProfile();
    return {
      moves: moves.map(m => Object.assign({}, m, { pcs: m.pcs.slice() })),
      next: next ? Object.assign({}, next, { pcs: next.pcs.slice() }) : null,
      bassPc: activeBassPc(),
      reference: profile && profile.label ? profile.label : '',
      referenceTransfer: profile ? profile.transfer : '',
      referenceUsable: !!(profile && profile.usable)
    };
  }
  function initGuide() {
    paint(true);
  }
  initGuide();

  return { onChord, paint, state: stateOf };
})();
