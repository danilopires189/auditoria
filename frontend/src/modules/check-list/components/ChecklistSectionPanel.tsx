import type { ChecklistAnswer, ChecklistDefinition, ChecklistItem } from "../types";
import ChecklistItemCard from "./ChecklistItemCard";

interface ChecklistSectionPanelProps {
  items: ChecklistItem[];
  sectionTitle: string;
  answers: Record<number, ChecklistAnswer | "">;
  onAnswer: (itemNumber: number, answer: ChecklistAnswer) => void;
  disabled: boolean;
  scoringMode: ChecklistDefinition["scoring_mode"];
}

export default function ChecklistSectionPanel({ items, sectionTitle, answers, onAnswer, disabled, scoringMode }: ChecklistSectionPanelProps) {
  const answered = items.filter((item) => answers[item.item_number]).length;
  const total = items.length;
  const isDone = answered === total && total > 0;
  const fillPct = total > 0 ? (answered / total) * 100 : 0;

  return (
    <section className="checklist-panel">
      <div className="checklist-panel-head">
        <div>
          <h3>{sectionTitle}</h3>
          <div className="checklist-section-progress">
            <div className="checklist-section-progress-bar">
              <div
                className="checklist-section-progress-fill"
                data-done={isDone ? "true" : "false"}
                style={{ "--fill": `${fillPct.toFixed(1)}%` } as React.CSSProperties}
              />
            </div>
            <span className="checklist-section-badge" data-done={isDone ? "true" : "false"}>
              {answered}/{total} itens
            </span>
          </div>
        </div>
      </div>
      <div className="checklist-item-list">
        {items.map((item) => (
          <ChecklistItemCard
            key={item.item_number}
            item={item}
            answer={answers[item.item_number] ?? ""}
            onAnswer={onAnswer}
            disabled={disabled}
            scoringMode={scoringMode}
          />
        ))}
      </div>
    </section>
  );
}
