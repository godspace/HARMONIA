/* HARMONIA · js/render.js — цикл отрисовки и масштабирование сцены
   Модуль без сборки: подключается <script> в index.html до main.js.
   Все модули делят глобальную область — имена функций/констант уникальны. */

// ===== Отрисовка =====
let lastFrame = performance.now();
function render() {
  const now = performance.now();
  const rawDt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  const live = state.running && !state.paused;
  const dt = live ? rawDt : 0;
  const maxSeg = P.quality === 'high' ? 1.5 : 3;

  if (live && typeof Transport !== 'undefined') Transport.update();
  // Грув живёт на своём планировщике: в пьесе он берёт часы Transport, в джеме
  // считает сам. Порядок важен — часы пьесы тикают первыми. Режим preview —
  // стартовая проба: сессия ещё не начата, а барабаны уже звучат.
  if (typeof Groove !== 'undefined' && (live || Groove.preview)) Groove.update();
  if (live) {
    state.clock += dt;
    state.energyAcc += dt;
    while (state.energyAcc >= 0.1) {
      state.energyAcc -= 0.1;
      let changed = false;
      balls.forEach(b => {
        if (ballKeyDown(b)) { state.energy[b.idx] += 1; changed = true; }
      });
      if (changed) updateHUD();
    }
  }
  balls.forEach(b => {
    // Педаль держит ноту и после отпускания клавиши; без педали звучит только
    // реально зажатая нота. MIDI-нота уже озвучена своей высотой (echoNote) или
    // звучит с пианино — второй голос был бы дублем.
    // Авто-затухание: под педалью нота не висит вечно, иначе голоса копятся.
    if (b.sustainLatch && now - b.sustainAt >= CFG.pedalLatchMs) {
      b.sustainLatch = false;
      b.sustainAt = 0;
    }
    const want = live && (!!b.sustainLatch || ballKeyDown(b));
    if (want && !b.hold) holdStart(b);
    if (!want && b.hold) holdStop(b);
  });

  // Видео: события визуализации включаются по медиа-часам до отрисовки слоя,
  // поэтому вспышка и рябь попадают в тот же кадр. Готовый композит ролика
  // собирает отдельный таймер в video.js, а не этот цикл.
  if (state.videoExport && typeof videoSyncVisual === 'function') videoSyncVisual();

  if (live && P.fade > 0) {
    penCtx.save();
    penCtx.globalCompositeOperation = 'destination-out';
    penCtx.fillStyle = 'rgba(0,0,0,' + Math.min(1, (P.fade / 100) * rawDt * 2).toFixed(4) + ')';
    penCtx.fillRect(0, 0, 800, 540);
    penCtx.restore();
  }

  spriteCtx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);

  particles.forEach(p => {
    p.x += p.vx * rawDt; p.y += p.vy * rawDt;
    if (p.x < -4) p.x = 804; if (p.x > 804) p.x = -4;
    if (p.y < -4) p.y = 544; if (p.y > 544) p.y = -4;
    spriteCtx.globalAlpha = p.a;
    spriteCtx.fillStyle = p.c;
    spriteCtx.beginPath(); spriteCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2); spriteCtx.fill();
  });
  spriteCtx.globalAlpha = 1;

  // Геометрия и картинка — за выбранной визуализацией, физика остаётся здесь.
  // now нужен режимам для гаснущих подсказок (треугольник аккорда в «круге»).
  const m = viz();
  // В «круге» шары не рисуются и перо не ведётся: станции, имена и аккордный
  // треугольник остаются, а диски и хвосты создавали визуальный шум.
  const drawPen = m.pen !== false;
  m.guides(spriteCtx, now);

  balls.forEach(b => {
    b.boost *= Math.exp(-dt / Math.max(0.05, P.tau));
    const dDeg = (P.speed + b.boost) * dt * P.dir;
    const phiPrev = b.phi;
    b.phi += dDeg * RAD;
    const pos = m.project(b, b.phi);
    if (live && drawPen && Math.abs(dDeg) > 0) {
      b.theta += Math.abs(dDeg);
      const steps = Math.max(1, Math.ceil(Math.abs(dDeg) / maxSeg));
      penCtx.strokeStyle = b.color;
      penCtx.lineWidth = P.penW;
      penCtx.lineCap = 'round';
      const p0 = m.project(b, phiPrev);
      penCtx.beginPath();
      penCtx.moveTo(p0.x, p0.y);
      for (let i = 1; i <= steps; i++) {
        const pp = m.project(b, phiPrev + (b.phi - phiPrev) * (i / steps));
        penCtx.lineTo(pp.x, pp.y);
      }
      penCtx.stroke();
      const done = Math.floor(b.theta / 360);
      if (done > b.ringsDone) { b.ringsDone = done; ringEvent(b, now); }
    }
    b.x = pos.x; b.y = pos.y;
    if (live && P.tails && drawPen) { b.hist.push({ x: pos.x, y: pos.y }); if (b.hist.length > 10) b.hist.shift(); }
    if (!P.tails) b.hist.length = 0;
    b.radius += (b.baseRadius - b.radius) * 0.18;
  });

  m.center(spriteCtx, now, live);

  balls.forEach(b => m.ball(spriteCtx, b, now));

  for (let i = ripples.length - 1; i >= 0; i--) {
    const rp = ripples[i];
    const age = (now - rp.start) / (rp.big ? 600 : 450);
    if (age >= 1) { ripples.splice(i, 1); continue; }
    if (age < 0) continue;
    spriteCtx.globalAlpha = (1 - age) * 0.5;
    spriteCtx.strokeStyle = rp.color; spriteCtx.lineWidth = 2;
    spriteCtx.beginPath();
    spriteCtx.arc(rp.x, rp.y, (rp.big ? 18 : 12) + (rp.big ? 60 : 34) * age, 0, Math.PI * 2);
    spriteCtx.stroke();
  }
  spriteCtx.globalAlpha = 1;

  for (let i = motes.length - 1; i >= 0; i--) {
    const mo = motes[i];
    const age = (now - mo.start) / 900;
    if (age >= 1) { motes.splice(i, 1); continue; }
    if (age < 0) continue;
    spriteCtx.globalAlpha = 1 - age;
    spriteCtx.fillStyle = mo.color;
    spriteCtx.font = '800 14px sans-serif';
    spriteCtx.textAlign = 'center';
    spriteCtx.shadowColor = mo.color; spriteCtx.shadowBlur = 8;
    spriteCtx.fillText(mo.text, mo.x, mo.y - 18 - 30 * age);
    spriteCtx.shadowBlur = 0;
  }
  spriteCtx.globalAlpha = 1;

  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    const age = (now - f.start) / 600;
    if (age >= 1) { flashes.splice(i, 1); continue; }
    m.ring(spriteCtx, f, 1 - age);
  }

  // Кадр ролика собирает video.js на своём таймере: если этот цикл остановится
  // или бросит исключение, звук и медиа-время видео продолжат идти.
  requestAnimationFrame(render);
}

