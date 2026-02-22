import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { getModuleByKeyOrThrow } from "../registry";
import {
  deleteAtividadeExtra,
  fetchAtividadeExtraCollaborators,
  fetchAtividadeExtraEntries,
  fetchAtividadeExtraVisibility,
  insertAtividadeExtra,
  setAtividadeExtraVisibility,
  updateAtividadeExtra
} from "./sync";
import type { AtividadeExtraEntryRow, AtividadeExtraModuleProfile, AtividadeExtraVisibilityMode, AtividadeExtraVisibilityRow } from "./types";

interface AtividadeExtraPageProps {
  isOnline: boolean;
  profile: AtividadeExtraModuleProfile;
}

const MODULE_DEF = getModuleByKeyOrThrow("atividade-extra");

function toDisplayName(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";
  return compact
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1))
    .join(" ");
}

function parseCdFromLabel(label: string | null): number | null {
  if (!label) return null;
  const matched = /cd\s*0*(\d+)/i.exec(label);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixedCdFromProfile(profile: AtividadeExtraModuleProfile): number | null {
  if (typeof profile.cd_default === "number" && Number.isFinite(profile.cd_default)) {
    return Math.trunc(profile.cd_default);
  }
  return parseCdFromLabel(profile.cd_nome);
}

function todayIsoBrasilia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function nowHourMinuteBrasilia(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
}

function toTimeInputValue(value: string): string {
  const compact = value.trim();
  if (!compact) return "";
  const matched = /^(\d{2}):(\d{2})/.exec(compact);
  if (!matched) return compact.slice(0, 5);
  return `${matched[1]}:${matched[2]}`;
}

function parseHourMinuteToSeconds(value: string): number | null {
  const matched = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!matched) return null;
  const hh = Number.parseInt(matched[1], 10);
  const mm = Number.parseInt(matched[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 3600 + mm * 60;
}

function clampTimeToWindow(value: string): string {
  const seconds = parseHourMinuteToSeconds(value);
  if (seconds == null) return "06:00";
  const minSeconds = 6 * 3600;
  const maxSeconds = 21 * 3600 + 30 * 60;
  const bounded = Math.min(Math.max(seconds, minSeconds), maxSeconds);
  const hh = Math.floor(bounded / 3600);
  const mm = Math.floor((bounded % 3600) / 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function secondsToHms(totalSeconds: number): string {
  const safe = Math.max(Math.floor(totalSeconds), 0);
  const hh = Math.floor(safe / 3600);
  const mm = Math.floor((safe % 3600) / 60);
  const ss = safe % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function computeDurationSeconds(params: {
  dataAtividade: string;
  horaInicio: string;
  horaFim: string;
}): number | null {
  if (!params.dataAtividade || !params.horaInicio || !params.horaFim) return null;
  const start = Date.parse(`${params.dataAtividade}T${params.horaInicio}:00`);
  const end = Date.parse(`${params.dataAtividade}T${params.horaFim}:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.floor((end - start) / 1000);
}

function computePoints(durationSeconds: number | null): number {
  if (durationSeconds == null || durationSeconds <= 0) return 0;
  if (durationSeconds < 300) return 0;
  if (durationSeconds >= 21600) return 1.5;
  const steps = Math.floor((durationSeconds - 300) / 1014);
  const points = 0.01 + steps * 0.07095;
  return Math.min(points, 1.5);
}

function formatDate(value: string): string {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(parsed);
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(parsed);
}

function formatPoints(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 5,
    maximumFractionDigits: 5
  }).format(value);
}

function visibilityModeLabel(mode: AtividadeExtraVisibilityMode): string {
  return mode === "owner_only" ? "Somente dono/admin" : "Público no CD";
}

function visibilityIcon(isOwnerOnly: boolean) {
  if (isOwnerOnly) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function sanitizeDescription(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function asUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Erro inesperado.";
}

export default function AtividadeExtraPage({ isOnline, profile }: AtividadeExtraPageProps) {
  const displayUserName = toDisplayName(profile.nome);
  const activeCd = useMemo(() => fixedCdFromProfile(profile), [profile]);
  const isAdmin = profile.role === "admin";

  const [loading, setLoading] = useState(true);
  const [busySubmit, setBusySubmit] = useState(false);
  const [busyVisibility, setBusyVisibility] = useState(false);
  const [busyRefresh, setBusyRefresh] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [visibility, setVisibility] = useState<AtividadeExtraVisibilityRow | null>(null);
  const [collaborators, setCollaborators] = useState<{
    user_id: string;
    mat: string;
    nome: string;
    pontos_soma: number;
    tempo_total_segundos: number;
    tempo_total_hms: string;
    atividades_count: number;
  }[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(profile.user_id);
  const [entries, setEntries] = useState<AtividadeExtraEntryRow[]>([]);

  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [dataAtividade, setDataAtividade] = useState<string>(todayIsoBrasilia());
  const [horaInicio, setHoraInicio] = useState<string>(clampTimeToWindow(nowHourMinuteBrasilia()));
  const [horaFim, setHoraFim] = useState<string>(clampTimeToWindow(nowHourMinuteBrasilia()));
  const [descricao, setDescricao] = useState<string>("");

  const selectedCollaborator = useMemo(
    () => collaborators.find((row) => row.user_id === selectedUserId) ?? null,
    [collaborators, selectedUserId]
  );

  const previewDurationSeconds = useMemo(
    () => computeDurationSeconds({ dataAtividade, horaInicio, horaFim }),
    [dataAtividade, horaInicio, horaFim]
  );
  const previewPoints = useMemo(() => computePoints(previewDurationSeconds), [previewDurationSeconds]);

  const resetForm = useCallback(() => {
    const nowDate = todayIsoBrasilia();
    const nowTime = clampTimeToWindow(nowHourMinuteBrasilia());
    setEditingEntryId(null);
    setDataAtividade(nowDate);
    setHoraInicio(nowTime);
    setHoraFim(nowTime);
    setDescricao("");
  }, []);

  const loadEntries = useCallback(async (targetUserId: string | null) => {
    if (activeCd == null) {
      setEntries([]);
      return;
    }
    const rows = await fetchAtividadeExtraEntries({
      cd: activeCd,
      targetUserId
    });
    setEntries(rows);
  }, [activeCd]);

  const loadModuleData = useCallback(async (preferredUserId?: string | null) => {
    if (activeCd == null) {
      setVisibility(null);
      setCollaborators([]);
      setEntries([]);
      setErrorMessage("CD não definido para este usuário.");
      setLoading(false);
      return;
    }

    const targetPreferred = preferredUserId ?? selectedUserId ?? profile.user_id;
    const isFirstLoad = loading;
    if (isFirstLoad) {
      setLoading(true);
    } else {
      setBusyRefresh(true);
    }
    setErrorMessage(null);

    try {
      const [visibilityRow, collaboratorRows] = await Promise.all([
        fetchAtividadeExtraVisibility(activeCd),
        fetchAtividadeExtraCollaborators(activeCd)
      ]);

      let nextSelectedUserId = targetPreferred;
      if (collaboratorRows.length > 0) {
        if (!nextSelectedUserId || !collaboratorRows.some((row) => row.user_id === nextSelectedUserId)) {
          nextSelectedUserId = collaboratorRows[0].user_id;
        }
      } else {
        nextSelectedUserId = profile.user_id;
      }

      const detailRows = await fetchAtividadeExtraEntries({
        cd: activeCd,
        targetUserId: nextSelectedUserId
      });

      setVisibility(visibilityRow);
      setCollaborators(collaboratorRows);
      setSelectedUserId(nextSelectedUserId);
      setEntries(detailRows);
    } catch (error) {
      setErrorMessage(asUnknownErrorMessage(error));
    } finally {
      setBusyRefresh(false);
      setLoading(false);
    }
  }, [activeCd, loading, profile.user_id, selectedUserId]);

  useEffect(() => {
    void loadModuleData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCd, profile.user_id]);

  const onSelectCollaborator = useCallback((targetUserId: string) => {
    setSelectedUserId(targetUserId);
    setErrorMessage(null);
    void loadEntries(targetUserId).catch((error) => {
      setErrorMessage(asUnknownErrorMessage(error));
    });
  }, [loadEntries]);

  const onEditEntry = useCallback((entry: AtividadeExtraEntryRow) => {
    if (!entry.can_edit) return;
    setEditingEntryId(entry.id);
    setDataAtividade(entry.data_inicio);
    setHoraInicio(toTimeInputValue(entry.hora_inicio));
    setHoraFim(toTimeInputValue(entry.hora_fim));
    setDescricao(entry.descricao);
    setStatusMessage(null);
    setErrorMessage(null);
  }, []);

  const onDeleteEntry = useCallback(async (entry: AtividadeExtraEntryRow) => {
    if (!entry.can_edit || busySubmit) return;
    const confirmed = window.confirm(`Deseja excluir a atividade "${entry.descricao}"?`);
    if (!confirmed) return;

    setBusySubmit(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await deleteAtividadeExtra(entry.id);
      if (editingEntryId === entry.id) {
        resetForm();
      }
      setStatusMessage("Atividade excluída com sucesso.");
      await loadModuleData(selectedUserId ?? profile.user_id);
    } catch (error) {
      setErrorMessage(asUnknownErrorMessage(error));
    } finally {
      setBusySubmit(false);
    }
  }, [busySubmit, editingEntryId, loadModuleData, profile.user_id, resetForm, selectedUserId]);

  const onToggleVisibility = useCallback(async () => {
    if (!isAdmin || activeCd == null || busyVisibility || !visibility) return;
    const nextMode: AtividadeExtraVisibilityMode = visibility.visibility_mode === "public_cd" ? "owner_only" : "public_cd";
    const confirmed = window.confirm(
      nextMode === "public_cd"
        ? "Liberar visualização para todos do CD?"
        : "Ocultar dados de outros colaboradores para usuários comuns?"
    );
    if (!confirmed) return;

    setBusyVisibility(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const row = await setAtividadeExtraVisibility(activeCd, nextMode);
      setVisibility(row);
      setStatusMessage(`Visibilidade atualizada: ${visibilityModeLabel(row.visibility_mode)}.`);
      await loadModuleData(selectedUserId ?? profile.user_id);
    } catch (error) {
      setErrorMessage(asUnknownErrorMessage(error));
    } finally {
      setBusyVisibility(false);
    }
  }, [activeCd, busyVisibility, isAdmin, loadModuleData, profile.user_id, selectedUserId, visibility]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (activeCd == null) {
      setErrorMessage("CD não definido para este usuário.");
      return;
    }

    const cleanDescription = sanitizeDescription(descricao);
    if (!cleanDescription) {
      setErrorMessage("Descrição da atividade é obrigatória.");
      return;
    }

    setBusySubmit(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      if (editingEntryId) {
        await updateAtividadeExtra({
          id: editingEntryId,
          data_inicio: dataAtividade,
          hora_inicio: horaInicio,
          data_fim: dataAtividade,
          hora_fim: horaFim,
          descricao: cleanDescription
        });
        setStatusMessage("Atividade atualizada com sucesso.");
      } else {
        await insertAtividadeExtra({
          cd: activeCd,
          data_inicio: dataAtividade,
          hora_inicio: horaInicio,
          data_fim: dataAtividade,
          hora_fim: horaFim,
          descricao: cleanDescription
        });
        setStatusMessage("Atividade registrada com sucesso.");
      }

      resetForm();
      await loadModuleData(profile.user_id);
    } catch (error) {
      setErrorMessage(asUnknownErrorMessage(error));
    } finally {
      setBusySubmit(false);
    }
  }

  return (
    <>
      <header className="module-topbar module-topbar-fixed">
        <div className="module-topbar-line1">
          <Link to="/inicio" className="module-home-btn" aria-label="Voltar para o Início" title="Voltar para o Início">
            <span className="module-back-icon" aria-hidden="true">
              <BackIcon />
            </span>
            <span>Início</span>
          </Link>
          <div className="module-topbar-user-side">
            <span className="module-user-greeting">Olá, {displayUserName}</span>
            <span className={`status-pill ${isOnline ? "online" : "offline"}`}>
              {isOnline ? "🟢 Online" : "🔴 Offline"}
            </span>
          </div>
        </div>
        <div className={`module-card module-card-static module-header-card tone-${MODULE_DEF.tone}`}>
          <span className="module-icon" aria-hidden="true">
            <ModuleIcon name={MODULE_DEF.icon} />
          </span>
          <span className="module-title">{MODULE_DEF.title}</span>
        </div>
      </header>

      <section className="modules-shell atividade-extra-shell">
        <article className="module-screen surface-enter atividade-extra-screen">
          <div className="module-screen-header">
            <div className="module-screen-title-row">
              <div className="module-screen-title">
                <h2>Detalhamento de atividades</h2>
                <p>Uso rápido para registro diário no celular.</p>
              </div>
              <div className="atividade-extra-actions-head">
                <button
                  type="button"
                  className="btn btn-muted atividade-extra-refresh-btn"
                  onClick={() => void loadModuleData()}
                  disabled={busyRefresh || loading}
                >
                  {busyRefresh ? "Atualizando..." : "Atualizar"}
                </button>
                {isAdmin && visibility ? (
                  <button
                    type="button"
                    className="btn btn-muted atividade-extra-visibility-btn"
                    onClick={() => void onToggleVisibility()}
                    disabled={busyVisibility}
                    title="Alternar visibilidade do CD"
                  >
                    <span aria-hidden="true">{visibilityIcon(visibility.visibility_mode === "owner_only")}</span>
                    {busyVisibility ? "Salvando..." : visibilityModeLabel(visibility.visibility_mode)}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="module-screen-body atividade-extra-body">
            {loading ? <div className="coleta-empty">Carregando atividades...</div> : null}
            {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
            {statusMessage ? <div className="alert success">{statusMessage}</div> : null}

            {visibility ? (
              <div className="atividade-extra-visibility-line">
                <strong>Visibilidade no CD:</strong> {visibilityModeLabel(visibility.visibility_mode)}
              </div>
            ) : null}

            <form className="atividade-extra-form" onSubmit={onSubmit}>
              <div className="atividade-extra-form-grid">
                <label>
                  Data da atividade
                  <input
                    type="date"
                    value={dataAtividade}
                    onChange={(event) => setDataAtividade(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Hora inicial
                  <input
                    type="time"
                    value={horaInicio}
                    onChange={(event) => setHoraInicio(clampTimeToWindow(event.target.value))}
                    min="06:00"
                    max="21:30"
                    required
                  />
                </label>
                <label>
                  Hora final
                  <input
                    type="time"
                    value={horaFim}
                    onChange={(event) => setHoraFim(clampTimeToWindow(event.target.value))}
                    min="06:00"
                    max="21:30"
                    required
                  />
                </label>
                <label className="atividade-extra-form-description">
                  Descrição da atividade
                  <input
                    type="text"
                    value={descricao}
                    onChange={(event) => setDescricao(event.target.value)}
                    maxLength={240}
                    required
                  />
                </label>
              </div>
              <div className="atividade-extra-preview-line">
                <span>Tempo: {previewDurationSeconds != null && previewDurationSeconds > 0 ? secondsToHms(previewDurationSeconds) : "--:--:--"}</span>
                <span>Pontuação: {formatPoints(previewPoints)}</span>
              </div>
              <div className="atividade-extra-form-actions">
                <button className="btn btn-primary" type="submit" disabled={busySubmit || activeCd == null}>
                  {busySubmit ? "Salvando..." : editingEntryId ? "Salvar alteração" : "Registrar atividade"}
                </button>
                {editingEntryId ? (
                  <button className="btn btn-muted" type="button" onClick={resetForm} disabled={busySubmit}>
                    Cancelar edição
                  </button>
                ) : null}
              </div>
            </form>

            <div className="atividade-extra-grid">
              <section className="atividade-extra-collaborators">
                <h3>Resumo por colaborador</h3>
                {collaborators.length === 0 ? (
                  <div className="coleta-empty">Nenhuma atividade registrada no período atual.</div>
                ) : (
                  <div className="atividade-extra-collaborators-content">
                    <div className="atividade-extra-table-wrap">
                      <table className="atividade-extra-table">
                        <thead>
                          <tr>
                            <th>Mat</th>
                            <th>Nome</th>
                            <th>Pontuação</th>
                            <th>Tempo total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {collaborators.map((row) => (
                            <tr
                              key={row.user_id}
                              className={row.user_id === selectedUserId ? "is-selected" : ""}
                              onClick={() => onSelectCollaborator(row.user_id)}
                            >
                              <td>{row.mat}</td>
                              <td>{row.nome}</td>
                              <td>{formatPoints(row.pontos_soma)}</td>
                              <td>{row.tempo_total_hms}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="atividade-extra-collaborator-cards">
                      {collaborators.map((row) => (
                        <button
                          key={`card:${row.user_id}`}
                          className={`atividade-extra-collaborator-card${row.user_id === selectedUserId ? " is-selected" : ""}`}
                          type="button"
                          onClick={() => onSelectCollaborator(row.user_id)}
                        >
                          <strong>{row.nome}</strong>
                          <span>Mat: {row.mat}</span>
                          <span>Pontuação: {formatPoints(row.pontos_soma)}</span>
                          <span>Tempo total: {row.tempo_total_hms}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <section className="atividade-extra-detail">
                <h3>
                  Detalhe do colaborador
                  {selectedCollaborator ? `: ${selectedCollaborator.nome}` : ""}
                </h3>
                {selectedCollaborator ? (
                  <div className="atividade-extra-summary-strip">
                    <span>Total de atividades: {selectedCollaborator.atividades_count}</span>
                    <span>Pontuação acumulada: {formatPoints(selectedCollaborator.pontos_soma)}</span>
                    <span>Tempo acumulado: {selectedCollaborator.tempo_total_hms}</span>
                  </div>
                ) : null}

                {entries.length === 0 ? (
                  <div className="coleta-empty">Sem atividades para o colaborador selecionado.</div>
                ) : (
                  <div className="atividade-extra-entry-list">
                    {entries.map((entry) => (
                      <article key={entry.id} className="atividade-extra-entry-card">
                        <div className="atividade-extra-entry-head">
                          <strong>{formatDate(entry.data_inicio)} | {entry.tempo_gasto_hms}</strong>
                          <span>{formatPoints(entry.pontos)} ponto(s)</span>
                        </div>
                        <p className="atividade-extra-entry-description">{entry.descricao}</p>
                        <div className="atividade-extra-entry-meta">
                          <span>Início: {toTimeInputValue(entry.hora_inicio)}</span>
                          <span>Final: {toTimeInputValue(entry.hora_fim)}</span>
                          <span>Informado em: {formatDateTime(entry.created_at)}</span>
                        </div>
                        {entry.can_edit ? (
                          <div className="atividade-extra-entry-actions">
                            <button className="btn btn-muted" type="button" onClick={() => onEditEntry(entry)} disabled={busySubmit}>
                              Editar
                            </button>
                            <button className="btn btn-danger" type="button" onClick={() => void onDeleteEntry(entry)} disabled={busySubmit}>
                              Excluir
                            </button>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </article>
      </section>
    </>
  );
}
