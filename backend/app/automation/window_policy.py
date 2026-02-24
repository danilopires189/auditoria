from __future__ import annotations

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.automation.models import AutomationConfig


def parse_hhmm(value: str) -> time:
    raw = value.strip()
    parts = raw.split(":")
    if len(parts) != 2:
        raise ValueError(f"Invalid HH:MM value: {value}")
    hours = int(parts[0])
    minutes = int(parts[1])
    if hours < 0 or hours > 23 or minutes < 0 or minutes > 59:
        raise ValueError(f"Invalid HH:MM value: {value}")
    return time(hour=hours, minute=minutes)


def now_in_timezone(timezone_name: str) -> datetime:
    return datetime.now(ZoneInfo(timezone_name))


def is_first_full_run_of_day(now: datetime, last_full_run_date: str | None) -> bool:
    return now.date().isoformat() != last_full_run_date


def is_sunday(now: datetime) -> bool:
    return now.weekday() == 6


def is_within_window(now: datetime, window_start: str, window_end: str) -> bool:
    start = parse_hhmm(window_start)
    end = parse_hhmm(window_end)
    now_time = now.time()
    return start <= now_time <= end


def evaluate_scheduled_window(now: datetime, config: AutomationConfig) -> tuple[bool, str | None]:
    if config.exclude_sunday and is_sunday(now):
        return False, "sunday_blocked"
    if not is_within_window(now, config.window_start, config.window_end):
        return False, "outside_window"
    return True, None


def _next_day_start(now: datetime, start_time: time, exclude_sunday: bool) -> datetime:
    candidate = (now + timedelta(days=1)).replace(
        hour=start_time.hour,
        minute=start_time.minute,
        second=0,
        microsecond=0,
    )
    while exclude_sunday and candidate.weekday() == 6:
        candidate = candidate + timedelta(days=1)
    return candidate


def next_scheduled_run_at(now: datetime, config: AutomationConfig) -> datetime:
    start = parse_hhmm(config.window_start)
    end = parse_hhmm(config.window_end)
    interval = max(1, int(config.interval_minutes))

    base = now.replace(second=0, microsecond=0)
    candidate = base + timedelta(minutes=interval)

    # Normalize immediately when today is blocked.
    if config.exclude_sunday and candidate.weekday() == 6:
        return _next_day_start(candidate, start, config.exclude_sunday)

    day_start = candidate.replace(hour=start.hour, minute=start.minute, second=0, microsecond=0)
    day_end = candidate.replace(hour=end.hour, minute=end.minute, second=0, microsecond=0)

    if candidate < day_start:
        candidate = day_start
    elif candidate > day_end:
        candidate = _next_day_start(candidate, start, config.exclude_sunday)

    if config.exclude_sunday and candidate.weekday() == 6:
        candidate = _next_day_start(candidate, start, config.exclude_sunday)
    return candidate
