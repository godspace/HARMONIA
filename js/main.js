/* HARMONIA · js/main.js — запуск приложения и публичный API
   Модуль без сборки: подключается <script> в index.html до main.js.
   Все модули делят глобальную область — имена функций/констант уникальны. */

fillComboSelect();
buildWheel();
buildComboStrip();
buildBalls();
buildNoteRow();
buildChordPad();
buildVizMenu();
initCompose();
buildFormHud();
applyPalette();
syncParticles();
updateHUD();
applyMute();
Midi.init();
initDrawers();
Translate.mount();
fitStage();
// Публичный отладочный API: консоль, автотесты, будущие харнессы.
window.HARMONIA = {
  state, P, CFG, COMBOS, ORDER, INPUT, Midi, Translate, I18N, VIZ, viz, Heard,
  Transport, Composition, setFormEnabled, updateFormHUD,
  harmonicChords, updateHUD, playHarmonic, chordEvent, pressCode, releaseCode, runCommand, loadCombo, setMode, startSession,
  beginFromOverlay, INTRO_KEYS, introPress, introState, introStart,
  drawers, drawerOpen, drawerIntro, setDrawer, toggleDrawer, setDrawerIntro, initDrawers,
  togglePedal, updateSpaceNext, advanceCombo, canAdvanceCombo, comboAdvanceReady,
  nextCombo, prevCombo, nextComboTarget, prevComboTarget,
  diatonicPalette, chordOnDegree, classifyTriad, describeTriad, noteRole, scaleNoteNames, harmonyDebug,
  // Нотация подписей: до-ре-ми ↔ C-D-E и тональности комбо.
  noteLabel, chordLabel, keyNameOf, sharpLabel, letterNoteName, usingLetterNames,
  setNotation, refreshNotation, applyLanguageNotation, notationForLang, resetNotationCaches,
  getBalls: () => balls,
  harmonyFunction, harmonyTransitionBeauty, harmonyOpeningBeauty, harmonyPhraseBeauty,
  handNoteBalls, NOTE_KEYS,
  smartNoteWindow, smartChordDegrees, smartTargetDegree, smartAdaptiveDegree,
  smartSongAnchor, smartTargetHarmony, smartAnchorForChord,
  paletteIndexForChord, requestAdaptiveAnchor, setAdaptiveAnchor, resetAdaptive,
  scheduleAdaptiveApply, applyPendingAdaptiveAnchor,
  shiftNoteOctave, applyNoteLayout,
  noteChord, noteChordPlan, noteChordHarmony, scheduleNoteChord, cancelPendingNoteChord,
  BELL_TIMBRES, voiceVolume, applyVoiceVolumes,
  startRecording, stopRecording, playSelected, stopPlayback, deleteSelectedRecording,
  getRecordings: () => recordings,
  toggleSound, audioRms, spectralCentroid, resetVizLayers, vizDebug, setViz, cycleViz
};
// Алиас на один релиз: старые консольные привычки и внешние сниппеты не ломаются.
window.RITHM = window.HARMONIA;
requestAnimationFrame(render);
