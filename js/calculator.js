/**
 * Calculator module voor elektriciteitsafrekening
 *
 * Twee formules, gekozen op basis van de maand:
 * - t/m 2026-07 (oud): kantoor = 30% van de totale factuur, wagen = kWh × CREG
 * - vanaf 2026-08 (nieuw): wagen = kWh × CREG, kantoor = 30% van de woning-kWh × gemiddelde factuurprijs
 *
 * De oude formule blijft bestaan zodat afgesloten maanden niet retroactief veranderen.
 */
const Calculator = (() => {

    const INGANGSDATUM_NIEUWE_FORMULE = '2026-08';

    function getFormule(maand) {
        return maand >= INGANGSDATUM_NIEUWE_FORMULE ? 'nieuw' : 'oud';
    }

    /**
     * Bereken de maandelijkse terugbetaling.
     *
     * @param {Object} params
     * @param {string} params.maand - Maand als 'YYYY-MM', bepaalt welke formule geldt
     * @param {number} params.totaalBedrag - Totaal factuurbedrag (voorschot + afrekening) in EUR
     * @param {number} params.totaalKwh - Totaal verbruik in kWh
     * @param {number} params.wagenKwh - kWh geladen voor de wagen
     * @param {number} params.cregTarief - CREG tarief in EUR/kWh
     * @param {number} params.kantoorPercentage - Percentage beroepsmatig gebruik kantoor (default 30)
     * @returns {Object|null} berekening met alle tussenresultaten, of null als de nodige data ontbreekt
     */
    function bereken({ maand, totaalBedrag, totaalKwh, wagenKwh, cregTarief, kantoorPercentage = 30 }) {
        const formule = getFormule(maand);

        // Wagen: kWh × CREG tarief (in beide formules gelijk)
        const wagenBedrag = round(wagenKwh * cregTarief);

        // Woning kWh
        const woningKwh = round(totaalKwh - wagenKwh, 3);

        let kantoorBedrag, kantoorKwh = null, prijsPerKwh = null;

        if (formule === 'oud') {
            // Kantoor: 30% van de totale factuur
            kantoorBedrag = round(totaalBedrag * (kantoorPercentage / 100));
        } else {
            // Nieuwe formule heeft het totale verbruik nodig om de prijs per kWh te kennen
            if (!totaalKwh || totaalKwh <= 0) return null;

            // Kantoor: 30% van de woning-kWh, tegen de gemiddelde factuurprijs
            prijsPerKwh = totaalBedrag / totaalKwh;
            kantoorKwh = round(woningKwh * (kantoorPercentage / 100), 3);
            kantoorBedrag = round(kantoorKwh * prijsPerKwh);
        }

        // Totaal terugbetaling
        const totaalTerugbetaling = round(kantoorBedrag + wagenBedrag);

        return {
            formule,

            // Inputs
            totaalBedrag,
            totaalKwh,
            wagenKwh,
            cregTarief,
            kantoorPercentage,

            // Kantoor
            kantoorBedrag,
            kantoorKwh,    // enkel bij nieuwe formule
            prijsPerKwh,   // enkel bij nieuwe formule

            // Wagen
            wagenBedrag,

            // Informatief
            woningKwh,

            // Totaal
            totaalTerugbetaling,
        };
    }

    function round(value, decimals = 2) {
        const factor = Math.pow(10, decimals);
        return Math.round(value * factor) / factor;
    }

    return { bereken, getFormule, INGANGSDATUM_NIEUWE_FORMULE };
})();
