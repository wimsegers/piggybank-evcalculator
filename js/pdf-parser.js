/**
 * PDF Parser voor FRANK Energie facturen
 * Ondersteunt twee methodes:
 * 1. AI parsing via Claude API (aanbevolen)
 * 2. Regex parsing als fallback (offline)
 */
const PdfParser = (() => {

    // Stel PDF.js worker in
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    /**
     * Extraheer tekst uit een PDF bestand via PDF.js.
     */
    async function extractText(file) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
        }
        return fullText;
    }

    /**
     * Parse een FRANK Energie factuur PDF.
     * Probeert eerst AI parsing, valt terug op regex.
     *
     * @param {File} file - Het PDF bestand
     * @param {Object} options - { apiKey, method: 'ai'|'regex' }
     * @returns {Promise<Object>} Geparste factuurdata
     */
    async function parseFactuur(file, options = {}) {
        const fullText = await extractText(file);
        const method = options.method || 'ai';
        const apiKey = options.apiKey || '';

        // AI parsing
        if (method === 'ai' && apiKey) {
            try {
                const aiResult = await parseViaAI(fullText, apiKey);
                if (aiResult && aiResult.parseSuccess) {
                    aiResult.raw = fullText;
                    // Fix totaalKwh: AI verwart meterstanden met verbruik
                    // Zoek "Elektriciteit alle uren" in de PDF tekst voor correct getal
                    console.log('[kWh debug] fullText bevat "alle uren":', fullText.toLowerCase().includes('alle uren'));
                    if (fullText.toLowerCase().includes('alle uren')) {
                        const idx = fullText.toLowerCase().indexOf('alle uren');
                        console.log('[kWh debug] context:', JSON.stringify(fullText.substring(Math.max(0, idx - 30), idx + 80)));
                    }
                    const elekMatch = fullText.match(/Elektriciteit\s+alle\s+uren[\s\S]*?(\d[\d.]*)\s*kWh/i);
                    console.log('[kWh debug] regex match:', elekMatch ? elekMatch[0].substring(0, 80) : 'GEEN MATCH');
                    if (elekMatch) {
                        const kwhStr = elekMatch[1].replace(/\./g, '');
                        const correctKwh = parseInt(kwhStr, 10);
                        console.log(`[kWh fix] AI gaf ${aiResult.totaalKwh}, raw match: "${elekMatch[1]}", cleaned: ${kwhStr}, parsed: ${correctKwh}`);
                        if (correctKwh > 50 && correctKwh < 50000) {
                            aiResult.totaalKwh = correctKwh;
                            console.log(`[kWh fix] totaalKwh overschreven naar ${correctKwh}`);
                        }
                    } else {
                        console.log('[kWh debug] GEEN MATCH - eerste 300 chars fullText:', JSON.stringify(fullText.substring(0, 300)));
                    }
                    return aiResult;
                }
            } catch (e) {
                console.warn('AI parsing mislukt, fallback naar regex:', e.message);
            }
        }

        // Regex fallback
        const result = extractFrankData(fullText);
        if (result.parseSuccess) {
            result.parseMethod = 'regex';
        }
        return result;
    }

    /**
     * Parse PDF tekst via Claude API (backend proxy).
     */
    async function parseViaAI(text, apiKey) {
        const response = await fetch('/api/parse-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, apiKey }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }

        return data;
    }

    /**
     * Extraheer data uit FRANK Energie factuur tekst (regex fallback).
     */
    /**
     * Helperfunction: convert DD/MM/YYYY to YYYY-MM
     */
    function dateToMaandKey(dateStr) {
        const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (!match) return null;
        return `${match[3]}-${match[2].padStart(2, '0')}`;
    }

    function extractFrankData(text) {
        const result = {
            factuurnummer: null,
            factuurdatum: null,
            isVoorschotFactuur: false,
            isAfrekeningFactuur: false,
            // New format: separate months for afrekening and voorschot
            afrekeningMaand: null,
            afrekeningBedrag: null,
            totaalKwh: null,
            voorschotMaand: null,
            voorschotBedrag: null,
            raw: text,
            parseSuccess: false,
            parseDetails: [],
        };

        // ===== Type factuur =====
        result.isVoorschotFactuur = /voorschotfactuur/i.test(text);
        result.isAfrekeningFactuur = /afrekeningsfactuur|afrekeningfactuur/i.test(text) && !result.isVoorschotFactuur;

        // ===== Factuurnummer =====
        const fnrMatch = text.match(/Factuurnummer:\s*(\S+)/i);
        if (fnrMatch) result.factuurnummer = fnrMatch[1];

        // ===== Factuurdatum =====
        const fdMatch = text.match(/Factuurdatum:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
        if (fdMatch) result.factuurdatum = fdMatch[1];

        // ===== FRANK: Voorschot regel =====
        // "Voorschot voor de periode van DD/MM/YYYY tot DD/MM/YYYY € X,XX € X,XX € X,XX"
        const voorschotRegelMatch = text.match(
            /Voorschot\s+voor\s+de\s+periode\s+van\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+tot\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*€\s*([\d.,]+)\s*€\s*([\d.,]+)\s*€\s*([\d.,]+)/i
        );

        if (voorschotRegelMatch) {
            const startDate = voorschotRegelMatch[1];
            const inclBtw = parseEuroNumber(voorschotRegelMatch[5]);
            result.voorschotMaand = dateToMaandKey(startDate);
            result.voorschotBedrag = inclBtw;
            result.parseDetails.push(`Voorschot ${result.voorschotMaand}: €${inclBtw}`);
        }

        // ===== kWh verbruik =====
        // Probeer eerst "Elektriciteit alle uren" te vinden (correct verbruik)
        const elekAlleUrenMatch = text.match(/Elektriciteit\s+alle\s+uren[\s\S]*?(\d[\d.]*)\s*kWh/i);
        if (elekAlleUrenMatch) {
            // Europees formaat: punt = duizendtalseparator
            const kwhStr = elekAlleUrenMatch[1].replace(/\./g, '');
            const kwh = parseInt(kwhStr, 10);
            if (kwh > 50 && kwh < 50000) {
                result.totaalKwh = kwh;
                result.parseDetails.push(`Verbruik: ${kwh} kWh`);
            }
        } else {
            // Fallback: eerste kWh getal (minder betrouwbaar)
            const kwhMatch = text.match(/(\d[\d.,]*)\s*kWh/i);
            if (kwhMatch) {
                const kwh = parseEuroNumber(kwhMatch[1]);
                if (kwh !== null && kwh > 0 && kwh < 100000) {
                    result.totaalKwh = kwh;
                    result.parseDetails.push(`Verbruik: ${kwh} kWh`);
                }
            }
        }

        // ===== Afrekening bedrag =====
        const afrekeningMatch = text.match(/(?:Afrekening|Nabetaling|Saldo)[^€]*€\s*([\d.,]+)\s*€\s*([\d.,]+)\s*€\s*([\d.,]+)/i);
        if (afrekeningMatch && result.isAfrekeningFactuur) {
            result.afrekeningBedrag = parseEuroNumber(afrekeningMatch[3]);
            // Try to determine afrekening month from factuurdatum (typically previous month)
            if (result.factuurdatum) {
                const fdParts = result.factuurdatum.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                if (fdParts) {
                    const d = new Date(parseInt(fdParts[3]), parseInt(fdParts[2]) - 2, 1); // month before
                    result.afrekeningMaand = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                }
            }
            result.parseDetails.push(`Afrekening ${result.afrekeningMaand || '?'}: €${result.afrekeningBedrag}`);
        }

        // ===== Parse success =====
        result.parseSuccess = result.voorschotBedrag !== null || result.afrekeningBedrag !== null;

        if (result.parseSuccess) {
            result.parseDetails.unshift(result.isVoorschotFactuur ? 'Type: Voorschotfactuur (regex)' : 'Type: Afrekeningsfactuur (regex)');
        }

        return result;
    }

    /**
     * Parse een Europees geformateerd getal (bv. "1.234,56" of "1234.56")
     */
    function parseEuroNumber(str) {
        if (!str) return null;
        str = str.trim();
        if (str.includes(',') && str.includes('.')) {
            if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
                str = str.replace(/\./g, '').replace(',', '.');
            } else {
                str = str.replace(/,/g, '');
            }
        } else if (str.includes(',')) {
            str = str.replace(',', '.');
        }
        const num = parseFloat(str);
        return isNaN(num) ? null : num;
    }

    return { parseFactuur };
})();
