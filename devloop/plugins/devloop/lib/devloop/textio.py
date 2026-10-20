"""Byte-faithful text decoding for logs and tool output.

Korean Windows estates mix UTF-8, CP949 and UTF-16 (bcp/sqlcmd exports), and a
single file can mix UTF-8 and CP949 lines. Decoding is decided per line in byte
mode, and every fallback or replacement is counted so callers can report
decoding coverage instead of silently mangling text.
"""

from __future__ import annotations

import codecs
import gzip
import io
import sys
from dataclasses import dataclass
from typing import BinaryIO, Iterator

_BOMS = (
    (codecs.BOM_UTF32_LE, "utf-32-le"),
    (codecs.BOM_UTF32_BE, "utf-32-be"),
    (codecs.BOM_UTF8, "utf-8"),
    (codecs.BOM_UTF16_LE, "utf-16-le"),
    (codecs.BOM_UTF16_BE, "utf-16-be"),
)


@dataclass
class DecodeStats:
    source: str
    encoding: str = "utf-8"
    basis: str = "default"  # bom | nul-pattern | sample | configured | default
    fallback: str | None = None
    lines: int = 0
    fallback_lines: int = 0
    replaced_lines: int = 0
    compressed: bool = False

    def label(self) -> str:
        parts = [self.encoding]
        if self.fallback_lines:
            parts.append(f"{self.fallback} x{self.fallback_lines}")
        if self.replaced_lines:
            parts.append(f"replaced x{self.replaced_lines}")
        if self.compressed:
            parts.append("gzip")
        return " + ".join(parts)

    def to_dict(self) -> dict:
        return dict(self.__dict__)


class _Prefixed(io.RawIOBase):
    """A binary stream that replays already-peeked bytes before the rest."""

    def __init__(self, head: bytes, rest: BinaryIO | None):
        self._head = head
        self._rest = rest

    def readable(self) -> bool:
        return True

    def readinto(self, b) -> int:
        if self._head:
            k = min(len(b), len(self._head))
            b[:k] = self._head[:k]
            self._head = self._head[k:]
            return k
        if self._rest is None:
            return 0
        data = self._rest.read(len(b))
        b[:len(data)] = data
        return len(data)


def choose_encoding(head: bytes, encoding: str = "auto", fallback: str | None = "cp949") -> tuple[str, str, str | None]:
    """Return (encoding, basis, fallback) for a byte prefix."""
    if encoding != "auto":
        codecs.lookup(encoding)
        return encoding, "configured", None
    for bom, enc in _BOMS:
        if head.startswith(bom):
            return enc, "bom", None
    sample = head[:4096]
    if len(sample) >= 16:
        half = len(sample) / 2
        even_nul = sample[0::2].count(0) / half
        odd_nul = sample[1::2].count(0) / half
        if odd_nul > 0.3 and even_nul < 0.05:
            return "utf-16-le", "nul-pattern", None
        if even_nul > 0.3 and odd_nul < 0.05:
            return "utf-16-be", "nul-pattern", None
    if sample.startswith(b"SQLite format 3\x00") or sample.count(0) > max(1, len(sample) // 100):
        return "binary", "nul-bytes", None
    try:
        sample.decode("utf-8")
    except UnicodeDecodeError as exc:
        # A multi-byte character cut by the sample boundary is not evidence.
        if exc.start < len(sample) - 4 and fallback:
            try:
                sample[:exc.start + 64].decode(fallback)
                return fallback, "sample", "utf-8"
            except UnicodeDecodeError:
                pass
    return "utf-8", "default", fallback


class TextSource:
    """Iterates (line_number, text); ``stats`` fills in as lines are read."""

    def __init__(self, name: str, stream: BinaryIO | None, stats: DecodeStats, head: bytes, owned: bool,
                 also_close: tuple = ()):
        self.name = name
        self.stats = stats
        self._stream = stream
        self._head = head
        self._owned = owned
        self._also_close = also_close  # e.g. the file under a GzipFile, which GzipFile does not close

    def __iter__(self) -> Iterator[tuple[int, str]]:
        st = self.stats
        if st.encoding == "binary":
            return
        buffered = io.BufferedReader(_Prefixed(self._head, self._stream), buffer_size=1 << 16)
        if st.encoding.startswith(("utf-16", "utf-32")):
            wrapper = io.TextIOWrapper(buffered, encoding=st.encoding, errors="replace", newline=None)
            n = 0
            for n, line in enumerate(wrapper, 1):
                line = line.rstrip("\n")
                if n == 1 and line.startswith("﻿"):
                    line = line[1:]
                if "�" in line:
                    st.replaced_lines += 1
                yield n, line
            st.lines = n
            return
        n = 0
        for raw in buffered:
            n += 1
            if n == 1 and raw.startswith(codecs.BOM_UTF8):
                raw = raw[3:]
            yield n, self._decode(raw.rstrip(b"\r\n"))
        st.lines = n

    def _decode(self, raw: bytes) -> str:
        st = self.stats
        try:
            return raw.decode(st.encoding)
        except UnicodeDecodeError:
            pass
        if st.fallback:
            try:
                text = raw.decode(st.fallback)
                st.fallback_lines += 1
                return text
            except UnicodeDecodeError:
                pass
        st.replaced_lines += 1
        return raw.decode(st.encoding, errors="replace")

    def close(self) -> None:
        if not self._owned:
            return
        for res in (self._stream, *self._also_close):
            if res is not None:
                res.close()


def open_text(path: str, encoding: str = "auto", fallback: str | None = "cp949") -> TextSource:
    """Open a file (``-`` for stdin; gzip detected by magic bytes) for line decoding."""
    if path == "-":
        stream: BinaryIO = sys.stdin.buffer
        owned = False
    else:
        stream = open(path, "rb")
        owned = True
    head = stream.read(4096)
    compressed = head[:2] == b"\x1f\x8b"
    underlying: tuple = ()
    if compressed:
        underlying = (stream,)
        stream = gzip.GzipFile(fileobj=io.BufferedReader(_Prefixed(head, stream)))  # type: ignore[assignment]
        head = stream.read(4096)
    enc, basis, fb = choose_encoding(head, encoding, fallback)
    stats = DecodeStats(source=path, encoding=enc, basis=basis, fallback=fb, compressed=compressed)
    return TextSource(path, stream, stats, head, owned, underlying)


def decode_output(data: bytes, encoding: str = "auto", fallback: str | None = "cp949") -> tuple[str, DecodeStats]:
    """Decode captured command output with the same per-line policy."""
    enc, basis, fb = choose_encoding(data[:4096], encoding, fallback)
    src = TextSource("<output>", None, DecodeStats(source="<output>", encoding=enc, basis=basis, fallback=fb),
                     data, owned=False)
    text = "\n".join(line for _, line in src)
    return text, src.stats
