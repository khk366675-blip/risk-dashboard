from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Iterable


SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS stocks (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        market TEXT,
        sector TEXT,
        industry TEXT,
        listing_date TEXT,
        market_cap INTEGER,
        updated_at TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS prices (
        code TEXT NOT NULL,
        date TEXT NOT NULL,
        open INTEGER,
        high INTEGER,
        low INTEGER,
        close INTEGER,
        volume INTEGER,
        ma20 REAL,
        ma60 REAL,
        ma120 REAL,
        ma200 REAL,
        PRIMARY KEY (code, date)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS financials (
        code TEXT NOT NULL,
        year INTEGER NOT NULL,
        report_code TEXT NOT NULL,
        account_nm TEXT NOT NULL,
        thstrm_amount TEXT,
        frmtrm_amount TEXT,
        bfefrmtrm_amount TEXT,
        PRIMARY KEY (code, year, report_code, account_nm)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS valuations (
        code TEXT PRIMARY KEY,
        per REAL,
        pbr REAL,
        psr REAL,
        ev_ebitda REAL,
        dividend_yield REAL,
        market_cap INTEGER,
        ev INTEGER,
        updated_at TEXT,
        ttm_rev REAL,
        ttm_op REAL,
        ttm_ni REAL,
        ttm_ocf REAL,
        ttm_roe REAL,
        debt_ratio REAL,
        ttm_icr REAL,
        dividends_paid REAL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS collector_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    """,
)


def connect_database(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    for statement in SCHEMA:
        connection.execute(statement)
    connection.commit()
    return connection


def insert_many(connection: sqlite3.Connection, sql: str, rows: Iterable[Iterable[Any]]) -> None:
    connection.executemany(sql, rows)


def optimize(connection: sqlite3.Connection) -> None:
    connection.execute("PRAGMA optimize")
    connection.commit()
