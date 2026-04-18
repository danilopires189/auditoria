import type { ChecklistDefinition } from "../types";
import { conformityStatus, formatPercent, formatPoints } from "../utils";
import type { DraftResult } from "../utils";

interface ChecklistHeroProps {
  checklist: ChecklistDefinition;
  draftResult: DraftResult;
  answeredCount: number;
  currentCdLabel: string;
  monthLabel: string;
}

export default function ChecklistHero({ checklist, draftResult, answeredCount, currentCdLabel, monthLabel }: ChecklistHeroProps) {
  const total = checklist.total_items;
  const progressPct = total > 0 ? (answeredCount / total) * 100 : 0;
  const isRisk = checklist.scoring_mode !== "simple";

  const conformityValue = isRisk && checklist.scoring_mode === "risk_weighted"
    ? Math.max(0, 100 - (draftResult.riskScorePercent ?? 0))
    : draftResult.conformityPercent;

  const progressStatus = conformityStatus(conformityValue);

  const metricValue = (): string => {
    if (checklist.scoring_mode === "risk_weighted") return `${formatPercent(draftResult.riskScorePercent ?? 0)} risco`;
    if (checklist.scoring_mode === "score_points") return `${formatPoints(draftResult.scorePoints)} / ${formatPoints(draftResult.scoreMaxPoints)}`;
    return formatPercent(draftResult.conformityPercent);
  };

  return (
    <section className="checklist-hero">
      <div className="checklist-head">
        <span className="checklist-head-kicker">{checklist.title}</span>
        <h2>Checklist de auditoria</h2>
        <p>
          {checklist.requires_evaluated_user
            ? `Preencha os ${total} itens, valide o avaliado pelo DB_USUARIO e finalize com aceite eletrônico.`
            : `Preencha os ${total} itens da auditoria por CD e finalize com aceite eletrônico.`}
        </p>
        <div className="checklist-progress-wrap">
          <div className="checklist-progress-label">
            <span>Progresso</span>
            <span>{answeredCount}/{total} respondidos</span>
          </div>
          <div className="checklist-progress-track">
            <div
              className="checklist-progress-fill"
              data-status={progressPct === 100 ? progressStatus : undefined}
              style={{ "--fill": `${progressPct.toFixed(1)}%` } as React.CSSProperties}
            />
          </div>
        </div>
      </div>

      <div className="checklist-metrics-grid">
        <div className="checklist-metric">
          <span>CD</span>
          <strong>{currentCdLabel}</strong>
        </div>
        <div className="checklist-metric">
          <span>Mês</span>
          <strong>{monthLabel}</strong>
        </div>
        <div className="checklist-metric" data-status={progressStatus}>
          <span>{isRisk ? "Resultado" : "Conformidade"}</span>
          <strong>{metricValue()}</strong>
        </div>
        {isRisk ? (
          <div className="checklist-metric" data-status={progressStatus}>
            <span>Nível</span>
            <strong>{draftResult.riskLevel ?? "—"}</strong>
          </div>
        ) : null}
        <div className="checklist-metric" data-status={draftResult.nonConformities > 0 ? "bad" : undefined}>
          <span>NC</span>
          <strong>{draftResult.nonConformities}</strong>
        </div>
      </div>
    </section>
  );
}