// Хром интерфейса в пикселях: номинальная высота верхнего меню и его таба,
// статус-строка снизу, ширина панели и её таба. Сцена не заходит на эти полосы,
// а закрытые панели (и стартовая проба) отдают свои пиксели сцене.
const FIT_TOP = 62, FIT_TAB = 32, FIT_BOTTOM = 58;
const FIT_PANEL = 288, FIT_PANEL_TAB = 30, FIT_PANEL_BELOW = 210;

function fitStage() {
  const wide = window.innerWidth >= 1120;
  const layout = $('layout');
  layout.classList.toggle('side', wide);
  // Проба пальцев прячет весь хром, поэтому сцена получает почти весь экран.
  const intro = typeof drawerIntro === 'function' && drawerIntro();
  const topOpen = typeof drawerOpen === 'function' ? drawerOpen('topbar') : true;
  const panelOpen = typeof drawerOpen === 'function' ? drawerOpen('panel') : true;
  const gap = 12;
  // В строке панель стоит справа от сцены: открытая — колонка, закрытая — таб.
  const sideW = wide && !intro ? (panelOpen ? FIT_PANEL + gap : FIT_PANEL_TAB + gap) : 0;
  const availW = window.innerWidth - 20 - sideW;
  // Снизу: статус-строка, а в узком режиме ещё и панель под сценой (её высоту
  // ограничивает maxHeight). Закрытая оставляет только таб в одну строку.
  const pillH = $('panelTab').offsetHeight || 0;
  const below = wide ? 0 : (panelOpen ? FIT_PANEL_BELOW : Math.max(FIT_PANEL_TAB, pillH + gap));
  // Верхняя полоса: сначала номинальная высота, потом реальная. В узкой
  // оболочке кнопки топбара переносятся на вторую строку, а подсказки внизу —
  // на вторую-третью, и без этой поправки сцена заходила бы на хром.
  // Двух проходов обычно хватает, три — страховка от третьей строки.
  // Закрытый топбар места не занимает: его полосу меряем по табу и body-gap.
  const tabH = $('topbarTab').offsetHeight || 0;
  let topH = topOpen ? FIT_TOP : Math.max(FIT_TAB, tabH + 10);
  let bottomH = FIT_BOTTOM;
  for (let pass = 0; pass < 3; pass++) {
    const availH = intro
      ? window.innerHeight - 20
      : window.innerHeight - topH - bottomH - below;
    // Сцена растёт до 1.5×: панель остаётся читаемой колонкой, а закрытые меню
    // не оставляют вокруг сцены пустых полей.
    const s = Math.max(0.34, Math.min(1.5, availW / 800, availH / 540));
    const stageW = 800 * s, stageH = 540 * s;
    // Рабочая область ровно по сцене и панели: топбар и статус не шире и не уже.
    const shellW = wide
      ? Math.min(window.innerWidth - 20, stageW + sideW)
      : window.innerWidth - 20;
    $('stage-wrap').style.width = stageW + 'px';
    $('stage-wrap').style.height = stageH + 'px';
    $('game-container').style.transform = `scale(${s})`;
    layout.style.width = shellW + 'px';
    $('topbar').style.width = shellW + 'px';
    $('status-row').style.width = shellW + 'px';
    $('panel').style.maxHeight = wide
      ? stageH + 'px'
      : Math.max(150, window.innerHeight - stageH - 150) + 'px';
    if (intro) break;
    // Реальные высоты хрома меряем уже на новой ширине оболочки.
    let grown = false;
    if (topOpen) {
      const realTop = $('topbar').offsetHeight + gap;
      if (realTop > topH + 2) { topH = realTop; grown = true; }
    }
    const realBottom = $('status-row').offsetHeight + gap;
    if (realBottom > bottomH + 2) { bottomH = realBottom; grown = true; }
    if (!grown) break;
  }
}
window.addEventListener('resize', fitStage);
