import {
  fetchPvpsManifest,
  submitPvpsPul,
  submitPvpsSep
} from "./sync";
import {
  deleteOfflinePvpsEvent,
  listOfflinePvpsEvents,
  type PvpsOfflineEventRow
} from "./storage";

function sepKey(cd: number, coddv: number, endSep: string): string {
  return `${Math.trunc(cd)}|${Math.trunc(coddv)}|${endSep.trim().toUpperCase()}`;
}

async function resolveAuditIdFromServer(event: PvpsOfflineEventRow): Promise<string | null> {
  const rows = await fetchPvpsManifest({ p_cd: event.cd, zona: null });
  return rows.find(
    (row) => row.coddv === event.coddv && row.end_sep.toUpperCase() === event.end_sep.toUpperCase()
  )?.audit_id ?? null;
}

export interface PvpsOfflineSyncResult {
  synced: number;
  failed: number;
  remaining: number;
}

export async function syncPvpsOfflineQueue(cd: number): Promise<PvpsOfflineSyncResult> {
  const events = (await listOfflinePvpsEvents()).filter((item) => item.cd === Math.trunc(cd));
  if (!events.length) {
    return { synced: 0, failed: 0, remaining: 0 };
  }

  const auditBySep = new Map<string, string>();
  let synced = 0;
  let failed = 0;

  for (const event of events) {
    try {
      if (event.kind === "sep") {
        const result = await submitPvpsSep({
          p_cd: event.cd,
          coddv: event.coddv,
          end_sep: event.end_sep,
          end_sit: event.end_sit === "vazio" || event.end_sit === "obstruido" ? event.end_sit : null,
          val_sep: event.val_sep ?? null
        });
        auditBySep.set(sepKey(event.cd, event.coddv, event.end_sep), result.audit_id);
      } else {
        const key = sepKey(event.cd, event.coddv, event.end_sep);
        let auditId = event.audit_id ?? auditBySep.get(key) ?? null;
        if (!auditId) {
          auditId = await resolveAuditIdFromServer(event);
        }
        if (!auditId) {
          failed += 1;
          continue;
        }
        const endSit = event.end_sit === "vazio" || event.end_sit === "obstruido" ? event.end_sit : null;
        const valPul = (event.val_pul ?? "").trim();
        if (!endSit && valPul.length !== 4) {
          failed += 1;
          continue;
        }
        await submitPvpsPul({
          p_cd: event.cd,
          audit_id: auditId,
          end_pul: event.end_pul ?? "",
          end_sit: endSit,
          val_pul: endSit ? null : valPul
        });
      }
      await deleteOfflinePvpsEvent(event.event_id);
      synced += 1;
    } catch {
      failed += 1;
    }
  }

  const remaining = (await listOfflinePvpsEvents()).filter((item) => item.cd === Math.trunc(cd)).length;
  return { synced, failed, remaining };
}
