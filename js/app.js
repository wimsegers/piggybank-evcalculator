/**
 * Afrekeningstool Elektriciteit - Hoofd Applicatie
 *
 * Data model:
 * - maanden[]: per kalendermaand (YYYY-MM) worden voorschot en afrekening
 *   apart bijgehouden. Ze komen typisch van verschillende FRANK Energie facturen.
 *   Een maand is "compleet" als zowel voorschot, afrekening, als laadsessies bekend zijn.
 *
 * - facturen[]: log van verwerkte facturen (voor referentie)
 */
const App = (() => {
    let state = {
        maanden: {},   // key = "YYYY-MM", value = maandData
        facturen: [],  // log van verwerkte facturen
    };

    let settings = {
        regio: 'vlaanderen',
        kantoorPercentage: 30,
        vennootschap: 'Piggy Bank VOF',
        apiKey: '',
        parseMethod: 'ai',
    };

    // ===== Maand data template =====
    function createMaandData(maand) {
        return {
            maand,
            // Voorschot: betaald VOOR deze maand (komt van een eerdere factuur)
            voorschotBedrag: null,
            voorschotBron: null,  // factuurdatum van herkomst

            // Afrekening: verrekening VAN deze maand (komt van een latere factuur)
            afrekeningBedrag: null,
            afrekeningBron: null,
            totaalKwh: null,      // kWh verbruik van deze maand (uit afrekening)

            // Laadsessies wagen
            wagenKwh: null,
            aantalSessies: 0,
            cregTarief: null,

            // Berekend
            berekening: null,

            // Status
            betaald: false,
            betaalDatum: null,
        };
    }

    function getMaand(maandKey) {
        if (!state.maanden[maandKey]) {
            state.maanden[maandKey] = createMaandData(maandKey);
        }
        return state.maanden[maandKey];
    }

    function getMaandStatus(m) {
        const heeftVoorschot = m.voorschotBedrag !== null;
        const heeftAfrekening = m.afrekeningBedrag !== null;
        const heeftLaadsessies = m.wagenKwh !== null && m.wagenKwh > 0;
        const heeftBerekening = m.berekening !== null;

        if (heeftBerekening && m.betaald) return 'betaald';
        if (heeftBerekening) return 'compleet';
        if (heeftVoorschot && heeftAfrekening && !heeftLaadsessies) return 'wacht_laadsessies';
        if (heeftVoorschot && !heeftAfrekening) return 'wacht_afrekening';
        if (!heeftVoorschot && heeftAfrekening) return 'wacht_voorschot';
        return 'incompleet';
    }

    function getTotaalKost(m) {
        return (m.voorschotBedrag || 0) + (m.afrekeningBedrag || 0);
    }

    function berekenMaand(m) {
        const totaalBedrag = getTotaalKost(m);
        if (totaalBedrag <= 0 && m.voorschotBedrag === null) return null;
        if (m.wagenKwh === null || m.cregTarief === null) return null;

        return Calculator.bereken({
            maand: m.maand,
            totaalBedrag,
            totaalKwh: m.totaalKwh || 0,
            wagenKwh: m.wagenKwh || 0,
            cregTarief: m.cregTarief,
            kantoorPercentage: settings.kantoorPercentage,
        });
    }

    // ===== Initialization =====
    async function init() {
        try {
            await loadAll();
        } catch (e) {
            showToast('Kan data niet laden van de server: ' + e.message);
            console.error(e);
            return;
        }
        recalcAll(); // herbereken alle maanden met nieuwe formule
        setupEventListeners();
        renderDashboard();
        renderCregTabel();
        renderSettings();
    }

    function recalcAll() {
        for (const m of Object.values(state.maanden)) {
            m.berekening = berekenMaand(m);
        }
        saveData();
    }

    // ===== Opslag (SQLite via api/*.php) =====
    async function loadAll() {
        const response = await fetch('api/data.php');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        state.maanden = data.maanden;
        state.facturen = data.facturen;
        settings = { ...settings, ...data.settings };
    }

    async function putJson(url, body) {
        try {
            const response = await fetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${response.status}`);
            }
        } catch (e) {
            showToast('Opslaan mislukt: ' + e.message);
            console.error(e);
        }
    }

    function saveData() {
        return putJson('api/data.php', {
            maanden: state.maanden,
            facturen: state.facturen,
        });
    }

    function saveSettings() {
        return putJson('api/settings.php', settings);
    }

    // ===== Event Listeners =====
    function setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                navigateTo(item.dataset.page);
            });
        });

        // Header buttons
        document.getElementById('btnNieuweFactuur').addEventListener('click', openFactuurModal);
        document.getElementById('btnExport').addEventListener('click', exportExcel);

        // Factuur modal
        document.getElementById('btnCloseFactuur').addEventListener('click', closeFactuurModal);
        document.getElementById('btnCancelFactuur').addEventListener('click', closeFactuurModal);
        document.getElementById('btnOpslaanFactuur').addEventListener('click', opslaanFactuur);
        setupUploadZone('uploadFactuur', 'fileFactuur', handleFactuurUpload);

        // Laadsessies modal
        document.getElementById('btnCloseLaadsessies').addEventListener('click', closeLaadsessiesModal);
        document.getElementById('btnCancelLaadsessies').addEventListener('click', closeLaadsessiesModal);
        document.getElementById('btnOpslaanLaadsessies').addEventListener('click', opslaanLaadsessies);
        setupUploadZone('uploadLaadsessies', 'fileLaadsessies', handleLaadsessiesUpload);

        // Detail modal
        document.getElementById('btnCloseDetail').addEventListener('click', closeDetailModal);
        document.getElementById('btnCloseDetail2').addEventListener('click', closeDetailModal);
        document.getElementById('btnDeleteMaand').addEventListener('click', deleteMaand);

        // Modal overlay clicks
        ['modalFactuur', 'modalLaadsessies', 'modalDetail'].forEach(id => {
            document.getElementById(id).addEventListener('click', (e) => {
                if (e.target === e.currentTarget) {
                    document.getElementById(id).classList.add('hidden');
                }
            });
        });

        // Update samenvatting when fields change
        ['inputAfrekeningBedrag', 'inputVoorschotBedrag', 'inputAfrekeningMaand', 'inputVoorschotMaand'].forEach(id => {
            document.getElementById(id).addEventListener('input', updateFactuurSamenvatting);
            document.getElementById(id).addEventListener('change', updateFactuurSamenvatting);
        });

        // CREG tarieven
        document.getElementById('btnFetchCreg').addEventListener('click', fetchCregTarieven);

        // Settings
        document.getElementById('btnSaveSettings').addEventListener('click', handleSaveSettings);

        // Escape to close modals
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeFactuurModal();
                closeLaadsessiesModal();
                closeDetailModal();
            }
        });
    }

    function setupUploadZone(zoneId, inputId, handler) {
        const zone = document.getElementById(zoneId);
        const input = document.getElementById(inputId);

        zone.addEventListener('click', () => input.click());
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('dragover');
            if (e.dataTransfer.files[0]) handler(e.dataTransfer.files[0]);
        });
        input.addEventListener('change', (e) => {
            if (e.target.files[0]) handler(e.target.files[0]);
        });
    }

    // ===== Navigation =====
    function navigateTo(page) {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
        document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));

        const titles = { dashboard: 'Dashboard', creg: 'CREG Tarieven', settings: 'Instellingen' };
        document.getElementById('pageTitle').textContent = titles[page] || 'Dashboard';

        switch (page) {
            case 'dashboard':
                document.getElementById('pageDashboard').classList.remove('hidden');
                document.getElementById('btnNieuweFactuur').classList.remove('hidden');
                document.getElementById('btnExport').classList.remove('hidden');
                break;
            case 'creg':
                document.getElementById('pageCreg').classList.remove('hidden');
                document.getElementById('btnNieuweFactuur').classList.add('hidden');
                document.getElementById('btnExport').classList.add('hidden');
                renderCregTabel();
                break;
            case 'settings':
                document.getElementById('pageSettings').classList.remove('hidden');
                document.getElementById('btnNieuweFactuur').classList.add('hidden');
                document.getElementById('btnExport').classList.add('hidden');
                break;
        }
    }

    // ===== Dashboard =====
    function renderDashboard() {
        renderKpis();
        renderMaandTabel();
    }

    function renderKpis() {
        let totaal = 0, openstaand = 0, kantoor = 0, wagen = 0, wagenKwh = 0;
        let completeMaanden = 0, openMaanden = 0;

        for (const m of Object.values(state.maanden)) {
            const calc = m.berekening || {};
            totaal += calc.totaalTerugbetaling || 0;
            kantoor += calc.kantoorBedrag || 0;
            wagen += calc.wagenBedrag || 0;
            wagenKwh += m.wagenKwh || 0;
            if (calc.totaalTerugbetaling) completeMaanden++;
            if (!m.betaald && calc.totaalTerugbetaling > 0) {
                openstaand += calc.totaalTerugbetaling;
                openMaanden++;
            }
        }

        document.getElementById('kpiTotaal').textContent = formatEuro(totaal);
        document.getElementById('kpiMaanden').textContent = `${completeMaanden} maanden`;
        document.getElementById('kpiOpenstaand').textContent = formatEuro(openstaand);
        document.getElementById('kpiOpenMaanden').textContent = `${openMaanden} onbetaald`;
        document.getElementById('kpiKantoor').textContent = formatEuro(kantoor);
        document.getElementById('kpiWagen').textContent = formatEuro(wagen);
        document.getElementById('kpiWagenKwh').textContent = `${wagenKwh.toFixed(1)} kWh geladen`;
    }

    function renderMaandTabel() {
        const tbody = document.getElementById('maandTabelBody');
        const tfoot = document.getElementById('maandTabelFoot');
        const emptyState = document.getElementById('emptyState');
        const tableWrapper = document.querySelector('.table-wrapper');

        const maandKeys = Object.keys(state.maanden).sort();

        if (maandKeys.length === 0) {
            emptyState.classList.remove('hidden');
            tableWrapper.classList.add('hidden');
            return;
        }

        emptyState.classList.add('hidden');
        tableWrapper.classList.remove('hidden');

        let totVoorschot = 0, totAfrekening = 0, totKost = 0, totKantoor = 0, totWagen = 0, totTerugbetaling = 0, totKwhTotaal = 0, totKwhWoning = 0, totKwhWagen = 0;

        tbody.innerHTML = maandKeys.map(key => {
            const m = state.maanden[key];
            const calc = m.berekening || {};
            const status = getMaandStatus(m);
            const totaalKost = getTotaalKost(m);

            totVoorschot += m.voorschotBedrag || 0;
            totAfrekening += m.afrekeningBedrag || 0;
            totKost += totaalKost;
            totKwhTotaal += m.totaalKwh || 0;
            totKwhWoning += calc.woningKwh || 0;
            totKwhWagen += m.wagenKwh || 0;
            totKantoor += calc.kantoorBedrag || 0;
            totWagen += calc.wagenBedrag || 0;
            totTerugbetaling += calc.totaalTerugbetaling || 0;

            const statusBadges = {
                betaald: `<span class="badge badge-success" onclick="App.toggleBetaald('${key}')" style="cursor:pointer" title="Klik om terug op open te zetten">Betaald ✓</span>`,
                compleet: `<span class="badge badge-warning" onclick="App.toggleBetaald('${key}')" style="cursor:pointer">Open</span>`,
                wacht_laadsessies: `<span class="badge badge-warning" onclick="App.toggleBetaald('${key}')" style="cursor:pointer">Open</span>`,
                wacht_afrekening: '<span class="badge" style="background:#f0f0f0;color:#999">-</span>',
                wacht_voorschot: '<span class="badge" style="background:#f0f0f0;color:#999">-</span>',
                incompleet: '<span class="badge" style="background:#f0f0f0;color:#999">-</span>',
            };

            const laadsessieBadge = m.wagenKwh !== null && m.wagenKwh > 0
                ? `<span class="badge badge-success" style="font-size:11px;cursor:pointer" onclick="App.openLaadsessies('${key}')">Sessies gelezen ✓</span>`
                : `<span class="badge" style="background:#FFF3CD;color:#856404;font-size:11px;cursor:pointer" onclick="App.openLaadsessies('${key}')">+ Toevoegen</span>`;

            const dataBadges = {
                betaald: laadsessieBadge,
                compleet: laadsessieBadge,
                wacht_laadsessies: laadsessieBadge,
                wacht_afrekening: laadsessieBadge,
                wacht_voorschot: laadsessieBadge,
                incompleet: laadsessieBadge,
            };

            return `
                <tr>
                    <td><strong>${ExcelParser.formatMaandLabel(key)}</strong></td>
                    <td class="text-right">${m.voorschotBedrag !== null ? formatEuro(m.voorschotBedrag) : '<span style="color:#ccc">-</span>'}</td>
                    <td class="text-right">${m.afrekeningBedrag !== null ? formatEuro(m.afrekeningBedrag) : '<span style="color:#ccc">-</span>'}</td>
                    <td class="text-right"><strong>${m.voorschotBedrag !== null || m.afrekeningBedrag !== null ? formatEuro(totaalKost) : '<span style="color:#ccc">-</span>'}</strong></td>
                    <td class="text-right">${m.totaalKwh ? m.totaalKwh.toFixed(1) : '<span style="color:#ccc">-</span>'}</td>
                    <td class="text-right">${calc.woningKwh ? calc.woningKwh.toFixed(1) : '<span style="color:#ccc">-</span>'}</td>
                    <td class="text-right">${m.wagenKwh !== null ? m.wagenKwh.toFixed(1) : '<span style="color:#ccc">-</span>'}</td>
                    <td class="text-right">${calc.kantoorBedrag ? formatEuro(calc.kantoorBedrag) : '<span style="color:#ccc">-</span>'}</td>
                    <td class="text-right">${calc.wagenBedrag ? formatEuro(calc.wagenBedrag) : '<span style="color:#ccc">-</span>'}</td>
                    <td class="text-right"><strong>${calc.totaalTerugbetaling ? formatEuro(calc.totaalTerugbetaling) : '<span style="color:#ccc">-</span>'}</strong></td>
                    <td class="text-center">${dataBadges[status]}</td>
                    <td class="text-center">${statusBadges[status]}</td>
                    <td class="text-center">
                        <button class="btn-icon" onclick="App.openDetail('${key}')" title="Detail bekijken">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        tfoot.innerHTML = `
            <tr>
                <td><strong>Totaal</strong></td>
                <td class="text-right">${formatEuro(totVoorschot)}</td>
                <td class="text-right">${formatEuro(totAfrekening)}</td>
                <td class="text-right"><strong>${formatEuro(totKost)}</strong></td>
                <td class="text-right">${totKwhTotaal.toFixed(1)}</td>
                <td class="text-right">${totKwhWoning.toFixed(1)}</td>
                <td class="text-right">${totKwhWagen.toFixed(1)}</td>
                <td class="text-right">${formatEuro(totKantoor)}</td>
                <td class="text-right">${formatEuro(totWagen)}</td>
                <td class="text-right"><strong>${formatEuro(totTerugbetaling)}</strong></td>
                <td></td>
                <td></td>
                <td></td>
            </tr>
        `;
    }

    // ===== CREG Tabel =====
    function renderCregTabel() {
        const tbody = document.getElementById('cregTabelBody');
        const tarieven = CregTarieven.getAlleTarieven(settings.regio);
        tbody.innerHTML = tarieven.map(({ kwartaal, tarief }) => `
            <tr>
                <td><strong>${kwartaal}</strong></td>
                <td class="text-right">${tarief.toFixed(4)}</td>
                <td class="text-right">${(tarief * 100).toFixed(2)} ct</td>
            </tr>
        `).join('');
    }

    async function fetchCregTarieven() {
        const btn = document.getElementById('btnFetchCreg');
        btn.disabled = true;
        btn.textContent = 'Ophalen...';
        try {
            await CregTarieven.fetchTarieven();
            renderCregTabel();
            showToast('CREG tarieven bijgewerkt!');
        } catch (e) {
            showToast('Fout: ' + e.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Tarieven ophalen`;
        }
    }

    // ===== Factuur Modal =====
    function openFactuurModal() {
        // Reset
        document.getElementById('parseResultFactuur').classList.add('hidden');
        document.getElementById('factuurFields').classList.add('hidden');
        document.getElementById('btnOpslaanFactuur').classList.add('hidden');
        document.getElementById('fileFactuur').value = '';
        document.getElementById('inputFactuurdatum').value = '';
        document.getElementById('inputAfrekeningMaand').value = '';
        document.getElementById('inputAfrekeningBedrag').value = '';
        document.getElementById('inputTotaalKwh').value = '';
        document.getElementById('inputVoorschotMaand').value = '';
        document.getElementById('inputVoorschotBedrag').value = '';
        document.getElementById('factuurOnlyVoorschot').classList.add('hidden');
        document.getElementById('factuurSamenvatting').textContent = '-';

        document.getElementById('modalFactuur').classList.remove('hidden');
    }

    function closeFactuurModal() {
        document.getElementById('modalFactuur').classList.add('hidden');
    }

    async function handleFactuurUpload(file) {
        const resultEl = document.getElementById('parseResultFactuur');
        const useAI = settings.parseMethod === 'ai' && settings.apiKey;

        resultEl.innerHTML = `<span class="parse-badge" style="background:var(--primary-light); color:var(--primary);">
            ${useAI ? 'PDF analyseren met AI...' : 'PDF verwerken...'}
        </span>`;
        resultEl.classList.remove('hidden');

        try {
            const data = await PdfParser.parseFactuur(file, {
                apiKey: settings.apiKey,
                method: settings.parseMethod,
            });

            console.log('PDF parse result:', JSON.stringify(data));

            if (data.parseSuccess) {
                const details = (data.parseDetails || []).join(' | ');
                const methodBadge = data.parseMethod === 'ai'
                    ? '<span style="background:var(--primary-light);color:var(--primary);padding:2px 8px;border-radius:4px;font-size:11px;margin-left:8px;">AI</span>'
                    : '<span style="background:#f0f0f0;color:#666;padding:2px 8px;border-radius:4px;font-size:11px;margin-left:8px;">Regex</span>';

                // Debug: toon wat AI teruggaf
                const debugFields = {
                    isVoorschotFactuur: data.isVoorschotFactuur,
                    isAfrekeningFactuur: data.isAfrekeningFactuur,
                    afrekeningMaand: data.afrekeningMaand,
                    afrekeningBedrag: data.afrekeningBedrag,
                    totaalKwh: data.totaalKwh,
                    voorschotMaand: data.voorschotMaand,
                    voorschotBedrag: data.voorschotBedrag,
                };
                const debugHtml = `<details style="margin-top:8px; font-size:11px; color:var(--text-muted);">
                    <summary style="cursor:pointer">AI response debug</summary>
                    <pre style="white-space:pre-wrap; margin-top:4px; padding:8px; background:#f8f8f8; border-radius:6px; font-size:11px;">${JSON.stringify(debugFields, null, 2)}</pre>
                </details>`;

                resultEl.innerHTML = `<span class="parse-badge parse-badge-success">PDF verwerkt${methodBadge}</span>
                    <div class="parse-details">${details}</div>${debugHtml}`;

                // Voorschot
                if (data.voorschotMaand) {
                    document.getElementById('inputVoorschotMaand').value = data.voorschotMaand;
                }
                if (data.voorschotBedrag != null) {
                    document.getElementById('inputVoorschotBedrag').value = Number(data.voorschotBedrag).toFixed(2);
                }

                // Afrekening: toon als er een bedrag is, ook als maand ontbreekt (gebruiker kan invullen)
                const hasAfrekeningBedrag = data.afrekeningBedrag != null;
                if (hasAfrekeningBedrag) {
                    document.getElementById('factuurOnlyVoorschot').classList.add('hidden');
                    document.getElementById('inputAfrekeningBedrag').value = Number(data.afrekeningBedrag).toFixed(2);
                    if (data.afrekeningMaand) {
                        document.getElementById('inputAfrekeningMaand').value = data.afrekeningMaand;
                    } else if (data.voorschotMaand) {
                        // Afleiding: als voorschot voor maand X, dan is afrekening typisch 2 maanden eerder
                        // bv. voorschot maart -> afrekening januari, voorschot april -> afrekening februari
                        const [y, m] = data.voorschotMaand.split('-').map(Number);
                        const afrDate = new Date(y, m - 3, 1); // 2 maanden terug
                        const afgeleideAfrMaand = `${afrDate.getFullYear()}-${String(afrDate.getMonth() + 1).padStart(2, '0')}`;
                        document.getElementById('inputAfrekeningMaand').value = afgeleideAfrMaand;
                        console.log('Afrekening maand afgeleid van voorschot:', afgeleideAfrMaand);
                    }
                    if (data.totaalKwh != null) {
                        document.getElementById('inputTotaalKwh').value = Number(data.totaalKwh).toFixed(3);
                    }
                    console.log('Afrekening ingevuld:', document.getElementById('inputAfrekeningMaand').value, data.afrekeningBedrag);
                } else {
                    // Alleen voorschot (voorschotfactuur)
                    document.getElementById('factuurOnlyVoorschot').classList.remove('hidden');
                    document.getElementById('inputAfrekeningMaand').value = '';
                    document.getElementById('inputAfrekeningBedrag').value = '';
                    document.getElementById('inputTotaalKwh').value = '';
                    console.log('Voorschotfactuur: geen afrekening data');
                }

                // Show fields + opslaan button
                document.getElementById('factuurFields').classList.remove('hidden');
                document.getElementById('btnOpslaanFactuur').classList.remove('hidden');
                updateFactuurSamenvatting();
            } else {
                const preview = data.raw ? data.raw.substring(0, 2000) : '(geen tekst gevonden)';
                const hint = !settings.apiKey
                    ? '<br><small style="color:var(--text-muted)">Tip: stel een API key in bij Instellingen voor AI parsing.</small>'
                    : '';
                resultEl.innerHTML = `<span class="parse-badge parse-badge-error">Kon PDF niet automatisch verwerken</span>${hint}
                    <details style="margin-top:8px; font-size:12px; color:var(--text-muted);">
                        <summary style="cursor:pointer">PDF tekst bekijken (debug)</summary>
                        <pre style="white-space:pre-wrap; margin-top:8px; padding:8px; background:var(--bg); border-radius:6px; max-height:200px; overflow-y:auto; font-size:11px;">${preview}</pre>
                    </details>`;

                // Show empty fields for manual entry
                document.getElementById('factuurFields').classList.remove('hidden');
                document.getElementById('btnOpslaanFactuur').classList.remove('hidden');
                document.getElementById('factuurOnlyVoorschot').classList.add('hidden');
            }
        } catch (e) {
            resultEl.innerHTML = `<span class="parse-badge parse-badge-error">Fout: ${e.message}</span>`;
            // Still allow manual entry
            document.getElementById('factuurFields').classList.remove('hidden');
            document.getElementById('btnOpslaanFactuur').classList.remove('hidden');
        }
    }

    function updateFactuurSamenvatting() {
        const afrMaand = document.getElementById('inputAfrekeningMaand').value;
        const afrBedrag = parseFloat(document.getElementById('inputAfrekeningBedrag').value);
        const vsMaand = document.getElementById('inputVoorschotMaand').value;
        const vsBedrag = parseFloat(document.getElementById('inputVoorschotBedrag').value);

        const parts = [];
        if (afrMaand && !isNaN(afrBedrag)) {
            parts.push(`Afrekening ${ExcelParser.formatMaandLabel(afrMaand)}: ${formatEuro(afrBedrag)}`);
        }
        if (vsMaand && !isNaN(vsBedrag)) {
            parts.push(`Voorschot ${ExcelParser.formatMaandLabel(vsMaand)}: ${formatEuro(vsBedrag)}`);
        }

        document.getElementById('factuurSamenvatting').innerHTML = parts.length > 0
            ? parts.join(' &bull; ')
            : 'Vul de velden in om de samenvatting te zien.';
    }

    function opslaanFactuur() {
        const factuurdatum = document.getElementById('inputFactuurdatum').value;
        const afrMaand = document.getElementById('inputAfrekeningMaand').value;
        const afrBedrag = parseFloat(document.getElementById('inputAfrekeningBedrag').value);
        const totaalKwh = parseFloat(document.getElementById('inputTotaalKwh').value);
        const vsMaand = document.getElementById('inputVoorschotMaand').value;
        const vsBedrag = parseFloat(document.getElementById('inputVoorschotBedrag').value);

        console.log('Opslaan factuur:', { factuurdatum, afrMaand, afrBedrag, totaalKwh, vsMaand, vsBedrag });

        if (!afrMaand && !vsMaand) {
            showToast('Vul minstens een maand in voor afrekening of voorschot.');
            return;
        }

        const updates = [];

        // Update afrekening maand
        if (afrMaand && !isNaN(afrBedrag)) {
            const m = getMaand(afrMaand);
            m.afrekeningBedrag = afrBedrag;
            m.afrekeningBron = factuurdatum;
            if (!isNaN(totaalKwh) && totaalKwh > 0) m.totaalKwh = totaalKwh;
            if (m.wagenKwh !== null && m.cregTarief !== null) {
                m.berekening = berekenMaand(m);
            }
            updates.push(`Afrekening ${ExcelParser.formatMaandLabel(afrMaand)}`);
        }

        // Update voorschot maand
        if (vsMaand && !isNaN(vsBedrag)) {
            const m = getMaand(vsMaand);
            m.voorschotBedrag = vsBedrag;
            m.voorschotBron = factuurdatum;
            if (m.wagenKwh !== null && m.cregTarief !== null) {
                m.berekening = berekenMaand(m);
            }
            updates.push(`Voorschot ${ExcelParser.formatMaandLabel(vsMaand)}`);
        }

        // Log factuur
        state.facturen.push({
            factuurdatum,
            afrekeningMaand: afrMaand || null,
            afrekeningBedrag: !isNaN(afrBedrag) ? afrBedrag : null,
            voorschotMaand: vsMaand || null,
            voorschotBedrag: !isNaN(vsBedrag) ? vsBedrag : null,
            verwerkt: new Date().toISOString(),
        });

        saveData();
        closeFactuurModal();
        renderDashboard();
        showToast(`Factuur verwerkt: ${updates.join(', ')}`);
    }

    // ===== Laadsessies Modal =====
    function openLaadsessies(maandKey) {
        document.getElementById('inputLaadMaand').value = maandKey;
        document.getElementById('laadsessieTitle').textContent = `Laadsessies - ${ExcelParser.formatMaandLabel(maandKey)}`;
        document.getElementById('parseResultLaadsessies').classList.add('hidden');
        document.getElementById('fileLaadsessies').value = '';

        const m = state.maanden[maandKey];
        document.getElementById('inputWagenKwh').value = m?.wagenKwh ? m.wagenKwh.toFixed(3) : '';
        document.getElementById('inputAantalSessies').value = m?.aantalSessies || '';

        // Set CREG tarief
        const tarief = CregTarieven.getTarief(maandKey, settings.regio);
        const hintEl = document.getElementById('cregTariefHint');
        if (tarief) {
            document.getElementById('inputCregTarief').value = tarief.toFixed(4);
            hintEl.textContent = `${CregTarieven.getKwartaal(maandKey)} - ${settings.regio} (${(tarief * 100).toFixed(2)} ct/kWh)`;
            hintEl.style.color = '';
        } else {
            document.getElementById('inputCregTarief').value = '';
            hintEl.textContent = `Geen tarief gevonden voor ${CregTarieven.getKwartaal(maandKey)}.`;
            hintEl.style.color = 'var(--danger)';
        }

        document.getElementById('modalLaadsessies').classList.remove('hidden');
    }

    function closeLaadsessiesModal() {
        document.getElementById('modalLaadsessies').classList.add('hidden');
    }

    async function handleLaadsessiesUpload(file) {
        const resultEl = document.getElementById('parseResultLaadsessies');
        try {
            const data = await ExcelParser.parseLaadsessies(file);
            if (data.parseSuccess) {
                document.getElementById('inputWagenKwh').value = data.totaalKwh.toFixed(3);
                document.getElementById('inputAantalSessies').value = data.aantalSessies;
                resultEl.innerHTML = `<span class="parse-badge parse-badge-success">Excel verwerkt</span>
                    <div class="parse-details">${data.aantalSessies} sessies, totaal ${data.totaalKwh.toFixed(3)} kWh</div>`;
            } else {
                resultEl.innerHTML = '<span class="parse-badge parse-badge-error">Geen sessies gevonden</span>';
            }
            resultEl.classList.remove('hidden');
        } catch (e) {
            resultEl.innerHTML = `<span class="parse-badge parse-badge-error">Fout: ${e.message}</span>`;
            resultEl.classList.remove('hidden');
        }
    }

    function opslaanLaadsessies() {
        const maandKey = document.getElementById('inputLaadMaand').value;
        const wagenKwh = parseFloat(document.getElementById('inputWagenKwh').value);
        const cregTarief = parseFloat(document.getElementById('inputCregTarief').value);
        const aantalSessies = parseInt(document.getElementById('inputAantalSessies').value) || 0;

        if (!maandKey) { showToast('Geen maand geselecteerd'); return; }
        if (isNaN(wagenKwh) || wagenKwh < 0) { showToast('Vul de kWh in'); return; }
        if (isNaN(cregTarief) || cregTarief <= 0) { showToast('Geen CREG tarief beschikbaar'); return; }

        const m = getMaand(maandKey);
        m.wagenKwh = wagenKwh;
        m.cregTarief = cregTarief;
        m.aantalSessies = aantalSessies;

        // Recalculate
        m.berekening = berekenMaand(m);

        saveData();
        closeLaadsessiesModal();
        renderDashboard();
        showToast(`Laadsessies ${ExcelParser.formatMaandLabel(maandKey)} opgeslagen!`);
    }

    // ===== Detail Modal =====
    let editingMaand = null;

    function openDetail(maandKey) {
        const m = state.maanden[maandKey];
        if (!m) return;
        editingMaand = maandKey;

        const calc = m.berekening || {};
        const status = getMaandStatus(m);
        const totaalKost = getTotaalKost(m);

        const statusLabels = {
            betaald: '<span class="badge badge-success">Betaald</span>',
            compleet: '<span class="badge badge-success">Compleet</span>',
            wacht_laadsessies: '<span class="badge" style="background:#FFF3CD;color:#856404">Wacht op laadsessies</span>',
            wacht_afrekening: '<span class="badge" style="background:#E8F0FE;color:#1A73E8">Wacht op afrekening</span>',
            wacht_voorschot: '<span class="badge" style="background:#E8F0FE;color:#1A73E8">Wacht op voorschot</span>',
            incompleet: '<span class="badge" style="background:#f0f0f0;color:#999">Incompleet</span>',
        };

        document.getElementById('detailTitle').textContent = ExcelParser.formatMaandLabel(maandKey);
        document.getElementById('detailBody').innerHTML = `
            <div class="calc-summary">
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
                    <div>
                        <div class="kpi-label" style="margin-bottom:4px">Voorschot (€ incl. BTW)</div>
                        <input type="number" step="0.01" id="detailVoorschot" class="form-control" style="font-size:16px;font-weight:600"
                            value="${m.voorschotBedrag !== null ? m.voorschotBedrag : ''}" placeholder="Nog niet bekend">
                        ${m.voorschotBron ? `<div style="font-size:11px;color:var(--text-muted)">Factuur ${m.voorschotBron}</div>` : ''}
                    </div>
                    <div>
                        <div class="kpi-label" style="margin-bottom:4px">Afrekening (€ incl. BTW)</div>
                        <input type="number" step="0.01" id="detailAfrekening" class="form-control" style="font-size:16px;font-weight:600"
                            value="${m.afrekeningBedrag !== null ? m.afrekeningBedrag : ''}" placeholder="Nog niet bekend">
                        ${m.afrekeningBron ? `<div style="font-size:11px;color:var(--text-muted)">Factuur ${m.afrekeningBron}</div>` : ''}
                    </div>
                    <div>
                        <div class="kpi-label" style="margin-bottom:4px">Totaal verbruik (kWh)</div>
                        <input type="number" step="1" id="detailKwh" class="form-control" style="font-size:16px;font-weight:600"
                            value="${m.totaalKwh || ''}" placeholder="-">
                    </div>
                    <div>
                        <div class="kpi-label" style="margin-bottom:4px">Totale kost</div>
                        <div style="font-size:16px; font-weight:700; padding: 8px 0">${formatEuro(totaalKost)}</div>
                    </div>
                </div>

                ${calc.totaalTerugbetaling ? `
                <div class="calc-divider"></div>
                ${calc.formule === 'oud' ? `
                <div class="calc-section">
                    <h3>Kantoor (${settings.kantoorPercentage}% beroepsmatig gebruik) <span class="text-muted" style="font-weight:normal;font-size:11px">- formule vóór ${Calculator.INGANGSDATUM_NIEUWE_FORMULE}</span></h3>
                    <div class="calc-formula">
                        ${formatEuro(totaalKost)} &times; ${settings.kantoorPercentage}% = ${formatEuro(calc.kantoorBedrag)}
                    </div>
                </div>
                <div class="calc-section">
                    <h3>Wagen (CREG ${CregTarieven.getKwartaal(maandKey)}) - uit resterende ${100 - settings.kantoorPercentage}%</h3>
                    <div class="calc-formula">
                        ${(m.wagenKwh || 0).toFixed(3)} kWh &times; ${(m.cregTarief || 0).toFixed(4)} &euro;/kWh = ${formatEuro(calc.wagenBedrag)}
                    </div>
                </div>
                ` : `
                <div class="calc-section">
                    <h3>Wagen (CREG ${CregTarieven.getKwartaal(maandKey)}) <span class="text-muted" style="font-weight:normal;font-size:11px">- formule vanaf ${Calculator.INGANGSDATUM_NIEUWE_FORMULE}</span></h3>
                    <div class="calc-formula">
                        ${(m.wagenKwh || 0).toFixed(3)} kWh &times; ${(m.cregTarief || 0).toFixed(4)} &euro;/kWh = ${formatEuro(calc.wagenBedrag)}
                    </div>
                </div>
                <div class="calc-section">
                    <h3>Kantoor (${settings.kantoorPercentage}% van woningverbruik, tegen gemiddelde factuurprijs)</h3>
                    <div class="calc-formula">
                        (${(m.totaalKwh || 0).toFixed(1)} − ${(m.wagenKwh || 0).toFixed(3)}) kWh &times; ${settings.kantoorPercentage}% = ${calc.kantoorKwh.toFixed(3)} kWh<br>
                        ${calc.kantoorKwh.toFixed(3)} kWh &times; ${calc.prijsPerKwh.toFixed(4)} &euro;/kWh (${formatEuro(totaalKost)} &divide; ${(m.totaalKwh || 0).toFixed(1)} kWh) = ${formatEuro(calc.kantoorBedrag)}
                    </div>
                </div>
                `}
                <div class="calc-divider"></div>
                <div class="calc-total">
                    <span class="calc-total-label">Totaal terugbetaling</span>
                    <span class="calc-total-value">${formatEuro(calc.totaalTerugbetaling)}</span>
                </div>
                ` : `
                <div class="calc-divider"></div>
                <p style="color:var(--text-muted); font-style:italic;">Berekening beschikbaar zodra alle data compleet is.${Calculator.getFormule(maandKey) === 'nieuw' && !m.totaalKwh ? ' Vanaf ' + Calculator.INGANGSDATUM_NIEUWE_FORMULE + ' is ook het totaal verbruik (kWh) nodig.' : ''}</p>
                `}

                <div style="margin-top: 16px; display: flex; gap: 12px; align-items: center;">
                    <span class="badge ${m.betaald ? 'badge-success' : 'badge-warning'}"
                          onclick="App.toggleBetaald('${maandKey}'); App.openDetail('${maandKey}');"
                          style="cursor:pointer" title="Klik om status te wijzigen">
                        ${m.betaald ? 'Betaald ✓' : 'Open'}
                    </span>
                    ${m.betaalDatum ? `<span class="text-muted" style="font-size:12px">op ${m.betaalDatum}</span>` : ''}
                </div>

                <div style="margin-top: 16px; display: flex; gap: 8px;">
                    <button class="btn btn-primary btn-sm" onclick="App.saveDetailEdits()">
                        Opslaan
                    </button>
                    <button class="btn btn-sm" style="background:#FFF3CD;color:#856404;border:1px solid #856404" onclick="App.openLaadsessies('${maandKey}'); App.closeDetailModal();">
                        Laadsessies ${m.wagenKwh !== null && m.wagenKwh > 0 ? 'aanpassen' : 'uploaden'}
                    </button>
                </div>
            </div>
        `;

        document.getElementById('modalDetail').classList.remove('hidden');
    }

    function closeDetailModal() {
        document.getElementById('modalDetail').classList.add('hidden');
        editingMaand = null;
    }

    function saveDetailEdits() {
        if (!editingMaand) return;
        const m = state.maanden[editingMaand];
        if (!m) return;

        const voorschot = document.getElementById('detailVoorschot').value;
        const afrekening = document.getElementById('detailAfrekening').value;
        const kwh = document.getElementById('detailKwh').value;

        m.voorschotBedrag = voorschot !== '' ? parseFloat(voorschot) : null;
        m.afrekeningBedrag = afrekening !== '' ? parseFloat(afrekening) : null;
        m.totaalKwh = kwh !== '' ? parseFloat(kwh) : null;

        m.berekening = berekenMaand(m);
        saveData();
        renderDashboard();
        openDetail(editingMaand); // refresh modal met nieuwe berekening
        showToast('Wijzigingen opgeslagen');
    }

    function deleteMaand() {
        if (!editingMaand) return;
        if (!confirm(`${ExcelParser.formatMaandLabel(editingMaand)} verwijderen?`)) return;
        delete state.maanden[editingMaand];
        saveData();
        closeDetailModal();
        renderDashboard();
        showToast('Maand verwijderd');
    }

    // ===== Toggle Betaald =====
    function toggleBetaald(maandKey) {
        const m = state.maanden[maandKey];
        if (!m) return;
        m.betaald = !m.betaald;
        m.betaalDatum = m.betaald ? new Date().toISOString().slice(0, 10) : null;
        saveData();
        renderDashboard();
        showToast(m.betaald ? 'Gemarkeerd als betaald' : 'Gemarkeerd als openstaand');
    }

    // ===== Export =====
    function exportExcel() {
        const maandKeys = Object.keys(state.maanden).sort();
        if (maandKeys.length === 0) { showToast('Geen data om te exporteren'); return; }

        const maanden = maandKeys.map(k => {
            const m = state.maanden[k];
            return {
                ...m,
                totaalBedrag: getTotaalKost(m),
                voorschot: m.voorschotBedrag || 0,
                afrekening: m.afrekeningBedrag || 0,
            };
        });

        const fileName = ExcelParser.exportOverzicht(maanden, settings);
        showToast(`Geëxporteerd: ${fileName}`);
    }

    // ===== Settings =====
    function renderSettings() {
        document.getElementById('settingRegio').value = settings.regio;
        document.getElementById('settingPercentage').value = settings.kantoorPercentage;
        document.getElementById('settingVennootschap').value = settings.vennootschap;
        document.getElementById('settingApiKey').value = settings.apiKey || '';
        document.getElementById('settingParseMethod').value = settings.parseMethod || 'ai';
    }

    function handleSaveSettings() {
        settings.regio = document.getElementById('settingRegio').value;
        settings.kantoorPercentage = parseInt(document.getElementById('settingPercentage').value) || 30;
        settings.vennootschap = document.getElementById('settingVennootschap').value || 'Piggy Bank VOF';
        settings.apiKey = document.getElementById('settingApiKey').value.trim();
        settings.parseMethod = document.getElementById('settingParseMethod').value;
        saveSettings();

        document.querySelector('.footer-value').textContent = settings.vennootschap;

        // Recalculate all months
        for (const m of Object.values(state.maanden)) {
            if (m.wagenKwh !== null && m.cregTarief !== null) {
                m.berekening = berekenMaand(m);
            }
        }
        saveData();
        renderDashboard();
        showToast('Instellingen opgeslagen');
    }

    // ===== Utilities =====
    function formatEuro(value) {
        if (value === null || value === undefined) return '\u20AC 0,00';
        return '\u20AC ' + value.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    function showToast(message) {
        const toast = document.getElementById('toast');
        document.getElementById('toastMessage').textContent = message;
        toast.classList.remove('hidden');
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => toast.classList.add('hidden'), 3000);
    }

    return {
        init,
        toggleBetaald,
        openDetail,
        openLaadsessies,
        closeDetailModal,
        saveDetailEdits,
    };
})();

document.addEventListener('DOMContentLoaded', App.init);
