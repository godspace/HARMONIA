/* HARMONIA · js/midi.js — Web MIDI: устройства, ноты, педаль, выбор звука
   Модуль без сборки: подключается <script> в index.html до main.js.
   Все модули делят глобальную область — имена функций/констант уникальны. */

// ===== MIDI: клавиатура как слух приложения =====
// Каждая нота звучит своей высотой (echoNote — если звучит ноутбук), регистрируется
// в Heard и участвует в распознавании трезвучий. Note-off и CC64 ведут «хвосты»,
// velocity — громкость. Расширение (послекасание, пэды) — в Midi.handle().
function midiNoteName(note) {
  return sharpLabel(note) + (Math.floor(note / 12) - 1);
}
function setMidiStatus(kind, text) {
  const el = $('midi-status');
  el.classList.toggle('online', kind === 'online');
  el.classList.toggle('error', kind === 'error');
  $('midiText').textContent = text;
}
// Шар этой ступени: в ладе ровно один шар на pitch class, поэтому октава не важна.
function closestBall(note, pc) {
  let best = null;
  balls.forEach(b => {
    if (b.pc !== pc) return;
    if (!best || Math.abs(b.midi - note) < Math.abs(best.midi - note)) best = b;
  });
  return best;
}
// Пианино со встроенными динамиками звучит само, контроллер — нет. Эвристика
// по имени устройства: производители узнаваемы, а спорный случай всегда решается
// переключателем «Звук» в топбаре (выбор помнится по устройству).
const MIDI_CONTROLLER = /(microkey|micro key|nanokey|minilab|keylab|keystep|launchkey|mpk|mini|oxygen|arturia|novation|akai|alesis|nektar|m-?audio|worlde|irig|komplete|korg micro)/i;
const MIDI_PIANO = /(yamaha|roland|kawai|casio|clavia|nord|dgx|clp|ydp|korg b|korg c|p-?[0-9]{2,3}|fp-?[0-9]|es-?[0-9]{3}|px-?s?[0-9]|cp-?[0-9]|rd-?[0-9]|mp-?[0-9]|cn-?[0-9]|ap-?[0-9]|piano)/i;
const ECHO_KEY = 'rithm.echo.';
// Канал 10 (индекс 9) — стандартный набор ударных General MIDI. Пэд играет
// барабан, но не становится нотой: ритм не участвует в гармонии и счёте.
// Чего нет в таблице, звучит как тарелка — «что-то ударное» лучше тишины.
const DRUM_MAP = {
  35: 'kick', 36: 'kick',
  38: 'snare', 40: 'snare',
  42: 'hat', 44: 'hat',
  46: 'openhat',
  37: 'rim', 39: 'rim'
};
const Midi = {
  access: null,
  inputs: [],
  activeId: null,
  devName: '',
  retryArmed: false,
  init() {
    if (!navigator.requestMIDIAccess) {
      setMidiStatus('error', 'Web MIDI не поддерживается браузером');
      $('midiHint').textContent = 'Этот браузер не умеет Web MIDI — играйте с клавиатуры.';
      return;
    }
    if (this.access) return;
    navigator.requestMIDIAccess().then(access => {
      this.access = access;
      access.onstatechange = () => this.refresh(); // горячее подключение/отключение
      this.refresh();
    }).catch(() => {
      // Chrome выдаёт доступ только после действия пользователя — ждём первого нажатия.
      setMidiStatus('idle', 'MIDI: доступ по первому нажатию');
      $('midiHint').textContent = 'Браузер ждёт действия пользователя — нажмите любую клавишу или кнопку, чтобы разрешить MIDI.';
      this.armGestureRetry();
    });
  },
  armGestureRetry() {
    if (this.retryArmed) return;
    this.retryArmed = true;
    const retry = () => {
      window.removeEventListener('pointerdown', retry, true);
      window.removeEventListener('keydown', retry, true);
      this.retryArmed = false;
      this.init();
    };
    window.addEventListener('pointerdown', retry, true);
    window.addEventListener('keydown', retry, true);
  },
  refresh() {
    if (!this.access) return;
    this.inputs = Array.from(this.access.inputs.values());
    const sel = $('pMidiIn');
    sel.innerHTML = '<option value="">— нет —</option>' +
      this.inputs.map(i => `<option value="${i.id}">${i.name || i.id}</option>`).join('');
    if (this.activeId && !this.inputs.some(i => i.id === this.activeId)) this.activeId = null;
    if (!this.activeId && this.inputs.length) this.activeId = this.inputs[0].id;
    sel.value = this.activeId || '';
    this.inputs.forEach(input => {
      if (input.__rithmBound) return;
      input.__rithmBound = true;
      input.onmidimessage = (msg) => this.handle(msg);
    });
    const dev = this.inputs.find(i => i.id === this.activeId);
    this.devName = dev ? (dev.name || 'MIDI-вход') : '';
    if (dev) {
      this.resolveEcho(dev);
      setMidiStatus('online', 'MIDI: ' + this.devName);
      $('midiHint').textContent = 'Играйте: трезвучие становится аккордом, ноты — голосами. Педаль (CC64) держит звук, паника — CC123.';
    } else {
      // Устройство отключилось: «зажатые» ноты иначе остались бы в слухе навсегда.
      Heard.clear();
      setMidiStatus('idle', this.inputs.length ? 'MIDI: вход не выбран' : 'MIDI не обнаружена');
      $('midiHint').textContent = 'Подключите клавиатуру — она подхватится автоматически.';
    }
  },
  // Звук нот: сохранённый выбор пользователя важнее эвристики по имени модели.
  resolveEcho(dev) {
    let saved = null;
    try { saved = localStorage.getItem(ECHO_KEY + dev.id); } catch (e) { saved = null; }
    const name = dev.name || '';
    if (saved === '1' || saved === '0') state.echo = saved === '1';
    else state.echo = MIDI_CONTROLLER.test(name) ? true : MIDI_PIANO.test(name) ? false : true;
    paintSoundChip();
  },
  // Переключатель в топбаре: выбор запоминается для конкретного устройства.
  rememberEcho(on) {
    if (!this.activeId) return;
    try { localStorage.setItem(ECHO_KEY + this.activeId, on ? '1' : '0'); } catch (e) { /* приватный режим */ }
  },
  select(id) { this.activeId = id || null; Heard.clear(); this.refresh(); },
  handle(msg) {
    if (!this.activeId || (msg.target && msg.target.id !== this.activeId)) return;
    if (state.videoExport) return;
    const data = msg.data, type = data[0] & 0xf0;
    // Канал 10 — ударные. Ветка стоит первой и выходит сразу: пэд не попадает
    // ни в слух (Heard), ни в распознавание трезвучий, ни в счёт. Для записи он
    // остаётся ритмическим событием и идёт в отдельную дорожку drums.
    if ((data[0] & 0x0f) === 9) {
      if (type === 0x90 && data[2] > 0) {
        initAudio();
        const kind = DRUM_MAP[data[1]] || 'hat';
        const vel = data[2] / 127;
        drumHit(kind, null, vel);
        if (typeof recordDrumAt === 'function') recordDrumAt(kind, vel, performance.now());
      }
      return;
    }
    if (type === 0x90 && data[2] > 0) this.noteOn(data[1], data[2] / 127);
    else if (type === 0x80 || (type === 0x90 && data[2] === 0)) this.noteOff(data[1]);
    else if (type === 0xb0) {
      // CC64 — сустейн-педаль, CC123 — all notes off («паника»).
      if (data[1] === 64) this.pedal(data[2] >= 64);
      else if (data[1] === 123) this.panic();
    }
  },
  pedal(on) {
    Heard.setSustain(on);
    if (this.devName) setMidiStatus('online', 'MIDI: ' + this.devName + (on ? ' · педаль' : ''));
  },
  // Любая нажатая нота — это нота: своя высота, своя громкость, участие в
  // распознавании. Никакой таблицы «эта клавиша = этот аккорд» больше нет.
  noteOn(note, vel) {
    if (!state.started) beginFromOverlay();
    if (!playable()) return;
    const v = clamp(vel == null ? 0.8 : vel, 0.05, 1);
    const pc = ((note % 12) + 12) % 12;
    // Панорама по высоте одна для звука, записи и исследования.
    const pan = clamp((note - 60) / 48, -0.8, 0.8);
    // Контроллер без динамиков озвучиваем сами; stage piano звучит сам.
    // Автотрезвучие добавляем только к своему звуку: если играет пианино,
    // гармония уже в руках пианиста.
    if (state.echo) {
      initAudio();
      echoNote(note, v, Heard.sustain ? CFG.echoHold : 0);
      scheduleNoteChord(note, v, pan);
    }
    Heard.on(note, v);
    // Запись хранит реальную высоту MIDI, а не октаву ближайшего шара.
    if (!state.replay && typeof recordNote === 'function') {
      recordNote(note, v, pan, false);
    }
    // Исследование видит все MIDI-ноты, включая хроматику вне лада: шара у
    // такой ноты нет (triggerBall не зовётся), но игрок её слышал.
    if (!state.replay && typeof Research !== 'undefined') {
      Research.onNote(note, v, pan, false);
    }
    // Все MIDI-ноты, включая хроматику вне лада, попадают в мелодическую
    // статистику пьесы. Шар при withAudio=false повторно её не считает.
    if (!state.replay && typeof Composition !== 'undefined') Composition.onNote(note, v);
    const ball = closestBall(note, pc);
    if (ball) {
      ball.midiHeld = true;
      // Нота уже озвучена выше, шар только показывает её на сцене.
      triggerBall(ball, v, false);
    } else {
      // Хроматика вне лада: шара нет, но звук и «Слышу» работают.
      ripples.push({ x: RING_CX, y: RING_CY, color: '#b8c4e2', start: performance.now(), big: false });
    }
    if (this.devName) setMidiStatus('online', 'MIDI: ' + this.devName + ' · ' + midiNoteName(note));
  },
  noteOff(note) {
    const pc = ((note % 12) + 12) % 12;
    Heard.off(note);
    // Шар гаснет, только если эта ступень больше не держится ни в какой октаве.
    const stillHeld = Heard.midis().some(m => ((m % 12) + 12) % 12 === pc);
    if (!stillHeld) balls.forEach(b => { if (b.midiHeld && b.pc === pc) b.midiHeld = false; });
    // Отпущенные MIDI-клавиши больше не блокируют отложенную smart-раскладку.
    if (typeof scheduleAdaptiveApply === 'function') scheduleAdaptiveApply();
  },
  panic() {
    Heard.clear();
    if (typeof cancelPendingNoteChord === 'function') cancelPendingNoteChord();
    balls.forEach(b => { b.midiHeld = false; holdStop(b); });
    if (typeof scheduleAdaptiveApply === 'function') scheduleAdaptiveApply();
  }
};
