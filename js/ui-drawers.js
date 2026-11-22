/* HARMONIA · js/ui-drawers.js — выдвижные панели: верхнее меню и панель настроек
   Модуль без сборки: подключается <script> в index.html до main.js.
   Все модули делят глобальную область — имена функций/констант уникальны. */

// drawers.* — выбор игрока (true — панель открыта), drawers.intro — режим старта.
// Одна запись состояния на обе панели: разметка только читает её, поэтому кнопка
// внутри панели, таб на её краю и aria-expanded не могут разойтись.
const drawers = { topbar: true, panel: true, intro: true };
const DRAW_KEY = 'harmonia.drawers.v1';

// Эффективное состояние панели. Во время пробы пальцев закрыто всё: стартовый
// экран занимает пространство целиком, а выбор игрока не теряется — панели
// вернутся на старте сессии в том виде, в каком их оставили.
function drawerOpen(name) {
  return !drawers.intro && !!drawers[name];
}
function drawerIntro() {
  return drawers.intro;
}
// Выбор переживает перезагрузку: свернул панель — она не вернётся сама.
// Ошибки хранилища (приватный режим, битый JSON) молча оставляют значения по умолчанию.
function loadDrawerPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAW_KEY) || 'null');
    if (!saved) return;
    if (typeof saved.topbar === 'boolean') drawers.topbar = saved.topbar;
    if (typeof saved.panel === 'boolean') drawers.panel = saved.panel;
  } catch (e) { /* приватный режим или битый JSON */ }
}
function saveDrawerPrefs() {
  try {
    localStorage.setItem(DRAW_KEY, JSON.stringify({ topbar: drawers.topbar, panel: drawers.panel }));
  } catch (e) { /* приватный режим */ }
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
  saveDrawerPrefs();
  paintDrawers();
}
function toggleDrawer(name) {
  setDrawer(name, !drawers[name]);
}
// Проба пальцев: хром прячется на всё время знакомства с клавишами и
// возвращается после старта сессии (его зовёт startSession()).
function setDrawerIntro(on) {
  const next = !!on;
  if (drawers.intro === next) return;
  drawers.intro = next;
  paintDrawers();
}
function initDrawers() {
  loadDrawerPrefs();
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
