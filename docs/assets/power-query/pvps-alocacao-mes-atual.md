# Power Query - PVPS e Alocacao - Mes Atual

Pacote pronto para Excel/Power BI.

Importante:
- `pHost`, `pPort`, `pDatabase` ja ficam preenchidos.
- `pUser` e `pPassword` ficam como parametros de referencia.
- No conector `PostgreSQL.Database`, Power Query normalmente pede credenciais em `Data Source Settings`.
- Quando pedir:
  - servidor: `db.gpgqklqhomsaomdnccvu.supabase.co`
  - porta: `5432`
  - banco: `postgres`
  - usuario: valor de `pUser`
  - senha: valor de `pPassword`

## 1. Parametros

### `pHost`
```powerquery
let
    Source = "db.gpgqklqhomsaomdnccvu.supabase.co"
in
    Source
```

### `pPort`
```powerquery
let
    Source = 5432
in
    Source
```

### `pDatabase`
```powerquery
let
    Source = "postgres"
in
    Source
```

### `pUser`
```powerquery
let
    Source = "postgres"
in
    Source
```

### `pPassword`
```powerquery
let
    Source = ""
in
    Source
```

## 2. Helper

### `fxRunPostgresQuery`
```powerquery
(sql as text) as table =>
let
    Source = PostgreSQL.Database(
        pHost,
        pDatabase,
        [
            Port = pPort,
            CreateNavigationProperties = false,
            CommandTimeout = #duration(0, 0, 10, 0)
        ]
    ),
    Result = Value.NativeQuery(Source, sql, null, [EnableFolding = true])
in
    Result
```

## 3. Consultas

