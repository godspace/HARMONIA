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
  state, P, DEFAULTS, CFG, COMBOS, ORDER, INPUT, Midi, Translate, I18N, VIZ, viz, Heard,
  Transport, Groove, Composition, setFormEnabled, updateFormHUD,
  // Исследование оценок: включено по умолчанию; ?research=0 или панель выключают.
  research: Research,
  groovePattern, grooveSteps, groovePlan,
  harmonicChords, updateHUD, playHarmonic, chordEvent, pressCode, releaseCode, runCommand, loadCombo, setMode, startSession,
  rootMidi,
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
  BELL_TIMBRES, DRUM_TIMBRES, voiceVolume, applyVoiceVolumes, drumHit, drumPlan,
  // Характер станции: расположение голосов, бас, октава и тембр по паре комбо.
  STATION_STYLES, STATION_NEUTRAL, STATION_TOUCH, STATION_GESTURES, STATION_PLOT_GESTURES,
  stationStyleAt, stationStyleFor, stationStyleById, stationRegister, stationPadVoices,
  stationBassOffset, stationShape, stationGesture, stationGestureDelays, stationVoiceDelays,
  setStationStyle, setStationGesture,
  // Сюжет пары: фазы от сыгранных аккордов, подача и предпочтение окна.
  STATION_PLOT_PHASES, STATION_PLOT_ARCHETYPES, STATION_PLOT_BY_STYLE,
  stationPlotEnabled, stationPlotPhase, stationPlotForChord, stationPlotArchetype,
  stationPlotStyle, stationPlotStyleForChord, stationPlotWindowBias, stationPlotText,
  stationPlotAdvance, stationPlotReset, setStationPlot,
  startRecording, stopRecording, playSelected, stopPlayback, deleteSelectedRecording,
  // Автозапись станции, MIDI, WAV и видео: запись — тот же формат событий, что
  // и ручная, плюс combo/station/plot. Ударные живут в отдельной дорожке drums.
  setAutoRecord, autoRecordStart, autoRecordFinalize, autoRecordStatus,
  buildMidiFile, midiRecordingEvents, midiFileName, exportSelectedMidi,
  recordingTonic, recordingTitle, recordingFileName,
  recordDrumAt, recordDrum, recordingTimeline, recordDrumCount,
  recordNote, recordChord, recordEvent,
  startVideoExport, cancelVideoExport, videoExportStatus, videoSupported,
  videoFileName, videoDuration, videoLegacyWarning, videoSize,
  videoCaption, copyVideoCaption,
  startAudioExport, cancelAudioExport, audioExportStatus, audioSupported,
  audioFileName, audioDuration, audioPcmToWav,
  getRecordings: () => recordings, selectedRecording, recordingById,
  toggleSound, audioRms, spectralCentroid, resetVizLayers, vizDebug, setViz, cycleViz
};
// Алиас на один релиз: старые консольные привычки и внешние сниппеты не ломаются.
window.RITHM = window.HARMONIA;
requestAnimationFrame(render);
