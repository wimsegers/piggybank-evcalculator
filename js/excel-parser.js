/**
 * Excel Parser voor laadsessies en export functionaliteit
 * Gebruikt SheetJS (xlsx) library
 */
const ExcelParser = (() => {

    /**
     * Parse laadsessie Excel bestand.
     * Verwacht sheet "Sessies" met kolom E (index 4) = kWh
     *
     * @param {File} file - Het Excel bestand
     * @returns {Promise<Object>} Geparste laadsessie data
     */
    async function parseLaadsessies(file) {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });

        // Zoek de "Sessies" sheet, of neem de eerste
        const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('sessie'))
            || workbook.SheetNames[0];

        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        if (data.length < 2) {
            return { totaalKwh: 0, aantalSessies: 0, sessies: [], parseSuccess: false };
        }

        // Zoek de kWh kolom (standaard kolom E = index 4, maar zoek ook op header)
        const header = data[0];
        let kwhColIndex = 4; // default: kolom E

        for (let i = 0; i < header.length; i++) {
            const h = String(header[i] || '').toLowerCase();
            if (h === 'kwh' || h.includes('kwh') || h.includes('energie')) {
                kwhColIndex = i;
                break;
            }
        }

        // Zoek Van kolom voor datums
        let vanColIndex = 1; // default: kolom B
        for (let i = 0; i < header.length; i++) {
            const h = String(header[i] || '').toLowerCase();
            if (h === 'van' || h.includes('start') || h.includes('begin')) {
                vanColIndex = i;
                break;
            }
        }

        const sessies = [];
        let totaalKwh = 0;

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row || row.length === 0) continue;

            const kwhValue = parseFloat(row[kwhColIndex]);
            if (isNaN(kwhValue)) continue;

            totaalKwh += kwhValue;
            sessies.push({
                datum: row[vanColIndex] || '',
                kwh: kwhValue,
            });
        }

        return {
            totaalKwh: Math.round(totaalKwh * 1000) / 1000,
            aantalSessies: sessies.length,
            sessies,
            sheetName,
            parseSuccess: true,
        };
    }

    /**
     * Exporteer maandoverzicht naar Excel voor de boekhouder.
     *
     * @param {Array} maanden - Array van maanddata objecten
     * @param {Object} settings - Instellingen (vennootschap naam, etc.)
     */
    function exportOverzicht(maanden, settings = {}) {
        const wb = XLSX.utils.book_new();

        // Kleuren uit de tool (als hex voor Excel)
        const primaryColor = '6C5CE7';   // paars
        const primaryBg = 'ECEAFD';      // licht paars
        const successColor = '00B894';    // groen
        const successBg = 'E0F7F1';      // licht groen
        const headerBg = '6C5CE7';       // paars header
        const headerFont = 'FFFFFF';     // wit
        const totaalBg = 'ECEAFD';       // licht paars
        const betaaldBg = 'E0F7F1';      // licht groen

        // Helper: style een cel
        function styleCell(ws, ref, style) {
            if (!ws[ref]) ws[ref] = { v: '', t: 's' };
            ws[ref].s = { ...(ws[ref].s || {}), ...style };
        }

        // === Sheet 1: Overzicht ===
        const overzichtData = [
            ['Afrekeningstool Elektriciteit - ' + (settings.vennootschap || 'Piggy Bank VOF')],
            ['Gegenereerd op: ' + new Date().toLocaleDateString('nl-BE')],
            [],
            [
                'Maand',
                'Factuur (EUR)',
                'Verbruik (kWh)',
                'Wagen kWh',
                'Woning kWh',
                'CREG Tarief (EUR/kWh)',
                'Woning 30% (EUR)',
                'Wagen CREG (EUR)',
                'Totaal Terugbetaling (EUR)',
                'Status',
                'Betaaldatum',
            ],
        ];

        let totaalFactuur = 0;
        let totaalVerbruik = 0;
        let totaalWagenKwh = 0;
        let totaalWoningKwh = 0;
        let totaalWoning = 0;
        let totaalWagen = 0;
        let totaalTerugbetaling = 0;

        for (const m of maanden) {
            const calc = m.berekening || {};
            totaalFactuur += m.totaalBedrag || 0;
            totaalVerbruik += m.totaalKwh || 0;
            totaalWagenKwh += m.wagenKwh || 0;
            totaalWoningKwh += calc.woningKwh || 0;
            totaalWoning += calc.woningBedrag || 0;
            totaalWagen += calc.wagenBedrag || 0;
            totaalTerugbetaling += calc.totaalTerugbetaling || 0;

            overzichtData.push([
                formatMaandLabel(m.maand),
                m.totaalBedrag || 0,
                m.totaalKwh || 0,
                m.wagenKwh || 0,
                calc.woningKwh || 0,
                m.cregTarief || 0,
                calc.woningBedrag || 0,
                calc.wagenBedrag || 0,
                calc.totaalTerugbetaling || 0,
                m.betaald ? 'Betaald' : 'Openstaand',
                m.betaalDatum || '',
            ]);
        }

        // Lege rij + totaalrij
        overzichtData.push([]);
        const totaalRowIdx = overzichtData.length; // 0-indexed rij
        overzichtData.push([
            'TOTAAL',
            totaalFactuur,
            totaalVerbruik,
            totaalWagenKwh,
            totaalWoningKwh,
            '',
            totaalWoning,
            totaalWagen,
            totaalTerugbetaling,
            '',
            '',
        ]);

        const ws = XLSX.utils.aoa_to_sheet(overzichtData);

        // Kolom breedtes
        ws['!cols'] = [
            { wch: 15 }, // Maand
            { wch: 14 }, // Factuur
            { wch: 14 }, // Verbruik
            { wch: 12 }, // Wagen kWh
            { wch: 12 }, // Woning kWh
            { wch: 18 }, // CREG Tarief
            { wch: 16 }, // Woning 30%
            { wch: 16 }, // Wagen CREG
            { wch: 22 }, // Totaal
            { wch: 12 }, // Status
            { wch: 14 }, // Betaaldatum
        ];

        // Styling Sheet 1
        const boldStyle = { font: { bold: true } };
        const headerStyle = {
            font: { bold: true, color: { rgb: headerFont } },
            fill: { fgColor: { rgb: headerBg } },
            alignment: { horizontal: 'center' },
        };
        const totaalStyle = {
            font: { bold: true },
            fill: { fgColor: { rgb: totaalBg } },
        };
        const euroFmt = '#,##0.00\\ "€"';
        const euroCols = [1, 6, 7, 8]; // B, G, H, I

        // Rij 1 (titel) bold
        styleCell(ws, 'A1', boldStyle);

        // Rij 4 (header) bold + paarse achtergrond
        const cols = 'ABCDEFGHIJK';
        for (const c of cols) {
            styleCell(ws, `${c}4`, headerStyle);
        }

        // Data rijen: euro-formaat op kolommen B, G, H, I
        for (let r = 4; r < overzichtData.length; r++) {
            for (const ci of euroCols) {
                const cellRef = XLSX.utils.encode_cell({ r, c: ci });
                if (ws[cellRef] && typeof ws[cellRef].v === 'number') {
                    ws[cellRef].z = euroFmt;
                }
            }
            // Status kolom kleur
            const statusRef = XLSX.utils.encode_cell({ r, c: 9 });
            if (ws[statusRef] && ws[statusRef].v === 'Betaald') {
                ws[statusRef].s = { font: { color: { rgb: successColor }, bold: true } };
            }
        }

        // Totaal rij bold + licht paarse achtergrond + euro formaat
        for (let c = 0; c < 11; c++) {
            const cellRef = XLSX.utils.encode_cell({ r: totaalRowIdx, c });
            styleCell(ws, cellRef, totaalStyle);
            if (euroCols.includes(c) && ws[cellRef] && typeof ws[cellRef].v === 'number') {
                ws[cellRef].z = euroFmt;
            }
        }

        XLSX.utils.book_append_sheet(wb, ws, 'Overzicht');

        // === Sheet 2: Berekeningsdetail ===
        const detailData = [
            ['Berekeningsdetail per maand'],
            [],
            ['Formules:'],
            ['Woning: (Totaal factuurbedrag - Wagen CREG bedrag) x 30%'],
            ['Wagen: kWh laadsessies x CREG tarief per kwartaal (Vlaanderen)'],
            [],
        ];

        const maandHeaderRows = []; // track rij-indices van maand headers
        const totaalRows = [];     // track rij-indices van totaal regels

        for (const m of maanden) {
            const calc = m.berekening || {};
            const woningKwh = (m.totaalKwh || 0) - (m.wagenKwh || 0);

            maandHeaderRows.push(detailData.length);
            detailData.push([`${formatMaandLabel(m.maand)}`]);
            detailData.push(['Totaal factuur:', `EUR ${(m.totaalBedrag || 0).toFixed(2)}`]);
            detailData.push(['  Voorschot:', `EUR ${(m.voorschot || 0).toFixed(2)}`]);
            detailData.push(['  Afrekening:', `EUR ${(m.afrekening || 0).toFixed(2)}`]);
            detailData.push(['Totaal verbruik:', `${(m.totaalKwh || 0).toFixed(3)} kWh`]);
            detailData.push(['Wagen verbruik:', `${(m.wagenKwh || 0).toFixed(3)} kWh`]);
            detailData.push(['Woning verbruik:', `${woningKwh.toFixed(3)} kWh`]);
            detailData.push(['CREG tarief:', `EUR ${(m.cregTarief || 0).toFixed(4)}/kWh (${CregTarieven.getKwartaal(m.maand)})`]);
            detailData.push([]);
            detailData.push(['Wagen CREG:', `${(m.wagenKwh || 0).toFixed(3)} x ${(m.cregTarief || 0).toFixed(4)} = EUR ${(calc.wagenBedrag || 0).toFixed(2)}`]);
            detailData.push(['Woning basis:', `${(m.totaalBedrag || 0).toFixed(2)} - ${(calc.wagenBedrag || 0).toFixed(2)} = EUR ${(calc.woningBasis || 0).toFixed(2)}`]);
            detailData.push(['Woning 30%:', `${(calc.woningBasis || 0).toFixed(2)} x 30% = EUR ${(calc.woningBedrag || 0).toFixed(2)}`]);
            totaalRows.push(detailData.length);
            detailData.push(['Totaal terug te vorderen vennootschap:', `EUR ${(calc.totaalTerugbetaling || 0).toFixed(2)}`]);
            detailData.push([]);
        }

        const ws2 = XLSX.utils.aoa_to_sheet(detailData);
        ws2['!cols'] = [{ wch: 40 }, { wch: 50 }];

        // Styling Sheet 2
        // Titel bold
        styleCell(ws2, 'A1', { font: { bold: true, sz: 14 } });

        // Maand headers: bold + paarse achtergrond
        for (const r of maandHeaderRows) {
            const ref = XLSX.utils.encode_cell({ r, c: 0 });
            styleCell(ws2, ref, {
                font: { bold: true, color: { rgb: headerFont } },
                fill: { fgColor: { rgb: headerBg } },
            });
            const ref2 = XLSX.utils.encode_cell({ r, c: 1 });
            styleCell(ws2, ref2, {
                fill: { fgColor: { rgb: headerBg } },
            });
        }

        // Totaal regels: bold + licht paarse achtergrond
        for (const r of totaalRows) {
            for (let c = 0; c < 2; c++) {
                const ref = XLSX.utils.encode_cell({ r, c });
                styleCell(ws2, ref, {
                    font: { bold: true },
                    fill: { fgColor: { rgb: totaalBg } },
                });
            }
        }

        XLSX.utils.book_append_sheet(wb, ws2, 'Detail');

        // Download
        const fileName = `Afrekening_Elektriciteit_${new Date().toISOString().slice(0, 10)}.xlsx`;
        XLSX.writeFile(wb, fileName);

        return fileName;
    }

    function formatMaandLabel(maand) {
        if (!maand) return '';
        const [year, month] = maand.split('-');
        const maandNamen = ['', 'Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni',
            'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December'];
        return `${maandNamen[parseInt(month)]} ${year}`;
    }

    return { parseLaadsessies, exportOverzicht, formatMaandLabel };
})();
