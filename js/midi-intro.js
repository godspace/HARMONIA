/* HARMONIA · js/midi-intro.js — стартовое знакомство для MIDI-клавиатуры
   Модуль без сборки: подключается <script> после ui-hud.js и guide.js.
   Экран не заменяет игру, а объясняет её обозначения до старта: цвет нот,
   бейдж «сейчас», следующий ход и возврат в тонику. Вместо пробы компьютерных
   клавиш человек с инструментом берёт три аккорда (I–IV–V / i–iv–V); после
   этого сессия открывается тем же beginFromOverlay(), что и раньше.
   Все модули делят глобальную область — имена функций/констант уникальны. */

var MidiIntro = (function () {
  'use strict';

  // Порядок не случаен: тоника закрепляет «дом», IV уводит, V возвращает.
  const TARGET_DEGREES = { major: ['I', 'IV', 'V'], minor: ['i', 'iv', 'V'] };
  const ROLE_TEXT = {
    root: 'корень',
    tone: 'тон аккорда',
    color: 'мягкая краска',
    clash: 'трение',
    outside: 'вне лада'
  };
  const LEAD_START = 'Сыграйте тонику, субдоминанту и доминанту в любой октаве. Экран объяснит цвета и значки, которые встретятся в игре.';
  const LEAD_DONE = 'Все три аккорда взяты — входим в симулятор…';
  const LEAD_LOST = 'MIDI отключена — подключите клавиатуру снова.';

  let active = false;
  let completed = false;
  let targets = [];
  let done = Object.create(null);
  let notes = new Map();
  let startTimer = 0;
  let bound = false;

  function tr(s) {
    return typeof I18N !== 'undefined' && I18N.enabled() &&
      typeof I18N.text === 'function' ? I18N.text(s) : String(s == null ? '' : s);
  }
  function pc12(value) {
    return ((Number(value) % 12) + 12) % 12;
  }
  function overlay() { return $('startOverlay'); }
  function coach() { return $('midiCoach'); }
  function targetHost() { return $('miTargets'); }
  function labelHtml(name, capitalize) {
    if (typeof noteLabelHtml === 'function') return noteLabelHtml(name, capitalize);
    const text = capitalize ? cap(noteLabel(name)) : noteLabel(name);
    return escHtml(text);
  }
  function setLead(text) {
    const el = $('miLead');
    if (el) el.textContent = tr(text);
  }
  function clearStartTimer() {
    if (!startTimer) return;
    clearTimeout(startTimer);
    startTimer = 0;
  }
  function notePcs() {
    const pcs = [];
    notes.forEach((v, midi) => {
      const pc = pc12(midi);
      if (pcs.indexOf(pc) === -1) pcs.push(pc);
    });
    return pcs.sort((a, b) => a - b);
  }
  function stateMode() {
    return state.mode === 'minor' ? 'minor' : 'major';
  }
  function buildTargets() {
    const list = typeof harmonicChords === 'function' ? harmonicChords() : [];
    const wanted = TARGET_DEGREES[stateMode()];
    const out = [];
    wanted.forEach(degree => {
      const h = list.find(item => String(item.degree).toLowerCase() === degree.toLowerCase());
      if (h && !out.some(other => harmonyPcsKey(other) === harmonyPcsKey(h))) out.push(h);
    });
    // Данные COMBOLIST всегда содержат I/IV/V, но запасной путь не даёт
    // знакомству остаться без целей, если набор когда-нибудь изменится.
    list.forEach(h => {
      if (out.length >= 3) return;
      if (!out.some(other => harmonyPcsKey(other) === harmonyPcsKey(h))) out.push(h);
    });
    return out.slice(0, 3);
  }
  // Цвета ролей — те же, что на карточках в игре. Примеры строятся из
  // текущей тональности, поэтому в C-dur это до/ми/ре/си/до♯, а не абстракция.
  function renderLegend() {
    const host = $('miLegendNotes');
    if (!host) return;
    const c = combo();
    const scale = scalePcs();
    const names = scaleNoteNames();
    const chord = c.triads[0] || [];
    const nameFor = pc => names[pc] || sharpLabel(pc);
    let colorPc = scale.find(pc => {
      if (chord.indexOf(pc) !== -1) return false;
      return chord.every(cp => {
        const d = Math.abs(pc12(pc) - pc12(cp));
        const interval = Math.min(d, 12 - d);
        return interval !== 1 && interval !== 6;
      });
    });
    if (colorPc == null) colorPc = scale.find(pc => chord.indexOf(pc) === -1);
    const clashPc = (pc12(c.root) + 11) % 12;
    const outsidePc = (pc12(c.root) + 1) % 12;
    const items = [
      { role: 'root', name: c.chords[0][0] },
      { role: 'tone', name: c.chords[0][1] },
      { role: 'color', name: nameFor(colorPc) },
      { role: 'clash', name: nameFor(clashPc) },
      { role: 'outside', name: nameFor(outsidePc) }
    ];
    host.innerHTML = items.map(item =>
      `<span class="mi-legend-item"><span class="cc-note bn-${item.role} notranslate" translate="no">` +
        labelHtml(item.name, true) + '</span><span>' +
        escHtml(tr(ROLE_TEXT[item.role])) + '</span></span>'
    ).join('');
  }
  function paintTargetRoles() {
    const host = targetHost();
    if (!host) return;
    host.querySelectorAll('.mi-target').forEach(el => {
      const h = targets.find(item => String(item.degree) === el.dataset.degree);
      if (!h) return;
      el.querySelectorAll('.cc-note[data-pc]').forEach(noteEl => {
        const pc = pc12(noteEl.dataset.pc);
        const role = pc === pc12(h.rootPc) ? 'root' : 'tone';
        noteEl.classList.add('bn-' + role);
      });
    });
  }
  function renderTargets() {
    const host = targetHost();
    if (!host) return;
    const next = targets.find(h => !done[h.degree]) || null;
    host.innerHTML = targets.map(h => {
      const key = harmonyPcsKey(h);
      const isDone = !!done[h.degree];
      const cls = 'mi-target' + (isDone ? ' done' : '') + (h === next ? ' next' : '');
      return `<div class="${cls}" data-degree="${escHtml(h.degree)}" data-pcs-key="${escHtml(key)}">` +
        `<div class="mi-target-head"><span class="mi-target-deg">${escHtml(h.degree)}</span>` +
          `<span class="mi-target-hint">${escHtml(tr(h.hint || ''))}</span>` +
          `<span class="mi-target-check" aria-hidden="true">✓</span></div>` +
        `<div class="mi-target-name">${chordNotesHtml(h)}</div>` +
        `<div class="mi-target-kb">${miniKeyboardHtml(h)}</div>` +
      '</div>';
    }).join('');
    paintTargetRoles();
    paintProgress();
    paintLive();
  }
  function paintProgress() {
    const count = targets.filter(h => done[h.degree]).length;
    const el = $('miProgress');
    if (!el) return;
    el.textContent = count + ' / ' + (targets.length || 0);
    el.classList.toggle('ready', targets.length > 0 && count === targets.length);
  }
  function paintDevice() {
    const el = $('miDevice');
    if (!el) return;
    const name = typeof Midi !== 'undefined' && Midi.devName ? Midi.devName : tr('MIDI-вход');
    el.textContent = name;
  }
  function paintLive() {
    const live = $('miLive');
    if (!live) return;
    const pcs = notePcs();
    live.classList.toggle('live', pcs.length > 0);
    if (!pcs.length) {
      live.innerHTML = escHtml(tr('Слышу:')) + ' —';
      const idleHost = targetHost();
      if (idleHost) idleHost.querySelectorAll('.mi-target.heard')
        .forEach(el => el.classList.remove('heard'));
      return;
    }
    const names = scaleNoteNames();
    const list = pcs.slice(0, 4).map(pc => labelHtml(names[pc] || sharpLabel(pc), true)).join('-') +
      (pcs.length > 4 ? ' …' : '');
    const listHtml = `<span class="notranslate" translate="no">${list}</span>`;
    let info = null;
    let tail = '';
    if (pcs.length === 3 && typeof describeTriad === 'function') {
      info = describeTriad(pcs);
      if (info && info.kind !== 'unknown') {
        tail = ' → <b>' + escHtml(info.degree || info.name || '') + '</b>' +
          (info.hint ? ' · ' + escHtml(tr(info.hint)) : '');
      }
    }
    live.innerHTML = escHtml(tr('Слышу:')) + ' ' + listHtml + tail;
    const key = info && info.kind !== 'unknown' ? harmonyPcsKey(info) : '';
    const host = targetHost();
    if (host) {
      host.querySelectorAll('.mi-target').forEach(el => {
        el.classList.toggle('heard', !!key && el.dataset.pcsKey === key);
      });
    }
  }
  function open() {
    if (state.started) return false;
    if (!(typeof Midi !== 'undefined' && Midi.hasDevice())) return false;
    if (active) {
      paintDevice();
      const currentStart = $('miStart');
      if (currentStart && completed) currentStart.disabled = false;
      const currentFallback = $('miFallback');
      if (currentFallback) currentFallback.hidden = true;
      setLead(completed ? LEAD_DONE : LEAD_START);
      return true;
    }
    active = true;
    completed = false;
    done = Object.create(null);
    notes.clear();
    clearStartTimer();
    if (typeof clearIntroTimer === 'function') clearIntroTimer();
    if (typeof hideKeyTip === 'function') hideKeyTip();
    if (typeof setDrawerIntro === 'function') setDrawerIntro(true);
    const box = overlay();
    if (box) {
      box.style.display = '';
      box.classList.remove('fade', 'ready', 'drums');
      box.classList.add('midi');
    }
    const coachBox = coach();
    if (coachBox) coachBox.hidden = false;
    targets = buildTargets();
    setLead(LEAD_START);
    const hint = $('miHint');
    if (hint) hint.textContent = tr('Если аккорд не тот, ничего не сломается: просто попробуйте снова.');
    const fallback = $('miFallback');
    if (fallback) fallback.hidden = true;
    const start = $('miStart');
    if (start) {
      start.disabled = true;
      start.textContent = tr('Начать');
    }
    paintDevice();
    renderLegend();
    renderTargets();
    return true;
  }
  function close() {
    clearStartTimer();
    active = false;
    completed = false;
    notes.clear();
    targets = [];
    done = Object.create(null);
    const box = overlay();
    if (box) box.classList.remove('midi');
    const coachBox = coach();
    if (coachBox) coachBox.hidden = true;
  }
  function enter() {
    if (!active) return;
    clearStartTimer();
    close();
    if (typeof beginFromOverlay === 'function') beginFromOverlay();
  }
  function skip() {
    if (!active) return;
    clearStartTimer();
    close();
    if (typeof beginFromOverlay === 'function') beginFromOverlay();
  }
  function fallbackToKeyboard() {
    if (!active) return;
    close();
    const box = overlay();
    if (box) box.style.display = '';
    if (typeof setDrawerIntro === 'function') setDrawerIntro(true);
  }
  function deviceLost() {
    if (!active) return;
    clearStartTimer();
    notes.clear();
    paintLive();
    const dev = $('miDevice');
    if (dev) dev.textContent = tr('MIDI отключена');
    setLead(LEAD_LOST);
    const start = $('miStart');
    if (start) start.disabled = true;
    const fallback = $('miFallback');
    if (fallback) fallback.hidden = false;
  }
  function noteOn(note, vel) {
    if (!active || state.started) return;
    const v = clamp(vel == null ? 0.8 : vel, 0.05, 1);
    notes.set(note, v);
    // На знакомстве звучит тот же фортепианный голос, что и в игре, но без
    // автотрезвучия: здесь важно услышать ровно взятые ноты.
    if (state.echo) {
      try {
        initAudio();
        echoNote(note, v, clamp((note - 60) / 48, -0.8, 0.8));
      } catch (e) { /* браузер ещё ждёт жест — MIDI-события продолжают работать */ }
    }
    paintLive();
    judge();
  }
  function noteOff(note) {
    if (!active) return;
    notes.delete(note);
    if (state.echo && typeof pianoRelease === 'function') pianoRelease(note, false);
    paintLive();
  }
  function panic() {
    if (!active) return;
    notes.clear();
    paintLive();
  }
  function judge() {
    const pcs = notePcs();
    if (pcs.length !== 3 || typeof describeTriad !== 'function') return;
    const info = describeTriad(pcs);
    if (!info || info.kind === 'unknown') return;
    const key = harmonyPcsKey(info);
    const hit = targets.find(h => !done[h.degree] && harmonyPcsKey(h) === key);
    if (!hit) return;
    done[hit.degree] = true;
    renderTargets();
    if (targets.length > 0 && targets.every(h => done[h.degree])) {
      completed = true;
      setLead(LEAD_DONE);
      const start = $('miStart');
      if (start) {
        start.disabled = false;
        start.textContent = tr('Начать');
      }
      paintProgress();
      clearStartTimer();
      startTimer = setTimeout(enter, CFG.midiIntroStartMs || 1100);
    }
  }
  function refresh() {
    renderLegend();
    if (active) renderTargets();
  }
  function stateOf() {
    return {
      active: active,
      completed: completed,
      targets: targets.map(h => ({
        degree: h.degree, pcs: h.pcs.slice(), names: (h.names || []).slice(),
        key: harmonyPcsKey(h), done: !!done[h.degree]
      })),
      notes: notePcs()
    };
  }
  function init() {
    if (bound) return;
    bound = true;
    const start = $('miStart');
    if (start) start.addEventListener('click', enter);
    const skipBtn = $('miSkip');
    if (skipBtn) skipBtn.addEventListener('click', skip);
    const fallback = $('miFallback');
    if (fallback) fallback.addEventListener('click', fallbackToKeyboard);
    renderLegend();
  }
  init();

  return {
    get active() { return active; },
    get completed() { return completed; },
    open, close, enter, skip, deviceLost, noteOn, noteOff, panic, refresh,
    fallback: fallbackToKeyboard,
    state: stateOf
  };
})();
