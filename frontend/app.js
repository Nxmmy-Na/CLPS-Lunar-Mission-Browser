/* =====================================================================
   CLPS Lunar Mission Browser - frontend logic
   - Renders a 3D Moon with CesiumJS
   - Loads sites_data.json and drops 3D pins
   - Opens a details sidebar on click
   - Calls the FastAPI backend for solar power / battery survival analysis
   ===================================================================== */

// ---------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------
const CONFIG = {
  // FastAPI backend (see backend/main.py). When the page is served by the
  // backend itself (port 8000 or a public tunnel) the API is same-origin;
  // the standalone `http.server 5500` setup talks to port 8000 on the same host.
  API_BASE: location.port === "5500" ? `http://${location.hostname}:8000` : "",
  // Optional: a free Cesium ion token (https://ion.cesium.com) enables the
  // high-resolution "Cesium Moon Terrain" 3D Tiles. Leave empty to use the
  // lightweight grid globe. You can also pass ?ion=<token> in the URL.
  CESIUM_ION_TOKEN: new URLSearchParams(location.search).get("ion") || "",
  MOON_TERRAIN_ASSET_ID: 2684829,
  // Initial camera: looking down on the lunar south pole
  HOME_VIEW: { lon: 0, lat: -89.9, height: 450_000 },
};

const COLORS = {
  artemis_iii: Cesium.Color.fromCssColorString("#ff8a3d"),
  clps: Cesium.Color.fromCssColorString("#3ddc97"),
};

const MOON = Cesium.Ellipsoid.MOON;

// Global state
const state = {
  sites: [],            // all sites from sites_data.json
  selected: null,       // currently selected site object
  filter: "all",        // 'all' | 'artemis_iii' | 'clps'
  noteKey: "",          // i18n key of the viewer note, re-translated on language change
  apiKey: "api.checking",
  lastResult: null,     // last analysis result, re-rendered on language change
};

