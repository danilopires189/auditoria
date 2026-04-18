import type { ChecklistDefinition, ChecklistKey } from "../types";

interface ChecklistSelectorProps {
  definitions: ChecklistDefinition[];
  onSelect: (key: ChecklistKey) => void;
  isOnline: boolean;
  currentCdLabel: string;
  monthLabel: string;
}

function scoringModeLabel(mode: ChecklistDefinition["scoring_mode"]): string {
  if (mode === "risk_weighted") return "Risco ponderado";
  if (mode === "score_points") return "Pontuação";
  return "Conformidade";
}

export default function ChecklistSelector({ definitions, onSelect, isOnline, currentCdLabel, monthLabel }: ChecklistSelectorProps) {
  return (
    <>
      <section className="checklist-hero">
        <div className="checklist-head">
          <span className="checklist-head-kicker">Check List</span>
          <h2>Escolha a auditoria</h2>
          <p>Selecione o checklist que será aplicado e preencha a auditoria com aceite eletrônico ao final.</p>
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
        </div>
      </section>

      <section className="checklist-selection-grid" aria-label="Checklists disponíveis">
        {definitions.map((definition) => (
          <button
            key={definition.checklist_key}
            type="button"
            className="checklist-choice-card"
            onClick={() => onSelect(definition.checklist_key)}
            disabled={!isOnline}
          >
            <span className="checklist-choice-kicker">Versão {definition.version}</span>
            <strong>{definition.title}</strong>
            <span>{definition.description}</span>
            <span className="checklist-choice-type-badge">{scoringModeLabel(definition.scoring_mode)}</span>
            <span className="checklist-choice-meta">{definition.total_items} itens</span>
          </button>
        ))}
      </section>
    </>
  );
}
