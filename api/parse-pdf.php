<?php
/**
 * PDF-factuur (FRANK Energie) ontleden via de Anthropic-API.
 * Verwacht POST met JSON {text, apiKey}; geeft de gestructureerde velden terug.
 */
declare(strict_types=1);
require __DIR__ . '/db.php';

const MODEL = 'claude-haiku-4-5-20251001';

const PROMPT = <<<'PROMPT'
Analyseer de volgende tekst uit een FRANK Energie factuur PDF en extraheer de gegevens in JSON formaat.

FRANK Energie heeft twee types facturen:

TYPE 1 - VOORSCHOTFACTUUR:
- Bevat ALLEEN een voorschot voor een toekomstige maand
- Geen afrekening, geen verbruiksoverzicht

TYPE 2 - AFREKENINGSFACTUUR:
- Bevat TWEE componenten:
  A) Een AFREKENING van een voorbije maand (werkelijk verbruik vs eerder betaald voorschot)
  B) Een nieuw VOORSCHOT voor een toekomstige maand

Hoe herken je een afrekeningsfactuur?
- Er staat een verbruiksoverzicht met kWh
- Er staan energiekosten, netkosten, heffingen
- Er staat een eerder betaald voorschot dat verrekend wordt
- Het verschil tussen werkelijke kosten en het voorschot is het afrekeningsbedrag
- Het afrekeningsbedrag kan NEGATIEF zijn (als het voorschot hoger was dan het werkelijke verbruik)

Zoek specifiek naar deze patronen in de tekst:
- "Afrekening voor de periode van DD/MM/YYYY tot DD/MM/YYYY" - dit is de afrekeningsperiode
- "Verbruik", "kWh", energiekosten - indicatie van afrekening
- "Eerder betaald voorschot" of "Reeds betaald" of "Voorschot" (als aftrekpost)
- "Voorschot voor de periode van DD/MM/YYYY tot DD/MM/YYYY" - dit is het nieuwe voorschot
- Het TOTAALBEDRAG van de factuur = afrekeningsbedrag + nieuw voorschotbedrag

Extraheer deze velden (gebruik null als niet gevonden):
- factuurnummer: het factuurnummer
- factuurdatum: datum van de factuur (DD/MM/YYYY)
- isVoorschotFactuur: true als dit ALLEEN een voorschot bevat (geen afrekening)
- isAfrekeningFactuur: true als er een afrekening EN een voorschot in zit

AFREKENING COMPONENT (bij afrekeningsfactuur):
- afrekeningMaand: startmaand van de afrekeningsperiode in "YYYY-MM" formaat
- afrekeningBedrag: het netto afrekeningsbedrag INCLUSIEF BTW (= werkelijke kosten - eerder betaald voorschot). Dit bedrag kan negatief zijn!
- totaalKwh: het NETTO VERBRUIK in kWh (NIET de meterstand!). De factuur bevat een metertabel met kolommen "Vorige meterstand", "Huidige meterstand" en "Verbruik". Gebruik het getal uit de "Verbruik" kolom (het verschil), NIET de meterstand zelf. Of beter: zoek de regel "Elektriciteit alle uren" in de afrekening, daar staat het totaal aantal kWh. Typisch is dit een getal tussen 100 en 5000, NIET een getal boven 10.000 (dat zijn meterstanden)

VOORSCHOT COMPONENT (altijd aanwezig):
- voorschotMaand: startmaand van de voorschotperiode in "YYYY-MM" formaat
- voorschotBedrag: het voorschotbedrag INCLUSIEF BTW (het derde/laatste bedrag als er drie kolommen zijn: excl BTW, BTW, incl BTW)

BELANGRIJK:
- Bij een afrekeningsfactuur MOETEN zowel afrekening- als voorschotvelden ingevuld worden
- Bedragen zijn altijd INCLUSIEF BTW
- Het afrekeningsbedrag is het VERSCHIL (werkelijk - voorschot), niet het totale verbruiksbedrag
- Zoek goed in de hele tekst, de afrekening en het voorschot staan vaak in verschillende secties
- afrekeningMaand MAG NOOIT null zijn bij een afrekeningsfactuur! Zoek de periode in de tekst (bv. "01/01/2026 tot 31/01/2026" = "2026-01"). Als je geen expliciete afrekeningsperiode vindt, leid de maand af: als het voorschot voor maand X is, dan is de afrekening typisch voor maand X-2 (bv. voorschot maart = afrekening januari)