// Small DOM helper
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// 0. Translations (English / Thai)
// ---------------------------------------------------------------------
// Static text in index.html is tagged with data-i18n="key" (text) or
// data-i18n-aria="key" (aria-label). Dynamic text goes through t().
const I18N = {
  en: {
    "title": "CLPS Lunar Mission Browser",
    "subtitle": "Artemis III candidate regions · Commercial Lunar Payload Services",
    "kpi.sites": "Sites",
    "kpi.api": "Physics API",
    "api.checking": "checking",
    "api.online": "online",
    "api.offline": "offline",
    "sites.heading": "Landing sites",
    "filter.aria": "Filter sites",
    "filter.all": "All",
    "btn.home": "⌂ South pole view",
    "btn.close": "Close details",
    "legend.artemis": "Artemis III region",
    "legend.clps": "CLPS landing",
    "detail.select": "Select a site",
    "detail.lat": "Latitude",
    "detail.lon": "Longitude",
    "detail.provider": "Provider",
    "detail.mission": "Mission",
    "detail.status": "Status",
    "detail.sun": "☀ Sunlight",
    "detail.dte": "📡 Direct-to-Earth",
    "an.heading": "Power & survival analysis",
    "an.sunoff": "Sun longitude offset",
    "an.area": "Panel area",
    "an.eff": "Panel efficiency",
    "an.vis": "Terrain visibility",
    "an.batt": "Battery capacity",
    "an.base": "Base load (W)",
    "an.heater": "Heater (W)",
    "an.tracking": "Sun-tracking vertical panel",
    "an.run": "Run analysis",
    "an.running": "Calculating…",
    "an.error": "Analysis failed: {msg}. Is the backend running?",
    "res.power": "Solar power",
    "res.net": "Net power",
    "res.elev": "Sun elevation",
    "res.batt": "Battery life",
    "res.chart": "Power over one lunar day (flat horizon)",
    "res.mean": "mean {w} W",
    "res.survives": "✔ Survives {h} h of darkness (margin +{m} h).",
    "res.fails": "✖ Battery runs out {m} h before sunrise. Need ≥ {wh} Wh.",
    "note.texture": "LROC texture mode. Add a Cesium ion token (?ion=TOKEN) for 3D lunar terrain.",
    "note.terrainFail": "Could not load Cesium Moon Terrain - showing textured globe.",
    "note.sitesFail": "Could not load sites_data.json - serve the frontend over HTTP (see README).",
    "dir.N": "N", "dir.S": "S", "dir.E": "E", "dir.W": "W",
  },
  th: {
    "title": "CLPS Lunar Mission Browser",
    "subtitle": "พื้นที่ลงจอดที่เป็นตัวเลือกของ Artemis III · โครงการขนส่งสัมภาระสู่ดวงจันทร์เชิงพาณิชย์ (CLPS)",
    "kpi.sites": "จุดทั้งหมด",
    "kpi.api": "API ฟิสิกส์",
    "api.checking": "กำลังตรวจสอบ",
    "api.online": "ออนไลน์",
    "api.offline": "ออฟไลน์",
    "sites.heading": "จุดลงจอด",
    "filter.aria": "กรองจุดลงจอด",
    "filter.all": "ทั้งหมด",
    "btn.home": "⌂ มุมมองขั้วใต้",
    "btn.close": "ปิดรายละเอียด",
    "legend.artemis": "พื้นที่ Artemis III",
    "legend.clps": "จุดลงจอด CLPS",
    "detail.select": "เลือกจุดลงจอด",
    "detail.lat": "ละติจูด",
    "detail.lon": "ลองจิจูด",
    "detail.provider": "ผู้ให้บริการ",
    "detail.mission": "ภารกิจ",
    "detail.status": "สถานะ",
    "detail.sun": "☀ แสงอาทิตย์",
    "detail.dte": "📡 สื่อสารตรงกับโลก",
    "an.heading": "วิเคราะห์พลังงานและการอยู่รอด",
    "an.sunoff": "ระยะลองจิจูดของดวงอาทิตย์",
    "an.area": "พื้นที่แผงโซลาร์",
    "an.eff": "ประสิทธิภาพแผง",
    "an.vis": "การมองเห็นจากภูมิประเทศ",
    "an.batt": "ความจุแบตเตอรี่",
    "an.base": "โหลดพื้นฐาน (W)",
    "an.heater": "ฮีตเตอร์ (W)",
    "an.tracking": "แผงแนวตั้งหมุนตามดวงอาทิตย์",
    "an.run": "เริ่มวิเคราะห์",
    "an.running": "กำลังคำนวณ…",
    "an.error": "วิเคราะห์ไม่สำเร็จ: {msg} เซิร์ฟเวอร์ backend ทำงานอยู่หรือไม่?",
    "res.power": "พลังงานแสงอาทิตย์",
    "res.net": "พลังงานสุทธิ",
    "res.elev": "มุมเงยดวงอาทิตย์",
    "res.batt": "อายุแบตเตอรี่",
    "res.chart": "พลังงานตลอดหนึ่งวันบนดวงจันทร์ (ขอบฟ้าราบ)",
    "res.mean": "เฉลี่ย {w} W",
    "res.survives": "✔ อยู่รอดช่วงมืด {h} ชม. ได้ (เหลือเผื่อ +{m} ชม.)",
    "res.fails": "✖ แบตเตอรี่หมดก่อนดวงอาทิตย์ขึ้น {m} ชม. ต้องการอย่างน้อย {wh} Wh",
    "note.texture": "โหมดพื้นผิว LROC เพิ่มโทเคน Cesium ion (?ion=TOKEN) เพื่อดูภูมิประเทศ 3 มิติ",
    "note.terrainFail": "โหลด Cesium Moon Terrain ไม่ได้ จึงแสดงลูกโลกพร้อมพื้นผิวแทน",
    "note.sitesFail": "โหลด sites_data.json ไม่ได้ ต้องเปิดหน้าเว็บผ่าน HTTP (ดู README)",
    "dir.N": "เหนือ", "dir.S": "ใต้", "dir.E": "ตะวันออก", "dir.W": "ตะวันตก",
  },
};

/** Pick the starting language: ?lang= > saved choice > browser language. */
function initialLang() {
  const fromUrl = new URLSearchParams(location.search).get("lang");
  if (fromUrl in I18N) return fromUrl;
  try {
    const saved = localStorage.getItem("lang");
    if (saved in I18N) return saved;
  } catch { /* storage blocked */ }
  return navigator.language?.toLowerCase().startsWith("th") ? "th" : "en";
}

