from __future__ import annotations

from dataclasses import dataclass

from app.automation.models import AutomationCycleResult


@dataclass(frozen=True)
class HealthIndicator:
    label: str
    color: str
    reason: str


def derive_health(
    last_cycle: AutomationCycleResult | None,
    failed_queue: list[str],
) -> HealthIndicator:
    if last_cycle is None:
        return HealthIndicator(
            label="Sem histórico",
            color="#d4a72c",
            reason="Nenhuma execução registrada nesta sessão",
        )

    if failed_queue:
        return HealthIndicator(
            label="Com pendências",
            color="#d4a72c",
            reason=f"{len(failed_queue)} tabela(s) na fila de reprocessamento",
        )

    if last_cycle.sync_status in {"failed"}:
        return HealthIndicator(
            label="Falha",
            color="#d83a52",
            reason=last_cycle.sync_message or "Último ciclo terminou com erro",
        )

    if last_cycle.sync_status in {"partial"}:
        return HealthIndicator(
            label="Parcial",
            color="#d4a72c",
            reason=last_cycle.sync_message or "Último ciclo terminou parcialmente",
        )

    return HealthIndicator(
        label="Saudável",
        color="#2f8f46",
        reason=last_cycle.sync_message or "Último ciclo concluído sem pendências",
    )
