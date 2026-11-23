/* HARMONIA · js/viz.js — реестр визуализаций сцены: орбиты, спектр, круг
   Модуль без сборки: подключается <script> в index.html до main.js.
   Все модули делят глобальную область — имена функций/констант уникальны. */

// ===== Визуализации =====
// Физика (phi, boost, theta, счётчик колец) живёт в render.js и от режима не зависит.
// Режим отвечает только за геометрию и картинку:
//   project(b, angle)      точка на экране для угла орбиты — ею же рисуется след;
//   guides(ctx, now)       фон: направляющие, оси, пояс аккорда;
//   center(ctx, now, live) центр сцены: солнце тоники или спектр сигнала;
//   ball(ctx, b, now)      хвост, тело и подпись шара;
//   ring(ctx, f, alpha)    вспышка полного оборота орбиты;
//   pen: false             режим не рисует шары и перо (так делает «круг»).
// Угол в каждом режиме — музыкальная координата, а не время: в «круге» это
// позиция в квинтовом круге, в «орбитах» — интеграл скорости.
const VIZ_ORDER = ['orbits', 'spectrum', 'circle'];
const VIZ = {};
const viz = () => VIZ[P.viz] || VIZ.orbits;
// Полоса сцены, свободная от карточек HUD (сверху — счёт/комбо/энергия, снизу — карточки аккордов).
// Геометрия любого режима обязана в неё попадать, иначе шары уезжают под панели.
const VIZ_SAFE_Y = [100, 428];

