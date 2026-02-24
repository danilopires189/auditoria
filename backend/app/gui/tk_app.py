from __future__ import annotations

import queue
import threading
import tkinter as tk
from tkinter import messagebox, ttk

from app.automation.models import (
    AutomationConfig,
    AutomationCycleResult,
)
from app.automation.runner import AutomationRunner
from app.automation.table_profile import profile_table_names
from app.automation.window_policy import next_scheduled_run_at, now_in_timezone
from app.gui.actions import GuiAutomationActions
from app.gui.viewmodels import derive_health


def _format_dt(value) -> str:
    if value is None:
        return "-"
    return value.strftime("%d/%m/%Y %H:%M:%S")


class TkAutomationApp:
    def __init__(
        self,
        root: tk.Tk,
        config_path: str,
        env_file: str,
        automation_config_path: str | None = None,
    ):
        self.root = root
        self.runner = AutomationRunner(
            config_path=config_path,
            env_file=env_file,
            automation_config_path=automation_config_path,
        )
        self.actions = GuiAutomationActions(self.runner)
        self.worker_queue: queue.Queue[tuple[object, object, object]] = queue.Queue()
        self.worker_busy = False
        self.last_cycle: AutomationCycleResult | None = None
        self.automation_config_path = None
        self.automation_config = AutomationConfig()
        self.next_internal_due = None

        self.root.title("Auditoria - Automacao SQL + Supabase")
        self.root.geometry("1180x760")
        self.root.minsize(1024, 700)

        self.enabled_var = tk.BooleanVar(value=False)
        self.interval_var = tk.StringVar(value="30")
        self.window_start_var = tk.StringVar(value="06:00")
        self.window_end_var = tk.StringVar(value="19:00")
        self.status_var = tk.StringVar(value="Pronto")
        self.last_run_var = tk.StringVar(value="-")
        self.next_run_var = tk.StringVar(value="-")
        self.health_var = tk.StringVar(value="Sem histórico")
        self.task_status_var = tk.StringVar(value="-")

        self._build_layout()
        self._load_initial_state()
        self._refresh_health()
        self.root.after(250, self._poll_worker_queue)
        self.root.after(15000, self._internal_scheduler_tick)

    def _build_layout(self) -> None:
        container = ttk.Frame(self.root, padding=12)
        container.pack(fill="both", expand=True)

        status_frame = ttk.LabelFrame(container, text="Painel de Status", padding=10)
        status_frame.pack(fill="x")

        ttk.Label(status_frame, text="Última execução:").grid(row=0, column=0, sticky="w")
        ttk.Label(status_frame, textvariable=self.last_run_var).grid(row=0, column=1, sticky="w", padx=(8, 20))
        ttk.Label(status_frame, text="Próxima execução:").grid(row=0, column=2, sticky="w")
        ttk.Label(status_frame, textvariable=self.next_run_var).grid(row=0, column=3, sticky="w", padx=(8, 20))
        ttk.Label(status_frame, text="Task Scheduler:").grid(row=0, column=4, sticky="w")
        ttk.Label(status_frame, textvariable=self.task_status_var).grid(row=0, column=5, sticky="w")

        ttk.Label(status_frame, text="Health check:").grid(row=1, column=0, sticky="w", pady=(10, 0))
        self.health_canvas = tk.Canvas(status_frame, width=18, height=18, highlightthickness=0)
        self.health_canvas.grid(row=1, column=1, sticky="w", pady=(10, 0))
        self.health_bullet = self.health_canvas.create_oval(1, 1, 17, 17, fill="#d4a72c", outline="#777777")
        ttk.Label(status_frame, textvariable=self.health_var).grid(row=1, column=2, columnspan=4, sticky="w", pady=(10, 0))

        config_frame = ttk.LabelFrame(container, text="Configurações", padding=10)
        config_frame.pack(fill="x", pady=(10, 0))

        ttk.Checkbutton(
            config_frame,
            text="Automação ativa",
            variable=self.enabled_var,
        ).grid(row=0, column=0, sticky="w")
        ttk.Label(config_frame, text="Intervalo (min):").grid(row=0, column=1, sticky="w", padx=(20, 6))
        ttk.Entry(config_frame, textvariable=self.interval_var, width=8).grid(row=0, column=2, sticky="w")
        ttk.Label(config_frame, text="Janela:").grid(row=0, column=3, sticky="w", padx=(20, 6))
        ttk.Entry(config_frame, textvariable=self.window_start_var, width=8).grid(row=0, column=4, sticky="w")
        ttk.Label(config_frame, text="até").grid(row=0, column=5, sticky="w", padx=4)
        ttk.Entry(config_frame, textvariable=self.window_end_var, width=8).grid(row=0, column=6, sticky="w")

        buttons_frame = ttk.Frame(container, padding=(0, 10, 0, 10))
        buttons_frame.pack(fill="x")
        ttk.Button(buttons_frame, text="Ativar automação", command=self.on_activate).pack(side="left")
        ttk.Button(buttons_frame, text="Desativar automação", command=self.on_deactivate).pack(side="left", padx=(8, 0))
        ttk.Button(buttons_frame, text="Status tarefa", command=self.on_query_task).pack(side="left", padx=(8, 0))
        ttk.Button(buttons_frame, text="Rodar tarefa agora", command=self.on_run_task_now).pack(side="left", padx=(8, 0))

        action_frame = ttk.LabelFrame(container, text="Ações Manuais", padding=10)
        action_frame.pack(fill="x")

        self.table_list = tk.Listbox(action_frame, selectmode=tk.EXTENDED, height=6, exportselection=False)
        for table_name in profile_table_names():
            self.table_list.insert(tk.END, table_name)
        self.table_list.grid(row=0, column=0, rowspan=4, sticky="nsew", padx=(0, 12))
        action_frame.columnconfigure(0, weight=1)

        ttk.Button(action_frame, text="Executar todos", command=self.on_run_all).grid(row=0, column=1, sticky="ew")
        ttk.Button(action_frame, text="Executar selecionados", command=self.on_run_selected).grid(row=1, column=1, sticky="ew", pady=(6, 0))
        ttk.Button(action_frame, text="Reprocessar falhas", command=self.on_reprocess_failures).grid(row=2, column=1, sticky="ew", pady=(6, 0))
        ttk.Button(action_frame, text="Dry-run", command=self.on_dry_run).grid(row=3, column=1, sticky="ew", pady=(6, 0))

        table_frame = ttk.LabelFrame(container, text="Arquivos Processados", padding=10)
        table_frame.pack(fill="both", expand=True, pady=(10, 0))

        self.table_tree = ttk.Treeview(
            table_frame,
            columns=("query_status", "sync_status", "error"),
            show="headings",
            height=14,
        )
        self.table_tree.heading("query_status", text="Query SQL")
        self.table_tree.heading("sync_status", text="Update Supabase")
        self.table_tree.heading("error", text="Erro")
        self.table_tree.column("query_status", width=120, anchor="center")
        self.table_tree.column("sync_status", width=140, anchor="center")
        self.table_tree.column("error", width=700, anchor="w")
        self.table_tree.pack(fill="both", expand=True)

        for table_name in profile_table_names():
            self.table_tree.insert("", tk.END, iid=table_name, values=("-", "-", ""))

        status_bar = ttk.Label(container, textvariable=self.status_var, relief=tk.SUNKEN, anchor="w")
        status_bar.pack(fill="x", pady=(10, 0))

    def _load_initial_state(self) -> None:
        self.automation_config_path, self.automation_config = self.actions.load_state()
        self.enabled_var.set(self.automation_config.automation_enabled)
        self.interval_var.set(str(self.automation_config.interval_minutes))
        self.window_start_var.set(self.automation_config.window_start)
        self.window_end_var.set(self.automation_config.window_end)

        now = now_in_timezone(self.automation_config.timezone)
        self.next_internal_due = next_scheduled_run_at(now, self.automation_config)
        self.next_run_var.set(_format_dt(self.next_internal_due))

        try:
            last_run = self.runner.fetch_last_run_summary()
        except Exception:
            last_run = None

        if last_run:
            self.last_run_var.set(
                f"{last_run.get('started_at', '-')}"
                f" | status={last_run.get('status', '-')}"
            )
        else:
            self.last_run_var.set("-")

    def _current_selected_tables(self) -> list[str]:
        selection = self.table_list.curselection()
        return [self.table_list.get(index) for index in selection]

    def _refresh_health(self) -> None:
        health = derive_health(self.last_cycle, self.automation_config.failed_tables_queue)
        self.health_var.set(f"{health.label} - {health.reason}")
        self.health_canvas.itemconfig(self.health_bullet, fill=health.color)

    def _build_config_from_inputs(self, *, automation_enabled: bool | None = None) -> AutomationConfig:
        interval = int(self.interval_var.get().strip())
        if interval <= 0:
            raise ValueError("Intervalo deve ser maior que zero")

        next_state = AutomationConfig.from_dict(self.automation_config.to_dict())
        next_state.interval_minutes = interval
        next_state.window_start = self.window_start_var.get().strip()
        next_state.window_end = self.window_end_var.get().strip()
        next_state.automation_enabled = self.enabled_var.get() if automation_enabled is None else automation_enabled
        return next_state

    def _persist_config(self, *, automation_enabled: bool | None = None) -> AutomationConfig:
        next_state = self._build_config_from_inputs(automation_enabled=automation_enabled)
        self.actions.save_state(next_state)
        self.automation_config = next_state
        now = now_in_timezone(self.automation_config.timezone)
        self.next_internal_due = next_scheduled_run_at(now, self.automation_config)
        self.next_run_var.set(_format_dt(self.next_internal_due))
        return next_state

    def _safe_persist_config(self, *, automation_enabled: bool | None = None) -> AutomationConfig | None:
        try:
            return self._persist_config(automation_enabled=automation_enabled)
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Configuração inválida", str(exc))
            return None

    def _start_background(self, label: str, operation, on_done) -> None:
        if self.worker_busy:
            messagebox.showwarning("Execução em andamento", "Já existe uma operação em andamento.")
            return

        self.worker_busy = True
        self.status_var.set(f"{label}...")

        def worker() -> None:
            try:
                payload = operation()
                self.worker_queue.put((on_done, payload, None))
            except Exception as exc:  # noqa: BLE001
                self.worker_queue.put((on_done, None, exc))

        threading.Thread(target=worker, daemon=True).start()

    def _poll_worker_queue(self) -> None:
        try:
            while True:
                callback, payload, error = self.worker_queue.get_nowait()
                callback(payload, error)
        except queue.Empty:
            pass
        finally:
            self.root.after(250, self._poll_worker_queue)

    def _on_cycle_complete(self, payload, error) -> None:
        self.worker_busy = False
        if error is not None:
            self.status_var.set(f"Erro: {error}")
            messagebox.showerror("Erro", str(error))
            return

        cycle: AutomationCycleResult = payload
        self.last_cycle = cycle
        self.last_run_var.set(
            f"{_format_dt(cycle.started_at)} | status={cycle.sync_status}"
            f"{' (skipped)' if cycle.skipped else ''}"
        )
        if cycle.next_run_at is not None:
            self.next_run_var.set(_format_dt(cycle.next_run_at))
            self.next_internal_due = cycle.next_run_at

        for table_name, table_result in cycle.table_results.items():
            self.table_tree.item(
                table_name,
                values=(
                    table_result.query_status,
                    table_result.sync_status,
                    table_result.error or "",
                ),
            )

        _, self.automation_config = self.actions.load_state()
        self.enabled_var.set(self.automation_config.automation_enabled)
        self._refresh_health()
        self.status_var.set(
            f"Ciclo concluído: status={cycle.sync_status}"
            f"{f' run_id={cycle.run_id}' if cycle.run_id else ''}"
        )

    def _on_task_action_complete(self, payload, error) -> None:
        self.worker_busy = False
        if error is not None:
            self.status_var.set(f"Erro: {error}")
            messagebox.showerror("Task Scheduler", str(error))
            return
        self.status_var.set(payload)
        self.task_status_var.set(payload)

    def on_activate(self) -> None:
        cfg = self._safe_persist_config(automation_enabled=True)
        if cfg is None:
            return

        def operation():
            task_result = self.actions.install_task(cfg)
            cycle_result = self.actions.run_cycle(
                scheduled=False,
                dry_run=False,
                requested_tables=profile_table_names(),
                triggered_by="gui_activate",
            )
            if not task_result.ok:
                cycle_result.sync_message = (
                    f"{cycle_result.sync_message} | task_error={task_result.message}"
                )
            return cycle_result

        self._start_background("Ativando automação", operation, self._on_cycle_complete)

    def on_deactivate(self) -> None:
        cfg = self._safe_persist_config(automation_enabled=False)
        if cfg is None:
            return

        def operation():
            task_result = self.actions.remove_task(cfg.task_name)
            task_status = (
                f"Automação desativada. {task_result.message}"
                if task_result.ok
                else f"Automação desativada localmente. Falha ao remover tarefa: {task_result.message}"
            )
            return task_status

        self._start_background("Desativando automação", operation, self._on_task_action_complete)

    def on_query_task(self) -> None:
        try:
            cfg = self._build_config_from_inputs()
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Configuração inválida", str(exc))
            return

        def operation():
            result = self.actions.query_task(cfg.task_name)
            return result.message

        self._start_background("Consultando tarefa", operation, self._on_task_action_complete)

    def on_run_task_now(self) -> None:
        try:
            cfg = self._build_config_from_inputs()
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Configuração inválida", str(exc))
            return

        def operation():
            result = self.actions.run_task(cfg.task_name)
            return result.message

        self._start_background("Executando tarefa", operation, self._on_task_action_complete)

    def on_run_all(self) -> None:
        if self._safe_persist_config() is None:
            return

        def operation():
            return self.actions.run_cycle(
                scheduled=False,
                dry_run=False,
                requested_tables=profile_table_names(),
                triggered_by="gui_manual_all",
            )

        self._start_background("Executando ciclo manual", operation, self._on_cycle_complete)

    def on_run_selected(self) -> None:
        selected = self._current_selected_tables()
        if not selected:
            messagebox.showwarning("Seleção", "Selecione ao menos uma tabela para execução manual.")
            return

        if self._safe_persist_config() is None:
            return

        def operation():
            return self.actions.run_cycle(
                scheduled=False,
                dry_run=False,
                requested_tables=selected,
                triggered_by="gui_manual_selected",
            )

        self._start_background("Executando tabelas selecionadas", operation, self._on_cycle_complete)

    def on_reprocess_failures(self) -> None:
        if self._safe_persist_config() is None:
            return

        def operation():
            return self.actions.run_cycle(
                scheduled=False,
                dry_run=False,
                reprocess_failures=True,
                requested_tables=profile_table_names(),
                triggered_by="gui_reprocess_failures",
            )

        self._start_background("Reprocessando falhas", operation, self._on_cycle_complete)

    def on_dry_run(self) -> None:
        if self._safe_persist_config() is None:
            return

        def operation():
            return self.actions.run_cycle(
                scheduled=False,
                dry_run=True,
                requested_tables=profile_table_names(),
                triggered_by="gui_dry_run",
            )

        self._start_background("Executando dry-run", operation, self._on_cycle_complete)

    def _internal_scheduler_tick(self) -> None:
        try:
            if not self.worker_busy and self.enabled_var.get():
                now = now_in_timezone(self.automation_config.timezone)
                if self.next_internal_due is None:
                    self.next_internal_due = next_scheduled_run_at(now, self.automation_config)
                    self.next_run_var.set(_format_dt(self.next_internal_due))
                if self.next_internal_due and now >= self.next_internal_due:
                    def operation():
                        return self.actions.run_cycle(
                            scheduled=True,
                            dry_run=False,
                            requested_tables=profile_table_names(),
                            triggered_by="gui_internal_scheduler",
                        )

                    self._start_background("Ciclo automático (interno)", operation, self._on_cycle_complete)
        finally:
            self.root.after(15000, self._internal_scheduler_tick)


def launch_gui(
    config: str = "config.yml",
    env_file: str = ".env",
    automation_config_path: str | None = None,
) -> None:
    root = tk.Tk()
    TkAutomationApp(
        root=root,
        config_path=config,
        env_file=env_file,
        automation_config_path=automation_config_path,
    )
    root.mainloop()
