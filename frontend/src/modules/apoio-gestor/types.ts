export interface ApoioGestorActivityRow {
  activity_key: string;
  activity_label: string;
  unit_label: string;
  actual_today: number;
  target_today: number | null;
  achievement_pct: number | null;
  has_meta: boolean;
  sort_order: number;
}

export interface ApoioGestorDayFlags {
  meta_defined_count: number;
  is_holiday: boolean;
  is_sunday: boolean;
}
