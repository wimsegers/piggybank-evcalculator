#!/usr/bin/env python3
"""
Eenmalige import van een localStorage-dump (uit de browserconsole) in data.sqlite.

Gebruik:
    python3 import_localstorage.py <bestand.json|bestand.rtf|bestand.txt>

Het bestand is het JSON-object dat de browserconsole toont voor localStorage,
met daarin de sleutel "elektriciteit_data_v2". Een .rtf wordt eerst via
`textutil` (macOS) naar platte tekst omgezet.

Weigert te importeren als de database al maanden of facturen bevat.
"""
import json
import subprocess
import sys

import db


def lees_tekst(pad):
    if pad.lower().endswith('.rtf'):
        return subprocess.run(
            ['textutil', '-convert', 'txt', '-stdout', pad],
            check=True, capture_output=True, text=True,
        ).stdout
    with open(pad, encoding='utf-8') as f:
        return f.read()


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)

    dump = json.loads(lees_tekst(sys.argv[1]))
    if 'elektriciteit_data_v2' not in dump:
        sys.exit(f"Sleutel 'elektriciteit_data_v2' niet gevonden. Aanwezig: {list(dump)}")
    data = json.loads(dump['elektriciteit_data_v2'])
    maanden, facturen = data.get('maanden', {}), data.get('facturen', [])

    db.init_db()
    huidig = db.load_all()
    if huidig['maanden'] or huidig['facturen']:
        sys.exit(
            f"Database bevat al {len(huidig['maanden'])} maanden en {len(huidig['facturen'])} facturen. "
            "Import geweigerd. Verwijder data.sqlite eerst als je echt opnieuw wil beginnen."
        )

    try:
        db.save_data(maanden, facturen)
    except db.OngeldigeData as e:
        sys.exit(f"Import geweigerd, niets opgeslagen: {e}")

    print(f"Geïmporteerd: {len(maanden)} maanden ({', '.join(sorted(maanden))}) en {len(facturen)} facturen.")
    if 'elektriciteit_settings' not in dump:
        print("Let op: geen instellingen in de dump; vul die opnieuw in via Instellingen.")


if __name__ == '__main__':
    main()
