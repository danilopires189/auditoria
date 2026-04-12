create or replace function app.ronda_quality_prevent_duplicate_no_occurrence()
returns trigger
language plpgsql
security definer
set search_path = app, public
as $$
begin
    if new.audit_result = 'sem_ocorrencia' then
        perform pg_advisory_xact_lock(hashtextextended(
            concat_ws(
                ':',
                'ronda_quality_no_occurrence',
                new.month_ref::text,
                new.cd::text,
                new.zone_type,
                new.zona,
                coalesce(new.coluna, -1)::text
            ),
            0
        ));

        if exists (
            select 1
            from app.aud_ronda_quality_sessions s
            where s.month_ref = new.month_ref
              and s.cd = new.cd
              and s.zone_type = new.zone_type
              and s.zona = new.zona
              and coalesce(s.coluna, -1) = coalesce(new.coluna, -1)
              and s.audit_result = 'sem_ocorrencia'
              and s.audit_id is distinct from new.audit_id
        ) then
            if new.zone_type = 'PUL' then
                raise exception 'SEM_OCORRENCIA_DUPLICADA_COLUNA';
            end if;
            raise exception 'SEM_OCORRENCIA_DUPLICADA_ZONA';
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_aud_ronda_quality_no_occurrence_once on app.aud_ronda_quality_sessions;

create trigger trg_aud_ronda_quality_no_occurrence_once
before insert on app.aud_ronda_quality_sessions
for each row
execute function app.ronda_quality_prevent_duplicate_no_occurrence();
