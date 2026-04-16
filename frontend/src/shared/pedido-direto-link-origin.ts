import type { PedidoDiretoLinkOrigin } from "../modules/conferencia-pedido-direto/types";

export const DEFAULT_PEDIDO_DIRETO_LINK_ORIGIN: PedidoDiretoLinkOrigin = "prevencaocd";

const HOSTNAME_TO_PEDIDO_DIRETO_LINK_ORIGIN: Record<string, PedidoDiretoLinkOrigin> = {
  "prevencaocd.vercel.app": "prevencaocd",
  "www.prevencaocd.vercel.app": "prevencaocd",
  "prevencaocds.vercel.app": "prevencaocd",
  "www.prevencaocds.vercel.app": "prevencaocd",
  "logisticacd.vercel.app": "logisticacd"
};

export function normalizePedidoDiretoLinkOrigin(value: string | null | undefined): PedidoDiretoLinkOrigin {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "logisticacd") return "logisticacd";
  return "prevencaocd";
}

export function resolvePedidoDiretoLinkOrigin(hostname: string | null | undefined): PedidoDiretoLinkOrigin {
  const normalized = hostname?.trim().toLowerCase();
  if (!normalized) return DEFAULT_PEDIDO_DIRETO_LINK_ORIGIN;
  return HOSTNAME_TO_PEDIDO_DIRETO_LINK_ORIGIN[normalized] ?? DEFAULT_PEDIDO_DIRETO_LINK_ORIGIN;
}

export function resolvePedidoDiretoLinkOriginFromWindow(): PedidoDiretoLinkOrigin {
  if (typeof window === "undefined") return DEFAULT_PEDIDO_DIRETO_LINK_ORIGIN;
  return resolvePedidoDiretoLinkOrigin(window.location.hostname);
}
