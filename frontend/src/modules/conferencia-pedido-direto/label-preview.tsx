import { formatDateTimeBrasilia } from "../../shared/brasilia-datetime";

export interface PedidoDiretoLabelData {
  cd: number;
  loja_numero: number | null;
  loja_nome: string | null;
  pedido: number | null;
  sq: number | null;
  rota: string | null;
  matricula: string | null;
  volume_atual: number;
  volume_total: number;
  generated_at: string;
}

function digitsOnly(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/\D+/g, "");
}

function pad(value: string | number, length: number): string {
  return String(value).padStart(length, "0");
}

function isLeapYear(year: number): boolean {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}

function formatPedidoDate(pedido: number | null): string {
  const digits = digitsOnly(pedido);
  if (digits.length !== 7) return "--/--/----";

  const year = Number.parseInt(digits.slice(0, 4), 10);
  const dayOfYear = Number.parseInt(digits.slice(4), 10);
  const maxDay = isLeapYear(year) ? 366 : 365;
  if (!Number.isFinite(year) || !Number.isFinite(dayOfYear) || dayOfYear < 1 || dayOfYear > maxDay) {
    return "--/--/----";
  }

  const date = new Date(year, 0, 1);
  date.setDate(dayOfYear);
  return `${pad(date.getDate(), 2)}/${pad(date.getMonth() + 1, 2)}/${year}`;
}

function formatLoja(value: PedidoDiretoLabelData): string {
  if (value.loja_numero == null && !value.loja_nome) return "-";
  if (value.loja_numero == null) return value.loja_nome ?? "-";
  if (!value.loja_nome) return String(value.loja_numero);
  return `${value.loja_numero} - ${value.loja_nome}`;
}

function formatRota(rota: string | null): string {
  const normalized = String(rota ?? "").trim();
  return normalized || "SEM ROTA";
}

function formatPedido(pedido: number | null): string {
  const digits = digitsOnly(pedido);
  return digits || "-";
}

function formatSeq(sq: number | null): string {
  const digits = digitsOnly(sq);
  return digits ? String(Number(digits)) : "-";
}

function formatGeneratedAt(value: string): string {
  return formatDateTimeBrasilia(value, {
    includeSeconds: false,
    emptyFallback: "-",
    invalidFallback: "-"
  });
}

export function buildPedidoDiretoLabelData(params: {
  cd: number;
  loja_numero: number | null;
  loja_nome: string | null;
  pedido: number | null;
  sq: number | null;
  rota: string | null;
  matricula: string | null;
  volume_total: number;
  generated_at?: string;
}): PedidoDiretoLabelData[] {
  const total = Math.max(1, Math.trunc(params.volume_total));
  const generatedAt = params.generated_at ?? new Date().toISOString();

  return Array.from({ length: total }, (_, index) => ({
    cd: Math.max(0, Math.trunc(params.cd)),
    loja_numero: params.loja_numero,
    loja_nome: params.loja_nome,
    pedido: params.pedido,
    sq: params.sq,
    rota: params.rota,
    matricula: params.matricula,
    volume_atual: index + 1,
    volume_total: total,
    generated_at: generatedAt
  }));
}

