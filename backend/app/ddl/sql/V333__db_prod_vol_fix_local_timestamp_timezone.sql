update app.db_prod_vol
set
    dt_ped = case
        when dt_ped is null then null
        else (dt_ped at time zone 'UTC') at time zone 'America/Sao_Paulo'
    end,
    dt_lib = case
        when dt_lib is null then null
        else (dt_lib at time zone 'UTC') at time zone 'America/Sao_Paulo'
    end,
    encerramento = case
        when encerramento is null then null
        else (encerramento at time zone 'UTC') at time zone 'America/Sao_Paulo'
    end
where dt_ped is not null
   or dt_lib is not null
   or encerramento is not null;
