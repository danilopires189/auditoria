-- Allow admins to launch manual Atividade Extra points for past months.

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

    if p_data_atividade > v_now_brt::date then
        raise exception 'FUTURO_NAO_PERMITIDO';
    end if;

    return v_points::numeric(9,5);
end;
$$;
