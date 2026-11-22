/* HARMONIA · js/scene.js — канвасы, семь шаров-ступеней, частицы, палитра, очистка пера
   Модуль без сборки: подключается <script> в index.html до main.js.
   Все модули делят глобальную область — имена функций/констант уникальны. */

// ===== Сцена =====
const penCanvas = $('penCanvas'), penCtx = penCanvas.getContext('2d');
const spriteCanvas = $('spriteCanvas'), spriteCtx = spriteCanvas.getContext('2d');
// Центр сцены 800×540: орбиты стоят ровно по центру, HUD живёт по краям.
const RING_CX = 400, RING_CY = 270;
const rhythmSprite = { baseRadius: 24, radius: 24 };
let balls = [];
let sunColor = PALETTES.neon.sun;
const flashes = [], ripples = [], motes = [], particles = [];
function newParticle() {
  const pal = PALETTES[P.palette].balls;
  return {
    x: Math.random() * 800, y: Math.random() * 540,
    vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 12,
    r: 0.6 + Math.random() * 1.3,
    c: pal[Math.floor(Math.random() * pal.length)],
    a: 0.08 + Math.random() * 0.14
  };
}
function syncParticles() {
  while (particles.length < P.particles) particles.push(newParticle());
  if (particles.length > P.particles) particles.length = P.particles;
}
function applyPalette() {
  const pal = PALETTES[P.palette];
  sunColor = pal.sun;
  balls.forEach((b, i) => { b.color = pal.balls[i]; });
  particles.forEach(p => { p.c = pal.balls[Math.floor(Math.random() * pal.balls.length)]; });
}
// Семь шаров — семь ступеней лада: один шар на pitch class, поэтому любой аккорд
// палитры (и распознанный с MIDI) зажигает ровно три шара. Октава читается
// радиусом: r = rMax·2^(Δ/12) от верхней ступени, а не парой шаров.
function buildBalls() {
  const c = combo(), T = rootMidi(), top = T + 11;
  balls = diatonicPalette().map((slot, i) => {
    const midi = T + slot.offset;
    const r = CFG.rMax * Math.pow(2, (midi - top) / 12);
    return {
      midi, pc: ((midi % 12) + 12) % 12, name: c.scaleNames[i + 1],
      color: PALETTES[P.palette].balls[i], idx: i,
      r, phi: 0, boost: 0, theta: 0, ringsDone: 0,
      x: RING_CX + r, y: RING_CY, baseRadius: 12, radius: 12,
      hist: [], hold: null, sustainLatch: false, sustainAt: 0
    };
  });
  state.energy = balls.map(() => 0);
}
function clearPen() {
  penCtx.clearRect(0, 0, penCanvas.width, penCanvas.height);
  flashes.length = 0; ripples.length = 0; motes.length = 0;
  balls.forEach(b => { b.theta = 0; b.ringsDone = 0; b.hist.length = 0; });
}
