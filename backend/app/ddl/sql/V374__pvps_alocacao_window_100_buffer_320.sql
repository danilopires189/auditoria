create or replace function app.pvps_alocacao_window_limit()
returns integer
language sql
immutable
as $$
    select 100;
$$;

create or replace function app.pvps_alocacao_candidate_buffer_limit()
returns integer
language sql
immutable
as $$
    select 320;
$$;
