-- Corrige conferências já abertas/finalizadas com qtd_esperada inflada por join com db_barras.
with base as (
    select
        c.conf_id,
        d.coddv,
        coalesce(sum(greatest(coalesce(d.qtd_dev, 0)::integer, 0)), 0)::integer as qtd_esperada
    from app.conf_devolucao c
    join app.db_devolucao d
      on d.cd = c.cd
     and d.coddv is not null
     and c.conference_kind = 'com_nfd'
     and coalesce(nullif(trim(coalesce(d.chave, '')), ''), d.nfd::text)
         = coalesce(nullif(trim(coalesce(c.chave, '')), ''), c.nfd::text)
    group by c.conf_id, d.coddv
)
update app.conf_devolucao_itens i
   set qtd_esperada = b.qtd_esperada,
       updated_at = now()
  from base b
 where i.conf_id = b.conf_id
   and i.coddv = b.coddv
   and i.qtd_esperada is distinct from b.qtd_esperada;

-- Alinha motivo salvo da conferência com o motivo atual da nota/ref.
with motivo_ref as (
    select
        c.conf_id,
        min(nullif(trim(coalesce(d.motivo, '')), '')) as source_motivo
    from app.conf_devolucao c
    join app.db_devolucao d
      on d.cd = c.cd
     and d.coddv is not null
     and c.conference_kind = 'com_nfd'
     and coalesce(nullif(trim(coalesce(d.chave, '')), ''), d.nfd::text)
         = coalesce(nullif(trim(coalesce(c.chave, '')), ''), c.nfd::text)
    group by c.conf_id
)
update app.conf_devolucao c
   set source_motivo = coalesce(m.source_motivo, c.source_motivo),
       updated_at = now()
  from motivo_ref m
 where c.conf_id = m.conf_id
   and coalesce(c.source_motivo, '') is distinct from coalesce(m.source_motivo, '');
