delete from app.db_usuario u
where u.cd is null
  and nullif(trim(coalesce(u.mat, '')), '') is not null
  and exists (
      select 1
      from app.db_usuario keep_row
      where trim(coalesce(keep_row.mat, '')) = trim(coalesce(u.mat, ''))
        and keep_row.cd is not null
  );
