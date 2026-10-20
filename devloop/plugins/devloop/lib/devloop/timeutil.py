"""Timestamp parsing and time-zone normalization.

Global services log in a mix of UTC, KST and regional local time. Every parsed
timestamp becomes an aware datetime; the zone used for naive values is always
reported so a reader never has to guess.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone, tzinfo

_OFFSET = re.compile(r"^(?:UTC|GMT)?\s*([+-])(\d{1,2}):?(\d{2})?$", re.I)


class TimeError(ValueError):
    pass


def parse_tz(spec: str | None) -> tzinfo:
    """Accept 'Z', 'UTC', '+09:00', '+0900', 'UTC+9' or an IANA name."""
    if spec is None or spec.strip().upper() in {"", "Z", "UTC", "GMT"}:
        return timezone.utc
    s = spec.strip()
    m = _OFFSET.match(s)
    if m:
        sign = -1 if m.group(1) == "-" else 1
        delta = timedelta(hours=int(m.group(2)), minutes=int(m.group(3) or 0))
        return timezone(sign * delta, s)
    try:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    except ImportError as exc:  # pragma: no cover - stdlib since 3.9
        raise TimeError(f"time zone {s!r} needs zoneinfo") from exc
    try:
        return ZoneInfo(s)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise TimeError(
            f"unknown time zone {s!r}. Use a fixed offset like '+09:00', or install the 'tzdata' "
            "package for IANA names on Windows") from exc


def _iso(text: str) -> datetime:
    s = text.strip()
    if s.endswith(("Z", "z")):
        s = s[:-1] + "+00:00"
    s = s.replace(",", ".", 1) if re.search(r"\d,\d", s) else s
    m = re.search(r"\.(\d{7,})", s)
    if m:  # nanoseconds: datetime keeps microseconds
        s = s[:m.start(1)] + m.group(1)[:6] + s[m.end(1):]
    return datetime.fromisoformat(s)


# strptime formats that datetime.fromisoformat (C) parses identically; it is ~20x faster.
_ISO_LIKE = {"%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S",
             "%Y-%m-%d %H:%M:%S,%f", "%Y-%m-%dT%H:%M:%S,%f"}


def make_ts_parser(fmt: str, default_tz: tzinfo):
    """Return a fast callable text -> aware datetime for one profile format."""
    if fmt in _ISO_LIKE or fmt == "iso8601":
        comma = "," in fmt

        def fast(text: str) -> datetime:
            s = text.strip()
            if comma:
                s = s.replace(",", ".", 1)
            try:
                dt = datetime.fromisoformat(s)
            except ValueError:
                return parse_ts(text, "iso8601" if fmt == "iso8601" else fmt, default_tz)
            return dt if dt.tzinfo is not None else dt.replace(tzinfo=default_tz)

        return fast
    return lambda text: parse_ts(text, fmt, default_tz)


def parse_ts(text: str, fmt: str, default_tz: tzinfo) -> datetime:
    """Parse with 'iso8601', 'epoch', 'epoch_ms' or a strptime format."""
    if fmt == "iso8601":
        dt = _iso(text)
    elif fmt in {"epoch", "epoch_ms"}:
        value = float(text)
        if fmt == "epoch_ms":
            value /= 1000.0
        return datetime.fromtimestamp(value, timezone.utc)
    else:
        dt = datetime.strptime(text.strip(), fmt)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=default_tz)
    return dt


def parse_user_time(text: str, default_tz: tzinfo) -> datetime:
    """Parse a CLI bound. Relative forms: '-30m', '-2h', '-1d' (from now)."""
    s = text.strip()
    m = re.fullmatch(r"-(\d+)([smhd])", s)
    if m:
        unit = {"s": "seconds", "m": "minutes", "h": "hours", "d": "days"}[m.group(2)]
        return datetime.now(timezone.utc) - timedelta(**{unit: int(m.group(1))})
    try:
        dt = _iso(s)
    except ValueError as exc:
        raise TimeError(f"cannot parse time {text!r}; use ISO 8601 like 2026-10-20T09:00:00+09:00") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=default_tz)
    return dt


def parse_window(text: str, default_tz: tzinfo) -> tuple[datetime, datetime]:
    """'START..END' window."""
    if ".." not in text:
        raise TimeError(f"window {text!r} must look like START..END")
    a, b = text.split("..", 1)
    start, end = parse_user_time(a, default_tz), parse_user_time(b, default_tz)
    if end <= start:
        raise TimeError(f"window {text!r} ends before it starts")
    return start, end


def fmt_ts(dt: datetime | None, tz: tzinfo) -> str:
    if dt is None:
        return "-"
    local = dt.astimezone(tz)
    text = local.isoformat(timespec="milliseconds")
    return text.replace("+00:00", "Z")
