import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

type SyncMode = "full_replace" | "upsert" | "insert_new";

type SyncRequest = {
  op?: "healthcheck" | "sync_table";
  run_id?: string;
  table?: string;
  mode?: SyncMode;
  unique_keys?: string[];
  replace_filter_column?: string | null;
  rows?: Array<Record<string, unknown>>;
  dry_run?: boolean;
  batch_index?: number;
  batch_total?: number;
  reset_table?: boolean;
};

const ALLOWED_TABLES = new Set([
  "db_barras",
  "db_custo",
  "db_log_end",
  "db_end",
  "db_estq_entr",
  "db_usuario",
  "db_rotas",
  "db_prod_vol",
  "db_transf_cd",
  "db_gestao_estq",
  "db_termo",
  "db_avulso",
]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-ingest-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function normalizeMode(value: string | undefined): SyncMode {
  const raw = (value || "").toLowerCase().trim();
  if (raw === "upsert") return "upsert";
  if (raw === "insert_new") return "insert_new";
  return "full_replace";
}

async function replaceTableData(
  client: ReturnType<typeof createClient>,
  table: string,
  filterColumn: string | null,
): Promise<void> {
  if (!filterColumn) {
    throw new Error(`replace_filter_column is required for full_replace table=${table}`);
  }

  const { error } = await client
    .schema("app")
    .from(table)
    .delete()
    .not(filterColumn, "is", null);

  if (error) {
    throw new Error(`delete failed: ${error.message}`);
  }
}

async function insertRows(
  client: ReturnType<typeof createClient>,
  table: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const { error } = await client.schema("app").from(table).insert(rows);
  if (error) {
    throw new Error(`insert failed: ${error.message}`);
  }
}

async function upsertRows(
  client: ReturnType<typeof createClient>,
  table: string,
  rows: Array<Record<string, unknown>>,
  uniqueKeys: string[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  if (!uniqueKeys.length) {
    throw new Error(`upsert mode requires unique_keys table=${table}`);
  }

  const { error } = await client
    .schema("app")
    .from(table)
    .upsert(rows, { onConflict: uniqueKeys.join(",") });
  if (error) {
    throw new Error(`upsert failed: ${error.message}`);
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Only POST is allowed" }, 405);
  }

  try {
    const sharedSecret = (Deno.env.get("EDGE_FUNCTION_SHARED_SECRET") || "").trim();
    if (sharedSecret) {
      const incoming = (request.headers.get("x-ingest-token") || "").trim();
      if (incoming !== sharedSecret) {
        return jsonResponse({ ok: false, error: "invalid shared secret" }, 401);
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        { ok: false, error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required" },
        500,
      );
    }

    const payload = (await request.json()) as SyncRequest;
    if (payload.op === "healthcheck") {
      return jsonResponse({ ok: true, message: "edge function alive" });
    }

    const table = (payload.table || "").trim().toLowerCase();
    if (!ALLOWED_TABLES.has(table)) {
      return jsonResponse({ ok: false, error: `table not allowed: ${table}` }, 400);
    }

    const mode = normalizeMode(payload.mode);
    const uniqueKeys = (payload.unique_keys || []).map((item) => String(item).trim()).filter(Boolean);
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const dryRun = Boolean(payload.dry_run);
    const resetTable = Boolean(payload.reset_table);
    const replaceFilterColumn = payload.replace_filter_column ? String(payload.replace_filter_column) : null;

    if (dryRun) {
      return jsonResponse({
        ok: true,
        message: "dry-run",
        table,
        row_count: rows.length,
        batch_index: payload.batch_index ?? 0,
        batch_total: payload.batch_total ?? 1,
      });
    }

    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (mode === "full_replace" && resetTable) {
      await replaceTableData(client, table, replaceFilterColumn);
    }

    if (mode === "upsert") {
      await upsertRows(client, table, rows, uniqueKeys);
    } else {
      await insertRows(client, table, rows);
    }

    return jsonResponse({
      ok: true,
      run_id: payload.run_id || null,
      table,
      mode,
      row_count: rows.length,
      batch_index: payload.batch_index ?? 0,
      batch_total: payload.batch_total ?? 1,
      reset_table: resetTable,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
