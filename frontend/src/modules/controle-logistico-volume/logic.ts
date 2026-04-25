import { todayIsoBrasilia } from "../../shared/brasilia-datetime";
import type { ClvEtapa, ClvFracionadoTipo, ClvParsedEtiqueta, ClvStageEtapa } from "./types";

export const CLV_ALLOWED_LENGTHS = [17, 18, 23, 25, 26, 27] as const;
export const CLV_MAX_LENGTH = 27;
export const CLV_INVALID_ETIQUETA_MESSAGE = "Etiqueta inválida, revise e tente novamente!";
export const CLV_INVALID_KNAPP_MESSAGE = "Etiqueta Knapp inválida, revise e tente novamente!";
export const CLV_ACCESS_MAT = "88885";

export const CLV_ETAPA_LABELS: Record<ClvEtapa, string> = {
  recebimento_cd: "Recebimento (CD Pague Menos)",
  entrada_galpao: "Entrada (Galpão)",
  saida_galpao: "Saída (Galpão)",
  entrega_filial: "Entrega (Filial Pague Menos)"
};

export const CLV_STAGE_ETAPAS: ClvStageEtapa[] = ["entrada_galpao", "saida_galpao", "entrega_filial"];

export const CLV_FRACIONADO_TIPO_LABELS: Record<ClvFracionadoTipo, string> = {
  pedido_direto: "Pedido Direto",
  termolabeis: "Termolábeis"
};

function currentBrasiliaYear(now = new Date()): number {
  return Number.parseInt(todayIsoBrasilia(now).slice(0, 4), 10);
}

export function normalizeMat(value: string): string {
  const normalized = value.replace(/\D/g, "");
  return normalized.replace(/^0+(?=\d)/, "") || normalized;
}

export function canAccessClv(mat: string): boolean {
  return normalizeMat(mat) === CLV_ACCESS_MAT;
}

export function normalizeEtiquetaInput(value: string): string {
  return value.replace(/\s+/g, "").trim().toUpperCase();
}

export function clampEtiquetaInput(value: string): string {
  return normalizeEtiquetaInput(value).slice(0, CLV_MAX_LENGTH);
}

export function normalizeKnappIdInput(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").replace(/\D+/g, "");
  return normalized || null;
}

export function stripLeadingZeros(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const stripped = raw.replace(/^0+/, "");
  return stripped || "0";
}

export function requiresKnappId(value: string | number): boolean {
  const length = typeof value === "number" ? value : normalizeEtiquetaInput(value).length;
  return length === 17 || length === 18;
}

export function isAllowedEtiquetaLength(value: string | number): boolean {
  const length = typeof value === "number" ? value : normalizeEtiquetaInput(value).length;
  return CLV_ALLOWED_LENGTHS.includes(length as typeof CLV_ALLOWED_LENGTHS[number]);
}

