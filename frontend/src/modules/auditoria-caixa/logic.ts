import { todayIsoBrasilia } from "../../shared/brasilia-datetime";
import {
  AUDITORIA_CAIXA_OCCURRENCIAS,
  type AuditoriaCaixaOccurrence
} from "./types";

export const AUDITORIA_CAIXA_ALLOWED_LENGTHS = [17, 18, 23, 25, 26, 27] as const;
export const AUDITORIA_CAIXA_MAX_LENGTH = 27;
export const AUDITORIA_CAIXA_INVALID_ETIQUETA_MESSAGE = "Etiqueta inválida, revise e tente novamente!";

export interface ParsedAuditoriaCaixaEtiqueta {
  etiqueta: string;
  id_knapp: string | null;
  length: 17 | 18 | 23 | 25 | 26 | 27;
  pedido: number;
  pedido_raw: string;
  data_pedido: string | null;
  dv: string | null;
  filial: number;
  volume: string | null;
}

interface ParseAuditoriaCaixaEtiquetaOptions {
  currentCd?: number | null;
  now?: Date;
}

function currentBrasiliaYear(now = new Date()): number {
  return Number.parseInt(todayIsoBrasilia(now).slice(0, 4), 10);
}

export function normalizeEtiquetaInput(value: string): string {
  return value.replace(/\s+/g, "").trim().toUpperCase();
}

export function clampEtiquetaInput(value: string): string {
  return normalizeEtiquetaInput(value).slice(0, AUDITORIA_CAIXA_MAX_LENGTH);
}

export function normalizeKnappIdInput(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").replace(/\D+/g, "").slice(0, 8);
  return normalized || null;
}

export function stripLeadingZeros(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const stripped = raw.replace(/^0+/, "");
  return stripped || "0";
}

export function normalizeOccurrenceInput(value: string | null | undefined): AuditoriaCaixaOccurrence {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return AUDITORIA_CAIXA_OCCURRENCIAS.find((item) => item === normalized) ?? null;
}

export function requiresKnappId(value: string | number): boolean {
  const length = typeof value === "number" ? value : normalizeEtiquetaInput(value).length;
  return length === 17 || length === 18;
}

