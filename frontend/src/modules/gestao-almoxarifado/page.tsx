import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { BackIcon, ModuleIcon } from "../../ui/icons";
import { formatDateTimeBrasilia } from "../../shared/brasilia-datetime";
import { getModuleByKeyOrThrow } from "../registry";
import type {
  AlmoxNfExtractedItem,
  AlmoxNfExtraction,
  AlmoxNfValidationRow,
  AlmoxProduto,
  AlmoxSolicitacao,
  AlmoxSolicitacaoItemDraft,
  AlmoxSolicitacaoTipo,
  GestaoAlmoxarifadoModuleProfile
} from "./types";
import {
  adjustAlmoxInventario,
  applyAlmoxNfImport,
  createAlmoxSolicitacao,
  decideAlmoxSolicitacao,
  extractAlmoxNfPdf,
  listAlmoxMovimentos,
  listAlmoxNfImports,
  listAlmoxProdutos,
  listAlmoxSolicitacoes,
  saveAlmoxNfImport,
  saveAlmoxProduto,
  toAlmoxErrorMessage,
  validateAlmoxNfItems
} from "./sync";
import type { AlmoxMovimento, AlmoxNfImport } from "./types";

interface Props {
  isOnline: boolean;
  profile: GestaoAlmoxarifadoModuleProfile;
}

type TabKey = "produtos" | "inventario" | "compra" | "retirada" | "aprovacoes" | "minhas" | "notas" | "relatorios";

const MODULE_DEF = getModuleByKeyOrThrow("gestao-almoxarifado");
const EMPTY_PRODUCT = { produtoId: null as string | null, codigo: "", descricao: "", marca: "", tamanho: "" };

function isGlobalAdmin(profile: GestaoAlmoxarifadoModuleProfile): boolean {
  return profile.role === "admin" && profile.cd_default == null;
}

function formatCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

function formatDateTime(value: string | null | undefined): string {
  return formatDateTimeBrasilia(value ?? "", { emptyFallback: "-", invalidFallback: "-" });
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

function ProductLabel({ product }: { product: AlmoxProduto }) {
  return (
    <>
      <strong>{product.codigo}</strong>
      <span>{product.descricao}</span>
      <small>{product.marca}{product.tamanho ? ` | ${product.tamanho}` : ""}</small>
    </>
  );
}

function SolicitationCard({
  row,
  showActions,
  busy,
  onApprove,
  onReject
}: {
  row: AlmoxSolicitacao;
  showActions?: boolean;
  busy?: boolean;
  onApprove?: (row: AlmoxSolicitacao) => void;
  onReject?: (row: AlmoxSolicitacao) => void;
}) {
  return (
    <article className={`almox-card almox-solic-card status-${row.status}`}>
      <div className="almox-card-head">
        <div>
          <span className="almox-chip">{row.tipo === "compra" ? "Compra" : "Retirada"}</span>
          <h3>{row.solicitante_nome}</h3>
          <p>{row.solicitante_mat} | {formatDateTime(row.created_at)}</p>
        </div>
        <div className="almox-card-kpi">
          <span>{row.status}</span>
          <strong>{formatCurrency(row.total_valor)}</strong>
        </div>
      </div>
      {row.motivo ? <p className="almox-note">{row.motivo}</p> : null}
      <div className="almox-items">
        {row.itens.map((item) => (
          <div key={item.item_id} className="almox-item-line">
            <span>{item.codigo} | {item.descricao}</span>
            <strong>{item.quantidade} un | {formatCurrency(item.valor_total)}</strong>
            <small>Estoque: {item.estoque_snapshot} | Unit.: {formatCurrency(item.valor_unitario)}</small>
          </div>
        ))}
      </div>
      {row.decisao_observacao ? <p className="almox-note">Decisão: {row.decisao_observacao}</p> : null}
      {showActions ? (
        <div className="almox-actions">
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => onApprove?.(row)}>Aprovar</button>
          <button className="btn btn-muted" type="button" disabled={busy} onClick={() => onReject?.(row)}>Reprovar</button>
        </div>
      ) : null}
    </article>
  );
}

