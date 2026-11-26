/* HARMONIA · js/midi.js — Web MIDI: устройства, ноты, педаль, выбор звука
   Модуль без сборки: подключается <script> в index.html до main.js.
   Все модули делят глобальную область — имена функций/констант уникальны. */

// ===== MIDI: клавиатура как слух приложения =====
// Каждая нота звучит своей высотой (echoNote — если звучит ноутбук), регистрируется
// в Heard и участвует в распознавании трезвучий. Note-off и CC64 ведут «хвосты»,
// velocity — громкость и яркость фортепианного голоса. Пэды — в Midi.handle().
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
  noteFrame: 0,
  lastNote: '',
  optionSig: '',
  init() {
    if (!navigator.requestMIDIAccess) {
      setMidiStatus('error', 'Web MIDI не поддерживается браузером');
      $('midiHint').textContent = 'Этот браузер не умеет Web MIDI — играйте с клавиатуры.';
      return;
    }
    if (this.access) return;
    // sysex не нужен: доступ без него выдаётся быстрее и не пугает лишним
    // разрешением. Сообщения note-on/off приходят тем же путём.
    navigator.requestMIDIAccess({ sysex: false }).then(access => {
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
  hasDevice() { return !!this.devName; },
  // Аудиотракт лучше открыть до первой ноты: создание AudioContext и графа
  // занимает время, и первый note-on не должен платить за него. Если браузер
  // ещё ждёт жест, контекст останется suspended — его разбудит первый ввод.
  warmAudio() {
    if (!state.echo) return;
    try { initAudio(); } catch (e) { /* браузер ждёт пользовательский жест */ }
  },
  // Подключённая MIDI-клавиатура отменяет пробу компьютерных клавиш, но не
  // саму игру: человек сначала проходит короткое знакомство с обозначениями
  // и тремя аккордами (MidiIntro), а уже оттуда входит в сессию.
  skipKeyboardIntro() {
    if (state.started || !this.devName) return false;
    if (typeof MidiIntro !== 'undefined' && MidiIntro.open()) return true;
    if (typeof beginFromOverlay !== 'function') return false;
    beginFromOverlay();
    return true;
  },
  // Строка состояния не должна перестраивать DOM на каждую ноту: на быстрой
  // игре это заметная работа в главном потоке. Один кадр — одна подпись.
  flashNote(note) {
    this.lastNote = midiNoteName(note);
    if (this.noteFrame) return;
    this.noteFrame = requestAnimationFrame(() => {
      this.noteFrame = 0;
      if (this.devName && this.lastNote) {
        setMidiStatus('online', 'MIDI: ' + this.devName + ' · ' + this.lastNote);
      }
    });
  },
  refresh() {
    if (!this.access) return;
    this.inputs = Array.from(this.access.inputs.values());
    const sel = $('pMidiIn');
    const options = '<option value="">— нет —</option>' +
      this.inputs.map(i => `<option value="${i.id}">${i.name || i.id}</option>`).join('');
    const optionSig = this.inputs.map(i => `${i.id}|${i.name || i.id}`).join('\n');
    if (optionSig !== this.optionSig) {
      this.optionSig = optionSig;
      sel.innerHTML = options;
    }
    if (this.activeId && !this.inputs.some(i => i.id === this.activeId)) this.activeId = null;
    if (!this.activeId && this.inputs.length) this.activeId = this.inputs[0].id;
    sel.value = this.activeId || '';
    // Слушаем только выбранный вход. Остальные отвязываются: лишний callback
    // на каждом устройстве не нужен, а при смене входа старые ноты не звучат.
    this.inputs.forEach(input => {
      const active = input.id === this.activeId;
      if (active && !input.__rithmBound) {
        input.__rithmBound = true;
        input.onmidimessage = (msg) => this.handle(msg);
      } else if (!active && input.__rithmBound) {
        input.__rithmBound = false;
        input.onmidimessage = null;
      }
    });
    const dev = this.inputs.find(i => i.id === this.activeId);
    this.devName = dev ? (dev.name || 'MIDI-вход') : '';
    if (dev) {
      this.resolveEcho(dev);
      this.warmAudio();
      if (typeof MidiIntro !== 'undefined') MidiIntro.open();
      else this.skipKeyboardIntro();
      setMidiStatus('online', 'MIDI: ' + this.devName);
      $('midiHint').textContent = 'Играйте: трезвучие становится аккордом, ноты — голосами. Педаль (CC64) держит звук, паника — CC120/CC123.';
    } else {
      // Устройство отключилось: «зажатые» ноты иначе остались бы в слухе навсегда,
      // а фортепианные голоса — звучать без клавиатуры.
      Heard.clear();
      if (typeof pianoAllOff === 'function') pianoAllOff();
      if (typeof MidiIntro !== 'undefined') MidiIntro.deviceLost();
      this.lastNote = '';
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
  select(id) {
    const next = id || null;
    if (next === this.activeId) return;
    Heard.clear();
    if (typeof pianoAllOff === 'function') pianoAllOff();
    this.activeId = next;
    this.refresh();
  },
  handle(msg) {
    if (!this.activeId || (msg.target && msg.target.id !== this.activeId)) return;
    if (exportBusy()) return;
    const data = msg.data;
    if (!data || data.length < 2) return;
    const type = data[0] & 0xf0;
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
      // CC64 — сустейн-педаль, CC120/CC123 — all sound/notes off («паника»).
      if (data[1] === 64) this.pedal(data[2] >= 64);
      else if (data[1] === 120 || data[1] === 123) this.panic();
    }
  },
  pedal(on) {
    // На знакомстве педаль не нужна: три аккорда проверяются по зажатым нотам,
    // а хвосты после входа всё равно сбросит startSession().
    if (!state.started && typeof MidiIntro !== 'undefined' && MidiIntro.active) return;
    Heard.setSustain(on);
    // Подъём педали должен быть слышен сразу: фортепианные голоса и хвосты
    // автотрезвучий не ждут естественного затухания.
    if (!on && typeof dampPedalVoices === 'function') dampPedalVoices();
    if (this.devName) setMidiStatus('online', 'MIDI: ' + this.devName + (on ? ' · педаль' : ''));
  },
  // Любая нажатая нота — это нота: своя высота, своя громкость, участие в
  // распознавании. Никакой таблицы «эта клавиша = этот аккорд» больше нет.
  noteOn(note, vel) {
    // До старта MIDI-нота принадлежит знакомству: она звучит и учит брать
    // аккорды, но не попадает в счёт, запись или исследование.
    if (!state.started && typeof MidiIntro !== 'undefined' && MidiIntro.active) {
      MidiIntro.noteOn(note, vel);
      return;
    }
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
      scheduleNoteChord(note, v, pan, 'midi');
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
    this.flashNote(note);
  },
  noteOff(note) {
    if (!state.started && typeof MidiIntro !== 'undefined' && MidiIntro.active) {
      MidiIntro.noteOff(note);
      return;
    }
    const pc = ((note % 12) + 12) % 12;
    // Педаль решает судьбу голоса: под ней отпущенная клавиша продолжает
    // звучать до CC64=0, без неё гаснет сразу после отпускания.
    const pedal = Heard.sustain;
    // Сначала отпускаем звук, потом обновляем «Слышу»: задержка release не
    // должна зависеть от перерисовки HUD.
    if (state.echo && typeof pianoRelease === 'function') pianoRelease(note, pedal);
    Heard.off(note);
    // Шар гаснет, только если эта ступень больше не держится ни в какой октаве.
    const stillHeld = Heard.midis().some(m => ((m % 12) + 12) % 12 === pc);
    if (!stillHeld) balls.forEach(b => { if (b.midiHeld && b.pc === pc) b.midiHeld = false; });
    // Отпущенные MIDI-клавиши больше не блокируют отложенную smart-раскладку.
    if (typeof scheduleAdaptiveApply === 'function') scheduleAdaptiveApply();
  },
  panic() {
    if (typeof MidiIntro !== 'undefined' && MidiIntro.active) MidiIntro.panic();
    Heard.clear();
    if (typeof cancelPendingNoteChord === 'function') cancelPendingNoteChord();
    if (typeof pianoAllOff === 'function') pianoAllOff();
    if (typeof dampPedalVoices === 'function') dampPedalVoices();
    this.lastNote = '';
    balls.forEach(b => { b.midiHeld = false; holdStop(b); });
    if (typeof scheduleAdaptiveApply === 'function') scheduleAdaptiveApply();
  }
};
