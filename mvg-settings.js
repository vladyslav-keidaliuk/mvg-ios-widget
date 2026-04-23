// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: gray; icon-glyph: cog;

/************************************************
MVG Widget — Settings
Run this script from Scriptable app to configure.
Settings are shared with mvg-live.js
************************************************/

const SETTINGS_FILE = "mvg_widget_settings.json";

const DEFAULT_SETTINGS = {
    station: "Marienplatz",
    globalId: "",
    ubahn: true,
    sbahn: true,
    tram: true,
    bus: true,
    regionalBus: true,
    zug: false,
    offsetInMinutes: 0,
    liveRefreshSeconds: 60,
    hiddenRoutes: [],
    knownRoutes: [],
};

function loadSettings() {
    try {
        const fm = FileManager.local();
        const path = fm.joinPath(fm.documentsDirectory(), SETTINGS_FILE);
        if (fm.fileExists(path)) {
            return { ...DEFAULT_SETTINGS, ...JSON.parse(fm.readString(path)) };
        }
    } catch (e) {}
    return { ...DEFAULT_SETTINGS };
}

function saveSettings(s) {
    const fm = FileManager.local();
    fm.writeString(fm.joinPath(fm.documentsDirectory(), SETTINGS_FILE), JSON.stringify(s));
}

function transportBadge(types) {
    const map = { UBAHN: "U", SBAHN: "S", TRAM: "T", BUS: "B", REGIONAL_BUS: "RB", BAHN: "Z" };
    return (types || []).map(t => map[t] || t).join(" · ");
}

// --- Stop search ---
async function searchStop(settings) {
    const alert = new Alert();
    alert.title = "Search Stop";
    alert.addTextField("e.g. Ostbahnhof");
    alert.addAction("Search");
    alert.addCancelAction("Cancel");

    if ((await alert.presentAlert()) === -1) return;

    const query = alert.textFieldValue(0).trim();
    if (!query) return;

    let results = [];
    try {
        const data = await new Request(
            "https://www.mvg.de/api/bgw-pt/v3/locations?query=" + encodeURIComponent(query)
        ).loadJSON();
        results = (data || []).filter(e => e.type === "STATION");
    } catch (e) {
        const err = new Alert();
        err.title = "Error";
        err.message = "Could not reach MVG API.";
        err.addAction("OK");
        await err.presentAlert();
        return;
    }

    if (!results.length) {
        const none = new Alert();
        none.title = "No Results";
        none.message = `Nothing found for "${query}"`;
        none.addAction("OK");
        await none.presentAlert();
        return;
    }

    const table = new UITable();
    table.showSeparators = true;
    const header = new UITableRow();
    header.isHeader = true;
    header.addText(`Results for "${query}"`);
    table.addRow(header);

    let selected = null;
    for (const stop of results) {
        const row = new UITableRow();
        row.height = 60;
        const name = row.addText(stop.name, stop.place || "");
        name.widthWeight = 72;
        const badge = row.addText(transportBadge(stop.transportTypes));
        badge.widthWeight = 28;
        badge.rightAligned();
        row.dismissOnSelect = true;
        row.onSelect = () => { selected = stop; };
        table.addRow(row);
    }

    await table.present();

    if (selected) {
        settings.station  = selected.name;
        settings.globalId = selected.globalId;
        // reset known routes when stop changes
        settings.knownRoutes  = [];
        settings.hiddenRoutes = [];
        saveSettings(settings);
    }
}

// --- Route filter ---
async function fetchAllRoutes(settings) {
    const types = [];
    if (settings.ubahn)       types.push("UBAHN");
    if (settings.sbahn)       types.push("SBAHN");
    if (settings.tram)        types.push("TRAM");
    if (settings.bus)         types.push("BUS");
    if (settings.regionalBus) types.push("REGIONAL_BUS");
    if (settings.zug)         types.push("BAHN");

    const url = `https://www.mvg.de/api/bgw-pt/v3/departures?globalId=${settings.globalId}&limit=50&offsetInMinutes=0&transportTypes=${types.join(",")}`;
    return await new Request(url).loadJSON();
}

const TYPE_ORDER = ["UBAHN", "SBAHN", "TRAM", "BUS", "REGIONAL_BUS", "BAHN"];

function routeKey(dep) {
    return `${dep.label}|${dep.destination}`;
}

