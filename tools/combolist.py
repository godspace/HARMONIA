#!/usr/bin/env python3
"""Синхронизация data/COMBOLIST.csv → встроенный литерал в js/data.js.

Страница обязана открываться двойным кликом (file://), поэтому CSV нельзя
читать через fetch — он вшит в js/data.js. Источник правды один:
data/COMBOLIST.csv, а этот скрипт переносит его в код.

Перед записью CSV проверяется по музыке: каждая пара должна быть
I–IV–V–I (мажор) или i–iv–V–i (минор), трезвучия — в основной форме.
Поддерживаются # и ♯, b и ♭, а также двойные знаки.

    python tools/combolist.py           # проверить и обновить js/data.js
    python tools/combolist.py --check   # только проверить (CI / pre-commit)
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "COMBOLIST.csv"
DATA_PATH = ROOT / "js" / "data.js"
MARKER = re.compile(r"(const CSV = `)(.*?)(`;)", re.S)
CHORD_RE = re.compile(r"^КОМБО\s*(\d+)\s*,\s*КОМБО\s*(\d+)$")
NOTE_RE = re.compile(r"^(до|ре|ми|фа|соль|ля|си)([#♯♭b♮x]*)$")
LETTERS = ["до", "ре", "ми", "фа", "соль", "ля", "си"]
BASE_PC = {"до": 0, "ре": 2, "ми": 4, "фа": 5, "соль": 7, "ля": 9, "си": 11}
# Ступени COMBOLIST: тоника, субдоминанта, доминанта, тоника.
DEGREE_OFFSETS = [0, 5, 7, 0]


def note_pc(name: str) -> int:
    m = NOTE_RE.match(name.strip())
    if not m:
        raise ValueError("неизвестная нота %r" % name)
    value = BASE_PC[m.group(1)]
    for ch in m.group(2):
        if ch in "#♯":
            value += 1
        elif ch == "x":
            value += 2
        elif ch in "♭b":
            value -= 1
    return value % 12


def note_letter(name: str) -> str:
    m = NOTE_RE.match(name.strip())
    if not m:
        raise ValueError("неизвестная нота %r" % name)
    return m.group(1)


def quality(pcs: list[int]) -> str:
    third = (pcs[1] - pcs[0]) % 12
    fifth = (pcs[2] - pcs[0]) % 12
    return {(4, 7): "мажор", (3, 7): "минор", (3, 6): "уменьш.", (4, 8): "увелич."}.get(
        (third, fifth), "другое"
    )


def validate(csv: str) -> tuple[list[str], int, list[int]]:
    lines = [line.strip() for line in csv.splitlines()]
    errors: list[str] = []
    ids: list[int] = []
    combos = 0
    i = 0
    while i < len(lines):
        m = CHORD_RE.match(lines[i])
        if not m:
            i += 1
            continue
        combos += 1
        ids.extend((int(m.group(1)), int(m.group(2))))
        rows = lines[i + 1:i + 5]
        if len(rows) != 4:
            errors.append("строка %d: у комбо должно быть 4 строки аккордов" % (i + 1))
            i += 1
            continue
        parsed = []
        for j, row in enumerate(rows, 1):
            cells = [cell.strip() for cell in row.split(",")]
            if len(cells) != 2:
                errors.append("строка %d: ожидалось 2 колонки, получено %d" % (i + 1 + j, len(cells)))
                continue
            parsed.append(cells)
        if len(parsed) != 4:
            i += 5
            continue
        try:
            tonics = [note_pc(parsed[0][col].split("-")[0]) for col in (0, 1)]
        except ValueError as exc:
            errors.append("строка %d: %s" % (i + 2, exc))
            i += 5
            continue
        for j, cells in enumerate(parsed, 1):
            for col, cell in enumerate(cells):
                names = [name.strip() for name in cell.split("-")]
                label = "строка %d, колонка %d" % (i + 1 + j, col + 1)
                if len(names) != 3:
                    errors.append("%s: ожидалось 3 ноты, получено %d" % (label, len(names)))
                    continue
                try:
                    pcs = [note_pc(name) for name in names]
                    letters = [note_letter(name) for name in names]
                except ValueError as exc:
                    errors.append("%s: %s" % (label, exc))
                    continue
                expected_quality = "мажор" if col == 0 or j == 3 else "минор"
                third = 4 if expected_quality == "мажор" else 3
                root = (tonics[col] + DEGREE_OFFSETS[j - 1]) % 12
                expected_pcs = [root, (root + third) % 12, (root + 7) % 12]
                if pcs != expected_pcs:
                    errors.append(
                        "%s: %s → %s, ожидалось %s в основной форме"
                        % (label, "-".join(names), quality(pcs), expected_quality)
                    )
                root_letter = LETTERS.index(letters[0])
                expected_letters = [
                    LETTERS[root_letter],
                    LETTERS[(root_letter + 2) % 7],
                    LETTERS[(root_letter + 4) % 7],
                ]
                if letters != expected_letters:
                    errors.append(
                        "%s: написание %s не по терциям, ожидалось %s"
                        % (label, "-".join(letters), "-".join(expected_letters))
                    )
        i += 5
    if not combos:
        errors.append("не найдено ни одного блока КОМБО")
    elif sorted(ids) != list(range(1, len(ids) + 1)):
        errors.append("ID комбо должны быть уникальны и идти подряд с 1: %s" % ids)
    return errors, combos, ids


def main() -> int:
    if not CSV_PATH.exists():
        print("Ошибка: нет файла", CSV_PATH)
        return 2
    csv = CSV_PATH.read_text(encoding="utf-8").replace("\r\n", "\n").strip()
    if "`" in csv:
        print("Ошибка: в CSV не должно быть обратных кавычек")
        return 2
    errors, combos, ids = validate(csv)
    if errors:
        print("Ошибка: CSV не прошёл проверку (%d комбо, %d ошибок)" % (combos * 2, len(errors)))
        for error in errors:
            print(" -", error)
        return 2
    src = DATA_PATH.read_text(encoding="utf-8").replace("\r\n", "\n")
    m = MARKER.search(src)
    if not m:
        print("Ошибка: в js/data.js не найден литерал const CSV = `…`")
        return 2
    lines = len(csv.splitlines())
    print("OK: CSV корректен — %d комбо, ID %d–%d" % (combos * 2, min(ids), max(ids)))
    if "--check" in sys.argv:
        if m.group(2).strip() != csv:
            print("js/data.js рассинхронизирован с data/COMBOLIST.csv")
            return 1
        print("OK: данные совпадают (%d строк)" % lines)
        return 0
    DATA_PATH.write_text(
        src[: m.start(2)] + csv + src[m.end(2):],
        encoding="utf-8",
        newline="\n",
    )
    print("js/data.js обновлён из data/COMBOLIST.csv (%d строк)" % lines)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
