from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TableProfileEntry:
    table_name: str
    workbook_file: str
    workbook_sheet: str
    csv_target: str | None = None
    csv_usecols: list[str] | None = None

    @property
    def requires_csv_conversion(self) -> bool:
        return bool(self.csv_target)


TABLE_PROFILE: tuple[TableProfileEntry, ...] = (
    TableProfileEntry(
        table_name="db_barras",
        workbook_file="DB_BARRAS.xlsx",
        workbook_sheet="DB_BARRAS",
    ),
    TableProfileEntry(
        table_name="db_custo",
        workbook_file="DB_CUSTO.xlsx",
        workbook_sheet="BD_CUSTO",
    ),
    TableProfileEntry(
        table_name="db_log_end",
        workbook_file="DB_LOG_END.xlsx",
        workbook_sheet="DB_LOG_END",
    ),
    TableProfileEntry(
        table_name="db_end",
        workbook_file="BD_END.xlsx",
        workbook_sheet="DB_END",
    ),
    TableProfileEntry(
        table_name="db_estq_entr",
        workbook_file="DB_ESTQ_ENTR.xlsx",
        workbook_sheet="DB_ESTQ_ENTR",
    ),
    TableProfileEntry(
        table_name="db_usuario",
        workbook_file="DB_USUARIO.xlsx",
        workbook_sheet="DB_USUARIO",
    ),
    TableProfileEntry(
        table_name="db_rotas",
        workbook_file="BD_ROTAS.xlsx",
        workbook_sheet="BD_ROTAS",
    ),
    TableProfileEntry(
        table_name="db_prod_vol",
        workbook_file="DB_PROD_VOL.xlsx",
        workbook_sheet="DB_PROD_VOL",
    ),
    TableProfileEntry(
        table_name="db_gestao_estq",
        workbook_file="DB_GESTAO_ESTQ.xlsx",
        workbook_sheet="DB_GESTAO_ESTQ",
    ),
    TableProfileEntry(
        table_name="db_termo",
        workbook_file="DB_TERMO.xlsx",
        workbook_sheet="DB_TERMO",
    ),
    TableProfileEntry(
        table_name="db_avulso",
        workbook_file="BD_AVULSO.xlsx",
        workbook_sheet="DB_AVULSO",
    ),
)

TABLE_PROFILE_BY_NAME: dict[str, TableProfileEntry] = {
    item.table_name: item for item in TABLE_PROFILE
}


def profile_table_names() -> list[str]:
    return [item.table_name for item in TABLE_PROFILE]


def get_table_profile_entry(table_name: str) -> TableProfileEntry:
    if table_name not in TABLE_PROFILE_BY_NAME:
        raise KeyError(f"Table not supported by automation profile: {table_name}")
    return TABLE_PROFILE_BY_NAME[table_name]


def resolve_profile_tables(table_names: list[str] | None = None) -> list[str]:
    if table_names is None:
        return profile_table_names()

    normalized: list[str] = []
    seen: set[str] = set()
    for raw_name in table_names:
        name = str(raw_name).strip().lower()
        if not name:
            continue
        if name not in TABLE_PROFILE_BY_NAME:
            raise ValueError(f"Unsupported table for automation profile: {name}")
        if name not in seen:
            normalized.append(name)
            seen.add(name)
    return normalized
