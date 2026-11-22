/* HARMONIA · js/listen.js — слух: зажатые ноты, педаль, распознавание трезвучий
   Модуль без сборки: подключается <script> в index.html до main.js.
   Все модули делят глобальную область — имена функций/констант уникальны. */

// ===== Слух приложения =====
// MIDI больше не переводится в «клавиша → аккорд»: любая нота звучит своей
// высотой, а зажатые ноты складываются в трезвучие. Поэтому одна и та же
// аппликатура в любой октаве даёт один и тот же аккорд.
// Реестр держит и отпущенные ноты под сустейн-педалью (CC64): они продолжают
// звучать и участвуют в распознавании, пока педаль нажата.
const Heard = {
  notes: new Map(),    // midi → velocity: клавиши нажаты прямо сейчас
  latched: new Map(),  // midi → velocity: клавиши отпущены, но держит педаль
  sustain: false,
  timer: null,
  lastKey: '',
  on(note, vel) {
    this.notes.set(note, vel == null ? 0.8 : vel);
    this.latched.delete(note);
    this.changed();
  },
  off(note) {
    if (!this.notes.has(note)) return;
    if (this.sustain) this.latched.set(note, this.notes.get(note));
    this.notes.delete(note);
    this.changed();
  },
  setSustain(on) {
    const was = this.sustain;
    this.sustain = !!on;
    // Педаль отпущена — «хвосты» гаснут вместе с ней.
    if (was && !this.sustain) this.latched.clear();
    this.changed();
  },
  clear() {
    this.notes.clear();
    this.latched.clear();
    this.sustain = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.lastKey = '';
    state.heard.pcs = [];
    state.heard.triad = null;
    state.heard.sustain = false;
    updateHeardChip();
  },
  midis() {
    const list = Array.from(this.notes.keys());
    this.latched.forEach((v, m) => { if (list.indexOf(m) === -1) list.push(m); });
    return list.sort((a, b) => a - b);
  },
  pcsOf(midis) {
    const pcs = [];
    midis.forEach(m => {
      const pc = ((m % 12) + 12) % 12;
      if (pcs.indexOf(pc) === -1) pcs.push(pc);
    });
    return pcs;
  },
  pcs() { return this.pcsOf(this.midis()); },
  heldPcs() { return this.pcsOf(Array.from(this.notes.keys())); },
  // Каждое изменение состава запускает короткую паузу: аккорд играют набором
  // нот «примерно одновременно», и распознавать его на первой же ноте рано.
  changed() {
    state.heard.pcs = this.pcs();
    state.heard.sustain = this.sustain;
    if (state.heard.pcs.length < 3) state.heard.triad = null;
    updateHeardChip();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.recognize(); }, CFG.recognizeMs);
  },
  recognize() {
    if (!playable()) return;
    // Под педалью звучат и старые ноты. Сначала пробуем зажатые: новая взятая
    // рукой тройка важнее «размазанного» звучания, затем — всё, что слышно.
    const held = this.heldPcs();
    const heldTriad = classifyTriad(held);
    const pcs = heldTriad ? held : this.pcs();
    if (pcs.length < 3) { this.lastKey = ''; return; }
    const key = pcs.slice().sort((a, b) => a - b).join(',');
    if (key === this.lastKey) return;
    this.lastKey = key;
    const info = describeTriad(pcs);
    if (!info.pcs || info.kind === 'unknown') { state.heard.triad = null; updateHeardChip(); return; }
    state.heard.triad = info;
    updateHeardChip();
    // Отдельные MIDI-ноты уже пишутся в запись; распознанный аккорд — только
    // визуально/для счёта, чтобы прослушивание не удваивало фактуру.
    chordEvent(info, null, 'midi');
  }
};
