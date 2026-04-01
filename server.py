#!/usr/bin/env python3
"""
Backend server voor Afrekeningstool Elektriciteit.
Serveert static files + biedt API endpoint voor PDF parsing via Claude.
"""
import json
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

try:
    import anthropic
except ImportError:
    print("anthropic package niet gevonden. Installeren...")
    os.system(f"{sys.executable} -m pip install anthropic")
    import anthropic


class AfrekeningHandler(SimpleHTTPRequestHandler):
    """HTTP handler die static files serveert en API endpoints biedt."""

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == '/api/parse-pdf':
            self.handle_parse_pdf()
        else:
            self.send_error(404, 'Not Found')

    def handle_parse_pdf(self):
        """Parse PDF text via Claude API."""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            pdf_text = data.get('text', '')
            api_key = data.get('apiKey', '')

            if not api_key:
                self.send_json(400, {'error': 'API key ontbreekt. Stel deze in bij Instellingen.'})
                return

            if not pdf_text:
                self.send_json(400, {'error': 'Geen PDF tekst ontvangen.'})
                return

            # Call Claude API
            client = anthropic.Anthropic(api_key=api_key)

            prompt = f"""Analyseer de volgende tekst uit een FRANK Energie factuur PDF en extraheer de gegevens in JSON formaat.

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

PDF tekst:
{pdf_text}"""

            message = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}],
            )

            response_text = message.content[0].text.strip()

            # Parse JSON from response (handle markdown code blocks)
            if response_text.startswith('```'):
                lines = response_text.split('\n')
                json_lines = []
                in_block = False
                for line in lines:
                    if line.startswith('```') and not in_block:
                        in_block = True
                        continue
                    elif line.startswith('```') and in_block:
                        break
                    elif in_block:
                        json_lines.append(line)
                response_text = '\n'.join(json_lines)

            parsed = json.loads(response_text)
            parsed['parseSuccess'] = True
            parsed['parseMethod'] = 'ai'

            # Fix totaalKwh: AI verwart vaak meterstanden met verbruik
            # Zoek "Elektriciteit alle uren" in de PDF tekst voor het juiste getal
            import re

            # Debug: log of "alle uren" voorkomt in de tekst
            print(f"[DEBUG] 'alle uren' in pdf_text: {'alle uren' in pdf_text.lower()}")
            if 'alle uren' in pdf_text.lower():
                idx = pdf_text.lower().index('alle uren')
                snippet = pdf_text[max(0,idx-30):idx+80]
                print(f"[DEBUG] Context: {repr(snippet)}")

            elek_match = re.search(
                r'Elektriciteit\s+alle\s+uren[\s\S]*?(\d[\d.]*)\s*kWh',
                pdf_text, re.IGNORECASE
            )
            print(f"[DEBUG] Regex match: {elek_match}")
            if elek_match:
                print(f"[DEBUG] Match group(1): {elek_match.group(1)}")
                # Europees formaat: punt = duizendtalseparator
                kwh_str = elek_match.group(1).replace('.', '')
                try:
                    correct_kwh = int(kwh_str)
                    print(f"[DEBUG] correct_kwh: {correct_kwh}, overriding AI value")
                    if 50 < correct_kwh < 50000:
                        parsed['totaalKwh'] = correct_kwh
                except ValueError:
                    pass
            else:
                print(f"[DEBUG] No regex match found! First 500 chars of pdf_text:")
                print(pdf_text[:500])

            # Build parseDetails
            details = []
            if parsed.get('isVoorschotFactuur'):
                details.append('Type: Voorschotfactuur (AI)')
            elif parsed.get('isAfrekeningFactuur'):
                details.append('Type: Afrekeningsfactuur (AI)')
            if parsed.get('afrekeningMaand') and parsed.get('afrekeningBedrag') is not None:
                details.append(f"Afrekening {parsed['afrekeningMaand']}: \u20ac{parsed['afrekeningBedrag']}")
            if parsed.get('totaalKwh') is not None:
                details.append(f"Verbruik: {parsed['totaalKwh']} kWh")
            if parsed.get('voorschotMaand') and parsed.get('voorschotBedrag') is not None:
                details.append(f"Voorschot {parsed['voorschotMaand']}: \u20ac{parsed['voorschotBedrag']}")
            parsed['parseDetails'] = details

            self.send_json(200, parsed)

        except json.JSONDecodeError as e:
            self.send_json(500, {
                'error': f'Claude gaf ongeldig JSON terug: {str(e)}',
                'raw_response': response_text if 'response_text' in dir() else '',
            })
        except anthropic.AuthenticationError:
            self.send_json(401, {'error': 'Ongeldige API key. Controleer de key in Instellingen.'})
        except anthropic.RateLimitError:
            self.send_json(429, {'error': 'API rate limit bereikt. Probeer later opnieuw.'})
        except Exception as e:
            self.send_json(500, {'error': f'Fout bij AI parsing: {str(e)}'})

    def send_json(self, status, data):
        """Send JSON response with CORS headers."""
        response = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(response)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(response)

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def end_headers(self):
        """Add no-cache headers for development."""
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, format, *args):
        """Shorter log format."""
        sys.stderr.write(f"[{self.log_date_time_string()}] {format % args}\n")


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = HTTPServer(('', port), AfrekeningHandler)
    print(f"Server draait op http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer gestopt.")
