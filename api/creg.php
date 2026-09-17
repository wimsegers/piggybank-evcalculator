<?php
/**
 * Haalt de CREG-tarieven voor thuisladen op van de CREG-website en geeft ze
 * als JSON terug: { vlaanderen: { "2026-Q3": 0.3222, ... }, brussel: {...}, wallonie: {...} }
 *
 * Server-side omdat de browser de CREG-pagina niet rechtstreeks mag ophalen (CORS).
 * Kan de tabel niet gelezen worden, dan is dat een fout; er wordt niets verzonnen.
 */
declare(strict_types=1);
require __DIR__ . '/db.php';

const CREG_URL = 'https://www.creg.be/nl/consumenten/prijzen-en-tarieven/creg-tarief-voor-terugbetaling-thuisladen-bedrijfswagens';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    send_json(405, ['error' => 'Methode niet toegestaan']);
}

$ch = curl_init(CREG_URL);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (piggybank-evcalculator)',
]);
$html = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($html === false || $status !== 200) {
    send_json(502, ['error' => "CREG-pagina niet bereikbaar (HTTP $status" . ($curlError ? ", $curlError" : '') . ')']);
}

$tarieven = parse_creg_tabel($html);
if ($tarieven === null) {
    send_json(502, ['error' => 'Tarieventabel niet gevonden op de CREG-pagina; de pagina is mogelijk van structuur veranderd']);
}

send_json(200, $tarieven);

/**
 * Leest de tabel met kolommen Kwartaal | Vlaanderen | Brussel | Wallonië (in ct/kWh).
 * Geeft null terug als er geen enkele geldige rij gevonden wordt.
 */
function parse_creg_tabel(string $html): ?array
{
    $doc = new DOMDocument();
    libxml_use_internal_errors(true);
    $doc->loadHTML($html);
    libxml_clear_errors();

    $tarieven = ['vlaanderen' => [], 'brussel' => [], 'wallonie' => []];
    $regios = array_keys($tarieven);

    foreach ($doc->getElementsByTagName('tr') as $rij) {
        // De kwartaalcel is een <th>, de tarieven zijn <td>'s
        $cellen = [];
        foreach ($rij->childNodes as $cel) {
            if (in_array($cel->nodeName, ['th', 'td'], true)) {
                $cellen[] = trim($cel->textContent);
            }
        }
        if (count($cellen) < 4 || !preg_match('/^Q([1-4])\/(\d{4})$/', $cellen[0], $m)) {
            continue;
        }
        $kwartaal = "$m[2]-Q$m[1]";
        foreach ($regios as $i => $regio) {
            $cent = str_replace(',', '.', $cellen[$i + 1]);
            if (!is_numeric($cent)) {
                continue;
            }
            $tarieven[$regio][$kwartaal] = round((float) $cent / 100, 4);
        }
    }

    return $tarieven['vlaanderen'] ? $tarieven : null;
}
