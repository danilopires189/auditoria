from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Iterable

import psycopg2
from psycopg2.extras import execute_batch


MONTHS_PT_BR = {
    "jan": "01",
    "fev": "02",
    "mar": "03",
    "abr": "04",
    "mai": "05",
    "jun": "06",
    "jul": "07",
    "ago": "08",
    "set": "09",
    "out": "10",
    "nov": "11",
    "dez": "12",
}


@dataclass(frozen=True)
class ImportRow:
    id: str
    client_event_id: str
    cd: int
    barras: str
    coddv: int
    descricao: str
    endereco_sep: str
    val_mmaa: str
    data_coleta: str
    auditor_id: str
    auditor_mat: str
    auditor_nome: str
    created_at: str
    updated_at: str


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def build_dsn() -> str:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    values = load_env_file(env_path)
    return (
        f"host={values['SUPABASE_DB_HOST']} "
        f"port={values['SUPABASE_DB_PORT']} "
        f"dbname={values['SUPABASE_DB_NAME']} "
        f"user={values['SUPABASE_DB_USER']} "
        f"password={values['SUPABASE_DB_PASSWORD']} "
        f"sslmode=require"
    )


def normalize_barras(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("barras vazio")
    compact = raw.replace(" ", "")
    if "e" in compact.lower():
        normalized_decimal = compact.replace(".", "").replace(",", ".")
        try:
            parsed = Decimal(normalized_decimal)
        except InvalidOperation as exc:
            raise ValueError(f"barras em notação científica inválido: {value}") from exc
        return format(parsed.quantize(Decimal("1")), "f")
    digits = "".join(ch for ch in compact if ch.isdigit())
    if not digits:
        raise ValueError(f"barras inválido: {value}")
    return digits


def normalize_val_mmaa(value: str) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        raise ValueError("val_mmaa vazio")
    if "/" in raw:
        left, right = raw.split("/", 1)
        left = left.strip()
        right = right.strip()
        if left.isdigit():
            month = left.zfill(2)
        else:
            month = MONTHS_PT_BR.get(left[:3])
        if month and right.isdigit() and len(right) == 2:
            return f"{month}/{right}"
    raise ValueError(f"val_mmaa inválido: {value}")


def normalize_text(value: str) -> str:
    return " ".join(str(value or "").strip().split())


def normalize_endereco(value: str) -> str:
    normalized = normalize_text(value).upper()
    if not normalized:
        raise ValueError("endereco_sep vazio")
    return normalized


def parse_row(raw: dict[str, str]) -> ImportRow:
    auditor_nome = normalize_text(raw.get("auditor_nome") or raw.get("auditor_name") or "")
    return ImportRow(
        id=normalize_text(raw["id"]),
        client_event_id=normalize_text(raw["client_event_id"]),
        cd=int(normalize_text(raw["cd"])),
        barras=normalize_barras(raw["barras"]),
        coddv=int(normalize_text(raw["coddv"])),
        descricao=normalize_text(raw["descricao"]),
        endereco_sep=normalize_endereco(raw["endereco_sep"]),
        val_mmaa=normalize_val_mmaa(raw["val_mmaa"]),
        data_coleta=normalize_text(raw["data_coleta"]),
        auditor_id=normalize_text(raw["auditor_id"]),
        auditor_mat=normalize_text(raw["auditor_mat"]),
        auditor_nome=auditor_nome,
        created_at=normalize_text(raw["created_at"]),
        updated_at=normalize_text(raw["updated_at"]),
    )


def load_csv(path: Path) -> tuple[list[ImportRow], list[str]]:
    rows: list[ImportRow] = []
    errors: list[str] = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=";")
        for line_no, raw in enumerate(reader, start=2):
            values = list(raw.values()) if raw else []
            if not any(str(value or "").strip() for value in values):
                continue
            try:
                rows.append(parse_row(raw))
            except Exception as exc:  # noqa: BLE001
                errors.append(f"linha {line_no}: {exc}")
    return rows, errors


def chunked(values: Iterable[ImportRow], size: int) -> Iterable[list[ImportRow]]:
    batch: list[ImportRow] = []
    for value in values:
        batch.append(value)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def fetch_existing_lookup(cur, rows: list[ImportRow]) -> tuple[set[str], set[tuple[int, int, str]], set[str]]:
    client_event_ids = [row.client_event_id for row in rows]
    author_ids = sorted({row.auditor_id for row in rows})
    cd_coddv_pairs = sorted({(row.cd, row.coddv) for row in rows})

    existing_client_ids: set[str] = set()
    valid_sep_keys: set[tuple[int, int, str]] = set()
    valid_authors: set[str] = set()

    for batch in chunked(rows, 1000):
        cur.execute(
            """
            select client_event_id
            from app.ctrl_validade_linha_coletas
            where client_event_id = any(%s)
            """,
            ([row.client_event_id for row in batch],),
        )
        existing_client_ids.update(row[0] for row in cur.fetchall())

    for batch in chunked(author_ids, 1000):
        cur.execute(
            """
            select id::text
            from auth.users
            where id::text = any(%s)
            """,
            (batch,),
        )
        valid_authors.update(row[0] for row in cur.fetchall())

    cur.execute(
        """
        select d.cd, d.coddv, upper(trim(d.endereco)) as endereco_sep
        from app.db_end d
        where upper(trim(coalesce(d.tipo, ''))) = 'SEP'
          and (d.cd, d.coddv) in (
            select * from unnest(%s::int[], %s::int[])
          )
        """,
        (
            [pair[0] for pair in cd_coddv_pairs],
            [pair[1] for pair in cd_coddv_pairs],
        ),
    )
    valid_sep_keys.update((int(cd), int(coddv), str(endereco_sep)) for cd, coddv, endereco_sep in cur.fetchall())

    return existing_client_ids, valid_sep_keys, valid_authors


