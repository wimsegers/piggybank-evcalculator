<?php
/**
 * SQLite-opslag voor de Afrekeningstool (gedeeld door de API-endpoints).
 *
 * De kolomnamen volgen bewust de veldnamen uit app.js (camelCase),
 * zodat er geen vertaallaag nodig is.
 */
declare(strict_types=1);

const DB_PATH = __DIR__ . '/../data.sqlite';

const MAAND_KOLOMMEN = [
    'maand', 'voorschotBedrag', 'voorschotBron', 'afrekeningBedrag', 'afrekeningBron',
    'totaalKwh', 'wagenKwh', 'aantalSessies', 'cregTarief', 'betaald', 'betaalDatum',
];
// 'berekening' wordt niet opgeslagen: app.js herberekent alles bij het laden.
const MAAND_GENEGEERD = ['berekening'];

const FACTUUR_KOLOMMEN = [
    'factuurdatum', 'afrekeningMaand', 'afrekeningBedrag',
    'voorschotMaand', 'voorschotBedrag', 'verwerkt',
];

/** Data uit de browser past niet in het schema; niets wordt opgeslagen. */
class OngeldigeData extends InvalidArgumentException {}

function db_connect(): PDO
{
    $pdo = new PDO('sqlite:' . DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('
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
    ');
    return $pdo;
}

function controleer_velden(array $rij, array $toegestaan, array $genegeerd, string $context): void
{
    $onbekend = array_diff(array_keys($rij), $toegestaan, $genegeerd);
    if ($onbekend) {
        throw new OngeldigeData("Onbekende velden in $context: " . implode(', ', $onbekend));
    }
}

function db_load_all(): array
{
    $pdo = db_connect();

    $maanden = [];
    foreach ($pdo->query('SELECT * FROM maanden ORDER BY maand') as $m) {
        $m['betaald'] = (bool) $m['betaald'];
        $m['berekening'] = null;
        $maanden[$m['maand']] = $m;
    }

    $facturen = [];
    foreach ($pdo->query('SELECT * FROM facturen ORDER BY id') as $f) {
        unset($f['id']);
        $facturen[] = $f;
    }

    $settings = [];
    foreach ($pdo->query('SELECT key, value FROM settings') as $s) {
        $settings[$s['key']] = json_decode($s['value'], true, 512, JSON_THROW_ON_ERROR);
    }

    // (object)-cast zodat lege verzamelingen als {} en niet als [] naar de browser gaan.
    return ['maanden' => (object) $maanden, 'facturen' => $facturen, 'settings' => (object) $settings];
}

/** Vervangt de volledige inhoud van maanden en facturen in één transactie. */
function db_save_data(mixed $maanden, mixed $facturen): void
{
    if (!is_array($maanden) || ($maanden && array_is_list($maanden))) {
        throw new OngeldigeData("Verwacht 'maanden' als object");
    }
    if (!is_array($facturen) || ($facturen && !array_is_list($facturen))) {
        throw new OngeldigeData("Verwacht 'facturen' als lijst");
    }

    $maandRijen = [];
    foreach ($maanden as $key => $m) {
        if (!is_array($m)) {
            throw new OngeldigeData("Maand $key is geen object");
        }
        controleer_velden($m, MAAND_KOLOMMEN, MAAND_GENEGEERD, "maand $key");
        if (($m['maand'] ?? null) !== $key) {
            throw new OngeldigeData("Sleutel $key komt niet overeen met veld maand=" . ($m['maand'] ?? 'null'));
        }
        $maandRijen[] = array_map(fn($k) => $m[$k] ?? null, MAAND_KOLOMMEN);
    }

    $factuurRijen = [];
    foreach ($facturen as $i => $f) {
        if (!is_array($f)) {
            throw new OngeldigeData("Factuur #$i is geen object");
        }
        controleer_velden($f, FACTUUR_KOLOMMEN, [], "factuur #$i");
        $factuurRijen[] = array_map(fn($k) => $f[$k] ?? null, FACTUUR_KOLOMMEN);
    }

    $pdo = db_connect();
    $pdo->beginTransaction();
    try {
        $pdo->exec('DELETE FROM maanden');
        $pdo->exec('DELETE FROM facturen');
        $insert = $pdo->prepare(sprintf(
            'INSERT INTO maanden (%s) VALUES (%s)',
            implode(', ', MAAND_KOLOMMEN),
            implode(', ', array_fill(0, count(MAAND_KOLOMMEN), '?'))
        ));
        foreach ($maandRijen as $rij) {
            $rij[array_search('betaald', MAAND_KOLOMMEN)] = (int) (bool) $rij[array_search('betaald', MAAND_KOLOMMEN)];
            $insert->execute($rij);
        }
        $insert = $pdo->prepare(sprintf(
            'INSERT INTO facturen (%s) VALUES (%s)',
            implode(', ', FACTUUR_KOLOMMEN),
            implode(', ', array_fill(0, count(FACTUUR_KOLOMMEN), '?'))
        ));
        foreach ($factuurRijen as $rij) {
            $insert->execute($rij);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function db_save_settings(mixed $settings): void
{
    if (!is_array($settings) || ($settings && array_is_list($settings))) {
        throw new OngeldigeData("Verwacht 'settings' als object");
    }
    $pdo = db_connect();
    $pdo->beginTransaction();
    try {
        $pdo->exec('DELETE FROM settings');
        $insert = $pdo->prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
        foreach ($settings as $key => $value) {
            $insert->execute([$key, json_encode($value, JSON_THROW_ON_ERROR)]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

// ===== HTTP-hulpfuncties voor de endpoints =====

function send_json(int $status, mixed $data): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-cache, no-store, must-revalidate');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function read_json_body(): mixed
{
    return json_decode(file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
}

/** Voert $opslaan uit op de JSON-body en antwoordt met ok of een foutmelding. */
function handle_save(callable $opslaan): never
{
    try {
        $opslaan(read_json_body());
        send_json(200, ['ok' => true]);
    } catch (JsonException | OngeldigeData $e) {
        send_json(400, ['error' => 'Ongeldige data, niets opgeslagen: ' . $e->getMessage()]);
    } catch (Throwable $e) {
        send_json(500, ['error' => 'Opslaan mislukt: ' . $e->getMessage()]);
    }
}
