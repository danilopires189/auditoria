import { createPortal } from "react-dom";
import { formatPercent, formatPoints } from "../utils";
import type { ChecklistDefinition } from "../types";

export type ConfirmationPopup = {
  checklistTitle: string;
  scoringMode: ChecklistDefinition["scoring_mode"];
  conformityPercent: number;
  nonConformities: number;
  riskScorePercent: number | null;
  riskLevel: string | null;
  scorePoints: number | null;
  scoreMaxPoints: number | null;
  criticalFail: boolean;
  evaluatedLabel: string;
};

interface ConfirmationModalProps {
  popup: ConfirmationPopup;
  onConfirm: () => void;
  onCancel: () => void;
  busySubmit: boolean;
}

export default function ConfirmationModal({ popup, onConfirm, onCancel, busySubmit }: ConfirmationModalProps) {
  const dialog = (
    <div className="checklist-completion-overlay" role="dialog" aria-modal="true" aria-labelledby="checklist-confirmation-title">
      <div className="checklist-completion-dialog checklist-confirmation-dialog">
        <span className="checklist-completion-icon" aria-hidden="true">!</span>
        <div>
          <h3 id="checklist-confirmation-title">Confirmar conclusão</h3>
          <p>{popup.checklistTitle}</p>
        </div>
        <div className="checklist-completion-metrics">
          {popup.scoringMode === "risk_weighted" ? (
            <>
              <span>Risco<strong>{formatPercent(popup.riskScorePercent ?? 0)}</strong></span>
              <span>Nível<strong>{popup.riskLevel ?? "—"}</strong></span>
            </>
          ) : popup.scoringMode === "score_points" ? (
            <>
              <span>Score<strong>{`${formatPoints(popup.scorePoints)} / ${formatPoints(popup.scoreMaxPoints)}`}</strong></span>
              <span>Nível<strong>{popup.riskLevel ?? "—"}</strong></span>
            </>
          ) : (
            <>
              <span>Conformidade<strong>{formatPercent(popup.conformityPercent)}</strong></span>
              <span>Não conformidades<strong>{popup.nonConformities}</strong></span>
            </>
          )}
        </div>
        <small>{`Escopo: ${popup.evaluatedLabel}`}</small>
        {popup.criticalFail ? (
          <small className="checklist-confirmation-warning">
            Existem itens críticos reprovados. O risco será salvo como ALTO.
          </small>
        ) : null}
        <div className="checklist-confirmation-actions">
          <button type="button" className="btn btn-muted" onClick={onCancel} disabled={busySubmit}>
            Revisar respostas
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busySubmit}>
            {busySubmit ? "Finalizando..." : "Confirmar e concluir"}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return dialog;
  return createPortal(dialog, document.body);
}
