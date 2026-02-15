from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TableSpec:
    name: str
    business_columns: list[str]
    sql_types: dict[str, str]
    has_cd: bool


TABLE_SPECS: dict[str, TableSpec] = {
    "db_entrada_notas": TableSpec(
        name="db_entrada_notas",
        business_columns=[
            "cd",
            "transportadora",
            "forn",
            "seq_entrada",
            "nf",
            "coddv",
            "descricao",
            "qtd_cx",
            "un_por_cx",
            "qtd_total",
            "vl_tt",
        ],
        sql_types={
            "cd": "integer",
            "transportadora": "text",
            "forn": "text",
            "seq_entrada": "bigint",
            "nf": "bigint",
            "coddv": "integer",
            "descricao": "text",
            "qtd_cx": "integer",
            "un_por_cx": "integer",
            "qtd_total": "integer",
            "vl_tt": "numeric",
        },
        has_cd=True,
    ),
    "db_avulso": TableSpec(
        name="db_avulso",
        business_columns=[
            "cd",
            "id_mov",
            "nr_volume",
            "dt_mov",
            "coddv",
            "descricao",
            "lote",
            "val",
            "qtd_mov",
        ],
        sql_types={
            "cd": "integer",
            "id_mov": "text",
            "nr_volume": "text",
            "dt_mov": "date",
            "coddv": "integer",
            "descricao": "text",
            "lote": "text",
            "val": "text",
            "qtd_mov": "integer",
        },
        has_cd=True,
    ),
    "db_usuario": TableSpec(
        name="db_usuario",
        business_columns=[
            "cd",
            "mat",
            "nome",
            "dt_nasc",
            "dt_adm",
            "cargo",
            "cd_nome",
        ],
        sql_types={
            "cd": "integer",
            "mat": "text",
            "nome": "text",
            "dt_nasc": "date",
            "dt_adm": "date",
            "cargo": "text",
            "cd_nome": "text",
        },
        has_cd=True,
    ),
    "db_barras": TableSpec(
        name="db_barras",
        business_columns=["coddv", "descricao", "barras"],
        sql_types={
            "coddv": "integer",
            "descricao": "text",
            "barras": "text",
        },
        has_cd=False,
    ),
    "db_devolucao": TableSpec(
        name="db_devolucao",
        business_columns=[
            "cd",
            "motivo",
            "nfd",
            "coddv",
            "descricao",
            "tipo",
            "qtd_dev",
            "dt_gera",
            "chave",
            "geracao",
        ],
        sql_types={
            "cd": "integer",
            "motivo": "text",
            "nfd": "bigint",
            "coddv": "integer",
            "descricao": "text",
            "tipo": "text",
            "qtd_dev": "integer",
            "dt_gera": "date",
            "chave": "text",
            "geracao": "text",
        },
        has_cd=True,
    ),
    "db_pedido_direto": TableSpec(
        name="db_pedido_direto",
        business_columns=[
            "cd",
            "pedido",
            "sq",
            "filial",
            "dt_pedido",
            "coddv",
            "descricao",
            "qtd_fat",
        ],
        sql_types={
            "cd": "integer",
            "pedido": "bigint",
            "sq": "bigint",
            "filial": "bigint",
            "dt_pedido": "date",
            "coddv": "integer",
            "descricao": "text",
            "qtd_fat": "integer",
        },
        has_cd=True,
    ),
    "db_rotas": TableSpec(
        name="db_rotas",
        business_columns=[
            "cd",
            "filial",
            "uf",
            "nome",
            "rota",
        ],
        sql_types={
            "cd": "integer",
            "filial": "bigint",
            "uf": "text",
            "nome": "text",
            "rota": "text",
        },
        has_cd=True,
    ),
    "db_termo": TableSpec(
        name="db_termo",
        business_columns=[
            "pedido",
            "cd",
            "filial",
            "coddv",
            "descricao",
            "caixa",
            "qtd_separada",
            "num_rota",
            "id_etiqueta",
        ],
        sql_types={
            "pedido": "bigint",
            "cd": "integer",
            "filial": "bigint",
            "coddv": "integer",
            "descricao": "text",
            "caixa": "text",
            "qtd_separada": "integer",
            "num_rota": "text",
            "id_etiqueta": "text",
        },
        has_cd=True,
    ),
}


def get_table_spec(table_name: str) -> TableSpec:
    if table_name not in TABLE_SPECS:
        raise KeyError(f"Unknown table spec: {table_name}")
    return TABLE_SPECS[table_name]
