#!/usr/bin/env python3
"""Разбор выгрузки HARMONIA · research — оценки комбо и поведение игрока.

Игра (js/research.js) по умолчанию собирает оценки. Если исследование включено
(по умолчанию; `?research=1`, кнопка панели или `HARMONIA.research.enable()`),
после Space-перехода в новое комбо появляется карточка с оценкой 1–5 и
необязательным комментарием, а каждое посещение комбо сохраняется в localStorage.
Панель **Исследование** отдаёт всё одним JSON-файлом (`harmonia-research-*.json`).

Что делает этот скрипт:
  · читает одну или несколько выгрузок (или сам находит их в корне проекта и
    `data/research/`), склеивает посещения и убирает дубли по id;
  · считает отклик, среднюю оценку, распределение, станции и комбо;
  · сопоставляет оценки с поведением: время в комбо, активную игру, runs,
    плотность нот, смены аккордов и выход;
  · отличает поток, продуктивный поиск, застревание и локальный затык внутри
    хорошего визита, не считая длинный аккорд автоматическим провалом;
  · разбирает сюжет пары: архетип, фазы, переходы и долю времени в «доме»;
  · собирает эталонный профиль (тональности, ступени, переходы) и события
    компаса «куда дальше»;
  · раскладывает свободные комментарии по темам (мягко/жёстко, громко/тихо,
    скучно/интересно, тембр/бас/октава);
  · печатает отчёт в Markdown, пишет CSV по посещениям и подсказывает, какие
    станции стоит слушать внимательнее.

Только стандартная библиотека — как у tools/combolist.py. Запуск:

    python tools/research.py --self-test
    python tools/research.py
    python tools/research.py harmonia-research-20261123-1612.json
    python tools/research.py data/research --md report.md --csv rows.csv --min-n 3
"""
import argparse
import csv
import io
import json
import statistics
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESEARCH_DIR = ROOT / "data" / "research"
MANUAL_MIN_N = 3
ACTIVE_GAP_MS = 5000
# Те же слова, что js/research.js использует для авто-флага reference. Высокая
# оценка без слов остаётся «высокой», но не «эталоном».
REFERENCE_WORDS = (
    "люб", "нрав", "тёпл", "тепл", "мягк", "красив", "обним",
    "love", "warm", "beautiful", "cozy", "moved",
)
VISIT_MODES = ("flow", "productive_struggle", "stuck", "local_stuck", "short", "unrated")
MODE_LABELS = {
    "flow": "поток",
    "productive_struggle": "продуктивный поиск",
    "stuck": "застревание",
    "local_stuck": "локальный затык внутри хорошего визита",
    "short": "слишком коротко",
    "unrated": "без оценки",
}

# Темы комментариев. Слова сравниваются в нижнем регистре подстрокой, поэтому
# русские окончания и английские синонимы ловятся без морфологии. Один
# комментарий может попасть в несколько тем: «мягко и тихо» — это и soft, и quiet.
BUCKETS = {
    "soft": ("мягк", "тёпл", "тепл", "глух", "объём", "объем", "soft", "warm", "mellow"),
    "harsh": ("жёстк", "жестк", "резк", "ярк", "колюч", "harsh", "sharp", "bright"),
    "loud": ("громк", "оглуш", "loud"),
    "quiet": ("тихо", "тих", "шёпот", "шепот", "quiet", "silent"),
    "boring": ("скучн", "однообраз", "повтор", "boring", "dull", "repetit"),
    "interesting": ("нрав", "интерес", "круто", "хорош", "супер", "love", "like",
                    "great", "interesting", "nice"),
    "timbre": ("тембр", "бас", "октав", "колокол", "timbre", "bass", "octave", "bell"),
}


def obj(value) -> dict:
    """Словарь из поля JSON или пустой: файл мог быть отредактирован руками."""
    return value if isinstance(value, dict) else {}


def seg_rating(seg: dict):
    """Оценка 1–5 или None (пропуск/нет ответа)."""
    score = obj(seg.get("rating")).get("score")
    if isinstance(score, bool) or not isinstance(score, int):
        return None
    return score if 1 <= score <= 5 else None


def seg_skipped(seg: dict) -> bool:
    return bool(obj(seg.get("rating")).get("skipped"))


def seg_comment(seg: dict) -> str:
    return str(obj(seg.get("rating")).get("comment") or "").strip()


def station_id(seg: dict) -> str:
    return str(obj(seg.get("station")).get("id") or "unknown")


def combo_id(seg: dict) -> str:
    value = obj(seg.get("combo")).get("id")
    return str(value) if value is not None else "?"


def combo_key(seg: dict) -> str:
    combo = obj(seg.get("combo"))
    return str(combo.get("keyNameLatin") or combo.get("keyName") or "—")