export default function GestaoAlmoxarifadoPage({ isOnline, profile }: Props) {
  const globalAdmin = isGlobalAdmin(profile);
  const canRequest = profile.role === "admin";
  const [activeTab, setActiveTab] = useState<TabKey>("produtos");
  const [produtos, setProdutos] = useState<AlmoxProduto[]>([]);
  const [produtoSearch, setProdutoSearch] = useState("");
  const [productDraft, setProductDraft] = useState(EMPTY_PRODUCT);
  const [inventoryDraft, setInventoryDraft] = useState({ produtoId: "", estoque: "", observacao: "" });
  const [requestTipo, setRequestTipo] = useState<AlmoxSolicitacaoTipo>("compra");
  const [requestMotivo, setRequestMotivo] = useState("");
  const [requestCode, setRequestCode] = useState("");
  const [requestQty, setRequestQty] = useState("");
  const [requestItems, setRequestItems] = useState<AlmoxSolicitacaoItemDraft[]>([]);
  const [minhas, setMinhas] = useState<AlmoxSolicitacao[]>([]);
  const [pendentes, setPendentes] = useState<AlmoxSolicitacao[]>([]);
  const [todas, setTodas] = useState<AlmoxSolicitacao[]>([]);
  const [movimentos, setMovimentos] = useState<AlmoxMovimento[]>([]);
  const [nfImports, setNfImports] = useState<AlmoxNfImport[]>([]);
  const [nfExtraction, setNfExtraction] = useState<AlmoxNfExtraction | null>(null);
  const [nfValidation, setNfValidation] = useState<AlmoxNfValidationRow[]>([]);
  const [nfImportId, setNfImportId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const productByCode = useMemo(() => new Map(produtos.map((product) => [product.codigo, product])), [produtos]);
  const selectedInventoryProduct = produtos.find((product) => product.produto_id === inventoryDraft.produtoId) ?? null;
  const requestTotal = useMemo(() => requestItems.reduce((sum, item) => {
    const product = productByCode.get(normalizeCode(item.codigo));
    return sum + item.quantidade * (product?.ultimo_custo ?? 0);
  }, 0), [productByCode, requestItems]);

  const loadCore = useCallback(async () => {
    const [productRows, myRows] = await Promise.all([
      listAlmoxProdutos(produtoSearch),
      listAlmoxSolicitacoes({ scope: "minhas", tipo: "todas" })
    ]);
    setProdutos(productRows);
    setMinhas(myRows);
    if (globalAdmin) {
      const [pendingRows, allRows, movRows, nfRows] = await Promise.all([
        listAlmoxSolicitacoes({ scope: "pendentes", tipo: "todas" }),
        listAlmoxSolicitacoes({ scope: "todas", tipo: "todas" }),
        listAlmoxMovimentos(),
        listAlmoxNfImports()
      ]);
      setPendentes(pendingRows);
      setTodas(allRows);
      setMovimentos(movRows);
      setNfImports(nfRows);
    }
  }, [globalAdmin, produtoSearch]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setErrorMessage(null);
    void loadCore()
      .catch((error) => {
        if (!cancelled) setErrorMessage(toAlmoxErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => { cancelled = true; };
  }, [loadCore]);

  const run = useCallback(async (action: () => Promise<void>, success?: string) => {
    setBusy(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await action();
      await loadCore();
      if (success) setStatusMessage(success);
    } catch (error) {
      setErrorMessage(toAlmoxErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [loadCore]);

  const submitProduct = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await saveAlmoxProduto({
        produtoId: productDraft.produtoId,
        codigo: productDraft.codigo,
        descricao: productDraft.descricao,
        marca: productDraft.marca,
        tamanho: productDraft.tamanho || null
      });
      setProductDraft(EMPTY_PRODUCT);
    }, "Produto salvo.");
  };

  const submitInventory = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await adjustAlmoxInventario({
        produtoId: inventoryDraft.produtoId,
        estoqueAtual: Number.parseInt(inventoryDraft.estoque, 10),
        observacao: inventoryDraft.observacao || null
      });
      setInventoryDraft({ produtoId: "", estoque: "", observacao: "" });
    }, "Estoque ajustado.");
  };

  const addRequestItem = () => {
    const rawSearch = requestCode.trim();
    const directCode = normalizeCode(rawSearch);
    const matchedByText = produtos.find((product) =>
      product.codigo === directCode
      || product.descricao.toLowerCase().includes(rawSearch.toLowerCase())
    );
    const codigo = matchedByText?.codigo ?? directCode;
    const quantidade = Number.parseInt(requestQty, 10);
    if (!codigo || !Number.isFinite(quantidade) || quantidade <= 0) {
      setErrorMessage("Informe produto e quantidade.");
      return;
    }
    if (!productByCode.has(codigo)) {
      setErrorMessage("Produto não cadastrado.");
      return;
    }
    setRequestItems((current) => {
      const existing = current.find((item) => normalizeCode(item.codigo) === codigo);
      if (existing) {
        return current.map((item) => normalizeCode(item.codigo) === codigo ? { ...item, quantidade: item.quantidade + quantidade } : item);
      }
      return [...current, { codigo, quantidade }];
    });
    setRequestCode("");
    setRequestQty("");
    setErrorMessage(null);
  };

  const submitRequest = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await createAlmoxSolicitacao({ tipo: requestTipo, motivo: requestMotivo || null, itens: requestItems });
      setRequestItems([]);
      setRequestMotivo("");
    }, "Solicitação criada.");
  };

  const decide = (row: AlmoxSolicitacao, approve: boolean) => {
    const observacao = window.prompt(approve ? "Observação da aprovação (opcional)" : "Motivo da reprovação (opcional)") ?? "";
    void run(async () => {
      await decideAlmoxSolicitacao({ solicitacaoId: row.solicitacao_id, approve, observacao });
    }, approve ? "Solicitação aprovada." : "Solicitação reprovada.");
  };

  const onPdfChange = (file: File | null) => {
    if (!file) return;
    void run(async () => {
      const extracted = await extractAlmoxNfPdf(file);
      const validation = await validateAlmoxNfItems(extracted);
      const saved = await saveAlmoxNfImport(extracted);
      setNfExtraction(extracted);
      setNfValidation(validation);
      setNfImportId(saved.import_id);
    }, "Nota extraída. Valide antes de aplicar.");
  };

  const updateNfItem = (index: number, patch: Partial<AlmoxNfExtractedItem>) => {
    setNfExtraction((current) => {
      if (!current) return current;
      const itens = current.itens.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item);
      return { ...current, itens };
    });
  };

  const revalidateNf = () => {
    if (!nfExtraction) return;
    void run(async () => {
      setNfValidation(await validateAlmoxNfItems(nfExtraction));
    }, "Itens revalidados.");
  };

  const applyNf = () => {
    if (!nfExtraction || !nfImportId) return;
    void run(async () => {
      await applyAlmoxNfImport(nfImportId, nfExtraction);
      setNfExtraction(null);
      setNfValidation([]);
      setNfImportId(null);
    }, "Nota aplicada ao estoque.");
  };

  const exportReports = () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(todas.map((row) => ({
      Tipo: row.tipo,
      Status: row.status,
      Solicitante: row.solicitante_nome,
      Matricula: row.solicitante_mat,
      CriadaEm: formatDateTime(row.created_at),
      Total: row.total_valor
    }))), "Solicitacoes");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(movimentos.map((row) => ({
      Tipo: row.tipo,
      Codigo: row.codigo,
      Descricao: row.descricao,
      Qtd: row.quantidade_delta,
      EstoqueAntes: row.estoque_antes,
      EstoqueDepois: row.estoque_depois,
      ValorUnitario: row.valor_unitario,
      ValorTotal: row.valor_total,
      Usuario: row.actor_nome,
      Data: formatDateTime(row.created_at)
    }))), "Movimentos");
    XLSX.writeFile(workbook, "relatorio-gestao-almoxarifado.xlsx", { compression: true });
  };

  const allTabs: Array<{ key: TabKey; label: string; adminOnly?: boolean }> = [
    { key: "produtos", label: "Produtos" },
    { key: "inventario", label: "Inventário", adminOnly: true },
    { key: "compra", label: "Solicitar compra" },
    { key: "retirada", label: "Solicitar retirada" },
    { key: "aprovacoes", label: "Aprovações", adminOnly: true },
    { key: "minhas", label: "Minhas solicitações" },
    { key: "notas", label: "Notas fiscais", adminOnly: true },
    { key: "relatorios", label: "Relatórios", adminOnly: true }
  ];
  const tabs = allTabs.filter((tab) => !tab.adminOnly || globalAdmin);

  useEffect(() => {
    if (activeTab === "compra") setRequestTipo("compra");
    if (activeTab === "retirada") setRequestTipo("retirada");
  }, [activeTab]);

  return (
    <section className="modules-shell clv-shell almox-shell">
      <div className="module-header">
        <div>
          <Link to="/inicio" className="back-link"><BackIcon /> Voltar</Link>
          <span className="module-title clv-module-title">
            <span className="module-title-icon"><ModuleIcon name={MODULE_DEF.icon} /></span>
            {MODULE_DEF.title}
          </span>
          <p>{globalAdmin ? "Admin Global" : "Admin"} | {isOnline ? "Online" : "Offline"}</p>
        </div>
        <button type="button" className="btn btn-muted" onClick={() => void run(loadCore)} disabled={busy}>Atualizar</button>
      </div>

      <div className="almox-tabs">
        {tabs.map((tab) => (
          <button key={tab.key} type="button" className={`almox-tab${activeTab === tab.key ? " is-active" : ""}`} onClick={() => setActiveTab(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
      {statusMessage ? <div className="alert success">{statusMessage}</div> : null}

      {activeTab === "produtos" ? (
        <div className="almox-grid">
          <section className="coleta-form almox-panel">
            <h3>Cadastro de produtos</h3>
            {globalAdmin ? (
              <form onSubmit={submitProduct} className="almox-form">
                <input placeholder="Código" value={productDraft.codigo} onChange={(event) => setProductDraft({ ...productDraft, codigo: event.target.value })} required />
                <input placeholder="Descrição" value={productDraft.descricao} onChange={(event) => setProductDraft({ ...productDraft, descricao: event.target.value })} required />
                <input placeholder="Marca" value={productDraft.marca} onChange={(event) => setProductDraft({ ...productDraft, marca: event.target.value })} required />
                <input placeholder="Tamanho (opcional)" value={productDraft.tamanho} onChange={(event) => setProductDraft({ ...productDraft, tamanho: event.target.value })} />
                <button className="btn btn-primary" type="submit" disabled={busy}>Salvar</button>
              </form>
            ) : <p className="almox-note">Cadastro restrito ao Admin Global.</p>}
          </section>
          <section className="coleta-form almox-panel">
            <div className="almox-panel-head">
              <h3>Produtos cadastrados</h3>
              <input placeholder="Buscar" value={produtoSearch} onChange={(event) => setProdutoSearch(event.target.value)} />
            </div>
            <div className="almox-list">
              {produtos.map((product) => (
                <article key={product.produto_id} className="almox-product-row">
                  <ProductLabel product={product} />
                  <div>
                    <b>{product.estoque_atual}</b>
                    <small>{formatCurrency(product.ultimo_custo)}</small>
                  </div>
                  {globalAdmin ? <button type="button" className="btn btn-muted" onClick={() => setProductDraft({ produtoId: product.produto_id, codigo: product.codigo, descricao: product.descricao, marca: product.marca, tamanho: product.tamanho ?? "" })}>Editar</button> : null}
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "inventario" ? (
        <section className="coleta-form almox-panel">
          <h3>Inventário</h3>
          <form onSubmit={submitInventory} className="almox-form">
            <select value={inventoryDraft.produtoId} onChange={(event) => {
              const product = produtos.find((item) => item.produto_id === event.target.value);
              setInventoryDraft({ ...inventoryDraft, produtoId: event.target.value, estoque: product ? String(product.estoque_atual) : "" });
            }} required>
              <option value="">Selecione produto</option>
              {produtos.map((product) => <option key={product.produto_id} value={product.produto_id}>{product.codigo} | {product.descricao}</option>)}
            </select>
            <input placeholder="Estoque atual" inputMode="numeric" value={inventoryDraft.estoque} onChange={(event) => setInventoryDraft({ ...inventoryDraft, estoque: event.target.value.replace(/\D/g, "") })} required />
            <input placeholder="Observação" value={inventoryDraft.observacao} onChange={(event) => setInventoryDraft({ ...inventoryDraft, observacao: event.target.value })} />
            <button className="btn btn-primary" type="submit" disabled={busy}>Aplicar inventário</button>
          </form>
          {selectedInventoryProduct ? <p className="almox-note">Atual: {selectedInventoryProduct.estoque_atual} | Último custo: {formatCurrency(selectedInventoryProduct.ultimo_custo)}</p> : null}
        </section>
      ) : null}

      {(activeTab === "compra" || activeTab === "retirada") ? (
        <section className="coleta-form almox-panel">
          <h3>{activeTab === "compra" ? "Solicitação de compra" : "Solicitação de retirada"}</h3>
          {!canRequest ? <div className="alert warning">Solicitações liberadas para administradores.</div> : null}
          <form onSubmit={submitRequest} className="almox-request-form">
            <div className="almox-request-entry">
              <input list="almox-products" placeholder="Buscar por descrição ou código" value={requestCode} onChange={(event) => setRequestCode(event.target.value)} />
              <input placeholder="Qtd" inputMode="numeric" value={requestQty} onChange={(event) => setRequestQty(event.target.value.replace(/\D/g, ""))} />
              <button className="btn btn-muted" type="button" onClick={addRequestItem}>Adicionar</button>
            </div>
            <datalist id="almox-products">
              {produtos.map((product) => <option key={product.produto_id} value={product.codigo}>{product.descricao} | estoque {product.estoque_atual}</option>)}
            </datalist>
            <textarea placeholder="Motivo/observação" value={requestMotivo} onChange={(event) => setRequestMotivo(event.target.value)} />
            <div className="almox-items">
              {requestItems.map((item) => {
                const product = productByCode.get(normalizeCode(item.codigo));
                return (
                  <div key={item.codigo} className="almox-item-line">
                    <span>{item.codigo} | {product?.descricao ?? "Produto"}</span>
                    <strong>{item.quantidade} un | {formatCurrency(item.quantidade * (product?.ultimo_custo ?? 0))}</strong>
                    <small>Estoque atual: {product?.estoque_atual ?? 0} | Unit.: {formatCurrency(product?.ultimo_custo ?? 0)}</small>
                    <button type="button" className="almox-link-btn" onClick={() => setRequestItems((current) => current.filter((entry) => entry.codigo !== item.codigo))}>Remover</button>
                  </div>
                );
              })}
            </div>
            <div className="almox-total">Total estimado <strong>{formatCurrency(requestTotal)}</strong></div>
            <button className="btn btn-primary" type="submit" disabled={busy || !canRequest || requestItems.length === 0}>Enviar solicitação</button>
          </form>
        </section>
      ) : null}

      {activeTab === "aprovacoes" ? (
        <section className="almox-feed">
          {pendentes.length === 0 ? <div className="coleta-empty">Nenhuma solicitação pendente.</div> : null}
          {pendentes.map((row) => <SolicitationCard key={row.solicitacao_id} row={row} showActions busy={busy} onApprove={(item) => decide(item, true)} onReject={(item) => decide(item, false)} />)}
        </section>
      ) : null}

      {activeTab === "minhas" ? (
        <section className="almox-feed">
          {minhas.length === 0 ? <div className="coleta-empty">Nenhuma solicitação criada.</div> : null}
          {minhas.map((row) => <SolicitationCard key={row.solicitacao_id} row={row} />)}
        </section>
      ) : null}

      {activeTab === "notas" ? (
        <section className="coleta-form almox-panel">
          <h3>Input de nota fiscal PDF</h3>
          <input type="file" accept="application/pdf" onChange={(event) => onPdfChange(event.target.files?.[0] ?? null)} disabled={busy} />
          {nfExtraction ? (
            <div className="almox-nf-editor">
              <input value={nfExtraction.numero_nf} onChange={(event) => setNfExtraction({ ...nfExtraction, numero_nf: event.target.value })} placeholder="Número NF" />
              <input value={nfExtraction.fornecedor} onChange={(event) => setNfExtraction({ ...nfExtraction, fornecedor: event.target.value })} placeholder="Fornecedor" />
              <input type="date" value={nfExtraction.data_emissao ?? ""} onChange={(event) => setNfExtraction({ ...nfExtraction, data_emissao: event.target.value || null })} />
              {nfExtraction.itens.map((item, index) => {
                const validation = nfValidation[index];
                return (
                  <div key={`${item.codigo}-${index}`} className={`almox-nf-line${validation && !validation.produto_existe ? " is-new" : ""}`}>
                    <input value={item.codigo} onChange={(event) => updateNfItem(index, { codigo: normalizeCode(event.target.value) })} />
                    <input value={item.descricao} onChange={(event) => updateNfItem(index, { descricao: event.target.value })} />
                    <input inputMode="numeric" value={item.quantidade} onChange={(event) => updateNfItem(index, { quantidade: Number.parseInt(event.target.value.replace(/\D/g, ""), 10) || 0 })} />
                    <input inputMode="decimal" value={item.valor_unitario} onChange={(event) => updateNfItem(index, { valor_unitario: Number.parseFloat(event.target.value.replace(",", ".")) || 0 })} />
                    <strong>{validation?.produto_existe ? "OK" : "Produto novo"}</strong>
                  </div>
                );
              })}
              <div className="almox-actions">
                <button className="btn btn-muted" type="button" onClick={revalidateNf} disabled={busy}>Validar</button>
                <button className="btn btn-primary" type="button" onClick={applyNf} disabled={busy || nfValidation.some((row) => !row.produto_existe)}>Aplicar no estoque</button>
              </div>
            </div>
          ) : null}
          <h3>Histórico de notas</h3>
          <div className="almox-list">
            {nfImports.map((row) => (
              <div key={row.import_id} className="almox-item-line">
                <span>NF {row.numero_nf ?? "-"} | {row.fornecedor ?? "-"}</span>
                <strong>{row.status}</strong>
                <small>{formatDateTime(row.created_at)}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "relatorios" ? (
        <section className="coleta-form almox-panel">
          <div className="almox-panel-head">
            <h3>Relatórios</h3>
            <button className="btn btn-primary" type="button" onClick={exportReports}>Exportar XLSX</button>
          </div>
          <div className="almox-feed">
            {movimentos.map((row) => (
              <article key={row.movimento_id} className="almox-card">
                <div className="almox-card-head">
                  <div>
                    <span className="almox-chip">{row.tipo}</span>
                    <h3>{row.codigo} | {row.descricao}</h3>
                    <p>{row.actor_nome} | {formatDateTime(row.created_at)}</p>
                  </div>
                  <div className="almox-card-kpi">
                    <span>{row.estoque_antes} {"->"} {row.estoque_depois}</span>
                    <strong>{row.quantidade_delta}</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
