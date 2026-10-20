"""Text extraction for specs and data tables: xlsx, docx, pptx, csv/tsv, text.

Office files are zip archives of XML, so the standard library is enough. Every
block carries a location (sheet!cell, slide n, paragraph n) that requirement
and finding entries can cite. Cell values are raw: dates stay serial numbers and
formulas show their cached results.
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from . import textio

MAX_UNCOMPRESSED = 300 * 1024 * 1024
_NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
}


class DocError(ValueError):
    pass


def _zip(path: Path) -> zipfile.ZipFile:
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        raise DocError(f"{path} is not an Office Open XML file (old .xls/.doc/.ppt need converting)") from exc
    total = sum(i.file_size for i in z.infolist())
    if total > MAX_UNCOMPRESSED:
        raise DocError(f"{path} expands to {total} bytes; refusing (limit {MAX_UNCOMPRESSED})")
    return z


def _xml(z: zipfile.ZipFile, name: str) -> ET.Element | None:
    try:
        return ET.fromstring(z.read(name))
    except KeyError:
        return None


def _rels(z: zipfile.ZipFile, name: str) -> dict[str, str]:
    root = _xml(z, name)
    if root is None:
        return {}
    base = name.rsplit("/_rels/", 1)[0]
    out = {}
    for r in root.findall("rel:Relationship", _NS):
        target = r.get("Target", "")
        if target.startswith("/"):
            out[r.get("Id")] = target.lstrip("/")
        else:
            parts = (base + "/" + target).split("/")
            norm: list[str] = []
            for p in parts:
                if p == "..":
                    norm and norm.pop()
                elif p and p != ".":
                    norm.append(p)
            out[r.get("Id")] = "/".join(norm)
    return out


def _col_index(ref: str) -> int:
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):  # type: ignore[union-attr]
        n = n * 26 + ord(ch) - 64
    return n - 1


def xlsx(path: Path, sheet: str | None, max_rows: int) -> list[dict]:
    z = _zip(path)
    shared: list[str] = []
    sst = _xml(z, "xl/sharedStrings.xml")
    if sst is not None:
        for si in sst.findall("m:si", _NS):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{_NS['m']}}}t")))
    wb = _xml(z, "xl/workbook.xml")
    if wb is None:
        raise DocError("xl/workbook.xml missing")
    rels = _rels(z, "xl/_rels/workbook.xml.rels")
    out = []
    sheets = wb.find("m:sheets", _NS)
    for sh in (sheets if sheets is not None else []):
        name = sh.get("name")
        if sheet and name != sheet:
            continue
        target = rels.get(sh.get(f"{{{_NS['r']}}}id"), "")
        root = _xml(z, target)
        rows: list[list[str]] = []
        refs: list[int] = []
        total = 0
        if root is not None:
            for row in root.iter(f"{{{_NS['m']}}}row"):
                total += 1
                if len(rows) >= max_rows:
                    continue
                cells: dict[int, str] = {}
                for c in row.findall("m:c", _NS):
                    t = c.get("t")
                    v = c.find("m:v", _NS)
                    if t == "s" and v is not None:
                        val = shared[int(v.text)] if v.text and int(v.text) < len(shared) else ""
                    elif t == "inlineStr":
                        val = "".join(x.text or "" for x in c.iter(f"{{{_NS['m']}}}t"))
                    else:
                        val = v.text if v is not None and v.text is not None else ""
                    if t == "b":
                        val = "TRUE" if val == "1" else "FALSE"
                    cells[_col_index(c.get("r", "A1"))] = val
                if cells:
                    width = max(cells) + 1
                    rows.append([cells.get(i, "") for i in range(width)])
                    refs.append(int(row.get("r", len(rows))))
        out.append({"sheet": name, "rows": rows, "row_numbers": refs, "total_rows": total,
                    "truncated": total > len(rows)})
    if sheet and not out:
        raise DocError(f"no sheet named {sheet!r}")
    return out


def _wtext(el) -> str:
    """Run text with tabs and line breaks kept."""
    out = []
    for node in el.iter():
        tag = node.tag.split("}")[-1]
        if tag == "t":
            out.append(node.text or "")
        elif tag == "tab":
            out.append("\t")
        elif tag in {"br", "cr"}:
            out.append("\n")
    return "".join(out)


def _blocks(parent):
    """Body-level paragraphs and tables, descending into content controls (w:sdt)."""
    for el in parent:
        tag = el.tag.split("}")[-1]
        if tag == "sdt":
            content = el.find("w:sdtContent", _NS)
            if content is not None:
                yield from _blocks(content)
        elif tag in {"p", "tbl"}:
            yield tag, el


def docx(path: Path) -> list[str]:
    z = _zip(path)
    root = _xml(z, "word/document.xml")
    if root is None:
        raise DocError("word/document.xml missing")
    body = root.find("w:body", _NS)
    lines = []
    n = 0
    for tag, el in _blocks(body if body is not None else []):
        if tag == "p":
            text = _wtext(el)
            if not text.strip():
                continue
            n += 1
            style = el.find("w:pPr/w:pStyle", _NS)
            sval = style.get(f"{{{_NS['w']}}}val", "") if style is not None else ""
            m = re.search(r"(?:Heading|제목)\s*(\d)", sval)
            prefix = "#" * int(m.group(1)) + " " if m else ""
            lines.append(f"[¶{n}] {prefix}{text}")
        elif tag == "tbl":
            n += 1
            lines.append(f"[¶{n}] (table)")
            for tr in el.iter(f"{{{_NS['w']}}}tr"):
                cells = [_wtext(tc).strip().replace("\n", " ") for tc in tr.findall("w:tc", _NS)]
                lines.append("| " + " | ".join(c.replace("|", "\\|") for c in cells) + " |")
    return lines


def pptx(path: Path, notes: bool) -> list[str]:
    z = _zip(path)
    pres = _xml(z, "ppt/presentation.xml")
    if pres is None:
        raise DocError("ppt/presentation.xml missing")
    rels = _rels(z, "ppt/_rels/presentation.xml.rels")
    lines = []
    ids = pres.find("p:sldIdLst", _NS)
    for i, sid in enumerate(ids if ids is not None else [], 1):
        target = rels.get(sid.get(f"{{{_NS['r']}}}id"), "")
        root = _xml(z, target)
        lines.append(f"## slide {i}")
        if root is not None:
            for para in root.iter(f"{{{_NS['a']}}}p"):
                text = "".join(t.text or "" for t in para.iter(f"{{{_NS['a']}}}t")).strip()
                if text:
                    lines.append(text)
        if notes:
            srels = _rels(z, target.rsplit("/", 1)[0] + "/_rels/" + target.rsplit("/", 1)[1] + ".rels")
            for t in srels.values():
                if "notesSlide" in t:
                    nroot = _xml(z, t)
                    if nroot is not None:
                        ntext = " ".join((x.text or "").strip() for x in nroot.iter(f"{{{_NS['a']}}}t")).strip()
                        if ntext:
                            lines.append(f"(notes) {ntext}")
    return lines


def delimited(path: Path, max_rows: int) -> tuple[list[list[str]], str, int]:
    src = textio.open_text(str(path))
    try:
        text = "\n".join(line for _, line in src)
    finally:
        src.close()
    delim = "\t" if path.suffix.lower() == ".tsv" or text.count("\t") > text.count(",") else ","
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    return rows[:max_rows], src.stats.label(), len(rows)


def _col_letter(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def _table(rows: list[list[str]], numbers: list[int] | None = None, letters: bool = False) -> list[str]:
    out = []
    if letters and rows:
        width = max(len(r) for r in rows)
        out.append("   # | " + " | ".join(_col_letter(i) for i in range(width)))
    for i, r in enumerate(rows):
        num = numbers[i] if numbers else i + 1
        out.append(f"{num:>4} | " + " | ".join(c.replace("\n", " ").replace("|", "\\|") for c in r))
    return out


def extract(path: Path, sheet: str | None = None, max_rows: int = 500, notes: bool = False) -> dict:
    if not path.is_file():
        raise DocError(f"no such file: {path}")
    ext = path.suffix.lower()
    if ext in {".xlsx", ".xlsm"}:
        sheets = xlsx(path, sheet, max_rows)
        lines = []
        for s in sheets:
            lines.append(f"## sheet {s['sheet']} ({s['total_rows']} rows{', truncated' if s['truncated'] else ''})")
            lines += _table(s["rows"], s["row_numbers"], letters=True)
        return {"kind": "xlsx", "lines": lines, "sheets": [{k: s[k] for k in ("sheet", "total_rows", "truncated")}
                                                           for s in sheets]}
    if ext == ".docx":
        return {"kind": "docx", "lines": docx(path)}
    if ext == ".pptx":
        return {"kind": "pptx", "lines": pptx(path, notes)}
    if ext in {".csv", ".tsv"}:
        rows, label, total = delimited(path, max_rows)
        return {"kind": ext[1:], "decoding": label, "total_rows": total, "truncated": total > len(rows),
                "lines": _table(rows)}
    src = textio.open_text(str(path))
    try:
        lines = [f"{n:>5}: {t}" for n, t in src]
    finally:
        src.close()
    return {"kind": "text", "decoding": src.stats.label(), "lines": lines}