### `PVPS_Detalhe_MesAtual`
```powerquery
let
    Sql = "
with month_bounds as (
    select
        date_trunc('month', timezone('America/Sao_Paulo', now())::date)::date as month_start,
        (date_trunc('month', timezone('America/Sao_Paulo', now())::date) + interval '1 month - 1 day')::date as month_end
),
bounds_ts as (
    select
        month_start,
        month_end,
        (month_start::timestamp at time zone 'America/Sao_Paulo') as month_start_ts,
        ((month_end + 1)::timestamp at time zone 'America/Sao_Paulo') as month_end_ts
    from month_bounds
),
pvps_raw as (
    select
        ap.cd,
        timezone('America/Sao_Paulo', coalesce(apu.dt_hr, ap.dt_hr_sep, ap.dt_hr))::date as date_ref,
        ap.audit_id,
        coalesce(nullif(trim(ap.zona), ''), 'Sem zona') as zona,
        coalesce(nullif(trim(ap.descricao), ''), format('CODDV %s', ap.coddv)) as descricao,
        ap.coddv,
        coalesce(nullif(trim(ap.end_sep), ''), 'Sem endereco') as end_sep,
        coalesce(nullif(trim(apu.end_pul), ''), '') as end_pul,
        nullif(trim(ap.val_sep), '') as val_sep,
        nullif(trim(apu.val_pul), '') as val_pul,
        lower(nullif(trim(coalesce(apu.end_sit, ap.end_sit)), '')) as end_sit,
        coalesce(apu.dt_hr, ap.dt_hr_sep, ap.dt_hr) as dt_hr,
        coalesce(nullif(trim(apu.auditor_nome), ''), nullif(trim(ap.auditor_nome), ''), '') as auditor_nome,
        coalesce(nullif(trim(apu.auditor_mat), ''), nullif(trim(ap.auditor_mat), ''), '') as auditor_mat,
        coalesce(nullif(upper(trim(apu.end_pul)), ''), format('PEND:%s', ap.audit_id::text)) as dedupe_key,
        case
            when lower(coalesce(apu.end_sit, ap.end_sit, '')) in ('vazio', 'obstruido') then 'ocorrencia'
            when nullif(trim(coalesce(apu.end_pul, '')), '') is null then 'pendente_pul'
            when nullif(trim(coalesce(ap.val_sep, '')), '') is null then 'pendente_pul'
            when nullif(trim(coalesce(apu.val_pul, '')), '') is null then 'pendente_pul'
            when app.pvps_alocacao_validade_rank(apu.val_pul)
                 < app.pvps_alocacao_validade_rank(ap.val_sep)
                then 'nao_conforme'
            else 'conforme'
        end as sit_aud
    from app.aud_pvps ap
    left join app.aud_pvps_pul apu
      on apu.audit_id = ap.audit_id
    cross join bounds_ts bt
    where coalesce(apu.dt_hr, ap.dt_hr_sep, ap.dt_hr) >= bt.month_start_ts
      and coalesce(apu.dt_hr, ap.dt_hr_sep, ap.dt_hr) < bt.month_end_ts
),
ranked as (
    select
        pr.*,
        row_number() over (
            partition by pr.dedupe_key
            order by
                case pr.sit_aud
                    when 'nao_conforme' then 4
                    when 'conforme' then 3
                    when 'ocorrencia' then 2
                    else 1
                end desc,
                pr.dt_hr desc nulls last,
                pr.coddv asc,
                pr.audit_id asc
        ) as rn
    from pvps_raw pr
)
select
    cd,
    date_ref,
    audit_id,
    zona,
    descricao,
    coddv,
    end_sep,
    nullif(end_pul, '') as end_pul,
    val_sep,
    val_pul,
    end_sit,
    sit_aud,
    auditor_nome,
    auditor_mat,
    dt_hr
from ranked
where rn = 1
order by cd asc, date_ref asc, zona asc, coddv asc
",
    Source = fxRunPostgresQuery(Sql),
    Typed = Table.TransformColumnTypes(
        Source,
        {
            {""cd"", Int64.Type},
            {""date_ref"", type date},
            {""audit_id"", type text},
            {""zona"", type text},
            {""descricao"", type text},
            {""coddv"", Int64.Type},
            {""end_sep"", type text},
            {""end_pul"", type text},
            {""val_sep"", type text},
            {""val_pul"", type text},
            {""end_sit"", type text},
            {""sit_aud"", type text},
            {""auditor_nome"", type text},
            {""auditor_mat"", type text},
            {""dt_hr"", type datetimezone}
        }
    )
in
    Typed
```

### `Alocacao_Detalhe_MesAtual`
```powerquery
let
    Sql = "
with month_bounds as (
    select
        date_trunc('month', timezone('America/Sao_Paulo', now())::date)::date as month_start,
        (date_trunc('month', timezone('America/Sao_Paulo', now())::date) + interval '1 month - 1 day')::date as month_end
),
bounds_ts as (
    select
        month_start,
        month_end,
        (month_start::timestamp at time zone 'America/Sao_Paulo') as month_start_ts,
        ((month_end + 1)::timestamp at time zone 'America/Sao_Paulo') as month_end_ts
    from month_bounds
)
select
    aa.cd,
    timezone('America/Sao_Paulo', aa.dt_hr)::date as date_ref,
    aa.audit_id,
    coalesce(nullif(trim(aa.zona), ''), 'Sem zona') as zona,
    coalesce(nullif(trim(aa.descricao), ''), format('CODDV %s', aa.coddv)) as descricao,
    aa.coddv,
    coalesce(nullif(trim(aa.endereco), ''), 'Sem endereco') as endereco,
    aa.nivel,
    lower(nullif(trim(aa.end_sit), '')) as end_sit,
    nullif(trim(aa.val_sist), '') as val_sist,
    nullif(trim(aa.val_conf), '') as val_conf,
    case
        when lower(coalesce(aa.end_sit, '')) in ('vazio', 'obstruido') then 'ocorrencia'
        when lower(coalesce(aa.aud_sit, '')) = 'nao_conforme' then 'nao_conforme'
        when lower(coalesce(aa.aud_sit, '')) = 'conforme' then 'conforme'
        else 'nao_auditado'
    end as sit_aud,
    coalesce(nullif(trim(aa.auditor_nome), ''), '') as auditor_nome,
    coalesce(nullif(trim(aa.auditor_mat), ''), '') as auditor_mat,
    aa.dt_hr
from app.aud_alocacao aa
cross join bounds_ts bt
where aa.dt_hr >= bt.month_start_ts
  and aa.dt_hr < bt.month_end_ts
order by aa.cd asc, timezone('America/Sao_Paulo', aa.dt_hr)::date asc, aa.zona asc, aa.coddv asc
",
    Source = fxRunPostgresQuery(Sql),
    Typed = Table.TransformColumnTypes(
        Source,
        {
            {""cd"", Int64.Type},
            {""date_ref"", type date},
            {""audit_id"", type text},
            {""zona"", type text},
            {""descricao"", type text},
            {""coddv"", Int64.Type},
            {""endereco"", type text},
            {""nivel"", type text},
            {""end_sit"", type text},
            {""val_sist"", type text},
            {""val_conf"", type text},
            {""sit_aud"", type text},
            {""auditor_nome"", type text},
            {""auditor_mat"", type text},
            {""dt_hr"", type datetimezone}
        }
    )
in
    Typed
```

