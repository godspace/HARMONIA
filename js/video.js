/* HARMONIA · js/video.js — экспорт записи в WebM без внешних библиотек
   Модуль без сборки: подключается <script> после recorder.js.
   Звук и картинка идут по одному таймлайну recordingTimeline(): удары, ноты и
   аккорды берут свои записанные миллисекунды, поэтому грув не перезапускается
   с начала такта и не накапливает сдвиг. Все модули делят глобальную область —
   имена функций/констант уникальны. */

const VIDEO_W = 1080;
const VIDEO_H = 1920;
const VIDEO_FPS = 30;
// Запись станции начинается с момента входа в комбо, но первые ноты могут
// прозвучать через несколько секунд. Ролик начинается не с нуля записи, а с
// первого события и оставляет ровно секунду тишины перед ним — так зритель
// успевает понять кадр, а случайная заминка перед игрой не растягивает видео.
const VIDEO_LEAD_MS = 1000;
// 220 мс ожидания перед захватом выпускают уже запланированные живым грувом
// удары, чтобы они не попали в ролик поверх записанных.
const VIDEO_FLUSH_MS = 220;
// После последнего события хвост ноты звучит без наложений, затем идёт
// финальная карточка со ссылкой. Хвостовая тишина самой записи обрезается:
// для короткого соцсетевого ролика она только уменьшает досматриваемость.
// Секунда после последнего события — такой же зазор, как и в начале.
const VIDEO_TAIL_MS = 1000;
const VIDEO_ENDCARD_MS = 1600;
const VIDEO_MIN_MS = VIDEO_LEAD_MS + VIDEO_TAIL_MS + VIDEO_ENDCARD_MS;
const VIDEO_LOOKAHEAD = 0.35;
const VIDEO_URL = 'godspace.github.io/HARMONIA';
const VIDEO_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
// Вертикальная рамка: сцена 800×540 вписывается в 996×672, а поля сверху и
// снизу заняты брендом, метаданными и CTA. Важные элементы держатся выше
// нижних 300 px — там соцсети рисуют подпись и кнопки.
const VIDEO_STAGE = { x: 42, y: 292, w: 996, h: 672, r: 26 };
const VIDEO_BAR = { x: 42, y: 1478, w: 996, h: 10 };
let videoJob = null;
let videoToken = 0;