let lang = initialLang();

/** Translate a key, filling {placeholders} from vars. Falls back to English. */
function t(key, vars = {}) {
  const text = I18N[lang][key] ?? I18N.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

/** Localised site field, e.g. description_th, falling back to the English one. */
function siteField(site, field) {
  return (lang !== "en" && site[`${field}_${lang}`]) || site[field] || "";
}

// ---------------------------------------------------------------------
// 1. Cesium viewer set up for the Moon
// ---------------------------------------------------------------------
// Every Cartesian <-> Cartographic conversion must use the lunar ellipsoid.
Cesium.Ellipsoid.default = MOON;

const viewer = new Cesium.Viewer("cesiumContainer", {
  globe: new Cesium.Globe(MOON),
  baseLayer: false,           // no Earth imagery
  baseLayerPicker: false,
  geocoder: false,            // Earth geocoder is meaningless here
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  animation: false,
  timeline: false,
  fullscreenButton: false,
  infoBox: false,             // we use our own sidebar
  selectionIndicator: false,
  skyAtmosphere: false,       // the Moon has no atmosphere
});

const scene = viewer.scene;
scene.globe.baseColor = Cesium.Color.fromCssColorString("#3a3d44");
scene.globe.showGroundAtmosphere = false;
scene.globe.enableLighting = false;
scene.fog.enabled = false;
scene.backgroundColor = Cesium.Color.BLACK;

/**
 * Surface texture: NASA SVS "CGI Moon Kit" LROC WAC colour mosaic with
 * pole-corrected imagery (equirectangular, 4096x2048, centred on 0° lon).
 * Source: https://svs.gsfc.nasa.gov/4720/ (converted from TIFF to JPG).
 * A faint lat/lon graticule is drawn on top for orientation.
 */
async function addMoonImagery() {
  try {
    const texture = await Cesium.SingleTileImageryProvider.fromUrl(
      "textures/moon_lroc_color_4k.jpg",
      {
        rectangle: Cesium.Rectangle.MAX_VALUE, // whole globe: -180..180, -90..90
        ellipsoid: MOON,
        credit: "Moon texture: NASA's Scientific Visualization Studio (CGI Moon Kit, LRO/LROC)",
      }
    );
    viewer.imageryLayers.addImageryProvider(texture);
  } catch (err) {
    console.error("Moon texture failed to load:", err);
  }

  viewer.imageryLayers.addImageryProvider(
    new Cesium.GridImageryProvider({
      tilingScheme: new Cesium.GeographicTilingScheme({ ellipsoid: MOON }),
      cells: 8,
      color: Cesium.Color.fromCssColorString("#4da3ff").withAlpha(0.18),
      glowColor: Cesium.Color.TRANSPARENT,
    })
  );
}

/** Load photorealistic Moon terrain from Cesium ion if a token is configured. */
async function loadMoonTerrain() {
  if (!CONFIG.CESIUM_ION_TOKEN) {
    setNote("note.texture");
    return;
  }
  try {
    Cesium.Ion.defaultAccessToken = CONFIG.CESIUM_ION_TOKEN;
    const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(CONFIG.MOON_TERRAIN_ASSET_ID);
    scene.primitives.add(tileset);
    scene.globe.show = false; // the tileset replaces the smooth globe
  } catch (err) {
    console.error("Moon terrain failed to load:", err);
    setNote("note.terrainFail");
  }
}

function flyHome() {
  const { lon, lat, height } = CONFIG.HOME_VIEW;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, height, MOON),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 1.5,
  });
}

// ---------------------------------------------------------------------
// 2. Data loading & 3D pins
// ---------------------------------------------------------------------
async function loadSites() {
  // Read the static JSON shipped with the frontend.
  const res = await fetch("sites_data.json");
  if (!res.ok) throw new Error(`sites_data.json: HTTP ${res.status}`);
  const data = await res.json();
  return data.sites;
}

const pinBuilder = new Cesium.PinBuilder();

