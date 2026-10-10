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
};

// Small DOM helper
const $ = (id) => document.getElementById(id);

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
    $("viewer-note").textContent =
      "LROC texture mode. Add a Cesium ion token (?ion=TOKEN) for 3D lunar terrain.";
    return;
  }
  try {
    Cesium.Ion.defaultAccessToken = CONFIG.CESIUM_ION_TOKEN;
    const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(CONFIG.MOON_TERRAIN_ASSET_ID);
    scene.primitives.add(tileset);
    scene.globe.show = false; // the tileset replaces the smooth globe
  } catch (err) {
    console.error("Moon terrain failed to load:", err);
    $("viewer-note").textContent = "Could not load Cesium Moon Terrain - showing textured globe.";
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

function formatLat(lat) { return `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? "S" : "N"}`; }
function formatLon(lon) { return `${Math.abs(lon).toFixed(2)}° ${lon < 0 ? "W" : "E"}`; }
function categoryLabel(c) { return c === "clps" ? "CLPS" : "Artemis III"; }

function selectSite(site, { fly = true } = {}) {
  state.selected = site;

  // Fill sidebar (textContent everywhere -> no HTML injection from data)
  const badge = $("d-category");
  badge.textContent = categoryLabel(site.category);
  badge.className = `badge ${site.category}`;
  $("d-name").textContent = site.name;
  $("d-description").textContent = site.description || "";
  $("d-lat").textContent = formatLat(site.lat);
  $("d-lon").textContent = formatLon(site.lon);
  $("d-provider").textContent = site.provider;
  $("d-mission").textContent = site.mission;
  $("d-status").textContent = site.status;
  $("d-sun").textContent = `${site.sunlight_pct}%`;
  $("d-dte").textContent = `${site.dte_pct}%`;
  $("d-sun-bar").style.width = `${site.sunlight_pct}%`;
  $("d-dte-bar").style.width = `${site.dte_pct}%`;

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
    coords.textContent = `${formatLat(site.lat)}, ${formatLon(site.lon)}`;
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
    $("api-status").textContent = "online";
  } catch {
    dot.className = "status-dot down";
    $("api-status").textContent = "offline";
  }
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
  btn.textContent = "Calculating…";
  $("analysis-error").textContent = "";

  try {
    const res = await fetch(`${CONFIG.API_BASE}/api/site-analysis/${encodeURIComponent(site.id)}?${params}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(typeof body.detail === "string" ? body.detail : `HTTP ${res.status}`);
    }
    const result = await res.json();
    // Ignore stale responses if the user switched site meanwhile
    if (state.selected?.id === site.id) renderResults(result);
  } catch (err) {
    $("analysis-error").textContent =
      `Analysis failed: ${err.message}. Is the backend running on ${CONFIG.API_BASE}?`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Run analysis";
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
    verdict.textContent =
      `✔ Survives ${r.battery.darkness_hours} h of darkness (margin +${r.battery.margin_hours.toFixed(1)} h).`;
  } else {
    verdict.className = "verdict bad";
    verdict.textContent =
      `✖ Battery runs out ${Math.abs(r.battery.margin_hours).toFixed(1)} h before sunrise. ` +
      `Need ≥ ${Math.ceil(r.battery.required_capacity_wh)} Wh.`;
  }

  $("r-mean").textContent = `mean ${r.power.flat_horizon_mean_w.toFixed(0)} W`;
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
// 6. Wire up UI and boot
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
    $("viewer-note").textContent =
      "Could not load sites_data.json - serve the frontend over HTTP (see README).";
  }
})();
