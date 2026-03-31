export interface MetaMesModuleProfile {
  user_id: string;
  nome: string;
  mat: string;
  role: "admin" | "auditor" | "viewer";
  cd_default: number | null;
  cd_nome: string | null;
}

export type MetaMesValueMode = "integer" | "currency" | "decimal";
export type MetaMesTargetKind = "meta" | "sem_meta" | "feriado" | "domingo";
export type MetaMesDailyStatus = "acima" | "atingiu" | "abaixo" | "feriado" | "domingo" | "sem_meta";

export interface MetaMesActivityOption {
  sort_order: number;
  activity_key: string;
  activity_label: string;
  unit_label: string;
  value_mode: MetaMesValueMode;
}

export interface MetaMesMonthOption {
  month_start: string;
  month_label: string;
}

export interface MetaMesSummary {
  activity_key: string;
  activity_label: string;
  unit_label: string;
  value_mode: MetaMesValueMode;
  month_start: string;
  month_end: string;
  updated_at: string | null;
  total_actual: number;
  total_target: number;
  achievement_percent: number | null;
  daily_average: number;
  monthly_projection: number;
  days_with_target: number;
  days_hit: number;
  days_over: number;
  days_holiday: number;
  days_without_target: number;
  balance_to_target: number;
}

export interface MetaMesDailyRow {
  date_ref: string;
  day_number: number;
  weekday_label: string;
  target_kind: MetaMesTargetKind;
  target_value: number | null;
  actual_value: number;
  percent_achievement: number | null;
  delta_value: number | null;
  cumulative_target: number;
  cumulative_actual: number;
  cumulative_percent: number | null;
  status: MetaMesDailyStatus;
  is_holiday: boolean;
  is_sunday: boolean;
  updated_at: string | null;
}
