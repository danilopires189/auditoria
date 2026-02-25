# Edge Function - Sync Ingest (HTTPS/443)

Deploy this function when direct PostgreSQL (`5432/6543`) is blocked and you need
automated sync over HTTPS.

## 1. Create function in Supabase

```bash
supabase functions new sync_ingest
```

Replace `supabase/functions/sync_ingest/index.ts` with:

- `backend/edge_function/sync_ingest/index.ts`

## 2. Set function secrets

```bash
supabase secrets set \
  SUPABASE_URL=https://<project-ref>.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  EDGE_FUNCTION_SHARED_SECRET=<strong-secret>
```

## 3. Deploy

```bash
supabase functions deploy sync_ingest --no-verify-jwt
```

## 4. Configure desktop `.env`

```env
SYNC_TRANSPORT=edge
EDGE_FUNCTION_URL=https://<project-ref>.functions.supabase.co/sync_ingest
EDGE_FUNCTION_BEARER_TOKEN=<anon-key-or-service-role-key>
EDGE_FUNCTION_SHARED_SECRET=<same-secret-used-in-function>
EDGE_FUNCTION_TIMEOUT_SECONDS=120
EDGE_FUNCTION_CHUNK_SIZE=1000
```

## 5. Validate from desktop

```cmd
sync_backend_cli.exe healthcheck --config config.yml --env-file .env
sync_backend_cli.exe automation-cycle --config config.yml --env-file .env --automation-config automation_config.json
```