function toIsoDateFromPedido(pedidoRaw: string): string | null {
  if (!/^\d{7}$/.test(pedidoRaw)) return null;

  const year = Number.parseInt(pedidoRaw.slice(0, 4), 10);
  const dayOffset = Number.parseInt(pedidoRaw.slice(4, 7), 10);
  if (!Number.isFinite(year) || !Number.isFinite(dayOffset)) return null;
  if (dayOffset < 1) return null;

  const endOfYear = new Date(Date.UTC(year + 1, 0, 1));
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const daysInYear = Math.round((endOfYear.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  if (dayOffset > daysInYear) return null;

  const date = new Date(Date.UTC(year, 0, 1));
  date.setUTCDate(date.getUTCDate() + dayOffset - 1);
  return date.toISOString().slice(0, 10);
}

export function parseClvEtiqueta(
  rawEtiqueta: string,
  rawKnappId?: string | null,
  options: { currentCd?: number | null; now?: Date } = {}
): ClvParsedEtiqueta {
  const etiqueta = normalizeEtiquetaInput(rawEtiqueta);
  if (!etiqueta) throw new Error("Informe a etiqueta para continuar.");

  const length = etiqueta.length;
  if (!isAllowedEtiquetaLength(length)) {
    throw new Error(CLV_INVALID_ETIQUETA_MESSAGE);
  }

  const now = options.now ?? new Date();
  const currentYear = currentBrasiliaYear(now);

  if (length === 23 || length === 25 || length === 26 || length === 27) {
    const prefix = etiqueta.slice(0, 1);
    const yearRaw = etiqueta.slice(1, 5);
    const year = Number.parseInt(yearRaw, 10);

    if (!/^[1-9]$/.test(prefix)) {
      throw new Error(CLV_INVALID_ETIQUETA_MESSAGE);
    }
    if (!/^\d{4}$/.test(yearRaw) || !Number.isFinite(year) || year < 2024 || year > currentYear) {
      throw new Error(CLV_INVALID_ETIQUETA_MESSAGE);
    }
  }

  const idKnapp = normalizeKnappIdInput(rawKnappId);
  if (requiresKnappId(length)) {
    if (Math.trunc(options.currentCd ?? Number.NaN) !== 2) {
      throw new Error(CLV_INVALID_ETIQUETA_MESSAGE);
    }
    if (idKnapp == null || idKnapp.length !== 8) {
      throw new Error(CLV_INVALID_KNAPP_MESSAGE);
    }
  }

  let pedidoRaw = "";
  let dvRaw = "";
  let filialRaw = "";
  let volumeRaw: string | null = null;

  if (length === 17) {
    pedidoRaw = etiqueta.slice(0, 7);
    dvRaw = etiqueta.slice(7, 8);
    filialRaw = etiqueta.slice(-3);
    volumeRaw = idKnapp;
  } else if (length === 18) {
    pedidoRaw = etiqueta.slice(0, 7);
    dvRaw = etiqueta.slice(7, 8);
    filialRaw = etiqueta.slice(-4);
    volumeRaw = idKnapp;
  } else {
    pedidoRaw = etiqueta.slice(1, 8);
    dvRaw = etiqueta.slice(8, 11);
    filialRaw = etiqueta.slice(11, 15);

    if (length === 23) {
      volumeRaw = etiqueta.slice(-3);
    } else if (length === 25) {
      volumeRaw = etiqueta.slice(-2);
    } else if (length === 26) {
      volumeRaw = etiqueta.slice(16, 19);
    } else {
      volumeRaw = etiqueta.slice(17, 20);
    }
  }

  if (!/^\d{7}$/.test(pedidoRaw) || !/^\d+$/.test(filialRaw)) {
    throw new Error(CLV_INVALID_ETIQUETA_MESSAGE);
  }

  const pedido = Number.parseInt(pedidoRaw, 10);
  const filial = Number.parseInt(stripLeadingZeros(filialRaw) ?? "", 10);
  const pedidoYear = Number.parseInt(pedidoRaw.slice(0, 4), 10);
  if (!Number.isFinite(pedido) || !Number.isFinite(filial) || pedidoYear < 2024 || pedidoYear > currentYear) {
    throw new Error(CLV_INVALID_ETIQUETA_MESSAGE);
  }

  const dataPedido = toIsoDateFromPedido(pedidoRaw);
  if (!dataPedido) {
    throw new Error(CLV_INVALID_ETIQUETA_MESSAGE);
  }

  return {
    etiqueta,
    id_knapp: idKnapp,
    length: length as ClvParsedEtiqueta["length"],
    pedido,
    data_pedido: dataPedido,
    dv: stripLeadingZeros(dvRaw),
    filial,
    volume: stripLeadingZeros(volumeRaw),
    volume_key: length === 17 || length === 18 ? `KNAPP:${idKnapp}` : `ETQ:${etiqueta}`
  };
}

export function etapaCountKey(etapa: ClvEtapa): "recebido_count" | "entrada_count" | "saida_count" | "entrega_count" {
  if (etapa === "entrada_galpao") return "entrada_count";
  if (etapa === "saida_galpao") return "saida_count";
  if (etapa === "entrega_filial") return "entrega_count";
  return "recebido_count";
}

export function etapaPendingKey(
  etapa: ClvEtapa
): "pendente_recebimento" | "pendente_entrada" | "pendente_saida" | "pendente_entrega" {
  if (etapa === "entrada_galpao") return "pendente_entrada";
  if (etapa === "saida_galpao") return "pendente_saida";
  if (etapa === "entrega_filial") return "pendente_entrega";
  return "pendente_recebimento";
}

export function normalizeFracionadoTipo(value: string | null | undefined): ClvFracionadoTipo | null {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("pt-BR");
  if (normalized === "pedido_direto" || normalized === "pedido direto") return "pedido_direto";
  if (normalized === "termolabeis" || normalized === "termolábeis" || normalized === "termo") return "termolabeis";
  return null;
}

export function toDisplayName(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";
  return compact
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1))
    .join(" ");
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}