async function showRouteFilters(settings) {
    if (!settings.globalId) {
        const a = new Alert();
        a.title = "No Stop Set";
        a.message = "Search and select a stop first.";
        a.addAction("OK");
        await a.presentAlert();
        return;
    }

    let departures = [];
    try {
        departures = await fetchAllRoutes(settings);
    } catch (e) {
        const a = new Alert();
        a.title = "Error";
        a.message = "Could not fetch departures from MVG.";
        a.addAction("OK");
        await a.presentAlert();
        return;
    }

    // Merge newly seen routes into knownRoutes
    const knownKeys = new Set((settings.knownRoutes || []).map(r => r.key));
    for (const dep of departures) {
        const key = routeKey(dep);
        if (!knownKeys.has(key)) {
            settings.knownRoutes.push({
                key,
                label: dep.label,
                destination: dep.destination,
                type: dep.transportType,
            });
            knownKeys.add(key);
        }
    }

    settings.knownRoutes.sort((a, b) => {
        const ta = TYPE_ORDER.indexOf(a.type);
        const tb = TYPE_ORDER.indexOf(b.type);
        if (ta !== tb) return ta - tb;
        if (a.label !== b.label) return a.label.localeCompare(b.label, undefined, { numeric: true });
        return a.destination.localeCompare(b.destination);
    });

    saveSettings(settings);

    if (!settings.knownRoutes.length) {
        const a = new Alert();
        a.title = "No Routes Found";
        a.message = "No departures available right now. Try again later.";
        a.addAction("OK");
        await a.presentAlert();
        return;
    }

    const routeTable = new UITable();
    routeTable.showSeparators = true;

    function buildRouteRows() {
        routeTable.removeAllRows();

        const header = new UITableRow();
        header.isHeader = true;
        header.addText(`Routes at ${settings.station}`);
        routeTable.addRow(header);

        const hiddenSet = new Set(settings.hiddenRoutes || []);

        let lastType = null;
        for (const route of settings.knownRoutes) {
            if (route.type !== lastType) {
                const typeRow = new UITableRow();
                typeRow.height = 32;
                const typeNames = { UBAHN:"U-Bahn", SBAHN:"S-Bahn", TRAM:"Tram", BUS:"Bus", REGIONAL_BUS:"Regional Bus", BAHN:"Zug" };
                const tl = typeRow.addText(typeNames[route.type] || route.type);
                tl.titleColor = Color.gray();
                routeTable.addRow(typeRow);
                lastType = route.type;
            }

            const visible = !hiddenSet.has(route.key);
            const row = new UITableRow();
            row.height = 52;
            const lbl = row.addText(`${route.label}  →  ${route.destination}`);
            lbl.widthWeight = 82;
            const chk = row.addText(visible ? "✓" : "");
            chk.widthWeight = 18;
            chk.rightAligned();
            row.dismissOnSelect = false;
            row.onSelect = () => {
                if (visible) {
                    settings.hiddenRoutes = [...(settings.hiddenRoutes || []), route.key];
                } else {
                    settings.hiddenRoutes = (settings.hiddenRoutes || []).filter(k => k !== route.key);
                }
                saveSettings(settings);
                buildRouteRows();
                routeTable.reload();
            };
            routeTable.addRow(row);
        }

        // Reset row
        const resetRow = new UITableRow();
        resetRow.height = 52;
        const resetLabel = resetRow.addText("Show all routes");
        resetLabel.widthWeight = 82;
        const resetIcon = resetRow.addText("↺");
        resetIcon.widthWeight = 18;
        resetIcon.rightAligned();
        resetRow.dismissOnSelect = false;
        resetRow.onSelect = () => {
            settings.hiddenRoutes = [];
            saveSettings(settings);
            buildRouteRows();
            routeTable.reload();
        };
        routeTable.addRow(resetRow);
    }

    buildRouteRows();
    await routeTable.present();
}

// --- Main settings table ---
const settings = loadSettings();

const TRANSPORT_TYPES = [
    { key: "ubahn",       label: "U-Bahn" },
    { key: "sbahn",       label: "S-Bahn" },
    { key: "tram",        label: "Tram" },
    { key: "bus",         label: "Bus" },
    { key: "regionalBus", label: "Regional Bus" },
    { key: "zug",         label: "Zug / Bahn" },
];

const table = new UITable();
table.showSeparators = true;