### `Indicadores_Resumo_MesAtual`
```powerquery
let
    Sql = "
with month_bounds as (
    select
        date_trunc('month', timezone('America/Sao_Paulo', now())::date)::date as month_start,
        (date_trunc('month', timezone('America/Sao_Paulo', now())::date) + interval '1 month - 1 day')::date as month_end
),
bounds_ts as (
    select
        month_start,
        month_end,
        (month_start::timestamp at time zone 'America/Sao_Paulo') as month_start_ts,
        ((month_end + 1)::timestamp at time zone 'America/Sao_Paulo') as month_end_ts
    from month_bounds
),
pvps_raw as (
    select
        ap.cd,
        timezone('America/Sao_Paulo', coalesce(apu.dt_hr, ap.dt_hr_sep, ap.dt_hr))::date as date_ref,
        ap.audit_id,
        ap.coddv,
        lower(nullif(trim(coalesce(apu.end_sit, ap.end_sit)), '')) as end_sit,
        coalesce(nullif(upper(trim(apu.end_pul)), ''), format('PEND:%s', ap.audit_id::text)) as dedupe_key,
        coalesce(apu.dt_hr, ap.dt_hr_sep, ap.dt_hr) as dt_hr,
        case
            when lower(coalesce(apu.end_sit, ap.end_sit, '')) in ('vazio', 'obstruido') then 'ocorrencia'
            when nullif(trim(coalesce(apu.end_pul, '')), '') is null then 'pendente_pul'
            when nullif(trim(coalesce(ap.val_sep, '')), '') is null then 'pendente_pul'
            when nullif(trim(coalesce(apu.val_pul, '')), '') is null then 'pendente_pul'
            when app.pvps_alocacao_validade_rank(apu.val_pul)
                 < app.pvps_alocacao_validade_rank(ap.val_sep)
                then 'nao_conforme'
            else 'conforme'
        end as sit_aud
    from app.aud_pvps ap
    left join app.aud_pvps_pul apu
      on apu.audit_id = ap.audit_id
    cross join bounds_ts bt
    where coalesce(apu.dt_hr, ap.dt_hr_sep, ap.dt_hr) >= bt.month_start_ts
      and coalesce(apu.dt_hr, ap.dt_hr_sep, ap.dt_hr) < bt.month_end_ts
),
pvps_detalhe as (
    select
        pr.cd,
        pr.date_ref,
        pr.coddv,
        pr.end_sit,
        pr.sit_aud
    from (
        select
            pr.*,
            row_number() over (
                partition by pr.dedupe_key
                order by
                    case pr.sit_aud
                        when 'nao_conforme' then 4
                        when 'conforme' then 3
                        when 'ocorrencia' then 2
                        else 1
                    end desc,
                    pr.dt_hr desc nulls last,
                    pr.coddv asc,
                    pr.audit_id asc
            ) as rn
        from pvps_raw pr
    ) pr
    where pr.rn = 1
),
aloc_detalhe as (
    select
        aa.cd,
        timezone('America/Sao_Paulo', aa.dt_hr)::date as date_ref,
        aa.coddv,
        lower(nullif(trim(aa.end_sit), '')) as end_sit,
        case
            when lower(coalesce(aa.end_sit, '')) in ('vazio', 'obstruido') then 'ocorrencia'
            when lower(coalesce(aa.aud_sit, '')) = 'nao_conforme' then 'nao_conforme'
            when lower(coalesce(aa.aud_sit, '')) = 'conforme' then 'conforme'
            else 'nao_auditado'
        end as sit_aud
    from app.aud_alocacao aa
    cross join bounds_ts bt
    where aa.dt_hr >= bt.month_start_ts
      and aa.dt_hr < bt.month_end_ts
),
monthly as (
    select
        pd.cd,
        'pvps'::text as modulo,
        count(*) filter (where pd.sit_aud in ('conforme', 'nao_conforme'))::bigint as enderecos_auditados,
        count(*) filter (where pd.sit_aud = 'conforme')::bigint as conformes,
        count(*) filter (where pd.sit_aud = 'nao_conforme')::bigint as nao_conformes,
        count(*) filter (where pd.sit_aud = 'ocorrencia')::bigint as ocorrencias_total,
        count(*) filter (where pd.sit_aud = 'ocorrencia' and pd.end_sit = 'vazio')::bigint as ocorrencias_vazio,
        count(*) filter (where pd.sit_aud = 'ocorrencia' and pd.end_sit = 'obstruido')::bigint as ocorrencias_obstruido
    from pvps_detalhe pd
    group by pd.cd

    union all

    select
        ad.cd,
        'alocacao'::text as modulo,
        count(*) filter (where ad.sit_aud in ('conforme', 'nao_conforme'))::bigint as enderecos_auditados,
        count(*) filter (where ad.sit_aud = 'conforme')::bigint as conformes,
        count(*) filter (where ad.sit_aud = 'nao_conforme')::bigint as nao_conformes,
        count(*) filter (where ad.sit_aud = 'ocorrencia')::bigint as ocorrencias_total,
        count(*) filter (where ad.sit_aud = 'ocorrencia' and ad.end_sit = 'vazio')::bigint as ocorrencias_vazio,
        count(*) filter (where ad.sit_aud = 'ocorrencia' and ad.end_sit = 'obstruido')::bigint as ocorrencias_obstruido
    from aloc_detalhe ad
    group by ad.cd
)
select
    m.cd,
    m.modulo,
    m.enderecos_auditados,
    m.conformes,
    m.nao_conformes,
    m.ocorrencias_total,
    m.ocorrencias_vazio,
    m.ocorrencias_obstruido,
    case
        when m.enderecos_auditados > 0
            then round((m.conformes::numeric / m.enderecos_auditados::numeric) * 100, 4)
        else 0::numeric
    end as percentual_conformidade,
    case
        when m.enderecos_auditados > 0
            then round((m.nao_conformes::numeric / m.enderecos_auditados::numeric) * 100, 4)
        else 0::numeric
    end as percentual_erro
from monthly m
order by m.cd asc, m.modulo asc
",
    Source = fxRunPostgresQuery(Sql),
    Typed = Table.TransformColumnTypes(
        Source,
        {
            {""cd"", Int64.Type},
            {""modulo"", type text},
            {""enderecos_auditados"", Int64.Type},
            {""conformes"", Int64.Type},
            {""nao_conformes"", Int64.Type},
            {""ocorrencias_total"", Int64.Type},
            {""ocorrencias_vazio"", Int64.Type},
            {""ocorrencias_obstruido"", Int64.Type},
            {""percentual_conformidade"", type number},
            {""percentual_erro"", type number}
        }
    )
in
    Typed
```