/** Add one billboard pin + label per site. The entity id equals the site id. */
function addPins(sites) {
  for (const site of sites) {
    const color = COLORS[site.category] || Cesium.Color.WHITE;
    const glyph = site.category === "clps" ? "C" : "A";
    viewer.entities.add({
      id: site.id,
      name: site.name,
      // Lift pins slightly so they are not hidden inside terrain tiles
      position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 500, MOON),
      billboard: {
        image: pinBuilder.fromText(glyph, color, 40).toDataURL(),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(5e4, 1.1, 3e6, 0.55),
      },
      label: {
        text: site.name,
        font: "12px Inter, sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        pixelOffset: new Cesium.Cartesian2(0, 6),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        // Only show labels when reasonably zoomed in to avoid clutter
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 600_000),
      },
    });
  }
}

/** Show/hide pins and list entries according to the active filter. */
function applyFilter() {
  for (const site of state.sites) {
    const visible = state.filter === "all" || site.category === state.filter;
    const entity = viewer.entities.getById(site.id);
    if (entity) entity.show = visible;
  }
  renderSiteList();
}

// ---------------------------------------------------------------------
// 3. Click handling -> sidebar
// ---------------------------------------------------------------------
const clickHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
clickHandler.setInputAction((event) => {
  const picked = scene.pick(event.position);
  if (Cesium.defined(picked) && picked.id instanceof Cesium.Entity) {
    const site = state.sites.find((s) => s.id === picked.id.id);
    if (site) selectSite(site, { fly: false });
  }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// `short` keeps the compact N/S/E/W letters (used in the narrow site list).
function dir(key, short) { return short ? key.slice(-1) : t(key); }
function formatLat(lat, short) { return `${Math.abs(lat).toFixed(2)}° ${dir(lat < 0 ? "dir.S" : "dir.N", short)}`; }
function formatLon(lon, short) { return `${Math.abs(lon).toFixed(2)}° ${dir(lon < 0 ? "dir.W" : "dir.E", short)}`; }
function categoryLabel(c) { return c === "clps" ? "CLPS" : "Artemis III"; }

function selectSite(site, { fly = true } = {}) {
  state.selected = site;
  state.lastResult = null;
  renderSiteDetails(site);

  // Reset previous analysis
  $("results").hidden = true;
  $("analysis-error").textContent = "";

  const sidebar = $("sidebar");
  sidebar.classList.add("open");
  sidebar.setAttribute("aria-hidden", "false");

  renderSiteList();

  if (fly) {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 120_000, MOON),
      duration: 1.5,
    });
  }
}

function renderSiteDetails(site) {
  // Fill sidebar (textContent everywhere -> no HTML injection from data)
  const badge = $("d-category");
  badge.textContent = categoryLabel(site.category);
  badge.className = `badge ${site.category}`;
  $("d-name").textContent = site.name;
  $("d-description").textContent = siteField(site, "description");
  $("d-lat").textContent = formatLat(site.lat);
  $("d-lon").textContent = formatLon(site.lon);
  $("d-provider").textContent = site.provider;
  $("d-mission").textContent = site.mission;
  $("d-status").textContent = siteField(site, "status");
  $("d-sun").textContent = `${site.sunlight_pct}%`;
  $("d-dte").textContent = `${site.dte_pct}%`;
  $("d-sun-bar").style.width = `${site.sunlight_pct}%`;
  $("d-dte-bar").style.width = `${site.dte_pct}%`;
}

function closeSidebar() {
  state.selected = null;
  const sidebar = $("sidebar");
  sidebar.classList.remove("open");
  sidebar.setAttribute("aria-hidden", "true");
  renderSiteList();
}

// ---------------------------------------------------------------------
// 4. Left site list + KPIs
// ---------------------------------------------------------------------
function renderSiteList() {
  const list = $("site-list");
  list.replaceChildren();
  for (const site of state.sites) {
    if (state.filter !== "all" && site.category !== state.filter) continue;
    const li = document.createElement("li");
    if (state.selected?.id === site.id) li.classList.add("selected");

    const dot = document.createElement("span");
    dot.className = `dot ${site.category}`;
    const text = document.createElement("div");
    const name = document.createElement("div");
    name.className = "li-name";
    name.textContent = site.name;
    const coords = document.createElement("div");
    coords.className = "li-coords";
    coords.textContent = `${formatLat(site.lat, true)}, ${formatLon(site.lon, true)}`;
    text.append(name, coords);
    li.append(dot, text);

    li.addEventListener("click", () => selectSite(site));
    list.append(li);
  }
}

