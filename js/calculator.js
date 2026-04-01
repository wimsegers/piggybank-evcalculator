/**
 * Calculator module voor elektriciteitsafrekening
 * Berekent de verdeling woning (30%) / wagen (100% CREG)
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
     * @param {number} params.woningPercentage - Percentage vennootschap voor woning (default 30)
     * @returns {Object} berekening met alle tussenresultaten
     */
    function bereken({ totaalBedrag, totaalKwh, wagenKwh, cregTarief, woningPercentage = 30 }) {
        // Wagen: kWh × CREG tarief
        const wagenBedrag = round(wagenKwh * cregTarief);

        // Woning: (totaal factuurbedrag - wagen CREG bedrag) × percentage
        const woningBasis = round(totaalBedrag - wagenBedrag);
        const woningBedrag = round(woningBasis * (woningPercentage / 100));

        // Woning kWh (informatief)
        const woningKwh = round(totaalKwh - wagenKwh, 3);

        // Totaal terugbetaling
        const totaalTerugbetaling = round(wagenBedrag + woningBedrag);

        return {
            // Inputs
            totaalBedrag,
            totaalKwh,
            wagenKwh,
            cregTarief,
            woningPercentage,

            // Wagen
            wagenBedrag,

            // Woning
            woningKwh,
            woningBasis,
            woningBedrag,

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
