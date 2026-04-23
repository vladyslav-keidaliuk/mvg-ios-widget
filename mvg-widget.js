// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: subway;

/************************************************
MVG Live Departure Board
- On homescreen: shows departures as widget
- Tap → full-screen live board, auto-refreshes every 60s
- Configure stop & types via mvg-settings.js
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

// --- Data ---
async function resolveGlobalId(settings) {
    if (settings.globalId) return settings.globalId;

    const q = settings.station
        .replace(/ /g, "&").replace(/ß/g, "ss")
        .replace(/ü/g, "ue").replace(/ä/g, "ae").replace(/ö/g, "oe");

    const data = await new Request(
        "https://www.mvg.de/api/bgw-pt/v3/locations?query=" + q
    ).loadJSON();

    const found = (data || []).find(e => e.type === "STATION");
    return found ? found.globalId : "";
}

function filterDepartures(departures, settings) {
    const hidden = new Set(settings.hiddenRoutes || []);
    if (!hidden.size) return departures;
    return departures.filter(d => !hidden.has(`${d.label}|${d.destination}`));
}

async function fetchDepartures(settings, globalId) {
    const types = [];
    if (settings.ubahn)       types.push("UBAHN");
    if (settings.sbahn)       types.push("SBAHN");
    if (settings.tram)        types.push("TRAM");
    if (settings.bus)         types.push("BUS");
    if (settings.regionalBus) types.push("REGIONAL_BUS");
    if (settings.zug)         types.push("BAHN");

    const url = `https://www.mvg.de/api/bgw-pt/v3/departures?globalId=${globalId}&limit=25&offsetInMinutes=${settings.offsetInMinutes}&transportTypes=${types.join(",")}`;
    return await new Request(url).loadJSON();
}

// --- Colors ---
const LINE_COLORS = {
    U1:"#438136", U2:"#C40C37", U3:"#F36E31", U4:"#0AB38D", U5:"#B8740E", U6:"#006CB3",
    S1:"#16BAE7", S2:"#76B82A", S3:"#951B81", S4:"#E30613", S6:"#00975F",
    S7:"#943126", S8:"#000000", S20:"#ED6B83",
};
const TYPE_COLORS = {
    UBAHN:"#3a4faa", SBAHN:"#005E82", BUS:"#00586A",
    TRAM:"#D82020", REGIONAL_BUS:"#006060", BAHN:"#555555",
};

function lineColor(type, label) {
    return LINE_COLORS[label] || TYPE_COLORS[type] || "#444444";
}

// =============================================
// LIVE VIEW HTML
// =============================================
function buildHTML(station, departures, interval) {
    return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  body {
    background: #1c2e6e;
    color: #fff;
    font-family: -apple-system, "Helvetica Neue", sans-serif;
    padding: 20px 16px 56px;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 20px;
  }
  .station {
    font-size: 22px;
    font-weight: 700;
    flex: 1;
    padding-right: 8px;
  }
  .meta {
    text-align: right;
    font-size: 11px;
    opacity: 0.5;
    line-height: 1.7;
    flex-shrink: 0;
  }
  .departure {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
    border-bottom: 1px solid rgba(255,255,255,0.07);
  }
  .badge {
    flex-shrink: 0;
    min-width: 40px;
    height: 22px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    padding: 0 5px;
  }
  .dest {
    flex: 1;
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .time { font-size: 15px; font-weight: 700; flex-shrink: 0; min-width: 54px; text-align: right; }
  .now     { color: #30D158; }
  .delayed { color: #FFD60A; }
  .empty   { text-align: center; opacity: 0.4; margin-top: 48px; font-size: 15px; }
  .footer {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    background: #1c2e6e;
    padding: 0 0 2px;
  }
  .progress-track { height: 3px; background: rgba(255,255,255,0.1); }
  .progress-bar   { height: 100%; background: rgba(255,255,255,0.4); width: 100%; }
</style>
</head>
<body>
  <div class="header">
    <div class="station">${station}</div>
    <div class="meta">
      <div id="updatedAt"></div>
      <div id="nextIn"></div>
    </div>
  </div>
  <div id="list"></div>
  <div class="footer">
    <div class="progress-track">
      <div class="progress-bar" id="bar"></div>
    </div>
  </div>

<script>
const INTERVAL = ${interval || 60};
const LINE_COLORS = ${JSON.stringify(LINE_COLORS)};
const TYPE_COLORS = ${JSON.stringify(TYPE_COLORS)};

function lineColor(type, label) {
  return LINE_COLORS[label] || TYPE_COLORS[type] || "#444";
}

function render(deps) {
  const el = document.getElementById("list");
  if (!deps || !deps.length) {
    el.innerHTML = '<div class="empty">No departures</div>';
    return;
  }
  const now = Date.now();
  el.innerHTML = deps.map(d => {
    const mins = Math.ceil((d.realtimeDepartureTime - now) / 60000);
    const timeLabel = mins <= 0 ? "jetzt" : mins + " min";
    const timeClass = "time" + (mins <= 0 ? " now" : d.delayInMinutes > 0 ? " delayed" : "");
    const dest = (d.destination || "").substring(0, 24);
    return '<div class="departure">'
      + '<div class="badge" style="background:' + lineColor(d.transportType, d.label) + '">' + d.label + '</div>'
      + '<div class="dest">' + dest + '</div>'
      + '<div class="' + timeClass + '">' + timeLabel + '</div>'
      + '</div>';
  }).join("");
}

function startBar() {
  const bar = document.getElementById("bar");
  bar.style.transition = "none";
  bar.style.width = "100%";
  setTimeout(() => {
    bar.style.transition = "width " + INTERVAL + "s linear";
    bar.style.width = "0%";
  }, 80);
}

function updateMeta(countdown) {
  const t = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
  document.getElementById("updatedAt").textContent = "Updated " + t;
  document.getElementById("nextIn").textContent = "next in " + countdown + "s";
}

let countdown = INTERVAL;
setInterval(() => {
  countdown = Math.max(0, countdown - 1);
  document.getElementById("nextIn").textContent = "next in " + countdown + "s";
}, 1000);

function updateDepartures(deps) {
  render(deps);
  countdown = INTERVAL;
  updateMeta(countdown);
  startBar();
}

updateDepartures(${JSON.stringify(departures || [])});
</script>
</body>
</html>`;
}

// =============================================
// WIDGET MODE
// =============================================
if (config.runsInWidget) {
    const settings  = loadSettings();
    const station   = args.widgetParameter || settings.station;
    const overrideStation = args.widgetParameter
        ? { ...settings, station: args.widgetParameter, globalId: "" }
        : settings;

    const globalId  = await resolveGlobalId(overrideStation);

    if (!globalId) {
        const w = new ListWidget();
        w.backgroundColor = new Color("#1c2e6e");
        w.addText("Station not found: " + station).textColor = Color.white();
        w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
        Script.setWidget(w);
        Script.complete();
        return;
    }

    const departures = filterDepartures(await fetchDepartures(settings, globalId), settings);
    const widgetSize = config.widgetFamily || "large";
    const itemsCount = widgetSize === "small" ? 4 : widgetSize === "medium" ? 3 : 8;
    const fontSize   = widgetSize === "small" ? 12 : 16;

    const widget = new ListWidget();
    widget.backgroundColor = new Color("#1c2e6e");
    widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

    const hdr = widget.addStack();
    const ttl = hdr.addText(station);
    ttl.font = Font.boldSystemFont(fontSize + 4);
    ttl.textColor = Color.white();
    widget.addSpacer(8);

    const count = Math.min(itemsCount, departures.length);
    for (let i = 0; i < count; i++) {
        const dep = departures[i];
        const row = widget.addStack();
        row.centerAlignContent();
        row.spacing = 8;

        const badge = row.addStack();
        badge.size = new Size(36, 20);
        badge.backgroundColor = new Color(lineColor(dep.transportType, dep.label));
        badge.cornerRadius = 4;
        badge.centerAlignContent();
        const bl = badge.addText(dep.label);
        bl.font = Font.boldSystemFont(12);
        bl.textColor = Color.white();

        const dest = row.addText((dep.destination || "").substring(0, 18));
        dest.font = Font.systemFont(fontSize);
        dest.textColor = Color.white();
        row.addSpacer();

        const mins = Math.ceil((dep.realtimeDepartureTime - Date.now()) / 60000);
        const tl = row.addText(mins <= 0 ? "jetzt" : mins + " min");
        tl.font = Font.boldSystemFont(fontSize);
        tl.textColor = dep.delayInMinutes > 0 ? Color.yellow() : Color.white();
        widget.addSpacer(4);
    }

    widget.addSpacer();
    const now = new Date();
    const footer = widget.addText(
        "⏎ tap for live · " + now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
    footer.font = Font.systemFont(10);
    footer.textOpacity = 0.4;
    footer.textColor = Color.white();
    footer.rightAlignText();

    Script.setWidget(widget);
    Script.complete();
    return;
}

// =============================================
// LIVE VIEW MODE (tapped or run from app)
// =============================================
const settings = loadSettings();
const globalId  = await resolveGlobalId(settings);

if (!globalId) {
    const a = new Alert();
    a.title = "No Stop Configured";
    a.message = "Run mvg-settings.js to set up your stop first.";
    a.addAction("OK");
    await a.presentAlert();
    Script.complete();
    return;
}

const liveInterval = settings.liveRefreshSeconds || 60;
let departures = filterDepartures(await fetchDepartures(settings, globalId), settings);

const wv = new WebView();
await wv.loadHTML(buildHTML(settings.station, departures, liveInterval));

const timer = Timer.schedule(liveInterval * 1000, true, async () => {
    try {
        departures = filterDepartures(await fetchDepartures(settings, globalId), settings);
        await wv.evaluateJavaScript(
            `updateDepartures(${JSON.stringify(departures)})`
        );
    } catch (e) {}
});

await wv.present(true);
timer.invalidate();
Script.complete();
