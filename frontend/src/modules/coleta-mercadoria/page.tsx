import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { getModuleByKeyOrThrow } from "../registry";
import {
  countPendingRows,
  getColetaPreferences,
  getDbBarrasByBarcode,
  getDbBarrasMeta,
  getUserColetaRows,
  removeColetaRow,
  saveColetaPreferences,
  upsertColetaRow
} from "./storage";
import {
  fetchCdOptions,
  formatValidade,
  normalizeBarcode,
  normalizeValidadeInput,
  refreshDbBarrasCache,
  syncPendingColetaRows
} from "./sync";
import type { CdOption, ColetaModuleProfile, ColetaRow } from "./types";

interface ColetaMercadoriaPageProps {
  isOnline: boolean;
  profile: ColetaModuleProfile;
}

const MODULE_DEF = getModuleByKeyOrThrow("coleta-mercadoria");

function parseCdFromLabel(label: string | null): number | null {
  if (!label) return null;
  const matched = /cd\s*0*(\d+)/i.exec(label);
  if (!matched) return null;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDisplayName(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "Usuário";

  return compact
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toLocaleUpperCase("pt-BR") + chunk.slice(1))
    .join(" ");
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

function asStatusLabel(status: ColetaRow["sync_status"]): string {
  if (status === "pending_insert") return "Pendente envio";
  if (status === "pending_update") return "Pendente atualização";
  if (status === "pending_delete") return "Pendente exclusão";
  if (status === "error") return "Erro de sync";
  return "Sincronizado";
}

function asStatusClass(status: ColetaRow["sync_status"]): string {
  if (status === "synced") return "synced";
  if (status === "error") return "error";
  return "pending";
}

function safeUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatValidadeInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function parseMultiplo(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return parsed;
}

function roleIsGlobalAdmin(profile: ColetaModuleProfile): boolean {
  return profile.role === "admin" && profile.cd_default == null;
}

function fixedCdFromProfile(profile: ColetaModuleProfile): number | null {
  if (typeof profile.cd_default === "number" && Number.isFinite(profile.cd_default)) {
    return Math.trunc(profile.cd_default);
  }
  return parseCdFromLabel(profile.cd_nome);
}

function BarcodeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6v12" />
      <path d="M7 6v12" />
      <path d="M10 6v12" />
      <path d="M14 6v12" />
      <path d="M18 6v12" />
      <path d="M20 6v12" />
      <path d="M3 4h18" />
      <path d="M3 20h18" />
    </svg>
  );
}

function QuantityIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 8h12" />
      <path d="M12 4v16" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12l-8 8-9-9V4h7z" />
      <circle cx="7.5" cy="8.5" r="1" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M4 20h16" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M8 7l1 13h6l1-13" />
    </svg>
  );
}