def chunk_strings(values: Iterable[str], size: int) -> Iterable[list[str]]:
    batch: list[str] = []
    for value in values:
        batch.append(value)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def count_rows_by_client_event_ids(cur, client_event_ids: list[str]) -> int:
    total = 0
    for batch in chunk_strings(client_event_ids, 1000):
        cur.execute(
            """
            select count(*)
            from app.ctrl_validade_linha_coletas
            where client_event_id = any(%s)
            """,
            (batch,),
        )
        total += int(cur.fetchone()[0])
    return total


def insert_rows(cur, rows: list[ImportRow]) -> int:
    payload = [
        (
            row.client_event_id,
            row.cd,
            row.barras,
            row.coddv,
            row.descricao,
            row.endereco_sep,
            row.val_mmaa,
            row.data_coleta,
            row.auditor_id,
            row.auditor_mat,
            row.auditor_nome,
            row.created_at,
            row.updated_at,
        )
        for row in rows
    ]
    execute_batch(
        cur,
        """
        insert into app.ctrl_validade_linha_coletas (
            client_event_id,
            cd,
            barras,
            coddv,
            descricao,
            endereco_sep,
            val_mmaa,
            data_coleta,
            auditor_id,
            auditor_mat,
            auditor_nome,
            created_at,
            updated_at
        )
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (client_event_id) do nothing
        """,
        payload,
        page_size=500,
    )
    return cur.rowcount


def build_default_reject_report_path() -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return Path(__file__).resolve().parents[1] / "logs" / "rejections" / f"ctrl_validade_linha_coletas_import_rejeitadas_{timestamp}.csv"


def write_reject_report(path: Path, errors: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter=";")
        writer.writerow(["error"])
        for error in errors:
            writer.writerow([error])


def main() -> None:
    parser = argparse.ArgumentParser(description="Importa ctrl_validade_linha_coletas a partir de CSV tratado.")
    parser.add_argument(
        "--csv",
        default=str(Path(__file__).resolve().parents[2] / "ctrl_validade_linha_coletas_tratado.csv"),
        help="Caminho do CSV tratado.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Aplica o insert no banco. Sem isso, roda apenas dry-run.",
    )
    parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="Permite inserir somente as linhas válidas mesmo com rejeições.",
    )
    parser.add_argument(
        "--reject-report",
        default="",
        help="Caminho opcional para gravar o relatório de rejeições.",
    )
    args = parser.parse_args()

    csv_path = Path(args.csv).expanduser().resolve()
    if not csv_path.exists():
        raise SystemExit(f"Arquivo não encontrado: {csv_path}")

    rows, parse_errors = load_csv(csv_path)
    print(f"arquivo={csv_path}")
    print(f"linhas_lidas={len(rows)} erros_parse={len(parse_errors)}")
    for error in parse_errors[:20]:
        print(f"ERRO_PARSE {error}")
    if parse_errors:
        raise SystemExit("Importação interrompida por erros de parse.")

    conn = psycopg2.connect(build_dsn())
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            existing_client_ids, valid_sep_keys, valid_authors = fetch_existing_lookup(cur, rows)

            valid_rows: list[ImportRow] = []
            validation_errors: list[str] = []
            skipped_duplicates = 0

            for row in rows:
                if row.client_event_id in existing_client_ids:
                    skipped_duplicates += 1
                    continue
                if row.auditor_id not in valid_authors:
                    validation_errors.append(
                        f"client_event_id={row.client_event_id}: auditor_id inexistente em auth.users ({row.auditor_id})"
                    )
                    continue
                sep_key = (row.cd, row.coddv, row.endereco_sep)
                if sep_key not in valid_sep_keys:
                    validation_errors.append(
                        f"client_event_id={row.client_event_id}: endereco_sep inválido para cd/coddv ({row.cd}, {row.coddv}, {row.endereco_sep})"
                    )
                    continue
                valid_rows.append(row)

            print(f"duplicados_no_banco={skipped_duplicates}")
            print(f"linhas_validas={len(valid_rows)} erros_validacao={len(validation_errors)}")
            for error in validation_errors[:30]:
                print(f"ERRO_VALIDACAO {error}")

            if validation_errors:
                report_path = Path(args.reject_report).expanduser().resolve() if args.reject_report else build_default_reject_report_path()
                write_reject_report(report_path, validation_errors)
                print(f"rejeicoes_salvas_em={report_path}")
                if not args.allow_partial:
                    raise SystemExit("Importação interrompida por erros de validação.")

            if not args.apply:
                conn.rollback()
                print("dry_run=ok")
                return

            insert_rows(cur, valid_rows)
            inserted = count_rows_by_client_event_ids(cur, [row.client_event_id for row in valid_rows])
            conn.commit()
            print(f"inserted={inserted}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
