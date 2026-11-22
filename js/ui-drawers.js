/* HARMONIA · js/ui-drawers.js — выдвижные панели: верхнее меню и панель настроек
   Модуль без сборки: подключается <script> в index.html до main.js.
   Все модули делят глобальную область — имена функций/констант уникальны. */

// drawers.* — состояние панели (true — открыта), drawers.intro — режим старта.
// Одна запись состояния на обе панели: разметка только читает её, поэтому кнопка
// внутри панели, таб на её краю и aria-expanded не могут разойтись.
// Сессия начинается с чистой сцены: панели свёрнуты, на краях только табы, и
// игрок открывает меню сам, когда ему понадобятся настройки.
const drawers = { topbar: false, panel: false, intro: true };

// Эффективное состояние панели. Во время пробы пальцев закрыто всё, включая
// табы: стартовый экран занимает пространство целиком.
function drawerOpen(name) {
  return !drawers.intro && !!drawers[name];
}
function drawerIntro() {
  return drawers.intro;
}
// Единственная точка записи в DOM: классы панелей, табы и aria. Затем fitStage()
// пересчитывает масштаб сцены — освободившиеся пиксели сразу уходят в сцену.
function paintDrawers() {
  document.body.classList.toggle('intro', drawers.intro);
  [['topbar', 'topbarHide', 'topbarTab'], ['panel', 'panelHide', 'panelTab']].forEach(([name, hideId, tabId]) => {
    const open = drawerOpen(name);
    const box = $(name);
    if (box) box.classList.toggle('closed', !open);
    const hide = $(hideId);
    if (hide) hide.setAttribute('aria-expanded', String(open));
    const tab = $(tabId);
    if (tab) {
      tab.classList.toggle('show', !open && !drawers.intro);
      tab.setAttribute('aria-expanded', String(open));
    }
  });
  if (typeof fitStage === 'function') fitStage();
}
function setDrawer(name, open) {
  if (name !== 'topbar' && name !== 'panel') return;
  drawers[name] = !!open;
  paintDrawers();
}
function toggleDrawer(name) {
  setDrawer(name, !drawers[name]);
}
// Проба пальцев: хром прячется на всё время знакомства с клавишами. Режим
// снимает startSession() — и панели остаются свёрнутыми, а табы возвращаются:
// игрок сразу играет, а меню открывает только по необходимости.
function setDrawerIntro(on) {
  const next = !!on;
  if (drawers.intro === next) return;
  drawers.intro = next;
  paintDrawers();
}
function initDrawers() {
  [
    ['topbarHide', 'topbar', false],
    ['panelHide', 'panel', false],
    ['topbarTab', 'topbar', true],
    ['panelTab', 'panel', true]
  ].forEach(([id, name, open]) => {
    const el = $(id);
    if (el) el.addEventListener('click', () => setDrawer(name, open));
  });
  paintDrawers();
}
