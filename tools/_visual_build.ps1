$ErrorActionPreference = 'Stop'
$html = [IO.File]::ReadAllText((Join-Path $PWD 'index.html'), [Text.Encoding]::UTF8)
$post = @'
<script>
(function () {
  // Стартовое окно открывается пробой десяти клавиш, поэтому скриншот делает
  // тот же путь, что и игра: клавиши пробы нажимаются, затем сессия стартует.
  HARMONIA.INTRO_KEYS.forEach(function (code) { HARMONIA.introPress(code); });
  HARMONIA.beginFromOverlay();
  var st = HARMONIA.state;
  // Показываем smart-окно от доминанты, как после сыгранного V.
  HARMONIA.setAdaptiveAnchor(4);
  st.transport.bpm = 84;
  st.transport.beatsPerBar = 4;
  st.form.enabled = true;
  st.form.running = true;
  st.form.phase = 'playing';
  st.form.bar = 9;
  st.form.beat = 2;
  st.form.sectionId = 'b';
  st.form.sectionLabel = 'B';
  st.form.barTargetHit = true;
  st.form.barChord = { degree: 'V', name: 'G-B-D', hint: '\u0434\u043e\u043c\u0438\u043d\u0430\u043d\u0442\u0430', tonic: false, rootPc: 7, pcsKey: '2,7,11' };
  st.form.points = 18;
  st.form.lastAward = { points: 2, label: '\u0446\u0435\u043b\u044c V', at: performance.now() };
  HARMONIA.Transport.stop();
  HARMONIA.Composition.updateHUD();
})();
</script>
'@
$html = $html.Replace('</body>', $post + '</body>')
[IO.File]::WriteAllText((Join-Path $PWD 'visual.html'), $html, (New-Object Text.UTF8Encoding($false)))
