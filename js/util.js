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
