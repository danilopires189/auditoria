drop policy if exists p_db_transf_cd_select on app.db_transf_cd;

create policy p_db_transf_cd_select
    on app.db_transf_cd
    for select
    using (
        authz.is_admin(auth.uid())
        or authz.can_access_cd(auth.uid(), cd_ori)
        or authz.can_access_cd(auth.uid(), cd_des)
    );
