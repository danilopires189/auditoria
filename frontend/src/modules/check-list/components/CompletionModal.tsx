import { createPortal } from "react-dom";
import { formatPercent, formatPoints } from "../utils";
import type { ChecklistDefinition } from "../types";

export type CompletionPopup = {
  checklistTitle: string;
  conformityPercent: number;
  nonConformities: number;
  scoringMode: ChecklistDefinition["scoring_mode"];
  riskScorePercent: number | null;
  riskLevel: string | null;
  scorePoints: number | null;
  scoreMaxPoints: number | null;
  auditId: string;
};

interface CompletionModalProps {
  popup: CompletionPopup;
  onClose: () => void;
}

export default function CompletionModal({ popup, onClose }: CompletionModalProps) {
  const dialog = (
    <div className="checklist-completion-overlay" role="dialog" aria-modal="true" aria-labelledby="checklist-completion-title">
      <div className="checklist-completion-dialog">
        <span className="checklist-completion-icon" aria-hidden="true">✓</span>
        <div>
          <h3 id="checklist-completion-title">Checklist concluído!</h3>
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
        <small>{`ID da auditoria: ${popup.auditId}`}</small>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Voltar ao início
        </button>
      </div>
    </div>
  );

  if (typeof document === "undefined") return dialog;
  return createPortal(dialog, document.body);
}