def int_or_none(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def plot_summary(seg: dict) -> dict:
    """Журнал сюжета посещения: архетип, фазы, переходы и доля «дома».

    Старые выгрузки без сюжета дают пустой archetype — анализ их просто
    пропускает, поэтому формат остаётся совместимым.
    """
    plot = obj(seg.get("plot"))
    phases = {}
    for name, value in obj(plot.get("phases")).items():
        count = int_or_none(value)
        if count and count > 0:
            phases[str(name)] = count
    seq = [str(item) for item in (plot.get("phaseSeq") or []) if item]
    # Время в «доме» точнее счётчика аккордов: сначала homeShareMs, затем
    # homeShare, и только для старых записей — доля по counts.
    home_share = plot.get("homeShareMs")
    if not isinstance(home_share, (int, float)) or isinstance(home_share, bool):
        home_share = plot.get("homeShare")
    if not isinstance(home_share, (int, float)) or isinstance(home_share, bool):
        total = sum(phases.values())
        home_share = (phases.get("home", 0) / total) if total else None
    home_ms = plot.get("homeMs")
    total_ms = plot.get("totalMs")
    return {
        "archetype": str(plot.get("archetype") or ""),
        "label": str(plot.get("label") or ""),
        "enabled": bool(plot.get("enabled")),
        "phases": phases,
        "seq": seq,
        "transitions": int_or_none(plot.get("transitions")) or 0,
        "home_share": home_share,
        "home_ms": home_ms if isinstance(home_ms, (int, float)) else None,
        "total_ms": total_ms if isinstance(total_ms, (int, float)) else None,
    }


def counts(seg: dict):
    """(ноты, аккорды) — из готовых counts или из событий старого формата."""
    saved = obj(seg.get("counts"))
    notes = int_or_none(saved.get("notes"))
    chords = int_or_none(saved.get("chords"))
    if notes is None or chords is None:
        events = seg.get("events") or []
        notes = sum(1 for e in events if (e or {}).get("type") == "note")
        chords = sum(1 for e in events if (e or {}).get("type") == "chord")
    return notes, chords


def is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def is_reference_visit(seg: dict) -> bool:
    """Явный флаг важнее эвристики; старые файлы ловятся по 5/5 + словам."""
    rating = obj(seg.get("rating"))
    if rating.get("reference"):
        return True
    if seg_rating(seg) != 5:
        return False
    text = seg_comment(seg).lower()
    return any(word in text for word in REFERENCE_WORDS)


def profile_weight(seg: dict) -> int:
    """Вес визита в эталонном профиле: reference > 5 > 4 > остальные."""
    if is_reference_visit(seg):
        return 3
    score = seg_rating(seg)
    if score == 5:
        return 2
    if score == 4:
        return 1
    return 0


def profile_chord_seq(seg: dict) -> list:
    """Ступени визита: fingerprint.chordSeq, иначе события (старый формат)."""
    fingerprint = obj(seg.get("fingerprint"))
    seq = fingerprint.get("chordSeq")
    if isinstance(seq, list) and seq:
        return [str(item) for item in seq if item][:64]
    events = seg.get("events") or []
    return [
        str(obj(ev).get("degree") or obj(ev).get("name") or "?")
        for ev in events
        if obj(ev).get("type") == "chord"
    ][:64]


def derived_runs(seg: dict, play_ms: int) -> list:
    """Собрать runs из событий, если старый JSON их не сохранил.

    Группировка — по набору pitch class (pcsKey), поэтому повтор аккорда
    остаётся одним run, а смена качества или корня начинает новый.
    """
    events = sorted(
        [ev for ev in (seg.get("events") or []) if isinstance(ev, dict)],
        key=lambda ev: float(ev.get("t") or 0),
    )
    chords = [ev for ev in events if ev.get("type") == "chord"]
    if not chords:
        return []
    runs = []
    group = []
    group_key = None
    for ev in chords:
        key = ev.get("pcsKey")
        if not key:
            pcs = ev.get("pcs") or []
            key = ",".join(str(pc) for pc in sorted(pcs)) if pcs else str(ev.get("degree") or "?")
        if group and key != group_key:
            runs.append(group)
            group = []
        group.append(ev)
        group_key = key
    if group:
        runs.append(group)
    out = []
    for index, group in enumerate(runs, 1):
        start = float(group[0].get("t") or 0)
        next_start = None
        if index < len(runs):
            next_start = float(runs[index][0].get("t") or 0)
        end = next_start if next_start is not None else max(play_ms, start)
        duration = max(0.0, end - start)
        note_count = sum(
            1 for ev in events
            if ev.get("type") == "note" and start <= float(ev.get("t") or 0) < end
        )
        first = group[0]
        out.append({
            "runId": index,
            "runIndex": index,
            "degree": str(first.get("degree") or ""),
            "name": str(first.get("name") or ""),
            "startT": round(start),
            "durationMs": round(duration),
            "notes": note_count,
            "chordHits": len(group),
            "noteDensity": round(note_count / (duration / 1000), 2) if duration > 0 else 0,
            "scoreDelta": 0,
            "endedBy": "change" if next_start is not None else "exit",
        })
    return out


def visit_metrics(seg: dict) -> dict:
    """Поведение одного визита: время, runs, плотность и компактный отпечаток."""
    timing = obj(seg.get("timing"))
    notes, chords = counts(seg)
    play_ms = timing.get("playMs")
    if not is_number(play_ms):
        play_ms = seg.get("playMs")
    if not is_number(play_ms):
        play_ms = seg.get("dwellMs")
    play_ms = int(max(0, play_ms or 0))
    active_ms = timing.get("activePlayMs")
    if not is_number(active_ms):
        active_ms = play_ms
    active_ms = int(max(0, active_ms or 0))
    if active_ms <= 0:
        active_ms = play_ms
    tail_ms = timing.get("tailMs")
    tail_ms = int(max(0, tail_ms or 0)) if is_number(tail_ms) else 0

    events = sorted(
        [ev for ev in (seg.get("events") or []) if isinstance(ev, dict)],
        key=lambda ev: float(ev.get("t") or 0),
    )
    times = [float(ev.get("t") or 0) for ev in events]
    max_gap = 0.0
    gap_count = 0
    for before, after in zip(times, times[1:]):
        gap = max(0.0, after - before)
        max_gap = max(max_gap, gap)
        if gap > ACTIVE_GAP_MS:
            gap_count += 1

    runs = [r for r in (seg.get("runs") or []) if isinstance(r, dict)]
    if not runs:
        runs = derived_runs(seg, play_ms)
    longest = max(runs, key=lambda r: float(r.get("durationMs") or 0), default={})
    longest_ms = int(max(0, longest.get("durationMs") or 0))
    longest_notes = int(max(0, longest.get("notes") or 0))
    longest_hits = int(max(0, longest.get("chordHits") or 0))
    longest_density = float(longest.get("noteDensity") or 0)
    if longest_ms > 0 and not longest_density:
        longest_density = round(longest_notes / (longest_ms / 1000), 2)
    fingerprint = obj(seg.get("fingerprint"))
    chord_changes = int_or_none(obj(seg.get("counts")).get("chordChanges"))
    if chord_changes is None:
        chord_changes = sum(1 for ev in events if ev.get("type") == "chord" and ev.get("chordChanged"))
    change_ratio = chord_changes / chords if chords else 0
    hints = obj(seg.get("hints"))
    if not hints:
        hints = {}
        for ev in events:
            if ev.get("type") == "hint":
                name = str(ev.get("hint") or "")
                if name:
                    hints[name] = hints.get(name, 0) + 1
    return {
        "notes": notes,
        "chords": chords,
        "active_ms": active_ms,
        "play_ms": play_ms,
        "tail_ms": tail_ms,
        "notes_per_s": round(notes / max(0.001, active_ms / 1000), 2) if active_ms else 0,
        "chord_changes": chord_changes,
        "changes_per_min": round(chord_changes / max(0.001, active_ms / 60000), 2) if active_ms else 0,
        "run_count": len(runs),
        "longest_run_ms": longest_ms,
        "longest_run_degree": str(longest.get("degree") or ""),
        "longest_run_notes": longest_notes,
        "longest_run_hits": longest_hits,
        "longest_run_density": longest_density,
        "longest_run_share": round(longest_ms / active_ms, 3) if active_ms else 0,
        "chord_change_ratio": round(change_ratio, 3),
        "max_gap_ms": round(max_gap),
        "gap_count": gap_count,
        "recording_coverage": timing.get("recordingCoverage"),
        "recording_truncated": bool(timing.get("recordingTruncated")),
        "overflow": bool(seg.get("overflow")),
        "unique_pcs": int_or_none(fingerprint.get("uniquePcs")) or 0,
        "unique_chords": int_or_none(fingerprint.get("uniqueChords")) or 0,
        "hints_requested": int(hints.get("requested") or 0),
        "hints_stuck": int(hints.get("stuck") or 0),
        "hints_shown": int(hints.get("shown") or 0),
        "hints_picked": int(hints.get("picked") or 0),
        "hints_ignored": int(hints.get("ignored") or 0),
        "runs": runs,
    }


def classify_visit(rating, metrics: dict) -> str:
    """Разделить поток, продуктивный поиск и застревание.

    Долгий run сам по себе не затык: E major с сильным B-педалем — это поток.
    Затык — долгий run при низкой плотности/малом числе смен или низкая оценка
    без признаков поиска. Локальный затык — то же внутри визита с оценкой 4–5.
    """
    if metrics["notes"] + metrics["chords"] < 6 or metrics["active_ms"] < 8000:
        return "short"
    longest = metrics["longest_run_ms"]
    density = metrics["longest_run_density"]
    # Высокая оценка и высокая общая плотность важнее одного длинного run:
    # E major с B-педалем — поток, а не затык.
    if rating is not None and rating >= 4:
        if (longest >= 30000 and density < 1.8 and
                metrics["notes_per_s"] < 3.0 and metrics["longest_run_share"] >= 0.35):
            return "local_stuck"
        return "flow"
    # Гармонический застой: много повторов одного аккорда при малой доле смен.
    # Так F♯ minor с 62 хитами в run и 24 сменами на 133 аккорда — затык,
    # даже если ноты поверх звучат часто.
    stagnant = longest >= 30000 and (
        (density < 2.0 and metrics["notes_per_s"] < 3.0) or
        metrics["chord_changes"] <= 5 or
        (metrics["longest_run_hits"] >= 20 and metrics["chord_change_ratio"] < 0.3)
    )
    if stagnant:
        return "stuck"
    if metrics["notes_per_s"] >= 2.5 and metrics["chord_changes"] >= 6:
        return "productive_struggle"
    if rating == 3:
        return "productive_struggle"
    if rating is not None and rating <= 2:
        return "stuck"
    return "unrated"


def fmt_mean(value) -> str:
    return "—" if value is None else f"{value:.2f}"


def fmt_ms(value) -> str:
    if value is None:
        return "—"
    return f"{value / 1000:.1f} с"


def iso_time(ms) -> str:
    if not isinstance(ms, (int, float)):
        return ""
    try:
        return datetime.fromtimestamp(ms / 1000).isoformat(timespec="seconds")
    except (OverflowError, OSError, ValueError):
        return ""


def read_payload(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return {"segments": data, "stationStyles": [], "stationTouch": {}, "combos": {}}
    if not isinstance(data, dict):
        raise ValueError(f"{path}: ожидался объект или массив посещений")
    out = dict(data)
    if not isinstance(out.get("segments"), list):
        raise ValueError(f"{path}: нет массива segments")
    return out


def discover() -> list:
    found = []
    found.extend(sorted(ROOT.glob("harmonia-research-*.json")))
    if RESEARCH_DIR.exists():
        found.extend(sorted(RESEARCH_DIR.glob("*.json")))
    # Один и тот же файл не должен попасть дважды, если он лежит в обоих местах.
    seen, unique = set(), []
    for path in found:
        key = str(path.resolve()).lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(path)
    return unique


def merge_payloads(payloads: list) -> dict:
    merged = {
        "segments": [],
        "stationStyles": [],
        "stationTouch": {},
        "stationPlots": {},
        "combos": {},
    }
    seen_ids = set()
    seen_styles = set()
    for payload in payloads:
        for seg in payload.get("segments") or []:
            if not isinstance(seg, dict):
                continue
            key = seg.get("id") or (
                f"{seg.get('enteredAt')}-{seg.get('visit')}-{len(merged['segments'])}"
            )
            if key in seen_ids:
                continue
            seen_ids.add(key)
            merged["segments"].append(seg)
        for style in payload.get("stationStyles") or []:
            if not isinstance(style, dict):
                continue
            sid = style.get("id")
            if sid in seen_styles:
                continue
            seen_styles.add(sid)
            merged["stationStyles"].append(style)
        if not merged["stationTouch"] and isinstance(payload.get("stationTouch"), dict):
            merged["stationTouch"] = payload["stationTouch"]
        if not merged["stationPlots"] and isinstance(payload.get("stationPlots"), dict):
            merged["stationPlots"] = payload["stationPlots"]
        combos = payload.get("combos")
        if isinstance(combos, dict) and not merged["combos"]:
            merged["combos"] = combos
    merged["segments"].sort(key=lambda s: s.get("enteredAt") or 0)
    return merged


def analyze(payload: dict, min_n: int = MANUAL_MIN_N) -> dict:
    segments = [s for s in (payload.get("segments") or []) if isinstance(s, dict)]
    labels = {}
    for style in payload.get("stationStyles") or []:
        if isinstance(style, dict):
            labels[str(style.get("id"))] = str(style.get("label") or style.get("id"))
    plot_labels = {}
    for pid, data in obj(payload.get("stationPlots")).items():
        if isinstance(data, dict):
            plot_labels[str(pid)] = str(data.get("label") or pid)
    ratings = [seg_rating(s) for s in segments]
    rated = [r for r in ratings if r is not None]
    distribution = {i: 0 for i in range(1, 6)}
    for r in rated:
        distribution[r] += 1
    skipped = sum(1 for s, r in zip(segments, ratings) if r is None and seg_skipped(s))
    unanswered = len(segments) - len(rated) - skipped

    stations = {}
    combos = {}
    plot_rows = {}
    phase_counts = Counter()
    phase_counts_high = Counter()
    phase_counts_low = Counter()
    phase_transitions = Counter()
    home_high, home_low = [], []
    plot_visits = 0
    dwell_all = []
    noted = chorder = 0
    metrics_cache = {}

    def seg_metrics(seg: dict) -> dict:
        key = id(seg)
        if key not in metrics_cache:
            metrics_cache[key] = visit_metrics(seg)
        return metrics_cache[key]

    for seg, rating in zip(segments, ratings):
        sid = station_id(seg)
        srow = stations.setdefault(sid, {
            "id": sid,
            "label": labels.get(sid) or str(obj(seg.get("station")).get("label") or sid),
            "visits": 0, "ratings": [], "dwell": [],
        })
        srow["visits"] += 1
        cid = combo_id(seg)
        crow = combos.setdefault(cid, {
            "id": cid,
            "label": combo_key(seg),
            "visits": 0, "ratings": [],
        })
        crow["visits"] += 1
        if rating is not None:
            srow["ratings"].append(rating)
            crow["ratings"].append(rating)
        dwell = seg.get("dwellMs")
        if isinstance(dwell, (int, float)):
            srow["dwell"].append(dwell)
            dwell_all.append(dwell)
        notes, chords = counts(seg)
        noted += notes
        chorder += chords
        # Сюжет: строки агрегируются отдельно от станций, потому что один и тот
        # же характер может встречаться на разных парах, а архетип — общий.
        plot = plot_summary(seg)
        if plot["archetype"]:
            plot_visits += 1
            prow = plot_rows.setdefault(plot["archetype"], {
                "id": plot["archetype"],
                "label": plot_labels.get(plot["archetype"]) or plot["label"] or plot["archetype"],
                "visits": 0, "ratings": [], "home_share": [], "transitions": 0,
            })
            prow["visits"] += 1
            prow["transitions"] += plot["transitions"]
            if rating is not None:
                prow["ratings"].append(rating)
            if plot["home_share"] is not None:
                prow["home_share"].append(plot["home_share"])
                if rating is not None and rating >= 4:
                    home_high.append(plot["home_share"])
                elif rating is not None and rating <= 2:
                    home_low.append(plot["home_share"])
            for phase, count in plot["phases"].items():
                phase_counts[phase] += count
                if rating is not None and rating >= 4:
                    phase_counts_high[phase] += count
                elif rating is not None and rating <= 2:
                    phase_counts_low[phase] += count
            seq = plot["seq"]
            for before, after in zip(seq, seq[1:]):
                phase_transitions[f"{before}→{after}"] += 1

    def finish(rows):
        out = []
        for row in rows.values():
            values = row.pop("ratings")
            dwell = row.pop("dwell") if "dwell" in row else []
            row["rated"] = len(values)
            row["mean"] = (sum(values) / len(values)) if values else None
            if dwell:
                row["dwell_mean"] = sum(dwell) / len(dwell)
            out.append(row)
        out.sort(key=lambda r: (
            r["mean"] is None, -(r["mean"] or 0), -r["rated"], r["label"]
        ))
        return out

    stations_all = finish(stations)
    combos_all = finish(combos)
    significant = [r for r in stations_all if r["rated"] >= max(1, min_n)]
    combos_sig = [r for r in combos_all if r["rated"] >= max(1, min_n)]

    plot_archetypes = []
    for row in plot_rows.values():
        values = row.pop("ratings")
        shares = row.pop("home_share")
        row["rated"] = len(values)
        row["mean"] = (sum(values) / len(values)) if values else None
        row["home_share_mean"] = (sum(shares) / len(shares)) if shares else None
        row["transitions_per_visit"] = (
            row["transitions"] / row["visits"] if row["visits"] else 0
        )
        plot_archetypes.append(row)
    plot_archetypes.sort(key=lambda r: (
        r["mean"] is None, -(r["mean"] or 0), -r["rated"], r["label"]
    ))

    exits = Counter()
    high_dwell, low_dwell, no_answer_dwell = [], [], []
    for seg, rating in zip(segments, ratings):
        via = obj(seg.get("exit")).get("via") or "unknown"
        exits[str(via)] += 1
        dwell = seg.get("dwellMs")
        if not isinstance(dwell, (int, float)):
            continue
        if rating is not None and rating >= 4:
            high_dwell.append(dwell)
        elif rating is not None and rating <= 2:
            low_dwell.append(dwell)
        elif rating is None:
            no_answer_dwell.append(dwell)

    buckets = {name: {"total": 0, "high": 0, "low": 0, "examples": []} for name in BUCKETS}
    comments = []
    for seg, rating in zip(segments, ratings):
        text = seg_comment(seg)
        if not text:
            continue
        low = text.lower()
        tier = "high" if rating is not None and rating >= 4 else (
            "low" if rating is not None and rating <= 2 else "")
        negative = ("не нрав", "не понрав", "not like", "don't like", "dislike")
        for name, words in BUCKETS.items():
            if not any(word in low for word in words):
                continue
            # «не нравится» содержит «нрав», но это не тема «интересно/нравится».
            if name == "interesting" and any(word in low for word in negative):
                continue
            bucket = buckets[name]
            bucket["total"] += 1
            if tier:
                bucket[tier] += 1
            if len(bucket["examples"]) < 3:
                bucket["examples"].append(text[:120])
        comments.append({
            "text": text,
            "score": rating,
            "combo": combo_key(seg),
            "station": labels.get(station_id(seg), station_id(seg)),
            "at": iso_time(seg.get("enteredAt")),
        })

    visit_modes = Counter()
    mode_rows = []
    reference_rows = []
    reference_degrees = Counter()
    reference_transitions = Counter()
    reference_keys = Counter()
    reference_profile_visits = 0
    hint_totals = Counter()
    rows = []
    for seg, rating in zip(segments, ratings):
        notes, chords = counts(seg)
        plot = plot_summary(seg)
        metrics = seg_metrics(seg)
        mode = classify_visit(rating, metrics)
        metrics["mode"] = mode
        visit_modes[mode] += 1
        mode_row = {
            "segment_id": seg.get("id") or "",
            "combo_key": combo_key(seg),
            "rating": rating,
            "mode": mode,
            "active_ms": metrics["active_ms"],
            "notes_per_s": metrics["notes_per_s"],
            "chord_changes": metrics["chord_changes"],
            "longest_run_ms": metrics["longest_run_ms"],
            "longest_run_degree": metrics["longest_run_degree"],
            "longest_run_hits": metrics["longest_run_hits"],
            "longest_run_density": metrics["longest_run_density"],
            "chord_change_ratio": metrics["chord_change_ratio"],
        }
        mode_rows.append(mode_row)
        hint_totals["requested"] += metrics["hints_requested"]
        hint_totals["stuck"] += metrics["hints_stuck"]
        hint_totals["shown"] += metrics["hints_shown"]
        hint_totals["picked"] += metrics["hints_picked"]
        hint_totals["ignored"] += metrics["hints_ignored"]
        # Эталонный профиль: строгий reference или высокая оценка 4–5.
        if is_reference_visit(seg) or (rating is not None and rating >= 4):
            reference_profile_visits += 1
            reference_keys[combo_key(seg)] += 1
            weight = profile_weight(seg)
            seq = profile_chord_seq(seg)
            for index, degree in enumerate(seq):
                reference_degrees[degree] += weight
                if index > 0:
                    reference_transitions[f"{seq[index - 1]}>{degree}"] += weight
            if is_reference_visit(seg):
                reference_rows.append(mode_row)
        rows.append({
            "segment_id": seg.get("id") or "",
            "session_id": seg.get("sessionId") or "",
            "visit": seg.get("visit") or "",
            "entered_at": iso_time(seg.get("enteredAt")),
            "left_at": iso_time(seg.get("leftAt")),
            "combo_id": combo_id(seg),
            "combo_key": combo_key(seg),
            "mode": str(obj(seg.get("combo")).get("mode") or ""),
            "station_id": station_id(seg),
            "station_label": labels.get(station_id(seg), station_id(seg)),
            "rating": "" if rating is None else rating,
            "skipped": 1 if (rating is None and seg_skipped(seg)) else 0,
            "dwell_ms": seg.get("dwellMs") or "",
            "play_ms": metrics["play_ms"],
            "active_ms": metrics["active_ms"],
            "tail_ms": metrics["tail_ms"],
            "notes": notes,
            "chords": chords,
            "notes_per_s": metrics["notes_per_s"],
            "chord_changes": metrics["chord_changes"],
            "longest_run_ms": metrics["longest_run_ms"],
            "longest_run_degree": metrics["longest_run_degree"],
            "longest_run_notes": metrics["longest_run_notes"],
            "longest_run_hits": metrics["longest_run_hits"],
            "longest_run_density": metrics["longest_run_density"],
            "chord_change_ratio": metrics["chord_change_ratio"],
            "max_gap_ms": metrics["max_gap_ms"],
            "recording_coverage": (
                "" if metrics["recording_coverage"] is None else metrics["recording_coverage"]
            ),
            "recording_truncated": 1 if metrics["recording_truncated"] else 0,
            "overflow": 1 if metrics["overflow"] else 0,
            "visit_mode": mode,
            "hints_requested": metrics["hints_requested"],
            "hints_picked": metrics["hints_picked"],
            "hints_ignored": metrics["hints_ignored"],
            "plot_archetype": plot["archetype"],
            "plot_phases": ";".join(
                f"{name}:{count}" for name, count in sorted(plot["phases"].items())
            ),
            "plot_transitions": plot["transitions"],
            "plot_home_share": "" if plot["home_share"] is None else plot["home_share"],
            "exit_via": obj(seg.get("exit")).get("via") or "",
            "comment": seg_comment(seg),
        })

    return {
        "visits": len(segments),
        "rated": len(rated),
        "skipped": skipped,
        "unanswered": unanswered,
        "response": (len(rated) / len(segments)) if segments else None,
        "mean": (sum(rated) / len(rated)) if rated else None,
        "median": statistics.median(rated) if rated else None,
        "distribution": distribution,
        "stations": significant,
        "stations_all": stations_all,
        "combos": combos_sig,
        "combos_all": combos_all,
        # Сюжет: агрегаты по архетипам и фазам. Пустые, если выгрузка старая.
        "plot_visits": plot_visits,
        "plot_archetypes": plot_archetypes,
        "phase_counts": dict(phase_counts),
        "phase_counts_high": dict(phase_counts_high),
        "phase_counts_low": dict(phase_counts_low),
        "phase_transitions": dict(phase_transitions.most_common(12)),
        "home_share_high": (sum(home_high) / len(home_high)) if home_high else None,
        "home_share_low": (sum(home_low) / len(home_low)) if home_low else None,
        "exits": dict(exits),
        "dwell_mean": (sum(dwell_all) / len(dwell_all)) if dwell_all else None,
        "dwell_median": statistics.median(dwell_all) if dwell_all else None,
        "dwell_high": (sum(high_dwell) / len(high_dwell)) if high_dwell else None,
        "dwell_low": (sum(low_dwell) / len(low_dwell)) if low_dwell else None,
        "dwell_no_answer": (sum(no_answer_dwell) / len(no_answer_dwell)) if no_answer_dwell else None,
        "notes": noted,
        "chords": chorder,
        "buckets": buckets,
        "comments": comments,
        "rows": rows,
        # Поведение визита: поток / продуктивный поиск / застревание.
        "visit_modes": {name: visit_modes.get(name, 0) for name in VISIT_MODES},
        "mode_rows": mode_rows,
        "flow_rows": [r for r in mode_rows if r["mode"] == "flow"],
        "productive_rows": [r for r in mode_rows if r["mode"] == "productive_struggle"],
        "stuck_rows": [r for r in mode_rows if r["mode"] == "stuck"],
        "local_stuck_rows": [r for r in mode_rows if r["mode"] == "local_stuck"],
        "short_rows": [r for r in mode_rows if r["mode"] == "short"],
        # Эталонный профиль: только высокая оценка/явный reference.
        "reference_rows": reference_rows,
        "reference_profile_visits": reference_profile_visits,
        "reference_keys": [
            {"key": key, "visits": count}
            for key, count in reference_keys.most_common()
        ],
        "reference_degrees": dict(reference_degrees.most_common()),
        "reference_transitions": dict(reference_transitions.most_common(16)),
        "hints": {
            "requested": hint_totals.get("requested", 0),
            "stuck": hint_totals.get("stuck", 0),
            "shown": hint_totals.get("shown", 0),
            "picked": hint_totals.get("picked", 0),
            "ignored": hint_totals.get("ignored", 0),
            "pick_rate": (
                round(hint_totals.get("picked", 0) / hint_totals.get("shown", 0), 3)
                if hint_totals.get("shown", 0) else None
            ),
        },
        "min_n": max(1, min_n),
    }


ROW_FIELDS = [
    "segment_id", "session_id", "visit", "entered_at", "left_at",
    "combo_id", "combo_key", "mode", "station_id", "station_label",
    "rating", "skipped", "dwell_ms", "play_ms", "active_ms", "tail_ms",
    "notes", "chords", "notes_per_s", "chord_changes",
    "longest_run_ms", "longest_run_degree", "longest_run_notes", "longest_run_hits",
    "longest_run_density", "chord_change_ratio",
    "max_gap_ms", "recording_coverage", "recording_truncated", "overflow", "visit_mode",
    "hints_requested", "hints_picked", "hints_ignored",
    "plot_archetype", "plot_phases", "plot_transitions", "plot_home_share",
    "exit_via", "comment",
]


def observations(result: dict) -> list:
    """Короткие выводы, которые можно проверить на слух — не «магия», а данные."""
    out = []
    if not result["visits"]:
        return ["Данных пока нет: включите исследование и сыграйте несколько комбо."]
    if result["response"] is not None and result["response"] < 0.5:
        out.append(
            "Отклик ниже 50 %: карточка оценки мешает играть. Проверьте "
            "`HARMONIA.research.setAsk(false)` для фонового сбора поведения."
        )
    stations = result.get("stations") or []
    if not stations:
        out.append(
            f"По станциям пока мало оценок: ни одна не набрала n ≥ {result['min_n']}. "
            "Продолжайте сбор, выводы по звуку преждевременны."
        )
    elif len(stations) == 1:
        only = stations[0]
        out.append(
            f"Сравнивать станции пока не с чем: только «{only['label']}» набрала "
            f"n ≥ {result['min_n']} ({fmt_mean(only['mean'])})."
        )
    else:
        best, worst = stations[0], stations[-1]
        if best["mean"] is not None and worst["mean"] is not None and best["mean"] - worst["mean"] >= 0.5:
            out.append(
                f"Лучше всех приняли «{best['label']}» ({fmt_mean(best['mean'])} при "
                f"n={best['rated']}), хуже всех — «{worst['label']}» "
                f"({fmt_mean(worst['mean'])} при n={worst['rated']})."
            )
        if result["mean"] is not None:
            below = [s for s in stations if s["mean"] is not None and s["mean"] < result["mean"] - 0.4]
            for row in below:
                out.append(
                    f"Ниже среднего на 0.4+: «{row['label']}» ({fmt_mean(row['mean'])}, "
                    f"n={row['rated']}). Стоит послушать её `touch`/`voicing`/`bass`."
                )
    if result["dwell_high"] is not None and result["dwell_low"] is not None:
        diff = result["dwell_high"] - result["dwell_low"]
        if abs(diff) >= 5000:
            where = "более долгом" if diff > 0 else "более коротком"
            out.append(
                f"Оценки 4–5 звучат при {where} визите ({fmt_ms(result['dwell_high'])} "
                f"против {fmt_ms(result['dwell_low'])} у 1–2): проверьте, не "
                "оценивают ли игроки просто более длинную игру."
            )
    high_home = result.get("home_share_high")
    low_home = result.get("home_share_low")
    if high_home is not None and low_home is not None and abs(high_home - low_home) >= 0.15:
        where = "больше" if high_home > low_home else "меньше"
        out.append(
            f"При оценках 4–5 игрок проводит {where} времени в «доме» "
            f"({high_home:.0%} против {low_home:.0%} у 1–2): сюжет либо держит "
            "слишком долго, либо слишком быстро уводит. Это гипотеза для "
            "следующей серии, а не приговор фазе."
        )
    stuck_rows = result.get("stuck_rows") or []
    if stuck_rows:
        row = sorted(stuck_rows, key=lambda r: -r["longest_run_ms"])[0]
        out.append(
            f"Явное застревание: {row['combo_key']} — run {fmt_ms(row['longest_run_ms'])} "
            f"на {row['longest_run_degree'] or 'одном аккорде'} "
            f"({row.get('longest_run_hits', 0)} хитов, смен {row['chord_changes']}) "
            f"при плотности {row['longest_run_density']:.1f} нот/с. Это не поток: "
            "стоит предложить смену функции или паузу, а не ещё ноты поверх."
        )
    local_rows = result.get("local_stuck_rows") or []
    if local_rows:
        row = local_rows[0]
        out.append(
            f"Локальный затык внутри хорошего визита: {row['combo_key']} — "
            f"{fmt_ms(row['longest_run_ms'])} на {row['longest_run_degree'] or 'аккорде'} "
            "при высокой оценке. Хороший визит может содержать один провал: его "
            "нельзя считать общим провалом станции."
        )
    productive = result.get("productive_rows") or []
    if productive:
        out.append(
            f"Продуктивный поиск: {len(productive)} визит(ов) с высокой плотностью и "
            "сменой аккордов, но без высокой оценки. Это не застревание — скорее "
            "материал, который ещё не сложился."
        )
    hints = result.get("hints") or {}
    if hints.get("requested"):
        rate = "—" if hints.get("pick_rate") is None else f"{hints['pick_rate']:.0%}"
        out.append(
            f"Компас: запросов {hints['requested']}, выбрано {hints.get('picked', 0)} "
            f"({rate}), проигнорировано {hints.get('ignored', 0)}. Если выбор редок, "
            "подсказки объясняют ход, но не продолжают уже сформированное поле."
        )
    if result.get("reference_keys"):
        top = ", ".join(f"{row['key']} ({row['visits']})" for row in result["reference_keys"][:3])
        out.append(f"Эталонные тональности: {top}. Профиль переносится по ступеням только после трёх эталонов.")
    buckets = {name: data for name, data in result["buckets"].items() if data["total"]}
    if buckets:
        top = sorted(buckets.items(), key=lambda kv: (-kv[1]["total"], kv[0]))[:3]
        names = ", ".join(f"{name} ({data['total']})" for name, data in top)
        out.append(f"Чаще всего в комментариях: {names}.")
        harsh = result["buckets"].get("harsh", {})
        if harsh.get("low", 0) > harsh.get("high", 0):
            out.append(
                "«Жёстко/ярко» чаще у низких оценок: уменьшите яркость "
                "(STATION_TOUCH.tone) или плотность голосов у этих станций."
            )
        boring = result["buckets"].get("boring", {})
        if boring.get("total", 0):
            out.append(
                "Есть «скучно/однообразно»: добавьте контраст внутри станции "
                "(регистр, инверсия или бас), не меняя набор нот."
            )
    if not out:
        out.append("Явных перекосов нет: выборка ровная, можно копить оценки дальше.")
    return out


def render_csv(result: dict) -> str:
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=ROW_FIELDS, lineterminator="\n")
    writer.writeheader()
    for row in result["rows"]:
        writer.writerow({key: row.get(key, "") for key in ROW_FIELDS})
    return buffer.getvalue()


def render_md(result: dict) -> str:
    lines = []
    add = lines.append
    add("# HARMONIA · исследование оценок комбо")
    add("")
    add(
        f"Посещений: **{result['visits']}**, оценок: **{result['rated']}**, "
        f"пропусков: **{result['skipped']}**, без ответа: **{result['unanswered']}**."
    )
    if result["mean"] is not None:
        add("")
        add(
            f"Средняя оценка: **{fmt_mean(result['mean'])}**, медиана: "
            f"**{result['median']:.1f}**, отклик: **{result['response']:.0%}**."
        )
    else:
        add("")
        add("Оценок пока нет — есть только поведение.")
    add("")
    add("## Распределение оценок")
    add("")
    add("| Оценка | Сколько |")
    add("| --- | --- |")
    for score in range(5, 0, -1):
        add(f"| {score} | {result['distribution'][score]} |")
    add("")
    add("## Станции")
    add("")
    if result["stations"]:
        add(f"Показаны станции с n ≥ {result['min_n']} (по числу оценок).")
        add("")
        add("| Станция | id | Визитов | Оценок | Средняя | Время в комбо |")
        add("| --- | --- | --- | --- | --- | --- |")
        for row in result["stations"]:
            add(
                f"| {row['label']} | `{row['id']}` | {row['visits']} | {row['rated']} | "
                f"{fmt_mean(row['mean'])} | {fmt_ms(row.get('dwell_mean'))} |"
            )
    else:
        add(f"Ни у одной станции нет {result['min_n']} оценок — выводы преждевременны.")
    add("")
    add("## Комбо")
    add("")
    if result["combos"]:
        add(f"Показаны комбо с n ≥ {result['min_n']}.")
        add("")
        add("| Комбо | id | Визитов | Оценок | Средняя |")
        add("| --- | --- | --- | --- | --- |")
        for row in result["combos"][:16]:
            add(
                f"| {row['label']} | `{row['id']}` | {row['visits']} | "
                f"{row['rated']} | {fmt_mean(row['mean'])} |"
            )
    else:
        add("Мало оценок по отдельным комбо — смотрите таблицу станций.")
    add("")
    add("## Как выходили из комбо")
    add("")
    add("| Выход | Визитов |")
    add("| --- | --- |")
    for via, count in sorted(result["exits"].items(), key=lambda kv: (-kv[1], kv[0])):
        add(f"| `{via}` | {count} |")
    add("")
    if result.get("plot_visits"):
        add("## Сюжет станции")
        add("")
        add("| Архетип | Визитов | Оценок | Средняя | Доля «дома» | Переходов |")
        add("| --- | --- | --- | --- | --- | --- |")
        for row in result.get("plot_archetypes") or []:
            share = "—" if row.get("home_share_mean") is None else f"{row['home_share_mean']:.0%}"
            add(
                f"| `{row['id']}` | {row['visits']} | {row['rated']} | "
                f"{fmt_mean(row['mean'])} | {share} | {row['transitions_per_visit']:.1f} |"
            )
        add("")
        add("| Фаза | Аккордов | В высоких | В низких |")
        add("| --- | --- | --- | --- |")
        for phase in ("home", "departure", "turn", "shadow", "return"):
            if phase not in result.get("phase_counts", {}):
                continue
            add(
                f"| `{phase}` | {result['phase_counts'][phase]} | "
                f"{result.get('phase_counts_high', {}).get(phase, 0)} | "
                f"{result.get('phase_counts_low', {}).get(phase, 0)} |"
            )
        transitions = result.get("phase_transitions") or {}
        if transitions:
            add("")
            top = ", ".join(
                f"`{name}` ×{count}" for name, count in list(transitions.items())[:6]
            )
            add(f"Переходы фаз: {top}.")
        add("")
    add("## Поток, поиск и застревание")
    add("")
    add("| Вид визита | Сколько |")
    add("| --- | --- |")
    for mode in VISIT_MODES:
        add(f"| `{mode}` — {MODE_LABELS[mode]} | {result['visit_modes'].get(mode, 0)} |")
    add("")
    if result.get("mode_rows"):
        add("| Комбо | Оценка | Вид | Плотность | Смен | Длинный run |")
        add("| --- | --- | --- | --- | --- | --- |")
        for row in result["mode_rows"][:20]:
            score = "—" if row["rating"] is None else f"{row['rating']}/5"
            add(
                f"| {row['combo_key']} | {score} | `{row['mode']}` | "
                f"{row['notes_per_s']:.1f} нот/с | {row['chord_changes']} | "
                f"{fmt_ms(row['longest_run_ms'])} · {row['longest_run_degree'] or '—'} |"
            )
        add("")
    if result.get("reference_profile_visits"):
        add("## Эталоны и высокая оценка")
        add("")
        add(
            f"В профиль входят **{result['reference_profile_visits']}** визит(ов): "
            f"строгих эталонов — **{len(result.get('reference_rows') or [])}**."
        )
        add("")
        if result.get("reference_keys"):
            keys = ", ".join(f"{row['key']} ({row['visits']})" for row in result["reference_keys"][:8])
            add(f"Тональности: {keys}.")
            add("")
        if result.get("reference_degrees"):
            degrees = ", ".join(
                f"`{degree}` ×{weight}" for degree, weight in list(result["reference_degrees"].items())[:10]
            )
            add(f"Ступени: {degrees}.")
            add("")
        transitions = result.get("reference_transitions") or {}
        if transitions:
            top = ", ".join(f"`{name}` ×{weight}" for name, weight in list(transitions.items())[:8])
            add(f"Переходы: {top}.")
            add("")
    hints = result.get("hints") or {}
    if hints.get("shown") or hints.get("requested"):
        add("## Подсказки на карточках")
        add("")
        add(
            f"Показано: **{hints.get('shown', 0)}**, выбрано: **{hints.get('picked', 0)}**."
        )
        legacy = []
        if hints.get("requested"):
            legacy.append(f"запросов: **{hints['requested']}**")
        if hints.get("stuck"):
            legacy.append(f"«не знаю»: **{hints['stuck']}**")
        if hints.get("ignored"):
            legacy.append(f"проигнорировано: **{hints['ignored']}**")
        if legacy:
            add("")
            add("Старые события меню: " + ", ".join(legacy) + ".")
        if hints.get("pick_rate") is not None:
            add("")
            add(f"Доля выбранных подсказок: **{hints['pick_rate']:.0%}**.")
        add("")
    add("## Поведение")
    add("")
    add(f"- Нота и аккорд в данных: **{result['notes']}** нот, **{result['chords']}** аккордов.")
    active_values = [row["active_ms"] for row in result["rows"] if row.get("active_ms")]
    if active_values:
        add(f"- Активная игра: среднее **{fmt_ms(sum(active_values) / len(active_values))}** "
            f"из {fmt_ms(result['dwell_mean'])} в комбо.")
    trunc = sum(1 for row in result["rows"] if row.get("recording_truncated"))
    overflow = sum(1 for row in result["rows"] if row.get("overflow"))
    if trunc or overflow:
        add(f"- Усечённые данные: **{overflow}** визит(ов) с overflow событий, "
            f"**{trunc}** с усечённой автозаписью. Агрегаты и отпечаток при этом сохранены.")
    add(f"- Время в комбо: среднее **{fmt_ms(result['dwell_mean'])}**, медиана **{fmt_ms(result['dwell_median'])}**.")
    if result["dwell_high"] is not None or result["dwell_low"] is not None:
        add(
            f"- Оценки 4–5: **{fmt_ms(result['dwell_high'])}**, оценки 1–2: "
            f"**{fmt_ms(result['dwell_low'])}**, без ответа: **{fmt_ms(result['dwell_no_answer'])}**."
        )
    add("")
    add("## Темы комментариев")
    add("")
    add("| Тема | Упоминаний | В высоких | В низких | Примеры |")
    add("| --- | --- | --- | --- | --- |")
    for name, data in sorted(result["buckets"].items(), key=lambda kv: -kv[1]["total"]):
        if not data["total"]:
            continue
        examples = "; ".join(data["examples"][:2]).replace("|", "/")
        add(f"| `{name}` | {data['total']} | {data['high']} | {data['low']} | {examples} |")
    if not result["comments"]:
        add("| — | 0 | 0 | 0 | Комментариев не было |")
    add("")
    add("## Комментарии")
    add("")
    if result["comments"]:
        for item in result["comments"][:24]:
            score = "—" if item["score"] is None else f"{item['score']}/5"
            add(f"- **{score}** · {item['combo']} · {item['station']}: {item['text']}")
    else:
        add("Комментариев не было.")
    add("")
    add("## Наблюдения")
    add("")
    for item in observations(result):
        add(f"- {item}")
    add("")
    return "\n".join(lines)


def synthetic_payload() -> dict:
    """Двенадцать посещений для --self-test: три станции, разные оценки и темы."""
    styles = [
        {"id": "neutral", "label": "эталон"},
        {"id": "felt", "label": "войлок"},
        {"id": "glass", "label": "стекло"},
    ]

    def run(degree, duration, notes, hits=8, ended="change"):
        return {
            "degree": degree, "durationMs": duration, "notes": notes,
            "chordHits": hits, "noteDensity": round(notes / (duration / 1000), 2),
            "endedBy": ended, "scoreDelta": 0, "startT": 0,
        }

    profiles = {
        1: dict(active=55000, notes=600, chords=40, changes=30,
                runs=[run("I", 12000, 80), run("IV", 10000, 70), run("V", 9000, 60),
                      run("I", 8000, 55), run("vi", 7000, 50), run("IV", 6000, 45)],
                seq=["I", "IV", "V", "I", "vi", "IV", "I"], hints=dict(requested=2, shown=2, picked=1, ignored=1),
                rec_cov=0.92, overflow=True),
        2: dict(active=40000, notes=300, chords=25, changes=20,
                runs=[run("I", 18000, 70), run("V", 9000, 55), run("I", 7000, 45)],
                seq=["I", "V", "I", "IV", "I"], rec_cov=0.88),
        3: dict(active=50000, notes=450, chords=35, changes=26,
                runs=[run("I", 15000, 85), run("IV", 11000, 70), run("V", 9000, 60), run("I", 8000, 55)],
                seq=["I", "IV", "V", "I", "ii", "V", "I"], rec_cov=0.9),
        4: dict(active=45000, notes=100, chords=30, changes=22,
                runs=[run("I", 32000, 45), run("IV", 7000, 30), run("I", 6000, 25)],
                seq=["I", "I", "I", "IV", "I"], rec_cov=0.86),
        5: dict(active=4000, notes=4, chords=1, changes=0,
                runs=[run("I", 1000, 4, hits=1)], seq=["I"], rec_cov=0.2),
        6: dict(active=20000, notes=40, chords=6, changes=5,
                runs=[run("I", 12000, 20, hits=3), run("IV", 4000, 10), run("I", 3000, 10)],
                seq=["I", "I", "IV", "I"], rec_cov=0.4),
        7: dict(active=25000, notes=150, chords=20, changes=19,
                runs=[run("I", 8000, 40), run("IV", 7000, 45), run("V", 6000, 35), run("I", 4000, 30)],
                seq=["I", "IV", "V", "I", "vi", "ii", "V", "I"], rec_cov=0.7),
        8: dict(active=18000, notes=50, chords=4, changes=3,
                runs=[run("I", 14000, 25, hits=2), run("IV", 2000, 15), run("I", 2000, 10)],
                seq=["I", "I", "IV", "I"], rec_cov=0.3),
        9: dict(active=3000, notes=3, chords=1, changes=0,
                runs=[run("I", 800, 3, hits=1)], seq=["I"], rec_cov=0.1),
        10: dict(active=45000, notes=90, chords=30, changes=25,
                 runs=[run("I", 40000, 48, hits=10), run("IV", 4000, 25), run("I", 3000, 17)],
                 seq=["I", "I", "I", "IV", "I", "ii", "V", "I"], rec_cov=0.84),
        11: dict(active=42000, notes=300, chords=22, changes=18,
                 runs=[run("I", 16000, 70), run("IV", 10000, 65), run("V", 8000, 55), run("I", 6000, 50)],
                 seq=["I", "IV", "V", "I"], rec_cov=0.9),
        12: dict(active=55000, notes=550, chords=35, changes=28,
                 runs=[run("I", 14000, 80), run("IV", 12000, 75), run("V", 9000, 65), run("I", 7000, 55)],
                 seq=["I", "IV", "I", "vi", "IV", "I"], hints=dict(requested=1, shown=1, picked=1, ignored=0),
                 rec_cov=0.91),
    }

    def seg(index, sid, score, comment="", dwell=30000):
        profile = profiles[index]
        rating = {"score": score, "comment": comment, "at": 1763900000000, "answerMs": 1800}
        if score is None:
            rating["skipped"] = True
        if score == 5 and any(word in comment.lower() for word in REFERENCE_WORDS):
            rating["reference"] = True
        play_ms = max(0, dwell - 2000)
        active = min(play_ms, profile["active"])
        # Синтетический сюжет: высокие оценки сидят в «доме» дольше, низкие
        # чаще уходят. Этого достаточно, чтобы проверить агрегаты и отчёт.
        phase = "home" if score is not None and score >= 4 else "departure"
        home_share = 0.5 if phase == "home" else 0.0
        home_ms = round(play_ms * home_share)
        phases = {phase: 4}
        if phase != "home":
            phases["home"] = 0
        phase_ms = {"home": home_ms, "departure": play_ms - home_ms}
        if phase == "home":
            phase_ms = {"home": play_ms}
        runs = [dict(item, runId=i + 1, runIndex=i + 1)
                for i, item in enumerate(profile["runs"])]
        seq = profile["seq"]
        pcs = [0, 4, 7]
        fingerprint = {
            "chordSeq": seq,
            "transitions": {f"{seq[i - 1]}>{seq[i]}": 1 for i in range(1, len(seq))},
            "pitchClasses": [12, 0, 3, 0, 20, 4, 0, 14, 0, 5, 0, 8],
            "uniquePcs": 7,
            "uniqueChords": len(set(seq)),
        }
        return {
            "id": f"v-{index}",
            "sessionId": "s-test",
            "visit": index,
            "enteredAt": 1763900000000 + index * 60000,
            "leftAt": 1763900000000 + index * 60000 + dwell,
            "dwellMs": dwell,
            "playMs": play_ms,
            "combo": {
                "id": 1 if sid == "neutral" else 2,
                "mode": "major",
                "keyName": "До мажор",
                "keyNameLatin": "C major",
                "root": 0,
            },
            "station": {"id": sid, "label": {"neutral": "эталон", "felt": "войлок",
                                             "glass": "стекло"}[sid]},
            "context": {"stationStyle": "auto", "stationPlot": "auto", "notation": "sol"},
            "plot": {
                "enabled": True,
                "archetype": {"neutral": "flat", "felt": "arch", "glass": "pedal"}[sid],
                "phases": phases,
                "phaseSeq": ["home"] if phase == "home" else ["home", phase],
                "phaseMs": phase_ms,
                "transitions": 0 if phase == "home" else 1,
                "lastPhase": phase,
                "totalMs": play_ms,
                "homeMs": home_ms,
                "homeShareMs": home_share,
                "chords": 4,
                "homeShare": home_share,
            },
            "counts": {
                "notes": profile["notes"], "chords": profile["chords"],
                "chordChanges": profile["changes"],
                "longestChordRun": max(item["durationMs"] for item in runs),
            },
            "runs": runs,
            "timing": {
                "firstEventAt": 0, "lastEventAt": active, "lastNoteAt": active,
                "activePlayMs": active, "tailMs": max(0, play_ms - active),
                "playMs": play_ms,
                "recordingDurationMs": dwell,
                "recordingCoverage": profile["rec_cov"],
                "recordingTruncated": bool(profile.get("overflow")),
                "notesPerSec": round(profile["notes"] / (active / 1000), 2) if active else 0,
                "chordChangesPerSec": round(profile["changes"] / (active / 1000), 2) if active else 0,
            },
            "fingerprint": fingerprint,
            "hints": profile.get("hints", {}),
            "overflow": bool(profile.get("overflow")),
            "score": 300,
            "exit": {"via": "space"},
            "events": [
                {"t": 0, "type": "chord", "degree": seq[0], "pcs": pcs,
                 "pcsKey": ",".join(map(str, pcs)), "phase": phase,
                 "window": [0, 1, 2, 3, 4]},
                {"t": round(active / 2), "type": "note", "midi": 64, "phase": phase},
                {"t": active, "type": "note", "midi": 67, "phase": phase},
            ],
            "rating": rating,
        }

    segments = [
        seg(1, "neutral", 5, "мягко и тепло", 60000),
        seg(2, "neutral", 4, "", 40000),
        seg(3, "neutral", 5, "нравится тембр и бас", 50000),
        seg(4, "neutral", 5, "", 45000),
        seg(5, "neutral", None, "", 20000),
        seg(6, "felt", 2, "жёстко и ярко", 20000),
        seg(7, "felt", 3, "скучно", 25000),
        seg(8, "felt", 2, "громко", 18000),
        seg(9, "felt", None, "", 15000),
        seg(10, "glass", 4, "тихо и мягко", 45000),
        seg(11, "glass", 4, "", 42000),
        seg(12, "glass", 5, "интересно, хороший тембр", 55000),
    ]
    return {
        "schema": "harmonia.research.v1",
        "stationStyles": styles,
        "stationTouch": {"bell": {"decay": 1.0, "tone": 1.0, "wet": 1.0}},
        "combos": {"major": [{"id": 1, "keyNameLatin": "C major"}], "minor": []},
        "segments": segments,
    }


def self_test() -> int:
    payload = synthetic_payload()
    result = analyze(payload, min_n=3)
    assert result["visits"] == 12, result["visits"]
    assert result["rated"] == 10, result["rated"]
    assert result["skipped"] == 2, result["skipped"]
    assert result["unanswered"] == 0, result["unanswered"]
    assert abs(result["mean"] - 3.9) < 1e-9, result["mean"]
    assert result["median"] == 4.0, result["median"]
    assert result["distribution"] == {1: 0, 2: 2, 3: 1, 4: 3, 5: 4}, result["distribution"]
    assert abs(result["response"] - 10 / 12) < 1e-9

    stations = {row["id"]: row for row in result["stations"]}
    assert list(stations) == ["neutral", "glass", "felt"], list(stations)
    assert stations["neutral"]["mean"] == 4.75, stations["neutral"]["mean"]
    assert abs(stations["felt"]["mean"] - 7 / 3) < 1e-9, stations["felt"]["mean"]
    assert stations["felt"]["label"] == "войлок"

    narrow = analyze(payload, min_n=4)
    assert [row["id"] for row in narrow["stations"]] == ["neutral"], narrow["stations"]

    buckets = result["buckets"]
    assert buckets["soft"]["total"] == 2, buckets["soft"]
    assert buckets["harsh"]["total"] == 1, buckets["harsh"]
    assert buckets["boring"]["total"] == 1, buckets["boring"]
    assert buckets["loud"]["total"] == 1, buckets["loud"]
    assert buckets["quiet"]["total"] == 1, buckets["quiet"]
    assert buckets["interesting"]["total"] == 2, buckets["interesting"]
    assert buckets["timbre"]["total"] == 2, buckets["timbre"]
    assert len(result["comments"]) == 7, len(result["comments"])

    # Сюжет: три архетипа, обе фазы, высокие оценки дольше в «доме».
    assert result["plot_visits"] == 12, result["plot_visits"]
    plots = {row["id"]: row for row in result["plot_archetypes"]}
    assert set(plots) == {"flat", "arch", "pedal"}, plots
    assert result["phase_counts"]["home"] > 0, result["phase_counts"]
    assert result["phase_counts"]["departure"] > 0, result["phase_counts"]
    assert result["home_share_high"] is not None and result["home_share_high"] > 0
    assert result["home_share_low"] == 0, result["home_share_low"]
    assert result["rows"][0]["plot_archetype"] == "flat", result["rows"][0]

    # P0a: поток отличается от застревания, локальный затык — от общего.
    modes = result["visit_modes"]
    assert modes["flow"] == 5, modes
    assert modes["local_stuck"] == 2, modes
    assert modes["stuck"] == 2, modes
    assert modes["productive_struggle"] == 1, modes
    assert modes["short"] == 2, modes
    assert result["rows"][0]["visit_mode"] == "flow", result["rows"][0]
    assert result["rows"][3]["visit_mode"] == "local_stuck", result["rows"][3]
    assert result["rows"][7]["visit_mode"] == "stuck", result["rows"][7]
    assert result["rows"][6]["visit_mode"] == "productive_struggle", result["rows"][6]
    assert result["rows"][0]["active_ms"] == 55000, result["rows"][0]
    assert result["rows"][0]["overflow"] == 1, result["rows"][0]
    assert result["hints"]["requested"] == 3, result["hints"]
    assert result["hints"]["picked"] == 2, result["hints"]
    assert result["reference_profile_visits"] == 7, result["reference_profile_visits"]
    assert len(result["reference_rows"]) == 2, result["reference_rows"]
    assert result["reference_degrees"]["I"] > 0, result["reference_degrees"]
    assert result["reference_transitions"].get("I>IV", 0) > 0, result["reference_transitions"]

    # Длинный run сам по себе не приговор: E major с B-педалем и высокой
    # плотностью остаётся потоком, а F♯ minor с 62 хитами и малой долей смен —
    # гармонический затык, даже если ноты поверх частые.
    e_major = {
        "counts": {"notes": 3965, "chords": 35, "chordChanges": 20},
        "timing": {"activePlayMs": 300000, "playMs": 310000},
        "runs": [{"durationMs": 173000, "notes": 12, "chordHits": 12,
                  "noteDensity": 0.07, "degree": "I"}],
        "events": [], "overflow": True,
    }
    f_minor = {
        "counts": {"notes": 295, "chords": 133, "chordChanges": 24},
        "timing": {"activePlayMs": 300000, "playMs": 310000},
        "runs": [{"durationMs": 88000, "notes": 295, "chordHits": 62,
                  "noteDensity": 3.35, "degree": "i"}],
        "events": [],
    }
    assert classify_visit(5, visit_metrics(e_major)) == "flow"
    assert classify_visit(2, visit_metrics(f_minor)) == "stuck"

    md = render_md(result)
    assert "HARMONIA · исследование" in md
    assert "войлок" in md and "Наблюдения" in md
    assert "Сюжет станции" in md and "Доля «дома»" in md
    assert "Поток, поиск и застревание" in md and "local_stuck" in md
    assert "Эталоны и высокая оценка" in md and "C major" in md
    assert "Подсказки на карточках" in md and "Доля выбранных подсказок" in md
    csv_text = render_csv(result)
    lines = [line for line in csv_text.splitlines() if line.strip()]
    assert lines[0].startswith("segment_id,"), lines[0]
    assert len(lines) == 13, len(lines)
    # Комментарий с запятой должен быть в кавычках — это работа csv, но проверяем.
    assert '"интересно, хороший тембр"' in csv_text

    empty = analyze({"segments": []}, min_n=3)
    assert empty["visits"] == 0 and empty["mean"] is None
    assert observations(empty), "empty data should still give advice"

    print(
        "OK: self-test — 12 посещений, 10 оценок, средняя 3.90; "
        "станции neutral 4.75 / glass 4.33 / felt 2.33; min-n=4 оставляет neutral; "
        "визиты: flow 5 / local_stuck 2 / stuck 2 / productive 1 / short 2."
    )
    return 0


def write_text(path: Path, text: str, bom: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8-sig" if bom else "utf-8", newline="\n") as handle:
        handle.write(text)


def expand_inputs(inputs: list) -> list:
    files = []
    for value in inputs:
        path = Path(value)
        if path.is_dir():
            files.extend(sorted(path.glob("*.json")))
        else:
            files.append(path)
    return files


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Разбор выгрузки HARMONIA · research (оценки комбо).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Без аргументов скрипт ищет harmonia-research-*.json в корне проекта\n"
            "и в data/research/. --md без пути печатает отчёт в консоль."
        ),
    )
    parser.add_argument("inputs", nargs="*", help="JSON-выгрузки или папки с ними")
    parser.add_argument("--md", nargs="?", const="-", default=None, metavar="PATH",
                        help="Markdown-отчёт (без пути — в stdout)")
    parser.add_argument("--csv", metavar="PATH", help="CSV по посещениям (UTF-8 с BOM)")
    parser.add_argument("--min-n", type=int, default=MANUAL_MIN_N,
                        help=f"минимум оценок для вывода по станции/комбо (по умолчанию {MANUAL_MIN_N})")
    parser.add_argument("--self-test", action="store_true",
                        help="проверить сам расчёт на синтетических данных")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    files = expand_inputs(args.inputs) if args.inputs else discover()
    if not files:
        print(
            "Не найдено ни одной выгрузки. Скачайте JSON в панели "
            "«Исследование» или передайте путь: python tools/research.py FILE.json",
            file=sys.stderr,
        )
        return 2

    payloads = []
    used = []
    for path in files:
        if not path.exists():
            print(f"Пропуск: нет файла {path}", file=sys.stderr)
            continue
        try:
            payloads.append(read_payload(path))
            used.append(path)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            print(f"Пропуск {path}: {exc}", file=sys.stderr)
    if not payloads:
        print("Ни одна выгрузка не прочитана.", file=sys.stderr)
        return 2

    merged = merge_payloads(payloads)
    result = analyze(merged, args.min_n)
    print(f"Файлов: {len(used)} · посещений: {result['visits']} · оценок: {result['rated']}")

    if args.csv:
        out = Path(args.csv)
        write_text(out, render_csv(result), bom=True)
        print(f"CSV: {out}")
    if args.md is not None:
        report = render_md(result)
        if args.md == "-":
            print()
            print(report)
        else:
            out = Path(args.md)
            write_text(out, report)
            print(f"Markdown: {out}")
    if args.md is None and not args.csv:
        mean = "—" if result["mean"] is None else f"{result['mean']:.2f}"
        resp = "—" if result["response"] is None else f"{result['response']:.0%}"
        print(
            f"Средняя оценка: {mean} · пропусков: {result['skipped']} · отклик: {resp}"
        )
        for item in observations(result):
            print(" -", item)
    return 0


if __name__ == "__main__":
    # Windows-консоль по умолчанию cp1251: без этого кириллица в отчёте падает.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass
    raise SystemExit(main())
