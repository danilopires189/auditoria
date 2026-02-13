from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path


@dataclass
class RefreshResult:
    ok: bool
    elapsed_seconds: float
    error: str | None = None


def _refresh_with_win32com(file_path: Path, timeout_seconds: int, poll_seconds: int) -> None:
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    excel = None
    workbook = None
    try:
        excel = win32com.client.DispatchEx("Excel.Application")
        excel.Visible = False
        excel.DisplayAlerts = False

        workbook = excel.Workbooks.Open(str(file_path), UpdateLinks=0, ReadOnly=False)
        workbook.RefreshAll()

        deadline = time.time() + timeout_seconds
        sleep_window = max(1, poll_seconds)

        while time.time() < deadline:
            try:
                excel.CalculateUntilAsyncQueriesDone()
                break
            except Exception:
                time.sleep(sleep_window)
                sleep_window = min(sleep_window * 2, 10)
        else:
            raise TimeoutError(f"Excel refresh timeout for {file_path.name}")

        workbook.Save()
    finally:
        if workbook is not None:
            workbook.Close(SaveChanges=True)
        if excel is not None:
            excel.Quit()
        pythoncom.CoUninitialize()


def _refresh_with_xlwings(file_path: Path, timeout_seconds: int, poll_seconds: int) -> None:
    import xlwings as xw

    app = xw.App(visible=False, add_book=False)
    app.display_alerts = False
    workbook = None
    try:
        workbook = app.books.open(str(file_path))
        workbook.api.RefreshAll()

        deadline = time.time() + timeout_seconds
        sleep_window = max(1, poll_seconds)
        while time.time() < deadline:
            try:
                app.api.CalculateUntilAsyncQueriesDone()
                break
            except Exception:
                time.sleep(sleep_window)
                sleep_window = min(sleep_window * 2, 10)
        else:
            raise TimeoutError(f"Excel refresh timeout for {file_path.name}")

        workbook.save()
    finally:
        if workbook is not None:
            workbook.close()
        app.quit()


def refresh_excel_file(
    file_path: Path,
    timeout_seconds: int,
    poll_seconds: int,
) -> RefreshResult:
    started = time.perf_counter()
    try:
        try:
            _refresh_with_win32com(file_path, timeout_seconds, poll_seconds)
        except ModuleNotFoundError:
            _refresh_with_xlwings(file_path, timeout_seconds, poll_seconds)
        elapsed = time.perf_counter() - started
        return RefreshResult(ok=True, elapsed_seconds=elapsed)
    except Exception as exc:
        elapsed = time.perf_counter() - started
        return RefreshResult(ok=False, elapsed_seconds=elapsed, error=str(exc))