// ----- Примитивы, общие для всех режимов -----
// Солнце тоники: радиус пульсирует по state.clock, scale — множитель (RMS в спектре).
function vizSun(ctx, now, live, scale) {
  const pulse = live ? 0.3 + 0.3 * Math.sin(state.clock * 2.2) : 0.15;
  rhythmSprite.radius += (rhythmSprite.baseRadius - rhythmSprite.radius) * 0.15;
  const sunR = (rhythmSprite.radius + 4 * pulse) * (scale == null ? 1 : scale);
  const grad = ctx.createRadialGradient(RING_CX, RING_CY, 2, RING_CX, RING_CY, sunR * 2.2);
  grad.addColorStop(0, 'rgba(255,250,230,0.95)');
  grad.addColorStop(0.35, sunColor + '8c');
  grad.addColorStop(1, 'rgba(255,209,102,0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(RING_CX, RING_CY, sunR * 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(RING_CX, RING_CY, sunR, 0, Math.PI * 2);
  ctx.fillStyle = sunColor;
  ctx.shadowColor = sunColor;
  ctx.shadowBlur = P.glow + 18 * pulse;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.2 + 0.3 * pulse;
  ctx.strokeStyle = sunColor; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(RING_CX, RING_CY, sunR + 9, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
}
// Хвост шара: последние точки истории, ярче к голове.
function vizTrail(ctx, b) {
  if (!P.tails) return;
  const boostNorm = Math.min(1, b.boost / 300);
  b.hist.forEach((h, i) => {
    const f = (i + 1) / b.hist.length;
    ctx.globalAlpha = f * (0.10 + 0.22 * boostNorm);
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(h.x, h.y, b.radius * 0.55 * f, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;
}
// Тело шара: радиальный градиент, свечение и кольцо удержания.
function vizBody(ctx, b, now) {
  const bg = ctx.createRadialGradient(b.x - b.radius * 0.3, b.y - b.radius * 0.3, 1, b.x, b.y, b.radius);
  bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.35, b.color); bg.addColorStop(1, b.color);
  ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.shadowColor = b.color;
  ctx.shadowBlur = P.glow * 0.7 + Math.min(30, b.boost * 0.12) + ((b.hold || b.midiHeld) ? 14 : 0);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();
  if (b.hold) {
    ctx.strokeStyle = b.color;
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(now / 90);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.radius + 6, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
// Вспышка оборота: эллипс с полуосями rx/ry на высоте cy.
function vizRingFlash(ctx, f, alpha, rx, ry, cy) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = f.color;
  ctx.lineWidth = 2 + 6 * (1 - alpha);
  ctx.shadowColor = f.color; ctx.shadowBlur = P.glow + 8;
  ctx.beginPath(); ctx.ellipse(RING_CX, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
// Подпись шара: имя ноты с тёмной обводкой — читается поверх колец и свечения.
function vizBallLabel(ctx, b, x, y) {
  ctx.save();
  ctx.font = '700 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(8,10,16,0.85)';
  ctx.strokeText(b.name, x, y);
  ctx.fillStyle = b.color;
  ctx.fillText(b.name, x, y);
  ctx.restore();
}
// После смены геометрии старые точки истории и след не имеют смысла.
function resetVizLayers() {
  balls.forEach(b => { b.hist.length = 0; });
  clearPen();
}
// Смена режима — единственная точка входа для меню панели, клавиш 1–3
// и отладочного API. Геометрия другая, поэтому слои сбрасываются.
function setViz(key) {
  if (!VIZ[key]) return false;
  const changed = P.viz !== key;
  P.viz = key;
  if (changed) resetVizLayers();
  if (typeof paintVizMenu === 'function') paintVizMenu();
  if (changed) toast('Визуализация: ' + VIZ[key].label);
  return true;
}
// Следующий режим по кругу: цифры 1–3 выбирают напрямую, эта — для пульта.
function cycleViz() {
  setViz(VIZ_ORDER[(VIZ_ORDER.indexOf(P.viz) + 1) % VIZ_ORDER.length]);
}

// ===== Музыкальные примитивы режима «круг» =====
// Позиция pitch class в кварто-квинтовом круге относительно тоники:
//   0 — тоника, 1 — доминанта (V), 2 — II, 3 — VI, 11 — субдоминанта (IV).
// Формула (Δ·7) mod 12: умножение на 7 переводит полутоны в квинты,
// это обратимое отображение Z12 → Z12, поэтому у каждой ноты ровно одна станция.
function vizTonicPc() { return ((combo().root % 12) + 12) % 12; }
function vizFifthsStep(pc) {
  const d = (((pc - vizTonicPc()) % 12) + 12) % 12;
  return (d * 7) % 12;
}
// Цвет функции аккорда: читается без подписей — золото T, голубой S, красный D.
// «Краска» вне лада — приглушённый серо-голубой: она не должна спорить с функциями.
const VIZ_FUNC = {
  'тоника': '#ffd166', 'доминанта': '#ff5d7a', 'субдоминанта': '#6bdfff',
  'супертоника': '#74cc3d', 'медианта': '#a455e3', 'субмедианта': '#a455e3',
  'краска': '#9aa4c2'
};
function vizChordColor(h) { return VIZ_FUNC[h && h.hint] || '#ffffff'; }
// Аккорд, который звучит прямо сейчас (или только что): гаснет за CFG.chordFadeMs.
// Источник — lastTriad, а не поиск по ступени: колесо рисует и распознанный
// с MIDI аккорд, и «краску» вне лада, у которых нет записи в harmonicChords().
function vizActiveChord(now) {
  const age = now - (state.harmony.lastAt || 0);
  if (!state.harmony.lastTriad || age > CFG.chordFadeMs) return null;
  return { chord: state.harmony.lastTriad, k: Math.max(0, 1 - age / CFG.chordFadeMs) };
}
// Дуга перехода между корнями аккордов: короткий путь по кругу плюс стрелка.
function vizTransitionArc(ctx, a0, a1, rad, color, alpha) {
  const TWO = Math.PI * 2;
  const d = (((a1 - a0) % TWO) + TWO * 1.5) % TWO - Math.PI;
  if (Math.abs(d) < 0.02) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.arc(RING_CX, RING_CY, rad, a0, a0 + d, d < 0); ctx.stroke();
  const tg = a1 + (d > 0 ? Math.PI / 2 : -Math.PI / 2);
  const tipx = RING_CX + rad * Math.cos(a1), tipy = RING_CY + rad * Math.sin(a1);
  const bx = tipx - 8 * Math.cos(tg), by = tipy - 8 * Math.sin(tg);
  const px = -Math.sin(tg) * 4.5, py = Math.cos(tg) * 4.5;
  ctx.beginPath();
  ctx.moveTo(tipx, tipy);
  ctx.lineTo(bx + px, by + py);
  ctx.lineTo(bx - px, by - py);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

// ----- Режим 3: круг -----
// Обе экранные координаты музыкальные: угол — позиция в квинтовом круге от тоники
// (тоника всегда сверху, каждая тональность выглядит одинаково), радиус — высота
// тона, как в «орбитах». Семь ступеней — семь станций; октава читается радиусом,
// поэтому второй точки для той же ноты не нужно.
// Шары и перо в «круге» не рисуются (pen: false): остаются станции, имена нот и
// треугольник аккорда, а диски и хвосты только создавали визуальный шум.
// Гипотеза «высота → радиус» живёт в двух зонах: внутри — кольца высот по семи
// станциям, снаружи — пояс аккорда, на нём треугольник из тонов звучащего аккорда.
// Все 12 станций подписаны буквами: тоны тональности ярче прочих, поэтому колесо
// читается как колесо, а не как паутина, и видно, что занято 7 станций из 12.
// Общие тоны с предыдущим аккордом становятся белыми (голосоведение), переход
// корней — дугой со стрелкой. Цвет треугольника — функция: T золотая, S голубая,
// D красная.
const CIRCLE_STEP = 30;   // 12 ступеней круга = 360°
function vizCircleAngle(pc) { return (-90 + vizFifthsStep(pc) * CIRCLE_STEP) * RAD; }
// dAng — необязательное смещение по дуге (радианы): качание шара вокруг станции.
function vizCirclePoint(pc, rad, dAng) {
  const a = vizCircleAngle(pc) + (dAng || 0);
  return { x: RING_CX + rad * Math.cos(a), y: RING_CY + rad * Math.sin(a), a };
}
// Та же логарифмическая шкала, что у шаров (r = rMax·2^(Δ/12)), но по midi: октава = ×2.
// Верхняя ступень лада (T+11) задаёт rMax, поэтому радиус — точная высота тона.
// Множитель circleScale оставляет внешнюю полосу сцены под пояс аккорда.
function vizCircleRadius(midi) {
  return CFG.rMax * CFG.circleScale * Math.pow(2, (midi - (rootMidi() + 11)) / 12);
}
// Линия подписей станций: 130 — между диском внешнего шара (доходит до 114) и поясом
// аккорда (140). По радиусу подпись отстоит от диска на 16 px, и даже ближний к шару
// угол её прямоугольника не задевает диск ни на одной фазе качания (зазор ≥ 3 px).
const CIRCLE_LABEL_R = CFG.chordBelt - 10;
// Тоны тональности берутся из harmony.js (`scalePcs`) — те станции колеса, что заняты ладом.
// Единственный источник текста подписи станции: одна нота — одно слово. Значков
// октав в тексте нет: октаву читает радиус (r = rMax·2^(Δ/12)), а не вторая точка.
function vizStationText(pc, names) {
  const n = names || scaleNoteNames();
  return n[pc] || sharpLabel(pc);
}
// Подписи всех 12 станций: тоника золотая, тоны тональности ярче «чужих» станций.
// Станция, на которой стоит шар, подписана как голос — его цветом; отдельной подписи
// у самого шара нет (см. VIZ.circle.ball). Так имя шара, буква станции и подпись на
// кольце — один и тот же текст, и спорить им не о чем: они стоят на одной спице,
// а качание шара (10°) кольцо не задевает.
function vizCircleStations(ctx) {
  const inKey = scalePcs(), names = scaleNoteNames();
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let s = 0; s < 12; s++) {
    const pc = (vizTonicPc() + s) % 12;
    const p = vizCirclePoint(pc, CIRCLE_LABEL_R);
    const tonic = s === 0, key = inKey.indexOf(pc) !== -1;
    const voice = balls.find(b => b.pc === pc);
    if (voice) {
      // Обводка: имя голоса стоит рядом со свечением своего шара (16 px по радиусу
      // от диска), и темная обводка держит контраст поверх него.
      const text = vizStationText(pc, names);
      ctx.font = '700 10px sans-serif';
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(8,10,16,0.8)';
      ctx.strokeText(text, p.x, p.y);
      ctx.fillStyle = tonic ? sunColor : voice.color;
      ctx.fillText(text, p.x, p.y);
      continue;
    }
    ctx.font = (tonic ? '800 10px ' : key ? '700 9px ' : '600 8.5px ') + 'sans-serif';
    ctx.globalAlpha = tonic ? 1 : key ? 0.58 : 0.32;
    ctx.fillStyle = tonic ? sunColor : '#b8c4e2';
    ctx.fillText(vizStationText(pc, names), p.x, p.y);
  }
  ctx.restore();
}
// ----- Габариты подписи -----
// Проверки «подпись ни на что не налезла» имеют смысл только по прямоугольнику
// текста, а не по точке привязки. Ширина меряется один раз на строку и кэшируется:
// подписи рисуются каждый кадр, а measureText не бесплатен.
const VIZ_LABEL_H = 11;   // высота строки 10px с обводкой
const vizTextW = Object.create(null);
let vizMeasureCtx = null;
function vizLabelBox(text, x, y) {
  let w = vizTextW[text];
  if (w == null) {
    if (!vizMeasureCtx) vizMeasureCtx = document.createElement('canvas').getContext('2d');
    vizMeasureCtx.font = '700 10px sans-serif';
    w = vizTextW[text] = vizMeasureCtx.measureText(text).width;
  }
  const hw = (w + 3) / 2, hh = VIZ_LABEL_H / 2;
  return { x0: x - hw, x1: x + hw, y0: y - hh, y1: y + hh };
}
function vizBoxHit(a, b, pad) {
  const p = pad || 0;
  return a.x0 < b.x1 + p && a.x1 > b.x0 - p && a.y0 < b.y1 + p && a.y1 > b.y0 - p;
}
// Зазор «прямоугольник ↔ точка»: 0 — точка внутри, иначе расстояние до ближайшей
// стороны. Нужен, чтобы мерить отступ подписи от диска шара, а не от его центра.
function vizBoxGap(box, x, y) {
  return Math.hypot(Math.max(box.x0 - x, 0, x - box.x1), Math.max(box.y0 - y, 0, y - box.y1));
}
// Габариты всех 12 подписей станций круга — для проверок «подпись ни на что не налезла».
// Кэш по тональности, составу шаров и нотации: ширина C и «до» разная, поэтому
// буквенная нотация обязана сбрасывать кэш.
let vizStationBoxCache = { key: '', boxes: [] };
function vizStationBoxes() {
  const key = state.mode + '#' + state.comboIdx + '#' + (usingLetterNames() ? 'letters' : 'sol') +
    '|' + balls.map(b => b.pc).join(',');
  if (vizStationBoxCache.key === key) return vizStationBoxCache.boxes;
  const names = scaleNoteNames(), boxes = [];
  for (let s = 0; s < 12; s++) {
    const pc = (vizTonicPc() + s) % 12;
    const p = vizCirclePoint(pc, CIRCLE_LABEL_R);
    boxes.push(vizLabelBox(vizStationText(pc, names), p.x, p.y));
  }
  vizStationBoxCache = { key, boxes };
  return boxes;
}
// Из набора кандидатов берём точку, где подпись никого не накрывает и не уезжает под HUD.
// w — предпочтение кандидата; меньшая цена лучше, при равенстве выигрывает первый.
// Нужен режиму «орбиты»: в «круге» отдельной подписи у шара нет —
// имя шара стоит на его станции (см. vizCircleStations).
const VIZ_LABEL_COST = { hud: 60, ball: 34 };
function vizPickLabel(b, cands) {
  let best = cands[0], bestCost = Infinity;
  cands.forEach(p => {
    const box = vizLabelBox(b.name, p.x, p.y);
    let cost = -(p.w || 0);
    if (box.y0 < VIZ_SAFE_Y[0] || box.y1 > VIZ_SAFE_Y[1] || box.x0 < 8 || box.x1 > 792) {
      cost += VIZ_LABEL_COST.hud;
    }
    // Шар считается диском: подпись не должна попадать в него самого и в соседей.
    balls.forEach(o => {
      if (vizBoxGap(box, o.x, o.y) < o.radius + 2) cost += VIZ_LABEL_COST.ball;
    });
    if (cost < bestCost) { bestCost = cost; best = p; }
  });
  return best;
}
function vizChordOverlay(ctx, now) {
  const act = vizActiveChord(now);
  if (P.guides) {
    // Пояс аккорда: пунктирная орбита, по ней же ходит треугольник аккорда.
    // Засечек по станциям нет: станции уже подписаны именами нот (vizCircleStations),
    // а широкая подпись («соль#» — 29 px) на диагональной спице достаёт по радиусу
    // до 147, то есть за пояс: засечка прошла бы прямо сквозь буквы.
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.11)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    ctx.beginPath(); ctx.arc(RING_CX, RING_CY, CFG.chordBelt, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  if (!act) return;
  const h = act.chord, k = act.k, color = vizChordColor(h);
  const pts = h.pcs.map(pc => vizCirclePoint(pc, CFG.chordBelt));
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.65 * k;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = color + '33';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.shadowColor = color; ctx.shadowBlur = 10 + 16 * k;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Общие тоны с предыдущим аккордом — белые и крупнее: это и есть голосоведение.
  const prev = state.harmony.prevPcs || [];
  h.pcs.forEach((pc, i) => {
    const common = prev.indexOf(pc) !== -1;
    ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, common ? 4.8 : 3.2, 0, Math.PI * 2);
    ctx.fillStyle = common ? '#ffffff' : color;
    ctx.fill();
  });
  // Буквы тонов аккорда — на линии станций: вершины треугольника указывают на них,
  // а шар на той же спице замыкает связку «аккорд ↔ станция ↔ голос». Текст берём
  // тот же, что у подписи станции, и тем же кеглем — буква аккорда ровно накрывает
  // подпись станции, а не спорит с ней.
  const names = scaleNoteNames();
  ctx.font = '700 10px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  h.pcs.forEach(pc => {
    const p = vizCirclePoint(pc, CIRCLE_LABEL_R);
    ctx.globalAlpha = 0.45 + 0.55 * k;
    ctx.fillStyle = color;
    ctx.fillText(vizStationText(pc, names), p.x, p.y);
  });
  // Переход от корня предыдущего аккорда к корню текущего — по поясу.
  if (state.harmony.prevRoot != null) {
    vizTransitionArc(ctx, vizCircleAngle(state.harmony.prevRoot), vizCircleAngle(h.rootPc),
      CFG.chordBelt + 13, color, 0.2 + 0.5 * k);
  }
  // Ступень аккорда — единственная подпись, между солнцем и кольцом высот.
  const deg = 'Аккорд ' + h.degree;
  ctx.globalAlpha = 0.5 + 0.5 * k;
  ctx.font = '800 12px sans-serif';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(8,10,16,0.85)';
  ctx.strokeText(deg, RING_CX, RING_CY + 44);
  ctx.fillStyle = color;
  ctx.fillText(deg, RING_CX, RING_CY + 44);
  ctx.restore();
}
VIZ.circle = {
  label: 'Круг',
  hint: 'Квинтовый круг: угол — квинты, радиус — высота тона, на поясе — аккорд',
  // Шары и перо в «круге» выключены: станции, имена и аккордный треугольник
  // сами показывают гармонию, а диски и хвосты только создавали шум.
  pen: false,
  project(b, a) {
    // Качание по дуге станции: смещение в градусах и общее для всех шаров, поэтому
    // радиус остаётся точной высотой, а октавная пара — на одной спице.
    return vizCirclePoint(b.pc, vizCircleRadius(b.midi), CFG.circleSwing * Math.sin(a) * RAD);
  },
  guides(ctx, now) {
    const t = now == null ? performance.now() : now;
    if (P.guides) {
      // Высотные кольца: радиус — тот же язык, что у «орбит».
      const seen = [];
      balls.forEach(b => {
        const r = Math.round(vizCircleRadius(b.midi));
        if (seen.indexOf(r) !== -1) return;
        seen.push(r);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(RING_CX, RING_CY, r, 0, Math.PI * 2); ctx.stroke();
      });
      // Двенадцать спиц: бледные до пояса аккорда, ярче там, где стоит шар.
      const edge = CFG.rMax * CFG.circleScale + 12;
      for (let s = 0; s < 12; s++) {
        const a = (-90 + s * CIRCLE_STEP) * RAD;
        const on = balls.some(b => vizFifthsStep(b.pc) === s);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(RING_CX + 26 * Math.cos(a), RING_CY + 26 * Math.sin(a));
        ctx.lineTo(RING_CX + (CFG.chordBelt + 6) * Math.cos(a), RING_CY + (CFG.chordBelt + 6) * Math.sin(a));
        ctx.stroke();
        if (on) {
          ctx.strokeStyle = 'rgba(255,255,255,0.16)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(RING_CX + 26 * Math.cos(a), RING_CY + 26 * Math.sin(a));
          ctx.lineTo(RING_CX + edge * Math.cos(a), RING_CY + edge * Math.sin(a));
          ctx.stroke();
        }
      }
    }
    // Пояс и треугольник аккорда — под подписями станций: широкая подпись («соль#»)
    // заходит за пояс, и треугольник не должен перечёркивать её вершиной.
    vizChordOverlay(ctx, t);
    vizCircleStations(ctx);
  },
  center(ctx, now, live) {
    vizSun(ctx, now, live, 0.8);
    // Легенда инструмента: две координаты колеса объясняются на месте, а не в README.
    if (P.guides) vizPlate(ctx, 'угол — квинты · радиус — высота', 0.55, VIZ_SAFE_Y[1] - 8, 104);
  },
  ball(ctx, b, now) {
    // В «круге» шаров нет: нажатие показывает себя рябью/вспышкой на станции,
    // а имя ноты уже стоит на кольце (vizCircleStations).
  },
  ring(ctx, f, alpha) { vizRingFlash(ctx, f, alpha, f.r * CFG.circleScale, f.r * CFG.circleScale, RING_CY); }
};

// ----- Режим 1: плоские орбиты (по умолчанию) -----
// Радиус — логарифм частоты: r = rMax · 2^(Δ/12), угол — интеграл угловой скорости.
// phi у всех шаров общий (физика в render.js), поэтому каждому даётся постоянный
// сдвиг фазы: иначе все орбиты лежат на одном луче и шары слипаются в кучу.
// Настроение сцены: красиво и живо, но музыкален здесь только радиус.
// Делим круг на число шаров: у семи ступеней нет «пятой» позиции по умолчанию.
function orbitSpread() { return Math.PI * 2 / Math.max(3, balls.length); }
VIZ.orbits = {
  label: 'Орбиты',
  hint: 'Плоские орбиты: радиус — высота тона, угол — интеграл скорости',
  project(b, a) {
    const ang = a + (b.idx || 0) * orbitSpread();
    return { x: RING_CX + b.r * Math.cos(ang), y: RING_CY + b.r * Math.sin(ang) };
  },
  guides(ctx) {
    if (!P.guides) return;
    balls.forEach(b => {
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(RING_CX, RING_CY, b.r, 0, Math.PI * 2); ctx.stroke();
    });
  },
  center(ctx, now, live) { vizSun(ctx, now, live, 1); },
  ball(ctx, b, now) {
    vizTrail(ctx, b);
    vizBody(ctx, b, now);
    // Подпись — наружу по радиусу (шары стоят на разных орбитах), иначе вбок/внутрь.
    const d = Math.hypot(b.x - RING_CX, b.y - RING_CY) || 1;
    const ux = (b.x - RING_CX) / d, uy = (b.y - RING_CY) / d, g = b.radius + 9;
    const p = vizPickLabel(b, [
      { x: b.x + ux * g, y: b.y + uy * g, w: 2 },
      { x: b.x - ux * g, y: b.y - uy * g, w: 1 },
      { x: b.x - uy * g, y: b.y + ux * g, w: 0.5 },
      { x: b.x + uy * g, y: b.y - ux * g, w: 0.5 }
    ]);
    vizBallLabel(ctx, b, p.x, p.y);
  },
  ring(ctx, f, alpha) { vizRingFlash(ctx, f, alpha, f.r, f.r, RING_CY); }
};

// ----- Режим 2: спектр -----
// Не картинка «про звук», а измерение выхода: AnalyserNode после компрессора.
// Полный круг = логарифмическая шкала частот, длина луча = уровень бина.
// Солнце дышит по RMS, под ним — центр масс спектра μ = Σ f·p / Σ p.
const SPEC_SPOKES = 72;
const SPEC_FMIN = 55, SPEC_FMAX = 12000;
const SPEC_R0 = 34;   // внутренний радиус лучей: за пределами свечения солнца
const SPEC_R1 = SPEC_R0 + 100; // внешнее кольцо инструмента
// Плашка с подписью инструмента: тёмная подложка, чтобы текст не спорил с кольцами
// и подписями шаров. По умолчанию — по центру под кольцом (спектр); «круг» кладёт
// легенду в свободный угол сцены, задавая y и x.
function vizPlate(ctx, text, alpha, y, x) {
  const cx = x == null ? RING_CX : x;
  const by = y == null ? RING_CY + SPEC_R1 + 16 : y;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '700 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const w = ctx.measureText(text).width + 16;
  ctx.fillStyle = 'rgba(9,12,20,0.8)';
  ctx.beginPath();
  ctx.rect(cx - w / 2, by - 13, w, 17);
  ctx.fill();
  ctx.fillStyle = 'rgba(184,196,226,0.95)';
  ctx.fillText(text, cx, by);
  ctx.restore();
}
function vizSpectrum(ctx, live) {
  const bins = audioSpectrum();
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (!bins) {
    vizPlate(ctx, 'спектр включится вместе со звуком', 0.55);
    ctx.restore();
    return;
  }
  const binHz = audioCtx.sampleRate / analyser.fftSize;
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.2;
  for (let i = 0; i < SPEC_SPOKES; i++) {
    const t = i / SPEC_SPOKES;
    const f = SPEC_FMIN * Math.pow(SPEC_FMAX / SPEC_FMIN, t);
    const bin = Math.min(bins.length - 1, Math.max(1, Math.round(f / binHz)));
    // Луч начинается за свечением солнца, иначе инструмент тонет в ореоле.
    const a = Math.min(1, bins[bin] / 255 * 1.35);
    const len = 8 + 92 * Math.pow(a, 1.4);
    const ang = -Math.PI / 2 + t * Math.PI * 2;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    ctx.strokeStyle = 'hsla(' + (48 + 160 * t) + ', 92%, 64%, ' + (0.25 + 0.7 * a) + ')';
    ctx.beginPath();
    ctx.moveTo(RING_CX + dx * SPEC_R0, RING_CY + dy * SPEC_R0);
    ctx.lineTo(RING_CX + dx * (SPEC_R0 + len), RING_CY + dy * (SPEC_R0 + len));
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(RING_CX, RING_CY, SPEC_R1, 0, Math.PI * 2); ctx.stroke();
  const mu = spectralCentroid();
  if (mu > 0 && live) vizPlate(ctx, 'μ ' + (mu / 1000).toFixed(2) + ' кГц', 1);
  ctx.restore();
}
VIZ.spectrum = {
  label: 'Спектр',
  hint: 'Спектр выхода: солнце дышит по RMS, лучи — по бинам',
  project(b, a) { return VIZ.orbits.project(b, a); },
  guides(ctx) { VIZ.orbits.guides(ctx); },
  center(ctx, now, live) {
    // Солнце в «спектре» компактнее: длинные лучи должны читаться, а не тонуть в ореоле.
    vizSun(ctx, now, live, 0.55 + 0.45 * audioRms());
    vizSpectrum(ctx, live);
  },
  ball(ctx, b, now) { VIZ.orbits.ball(ctx, b, now); },
  ring(ctx, f, alpha) { VIZ.orbits.ring(ctx, f, alpha); }
};

// ----- Самопроверка: у каждого режима полный набор методов и конечные координаты -----
// Проверяет и музыкальную геометрию «круга»: тоника наверху, V справа, IV слева,
// отображение полутонов в ступени круга — биекция, семь шаров стоят на семи
// станциях лада, радиус шара всегда равен его высоте, а качание не выходит за
// пределы своей станции.
// clearHud — точки не заходят в верхнюю/нижнюю полосы, занятые карточками HUD (VIZ_SAFE_Y).
function vizDebug() {
  const report = {};
  const phases = [0, 0.7, Math.PI / 2, Math.PI, 4.2, 5.9];
  VIZ_ORDER.forEach(key => {
    const mode = VIZ[key] || {};
    const need = ['project', 'guides', 'center', 'ball', 'ring'];
    let finite = true, inStage = true, clearHud = true;
    const mark = p => {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { finite = false; return; }
      if (p.x < 0 || p.x > 800 || p.y < 0 || p.y > 540) inStage = false;
      if (p.y < VIZ_SAFE_Y[0] || p.y > VIZ_SAFE_Y[1]) clearHud = false;
    };
    balls.forEach(b => phases.forEach(a => mark(mode.project ? mode.project(b, a) : { x: NaN, y: NaN })));
    if (key === 'circle') for (let s = 0; s < 12; s++) {
      mark(vizCirclePoint((vizTonicPc() + s) % 12, CFG.chordBelt));
      mark(vizCirclePoint((vizTonicPc() + s) % 12, CIRCLE_LABEL_R));
    }
    report[key] = {
      label: mode.label || key,
      missing: need.filter(fn => typeof mode[fn] !== 'function'),
      finite, inStage, clearHud,
      active: P.viz === key
    };
  });
  const tonicPc = vizTonicPc();
  const steps = new Set();
  for (let pc = 0; pc < 12; pc++) steps.add(vizFifthsStep(pc));
  // Семь шаров — семь ступеней: один шар на pitch class, каждая ступень на своей
  // станции. Октавных пар больше нет — октаву читает радиус, а не вторая точка.
  const palette = diatonicPalette();
  const sevenVoices = balls.length === palette.length &&
    balls.every((b, i) => b.pc === palette[i].rootPc) &&
    new Set(balls.map(b => b.pc)).size === balls.length;
  report._music = {
    tonicAtTop: vizFifthsStep(tonicPc) === 0,
    dominantRight: vizFifthsStep(tonicPc + 7) === 1,
    subdominantLeft: vizFifthsStep(tonicPc + 5) === 11,
    bijective: steps.size === 12,
    sevenVoices,
    // Радиус в «круге» — ровно высота тона на любой фазе: иначе «радиус = высота»
    // перестаёт читаться.
    radiusLocked: balls.every(b => phases.every(a => {
      const p = VIZ.circle.project(b, a);
      return Math.abs(Math.hypot(p.x - RING_CX, p.y - RING_CY) - vizCircleRadius(b.midi)) < 0.01;
    })),
    // Качание остаётся в пределах станции: шар не путается с соседней ступенью круга.
    swingWithinStation: balls.every(b => phases.every(a => {
      const p = VIZ.circle.project(b, a);
      const d = ((p.a - vizCircleAngle(b.pc)) * 180 / Math.PI % 360 + 540) % 360 - 180;
      return Math.abs(d) <= CFG.circleSwing + 0.01;
    }))
  };
  // Подписи «круга»: буквы 12 станций стоят на кольце и не должны ни налезать друг
  // на друга, ни вылезать в полосы HUD, ни попадать под качающиеся шары. Проверяем
  // прямоугольники текста, а не точки привязки: по точкам не видно ни наложения
  // на букву, ни наложения подписи на подпись.
  const stations = vizStationBoxes();
  let stationGap = Infinity;
  stations.forEach(bx => balls.forEach(b => phases.forEach(a => {
    const p = VIZ.circle.project(b, a);
    stationGap = Math.min(stationGap, vizBoxGap(bx, p.x, p.y) - b.baseRadius);
  })));
  report._labels = {
    inSafeBand: stations.every(bx => bx.y0 >= VIZ_SAFE_Y[0] && bx.y1 <= VIZ_SAFE_Y[1] &&
      bx.x0 >= 0 && bx.x1 <= 800),
    apart: stations.every((bx, i) => stations.every((o, j) => i === j || !vizBoxHit(bx, o, 1))),
    clearOfBalls: stationGap >= 0,
    // Один шар на ступень: повторяющихся pitch classes нет, подписи станций
    // не спорят с двойными дисками.
    distinctVoices: balls.every(b => balls.filter(o => o.pc === b.pc).length === 1)
  };
  // Слух проверяется тем же вызовом: 48 форм трезвучий, палитра из семи ступеней, роли нот.
  report._harmony = harmonyDebug();
  return report;
}