function videoSupported() {
  return typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    typeof MediaStream !== 'undefined' &&
    typeof audioCaptureStream === 'function';
}
function videoMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (let i = 0; i < types.length; i++) {
    if (MediaRecorder.isTypeSupported(types[i])) return types[i];
  }
  return '';
}
function videoFileName(rec) {
  const base = String(videoTitle(rec) || 'harmonia')
    .replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'harmonia';
  return base + '.webm';
}
function videoSize() {
  return { width: VIDEO_W, height: VIDEO_H, ratio: VIDEO_W / VIDEO_H };
}
// Заголовок ролика и подписи — тоническое трезвучие комбо («Ля-До-Ми» /
// «A-C-E»), а не служебное имя авто-записи «Станция 13 · эталон». У старых
// записей без снимка аккордов трезвучие берётся из COMBOS по id комбо.
function videoTonic(rec) {
  const c = rec && rec.combo;
  if (!c) return '';
  let names = null;
  if (Array.isArray(c.chords) && Array.isArray(c.chords[0])) names = c.chords[0];
  else if (Array.isArray(c.tonicChord)) names = c.tonicChord;
  else if (c.id != null && typeof COMBOS !== 'undefined' && COMBOS[c.id] &&
           Array.isArray(COMBOS[c.id].chords)) names = COMBOS[c.id].chords[0];
  if (names && names.length) {
    return typeof chordLabel === 'function' ? chordLabel(names) : names.join('-');
  }
  const key = (typeof usingLetterNames === 'function' && usingLetterNames())
    ? (c.keyNameLatin || c.keyName) : c.keyName;
  return videoText(key || '');
}
function videoTitle(rec) {
  return videoTonic(rec) || videoText(rec && rec.name || 'HARMONIA');
}
function videoDuration(rec) {
  const timeline = recordingTimeline(rec);
  const first = timeline.length ? Math.max(0, Number(timeline[0].t) || 0) : 0;
  const last = timeline.length ? Math.max(0, Number(timeline[timeline.length - 1].t) || 0) : 0;
  // Длительность считается по первому и последнему событию, а не по времени
  // старта/остановки записи: заминки до первой ноты и после последней не нужны.
  // VIDEO_LEAD_MS/VIDEO_TAIL_MS оставляют по секунде воздуха, VIDEO_ENDCARD_MS —
  // финальную карточку со ссылкой.
  const span = Math.max(0, last - first);
  const wanted = Math.max(VIDEO_MIN_MS,
    VIDEO_LEAD_MS + span + VIDEO_TAIL_MS + VIDEO_ENDCARD_MS);
  const max = (typeof REC_MAX_MS === 'number' ? REC_MAX_MS : 180000) + VIDEO_MIN_MS;
  return Math.round(clamp(wanted, VIDEO_MIN_MS, max));
}
// Старый формат не знал о дорожке drums. Угадывать по нему грув нельзя:
// паттерн мог быть другим, а BPM менялся. Честнее ролик без ударных и строка
// предупреждения, чем «почти та же» музыка.
function videoLegacyWarning(rec) {
  return rec && !Array.isArray(rec.drums)
    ? 'Старая запись: партия барабанов не сохранилась — видео будет без ударных.'
    : '';
}
// Готовое описание для соцсетей: тоническое трезвучие, тональность, темп и
// ссылка. Это не часть видео, а быстрый мостик от просмотра к запуску.
function videoCaption(rec) {
  if (!rec) return '';
  const copy = videoCopy();
  const facts = [];
  if (rec.combo) {
    const key = (typeof usingLetterNames === 'function' && usingLetterNames())
      ? (rec.combo.keyNameLatin || rec.combo.keyName)
      : rec.combo.keyName;
    if (key) facts.push(key);
  }
  const bpm = Number(rec.bpm || (rec.form && rec.form.bpm));
  if (isFinite(bpm) && bpm > 0) facts.push(Math.round(bpm) + ' BPM');
  facts.push(recDurationLabel(videoDuration(rec)));
  facts.push('♪ ' + ((rec.events && rec.events.length) || 0));
  if (rec.drums && rec.drums.length) facts.push('◉ ' + rec.drums.length);
  return [
    'HARMONIA · ' + videoTitle(rec),
    facts.join(' · '),
    copy.caption + ' https://' + VIDEO_URL + '/',
    '#harmonia #harmony #musictheory #chords #browserinstrument'
  ].join('\n');
}
function videoCopyText(text) {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand && document.execCommand('copy');
    area.remove();
    return !!ok;
  } catch (e) {
    return false;
  }
}
async function copyVideoCaption(target) {
  const rec = target || selectedRecording();
  if (!rec) return '';
  const text = videoCaption(rec);
  let ok = false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (e) {
    ok = false;
  }
  if (!ok) ok = videoCopyText(text);
  toast(ok ? 'Описание скопировано' : 'Не удалось скопировать описание', ok ? 'good' : undefined);
  return ok ? text : '';
}
function videoExportStatus() {
  if (!videoJob) return null;
  return {
    active: true,
    name: videoJob.rec.name,
    elapsed: Math.max(0, performance.now() - (videoJob.recorderStartedAt || performance.now())),
    duration: videoJob.duration
  };
}
function showVideoOverlay() {
  const el = $('videoExport');
  if (el) el.hidden = false;
}
function hideVideoOverlay() {
  const el = $('videoExport');
  if (el) el.hidden = true;
}
function updateVideoOverlay(v) {
  const text = $('videoExportText');
  if (!text || !v) return;
  const elapsed = Math.min(v.duration,
    Math.max(0, performance.now() - (v.recorderStartedAt || performance.now())));
  text.textContent = '🎬 Видео · ' + recDurationLabel(elapsed) + ' / ' +
    recDurationLabel(v.duration);
}
// Захват видит только канвасы. Ролик 1080×1920 собирает их в вертикальную
// рамку: бренд сверху, сцена в центре, метаданные и CTA снизу.
// Подписи на canvas не проходят через DOM. Заголовок — тоническое трезвучие в
// текущей нотации; служебные части подписи переводит I18N.text(), а в русском
// пакет выключен, поэтому текст остаётся исходным.
function videoText(value) {
  const s = String(value == null ? '' : value);
  return (typeof I18N !== 'undefined' && typeof I18N.enabled === 'function' &&
    I18N.enabled() && typeof I18N.text === 'function') ? I18N.text(s) : s;
}
function videoCopy() {
  const lang = String((typeof document !== 'undefined' && document.documentElement.lang) || 'ru').toLowerCase();
  if (!lang.startsWith('ru')) {
    return {
      tagline: 'harmony simulator · 24 combos',
      session: 'HARMONIA SESSION',
      now: 'NOW',
      cta: 'Play your own harmony',
      sub: 'Free in your browser · no install',
      endTitle: 'Play your own harmony',
      endSub: 'Free in your browser · no install · 24 combos',
      endNote: 'Harmony, chords and melody — all playable.',
      caption: 'Play your own harmony in the browser:'
    };
  }
  return {
    tagline: 'симулятор гармонии · 24 комбо',
    session: 'HARMONIA SESSION',
    now: 'СЕЙЧАС',
    cta: 'Сыграй свою гармонию',
    sub: 'Бесплатно в браузере · без установки',
    endTitle: 'Сыграй свою гармонию',
    endSub: 'Бесплатно · без установки · 24 комбо',
    endNote: 'Гармония, аккорды и мелодия — всё играется.',
    caption: 'Сыграй свою гармонию в браузере:'
  };
}
function videoRoundRect(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(Number(r) || 0, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}
function videoFitText(ctx, text, maxWidth) {
  const source = String(text == null ? '' : text);
  if (ctx.measureText(source).width <= maxWidth) return source;
  let cut = source;
  while (cut.length > 1 && ctx.measureText(cut + '…').width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return cut + '…';
}
// Canvas не умеет CSS letter-spacing одинаково во всех браузерах, поэтому
// рисуем по буквам: так логотип выглядит одинаково и в Chrome, и в Firefox.
function videoSpacedText(ctx, text, x, y, spacing, align) {
  const chars = Array.from(String(text == null ? '' : text));
  let width = 0;
  chars.forEach(ch => { width += ctx.measureText(ch).width; });
  width += Math.max(0, chars.length - 1) * spacing;
  let cx = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  ctx.textAlign = 'left';
  chars.forEach(ch => {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  });
  return width;
}
// Логотип-орбита: семь цветов ступеней вокруг тёмного ядра. Он собирается один
// раз в статичном слое, поэтому тени не замедляют каждый кадр.
function videoDrawLogo(ctx, cx, cy, r) {
  const colors = ['#6bdfff', '#ff1541', '#a455e3', '#74cc3d', '#4ec3ff', '#ffb347', '#f472b6'];
  ctx.save();
  const ring = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  ring.addColorStop(0, '#6bdfff');
  ring.addColorStop(0.5, '#a455e3');
  ring.addColorStop(1, '#ff1541');
  ctx.strokeStyle = ring;
  ctx.lineWidth = Math.max(2, r * 0.075);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.88, 0, Math.PI * 2);
  ctx.stroke();
  const disc = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.3, 1, cx, cy, r * 0.86);
  disc.addColorStop(0, '#1a2136');
  disc.addColorStop(1, '#090b13');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.79, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < colors.length; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / colors.length;
    const px = cx + Math.cos(a) * r * 0.55;
    const py = cy + Math.sin(a) * r * 0.55;
    ctx.fillStyle = colors[i];
    ctx.shadowColor = colors[i];
    ctx.shadowBlur = Math.max(1, r * 0.14);
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1.6, r * 0.095), 0, Math.PI * 2);
    ctx.fill();
  }
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.3);
  core.addColorStop(0, 'rgba(255,255,255,0.95)');
  core.addColorStop(0.35, 'rgba(209,228,255,0.55)');
  core.addColorStop(1, 'rgba(107,223,255,0)');
  ctx.shadowBlur = 0;
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function videoBackdrop(ctx) {
  const bg = ctx.createLinearGradient(0, 0, 0, VIDEO_H);
  bg.addColorStop(0, '#0b0d15');
  bg.addColorStop(0.55, '#080a11');
  bg.addColorStop(1, '#0b0d15');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);
  const glow = (x, y, r, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);
  };
  glow(20, 0, 680, 'rgba(164,85,227,0.25)');
  glow(VIDEO_W, 620, 760, 'rgba(78,195,255,0.19)');
  glow(850, 1320, 560, 'rgba(255,21,65,0.10)');
  glow(540, 1920, 620, 'rgba(107,223,255,0.08)');
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  [310, 450, 590, 730].forEach(r => {
    ctx.beginPath();
    ctx.arc(540, 720, r, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.restore();
  const vignette = ctx.createRadialGradient(540, 960, 360, 540, 960, 1120);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.62)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);
}
function videoMetaItems(rec) {
  const items = [];
  if (rec && rec.combo) {
    const key = (typeof usingLetterNames === 'function' && usingLetterNames())
      ? (rec.combo.keyNameLatin || rec.combo.keyName)
      : rec.combo.keyName;
    if (key) items.push({ text: key, accent: true });
  }
  const bpm = Number(rec && (rec.bpm || (rec.form && rec.form.bpm)));
  if (isFinite(bpm) && bpm > 0) items.push({ text: Math.round(bpm) + ' BPM' });
  items.push({ text: recDurationLabel(videoDuration(rec)) });
  items.push({ text: '♪ ' + ((rec && rec.events) ? rec.events.length : 0) });
  const hits = rec && Array.isArray(rec.drums) ? rec.drums.length : 0;
  if (hits) items.push({ text: '◉ ' + hits });
  return items;
}
function videoDrawChip(ctx, text, x, y, h, accent) {
  ctx.save();
  ctx.font = '700 28px ' + VIDEO_FONT;
  const padX = 24;
  const w = ctx.measureText(text).width + padX * 2;
  videoRoundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = accent ? 'rgba(255,209,102,0.10)' : 'rgba(255,255,255,0.06)';
  ctx.fill();
  ctx.strokeStyle = accent ? 'rgba(255,209,102,0.42)' : 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = accent ? '#ffd166' : '#d0d7ee';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + h / 2 + 1);
  ctx.restore();
  return w;
}
function videoDrawCta(ctx, copy) {
  const x = 42, y = 1270, w = 996, h = 178, r = 24;
  ctx.save();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, 'rgba(107,223,255,0.12)');
  g.addColorStop(0.55, 'rgba(164,85,227,0.12)');
  g.addColorStop(1, 'rgba(255,21,65,0.08)');
  videoRoundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(107,223,255,0.30)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const accent = ctx.createLinearGradient(x + 24, y + 30, x + 24, y + h - 30);
  accent.addColorStop(0, '#6bdfff');
  accent.addColorStop(1, '#a455e3');
  ctx.fillStyle = accent;
  ctx.fillRect(x + 24, y + 32, 5, h - 64);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 40px ' + VIDEO_FONT;
  ctx.fillText(videoFitText(ctx, copy.cta, w - 200), x + 56, y + 66);
  ctx.fillStyle = '#9aa4c2';
  ctx.font = '600 27px ' + VIDEO_FONT;
  ctx.fillText(videoFitText(ctx, copy.sub, w - 200), x + 56, y + 107);
  ctx.fillStyle = '#6bdfff';
  ctx.font = '700 30px ' + VIDEO_FONT;
  ctx.fillText(VIDEO_URL, x + 56, y + 150);
  const cx = x + w - 84, cy = y + h / 2, ar = 40;
  const arrow = ctx.createLinearGradient(cx - ar, cy - ar, cx + ar, cy + ar);
  arrow.addColorStop(0, '#6bdfff');
  arrow.addColorStop(1, '#a455e3');
  ctx.strokeStyle = arrow;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, ar, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 38px ' + VIDEO_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('→', cx + 1, cy + 2);
  ctx.restore();
}
function videoBuildBase(v) {
  const rec = v.rec;
  const copy = videoCopy();
  const canvas = document.createElement('canvas');
  canvas.width = VIDEO_W;
  canvas.height = VIDEO_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  videoBackdrop(ctx);
  // Шапка: логотип-орбита и градиентный словесный знак, как в топбаре.
  videoDrawLogo(ctx, 90, 112, 40);
  ctx.save();
  ctx.font = '800 70px ' + VIDEO_FONT;
  const wordmark = ctx.createLinearGradient(154, 0, 760, 0);
  wordmark.addColorStop(0, '#6bdfff');
  wordmark.addColorStop(0.52, '#a455e3');
  wordmark.addColorStop(1, '#ff1541');
  ctx.fillStyle = wordmark;
  videoSpacedText(ctx, 'HARMONIA', 154, 146, 7, 'left');
  ctx.restore();
  ctx.fillStyle = '#9aa4c2';
  ctx.font = '600 30px ' + VIDEO_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(copy.tagline, 154, 194);
  const rule = ctx.createLinearGradient(42, 0, 1038, 0);
  rule.addColorStop(0, 'rgba(107,223,255,0)');
  rule.addColorStop(0.3, 'rgba(107,223,255,0.34)');
  rule.addColorStop(0.7, 'rgba(164,85,227,0.30)');
  rule.addColorStop(1, 'rgba(255,21,65,0)');
  ctx.fillStyle = rule;
  ctx.fillRect(42, 246, 996, 1.5);
  // Сцена — карточка с мягкой тенью; содержимое канвасов рисуется каждый кадр.
  const s = VIDEO_STAGE;
  ctx.save();
  ctx.shadowColor = 'rgba(78,195,255,0.20)';
  ctx.shadowBlur = 42;
  videoRoundRect(ctx, s.x, s.y, s.w, s.h, s.r);
  const panel = ctx.createLinearGradient(s.x, s.y, s.x, s.y + s.h);
  panel.addColorStop(0, '#131829');
  panel.addColorStop(1, '#0a0d15');
  ctx.fillStyle = panel;
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#7e88a6';
  ctx.font = '800 16px ' + VIDEO_FONT;
  videoSpacedText(ctx, copy.session, 42, 1014, 3.4, 'left');
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 54px ' + VIDEO_FONT;
  ctx.fillText(videoFitText(ctx, videoTitle(rec), 996), 42, 1078);
  const items = videoMetaItems(rec);
  let chipX = 42;
  const chipY = 1102;
  for (let i = 0; i < items.length; i++) {
    ctx.font = '700 28px ' + VIDEO_FONT;
    const chipW = ctx.measureText(items[i].text).width + 48;
    if (chipX + chipW > VIDEO_STAGE.x + VIDEO_STAGE.w) break;
    chipX += videoDrawChip(ctx, items[i].text, chipX, chipY, 56, !!items[i].accent) + 10;
  }
  ctx.fillStyle = '#7e88a6';
  ctx.font = '800 16px ' + VIDEO_FONT;
  videoSpacedText(ctx, copy.now, 42, 1188, 2.8, 'left');
  videoDrawCta(ctx, copy);
  videoRoundRect(ctx, VIDEO_BAR.x, VIDEO_BAR.y, VIDEO_BAR.w, VIDEO_BAR.h, VIDEO_BAR.h / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.075)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#7e88a6';
  ctx.font = '600 22px ' + VIDEO_FONT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(recDurationLabel(v.duration), VIDEO_BAR.x + VIDEO_BAR.w, VIDEO_BAR.y + 40);
  // Нижние 300 px могут перекрыть интерфейсы соцсетей: там только декор.
  ctx.save();
  ctx.globalAlpha = 0.06;
  videoDrawLogo(ctx, 540, 1728, 118);
  ctx.globalAlpha = 0.045;
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 56px ' + VIDEO_FONT;
  videoSpacedText(ctx, 'HARMONIA', 540, 1844, 12, 'center');
  ctx.restore();
  v.base = canvas;
  v.copy = copy;
  v.ticksCanvas = videoBuildTicks(v);
  v.endCanvas = videoBuildEndCard(v);
  return canvas;
}
function videoBuildTicks(v) {
  const width = Math.round(VIDEO_BAR.w);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 18;
  const ctx = canvas.getContext('2d');
  if (!ctx || !v || !v.duration || !v.timeline.length) return canvas;
  const n = v.timeline.length;
  const step = Math.max(1, Math.ceil(n / 140));
  const first = Number(v.firstEventAt) || 0;
  let lastDrawn = -1;
  const tick = (ev) => {
    const contentAt = VIDEO_LEAD_MS + Math.max(0, (Number(ev.t) || 0) - first);
    const x = Math.round(clamp(contentAt / v.duration, 0, 1) * (width - 4)) + 2;
    const color = ev.type === 'drum' ? '#a455e3' : ev.type === 'chord' ? '#ffd166' : '#6bdfff';
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, ev.type === 'drum' ? 5 : 2);
    ctx.lineTo(x, 16);
    ctx.stroke();
  };
  for (let i = 0; i < n; i += step) {
    tick(v.timeline[i]);
    lastDrawn = i;
  }
  if (lastDrawn !== n - 1) tick(v.timeline[n - 1]);
  return canvas;
}
function videoBuildEndCard(v) {
  const rec = v.rec || {};
  const copy = v.copy || videoCopy();
  const canvas = document.createElement('canvas');
  canvas.width = VIDEO_W;
  canvas.height = VIDEO_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  videoBackdrop(ctx);
  ctx.fillStyle = 'rgba(6,8,14,0.82)';
  ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  [280, 420, 560, 700].forEach(r => {
    ctx.beginPath();
    ctx.arc(540, 860, r, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.restore();
  videoDrawLogo(ctx, 540, 522, 88);
  ctx.save();
  ctx.font = '800 104px ' + VIDEO_FONT;
  const wordmark = ctx.createLinearGradient(190, 0, 890, 0);
  wordmark.addColorStop(0, '#6bdfff');
  wordmark.addColorStop(0.52, '#a455e3');
  wordmark.addColorStop(1, '#ff1541');
  ctx.fillStyle = wordmark;
  videoSpacedText(ctx, 'HARMONIA', 540, 716, 10, 'center');
  ctx.restore();
  ctx.fillStyle = '#9aa4c2';
  ctx.font = '600 36px ' + VIDEO_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(copy.tagline, 540, 774);
  const rule = ctx.createLinearGradient(190, 0, 890, 0);
  rule.addColorStop(0, 'rgba(107,223,255,0)');
  rule.addColorStop(0.5, 'rgba(107,223,255,0.50)');
  rule.addColorStop(1, 'rgba(255,21,65,0)');
  ctx.fillStyle = rule;
  ctx.fillRect(190, 820, 700, 1.5);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 56px ' + VIDEO_FONT;
  ctx.fillText(videoFitText(ctx, copy.endTitle, 900), 540, 934);
  ctx.fillStyle = '#9aa4c2';
  ctx.font = '600 32px ' + VIDEO_FONT;
  ctx.fillText(videoFitText(ctx, copy.endSub, 900), 540, 988);
  const pillW = 690, pillH = 80, pillX = (VIDEO_W - pillW) / 2, pillY = 1042;
  videoRoundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fillStyle = 'rgba(107,223,255,0.09)';
  ctx.fill();
  const pillLine = ctx.createLinearGradient(pillX, 0, pillX + pillW, 0);
  pillLine.addColorStop(0, 'rgba(107,223,255,0.75)');
  pillLine.addColorStop(1, 'rgba(164,85,227,0.75)');
  ctx.strokeStyle = pillLine;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#6bdfff';
  ctx.font = '800 36px ' + VIDEO_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(VIDEO_URL, 540, pillY + pillH / 2 + 1);
  ctx.fillStyle = '#7e88a6';
  ctx.font = '600 30px ' + VIDEO_FONT;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(copy.endNote, 540, 1192);
  ctx.fillStyle = '#5f6880';
  ctx.font = '600 26px ' + VIDEO_FONT;
  ctx.fillText(videoFitText(ctx, videoTitle(rec), 820), 540, 1252);
  ctx.save();
  ctx.globalAlpha = 0.06;
  videoDrawLogo(ctx, 540, 1712, 112);
  ctx.restore();
  return canvas;
}
function videoPaintStage(ctx) {
  const s = VIDEO_STAGE;
  ctx.save();
  videoRoundRect(ctx, s.x, s.y, s.w, s.h, s.r);
  ctx.clip();
  ctx.drawImage(penCanvas, 0, 0, penCanvas.width, penCanvas.height, s.x, s.y, s.w, s.h);
  ctx.drawImage(spriteCanvas, 0, 0, spriteCanvas.width, spriteCanvas.height, s.x, s.y, s.w, s.h);
  ctx.restore();
  videoRoundRect(ctx, s.x, s.y, s.w, s.h, s.r);
  ctx.strokeStyle = 'rgba(107,223,255,0.32)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.055)';
  ctx.lineWidth = 1;
  ctx.stroke();
}
// Последний музыкальный аккорд/нота к текущему моменту. Удары не меняют
// подпись: она про гармонию, а не про ритм.
function videoLabelAt(v, contentMs) {
  const at = contentMs + (Number(v.firstEventAt) || 0);
  while (v.labelIdx < v.timeline.length &&
         (Number(v.timeline[v.labelIdx].t) || 0) <= at) {
    const ev = v.timeline[v.labelIdx];
    if (ev.type === 'chord' && ev.h) {
      const degree = ev.h.degree ? ev.h.degree + ' · ' : '';
      v.labelText = degree + (ev.h.name || '');
      v.labelColor = ev.h.tonic ? '#ffd166' : '#6bdfff';
    } else if (ev.type === 'note' && ev.midi != null) {
      let name = String(ev.midi);
      if (typeof sharpLabel === 'function') name = sharpLabel(Number(ev.midi) % 12);
      if (typeof noteLabel === 'function') name = noteLabel(name);
      v.labelText = '♪ ' + name;
      v.labelColor = '#4ec3ff';
    }
    v.labelIdx += 1;
  }
  return { text: v.labelText || '—', color: v.labelColor || '#7e88a6' };
}
function videoPaintNow(ctx, v, contentMs) {
  const label = videoLabelAt(v, contentMs);
  ctx.save();
  ctx.font = '800 32px ' + VIDEO_FONT;
  const text = videoFitText(ctx, label.text, 820);
  const w = Math.min(VIDEO_STAGE.w, ctx.measureText(text).width + 82);
  const x = 42, y = 1198, h = 56;
  videoRoundRect(ctx, x, y, w, h, 17);
  ctx.fillStyle = 'rgba(12,15,24,0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.13)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = label.color;
  ctx.shadowColor = label.color;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(x + 30, y + h / 2, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#eef2ff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 52, y + h / 2 + 1);
  ctx.restore();
}
function videoPaintProgress(ctx, v, elapsed) {
  const duration = Math.max(1, v.duration || 1);
  const p = clamp(elapsed / duration, 0, 1);
  if (p > 0) {
    ctx.save();
    videoRoundRect(ctx, VIDEO_BAR.x, VIDEO_BAR.y, VIDEO_BAR.w, VIDEO_BAR.h, VIDEO_BAR.h / 2);
    ctx.clip();
    const fill = ctx.createLinearGradient(VIDEO_BAR.x, 0, VIDEO_BAR.x + VIDEO_BAR.w, 0);
    fill.addColorStop(0, '#6bdfff');
    fill.addColorStop(0.6, '#a455e3');
    fill.addColorStop(1, '#ff5d7b');
    ctx.fillStyle = fill;
    ctx.fillRect(VIDEO_BAR.x, VIDEO_BAR.y, Math.max(1, VIDEO_BAR.w * p), VIDEO_BAR.h);
    ctx.restore();
  }
  if (v.ticksCanvas) ctx.drawImage(v.ticksCanvas, VIDEO_BAR.x, VIDEO_BAR.y - 4);
  ctx.save();
  ctx.fillStyle = '#9aa4c2';
  ctx.font = '600 22px ' + VIDEO_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(recDurationLabel(Math.min(elapsed, duration)), VIDEO_BAR.x, VIDEO_BAR.y + 40);
  ctx.restore();
}
function paintVideoFrame() {
  const v = videoJob;
  if (!v || !v.ctx) return;
  if (!v.base && !videoBuildBase(v)) return;
  const ctx = v.ctx;
  const elapsed = v.recorderStartedAt
    ? Math.max(0, performance.now() - v.recorderStartedAt)
    : 0;
  ctx.drawImage(v.base, 0, 0);
  videoPaintStage(ctx);
  // До первого события подпись остаётся «—»: секунда входа не показывает
  // аккорд раньше, чем он прозвучит.
  videoPaintNow(ctx, v, elapsed - VIDEO_LEAD_MS);
  videoPaintProgress(ctx, v, Math.min(v.duration, elapsed));
  // Финальная карточка проявляется за 350 мс; к концу ролика она непрозрачна.
  if (v.endCanvas && v.endCardAt && elapsed >= v.endCardAt) {
    const alpha = clamp((elapsed - v.endCardAt) / 350, 0, 1);
    if (alpha > 0) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(v.endCanvas, 0, 0);
      ctx.restore();
    }
  }
}
function clearVideoTimers(v) {
  if (!v) return;
  if (v.scheduler) { clearInterval(v.scheduler); v.scheduler = null; }
  if (v.progress) { clearInterval(v.progress); v.progress = null; }
  if (v.endTimer) { clearTimeout(v.endTimer); v.endTimer = null; }
  if (v.stopFallback) { clearTimeout(v.stopFallback); v.stopFallback = null; }
  v.timers.forEach(id => clearTimeout(id));
  v.timers = [];
}
function downloadVideoBlob(v) {
  try {
    const blob = new Blob(v.chunks, { type: v.mime || 'video/webm' });
    if (!blob.size) {
      toast('Видео не удалось сохранить');
      return '';
    }
    const name = videoFileName(v.rec);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('Видео сохранено · ' + name, 'good');
    return name;
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('video: download failed', e);
    toast('Видео не удалось сохранить');
    return '';
  }
}
// Завершение одного экспорта: снять таймеры, закрыть потоки, вернуть состояние.
// Функция идемпотентна: MediaRecorder.onstop и страховочный таймер могут прийти
// в любом порядке.
function finishVideoExport(v) {
  if (!v || v.finished) return;
  v.finished = true;
  clearVideoTimers(v);
  if (videoJob === v) videoJob = null;
  if (v.stream) v.stream.getTracks().forEach(track => { try { track.stop(); } catch (e) {} });
  if (v.canvasStream) v.canvasStream.getTracks().forEach(track => { try { track.stop(); } catch (e) {} });
  if (v.audioStream) v.audioStream.getTracks().forEach(track => { try { track.stop(); } catch (e) {} });
  releaseAudioCapture();
  v.recorder = null;
  v.stream = null;
  v.canvasStream = null;
  v.audioStream = null;
  state.videoExport = false;
  state.replay = false;
  state.playingRecording = false;
  if (typeof cancelPendingNoteChord === 'function') cancelPendingNoteChord();
  if (typeof dampPedalVoices === 'function') dampPedalVoices();
  hideVideoOverlay();
  if (v.save && !v.canceled) downloadVideoBlob(v);
  else if (v.canceled) toast('Экспорт видео отменён');
  paintRecorder();
  // После ролика возвращаем фоновую автозапись текущей станции и снимаем
  // паузу с таймера карточки оценки (если она была открыта).
  if (typeof autoRecordStart === 'function') autoRecordStart();
  if (typeof Research !== 'undefined' &&
      typeof Research.holdAsk === 'function') Research.holdAsk(false);
}
function stopVideoRecorder(v, save) {
  if (!v || v.stopping) return;
  v.stopping = true;
  v.save = !!save;
  clearVideoTimers(v);
  try {
    if (v.recorder && v.recorder.state !== 'inactive') {
      v.recorder.stop();
      // onstop обычно приходит сразу; страховка не даёт оставить интерфейс
      // заблокированным, если браузер потерял событие.
      v.stopFallback = setTimeout(() => finishVideoExport(v), 1200);
      return;
    }
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('video: stop failed', e);
  }
  finishVideoExport(v);
}
function cancelVideoExport() {
  const v = videoJob;
  if (!v) return;
  v.canceled = true;
  stopVideoRecorder(v, false);
}
// Звук ставится по часам AudioContext с упреждением: setTimeout отвечает за
// картинку, а не за ритм. Поэтому даже при занятом кадре удары не «плывут».
function scheduleVideoAudio(v) {
  if (!v || videoJob !== v || v.canceled || !audioCtx) return;
  const horizon = audioCtx.currentTime + VIDEO_LOOKAHEAD;
  const first = Number(v.firstEventAt) || 0;
  while (v.audioIdx < v.timeline.length) {
    const ev = v.timeline[v.audioIdx];
    const contentAt = Math.max(0, (Number(ev.t) || 0) - first);
    const at = v.audioStart + contentAt / 1000;
    if (at > horizon) break;
    playRecordedAudio(ev, v.rec, Math.max(at, audioCtx.currentTime));
    v.audioIdx += 1;
  }
}
async function startVideoExport(target) {
  // Без аргумента — выбранная запись панели; с аргументом — конкретная запись,
  // например та, к которой относится открытая карточка оценки.
  const rec = target || selectedRecording();
  if (state.videoExport || !rec || !rec.events || !rec.events.length) {
    if (rec && (!rec.events || !rec.events.length)) toast('В записи нет нот');
    return '';
  }
  if (state.recording || state.recordingCountIn || state.playingRecording) return '';
  if (!videoSupported()) {
    toast('Видео не поддерживается браузером');
    return '';
  }
  let v = null;
  try {
    if (!state.started) { initAudio(); beginFromOverlay(); }
    if (state.paused) setPaused(false);
    stopPlayback();
    if (typeof autoRecordFinalize === 'function') autoRecordFinalize();
    initAudio();
    if (!audioCtx) throw new Error('audio is not ready');
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const token = ++videoToken;
    const timeline = recordingTimeline(rec);
    const firstEventAt = timeline.length
      ? Math.max(0, Number(timeline[0].t) || 0)
      : 0;
    const lastEventAt = timeline.length
      ? Math.max(0, Number(timeline[timeline.length - 1].t) || 0)
      : 0;
    const contentEndAt = Math.max(0, lastEventAt - firstEventAt);
    v = {
      token, rec, timeline, firstEventAt, lastEventAt, contentEndAt,
      endCardAt: VIDEO_LEAD_MS + contentEndAt + VIDEO_TAIL_MS,
      duration: videoDuration(rec),
      chunks: [], timers: [], audioIdx: 0,
      labelIdx: 0, labelText: '—', labelColor: '#7e88a6',
      canceled: false, preparing: true, save: false
    };
    if (!v.timeline.length) return '';
    videoJob = v;
    state.videoExport = true;
    state.replay = true;
    // Карточка оценки может оставаться открытой под рендером: её автопропуск
    // не должен сработать, пока игрок ждёт файл.
    if (typeof Research !== 'undefined' &&
        typeof Research.holdAsk === 'function') Research.holdAsk(true);
    paintRecorder();
    showVideoOverlay();
    updateVideoOverlay(v);
    // Даём живым ударам, уже стоящим в AudioContext, прозвучать до захвата.
    await new Promise(resolve => setTimeout(resolve, VIDEO_FLUSH_MS));
    if (videoJob !== v || v.canceled) return '';
    v.preparing = false;

    const canvas = document.createElement('canvas');
    canvas.width = VIDEO_W;
    canvas.height = VIDEO_H;
    v.canvas = canvas;
    v.ctx = canvas.getContext('2d');
    if (!v.ctx) throw new Error('canvas 2d is unavailable');
    paintVideoFrame();

    const audioStream = audioCaptureStream();
    if (!audioStream) throw new Error('audio capture is unavailable');
    v.audioStream = audioStream;
    const canvasStream = canvas.captureStream(VIDEO_FPS);
    v.canvasStream = canvasStream;
    const stream = new MediaStream();
    canvasStream.getVideoTracks().forEach(track => stream.addTrack(track));
    audioStream.getAudioTracks().forEach(track => stream.addTrack(track));
    v.stream = stream;

    const mime = videoMimeType();
    const options = { videoBitsPerSecond: 5000000, audioBitsPerSecond: 128000 };
    if (mime) options.mimeType = mime;
    const recorder = new MediaRecorder(stream, options);
    v.recorder = recorder;
    v.mime = mime || recorder.mimeType || 'video/webm';
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) v.chunks.push(e.data);
    };
    recorder.onstop = () => finishVideoExport(v);
    recorder.onerror = (e) => {
      if (typeof console !== 'undefined') console.warn('video: recorder error', e);
      v.canceled = true;
      toast('Видео не удалось сохранить');
      stopVideoRecorder(v, false);
    };
    recorder.start(250);
    v.recorderStartedAt = performance.now();

    v.audioStart = audioCtx.currentTime + VIDEO_LEAD_MS / 1000;
    scheduleVideoAudio(v);
    v.scheduler = setInterval(() => scheduleVideoAudio(v), 40);
    v.timeline.forEach(ev => {
      const contentAt = Math.max(0, (Number(ev.t) || 0) - firstEventAt);
      const delay = VIDEO_LEAD_MS + contentAt;
      v.timers.push(setTimeout(() => {
        if (videoJob !== v || v.canceled) return;
        playRecordedVisual(ev, v.rec);
      }, delay));
    });
    v.progress = setInterval(() => {
      if (videoJob !== v) return;
      updateVideoOverlay(v);
      paintRecorder();
    }, 250);
    // v.duration уже включает секунду входа, хвост и финальную карточку.
    v.endTimer = setTimeout(() => {
      if (videoJob !== v || v.canceled) return;
      stopVideoRecorder(v, true);
    }, v.duration + 120);

    const warning = videoLegacyWarning(rec);
    if (warning) toast(warning);
    else toast('🎬 Видео: ' + videoTitle(rec));
    return rec.id;
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('video: export failed', e);
    if (v && videoJob === v) {
      v.canceled = true;
      finishVideoExport(v);
    } else {
      state.videoExport = false;
      state.replay = false;
      hideVideoOverlay();
      releaseAudioCapture();
      paintRecorder();
    }
    toast('Видео не удалось сохранить');
    return '';
  }
}
function initVideoExport() {
  const btn = $('recVideo');
  const cancel = $('videoCancel');
  const caption = $('recCaption');
  if (btn) btn.addEventListener('click', () => { startVideoExport(); });
  if (cancel) cancel.addEventListener('click', cancelVideoExport);
  if (caption) caption.addEventListener('click', () => { copyVideoCaption(); });
  window.addEventListener('beforeunload', () => {
    if (videoJob) stopVideoRecorder(videoJob, false);
  });
}
initVideoExport();
