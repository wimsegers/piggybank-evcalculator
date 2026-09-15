"""
SQLite-opslag voor de Afrekeningstool.

Vervangt de vroegere localStorage-opslag in de browser. De kolomnamen volgen
bewust de veldnamen uit app.js (camelCase), zodat er geen vertaallaag nodig is.
"""
import json
import os
import sqlite3

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data.sqlite')

MAAND_KOLOMMEN = [
    'maand', 'voorschotBedrag', 'voorschotBron', 'afrekeningBedrag', 'afrekeningBron',
    'totaalKwh', 'wagenKwh', 'aantalSessies', 'cregTarief', 'betaald', 'betaalDatum',
]
# 'berekening' wordt niet opgeslagen: app.js herberekent alles bij het laden.
MAAND_GENEGEERD = {'berekening'}

FACTUUR_KOLOMMEN = [
    'factuurdatum', 'afrekeningMaand', 'afrekeningBedrag',
    'voorschotMaand', 'voorschotBedrag', 'verwerkt',
]


class OngeldigeData(ValueError):
    """Data uit de browser past niet in het schema; niets wordt opgeslagen."""


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS maanden (
                maand            TEXT PRIMARY KEY,
                voorschotBedrag  REAL,
                voorschotBron    TEXT,
                afrekeningBedrag REAL,
                afrekeningBron   TEXT,
                totaalKwh        REAL,
                wagenKwh         REAL,
                aantalSessies    INTEGER NOT NULL DEFAULT 0,
                cregTarief       REAL,
                betaald          INTEGER NOT NULL DEFAULT 0,
                betaalDatum      TEXT
            );
            CREATE TABLE IF NOT EXISTS facturen (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                factuurdatum     TEXT,
                afrekeningMaand  TEXT,
                afrekeningBedrag REAL,
                voorschotMaand   TEXT,
                voorschotBedrag  REAL,
                verwerkt         TEXT
            );
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)


def _controleer_velden(rij, toegestaan, genegeerd, context):
    onbekend = set(rij) - set(toegestaan) - genegeerd
    if onbekend:
        raise OngeldigeData(f"Onbekende velden in {context}: {sorted(onbekend)}")


def load_all():
    with connect() as conn:
        maanden = {}
        for r in conn.execute("SELECT * FROM maanden ORDER BY maand"):
            m = dict(r)
            m['betaald'] = bool(m['betaald'])
            m['berekening'] = None
            maanden[m['maand']] = m

        facturen = []
        for r in conn.execute("SELECT * FROM facturen ORDER BY id"):
            f = dict(r)
            del f['id']
            facturen.append(f)

        settings = {r['key']: json.loads(r['value']) for r in conn.execute("SELECT * FROM settings")}

    return {'maanden': maanden, 'facturen': facturen, 'settings': settings}


def save_data(maanden, facturen):
    """Vervangt de volledige inhoud van maanden en facturen in één transactie."""
    if not isinstance(maanden, dict) or not isinstance(facturen, list):
        raise OngeldigeData("Verwacht 'maanden' als object en 'facturen' als lijst")

    maand_rijen = []
    for key, m in maanden.items():
        _controleer_velden(m, MAAND_KOLOMMEN, MAAND_GENEGEERD, f"maand {key}")
        if m.get('maand') != key:
            raise OngeldigeData(f"Sleutel {key} komt niet overeen met veld maand={m.get('maand')}")
        maand_rijen.append([m.get(k) for k in MAAND_KOLOMMEN])

    factuur_rijen = []
    for i, f in enumerate(facturen):
        _controleer_velden(f, FACTUUR_KOLOMMEN, set(), f"factuur #{i}")
        factuur_rijen.append([f.get(k) for k in FACTUUR_KOLOMMEN])

    with connect() as conn:
        conn.execute("DELETE FROM maanden")
        conn.execute("DELETE FROM facturen")
        conn.executemany(
            f"INSERT INTO maanden ({', '.join(MAAND_KOLOMMEN)}) VALUES ({', '.join('?' * len(MAAND_KOLOMMEN))})",
            maand_rijen,
        )
        conn.executemany(
            f"INSERT INTO facturen ({', '.join(FACTUUR_KOLOMMEN)}) VALUES ({', '.join('?' * len(FACTUUR_KOLOMMEN))})",
            factuur_rijen,
        )


def save_settings(settings):
    if not isinstance(settings, dict):
        raise OngeldigeData("Verwacht 'settings' als object")
    with connect() as conn:
        conn.execute("DELETE FROM settings")
        conn.executemany(
            "INSERT INTO settings (key, value) VALUES (?, ?)",
            [(k, json.dumps(v)) for k, v in settings.items()],
        )