function buildRows() {
    table.removeAllRows();

    // --- Stop ---
    const stopHeader = new UITableRow();
    stopHeader.isHeader = true;
    stopHeader.addText("Stop");
    table.addRow(stopHeader);

    const stopRow = new UITableRow();
    stopRow.height = 62;
    const stopName = stopRow.addText(settings.station, "Tap to search and change");
    stopName.widthWeight = 85;
    const stopArrow = stopRow.addText("›");
    stopArrow.widthWeight = 15;
    stopArrow.rightAligned();
    stopRow.dismissOnSelect = false;
    stopRow.onSelect = async () => {
        await searchStop(settings);
        buildRows();
        table.reload();
    };
    table.addRow(stopRow);

    // --- Transport Types ---
    const typesHeader = new UITableRow();
    typesHeader.isHeader = true;
    typesHeader.addText("Transport Types");
    table.addRow(typesHeader);

    for (const type of TRANSPORT_TYPES) {
        const row = new UITableRow();
        row.height = 55;
        const label = row.addText(type.label);
        label.widthWeight = 80;
        const check = row.addText(settings[type.key] ? "✓" : "");
        check.widthWeight = 20;
        check.rightAligned();
        row.dismissOnSelect = false;
        row.onSelect = () => {
            settings[type.key] = !settings[type.key];
            saveSettings(settings);
            buildRows();
            table.reload();
        };
        table.addRow(row);
    }

    // --- Route Filters ---
    const routesHeader = new UITableRow();
    routesHeader.isHeader = true;
    routesHeader.addText("Route Filters");
    table.addRow(routesHeader);

    const hiddenCount = (settings.hiddenRoutes || []).length;
    const knownCount  = (settings.knownRoutes  || []).length;
    const subtitle = knownCount === 0
        ? "Tap to load routes from stop"
        : hiddenCount === 0
            ? `${knownCount} routes, all visible`
            : `${hiddenCount} of ${knownCount} routes hidden`;

    const routeRow = new UITableRow();
    routeRow.height = 62;
    const routeLabel = routeRow.addText("Manage visible routes", subtitle);
    routeLabel.widthWeight = 85;
    const routeArrow = routeRow.addText("›");
    routeArrow.widthWeight = 15;
    routeArrow.rightAligned();
    routeRow.dismissOnSelect = false;
    routeRow.onSelect = async () => {
        await showRouteFilters(settings);
        buildRows();
        table.reload();
    };
    table.addRow(routeRow);

    // --- Live Refresh Interval ---
    const liveHeader = new UITableRow();
    liveHeader.isHeader = true;
    liveHeader.addText("Live View Refresh");
    table.addRow(liveHeader);

    const REFRESH_OPTIONS = [30, 60, 90];
    const liveRow = new UITableRow();
    liveRow.height = 55;
    const liveLabel = liveRow.addText("Auto-refresh every", "Tap to cycle");
    liveLabel.widthWeight = 70;
    const liveVal = liveRow.addText(`${settings.liveRefreshSeconds}s`);
    liveVal.widthWeight = 30;
    liveVal.rightAligned();
    liveRow.dismissOnSelect = false;
    liveRow.onSelect = () => {
        const idx = REFRESH_OPTIONS.indexOf(settings.liveRefreshSeconds);
        settings.liveRefreshSeconds = REFRESH_OPTIONS[(idx + 1) % REFRESH_OPTIONS.length];
        saveSettings(settings);
        buildRows();
        table.reload();
    };
    table.addRow(liveRow);

    // --- Offset ---
    const offsetHeader = new UITableRow();
    offsetHeader.isHeader = true;
    offsetHeader.addText("Departure Offset");
    table.addRow(offsetHeader);

    const OFFSET_OPTIONS = [0, 2, 5, 10, 15];
    const offsetRow = new UITableRow();
    offsetRow.height = 55;
    const offsetLabel = offsetRow.addText(
        "Skip next N minutes",
        settings.offsetInMinutes === 0
            ? "Show all departures"
            : `Hide departures in < ${settings.offsetInMinutes} min`
    );
    offsetLabel.widthWeight = 70;
    const offsetVal = offsetRow.addText(
        settings.offsetInMinutes === 0 ? "off" : `${settings.offsetInMinutes} min`
    );
    offsetVal.widthWeight = 30;
    offsetVal.rightAligned();
    offsetRow.dismissOnSelect = false;
    offsetRow.onSelect = () => {
        const idx = OFFSET_OPTIONS.indexOf(settings.offsetInMinutes);
        settings.offsetInMinutes = OFFSET_OPTIONS[(idx + 1) % OFFSET_OPTIONS.length];
        saveSettings(settings);
        buildRows();
        table.reload();
    };
    table.addRow(offsetRow);
}

buildRows();
await table.present();
Script.complete();
