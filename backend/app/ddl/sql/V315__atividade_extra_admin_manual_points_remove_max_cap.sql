-- Remove max cap for admin manual points in Atividade Extra.

do $$
declare
    v_constraint_name text;
begin
    for v_constraint_name in
        select c.conname
        from pg_constraint c
        where c.conrelid = 'app.atividade_extra'::regclass
          and c.contype = 'c'
          and pg_get_constraintdef(c.oid) ilike '%pontos%'
          and pg_get_constraintdef(c.oid) ilike '%1.5%'
    loop
        execute format('alter table app.atividade_extra drop constraint %I', v_constraint_name);
    end loop;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'ck_atividade_extra_points_non_negative'
          and conrelid = 'app.atividade_extra'::regclass
    ) then
        alter table app.atividade_extra
            add constraint ck_atividade_extra_points_non_negative
            check (pontos >= 0);
    end if;
end;
$$;

drop function if exists app.atividade_extra_validate_manual_points(date, numeric);
create or replace function app.atividade_extra_validate_manual_points(
    p_data_atividade date,
    p_pontos numeric
)
returns numeric(9,5)
language plpgsql
as $$
declare
    v_now_brt timestamp;
    v_points numeric;
begin
    if p_data_atividade is null then
        raise exception 'DATA_INICIO_OBRIGATORIA';
    end if;

    if p_pontos is null then
        raise exception 'PONTOS_OBRIGATORIOS';
    end if;

    v_points := round(p_pontos::numeric, 5);
    if v_points <= 0 then
        raise exception 'PONTOS_FORA_FAIXA';
    end if;

    v_now_brt := timezone('America/Sao_Paulo', now());

    if date_trunc('month', p_data_atividade::timestamp)::date <> date_trunc('month', v_now_brt)::date then
        raise exception 'MES_FORA_DO_ATUAL';
    end if;

    if p_data_atividade > v_now_brt::date then
        raise exception 'FUTURO_NAO_PERMITIDO';
    end if;

    return v_points::numeric(9,5);
end;
$$;