function renderKpis() {
  $("kpi-total").textContent = state.sites.length;
  $("kpi-artemis").textContent = state.sites.filter((s) => s.category === "artemis_iii").length;
  $("kpi-clps").textContent = state.sites.filter((s) => s.category === "clps").length;
}

async function checkApi() {
  const dot = $("api-dot");
  try {
    const res = await fetch(`${CONFIG.API_BASE}/api/health`);
    if (!res.ok) throw new Error();
    dot.className = "status-dot ok";
    state.apiKey = "api.online";
  } catch {
    dot.className = "status-dot down";
    state.apiKey = "api.offline";
  }
  $("api-status").textContent = t(state.apiKey);
}

// ---------------------------------------------------------------------
// 5. Analysis controls -> FastAPI
// ---------------------------------------------------------------------
/** Bind a range input to its value label with a formatter. */
function bindSlider(inputId, labelId, fmt) {
  const input = $(inputId);
  const update = () => ($(labelId).textContent = fmt(Number(input.value)));
  input.addEventListener("input", update);
  update();
}

bindSlider("in-sunoff", "v-sunoff", (v) => `${v > 0 ? "+" : ""}${v}°`);
bindSlider("in-area", "v-area", (v) => `${v.toFixed(1)} m²`);
bindSlider("in-eff", "v-eff", (v) => `${v}%`);
bindSlider("in-vis", "v-vis", (v) => `${v}%`);
bindSlider("in-batt", "v-batt", (v) => `${v} Wh`);

/** Wrap a longitude into [-180, 180]. */
function wrapLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

