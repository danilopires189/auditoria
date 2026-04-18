import { conformityStatus, formatPercent } from "../utils";
import { formatDateTimeBrasilia } from "../../../shared/brasilia-datetime";
import type { ChecklistAuditSummary, ChecklistDefinition, ChecklistKey } from "../types";
import { CHECKLIST_DEFINITIONS } from "../types";

interface AdminPanelProps {
  isOnline: boolean;
  isGlobalAdmin: boolean;
  currentCdLabel: string;
  reportDtIni: string;
  reportDtFim: string;
  reportCd: string;
  reportAuditor: string;
  reportEvaluated: string;
  reportChecklistKey: ChecklistKey | "";
  reportRows: ChecklistAuditSummary[];
  reportBusy: boolean;
  reportExportingId: string | null;
  reportMessage: string | null;
  reportError: string | null;
  onDtIniChange: (v: string) => void;
  onDtFimChange: (v: string) => void;
  onCdChange: (v: string) => void;
  onAuditorChange: (v: string) => void;
  onEvaluatedChange: (v: string) => void;
  onChecklistKeyChange: (v: ChecklistKey | "") => void;
  onSearch: () => void;
  onExportPdf: (auditId: string) => void;
}

export default function AdminPanel({
  isOnline, isGlobalAdmin, currentCdLabel,
  reportDtIni, reportDtFim, reportCd, reportAuditor, reportEvaluated, reportChecklistKey,
  reportRows, reportBusy, reportExportingId, reportMessage, reportError,
  onDtIniChange, onDtFimChange, onCdChange, onAuditorChange, onEvaluatedChange, onChecklistKeyChange,
  onSearch, onExportPdf
}: AdminPanelProps) {
  return (
    <section className="checklist-panel checklist-admin-panel">
      <div className="checklist-panel-head">
        <div>
          <h3>Consulta admin</h3>
          <span>Consulte auditorias finalizadas e gere o PDF individual.</span>
        </div>
        <button type="button" className="btn btn-muted" onClick={onSearch} disabled={reportBusy || !isOnline}>
          {reportBusy ? "Buscando..." : "Buscar"}
        </button>
      </div>

      <div className="checklist-report-filters">
        <label>
          Data inicial
          <input type="date" value={reportDtIni} onChange={(e) => onDtIniChange(e.target.value)} />
        </label>
        <label>
          Data final
          <input type="date" value={reportDtFim} onChange={(e) => onDtFimChange(e.target.value)} />
        </label>
        <label>
          Checklist
          <select value={reportChecklistKey} onChange={(e) => onChecklistKeyChange(e.target.value as ChecklistKey | "")}>
            <option value="">Todos</option>
            {CHECKLIST_DEFINITIONS.map((d: ChecklistDefinition) => (
              <option key={d.checklist_key} value={d.checklist_key}>{d.title}</option>
            ))}
          </select>
        </label>
        {isGlobalAdmin ? (
          <label className="checklist-report-cd-filter">
            CD
            <input
              type="text"
              inputMode="numeric"
              value={reportCd}
              onChange={(e) => onCdChange(e.target.value.replace(/\D/g, ""))}
              placeholder="Todos"
            />
          </label>
        ) : (
          <label className="checklist-report-cd-filter">
            CD
            <input type="text" value={currentCdLabel} readOnly className="checklist-readonly-input" />
          </label>
        )}
        <label>
          Auditor
          <input type="text" value={reportAuditor} onChange={(e) => onAuditorChange(e.target.value)} placeholder="Nome ou matrícula" />
        </label>
        <label>
          Avaliado
          <input type="text" value={reportEvaluated} onChange={(e) => onEvaluatedChange(e.target.value)} placeholder="Nome ou matrícula" />
        </label>
      </div>

      {reportError ? <div className="alert error">{reportError}</div> : null}
      {reportMessage ? <div className="alert success">{reportMessage}</div> : null}

      <div className="checklist-report-list">
        {reportRows.length === 0 && !reportBusy ? (
          <div className="checklist-empty">Nenhuma auditoria carregada.</div>
        ) : null}
        {reportRows.map((row) => {
          const conformityValue = row.scoring_mode === "risk_weighted"
            ? Math.max(0, 100 - (row.risk_score_percent ?? 0))
            : row.conformity_percent;
          const status = conformityStatus(conformityValue);
          const resultText = row.scoring_mode === "risk_weighted"
            ? `${formatPercent(row.risk_score_percent ?? 0)} risco`
            : formatPercent(row.conformity_percent);

          return (
            <article key={row.audit_id} className="checklist-report-row">
              <div className="checklist-report-main">
                <strong>{row.checklist_title}</strong>
                <span>{row.scoring_mode === "simple" ? `${row.evaluated_nome} | MAT ${row.evaluated_mat}` : "Auditoria por CD"}</span>
                <span>{`Auditor: ${row.auditor_nome} | MAT ${row.auditor_mat}`}</span>
                <span>{`${formatDateTimeBrasilia(row.created_at, { includeSeconds: true })} | ${row.cd_nome || `CD ${String(row.cd).padStart(2, "0")}`}`}</span>
              </div>
              <div className="checklist-report-stats">
                <span className={`checklist-conformity-badge`} data-status={status}>{resultText}</span>
                <strong data-status={status}>{row.scoring_mode === "simple" ? `${row.non_conformities} NC` : row.risk_level ?? "RISCO"}</strong>
              </div>
              <button
                type="button"
                className="btn btn-muted"
                onClick={() => onExportPdf(row.audit_id)}
                disabled={reportExportingId === row.audit_id || !isOnline}
              >
                {reportExportingId === row.audit_id ? "Gerando..." : "Gerar PDF"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
