/* HARMONIA · js/guide.js — компас «куда дальше»: 2–3 продолжения текущего аккорда
   Модуль без сборки: подключается <script> в index.html после research.js.
   Это не генератор мелодии и не автопилот: подсказка только называет ход,
   а звучит он после нажатия игрока. Все решения объяснимы: общие тоны,
   функция, тяготение, недавний повтор и эталонный профиль из Research.
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
  // «Тёплые» ступени: отсюда компас держит поле, а не тащит в каденцию.
  // V/vii° не входят в hold: их место — в «Развить», и только как один из
  // вариантов, а не как единственный «правильный» ход.
  const HOLD_DEGREES = {
    major: ['I', 'ii', 'iii', 'IV', 'vi'],
    minor: ['i', 'III', 'iv', 'VI']
  };

  let open = false;
  let moves = [];
  let pending = null;        // показанные варианты, ждущие ответа игрока
  let offeredAt = 0;
  let picking = false;       // клик по подсказке не считается «игнором»
  let profileCache = null;
  let profileKey = '';
  let lastSig = '';

  function guideLine() { return $('guideLine'); }
  function tr(s) {
    return typeof I18N !== 'undefined' && I18N.enabled() &&
      typeof I18N.text === 'function' ? I18N.text(s) : String(s == null ? '' : s);
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  function moveHtml(move, i) {
    const kind = tr(ROLE_LABEL[move.role] || move.role);
    const target = move.target ? ' · ' + tr('цель такта') : '';
    const star = move.refHit ? ' ✦' : '';
    return `<button class="guide-move ${move.role}${move.target ? ' target' : ''}" ` +
      `type="button" data-guide-pick="${i}" title="${esc(tr(move.why))}: ${esc(move.name)}">` +
      `<span class="gm-kind">${esc(kind + target)}</span>` +
      `<span class="gm-chord"><b>${esc(move.degree)}</b> ${esc(move.name)}</span>` +
      `<span class="gm-why">${esc(tr(move.why))}${star}</span>` +
    `</button>`;
  }
  function paint(force) {
    const line = guideLine();
    if (!line) return moves;
    const prev = currentChord();
    const profile = referenceProfile();
    const sig = [
      state.mode, state.comboIdx, prev ? harmonyPcsKey(prev) : '',
      heldPcs().join(','), open ? '1' : '0',
      state.form && state.form.bar ? state.form.bar : '',
      profile && profile.label ? profile.label : ''
    ].join('|');
    if (!force && sig === lastSig) return moves;
    lastSig = sig;
    moves = open ? computeMoves() : [];
    const movesEl = $('guideMoves');
    const refEl = $('guideRef');
    const kicker = $('guideHintBtn');
    line.classList.toggle('open', !!open);
    line.classList.toggle('empty', !!open && !moves.length);
    if (kicker) kicker.setAttribute('aria-expanded', String(!!open));
    if (refEl) {
      const label = profile && profile.label ? tr(profile.label) : '';
      refEl.hidden = !label;
      refEl.textContent = label;
      refEl.title = profile && profile.transfer === 'hypothesis'
        ? 'Один эталон — это гипотеза, а не правило' : 'Высокие оценки и явные эталоны';
    }
    if (movesEl) {
      movesEl.innerHTML = moves.map(moveHtml).join('') +
        (open && !moves.length
          ? `<span class="guide-empty">${esc(tr('Сначала сыграйте аккорд'))}</span>` : '');
    }
    return moves;
  }
  function openCompass(via) {
    open = true;
    const shown = paint(true);
    offeredAt = performance.now();
    pending = shown.length ? shown.map(m => Object.assign({}, m, { pcs: m.pcs.slice() })) : null;
    if (shown.length) {
      const prev = currentChord();
      if (typeof Research !== 'undefined' && typeof Research.logHint === 'function') {
        Research.logHint('hintShown', {
          chord: prev ? prev.degree : '', moves: shown, via: via || ''
        });
      }
    }
    return shown;
  }
  function request() {
    const prev = currentChord();
    if (typeof Research !== 'undefined' && typeof Research.logHint === 'function') {
      Research.logHint('hintRequested', { chord: prev ? prev.degree : '', via: 'H' });
    }
    openCompass('H');
    return true;
  }
  function markStuck() {
    const prev = currentChord();
    if (typeof Research !== 'undefined' && typeof Research.logHint === 'function') {
      Research.logHint('stuckMarked', { chord: prev ? prev.degree : '', via: 'stuck' });
    }
    openCompass('stuck');
    return true;
  }
  function onChord(h) {
    if (picking) { picking = false; pending = null; return; }
    if (!pending || !h || !h.pcs) return;
    const key = harmonyPcsKey(h);
    const match = pending.find(m => m.pcsKey === key);
    if (typeof Research !== 'undefined' && typeof Research.logHint === 'function') {
      if (match) {
        Research.logHint('hintPicked', {
          chord: match.degree, played: match.degree, moves: pending, via: 'played'
        });
      } else {
        Research.logHint('hintIgnored', {
          chord: currentChord() ? currentChord().degree : '',
          played: h.degree || h.name || '',
          afterMs: performance.now() - offeredAt,
          moves: pending, via: 'played'
        });
      }
    }
    pending = null;
  }
  function playMove(move) {
    if (!move) return false;
    if (typeof playable === 'function' && !playable()) return false;
    if (typeof initAudio === 'function') initAudio();
    if (typeof harmonicChords === 'function' && typeof playHarmonic === 'function') {
      const idx = harmonicChords().findIndex(h => harmonyPcsKey(h) === move.pcsKey);
      if (idx !== -1) { playHarmonic(idx, 0.9); return true; }
    }
    if (typeof playChordAudio === 'function' && typeof chordEvent === 'function') {
      playChordAudio(move, 0.9);
      chordEvent(move, 0.9, 'keys');
      return true;
    }
    return false;
  }
  function pick(index) {
    const move = moves[index];
    if (!move) return false;
    if (typeof playable === 'function' && !playable()) return false;
    if (typeof Research !== 'undefined' && typeof Research.logHint === 'function') {
      Research.logHint('hintPicked', {
        chord: currentChord() ? currentChord().degree : '',
        played: move.degree, moves: moves, target: !!move.target, via: 'click'
      });
    }
    picking = true;
    const ok = playMove(move);
    picking = false;
    if (ok) pending = null;
    return ok;
  }
  function stateOf() {
    const profile = referenceProfile();
    return {
      open: !!open,
      moves: moves.map(m => Object.assign({}, m, { pcs: m.pcs.slice() })),
      reference: profile && profile.label ? profile.label : '',
      referenceTransfer: profile ? profile.transfer : '',
      referenceUsable: !!(profile && profile.usable)
    };
  }
  function initGuide() {
    const line = guideLine();
    if (!line) return;
    line.addEventListener('click', (e) => {
      const pickBtn = e.target.closest ? e.target.closest('[data-guide-pick]') : null;
      if (pickBtn) {
        e.preventDefault();
        pick(parseInt(pickBtn.dataset.guidePick, 10));
        return;
      }
      const act = e.target.closest ? e.target.closest('[data-guide-act]') : null;
      if (!act) return;
      e.preventDefault();
      if (act.dataset.guideAct === 'stuck') markStuck();
      else request();
    });
    paint(true);
  }
  initGuide();

  return { request, markStuck, pick, onChord, paint, state: stateOf };
})();
