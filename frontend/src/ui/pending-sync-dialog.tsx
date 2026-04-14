import { createPortal } from "react-dom";

export interface PendingSyncDialogItem {
  id: string;
  title: string;
  subtitle?: string | null;
  detail?: string | null;
  error?: string | null;
  updatedAt?: string | null;
  discardLabel?: string;
  onDiscard?: () => void;
}

interface PendingSyncDialogProps {
  isOpen: boolean;
  title: string;
  items: PendingSyncDialogItem[];
  emptyText?: string;
  busy?: boolean;
  onClose: () => void;
  onDiscardAll?: () => void;
}

export function PendingSyncDialog({
  isOpen,
  title,
  items,
  emptyText = "Não há pendências locais para este módulo.",
  busy = false,
  onClose,
  onDiscardAll
}: PendingSyncDialogProps) {
  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="pending-sync-dialog-title" onClick={onClose}>
      <div className="confirm-dialog termo-routes-dialog surface-enter" onClick={(event) => event.stopPropagation()}>
        <h3 id="pending-sync-dialog-title">{title}</h3>
        {items.length === 0 ? (
          <p>{emptyText}</p>
        ) : (
          <div className="termo-routes-list">
            {items.map((item) => (
              <div key={item.id} className="termo-route-group">
                <div className="termo-item-detail">
                  <p><strong>{item.title}</strong></p>
                  {item.subtitle ? <p>{item.subtitle}</p> : null}
                  {item.detail ? <p>{item.detail}</p> : null}
                  {item.error ? <p className="termo-inline-note">Erro: {item.error}</p> : null}
                  {item.updatedAt ? <p>Última alteração: {item.updatedAt}</p> : null}
                  {item.onDiscard ? (
                    <div className="confirm-actions">
                      <button className="btn btn-muted termo-danger-btn" type="button" disabled={busy} onClick={item.onDiscard}>
                        {item.discardLabel ?? "Descartar"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="confirm-actions">
          <button className="btn btn-muted" type="button" onClick={onClose} disabled={busy}>Fechar</button>
          {onDiscardAll ? (
            <button className="btn btn-primary termo-danger-btn" type="button" onClick={onDiscardAll} disabled={busy || items.length === 0}>
              {busy ? "Descartando..." : "Descartar tudo"}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
