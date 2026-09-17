/**
 * CREG Tarieven voor thuisladen bedrijfswagens - Vlaanderen
 * Bron: https://www.creg.be/nl/consumenten/prijzen-en-tarieven/creg-tarief-voor-terugbetaling-thuisladen-bedrijfswagens
 */
const CregTarieven = (() => {
    const STORAGE_KEY = 'creg_tarieven';

    // Voorgeladen tarieven (EUR/kWh)
    const DEFAULT_TARIEVEN = {
        vlaanderen: {
            '2025-Q1': 0.2822,
            '2025-Q2': 0.3194,
            '2025-Q3': 0.3456,
            '2025-Q4': 0.3070,
            '2026-Q1': 0.3132,
            '2026-Q2': 0.3191,
        },
        brussel: {
            '2025-Q1': 0.3294,
            '2025-Q2': 0.3585,
            '2025-Q3': 0.3787,
            '2025-Q4': 0.3356,
            '2026-Q1': 0.3426,
            '2026-Q2': 0.3555,
        },
        wallonie: {
            '2025-Q1': 0.3256,
            '2025-Q2': 0.3618,
            '2025-Q3': 0.3843,
            '2025-Q4': 0.3457,
            '2026-Q1': 0.3523,
            '2026-Q2': 0.3636,
        }
    };

    function getStoredTarieven() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
        return DEFAULT_TARIEVEN;
    }

    function saveTarieven(tarieven) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tarieven));
    }

    /**
     * Bepaal kwartaal string (bv "2026-Q1") voor een gegeven maand.
     * @param {string} maand - formaat "YYYY-MM"
     */
    function getKwartaal(maand) {
        const [year, month] = maand.split('-').map(Number);
        const quarter = Math.ceil(month / 3);
        return `${year}-Q${quarter}`;
    }

    /**
     * Haal CREG tarief op voor een bepaalde maand en regio.
     * @param {string} maand - formaat "YYYY-MM"
     * @param {string} regio - "vlaanderen", "brussel", of "wallonie"
     * @returns {number|null} tarief in EUR/kWh of null als niet beschikbaar
     */
    function getTarief(maand, regio = 'vlaanderen') {
        const tarieven = getStoredTarieven();
        const kwartaal = getKwartaal(maand);
        const regioTarieven = tarieven[regio];
        if (regioTarieven && regioTarieven[kwartaal] !== undefined) {
            return regioTarieven[kwartaal];
        }
        return null;
    }

    /**
     * Haal alle tarieven op voor een regio, gesorteerd op kwartaal.
     */
    function getAlleTarieven(regio = 'vlaanderen') {
        const tarieven = getStoredTarieven();
        const regioTarieven = tarieven[regio] || {};
        return Object.entries(regioTarieven)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([kwartaal, tarief]) => ({ kwartaal, tarief }));
    }

    /**
     * Voeg een tarief toe of update een bestaand tarief.
     */
    function setTarief(kwartaal, tarief, regio = 'vlaanderen') {
        const tarieven = getStoredTarieven();
        if (!tarieven[regio]) tarieven[regio] = {};
        tarieven[regio][kwartaal] = tarief;
        saveTarieven(tarieven);
    }

    /**
     * Haal tarieven op via de eigen backend (api/creg.php leest de CREG-website).
     * Nieuwe kwartalen worden samengevoegd met de bestaande tarieven.
     */
    async function fetchTarieven() {
        const response = await fetch('api/creg.php');
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error);
        }

        const bestaande = getStoredTarieven();
        for (const regio of ['vlaanderen', 'brussel', 'wallonie']) {
            bestaande[regio] = { ...bestaande[regio], ...data[regio] };
        }
        saveTarieven(bestaande);

        return bestaande;
    }

    return {
        getTarief,
        getAlleTarieven,
        setTarief,
        getKwartaal,
        fetchTarieven,
        getStoredTarieven,
    };
})();
