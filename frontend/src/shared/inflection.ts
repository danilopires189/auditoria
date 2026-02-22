const SINGULAR_EPSILON = 0.0005;

type UnitForms = {
  singular: string;
  plural: string;
};

const IRREGULAR_UNIT_FORMS: Record<string, UnitForms> = {
  ponto: { singular: "ponto", plural: "pontos" },
  pontos: { singular: "ponto", plural: "pontos" },
  unidade: { singular: "unidade", plural: "unidades" },
  unidades: { singular: "unidade", plural: "unidades" },
  endereco: { singular: "endereço", plural: "endereços" },
  enderecos: { singular: "endereço", plural: "endereços" },
  "endereço": { singular: "endereço", plural: "endereços" },
  "endereços": { singular: "endereço", plural: "endereços" },
  loja: { singular: "loja", plural: "lojas" },
  lojas: { singular: "loja", plural: "lojas" },
  sku: { singular: "sku", plural: "skus" },
  skus: { singular: "sku", plural: "skus" },
  nfd: { singular: "nfd", plural: "nfds" },
  nfds: { singular: "nfd", plural: "nfds" },
  volume: { singular: "volume", plural: "volumes" },
  volumes: { singular: "volume", plural: "volumes" }
};

export function isSingularValue(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  return Math.abs(value - 1) < SINGULAR_EPSILON;
}

export function chooseByCount(value: number, singular: string, plural: string): string {
  return isSingularValue(value) ? singular : plural;
}

export function formatCountLabel(
  value: number,
  singular: string,
  plural: string,
  options?: {
    formatValue?: (value: number) => string;
  }
): string {
  const formattedValue = options?.formatValue ? options.formatValue(value) : `${value}`;
  return `${formattedValue} ${chooseByCount(value, singular, plural)}`;
}

export function inflectUnitLabel(unitLabel: string, value: number): string {
  const raw = unitLabel.trim();
  if (!raw) return "";

  const key = raw.toLocaleLowerCase("pt-BR");
  const irregular = IRREGULAR_UNIT_FORMS[key];
  if (irregular) {
    return chooseByCount(value, irregular.singular, irregular.plural);
  }

  if (isSingularValue(value)) {
    return key.endsWith("s") ? key.slice(0, -1) : key;
  }
  return key.endsWith("s") ? key : `${key}s`;
}

export function formatMetricWithUnit(
  value: number,
  unitLabel: string,
  formatMetric: (value: number, unitLabel: string) => string
): string {
  const metric = formatMetric(value, unitLabel);
  const inflectedUnit = inflectUnitLabel(unitLabel, value);
  return inflectedUnit ? `${metric} ${inflectedUnit}` : metric;
}

export function chooseByJoinedValues(
  value: string | null | undefined,
  singular: string,
  plural: string
): string {
  if (typeof value !== "string") return plural;
  const compact = value.trim();
  if (!compact) return plural;

  const parts = compact
    .split(/[,\n;|]+/g)
    .map((item) => item.trim())
    .filter(Boolean);

  if (parts.length <= 1) return singular;
  return plural;
}