### `Indicadores_Diario_MesAtual`
```powerquery
let
    Sql = "
with month_bounds as (
    select
        date_trunc('month', timezone('America/Sao_Paulo', now())::date)::date as month_start,
        (date_trunc('month', timezone('America/Sao_Paulo', now())::date) + interval '1 month - 1 day')::date as month_end
),
bounds_ts as (
    select
        month_start,
        month_end,
        (month_start::timestamp at time zone 'America/Sao_Paulo') as month_start_ts,
        ((month_end + 1)::timestamp at time zone 'America/Sao_Paulo') as month_end_ts
    from month_bounds
),
pvps_raw as (
    select
        ap.cd,
        timezone('America/Sao_Paulo', coalesce(apu.dt_hr, ap.dt_hr_sep, ap.dt_hr))::date as date_ref,
        ap.audit_id,
        ap.coddv,
        lower(nullif(trim(coalesce(apu.end_sit, ap.end_sit)), '')) as end_sit,
        coalesce(nullif(upper(trim(apu.end_pul)), ''), format('PEND:%s', ap.audit_id::text)) as dedupe_key,
        coalesce(apu.dt_hr, ap.dt_hr_sep, ap.dt_hr) as dt_hr,
        case
            when lower(coalesce(apu.end_sit, ap.end_sit, '')) in ('vazio', 'obstruido') then 'ocorrencia'
            when nullif(trim(coalesce(apu.end_pul, '')), '') is null then 'pendente_pul'
            when nullif(trim(coalesce(ap.val_sep, '')), '') is null then 'pendente_pul'
            when nullif(trim(coalesce(apu.val_pul, '')), '') is null then 'pendente_pul'
            when app.pvps_alocacao_validade_rank(apu.val_pul)
                 < app.pvps_alocacao_validade_rank(ap.val_sep)
                then 'nao_conforme'
            else 'conforme'
        end as sit_aud
    from app.aud_pvps ap
    left join app.aud_pvps_pul apu
      on apu.audit_id = ap.audit_id
    cross join bounds_ts bt
    where coalesce(apu.dt_hr, ap.dt_hr_sep, ap.dt_hr) >= bt.month_start_ts
      and coalesce(apu.dt_hr, ap.dt_hr_sep, ap.dt_hr) < bt.month_end_ts
),
pvps_detalhe as (
    select
        pr.cd,
        pr.date_ref,
        pr.coddv,
        pr.end_sit,
        pr.sit_aud
    from (
        select
            pr.*,
            row_number() over (
                partition by pr.dedupe_key
                order by
                    case pr.sit_aud
                        when 'nao_conforme' then 4
                        when 'conforme' then 3
                        when 'ocorrencia' then 2
                        else 1
                    end desc,
                    pr.dt_hr desc nulls last,
                    pr.coddv asc,
                    pr.audit_id asc
            ) as rn
        from pvps_raw pr
    ) pr
    where pr.rn = 1
),
aloc_detalhe as (
    select
        aa.cd,
        timezone('America/Sao_Paulo', aa.dt_hr)::date as date_ref,
        aa.coddv,
        lower(nullif(trim(aa.end_sit), '')) as end_sit,
        case
            when lower(coalesce(aa.end_sit, '')) in ('vazio', 'obstruido') then 'ocorrencia'
            when lower(coalesce(aa.aud_sit, '')) = 'nao_conforme' then 'nao_conforme'
            when lower(coalesce(aa.aud_sit, '')) = 'conforme' then 'conforme'
            else 'nao_auditado'
        end as sit_aud
    from app.aud_alocacao aa
    cross join bounds_ts bt
    where aa.dt_hr >= bt.month_start_ts
      and aa.dt_hr < bt.month_end_ts
),
daily as (
    select
        pd.cd,
        pd.date_ref,
        'pvps'::text as modulo,
        count(*) filter (where pd.sit_aud in ('conforme', 'nao_conforme'))::bigint as enderecos_auditados,
        count(*) filter (where pd.sit_aud = 'conforme')::bigint as conformes,
        count(*) filter (where pd.sit_aud = 'nao_conforme')::bigint as nao_conformes,
        count(*) filter (where pd.sit_aud = 'ocorrencia')::bigint as ocorrencias_total,
        count(*) filter (where pd.sit_aud = 'ocorrencia' and pd.end_sit = 'vazio')::bigint as ocorrencias_vazio,
        count(*) filter (where pd.sit_aud = 'ocorrencia' and pd.end_sit = 'obstruido')::bigint as ocorrencias_obstruido
    from pvps_detalhe pd
    group by pd.cd, pd.date_ref

    union all

    select
        ad.cd,
        ad.date_ref,
        'alocacao'::text as modulo,
        count(*) filter (where ad.sit_aud in ('conforme', 'nao_conforme'))::bigint as enderecos_auditados,
        count(*) filter (where ad.sit_aud = 'conforme')::bigint as conformes,
        count(*) filter (where ad.sit_aud = 'nao_conforme')::bigint as nao_conformes,
        count(*) filter (where ad.sit_aud = 'ocorrencia')::bigint as ocorrencias_total,
        count(*) filter (where ad.sit_aud = 'ocorrencia' and ad.end_sit = 'vazio')::bigint as ocorrencias_vazio,
        count(*) filter (where ad.sit_aud = 'ocorrencia' and ad.end_sit = 'obstruido')::bigint as ocorrencias_obstruido
    from aloc_detalhe ad
    group by ad.cd, ad.date_ref
)
select
    d.cd,
    d.date_ref,
    d.modulo,
    d.enderecos_auditados,
    d.conformes,
    d.nao_conformes,
    d.ocorrencias_total,
    d.ocorrencias_vazio,
    d.ocorrencias_obstruido,
    case
        when d.enderecos_auditados > 0
            then round((d.conformes::numeric / d.enderecos_auditados::numeric) * 100, 4)
        else 0::numeric
    end as percentual_conformidade,
    case
        when d.enderecos_auditados > 0
            then round((d.nao_conformes::numeric / d.enderecos_auditados::numeric) * 100, 4)
        else 0::numeric
    end as percentual_erro
from daily d
order by d.cd asc, d.date_ref asc, d.modulo asc
",
    Source = fxRunPostgresQuery(Sql),
    Typed = Table.TransformColumnTypes(
        Source,
        {
            {""cd"", Int64.Type},
            {""date_ref"", type date},
            {""modulo"", type text},
            {""enderecos_auditados"", Int64.Type},
            {""conformes"", Int64.Type},
            {""nao_conformes"", Int64.Type},
            {""ocorrencias_total"", Int64.Type},
            {""ocorrencias_vazio"", Int64.Type},
            {""ocorrencias_obstruido"", Int64.Type},
            {""percentual_conformidade"", type number},
            {""percentual_erro"", type number}
        }
    )
in
    Typed
```

## 4. Ordem sugerida no Excel / Power BI

1. criar parametros `pHost`, `pPort`, `pDatabase`, `pUser`, `pPassword`
2. criar helper `fxRunPostgresQuery`
3. colar 4 consultas:
   - `PVPS_Detalhe_MesAtual`
   - `Alocacao_Detalhe_MesAtual`
   - `Indicadores_Resumo_MesAtual`
   - `Indicadores_Diario_MesAtual`
4. quando Power Query pedir autenticacao, informar usuario e senha do banco
