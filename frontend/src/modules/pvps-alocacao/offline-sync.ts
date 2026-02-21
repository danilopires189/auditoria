import {
  fetchPvpsManifest,
  registerOfflineDiscard,
  submitAlocacao,
  submitPvpsPul,
  submitPvpsSep
} from "./sync";
import {
  listPendingOfflineEvents,
  removeOfflineEvent,
  updateOfflineEventStatus
} from "./storage";
import type {
  PvpsAlocOfflineEventRow,
  PvpsEndSit,
  PvpsOfflineSyncResult
} from "./types";

function sepKey(cd: number, coddv: number, endSep: string): string {
  return `${Math.trunc(cd)}|${Math.trunc(coddv)}|${endSep.trim().toUpperCase()}`;
}

function normalizeEventEndSit(value: string | null): PvpsEndSit | null {
  return value === "vazio" || value === "obstruido" ? value : null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Erro inesperado ao sincronizar offline.";
}

function extractConflictCode(rawMessage: string): string | null {
  const upper = rawMessage.toUpperCase();
  if (upper.includes("ITEM_PVPS_AUDITADO_POR_OUTRO_USUARIO")) return "ITEM_PVPS_AUDITADO_POR_OUTRO_USUARIO";
  if (upper.includes("ITEM_ALOCACAO_AUDITADO_POR_OUTRO_USUARIO")) return "ITEM_ALOCACAO_AUDITADO_POR_OUTRO_USUARIO";
  if (upper.includes("ITEM_PVPS_AUDITADO_PELO_USUARIO")) return "ITEM_PVPS_AUDITADO_PELO_USUARIO";
  if (upper.includes("ITEM_ALOCACAO_AUDITADO_PELO_USUARIO")) return "ITEM_ALOCACAO_AUDITADO_PELO_USUARIO";
  return null;
}

function isOtherUserConflict(code: string | null): boolean {
  return code === "ITEM_PVPS_AUDITADO_POR_OUTRO_USUARIO" || code === "ITEM_ALOCACAO_AUDITADO_POR_OUTRO_USUARIO";
}

function isSameUserReplay(code: string | null): boolean {
  return code === "ITEM_PVPS_AUDITADO_PELO_USUARIO" || code === "ITEM_ALOCACAO_AUDITADO_PELO_USUARIO";
}

async function resolveAuditIdFromServer(event: PvpsAlocOfflineEventRow): Promise<string | null> {
  if (!event.end_sep) return null;
  const rows = await fetchPvpsManifest({ p_cd: event.cd, zona: null });
  return rows.find(
    (row) => row.coddv === event.coddv && row.end_sep.toUpperCase() === event.end_sep!.toUpperCase()
  )?.audit_id ?? null;
}

async function registerDiscard(event: PvpsAlocOfflineEventRow, conflictReason: string): Promise<void> {
  await registerOfflineDiscard({
    p_cd: event.cd,
    modulo: event.kind === "alocacao" ? "alocacao" : "pvps",
    event_kind: event.kind,
    local_event_id: event.event_id,
    local_event_created_at: event.created_at,
    local_payload: {
      kind: event.kind,
      coddv: event.coddv,
      zona: event.zona,
      end_sep: event.end_sep,
      end_pul: event.end_pul,
      queue_id: event.queue_id,
      end_sit: event.end_sit,
      val_sep: event.val_sep,
      val_pul: event.val_pul,
      val_conf: event.val_conf,
      audit_id: event.audit_id
    },
    coddv: event.coddv,
    zona: event.zona,
    end_sep: event.end_sep,
    end_pul: event.end_pul,
    queue_id: event.queue_id,
    conflict_reason: conflictReason
  });
}

export async function syncPvpsOfflineQueue(params: {
  user_id: string;
  cd: number;
}): Promise<PvpsOfflineSyncResult> {
  const events = await listPendingOfflineEvents(params.user_id, params.cd);
  if (!events.length) {
    return { synced: 0, failed: 0, discarded: 0, remaining: 0, conflicts: 0 };
  }

  const auditBySep = new Map<string, string>();
  let synced = 0;
  let failed = 0;
  let discarded = 0;
  let conflicts = 0;

  for (const event of events) {
    try {
      if (event.kind === "sep") {
        if (!event.end_sep) {
          throw new Error("EVENTO_SEP_INVALIDO: END_SEP ausente.");
        }
        const result = await submitPvpsSep({
          p_cd: event.cd,
          coddv: event.coddv,
          end_sep: event.end_sep,
          end_sit: normalizeEventEndSit(event.end_sit),
          val_sep: event.val_sep ?? null
        });
        auditBySep.set(sepKey(event.cd, event.coddv, event.end_sep), result.audit_id);
      } else if (event.kind === "pul") {
        if (!event.end_sep || !event.end_pul) {
          throw new Error("EVENTO_PUL_INVALIDO: END_SEP/END_PUL ausentes.");
        }
        const key = sepKey(event.cd, event.coddv, event.end_sep);
        let auditId = event.audit_id ?? auditBySep.get(key) ?? null;
        if (!auditId) {
          auditId = await resolveAuditIdFromServer(event);
        }
        if (!auditId) {
          throw new Error("AUDIT_ID_PVPS_NAO_DISPONIVEL para sincronizar Pulmão.");
        }

        const endSit = normalizeEventEndSit(event.end_sit);
        const valPul = (event.val_pul ?? "").trim();
        if (!endSit && valPul.length !== 4) {
          throw new Error("VAL_PUL_INVALIDA_OFFLINE: informe validade MMAA ou ocorrência.");
        }

        await submitPvpsPul({
          p_cd: event.cd,
          audit_id: auditId,
          end_pul: event.end_pul,
          end_sit: endSit,
          val_pul: endSit ? null : valPul
        });
      } else {
        if (!event.queue_id) {
          throw new Error("EVENTO_ALOCACAO_INVALIDO: QUEUE_ID ausente.");
        }
        const endSit = normalizeEventEndSit(event.end_sit);
        const valConf = (event.val_conf ?? "").trim();
        if (!endSit && valConf.length !== 4) {
          throw new Error("VAL_CONF_INVALIDA_OFFLINE: informe validade MMAA ou ocorrência.");
        }
        await submitAlocacao({
          p_cd: event.cd,
          queue_id: event.queue_id,
          end_sit: endSit,
          val_conf: endSit ? null : valConf
        });
      }

      await removeOfflineEvent(event.event_id);
      synced += 1;
    } catch (error) {
      const message = toErrorMessage(error);
      const code = extractConflictCode(message);

      if (isOtherUserConflict(code)) {
        try {
          await registerDiscard(event, code ?? "CONFLICT_OTHER_USER");
        } finally {
          await removeOfflineEvent(event.event_id);
        }
        discarded += 1;
        conflicts += 1;
        continue;
      }

      if (isSameUserReplay(code)) {
        await removeOfflineEvent(event.event_id);
        synced += 1;
        continue;
      }

      failed += 1;
      await updateOfflineEventStatus({
        event_id: event.event_id,
        status: "error",
        error_message: message,
        increment_attempt: true
      });
    }
  }

  const remaining = (await listPendingOfflineEvents(params.user_id, params.cd)).length;
  return { synced, failed, discarded, remaining, conflicts };
}
