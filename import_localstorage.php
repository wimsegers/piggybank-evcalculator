#!/usr/bin/env php
<?php
/**
 * Eenmalige import van een localStorage-dump (uit de browserconsole) in data.sqlite.
 *
 * Gebruik:
 *     php import_localstorage.php <bestand.json|bestand.rtf|bestand.txt>
 *
 * Het bestand is het JSON-object dat de browserconsole toont voor localStorage,
 * met daarin de sleutel "elektriciteit_data_v2". Een .rtf wordt eerst via
 * `textutil` (macOS) naar platte tekst omgezet.
 *
 * Weigert te importeren als de database al maanden of facturen bevat.
 */
declare(strict_types=1);
require __DIR__ . '/api/db.php';

if ($argc !== 2) {
    fwrite(STDERR, "Gebruik: php import_localstorage.php <bestand>\n");
    exit(1);
}
$pad = $argv[1];

$tekst = str_ends_with(strtolower($pad), '.rtf')
    ? shell_exec('textutil -convert txt -stdout ' . escapeshellarg($pad))
    : file_get_contents($pad);
if ($tekst === null || $tekst === false) {
    fwrite(STDERR, "Kan $pad niet lezen.\n");
    exit(1);
}

$dump = json_decode($tekst, true, 512, JSON_THROW_ON_ERROR);
if (!isset($dump['elektriciteit_data_v2'])) {
    fwrite(STDERR, "Sleutel 'elektriciteit_data_v2' niet gevonden. Aanwezig: " . implode(', ', array_keys($dump)) . "\n");
    exit(1);
}
$data = json_decode($dump['elektriciteit_data_v2'], true, 512, JSON_THROW_ON_ERROR);
$maanden = $data['maanden'] ?? [];
$facturen = $data['facturen'] ?? [];

$huidig = db_load_all();
$aantalMaanden = count((array) $huidig['maanden']);
if ($aantalMaanden || $huidig['facturen']) {
    fwrite(STDERR, "Database bevat al $aantalMaanden maanden en " . count($huidig['facturen']) . " facturen. "
        . "Import geweigerd. Verwijder data.sqlite eerst als je echt opnieuw wil beginnen.\n");
    exit(1);
}

try {
    db_save_data($maanden, $facturen);
} catch (OngeldigeData $e) {
    fwrite(STDERR, "Import geweigerd, niets opgeslagen: " . $e->getMessage() . "\n");
    exit(1);
}

ksort($maanden);
echo "Geïmporteerd: " . count($maanden) . " maanden (" . implode(', ', array_keys($maanden)) . ") en " . count($facturen) . " facturen.\n";
if (!isset($dump['elektriciteit_settings'])) {
    echo "Let op: geen instellingen in de dump; vul die opnieuw in via Instellingen.\n";
}
