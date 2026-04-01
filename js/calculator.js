/**
 * Calculator module voor elektriciteitsafrekening
 * Berekent de verdeling kantoor (30% van totaal) / wagen (CREG uit resterende 70%)
 */
const Calculator = (() => {

    /**
     * Bereken de maandelijkse terugbetaling.
     *
     * @param {Object} params
     * @param {number} params.totaalBedrag - Totaal factuurbedrag (voorschot + afrekening) in EUR
     * @param {number} params.totaalKwh - Totaal verbruik in kWh
     * @param {number} params.wagenKwh - kWh geladen voor de wagen
     * @param {number} params.cregTarief - CREG tarief in EUR/kWh
     * @param {number} params.kantoorPercentage - Percentage beroepsmatig gebruik kantoor (default 30)
     * @returns {Object} berekening met alle tussenresultaten
     */
    function bereken({ totaalBedrag, totaalKwh, wagenKwh, cregTarief, kantoorPercentage = 30 }) {
        // Kantoor: 30% van de totale factuur
        const kantoorBedrag = round(totaalBedrag * (kantoorPercentage / 100));

        // Resterende 70% van de factuur
        const resterendBedrag = round(totaalBedrag - kantoorBedrag);

        // Wagen: kWh × CREG tarief (uit de resterende 70%)
        const wagenBedrag = round(wagenKwh * cregTarief);

        // Woning kWh (informatief)
        const woningKwh = round(totaalKwh - wagenKwh, 3);

        // Totaal terugbetaling
        const totaalTerugbetaling = round(kantoorBedrag + wagenBedrag);

        return {
            // Inputs
            totaalBedrag,
            totaalKwh,
            wagenKwh,
            cregTarief,
            kantoorPercentage,

            // Kantoor
            kantoorBedrag,

            // Wagen
            wagenBedrag,
            resterendBedrag,

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

    return { bereken };
})();
