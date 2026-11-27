/* HARMONIA · js/midi-intro.js — стартовое знакомство для MIDI-клавиатуры
   Модуль без сборки: подключается <script> после ui-hud.js и guide.js.
   Один экран вместо мастера: слева три живые карточки I–IV–V, справа разбор
   выбранной карточки. Клик объясняет ступень, ноты и роли; MIDI-трезвучие
   засчитывает цель, двигает прогресс и пишет в подсказке, что изменилось.
   После третьего аккорда вход в сессию явный — «Начать игру» или Space.
   Все модули делят глобальную область — имена функций/констант уникальны. */

var MidiIntro = (function () {
  'use strict';

  // Порядок не случаен: тоника закрепляет «дом», IV уводит, V возвращает.
  const TARGET_DEGREES = { major: ['I', 'IV', 'V'], minor: ['i', 'iv', 'V'] };
  const STATE_LABEL = { next: 'следующий', done: 'взят', idle: 'цель' };
  // Одна фраза на функцию — та же логика, что объясняют подсказки сцены.
  const FUNCTION_COPY = {
    'тоника': 'Тоника: дом. С неё начинают и к ней возвращаются.',
    'субдоминанта': 'Субдоминанта: уводит от дома и готовит доминанту.',
    'доминанта': 'Доминанта: напряжение, которое тянет назад в тонику.',
    'супертоника': 'Супертоника: мягкий шаг к доминанте.',
    'медианта': 'Медианта: мягкая тень между тоникой и субдоминантой.',
    'субмедианта': 'Субмедианта: мягкий уход, из которого легко вернуться.',
    default: 'Аккорд лада: помогает услышать, как работает гармония.'
  };

  let active = false;
  let completed = false;
  let heardAny = false;
  let lost = false;
  let targets = [];
  let done = Object.create(null);
  let notes = new Map();
  let selectedKey = '';
  let lastJudgeKey = '';
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
  function targetKey(h) {
    return typeof harmonyPcsKey === 'function' ? harmonyPcsKey(h) : '';
  }
  function buildTargets() {
    const list = typeof harmonicChords === 'function' ? harmonicChords() : [];
    const wanted = TARGET_DEGREES[stateMode()];
    const out = [];
    wanted.forEach(degree => {
      const h = list.find(item => String(item.degree).toLowerCase() === degree.toLowerCase());
      if (h && !out.some(other => targetKey(other) === targetKey(h))) out.push(h);
    });
    // Данные COMBOLIST всегда содержат I/IV/V, но запасной путь не даёт
    // знакомству остаться без целей, если набор когда-нибудь изменится.
    list.forEach(h => {
      if (out.length >= 3) return;
      if (!out.some(other => targetKey(other) === targetKey(h))) out.push(h);
    });
    return out.slice(0, 3);
  }
  function nextTarget() {
    return targets.find(h => !done[h.degree]) || null;
  }
  function selectedTarget() {
    return targets.find(h => targetKey(h) === selectedKey) || nextTarget() || targets[0] || null;
  }
  function targetState(h) {
    if (!h) return 'idle';
    if (done[h.degree]) return 'done';
    const next = nextTarget();
    return next && targetKey(next) === targetKey(h) ? 'next' : 'idle';
  }
  // Распознаём только полное трезвучие: две ноты — ещё не аккорд, четыре —
  // уже не трезвучие для входа (в игре такие ноты обрабатываются отдельно).
  function currentTriad() {
    const pcs = notePcs();
    if (pcs.length !== 3 || typeof describeTriad !== 'function') return null;
    const info = describeTriad(pcs);
    return info && info.kind !== 'unknown' ? info : null;
  }
  function currentKey() {
    const info = currentTriad();
    return info ? targetKey(info) : '';
  }
  function noteNamesHtml(pcs) {
    const names = typeof scaleNoteNames === 'function' ? scaleNoteNames() : {};
    return pcs.map(pc => labelHtml(names[pc] || sharpLabel(pc), true)).join('-');
  }
  function paintRolesIn(root, h) {
    if (!root) return;
    root.querySelectorAll('.cc-note[data-pc]').forEach(noteEl => {
      const pc = pc12(noteEl.dataset.pc);
      const role = pc === pc12(h.rootPc) ? 'root' : 'tone';
      noteEl.classList.add('bn-' + role);
    });
  }

  // ===== Карточки целей =====
  // Карточка — кнопка: её можно выбрать мышью, тапом или Enter/Space.
  // Состояния next/now/done/tonic/sel — те же подсказки, что в игре.
  function renderTargets() {
    const host = targetHost();
    if (!host) return;
    const next = nextTarget();
    const nowKey = currentKey();
    if (!selectedKey || !targets.some(h => targetKey(h) === selectedKey)) {
      selectedKey = next ? targetKey(next) : (targets[0] ? targetKey(targets[0]) : '');
    }
    host.innerHTML = targets.map(h => {
      const key = targetKey(h);
      const st = targetState(h);
      const cls = ['mi-target'];
      if (h.tonic) cls.push('tonic');
      if (st === 'done') cls.push('done');
      if (st === 'next') cls.push('next');
      if (key === selectedKey) cls.push('sel');
      if (nowKey && key === nowKey) cls.push('now');
      const aria = [h.degree, (h.names || []).map(name => noteLabel(name)).join(' '),
        tr(STATE_LABEL[st])].join(', ');
      // aria-pressed — это «взят»: состояние карточки, а не выбор. Выбранную
      // карточку помечает aria-current, иначе AT путает фокус с прогрессом.
      const current = key === selectedKey ? ' aria-current="true"' : '';
      return `<button class="${cls.join(' ')}" type="button" data-degree="${escHtml(h.degree)}" ` +
        `data-pcs-key="${escHtml(key)}" aria-pressed="${st === 'done' ? 'true' : 'false'}"` +
        `${current} aria-label="${escHtml(aria)}">` +
        `<span class="mi-target-head"><span class="mi-target-deg">${escHtml(h.degree)}</span>` +
          `<span class="mi-target-now">${escHtml(tr('сейчас'))}</span>` +
          `<span class="mi-target-next" aria-hidden="true">→</span>` +
          `<span class="mi-target-check" aria-hidden="true">✓</span></span>` +
        `<span class="mi-target-name">${chordNotesHtml(h)}</span>` +
        `<span class="mi-target-kb">${miniKeyboardHtml(h)}</span>` +
      '</button>';
    }).join('');
    paintTargetRoles();
    paintProgress();
    paintLive();
    renderTeach();
  }
  function paintTargetRoles() {
    const host = targetHost();
    if (!host) return;
    host.querySelectorAll('.mi-target').forEach(el => {
      const h = targets.find(item => targetKey(item) === el.dataset.pcsKey);
      if (h) paintRolesIn(el, h);
    });
  }
  function paintProgress() {
    const count = targets.filter(h => done[h.degree]).length;
    const total = targets.length || 0;
    const el = $('miProgress');
    if (!el) return;
    el.hidden = false;
    el.textContent = count + ' / ' + total;
    el.setAttribute('aria-label', tr('Взято целевых аккордов') + ': ' + count + ' / ' + total);
    el.classList.toggle('ready', total > 0 && count === total);
  }
  function paintControls() {
    const start = $('miStart');
    if (!start) return;
    start.hidden = false;
    // Потеря устройства важнее прогресса: без MIDI кнопка входа снова ждёт клавиатуру.
    start.disabled = !completed || lost;
    start.classList.toggle('ready', completed && !lost);
    start.textContent = tr('Начать игру');
  }
  function paintDevice() {
    const el = $('miDevice');
    if (!el) return;
    const name = lost ? tr('MIDI отключена')
      : (typeof Midi !== 'undefined' && Midi.devName ? Midi.devName : tr('MIDI-вход'));
    el.textContent = name;
  }
  // Связь — постоянный индикатор, а не отдельный шаг: как только прозвучала
  // любая нота, «Слышу» и точка статуса остаются зелёными до потери устройства.
  function paintCheck() {
    const box = $('miCheck');
    if (!box) return;
    box.classList.toggle('ok', heardAny && !lost);
    box.classList.toggle('lost', lost);
    const icon = $('miCheckIcon');
    if (icon) icon.textContent = lost ? '!' : heardAny ? '✓' : '○';
    const text = $('miCheckText');
    if (text) {
      text.textContent = tr(lost ? 'MIDI отключена — подключите клавиатуру снова.'
        : heardAny ? 'MIDI работает: программа слышит ноты.' : 'Жду первую ноту…');
    }
  }
  function paintLive() {
    const live = $('miLive');
    if (!live) return;
    const pcs = notePcs();
    const info = currentTriad();
    live.classList.toggle('live', pcs.length > 0);
    if (!pcs.length) {
      live.innerHTML = '<span class="mi-live-label">' + escHtml(tr('Слышу:')) + '</span> —';
      const idleHost = targetHost();
      if (idleHost) idleHost.querySelectorAll('.mi-target.now')
        .forEach(el => el.classList.remove('now'));
      return;
    }
    const list = noteNamesHtml(pcs.slice(0, 4)) + (pcs.length > 4 ? ' …' : '');
    let tail = '';
    if (info) {
      const label = info.degree || info.name || '';
      const hint = info.hint && info.hint !== label ? ' · ' + tr(info.hint) : '';
      tail = ' → <b>' + escHtml(label) + '</b>' + escHtml(hint);
    }
    live.innerHTML = '<span class="mi-live-label">' + escHtml(tr('Слышу:')) +
      '</span> <span class="notranslate" translate="no">' + list + '</span> · <b>' +
      pcs.length + '</b> / 3' + tail;
    const key = info ? targetKey(info) : '';
    const host = targetHost();
    if (host) {
      host.querySelectorAll('.mi-target').forEach(el => {
        el.classList.toggle('now', !!key && el.dataset.pcsKey === key);
      });
    }
  }

  // ===== Правая панель: разбор выбранной карточки =====
  function factHtml(icon, label, text, cls) {
    return '<div class="mi-fact' + (cls ? ' ' + cls : '') + '">' +
      '<span class="mi-fact-ico">' + icon + '</span>' +
      '<span class="mi-fact-copy"><b>' + escHtml(tr(label)) + '</b>' +
      '<small>' + escHtml(text) + '</small></span></div>';
  }
  function factsFor(h, st) {
    const hint = h.hint ? tr(h.hint) : tr('аккорд лада');
    const stateIcon = st === 'done' ? '✓' : st === 'next' ? '→' : '○';
    const stateText = st === 'done'
      ? 'Этот аккорд уже взят. Можно повторить в любой октаве.'
      : st === 'next' ? 'Следующий шаг: сыграйте три ноты одновременно.'
        : 'Можно выбрать и разобрать в любой момент.';
    return [
      factHtml(escHtml(h.degree), 'Ступень', h.degree + ' — ' + hint, ''),
      factHtml('3', 'Состав', tr('Корень + терция + квинта: три разные ноты.'), 'notes'),
      factHtml(stateIcon, 'Состояние', tr(stateText), 'state ' + st)
    ].join('');
  }
  function renderTeach() {
    const h = selectedTarget();
    const title = $('miTeachTitle');
    const text = $('miTeachText');
    const facts = $('miFacts');
    const stateBox = $('miTeachState');
    if (!h) {
      if (stateBox) {
        stateBox.className = 'mi-teach-state';
        stateBox.textContent = '—';
      }
      if (title) title.textContent = tr('Нажмите на карточку');
      if (text) {
        text.textContent = tr('Карточка показывает ступень, ноты и их роли. ' +
          'Выберите любую — здесь появится объяснение.');
      }
      if (facts) facts.innerHTML = '';
      return;
    }
    const st = targetState(h);
    if (stateBox) {
      stateBox.className = 'mi-teach-state' + (lost ? ' lost' : st === 'idle' ? '' : ' ' + st);
      stateBox.textContent = lost ? tr('MIDI отключена') : tr(STATE_LABEL[st]);
    }
    if (title) {
      title.innerHTML = escHtml(h.degree) + ' · ' + chordNotesHtml(h);
      paintRolesIn(title, h);
    }
    if (text) {
      const copy = FUNCTION_COPY[h.hint] || FUNCTION_COPY.default;
      text.innerHTML = escHtml(tr(copy)) + ' ' + escHtml(tr('Три ноты:')) + ' ' +
        chordNotesHtml(h) + '. ' + escHtml(tr('Золотая — корень, зелёные — тоны аккорда.')) +
        ' ' + escHtml(tr('Играйте их одновременно в любой октаве.'));
      paintRolesIn(text, h);
    }
    if (facts) facts.innerHTML = factsFor(h, st);
  }

  // ===== Обратная связь: каждое действие объясняет, что произошло =====
  function paintFeedback(html, kind) {
    const el = $('miFeedback');
    if (!el) return;
    el.className = 'mi-feedback' + (kind ? ' ' + kind : '');
    el.innerHTML = html;
  }
  function feedbackIdle() {
    paintFeedback(tr('Сыграйте три аккорда. Карточки можно нажимать, чтобы разобрать их знаки.'), 'info');
  }
  function feedbackSelect(h) {
    if (!h) return;
    const st = targetState(h);
    let msg = tr('Выбрали') + ' <b>' + escHtml(h.degree) + '</b>. ';
    if (st === 'done') msg += tr('Этот аккорд уже взят.');
    else if (st === 'next') msg += tr('Это следующий шаг: сыграйте три ноты одновременно.');
    else msg += tr('Сыграйте три ноты одновременно — аккорд засчитается.');
    paintFeedback(msg, st === 'done' ? 'good' : 'info');
  }
  function feedbackNote(pcs) {
    if (pcs.length === 1) {
      paintFeedback(tr('Одна нота') + ': <span class="notranslate" translate="no">' +
        noteNamesHtml(pcs) + '</span>. ' + tr('Для аккорда нужны ещё две разные ноты.'), 'info');
    } else if (pcs.length === 2) {
      paintFeedback(tr('Две ноты') + ': <span class="notranslate" translate="no">' +
        noteNamesHtml(pcs) + '</span>. ' + tr('Добавьте третью — и экран проверит трезвучие.'), 'info');
    }
  }
  function feedbackWrong(info, next) {
    const label = info.degree || info.name || '';
    const hint = info.hint && info.hint !== label ? ' · ' + tr(info.hint) : '';
    const list = targets.map(h => h.degree).join(' · ');
    let msg = tr('Прозвучал') + ' <b>' + escHtml(label) + '</b>' + escHtml(hint) + '. ' +
      tr('Для входа нужны') + ' <b>' + escHtml(list) + '</b>.';
    if (next) msg += ' ' + tr('Попробуйте') + ' <b>' + escHtml(next.degree) + '</b>.';
    paintFeedback(msg, 'warn');
  }
  function feedbackHit(h) {
    const left = targets.filter(t => !done[t.degree]).length;
    const hint = h.hint ? ' · ' + tr(h.hint) : '';
    paintFeedback(tr('Взято') + ' <b>' + escHtml(h.degree) + '</b>' + escHtml(hint) + '. ' +
      tr('Осталось') + ' <b>' + left + '</b> / 3.', 'good');
  }
  function feedbackDone() {
    paintFeedback(tr('Все три аккорда взяты. Нажмите «Начать игру» или Space.'), 'good');
  }
  function selectKey(key, options) {
    const h = targets.find(item => targetKey(item) === key);
    if (!h) return false;
    selectedKey = key;
    const host = targetHost();
    if (host) {
      host.querySelectorAll('.mi-target').forEach(el => {
        const on = el.dataset.pcsKey === key;
        el.classList.toggle('sel', on);
        if (on) el.setAttribute('aria-current', 'true');
        else el.removeAttribute('aria-current');
      });
    }
    renderTeach();
    if (!(options && options.keepFeedback)) feedbackSelect(h);
    return true;
  }

  // ===== MIDI: слушаем трезвучие, засчитываем только полный аккорд =====
  function judge() {
    const pcs = notePcs();
    if (pcs.length !== 3 || typeof describeTriad !== 'function') return;
    const info = describeTriad(pcs);
    if (!info || info.kind === 'unknown') {
      if (!completed) {
        paintFeedback(tr('Три ноты, но это не трезвучие: нужны корень, терция и квинта.'), 'warn');
      }
      return;
    }
    const key = targetKey(info);
    if (key === lastJudgeKey) return;
    lastJudgeKey = key;
    const hit = targets.find(h => targetKey(h) === key);
    if (!hit) {
      if (!completed) feedbackWrong(info, nextTarget());
      return;
    }
    if (done[hit.degree]) {
      const next = nextTarget();
      if (!completed) {
        selectKey(key, { keepFeedback: true });
        paintFeedback(tr('Этот аккорд уже взят.') + ' ' +
          (next ? tr('Сыграйте оставшийся:') + ' <b>' + escHtml(next.degree) + '</b>.' : ''), 'info');
      }
      return;
    }
    done[hit.degree] = true;
    const next = nextTarget();
    completed = targets.length > 0 && targets.every(h => done[h.degree]);
    renderTargets();
    // После удачного аккорда панель сама показывает следующий шаг; взятая
    // карточка остаётся отмеченной галочкой и зелёным состоянием.
    if (next) selectKey(targetKey(next), { keepFeedback: true });
    else selectKey(key, { keepFeedback: true });
    paintControls();
    if (completed) feedbackDone();
    else feedbackHit(hit);
  }
  function handleNotes() {
    if (lost) return;
    const pcs = notePcs();
    if (pcs.length === 3) judge();
    else if (!completed && pcs.length) feedbackNote(pcs);
  }
  function noteOn(note, vel) {
    if (!active || state.started) return;
    const v = clamp(vel == null ? 0.8 : vel, 0.05, 1);
    notes.set(note, v);
    heardAny = true;
    paintCheck();
    // На знакомстве звучит тот же фортепианный голос, что и в игре, но без
    // автотрезвучия: здесь важно услышать ровно взятые ноты.
    if (state.echo) {
      try {
        initAudio();
        echoNote(note, v, 0);
      } catch (e) { /* браузер ещё ждёт жест — MIDI-события продолжают работать */ }
    }
    paintLive();
    handleNotes();
  }
  function noteOff(note) {
    if (!active) return;
    notes.delete(note);
    if (notes.size === 0) lastJudgeKey = '';
    if (state.echo && typeof pianoRelease === 'function') pianoRelease(note, false);
    paintLive();
  }
  function panic() {
    if (!active) return;
    notes.clear();
    lastJudgeKey = '';
    paintLive();
    if (!completed) paintFeedback(tr('Ноты сброшены. Сыграйте аккорд снова.'), 'info');
  }

  // ===== Жизненный цикл экрана =====
  function resetState() {
    completed = false;
    heardAny = false;
    lost = false;
    targets = [];
    done = Object.create(null);
    notes.clear();
    selectedKey = '';
    lastJudgeKey = '';
  }
  function open() {
    if (state.started) return false;
    if (!(typeof Midi !== 'undefined' && Midi.hasDevice())) return false;
    if (active) {
      // Повторный open — это возврат устройства или повторный вызов из
      // Midi.refresh(): не сбрасываем уже взятые аккорды.
      lost = false;
      heardAny = notes.size > 0 || heardAny;
      paintDevice();
      paintCheck();
      paintControls();
      renderTargets();
      if (completed) feedbackDone();
      else if (!notes.size) feedbackIdle();
      const currentFallback = $('miFallback');
      if (currentFallback) currentFallback.hidden = true;
      return true;
    }
    active = true;
    resetState();
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
    selectedKey = nextTarget() ? targetKey(nextTarget()) : (targets[0] ? targetKey(targets[0]) : '');
    const fallback = $('miFallback');
    if (fallback) fallback.hidden = true;
    paintDevice();
    paintCheck();
    paintControls();
    renderTargets();
    paintLive();
    feedbackIdle();
    return true;
  }
  function close() {
    active = false;
    resetState();
    const box = overlay();
    if (box) box.classList.remove('midi');
    const coachBox = coach();
    if (coachBox) coachBox.hidden = true;
  }
  function enter() {
    // Явный вход: после третьего аккорда новичок читает «готово» столько,
    // сколько нужно, и сам нажимает «Начать игру» или Space.
    if (!active || !completed || lost) return;
    close();
    if (typeof beginFromOverlay === 'function') beginFromOverlay();
  }
  function skip() {
    if (!active) return;
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
    lost = true;
    notes.clear();
    lastJudgeKey = '';
    paintLive();
    const dev = $('miDevice');
    if (dev) dev.textContent = tr('MIDI отключена');
    paintCheck();
    renderTeach();
    paintControls();
    paintFeedback(tr('MIDI отключена — подключите клавиатуру снова.'), 'warn');
    const fallback = $('miFallback');
    if (fallback) fallback.hidden = false;
  }
  // Смена языка/нотации во время знакомства: пересобираем всё, что собрано
  // из строк, а не оставляем старые подписи до следующего MIDI-события.
  function feedbackCurrent() {
    if (lost) {
      paintFeedback(tr('MIDI отключена — подключите клавиатуру снова.'), 'warn');
      return;
    }
    if (completed) { feedbackDone(); return; }
    const pcs = notePcs();
    if (!pcs.length) { feedbackIdle(); return; }
    if (pcs.length < 3) { feedbackNote(pcs); return; }
    const info = currentTriad();
    if (!info) {
      paintFeedback(tr('Три ноты, но это не трезвучие: нужны корень, терция и квинта.'), 'warn');
      return;
    }
    const hit = targets.find(h => targetKey(h) === targetKey(info));
    if (hit && done[hit.degree]) { feedbackSelect(hit); return; }
    const label = info.degree || info.name || '';
    const hint = info.hint && info.hint !== label ? ' · ' + tr(info.hint) : '';
    paintFeedback(tr('Прозвучал') + ' <b>' + escHtml(label) + '</b>' +
      escHtml(hint) + '.', 'info');
  }
  function refresh() {
    if (!active) return;
    paintDevice();
    paintCheck();
    paintControls();
    renderTargets();
    feedbackCurrent();
  }
  function go(n) {
    if (!active) return false;
    const index = Math.max(0, Math.min(targets.length - 1, (Number(n) || 1) - 1));
    const h = targets[index];
    return h ? selectKey(targetKey(h)) : false;
  }
  function stateOf() {
    const next = nextTarget();
    return {
      active: active,
      completed: completed,
      heardAny: heardAny,
      lost: lost,
      selected: selectedKey,
      next: next ? next.degree : '',
      targets: targets.map(h => ({
        degree: h.degree, pcs: h.pcs.slice(), names: (h.names || []).slice(),
        key: targetKey(h), done: !!done[h.degree], state: targetState(h)
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
    const host = targetHost();
    if (host) {
      host.addEventListener('click', e => {
        const btn = e.target && e.target.closest ? e.target.closest('.mi-target') : null;
        if (!btn || !host.contains(btn)) return;
        selectKey(btn.dataset.pcsKey);
      });
    }
    paintControls();
  }
  init();

  return {
    get active() { return active; },
    get completed() { return completed; },
    open, close, enter, skip, deviceLost, noteOn, noteOff, panic, refresh,
    go,
    fallback: fallbackToKeyboard,
    state: stateOf
  };
})();
