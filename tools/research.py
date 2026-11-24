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
  · сопоставляет оценки с поведением: время в комбо, число нот/аккордов, выход;
  · разбирает сюжет пары: архетип, фазы, переходы и долю времени в «доме»;
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

    rows = []
    for seg, rating in zip(segments, ratings):
        notes, chords = counts(seg)
        plot = plot_summary(seg)
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
            "play_ms": seg.get("playMs") or "",
            "notes": notes,
            "chords": chords,
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
        "min_n": max(1, min_n),
    }


ROW_FIELDS = [
    "segment_id", "session_id", "visit", "entered_at", "left_at",
    "combo_id", "combo_key", "mode", "station_id", "station_label",
    "rating", "skipped", "dwell_ms", "play_ms", "notes", "chords",
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
    add("## Поведение")
    add("")
    add(f"- Нота и аккорд в данных: **{result['notes']}** нот, **{result['chords']}** аккордов.")
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

    def seg(index, sid, score, comment="", dwell=30000):
        rating = {"score": score, "comment": comment, "at": 1763900000000, "answerMs": 1800}
        if score is None:
            rating["skipped"] = True
        play_ms = max(0, dwell - 2000)
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
            "counts": {"notes": 8, "chords": 4},
            "score": 300,
            "exit": {"via": "space"},
            "events": [{"t": 0, "type": "chord", "phase": phase, "window": [0, 1, 2, 3, 4]}],
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

    md = render_md(result)
    assert "HARMONIA · исследование" in md
    assert "войлок" in md and "Наблюдения" in md
    assert "Сюжет станции" in md and "Доля «дома»" in md
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
        "станции neutral 4.75 / glass 4.33 / felt 2.33; min-n=4 оставляет neutral."
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
