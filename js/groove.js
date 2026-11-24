/* HARMONIA · js/groove.js — необязательный грув: барабаны играют сами
   Модуль без сборки: подключается <script> в index.html после transport.js.
   Все модули делят глобальную область — имена функций/констант уникальны.

   Зачем отдельный слой: свободный джем HARMONIA сознательно живёт без долей, а
   пульс появляется только вместе с пьесой. Грув даёт джему сетку, не включая
   форму: он не начисляет очки, не трогает гармонию и не записывается. Ручная
   игра на барабанах — только с MIDI-пэда (канал 10, js/midi.js), поэтому
   игровые клавиши, проба пальцев и легенда остаются прежними.

   Часы: пока идёт пьеса, грув садится на сетку Transport (иначе метроном и
   барабаны разъезжаются), а в джеме считает от собственного t0 на P.grooveBpm.
   Удары планируются с упреждением по часам AudioContext — тот же приём, что у
   метронома, только сетка шестнадцатыми. */

const GROOVE_LANES = ['kick', 'snare', 'hat'];

// Паттерн в CFG.groove.patterns — строки шагов, а не аудио: 'o' — акцент,
// 'x' — удар, 'g' — тихий «призрак», '.' — тишина. 16 шагов на такт 4/4,
// 12 — на такт 3/4.
function groovePattern(id) {
  const patterns = CFG.groove.patterns;
  return patterns[id] || patterns.straight;
}

// Шаги под конкретный размер. Паттерн 4/4 в размере 3/4 обрезается до первых
// 12 шагов — фигура звучит «как есть», а не растягивается. Вальс, наоборот,
// задаёт 12 шагов сам и в 4/4 не растягивается (см. Groove.meter).
function grooveSteps(id, meter) {
  const p = groovePattern(id);
  const perBar = (Number(meter) === 3 ? 3 : 4) * 4;
  const lanes = {};
  GROOVE_LANES.forEach(name => {
    let row = String(p[name] || '');
    while (row.length < perBar) row += '.';
    lanes[name] = row.slice(0, perBar).split('').map(ch =>
      ch === 'o' ? 1 : ch === 'x' ? 0.72 : ch === 'g' ? 0.42 : 0);
  });
  return { lanes, perBar, swing: p.swing || 0 };
}

// План шага: что звучит на этом шаге. Чистая функция без побочек — по образцу
// noteChordPlan(): smoke-тест проверяет её без AudioContext, а Groove.update()
// только назначает время.
function groovePlan(id, step, meter) {
  const grid = grooveSteps(id, meter);
  const idx = ((Math.round(step) % grid.perBar) + grid.perBar) % grid.perBar;
  const hits = [];
  GROOVE_LANES.forEach(kind => {
    const vel = grid.lanes[kind][idx];
    if (vel > 0) hits.push({ kind, vel, step: idx });
  });
  return hits;
}

