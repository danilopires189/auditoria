from __future__ import annotations

from pathlib import Path

from app.automation.models import (
    AutomationConfig,
    AutomationCycleResult,
    TaskCommandResult,
)
from app.automation.runner import AutomationRunner
from app.automation.task_scheduler import (
    install_or_update_task,
    query_task_status,
    remove_task,
    run_task_now,
)


class GuiAutomationActions:
    def __init__(self, runner: AutomationRunner):
        self.runner = runner

    def load_state(self) -> tuple[Path, AutomationConfig]:
        return self.runner.load_automation_state()

    def save_state(self, state: AutomationConfig) -> Path:
        return self.runner.save_automation_state(state)

    def run_cycle(
        self,
        *,
        scheduled: bool,
        dry_run: bool,
        requested_tables: list[str] | None = None,
        reprocess_failures: bool = False,
        triggered_by: str | None = None,
    ) -> AutomationCycleResult:
        return self.runner.run_cycle(
            scheduled=scheduled,
            dry_run=dry_run,
            requested_tables=requested_tables,
            reprocess_failures=reprocess_failures,
            triggered_by=triggered_by,
        )

    def install_task(self, config: AutomationConfig) -> TaskCommandResult:
        return install_or_update_task(
            config=config,
            config_path=self.runner.config_path,
            env_file=self.runner.env_file,
            automation_config_path=self.runner.automation_config_path,
        )

    def remove_task(self, task_name: str) -> TaskCommandResult:
        return remove_task(task_name)

    def query_task(self, task_name: str) -> TaskCommandResult:
        return query_task_status(task_name)

    def run_task(self, task_name: str) -> TaskCommandResult:
        return run_task_now(task_name)
