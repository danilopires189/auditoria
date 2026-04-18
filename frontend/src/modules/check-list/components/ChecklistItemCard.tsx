import type { ChecklistAnswer, ChecklistDefinition, ChecklistItem } from "../types";
import { formatPoints } from "../utils";

interface ChecklistItemCardProps {
  item: ChecklistItem;
  answer: ChecklistAnswer | "";
  onAnswer: (itemNumber: number, answer: ChecklistAnswer) => void;
  disabled: boolean;
  scoringMode: ChecklistDefinition["scoring_mode"];
}

const ANSWER_OPTIONS: ChecklistAnswer[] = ["Sim", "Não", "N.A."];
const ANSWER_ICONS: Record<ChecklistAnswer, string> = { Sim: "✓", "Não": "✗", "N.A.": "—" };

export default function ChecklistItemCard({ item, answer, onAnswer, disabled, scoringMode }: ChecklistItemCardProps) {
  const isRisk = scoringMode !== "simple";
  const isNok = answer === "Não";

  return (
    <article className={`checklist-item-card${isNok ? " is-nok" : ""}`}>
      <div className="checklist-item-question">
        <span className="checklist-item-num">{String(item.item_number).padStart(2, "0")}</span>
        <div>
          <strong>{item.question}</strong>
          {isRisk ? (
            <small className="checklist-item-meta">
              {scoringMode === "risk_weighted"
                ? `Peso ${formatPoints(item.item_weight ?? 0)}`
                : `${item.criticality ?? "Controle"} | ${formatPoints(item.max_points ?? 0)} pts${item.is_critical ? " | crítico" : ""}`}
            </small>
          ) : null}
        </div>
      </div>
      <div className="checklist-answer-group" role="group" aria-label={`Resposta do item ${item.item_number}`}>
        {ANSWER_OPTIONS.map((option) => (
          <button
            key={`${item.item_number}:${option}`}
            type="button"
            className={`checklist-answer-btn${answer === option ? " is-active" : ""}${option === "Não" ? " is-nok-option" : ""}`}
            onClick={() => onAnswer(item.item_number, option)}
            disabled={disabled}
            aria-pressed={answer === option}
          >
            <span className="checklist-answer-icon">{ANSWER_ICONS[option]}</span>
            {option}
          </button>
        ))}
      </div>
    </article>
  );
}