Geef ALLEEN valid JSON terug, geen extra tekst.
PROMPT;

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    send_json(405, ['error' => 'Methode niet toegestaan']);
}

try {
    $data = read_json_body();
} catch (JsonException $e) {
    send_json(400, ['error' => 'Ongeldige JSON: ' . $e->getMessage()]);
}

$pdfText = (string) ($data['text'] ?? '');
$apiKey = (string) ($data['apiKey'] ?? '');

if ($apiKey === '') {
    send_json(400, ['error' => 'API key ontbreekt. Stel deze in bij Instellingen.']);
}
if ($pdfText === '') {
    send_json(400, ['error' => 'Geen PDF tekst ontvangen.']);
}

// ===== Aanroep Anthropic Messages API =====
$ch = curl_init('https://api.anthropic.com/v1/messages');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 120,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'x-api-key: ' . $apiKey,
        'anthropic-version: 2023-06-01',
    ],
    CURLOPT_POSTFIELDS => json_encode([
        'model' => MODEL,
        'max_tokens' => 1024,
        'messages' => [['role' => 'user', 'content' => PROMPT . "\n\nPDF tekst:\n" . $pdfText]],
    ], JSON_THROW_ON_ERROR),
]);
$raw = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($raw === false) {
    send_json(500, ['error' => "Fout bij AI parsing: $curlError"]);
}
if ($status === 401) {
    send_json(401, ['error' => 'Ongeldige API key. Controleer de key in Instellingen.']);
}
if ($status === 429) {
    send_json(429, ['error' => 'API rate limit bereikt. Probeer later opnieuw.']);
}
$response = json_decode($raw, true);
if ($status !== 200) {
    send_json(500, ['error' => 'Fout bij AI parsing: ' . ($response['error']['message'] ?? "HTTP $status")]);
}

$responseText = '';
foreach ($response['content'] ?? [] as $block) {
    if (($block['type'] ?? null) === 'text') {
        $responseText .= $block['text'];
    }
}
$responseText = trim($responseText);

// Markdown-codeblok eromheen weghalen als Claude dat toch toevoegt
if (preg_match('/^```[a-z]*\n(.*?)\n```/s', $responseText, $m)) {
    $responseText = $m[1];
}

try {
    $parsed = json_decode($responseText, true, 512, JSON_THROW_ON_ERROR);
} catch (JsonException $e) {
    send_json(500, ['error' => 'Claude gaf ongeldig JSON terug: ' . $e->getMessage(), 'raw_response' => $responseText]);
}
$parsed['parseSuccess'] = true;
$parsed['parseMethod'] = 'ai';

// Fix totaalKwh: AI verwart vaak meterstanden met verbruik.
// Zoek "Elektriciteit alle uren" in de PDF-tekst voor het juiste getal.
if (preg_match('/Elektriciteit\s+alle\s+uren[\s\S]*?(\d[\d.]*)\s*kWh/i', $pdfText, $m)) {
    $kwh = (int) str_replace('.', '', $m[1]); // Europees formaat: punt = duizendtal
    if ($kwh > 50 && $kwh < 50000) {
        $parsed['totaalKwh'] = $kwh;
    }
}

$details = [];
if (!empty($parsed['isVoorschotFactuur'])) {
    $details[] = 'Type: Voorschotfactuur (AI)';
} elseif (!empty($parsed['isAfrekeningFactuur'])) {
    $details[] = 'Type: Afrekeningsfactuur (AI)';
}
if (!empty($parsed['afrekeningMaand']) && isset($parsed['afrekeningBedrag'])) {
    $details[] = "Afrekening {$parsed['afrekeningMaand']}: €{$parsed['afrekeningBedrag']}";
}
if (isset($parsed['totaalKwh'])) {
    $details[] = "Verbruik: {$parsed['totaalKwh']} kWh";
}
if (!empty($parsed['voorschotMaand']) && isset($parsed['voorschotBedrag'])) {
    $details[] = "Voorschot {$parsed['voorschotMaand']}: €{$parsed['voorschotBedrag']}";
}
$parsed['parseDetails'] = $details;

send_json(200, $parsed);