export default function ColetaMercadoriaPage({ isOnline, profile }: ColetaMercadoriaPageProps) {
  const barcodeRef = useRef<HTMLInputElement | null>(null);
  const syncInFlightRef = useRef(false);
  const refreshInFlightRef = useRef(false);

  const [rows, setRows] = useState<ColetaRow[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [dbBarrasCount, setDbBarrasCount] = useState(0);
  const [dbBarrasLastSyncAt, setDbBarrasLastSyncAt] = useState<string | null>(null);

  const [barcodeInput, setBarcodeInput] = useState("");
  const [multiploInput, setMultiploInput] = useState("1");
  const [etiquetaFixa, setEtiquetaFixa] = useState("");
  const [ocorrenciaInput, setOcorrenciaInput] = useState<"" | "Avariado" | "Vencido">("");
  const [loteInput, setLoteInput] = useState("");
  const [validadeInput, setValidadeInput] = useState("");

  const [cdOptions, setCdOptions] = useState<CdOption[]>([]);
  const [cdAtivo, setCdAtivo] = useState<number | null>(null);

  const [busyRefresh, setBusyRefresh] = useState(false);
  const [busySync, setBusySync] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [preferencesReady, setPreferencesReady] = useState(false);

  const displayUserName = useMemo(() => toDisplayName(profile.nome), [profile.nome]);
  const isGlobalAdmin = useMemo(() => roleIsGlobalAdmin(profile), [profile]);
  const fixedCd = useMemo(() => fixedCdFromProfile(profile), [profile]);

  const visibleRows = useMemo(
    () => rows.filter((row) => row.sync_status !== "pending_delete"),
    [rows]
  );

  const refreshLocalState = useCallback(async () => {
    const [nextRows, nextPending, nextMeta] = await Promise.all([
      getUserColetaRows(profile.user_id),
      countPendingRows(profile.user_id),
      getDbBarrasMeta()
    ]);

    setRows(nextRows);
    setPendingCount(nextPending);
    setDbBarrasCount(nextMeta.row_count);
    setDbBarrasLastSyncAt(nextMeta.last_sync_at);
  }, [profile.user_id]);

  const focusBarcode = useCallback(() => {
    window.requestAnimationFrame(() => {
      barcodeRef.current?.focus();
    });
  }, []);

  const runSync = useCallback(
    async (silent = false) => {
      if (!isOnline || syncInFlightRef.current) return;

      syncInFlightRef.current = true;
      setBusySync(true);
      if (!silent) {
        setErrorMessage(null);
        setStatusMessage(null);
      }

      try {
        const result = await syncPendingColetaRows(profile.user_id);
        await refreshLocalState();
        if (!silent) {
          setStatusMessage(
            result.processed === 0
              ? "Sem pendências para sincronizar."
              : `Sincronização concluída: ${result.synced} ok, ${result.failed} com erro.`
          );
        }
      } catch (error) {
        if (!silent) {
          setErrorMessage(error instanceof Error ? error.message : "Falha ao sincronizar pendências.");
        }
      } finally {
        syncInFlightRef.current = false;
        setBusySync(false);
      }
    },
    [isOnline, profile.user_id, refreshLocalState]
  );

  const runDbBarrasRefresh = useCallback(
    async (silent = false) => {
      if (!isOnline || refreshInFlightRef.current) return;

      refreshInFlightRef.current = true;
      setBusyRefresh(true);
      if (!silent) {
        setErrorMessage(null);
        setStatusMessage(null);
      }

      try {
        const result = await refreshDbBarrasCache((pages, rowsFetched) => {
          setProgressMessage(`Atualizando base de barras... páginas ${pages} | linhas ${rowsFetched}`);
        });

        await refreshLocalState();
        if (!silent) {
          setStatusMessage(`Base de barras atualizada: ${result.rows} itens.`);
        }
      } catch (error) {
        if (!silent) {
          setErrorMessage(error instanceof Error ? error.message : "Falha ao atualizar base de barras.");
        }
      } finally {
        refreshInFlightRef.current = false;
        setProgressMessage(null);
        setBusyRefresh(false);
      }
    },
    [isOnline, refreshLocalState]
  );

  const applyRowUpdate = useCallback(
    async (row: ColetaRow, patch: Partial<ColetaRow>) => {
      const nextStatus =
        row.sync_status === "pending_insert"
          ? "pending_insert"
          : row.remote_id
            ? "pending_update"
            : "pending_insert";

      const nextRow: ColetaRow = {
        ...row,
        ...patch,
        sync_status: nextStatus,
        sync_error: null,
        updated_at: new Date().toISOString()
      };

      await upsertColetaRow(nextRow);
      await refreshLocalState();

      if (isOnline) {
        void runSync(true);
      }
    },
    [isOnline, refreshLocalState, runSync]
  );

  const deleteRow = useCallback(
    async (row: ColetaRow) => {
      if (row.remote_id) {
        await upsertColetaRow({
          ...row,
          sync_status: "pending_delete",
          sync_error: null,
          updated_at: new Date().toISOString()
        });
      } else {
        await removeColetaRow(row.local_id);
      }

      await refreshLocalState();
      if (isOnline) {
        void runSync(true);
      }
    },
    [isOnline, refreshLocalState, runSync]
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const prefs = await getColetaPreferences(profile.user_id);
      if (cancelled) return;

      setEtiquetaFixa(prefs.etiqueta_fixa || "");
      setMultiploInput(String(prefs.multiplo_padrao || 1));

      const fallbackCd = fixedCd;
      const initialCd = prefs.cd_ativo ?? fallbackCd;
      setCdAtivo(initialCd ?? null);

      await refreshLocalState();
      if (cancelled) return;

      setPreferencesReady(true);

      if (isOnline) {
        await runDbBarrasRefresh(true);
        if (!cancelled) {
          await runSync(true);
        }
      }

      focusBarcode();
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [fixedCd, focusBarcode, isOnline, profile.user_id, refreshLocalState, runDbBarrasRefresh, runSync]);

  useEffect(() => {
    if (!preferencesReady) return;

    const payloadCd = isGlobalAdmin ? cdAtivo : fixedCd;
    void saveColetaPreferences(profile.user_id, {
      etiqueta_fixa: etiquetaFixa,
      multiplo_padrao: parseMultiplo(multiploInput),
      cd_ativo: payloadCd
    });
  }, [cdAtivo, etiquetaFixa, fixedCd, isGlobalAdmin, multiploInput, preferencesReady, profile.user_id]);

  useEffect(() => {
    if (!isGlobalAdmin || !isOnline) return;

    let cancelled = false;

    const loadOptions = async () => {
      try {
        const options = await fetchCdOptions();
        if (cancelled) return;
        setCdOptions(options);

        if (options.length > 0 && (cdAtivo == null || !options.some((item) => item.cd === cdAtivo))) {
          setCdAtivo(options[0].cd);
        }
      } catch {
        if (!cancelled) {
          setCdOptions([]);
        }
      }
    };

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, [cdAtivo, isGlobalAdmin, isOnline]);

  useEffect(() => {
    if (!isOnline) return;
    void runSync(true);
  }, [isOnline, runSync]);

  useEffect(() => {
    focusBarcode();
  }, [focusBarcode]);

  const onCollect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);

    const barras = normalizeBarcode(barcodeInput);
    if (!barras) {
      setErrorMessage("Informe o código de barras.");
      focusBarcode();
      return;
    }

    if (dbBarrasCount <= 0) {
      setErrorMessage("Base de barras indisponível. Conecte-se para carregar e tente novamente.");
      focusBarcode();
      return;
    }

    const qtd = parseMultiplo(multiploInput);
    const resolvedCd = isGlobalAdmin ? cdAtivo : fixedCd;

    if (resolvedCd == null) {
      setErrorMessage("CD não definido para a coleta atual.");
      return;
    }

    let valMmaa: string | null = null;
    try {
      valMmaa = normalizeValidadeInput(validadeInput);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Validade inválida.");
      return;
    }

    const product = await getDbBarrasByBarcode(barras);
    if (!product) {
      setErrorMessage("Código de barras não encontrado na base DB_BARRAS.");
      focusBarcode();
      return;
    }

    const nowIso = new Date().toISOString();

    const row: ColetaRow = {
      local_id: safeUuid(),
      remote_id: null,
      user_id: profile.user_id,
      etiqueta: etiquetaFixa.trim() || null,
      cd: resolvedCd,
      barras: product.barras,
      coddv: product.coddv,
      descricao: product.descricao,
      qtd,
      ocorrencia: ocorrenciaInput || null,
      lote: loteInput.trim() || null,
      val_mmaa: valMmaa,
      mat_aud: profile.mat,
      nome_aud: profile.nome,
      data_hr: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
      sync_status: "pending_insert",
      sync_error: null
    };

    await upsertColetaRow(row);
    await refreshLocalState();

    setBarcodeInput("");
    setOcorrenciaInput("");
    setLoteInput("");
    setValidadeInput("");

    if (isOnline) {
      void runSync(true);
      setStatusMessage("Item coletado e enviado para sincronização.");
    } else {
      setStatusMessage("Item coletado em modo offline. Será enviado quando a conexão voltar.");
    }

    focusBarcode();
  };

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
            <span className="coleta-pending-pill" title="Linhas pendentes de envio">
              Pendentes: {pendingCount}
            </span>
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

      <section className="modules-shell coleta-shell">
        <div className="coleta-head">
          <h2>Olá, {displayUserName}</h2>
          <p>
            Scanner integrado ou digitação manual. Cada leitura gera 1 linha de coleta.
          </p>
          <p className="coleta-meta-line">
            Base local: <strong>{dbBarrasCount}</strong> itens
            {dbBarrasLastSyncAt ? ` | Atualizada em ${formatDateTime(dbBarrasLastSyncAt)}` : " | Sem atualização ainda"}
          </p>
        </div>

        {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
        {statusMessage ? <div className="alert success">{statusMessage}</div> : null}
        {progressMessage ? <div className="alert success">{progressMessage}</div> : null}

        {!isOnline && dbBarrasCount <= 0 ? (
          <div className="alert error">
            Você está offline e ainda não há cache da DB_BARRAS neste dispositivo. Conecte-se para carregar a base.
          </div>
        ) : null}

        <div className="coleta-actions-row">
          <button type="button" className="btn btn-muted" onClick={() => void runDbBarrasRefresh(false)} disabled={!isOnline || busyRefresh}>
            {busyRefresh ? "Atualizando base..." : "Atualizar DB_BARRAS"}
          </button>
          <button type="button" className="btn btn-primary coleta-sync-btn" onClick={() => void runSync(false)} disabled={!isOnline || busySync}>
            <span aria-hidden="true"><UploadIcon /></span>
            {busySync ? "Sincronizando..." : "Sincronizar agora"}
          </button>
        </div>

        <form className="coleta-form" onSubmit={onCollect}>
          <div className="coleta-form-grid">
            <label>
              Código de barras
              <div className="input-icon-wrap">
                <span className="field-icon" aria-hidden="true">
                  <BarcodeIcon />
                </span>
                <input
                  ref={barcodeRef}
                  type="text"
                  value={barcodeInput}
                  onChange={(event) => setBarcodeInput(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  placeholder="Bipe ou digite e pressione Enter"
                  required
                />
              </div>
            </label>

            <label>
              Múltiplo
              <div className="input-icon-wrap">
                <span className="field-icon" aria-hidden="true">
                  <QuantityIcon />
                </span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={multiploInput}
                  onChange={(event) => setMultiploInput(event.target.value)}
                />
              </div>
            </label>

            <label>
              Etiqueta fixa
              <div className="input-icon-wrap">
                <span className="field-icon" aria-hidden="true">
                  <TagIcon />
                </span>
                <input
                  type="text"
                  value={etiquetaFixa}
                  onChange={(event) => setEtiquetaFixa(event.target.value)}
                  placeholder="Opcional (fica salvo até limpar)"
                />
              </div>
            </label>

            {isGlobalAdmin ? (
              <label>
                CD ativo
                <select value={cdAtivo ?? ""} onChange={(event) => setCdAtivo(Number.parseInt(event.target.value, 10))} required>
                  <option value="" disabled>Selecione o CD</option>
                  {cdOptions.map((option) => (
                    <option key={option.cd} value={option.cd}>
                      {option.cd_nome}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                CD ativo
                <input type="text" value={fixedCd != null ? `CD ${String(fixedCd).padStart(2, "0")}` : "CD não definido"} disabled />
              </label>
            )}

            <label>
              Ocorrência
              <select value={ocorrenciaInput} onChange={(event) => setOcorrenciaInput(event.target.value as "" | "Avariado" | "Vencido") }>
                <option value="">Sem ocorrência</option>
                <option value="Avariado">Avariado</option>
                <option value="Vencido">Vencido</option>
              </select>
            </label>

            <label>
              Lote
              <input type="text" value={loteInput} onChange={(event) => setLoteInput(event.target.value)} placeholder="Opcional" />
            </label>

            <label>
              Validade (MM/AA)
              <input
                type="text"
                inputMode="numeric"
                value={validadeInput}
                onChange={(event) => setValidadeInput(formatValidadeInput(event.target.value))}
                placeholder="MM/AA"
                maxLength={5}
              />
            </label>
          </div>

          <button className="btn btn-primary coleta-submit" type="submit" disabled={dbBarrasCount <= 0}>
            Salvar coleta
          </button>
        </form>

        <div className="coleta-list-head">
          <h3>Coletas registradas</h3>
          <span>{visibleRows.length} itens</span>
        </div>

        <div className="coleta-list">
          {visibleRows.length === 0 ? (
            <div className="coleta-empty">Nenhuma coleta registrada ainda.</div>
          ) : (
            visibleRows.map((row) => (
              <article key={row.local_id} className="coleta-row-card">
                <div className="coleta-row-main">
                  <div>
                    <strong>{row.descricao}</strong>
                    <p>
                      Barras: {row.barras} | CODDV: {row.coddv}
                    </p>
                    <p>
                      CD {String(row.cd).padStart(2, "0")} | Coletado em {formatDateTime(row.data_hr)}
                    </p>
                  </div>

                  <span className={`coleta-row-status ${asStatusClass(row.sync_status)}`} title={row.sync_error ?? undefined}>
                    {asStatusLabel(row.sync_status)}
                  </span>
                </div>

                <div className="coleta-row-edit-grid">
                  <label>
                    Qtd
                    <input
                      type="number"
                      min={1}
                      defaultValue={row.qtd}
                      onBlur={(event) => {
                        const nextValue = parseMultiplo(event.target.value);
                        if (nextValue !== row.qtd) {
                          void applyRowUpdate(row, { qtd: nextValue });
                        }
                      }}
                    />
                  </label>

                  <label>
                    Etiqueta
                    <input
                      type="text"
                      defaultValue={row.etiqueta ?? ""}
                      onBlur={(event) => {
                        const nextValue = event.target.value.trim() || null;
                        if (nextValue !== row.etiqueta) {
                          void applyRowUpdate(row, { etiqueta: nextValue });
                        }
                      }}
                    />
                  </label>

                  <label>
                    Ocorrência
                    <select
                      value={row.ocorrencia ?? ""}
                      onChange={(event) => {
                        const next = event.target.value as "" | "Avariado" | "Vencido";
                        void applyRowUpdate(row, { ocorrencia: next || null });
                      }}
                    >
                      <option value="">Sem ocorrência</option>
                      <option value="Avariado">Avariado</option>
                      <option value="Vencido">Vencido</option>
                    </select>
                  </label>

                  <label>
                    Lote
                    <input
                      type="text"
                      defaultValue={row.lote ?? ""}
                      onBlur={(event) => {
                        const nextValue = event.target.value.trim() || null;
                        if (nextValue !== row.lote) {
                          void applyRowUpdate(row, { lote: nextValue });
                        }
                      }}
                    />
                  </label>

                  <label>
                    Validade
                    <input
                      type="text"
                      inputMode="numeric"
                      defaultValue={formatValidade(row.val_mmaa)}
                      maxLength={5}
                      onBlur={(event) => {
                        try {
                          const nextValue = normalizeValidadeInput(event.target.value);
                          if (nextValue !== row.val_mmaa) {
                            void applyRowUpdate(row, { val_mmaa: nextValue });
                          }
                        } catch (error) {
                          setErrorMessage(error instanceof Error ? error.message : "Validade inválida.");
                        }
                      }}
                    />
                  </label>
                </div>

                <div className="coleta-row-footer">
                  <span>
                    Auditor: {row.nome_aud} ({row.mat_aud})
                  </span>
                  <button className="btn btn-muted coleta-delete-btn" type="button" onClick={() => void deleteRow(row)}>
                    <span aria-hidden="true"><TrashIcon /></span>
                    Excluir
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </>
  );
}
