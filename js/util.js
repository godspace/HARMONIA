/* HARMONIA · js/util.js — общие помощники (без зависимостей)
   Подключается первым: им пользуются данные, гармония, сцена и интерфейс. */

// Короткий доступ к DOM по id — используется во всех модулях.
const $ = id => document.getElementById(id);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);

// Названия нот в COMBOLIST русские и с любыми знаками альтерации (в т.ч. двойными).
// Поддерживаем оба типографских варианта: #/♯ — диез, b/♭ — бемоль, x — дубль-диез.
// Без ♯ в этом классе CSV с «соль♯» молча читался бы как «соль».
const BASE_PC = { 'до': 0, 'ре': 2, 'ми': 4, 'фа': 5, 'соль': 7, 'ля': 9, 'си': 11 };
function notePc(name) {
  const m = name.match(/^(до|ре|ми|фа|соль|ля|си)([#♯♭b♮x]*)$/);
  if (!m) return NaN;
  let pc = BASE_PC[m[1]];
  for (const ch of m[2]) {
    if (ch === '#' || ch === '♯') pc += 1;
    else if (ch === 'x') pc += 2;
    else if (ch === '♭' || ch === 'b') pc -= 1;
    // ♮ — натуральная нота: уже учтена в BASE_PC.
  }
  return ((pc % 12) + 12) % 12;
}

// ===== Нотация: до-ре-ми и C-D-E =====
// COMBOLIST хранит ноты по-русски (до, фа♯, си♭) — это первоисточник, и трогать
// его ради подписей нельзя. Но для англоязычного игрока «до-ми-соль» — ребус, а
// Google Translate нотацию не переводит (и не должен: «соль» — это ещё и соль,
// а «J» превращается в «ICH»). Поэтому все подписи проходят через noteLabel():
// при P.notation === 'letters' «до-ми-соль» становится C-E-G, а тональность —
// «C major». Музыка при этом не меняется: pitch classes остаются числами.
const NOTE_LETTER = { 'до': 'C', 'ре': 'D', 'ми': 'E', 'фа': 'F', 'соль': 'G', 'ля': 'A', 'си': 'B' };
const LETTER_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const SOLFEGE_LANGS = { ru: 1, uk: 1 };
function usingLetterNames() { return typeof P !== 'undefined' && P.notation === 'letters'; }
// Имя ноты из CSV в буквах: «ре♭» → «D♭», «фа♯» → «F♯», «ре♯♯» → «D♯♯».
// Знак альтерации сохраняется: в бемольной тональности D♭ читается, а C♯ — нет.
function letterNoteName(name) {
  const raw = String(name == null ? '' : name);
  const m = raw.match(/^(до|ре|ми|фа|соль|ля|си)([#♯♭b♮x]*)$/);
  if (!m) return raw;
  let out = NOTE_LETTER[m[1]];
  for (const ch of m[2]) {
    if (ch === '#' || ch === '♯') out += '♯';
    else if (ch === '♭' || ch === 'b') out += '♭';
    else if (ch === 'x') out += '♯♯'; // дубль-диез: рендерится в любом шрифте
  }
  return out;
}
// Подпись ноты в текущей нотации — единственная точка, через которую имена нот
// попадают в DOM и на сцену.
function noteLabel(name) { return usingLetterNames() ? letterNoteName(name) : String(name == null ? '' : name); }
// Хроматическая нота по pitch class, когда ступень не входит в лад.
function sharpLabel(pc) {
  const p = ((Math.round(pc) % 12) + 12) % 12;
  return usingLetterNames() ? LETTER_NAMES[p] : SHARP_NAMES[p];
}
// Трезвучие: ['до','ми','соль'] → «До-Ми-Соль» / «C-E-G».
function chordLabel(names) {
  return (names || []).map(n => cap(noteLabel(n))).join('-');
}
// Тональность комбо: «До мажор» / «C major». keyNameLatin считается при разборе
// CSV и не зависит от текущего выбора, поэтому переключение нотации мгновенно.
function keyNameOf(c) {
  if (!c) return '';
  return usingLetterNames() ? (c.keyNameLatin || c.keyName || '') : (c.keyName || '');
}