export function isAllowedEtiquetaLength(value: string | number): boolean {
  const length = typeof value === "number" ? value : normalizeEtiquetaInput(value).length;
  return AUDITORIA_CAIXA_ALLOWED_LENGTHS.includes(length as typeof AUDITORIA_CAIXA_ALLOWED_LENGTHS[number]);
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

export function parseAuditoriaCaixaEtiqueta(
  rawEtiqueta: string,
  rawKnappId?: string | null,
  options: ParseAuditoriaCaixaEtiquetaOptions = {}
): ParsedAuditoriaCaixaEtiqueta {
  const now = options.now ?? new Date();
  const etiqueta = normalizeEtiquetaInput(rawEtiqueta);
  if (!etiqueta) throw new Error("Informe a etiqueta para continuar.");

  const length = etiqueta.length;
  if (!isAllowedEtiquetaLength(length)) {
    throw new Error(AUDITORIA_CAIXA_INVALID_ETIQUETA_MESSAGE);
  }

  if (length === 23 || length === 25 || length === 26 || length === 27) {
    const prefix = etiqueta.slice(0, 1);
    const yearRaw = etiqueta.slice(1, 5);
    const year = Number.parseInt(yearRaw, 10);
    const currentYear = currentBrasiliaYear(now);

    if (!/^[1-9]$/.test(prefix)) {
      throw new Error(AUDITORIA_CAIXA_INVALID_ETIQUETA_MESSAGE);
    }
    if (!/^\d{4}$/.test(yearRaw) || !Number.isFinite(year) || year < 2024 || year > currentYear) {
      throw new Error(AUDITORIA_CAIXA_INVALID_ETIQUETA_MESSAGE);
    }
  }

  const idKnapp = normalizeKnappIdInput(rawKnappId);
  if (requiresKnappId(length) && idKnapp != null && idKnapp.length !== 8) {
    throw new Error("O ID knapp deve ter exatamente 8 dígitos.");
  }

  let pedidoRaw = "";
  let dvRaw = "";
  let filialRaw = "";
  let volumeRaw: string | null = null;

  if (length === 17) {
    const currentCd = options.currentCd;
    if (!Number.isFinite(currentCd)) {
      throw new Error("CD não definido para validar esta etiqueta.");
    }
    const cdPrefix = String(Math.trunc(currentCd as number));
    if (!etiqueta.startsWith(cdPrefix)) {
      throw new Error(AUDITORIA_CAIXA_INVALID_ETIQUETA_MESSAGE);
    }
    const filialLength = length - cdPrefix.length - 13;
    if (filialLength !== 3 && filialLength !== 4) {
      throw new Error(AUDITORIA_CAIXA_INVALID_ETIQUETA_MESSAGE);
    }
    pedidoRaw = etiqueta.slice(cdPrefix.length, cdPrefix.length + 7);
    dvRaw = etiqueta.slice(cdPrefix.length + 7, cdPrefix.length + 13);
    filialRaw = etiqueta.slice(-filialLength);
    volumeRaw = idKnapp;
  } else if (length === 18) {
    const currentCd = options.currentCd;
    if (!Number.isFinite(currentCd)) {
      throw new Error("CD não definido para validar esta etiqueta.");
    }
    const cdPrefix = String(Math.trunc(currentCd as number));
    if (!etiqueta.startsWith(cdPrefix)) {
      throw new Error(AUDITORIA_CAIXA_INVALID_ETIQUETA_MESSAGE);
    }
    const filialLength = length - cdPrefix.length - 13;
    if (filialLength !== 3 && filialLength !== 4) {
      throw new Error(AUDITORIA_CAIXA_INVALID_ETIQUETA_MESSAGE);
    }
    pedidoRaw = etiqueta.slice(cdPrefix.length, cdPrefix.length + 7);
    dvRaw = etiqueta.slice(cdPrefix.length + 7, cdPrefix.length + 13);
    filialRaw = etiqueta.slice(-filialLength);
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

  if (!/^\d{7}$/.test(pedidoRaw)) {
    throw new Error(AUDITORIA_CAIXA_INVALID_ETIQUETA_MESSAGE);
  }
  if (!/^\d+$/.test(filialRaw)) {
    throw new Error(AUDITORIA_CAIXA_INVALID_ETIQUETA_MESSAGE);
  }

  const filialNormalized = stripLeadingZeros(filialRaw);
  const filial = Number.parseInt(filialNormalized ?? "", 10);
  if (!Number.isFinite(filial)) {
    throw new Error(AUDITORIA_CAIXA_INVALID_ETIQUETA_MESSAGE);
  }

  const pedido = Number.parseInt(pedidoRaw, 10);
  if (!Number.isFinite(pedido)) {
    throw new Error(AUDITORIA_CAIXA_INVALID_ETIQUETA_MESSAGE);
  }

  const pedidoYear = Number.parseInt(pedidoRaw.slice(0, 4), 10);
  const currentYear = currentBrasiliaYear(now);
  if (!Number.isFinite(pedidoYear) || pedidoYear < 2024 || pedidoYear > currentYear) {
    throw new Error(AUDITORIA_CAIXA_INVALID_ETIQUETA_MESSAGE);
  }

  const dataPedido = toIsoDateFromPedido(pedidoRaw);
  if (!dataPedido) {
    throw new Error(AUDITORIA_CAIXA_INVALID_ETIQUETA_MESSAGE);
  }

  return {
    etiqueta,
    id_knapp: idKnapp,
    length: length as ParsedAuditoriaCaixaEtiqueta["length"],
    pedido,
    pedido_raw: pedidoRaw,
    data_pedido: dataPedido,
    dv: stripLeadingZeros(dvRaw),
    filial,
    volume: stripLeadingZeros(volumeRaw)
  };
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
