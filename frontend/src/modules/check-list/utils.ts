import type { ChecklistDefinition } from "./types";

export type DraftResult = {
  conformityPercent: number;
  nonConformities: number;
  riskScorePercent: number | null;
  riskLevel: string | null;
  scorePoints: number | null;
  scoreMaxPoints: number | null;
  criticalFail: boolean;
};

export function formatPercent(value: number): string {
  return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}%`;
}

export function formatPoints(value: number | null): string {
  if (value == null) return "-";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
}

export function formatMonthYearPtBR(value: string): string {
  const matched = /^(\d{4})-(\d{2})$/.exec(value);
  return matched ? `${matched[2]}/${matched[1]}` : value;
}

export function conformityStatus(percent: number): "good" | "warn" | "bad" {
  if (percent >= 80) return "good";
  if (percent >= 60) return "warn";
  return "bad";
}

export function riskLabel(value: number): string {
  if (value < 60) return "Alto";
  if (value >= 60 && value <= 75) return "Médio";
  if (value > 85) return "Baixo";
  return "Acompanhamento";
}

function weightedRiskLevel(riskScore: number): string {
  if (riskScore <= 20) return "CONTROLADO";
  if (riskScore <= 40) return "ATENÇÃO";
  if (riskScore <= 60) return "ALTO";
  return "CRÍTICO";
}

function scoreRiskLevel(score: number, criticalFail: boolean): string {
  if (criticalFail) return "ALTO";
  if (score >= 90) return "BAIXO";
  if (score >= 70) return "MÉDIO";
  return "ALTO";
}

export function calculateDraftResult(
  definition: ChecklistDefinition | null,
  answers: Record<number, string>
): DraftResult {
  if (!definition) {
    return { conformityPercent: 100, nonConformities: 0, riskScorePercent: null, riskLevel: null, scorePoints: null, scoreMaxPoints: null, criticalFail: false };
  }

  const nonConformities = definition.items.filter((item) => answers[item.item_number] === "Não").length;

  if (definition.scoring_mode === "risk_weighted") {
    const applicable = definition.items.filter((item) => answers[item.item_number] !== "N.A.");
    const maxRisk = applicable.reduce((total, item) => total + (item.item_weight ?? 0), 0);
    const riskPoints = applicable.reduce((total, item) => total + (answers[item.item_number] === "Não" ? item.item_weight ?? 0 : 0), 0);
    const riskScorePercent = maxRisk > 0 ? (riskPoints / maxRisk) * 100 : 0;
    return { conformityPercent: Math.max(0, 100 - riskScorePercent), nonConformities, riskScorePercent, riskLevel: weightedRiskLevel(riskScorePercent), scorePoints: null, scoreMaxPoints: null, criticalFail: false };
  }

  if (definition.scoring_mode === "score_points") {
    const applicable = definition.items.filter((item) => answers[item.item_number] !== "N.A.");
    const scoreMaxPoints = applicable.reduce((total, item) => total + (item.max_points ?? 0), 0);
    const scorePoints = applicable.reduce((total, item) => total + (answers[item.item_number] === "Sim" ? item.max_points ?? 0 : 0), 0);
    const conformityPercent = scoreMaxPoints > 0 ? (scorePoints / scoreMaxPoints) * 100 : 100;
    const criticalFail = applicable.some((item) => item.is_critical && answers[item.item_number] === "Não");
    return { conformityPercent, nonConformities, riskScorePercent: Math.max(0, 100 - conformityPercent), riskLevel: scoreRiskLevel(conformityPercent, criticalFail), scorePoints, scoreMaxPoints, criticalFail };
  }

  const conformityPercent = definition.total_items > 0 ? (1 - (nonConformities / definition.total_items)) * 100 : 100;
  return { conformityPercent, nonConformities, riskScorePercent: null, riskLevel: riskLabel(conformityPercent).toUpperCase(), scorePoints: null, scoreMaxPoints: null, criticalFail: false };
}