export const PEDIDO_DIRETO_LABEL_PRINT_CSS = `
:root {
  --pd-label-width: 156mm;
  --pd-label-height: 68mm;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
  color: #111827;
  font-family: "Arial", sans-serif;
}
body {
  padding: 0;
}
.pedido-direto-label-sheet {
  display: grid;
  gap: 10px;
  justify-items: start;
}
.pedido-direto-label-card {
  width: var(--pd-label-width);
  min-height: var(--pd-label-height);
  border: 1px solid #111827;
  border-radius: 4mm;
  background: #ffffff;
  padding: 3mm;
  display: grid;
  gap: 2mm;
  page-break-inside: avoid;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12);
}
.pedido-direto-label-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid #cad5e7;
  border-radius: 3mm;
  background: #f5f8ff;
  padding: 1.5mm 2mm;
}
.pedido-direto-label-title {
  font-size: 14pt;
  font-weight: 800;
  letter-spacing: 0.02em;
}
.pedido-direto-label-brand {
  border: 1px solid #bfd0eb;
  border-radius: 999px;
  padding: 0.6mm 2mm;
  color: #0f3d8c;
  background: #ffffff;
  font-size: 9pt;
  font-weight: 700;
}
.pedido-direto-label-main {
  display: grid;
  grid-template-columns: 1fr 34mm;
  gap: 3mm;
  align-items: start;
}
.pedido-direto-label-info {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1mm 2mm;
  font-size: 11pt;
}
.pedido-direto-label-info dt {
  margin: 0;
  font-weight: 800;
}
.pedido-direto-label-info dd {
  margin: 0;
}
.pedido-direto-label-volume {
  border: 1px solid #111827;
  border-radius: 3mm;
  background: #eef4ff;
  padding: 2mm;
  display: grid;
  gap: 1mm;
  text-align: center;
}
.pedido-direto-label-volume-title {
  font-size: 10pt;
  font-weight: 800;
}
.pedido-direto-label-volume-main {
  font-size: 22pt;
  line-height: 1;
  font-weight: 900;
}
.pedido-direto-label-volume-note {
  font-size: 9pt;
  font-weight: 700;
}
.pedido-direto-label-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6mm;
  font-size: 9pt;
}
.pedido-direto-label-meta strong {
  font-weight: 800;
}
@page {
  size: 156mm 68mm;
  margin: 0;
}
@media print {
  body {
    padding: 0;
  }
  .pedido-direto-label-sheet {
    gap: 0;
  }
  .pedido-direto-label-card {
    margin: 0;
    border-radius: 0;
    box-shadow: none;
    page-break-after: always;
  }
  .pedido-direto-label-card:last-child {
    page-break-after: auto;
  }
}
`;

export function PedidoDiretoLabelSheet({ labels }: { labels: PedidoDiretoLabelData[] }) {
  return (
    <div className="pedido-direto-label-sheet">
      {labels.map((label) => (
        <article
          key={`${label.cd}-${label.pedido ?? "na"}-${label.sq ?? "na"}-${label.volume_atual}-${label.generated_at}`}
          className="pedido-direto-label-card"
        >
          <header className="pedido-direto-label-header">
            <div className="pedido-direto-label-title">PEDIDO DIRETO CD {label.cd}</div>
            <div className="pedido-direto-label-brand">Pague Menos</div>
          </header>

          <div className="pedido-direto-label-main">
            <dl className="pedido-direto-label-info">
              <dt>LOJA:</dt>
              <dd>{formatLoja(label)}</dd>
              <dt>N° PEDIDO:</dt>
              <dd>{formatPedido(label.pedido)}</dd>
              <dt>SEQ:</dt>
              <dd>{formatSeq(label.sq)}</dd>
              <dt>DT PEDIDO:</dt>
              <dd>{formatPedidoDate(label.pedido)}</dd>
              <dt>ROTA:</dt>
              <dd>{formatRota(label.rota)}</dd>
            </dl>

            <div className="pedido-direto-label-volume">
              <div className="pedido-direto-label-volume-title">VOLUME</div>
              <div className="pedido-direto-label-volume-main">
                {label.volume_atual}/{label.volume_total}
              </div>
              {label.volume_total > 1 ? (
                <div className="pedido-direto-label-volume-note">VOLUME FRACIONADO</div>
              ) : null}
            </div>
          </div>

          <footer className="pedido-direto-label-meta">
            <span>CD: <strong>{label.cd}</strong></span>
            {label.matricula ? <span>MATRÍCULA: <strong>{label.matricula}</strong></span> : null}
            <span>SEPARADO EM: <strong>{formatGeneratedAt(label.generated_at)}</strong></span>
          </footer>
        </article>
      ))}
    </div>
  );
}