async function runAnalysis() {
  const site = state.selected;
  if (!site) return;

  // Offset 0 = Sun at the site's meridian (local noon)
  const params = new URLSearchParams({
    subsolar_lon_deg: wrapLon(site.lon + Number($("in-sunoff").value)).toFixed(2),
    panel_area_m2: $("in-area").value,
    panel_efficiency: (Number($("in-eff").value) / 100).toString(),
    terrain_visibility: (Number($("in-vis").value) / 100).toString(),
    battery_capacity_wh: $("in-batt").value,
    base_power_w: $("in-base").value || "0",
    heater_power_w: $("in-heater").value || "0",
    panel_mode: $("in-tracking").checked ? "tracking" : "fixed",
  });

  const btn = $("btn-analyze");
  btn.disabled = true;
  btn.textContent = t("an.running");
  $("analysis-error").textContent = "";

  try {
    const res = await fetch(`${CONFIG.API_BASE}/api/site-analysis/${encodeURIComponent(site.id)}?${params}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(typeof body.detail === "string" ? body.detail : `HTTP ${res.status}`);
    }
    const result = await res.json();
    // Ignore stale responses if the user switched site meanwhile
    if (state.selected?.id === site.id) {
      state.lastResult = result;
      renderResults(result);
    }
  } catch (err) {
    $("analysis-error").textContent = t("an.error", { msg: err.message });
  } finally {
    btn.disabled = false;
    btn.textContent = t("an.run");
  }
}

function renderResults(r) {
  $("r-power").textContent = `${r.power.instantaneous_w.toFixed(0)} W`;
  $("r-net").textContent = `${r.power.net_w >= 0 ? "+" : ""}${r.power.net_w.toFixed(0)} W`;
  $("r-elev").textContent = `${r.sun.elevation_deg.toFixed(2)}°`;
  $("r-batt").textContent = `${r.battery.survival_hours.toFixed(1)} h`;

  const verdict = $("r-verdict");
  if (r.battery.survives) {
    verdict.className = "verdict ok";
    verdict.textContent = t("res.survives", {
      h: r.battery.darkness_hours,
      m: r.battery.margin_hours.toFixed(1),
    });
  } else {
    verdict.className = "verdict bad";
    verdict.textContent = t("res.fails", {
      m: Math.abs(r.battery.margin_hours).toFixed(1),
      wh: Math.ceil(r.battery.required_capacity_wh),
    });
  }

  $("r-mean").textContent = t("res.mean", { w: r.power.flat_horizon_mean_w.toFixed(0) });
  $("results").hidden = false;
  drawPowerChart(r.profile);
}

/** Minimal canvas line chart of power (W) vs hours over one synodic month. */
function drawPowerChart(profile) {
  const canvas = $("power-chart");
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = 140;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const pad = { l: 36, r: 8, t: 10, b: 20 };
  const maxP = Math.max(1, ...profile.map((p) => p.power_w));
  const maxH = profile[profile.length - 1].hour;
  const x = (h) => pad.l + (h / maxH) * (width - pad.l - pad.r);
  const y = (p) => height - pad.b - (p / maxP) * (height - pad.t - pad.b);

  // Axes + labels
  ctx.strokeStyle = "#1f2a3d";
  ctx.fillStyle = "#8a96ab";
  ctx.font = "10px JetBrains Mono, monospace";
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, height - pad.b);
  ctx.lineTo(width - pad.r, height - pad.b);
  ctx.stroke();
  ctx.fillText(`${maxP.toFixed(0)}W`, 2, pad.t + 8);
  ctx.fillText("0", pad.l - 12, height - pad.b);
  ctx.fillText(`${maxH.toFixed(0)} h`, width - pad.r - 40, height - 4);

  // Filled area under the curve
  ctx.beginPath();
  ctx.moveTo(x(0), y(0));
  for (const p of profile) ctx.lineTo(x(p.hour), y(p.power_w));
  ctx.lineTo(x(maxH), y(0));
  ctx.closePath();
  ctx.fillStyle = "rgba(255, 209, 102, 0.18)";
  ctx.fill();

  // Line
  ctx.beginPath();
  profile.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x(p.hour), y(p.power_w)));
  ctx.strokeStyle = "#ffd166";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// ---------------------------------------------------------------------
// 6. Language switching
// ---------------------------------------------------------------------
function setNote(key) {
  state.noteKey = key;
  $("viewer-note").textContent = t(key);
}

/** Apply the current language to static markup and re-render dynamic parts. */
function applyLanguage() {
  document.documentElement.lang = lang;
  document.title = t("title");
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll("[data-i18n-aria]").forEach((el) =>
    el.setAttribute("aria-label", t(el.dataset.i18nAria))
  );
  document.querySelectorAll(".lang-btn").forEach((b) => {
    const active = b.dataset.lang === lang;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  });

  $("api-status").textContent = t(state.apiKey);
  if (state.noteKey) $("viewer-note").textContent = t(state.noteKey);
  if (!$("btn-analyze").disabled) $("btn-analyze").textContent = t("an.run");
  if (state.selected) renderSiteDetails(state.selected);
  else $("d-name").textContent = t("detail.select");
  if (state.lastResult && !$("results").hidden) renderResults(state.lastResult);
  renderSiteList();
}

function setLanguage(next) {
  if (!(next in I18N) || next === lang) return;
  lang = next;
  try { localStorage.setItem("lang", lang); } catch { /* storage blocked */ }
  applyLanguage();
}

document.querySelectorAll(".lang-btn").forEach((b) =>
  b.addEventListener("click", () => setLanguage(b.dataset.lang))
);

// ---------------------------------------------------------------------
// 7. Wire up UI and boot
// ---------------------------------------------------------------------
$("btn-close").addEventListener("click", closeSidebar);
$("btn-home").addEventListener("click", flyHome);
$("btn-analyze").addEventListener("click", runAnalysis);

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    state.filter = chip.dataset.filter;
    applyFilter();
  });
});

(async function init() {
  applyLanguage();
  flyHome();
  addMoonImagery();
  loadMoonTerrain();
  checkApi();
  try {
    state.sites = await loadSites();
    addPins(state.sites);
    renderSiteList();
    renderKpis();
  } catch (err) {
    console.error(err);
    setNote("note.sitesFail");
  }
})();
