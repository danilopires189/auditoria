const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type NfItem = {
  codigo: string;
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
};

type NfExtraction = {
  numero_nf: string;
  fornecedor: string;
  data_emissao: string | null;
  itens: NfItem[];
  alertas: string[];
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function extractOutputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") return text;
    }
  }
  return "";
}

function normalizeExtraction(value: unknown): NfExtraction {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const itensRaw = Array.isArray(raw.itens) ? raw.itens : [];
  const itens = itensRaw.map((item): NfItem => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const quantidade = Number(row.quantidade ?? 0);
    const valorUnitario = Number(row.valor_unitario ?? 0);
    const valorTotal = Number(row.valor_total ?? quantidade * valorUnitario);
    return {
      codigo: String(row.codigo ?? "").trim().toUpperCase(),
      descricao: String(row.descricao ?? "").trim(),
      quantidade: Number.isFinite(quantidade) ? Math.max(Math.trunc(quantidade), 0) : 0,
      valor_unitario: Number.isFinite(valorUnitario) ? Math.max(valorUnitario, 0) : 0,
      valor_total: Number.isFinite(valorTotal) ? Math.max(valorTotal, 0) : 0,
    };
  }).filter((item) => item.codigo && item.quantidade > 0);

  return {
    numero_nf: String(raw.numero_nf ?? "").trim(),
    fornecedor: String(raw.fornecedor ?? "").trim(),
    data_emissao: typeof raw.data_emissao === "string" && raw.data_emissao.trim() ? raw.data_emissao.trim() : null,
    itens,
    alertas: Array.isArray(raw.alertas) ? raw.alertas.map(String) : [],
  };
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return jsonResponse({ error: "Only POST is allowed" }, 405);

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return jsonResponse({ error: "OPENAI_API_KEY ausente" }, 500);

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return jsonResponse({ error: "Arquivo PDF obrigatório" }, 400);
    if (file.type && file.type !== "application/pdf") return jsonResponse({ error: "Arquivo deve ser PDF" }, 400);
    if (file.size > 50 * 1024 * 1024) return jsonResponse({ error: "PDF excede 50 MB" }, 400);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileData = `data:application/pdf;base64,${bytesToBase64(bytes)}`;
    const model = Deno.env.get("OPENAI_NF_MODEL") || "gpt-4o-mini";

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "Extraia dados de nota fiscal de almoxarifado. Responda apenas JSON conforme schema. Use codigo do produto como aparece na nota. Quantidades em unidades inteiras. Valores em decimal.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_file",
                filename: file.name || "nota-fiscal.pdf",
                file_data: fileData,
              },
              {
                type: "input_text",
                text: "Extraia numero_nf, fornecedor, data_emissao YYYY-MM-DD quando existir, itens com codigo, descricao, quantidade, valor_unitario, valor_total e alertas.",
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "almox_nf_extraction",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                numero_nf: { type: "string" },
                fornecedor: { type: "string" },
                data_emissao: { anyOf: [{ type: "string" }, { type: "null" }] },
                itens: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      codigo: { type: "string" },
                      descricao: { type: "string" },
                      quantidade: { type: "integer" },
                      valor_unitario: { type: "number" },
                      valor_total: { type: "number" },
                    },
                    required: ["codigo", "descricao", "quantidade", "valor_unitario", "valor_total"],
                  },
                },
                alertas: { type: "array", items: { type: "string" } },
              },
              required: ["numero_nf", "fornecedor", "data_emissao", "itens", "alertas"],
            },
          },
        },
      }),
    });

    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      return jsonResponse({ error: String((payload.error as Record<string, unknown> | undefined)?.message ?? "Falha na extração") }, response.status);
    }

    const outputText = extractOutputText(payload);
    if (!outputText) return jsonResponse({ error: "Resposta sem JSON extraído" }, 502);
    return jsonResponse(normalizeExtraction(JSON.parse(outputText)));
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