const Groove = {
  on: false,
  patternId: 'ballad',
  hits: 0,
  // Стартовая проба: сессия ещё не начата, а барабаны уже звучат — иначе
  // клавишу Enter на экране знакомства нечем проверить. Снимается стартом
  // сессии, поэтому в игре грув живёт только по обычным правилам.
  preview: false,
  _src: '',
  _ownT0: 0,
  _mark: null,
  _pausedAt: 0,

  _now() { return performance.now() / 1000; },

  // Источник часов. Он же признак для панели: «ведёт пьеса» или свой темп.
  _clockSource() {
    return state.form && state.form.running &&
      typeof Transport !== 'undefined' && Transport.running ? 'form' : 'jam';
  },

  bpm() {
    if (this._clockSource() === 'form') return Number(Transport.bpm) || P.formBpm || 84;
    return clamp(Number(P.grooveBpm) || DEFAULTS.grooveBpm, 40, 200);
  },

  // В пьесе размер задаёт транспорт (4/4 или 3/4), в джеме — сам паттерн:
  // «вальс» и есть просьба играть на три.
  meter() {
    if (this._clockSource() === 'form') return Number(Transport.beatsPerBar) === 3 ? 3 : 4;
    return groovePattern(this.patternId).meter === 3 ? 3 : 4;
  },

  // Включение заодно открывает аудиотракт: первый удар нельзя планировать в
  // закрытый AudioContext, а клик по кнопке — как раз пользовательский жест.
  setOn(value) {
    const next = !!value;
    P.grooveOn = next;
    if (next === this.on) return this.on;
    this.on = next;
    if (!next) this.preview = false;
    this._src = '';
    this._mark = null;
    if (next && typeof initAudio === 'function') initAudio();
    this.paint();
    return this.on;
  },

  // Проба пальцев: Enter включает барабаны до первой ноты. Часы свои — сцена
  // ещё не live; сессия подхватывает уже звучащий грув (onSessionStart снимает
  // preview и пересчитывает t0), поэтому пульс не обрывается на старте.
  startPreview() {
    if (typeof initAudio === 'function') initAudio();
    this.preview = true;
    this.setOn(true);
    this._src = 'jam';
    this._ownT0 = this._now();
    this._mark = null;
    return this.on;
  },

  setPattern(id) {
    const next = CFG.groove.patterns[id] ? id : 'straight';
    P.groovePattern = next;
    if (next !== this.patternId) {
      this.patternId = next;
      // Сетку не сбрасываем: новый паттерн вступает со следующего шага, иначе
      // перебор фигур в панели дёргал бы пульс назад в начало такта.
      this._mark = null;
    }
    this.paint();
    return next;
  },

  setBpm(value) {
    const next = clamp(Number(value) || DEFAULTS.grooveBpm, 40, 200);
    P.grooveBpm = next;
    // Темп меняется на лету: шаг пересчитывается в новых длительностях, и
    // следующая шестнадцатая просто оказывается ближе или дальше.
    this._mark = null;
    this.paint();
    return next;
  },

  // Новая сессия — новый отсчёт: старые часы джема больше не имеют смысла.
  // Проба могла оставить грув звучащим, но «стартовый» режим снимается: дальше
  // барабаны подчиняются обычным правилам сессии (пауза, часы формы).
  onSessionStart() {
    this.preview = false;
    this._src = '';
    this._mark = null;
    this.hits = 0;
    this.paint();
  },

  // Пауза не должна «проглатывать» время: в джеме собственный t0 сдвигается на
  // длительность паузы, в пьесе это уже делает Transport.resume().
  setPaused(paused) {
    if (paused) { this._pausedAt = this._now(); return; }
    if (!this._pausedAt) return;
    const delta = this._now() - this._pausedAt;
    this._pausedAt = 0;
    if (this._clockSource() === 'jam') this._ownT0 += delta;
    this._mark = null;
  },

  // Вызывается каждый кадр из render.js, пока сессия live и не на паузе.
  // Исключение — preview: стартовый экран ещё не начал сессию, но грув уже
  // должен звучать, иначе Enter на пробе ничего не демонстрирует.
  update() {
    if (!this.on || state.paused) return false;
    // Прослушивание и экспорт видео идут по записанной дорожке: живой грув в это
    // время молчит, иначе к записанным ударам добавился бы второй набор.
    if (state.replay || state.videoExport) return false;
    if (!state.running && !this.preview) return false;
    if (typeof audioCtx === 'undefined' || !audioCtx) return false;
    const now = this._now();
    const src = this._clockSource();
    if (src !== this._src) {
      this._src = src;
      this._ownT0 = now;
      this._mark = null;
      this.paint();   // панели пора показать «ведёт пьеса» или свой темп
    }
    const base = src === 'form' ? (Number(Transport._t0) || now) : this._ownT0;
    const dur = 60 / this.bpm() / 4;
    const pos = (now - base) / dur;
    if (!isFinite(pos)) return false;
    const swing = grooveSteps(this.patternId, this.meter()).swing;
    const horizon = CFG.groove.lookahead;
    let mark = this._mark;
    // _mark — последний уже запланированный шаг. Из-за упреждения он может
    // опережать часы на несколько шагов; это не «перемотка назад». Сброс нужен
    // только при реальном откате часов или долгом пропуске кадров.
    const leadSteps = Math.ceil(horizon / dur) + 1;
    if (mark == null || pos < mark - leadSteps || Math.abs(pos - mark) > 8) {
      mark = Math.floor(pos);
    }
    let guard = 0;
    while (guard++ < 8) {
      const step = mark + 1;
      const wall = base + step * dur + (swing > 0 && step % 2 ? dur * swing * 0.5 : 0);
      if (wall > now + horizon) break;
      // Слишком старый шаг (долгий кадр) не играем: он был бы слышен как «догон».
      if (wall >= now - 0.05) this._fire(step, wall, now);
      mark = step;
    }
    this._mark = mark;
    return true;
  },

  _fire(step, wall, now) {
    const hits = groovePlan(this.patternId, step, this.meter());
    if (!hits.length) return;
    const when = audioCtx.currentTime + Math.max(0, wall - now);
    hits.forEach(hit => {
      if (typeof drumHit === 'function') drumHit(hit.kind, when, hit.vel);
      // wall — время на часах performance.now(), когда удар прозвучит. Рекордер
      // ждёт этот момент и пишет удар уже по фактическому звучанию.
      if (typeof recordDrumAt === 'function') recordDrumAt(hit.kind, hit.vel, wall * 1000);
    });
    this.hits += hits.length;
  },

  // Панель: подписи и доступность ползунка темпа. Пишем только при изменении,
  // иначе MutationObserver языкового пакета дёргался бы на каждом кадре.
  paint() {
    const btn = $('grooveToggle');
    if (btn) {
      const label = this.on ? 'Барабаны: вкл' : 'Барабаны: выкл';
      if (btn.getAttribute('aria-pressed') !== String(this.on)) {
        btn.setAttribute('aria-pressed', String(this.on));
      }
      if (btn.textContent !== label) btn.textContent = label;
    }
    const sel = $('groovePattern');
    if (sel && sel.value !== this.patternId) sel.value = this.patternId;
    const lead = this.on && this._clockSource() === 'form';
    const bpm = $('pGrooveBpm');
    if (bpm) {
      if (bpm.disabled !== lead) bpm.disabled = lead;
      // В пьесе ползунок показывает собственный темп джема, а не темп пьесы:
      // иначе после остановки он остался бы на чужом значении.
      const value = String(Math.round(Number(P.grooveBpm) || DEFAULTS.grooveBpm));
      if (!lead && bpm.value !== value) bpm.value = value;
    }
    const out = $('vGrooveBpm');
    if (out) {
      const text = lead ? 'ведёт пьеса' : this.bpm() + ' BPM';
      if (out.textContent !== text) out.textContent = text;
    }
    const status = $('grooveStatus');
    if (status) {
      const text = this.statusText();
      if (status.textContent !== text) status.textContent = text;
    }
  },

  // Статус собирается из коротких кусков через « · »: языковой пакет режет
  // такие строки по разделителям и переводит каждую часть.
  statusText() {
    if (!this.on) return 'Грув выключен: джем идёт без долей.';
    const label = groovePattern(this.patternId).label;
    const tempo = this._clockSource() === 'form'
      ? 'ведёт пьеса'
      : 'свой темп · ' + this.bpm() + ' BPM';
    return 'Грув: ' + label + ' · ' + tempo;
  }
};

// Enter и кнопка панели делают одно и то же: ключ — такой же пользовательский
// жест, поэтому аудиотракт открывается и здесь. Выключение молчит сразу:
// setOn сбрасывает часы, и следующий шаг уже не планируется.
function toggleGroove() {
  if (typeof Groove === 'undefined') return false;
  if (typeof initAudio === 'function') initAudio();
  return Groove.setOn(!Groove.on);
}
