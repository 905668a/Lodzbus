const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const cheerio = require("cheerio");
const xml2js = require("xml2js");
const gtfsRealtimeBindings = require("gtfs-realtime-bindings");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_USER_LAT = parseFloat(process.env.USER_LAT) || 51.7748;
const DEFAULT_USER_LON = parseFloat(process.env.USER_LON) || 19.4474;
const WALKING_SPEED_KMH = parseFloat(process.env.WALKING_SPEED_KMH) || 5;
const GTFS_RT_URL = process.env.GTFS_RT_URL || "https://cdn.zbiorkom.live/gtfs-rt/lodz.pb";
const CZYNA_CZAS_API_BASE = process.env.CZYNA_CZAS_API_BASE || "https://czynaczas.pl/api/lodz";
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

app.use(cors());
app.use(express.json());

const DATA_DIR = path.join(__dirname, "data");
const APP_STATE_PATH = path.join(DATA_DIR, "app-state.json");
const PINTEREST_CACHE_DIR = path.join(__dirname, "cache", "pinterest");

for (const dir of [DATA_DIR, PINTEREST_CACHE_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

app.use(
  "/cached-images",
  express.static(PINTEREST_CACHE_DIR, {
    maxAge: "30d",
    immutable: true,
  })
);

function readAppState() {
  try {
    if (!fs.existsSync(APP_STATE_PATH)) {
      return { links: [], updatedAt: null };
    }
    const raw = fs.readFileSync(APP_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { links: [], updatedAt: null };
    const links = Array.isArray(parsed.links) ? parsed.links : [];
    return { links, updatedAt: parsed.updatedAt || null };
  } catch {
    return { links: [], updatedAt: null };
  }
}

function writeAppState(nextState) {
  const safeLinks = Array.isArray(nextState?.links) ? nextState.links : [];
  const payload = {
    links: safeLinks,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(APP_STATE_PATH, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function guessImageExtension(contentType, rawUrl) {
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("image/jpeg")) return "jpg";
  if (ct.includes("image/png")) return "png";
  if (ct.includes("image/webp")) return "webp";
  if (ct.includes("image/gif")) return "gif";
  if (ct.includes("image/avif")) return "avif";

  try {
    const pathname = new URL(String(rawUrl || "")).pathname.toLowerCase();
    const ext = pathname.split(".").pop();
    if (["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(ext)) {
      return ext === "jpeg" ? "jpg" : ext;
    }
  } catch {
    // ignore and fallback
  }

  return "jpg";
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.replace(/"/g, ""));
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.replace(/"/g, ""));
  return result;
}

function resolveGTFSDir() {
  const configured = process.env.GTFS_DIR;
  const candidates = [
    configured,
    path.resolve(__dirname, "gtfs"),
    path.resolve(__dirname, "..", "gtfs"),
    path.resolve(__dirname, "..", "lodz"),
    path.resolve(__dirname, "..", "..", "lodz"),
    "C:\\Users\\jorge\\Downloads\\lodz",
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      const stopsPath = path.join(dir, "stops.txt");
      const routesPath = path.join(dir, "routes.txt");
      const stopTimesPath = path.join(dir, "stop_times.txt");
      const tripsPath = path.join(dir, "trips.txt");

      if (
        fs.existsSync(stopsPath) &&
        fs.existsSync(routesPath) &&
        fs.existsSync(stopTimesPath) &&
        fs.existsSync(tripsPath)
      ) {
        console.log(`Using GTFS directory: ${dir}`);
        return dir;
      }
    } catch (_err) {
      // Continue with next candidate.
    }
  }

  console.warn("No complete GTFS directory found. Falling back to minimal in-memory data.");
  return null;
}

function normalizeStopToken(value) {
  if (!value && value !== 0) return "";
  const str = String(value).trim();
  const numeric = str.replace(/\D/g, "");
  if (!numeric) return str.toLowerCase();
  const noLeadingZeros = numeric.replace(/^0+/, "") || "0";
  return noLeadingZeros;
}

function getNowSecondsOfDay(date = new Date()) {
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

function secondsToHHmm(seconds) {
  const normalized = ((seconds % 86400) + 86400) % 86400;
  const h = Math.floor(normalized / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((normalized % 3600) / 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}`;
}

function longToNumber(value) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object" && typeof value.toNumber === "function") return value.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const GTFS_DIR = resolveGTFSDir();

function loadStops() {
  const stopsById = {};
  const stopCodeToId = {};
  const normalizedStopIdToId = {};
  const normalizedStopCodeToId = {};

  const stopsFilePath = GTFS_DIR ? path.join(GTFS_DIR, "stops.txt") : null;
  if (stopsFilePath && fs.existsSync(stopsFilePath)) {
    console.log(`Loading stops from ${stopsFilePath}`);
    try {
      const data = fs.readFileSync(stopsFilePath, "utf8");
      const lines = data.split(/\r?\n/).filter(Boolean);
      const headers = parseCSVLine(lines[0]).map((h) => h.replace(/^\uFEFF/, "").trim());
      const idx = {
        stop_id: headers.indexOf("stop_id"),
        stop_code: headers.indexOf("stop_code"),
        stop_name: headers.indexOf("stop_name"),
        stop_lat: headers.indexOf("stop_lat"),
        stop_lon: headers.indexOf("stop_lon"),
      };

      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const stopId = values[idx.stop_id];
        if (!stopId) continue;

        const stopCode = idx.stop_code >= 0 ? values[idx.stop_code] : "";
        const stopName = idx.stop_name >= 0 ? values[idx.stop_name] : stopId;
        const stopLat = idx.stop_lat >= 0 ? parseFloat(values[idx.stop_lat]) || null : null;
        const stopLon = idx.stop_lon >= 0 ? parseFloat(values[idx.stop_lon]) || null : null;

        const stop = {
          stop_id: stopId,
          stop_code: stopCode,
          stop_name: stopName,
          stop_lat: stopLat,
          stop_lon: stopLon,
        };

        stopsById[stopId] = stop;

        if (stopCode) {
          stopCodeToId[stopCode] = stopId;
          normalizedStopCodeToId[normalizeStopToken(stopCode)] = stopId;
        }

        normalizedStopIdToId[normalizeStopToken(stopId)] = stopId;
      }

      console.log(`Loaded ${Object.keys(stopsById).length} stops from GTFS`);
    } catch (err) {
      console.error("Error loading stops:", err);
    }
  }

  if (Object.keys(stopsById).length === 0) {
    stopsById["543"] = {
      stop_id: "543",
      stop_code: "543",
      stop_name: "Piotrkowska Centrum",
      stop_lat: 51.75924,
      stop_lon: 19.45762,
    };
    stopCodeToId["543"] = "543";
    normalizedStopIdToId[normalizeStopToken("543")] = "543";
    normalizedStopCodeToId[normalizeStopToken("543")] = "543";
    console.warn("Using minimal fallback stops data.");
  }

  return { stopsById, stopCodeToId, normalizedStopIdToId, normalizedStopCodeToId };
}

const { stopsById: stopsCache, stopCodeToId, normalizedStopIdToId, normalizedStopCodeToId } = loadStops();

function resolveStopId(stopInput) {
  if (!stopInput && stopInput !== 0) return null;
  const raw = String(stopInput).trim();
  if (!raw) return null;

  if (stopCodeToId[raw]) return stopCodeToId[raw];
  if (stopsCache[raw]) return raw;

  const normalized = normalizeStopToken(raw);
  if (normalizedStopCodeToId[normalized]) return normalizedStopCodeToId[normalized];
  if (normalizedStopIdToId[normalized]) return normalizedStopIdToId[normalized];

  return null;
}

const stopTimesCache = {};
const tripsCache = {};
const routesCache = {};

function timeToSecs(timeStr) {
  const [h, m, s] = String(timeStr || "00:00:00").split(":").map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
}

function loadRoutesSync() {
  if (!GTFS_DIR) return;
  const routesFilePath = path.join(GTFS_DIR, "routes.txt");
  if (!fs.existsSync(routesFilePath)) return;

  try {
    const data = fs.readFileSync(routesFilePath, "utf8");
    const lines = data.split(/\r?\n/).filter(Boolean);
    const headers = parseCSVLine(lines[0]).map((h) => h.replace(/^\uFEFF/, "").trim());
    const idx = {
      route_id: headers.indexOf("route_id"),
      route_short_name: headers.indexOf("route_short_name"),
      route_long_name: headers.indexOf("route_long_name"),
      route_type: headers.indexOf("route_type"),
    };

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      const routeId = values[idx.route_id];
      if (!routeId) continue;
      routesCache[routeId] = {
        route_id: routeId,
        route_short_name: values[idx.route_short_name] || routeId,
        route_long_name: values[idx.route_long_name] || "",
        route_type: values[idx.route_type] || "3",
      };
    }

    console.log(`Loaded ${Object.keys(routesCache).length} routes from GTFS`);
  } catch (err) {
    console.error("Error loading routes:", err);
  }
}

function loadGTFSData() {
  if (!GTFS_DIR) return;

  const files = ["stop_times.txt", "trips.txt"];
  files.forEach((file) => {
    const fullPath = path.join(GTFS_DIR, file);
    if (!fs.existsSync(fullPath)) return;

    console.log(`Loading ${file}`);
    fs.createReadStream(fullPath)
      .pipe(csv())
      .on("data", (row) => {
        if (file === "stop_times.txt") {
          const stopId = row.stop_id;
          if (!stopId) return;
          if (!stopTimesCache[stopId]) stopTimesCache[stopId] = [];
          stopTimesCache[stopId].push({
            trip_id: row.trip_id,
            arrival_secs: timeToSecs(row.arrival_time),
            departure_secs: timeToSecs(row.departure_time),
          });
        }

        if (file === "trips.txt") {
          if (!row.trip_id) return;
          tripsCache[row.trip_id] = { route_id: row.route_id, trip_headsign: row.trip_headsign || "" };
        }
      })
      .on("end", () => {
        console.log(`${file} loaded`);
      })
      .on("error", (err) => console.error(`${file} error:`, err));
  });
}

loadRoutesSync();
loadGTFSData();

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function calculateWalkingMetrics(fromLat, fromLon, toLat, toLon) {
  const fallbackDistanceKm = calculateDistance(fromLat, fromLon, toLat, toLon);
  const fallbackMinutes = Math.max(1, Math.round((fallbackDistanceKm / WALKING_SPEED_KMH) * 60));

  if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === "your_google_api_key_here") {
    return {
      distance_km: Math.round(fallbackDistanceKm * 100) / 100,
      walking_time_minutes: fallbackMinutes,
      source: "haversine-fallback",
    };
  }

  try {
    const response = await axios.get("https://maps.googleapis.com/maps/api/distancematrix/json", {
      timeout: 6000,
      params: {
        origins: `${fromLat},${fromLon}`,
        destinations: `${toLat},${toLon}`,
        mode: "walking",
        language: "es",
        units: "metric",
        key: GOOGLE_MAPS_API_KEY,
      },
    });

    const element = response.data?.rows?.[0]?.elements?.[0];
    if (element?.status === "OK") {
      const distanceKm = (element.distance?.value || 0) / 1000;
      const minutes = Math.max(1, Math.round((element.duration?.value || 0) / 60));
      return {
        distance_km: Math.round(distanceKm * 100) / 100,
        walking_time_minutes: minutes,
        source: "google-maps",
      };
    }

    return {
      distance_km: Math.round(fallbackDistanceKm * 100) / 100,
      walking_time_minutes: fallbackMinutes,
      source: "haversine-fallback",
    };
  } catch (_err) {
    return {
      distance_km: Math.round(fallbackDistanceKm * 100) / 100,
      walking_time_minutes: fallbackMinutes,
      source: "haversine-fallback",
    };
  }
}

async function calculateTransitMetrics(fromLat, fromLon, toLat, toLon, transportType) {
  if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === "your_google_api_key_here") {
    return {
      transit_time_minutes: null,
      source: "google-maps-key-missing",
    };
  }

  const mappedMode = String(transportType || "").toLowerCase() === "tram" ? "tram" : "bus";

  try {
    const response = await axios.get("https://maps.googleapis.com/maps/api/distancematrix/json", {
      timeout: 7000,
      params: {
        origins: `${fromLat},${fromLon}`,
        destinations: `${toLat},${toLon}`,
        mode: "transit",
        transit_mode: mappedMode,
        departure_time: "now",
        language: "es",
        units: "metric",
        key: GOOGLE_MAPS_API_KEY,
      },
    });

    const element = response.data?.rows?.[0]?.elements?.[0];
    if (element?.status === "OK" && Number.isFinite(element?.duration?.value)) {
      return {
        transit_time_minutes: Math.max(1, Math.round(element.duration.value / 60)),
        source: "google-maps-transit",
      };
    }

    return {
      transit_time_minutes: null,
      source: "google-maps-transit-unavailable",
    };
  } catch (_err) {
    return {
      transit_time_minutes: null,
      source: "google-maps-transit-unavailable",
    };
  }
}

let gtfsRtCache = {
  fetchedAt: 0,
  feed: null,
};

let czynaczasCache = {
  fetchedAtByStop: {},
  departuresByStop: {},
};

async function getGtfsRtFeed() {
  const now = Date.now();
  if (gtfsRtCache.feed && now - gtfsRtCache.fetchedAt < 15000) {
    return gtfsRtCache.feed;
  }

  try {
    const response = await axios.get(GTFS_RT_URL, {
      responseType: "arraybuffer",
      timeout: 5000,
    });
    const feed = gtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(response.data)
    );
    gtfsRtCache = { fetchedAt: now, feed };
    return feed;
  } catch (error) {
    console.warn("GTFS-RT fetch failed:", error.message);
    return null;
  }
}

function routeTypeToVehicle(routeType) {
  return routeType === "0" ? "TRAM" : "BUS";
}

function normalizeRouteToken(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function routeMatchesLine(departure, requestedLine) {
  const target = normalizeRouteToken(requestedLine);
  if (!target) return false;

  const routeName = normalizeRouteToken(departure.routeName);
  const routeId = normalizeRouteToken(departure.routeId);

  return (
    routeName === target ||
    routeId === target ||
    routeName.startsWith(target) ||
    routeId.startsWith(target)
  );
}

function applyLineFilter(departures, lines) {
  if (!lines || lines.length === 0) return departures;
  return departures.filter((dep) => lines.some((line) => routeMatchesLine(dep, line)));
}

function normalizeDirectionToken(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function routeDepartureKey(dep) {
  const routeToken = normalizeRouteToken(dep.routeName || dep.routeId || "");
  const directionToken = normalizeDirectionToken(dep.direction || "");
  return `${routeToken}|${directionToken}|${String(dep.vehicleType || "")}`;
}

function preferLaterDeparturesWithinFiveMinutes(departures) {
  const sorted = [...departures].sort((a, b) => (a.etaMinutes || 0) - (b.etaMinutes || 0));
  const deduped = [];
  const lastIndexByRoute = new Map();

  for (const dep of sorted) {
    const key = routeDepartureKey(dep);
    const previousIndex = lastIndexByRoute.get(key);

    if (previousIndex == null) {
      deduped.push(dep);
      lastIndexByRoute.set(key, deduped.length - 1);
      continue;
    }

    const previous = deduped[previousIndex];
    const diff = Math.abs((dep.etaMinutes || 0) - (previous.etaMinutes || 0));

    if (diff <= 5) {
      if ((dep.etaMinutes || 0) >= (previous.etaMinutes || 0)) {
        deduped[previousIndex] = dep;
      }
      continue;
    }

    deduped.push(dep);
    lastIndexByRoute.set(key, deduped.length - 1);
  }

  return deduped.sort((a, b) => (a.etaMinutes || 0) - (b.etaMinutes || 0));
}

async function fetchGtfsRtDepartures(stop) {
  const feed = await getGtfsRtFeed();
  if (!feed?.entity?.length) return [];

  const stopCandidates = new Set([
    stop.stop_id,
    stop.stop_code,
    normalizeStopToken(stop.stop_id),
    normalizeStopToken(stop.stop_code),
  ].filter(Boolean));

  const nowEpoch = Math.floor(Date.now() / 1000);
  const departures = [];
  const seen = new Set();

  for (const entity of feed.entity) {
    const tripUpdate = entity.tripUpdate;
    if (!tripUpdate || !tripUpdate.stopTimeUpdate) continue;

    const routeId = tripUpdate.trip?.routeId || "";
    const route = routesCache[routeId] || null;
    const routeName = route?.route_short_name || routeId;
    const direction = tripUpdate.trip?.tripHeadsign || "";
    const vehicleType = routeTypeToVehicle(route?.route_type || "3");

    for (const stopTime of tripUpdate.stopTimeUpdate) {
      const candidateRaw = stopTime.stopId;
      const candidateNorm = normalizeStopToken(candidateRaw);
      if (!stopCandidates.has(candidateRaw) && !stopCandidates.has(candidateNorm)) {
        continue;
      }

      const departureEpoch =
        longToNumber(stopTime.departure?.time) ?? longToNumber(stopTime.arrival?.time);
      if (!departureEpoch || departureEpoch < nowEpoch - 30) continue;

      const etaMinutes = Math.max(0, Math.ceil((departureEpoch - nowEpoch) / 60));
      const departureTime = new Date(departureEpoch * 1000).toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      });

      const dedupeKey = `${routeId}|${departureEpoch}|${candidateRaw}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      departures.push({
        routeId: routeId || routeName,
        routeName: routeName || routeId,
        direction,
        vehicleType,
        departureTime,
        etaMinutes,
      });
    }
  }

  return departures.sort((a, b) => a.etaMinutes - b.etaMinutes).slice(0, 30);
}

function parseCzynaczasEpoch(dateStr, secondsOfDay) {
  const raw = Number(secondsOfDay);
  if (!Number.isFinite(raw)) return null;

  const safeDate = String(dateStr || "");
  const y = Number(safeDate.slice(0, 4));
  const m = Number(safeDate.slice(4, 6));
  const d = Number(safeDate.slice(6, 8));

  const baseDate =
    Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) && y >= 2000 && m >= 1 && m <= 12 && d >= 1 && d <= 31
      ? new Date(y, m - 1, d, 0, 0, 0, 0)
      : new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 0, 0, 0, 0);

  return baseDate.getTime() + raw * 1000;
}

async function fetchCzynaczasDepartures(stopId) {
  const cacheKey = String(stopId);
  const now = Date.now();
  const cachedAt = czynaczasCache.fetchedAtByStop[cacheKey] || 0;
  const cachedDepartures = czynaczasCache.departuresByStop[cacheKey] || [];

  if (cachedDepartures.length > 0 && now - cachedAt < 15000) {
    return cachedDepartures;
  }

  const url = `${CZYNA_CZAS_API_BASE}/timetable/${encodeURIComponent(String(stopId))}?limit=30`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const err = new Error(`HTTP ${response.status}`);
      err.status = response.status;
      throw err;
    }

    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : [];
    const nowEpoch = Date.now();

    const departures = rows
      .map((row) => {
        const liveSecs = Number(row.departure_time_live);
        const plannedSecs = Number(row.departure_time);
        const chosenSecs = Number.isFinite(liveSecs) ? liveSecs : plannedSecs;
        const departureEpoch = parseCzynaczasEpoch(row.date, chosenSecs);
        if (!departureEpoch) return null;

        const etaMinutes = Math.ceil((departureEpoch - nowEpoch) / 60000);
        if (etaMinutes < 0 || etaMinutes > 240) return null;

        return {
          routeId: String(row.route_id || ""),
          routeName: String(row.route_id || ""),
          direction: String(row.trip_headsign || ""),
          vehicleType: row.type === "0" || row.type === 0 ? "TRAM" : "BUS",
          departureTime: secondsToHHmm(chosenSecs),
          etaMinutes,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.etaMinutes - b.etaMinutes)
      .slice(0, 30);

    czynaczasCache.fetchedAtByStop[cacheKey] = now;
    czynaczasCache.departuresByStop[cacheKey] = departures;

    return departures;
  } catch (error) {
    const status = error?.status;
    if (status === 429 && cachedDepartures.length > 0) {
      return cachedDepartures;
    }
    console.warn("Czynaczas API failed:", error.message);
    return [];
  }
}

async function fetchItsDepartures(stopCode) {
  const url = `http://rozklady.lodz.pl/Home/GetTimetableReal?busStopNum=${stopCode}`;
  try {
    const response = await axios.get(url, { timeout: 5000 });
    const xml = response.data;
    const result = await xml2js.parseStringPromise(xml, {
      explicitArray: false,
      mergeAttrs: true,
    });

    const schedules = result.Schedules || {};
    const stop = schedules.Stop || {};
    const stopName = stop.name || "";
    const tickerMessage = stop.ds || "";

    const dayTypeMap = { 1: "11", 2: "11", 3: "11", 4: "11", 5: "11", 6: "12", 0: "13" };
    const today = new Date().getDay();
    const wantedType = dayTypeMap[today];

    let day = schedules.Stop?.Day;
    if (Array.isArray(day)) {
      day = day.find((d) => d.type === wantedType) || day[0];
    }

    const departures = [];
    if (day && day.R) {
      const routes = Array.isArray(day.R) ? day.R : [day.R];

      routes.forEach((r) => {
        const route = r.nr ? String(r.nr).trim() : "";
        const direction = r.dir || "";
        const stops = Array.isArray(r.S) ? r.S : [r.S];
        const features = (r.vuw || "").trim();
        const vehicleType = r.vt === "T" ? "TRAM" : "BUS";

        stops.forEach((s) => {
          const th = s.th || "";
          const tm = s.tm || "";
          let etaMinutes =
            th === "" ? parseInt(tm, 10) : parseInt(th, 10) * 60 + parseInt(tm, 10);

          const departureTimeRaw = String(s.t || "").trim();
          if (!departureTimeRaw || !Number.isFinite(etaMinutes) || etaMinutes < 0 || etaMinutes > 360) {
            const [hh, mm] = departureTimeRaw.split(":").map((v) => Number(v));
            if (Number.isFinite(hh) && Number.isFinite(mm)) {
              const now = new Date();
              const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0);
              if (candidate.getTime() < now.getTime() - 60 * 1000) {
                candidate.setDate(candidate.getDate() + 1);
              }
              etaMinutes = Math.max(0, Math.round((candidate.getTime() - now.getTime()) / 60000));
            }
          }

          if (Number.isNaN(etaMinutes)) return;

          departures.push({
            routeId: route,
            routeName: route,
            direction,
            departureTime: departureTimeRaw,
            etaMinutes,
            vehicleType,
            features,
          });
        });
      });
    }

    return {
      stopName,
      tickerMessage,
      departures: departures.sort((a, b) => a.etaMinutes - b.etaMinutes).slice(0, 30),
    };
  } catch (error) {
    console.warn("ITS API failed:", error.message);
    return null;
  }
}

app.get("/stops/search", (req, res) => {
  const query = String(req.query.q || "").toLowerCase();
  if (!query || query.length < 2) {
    return res.status(400).json({ error: "Query debe tener al menos 2 caracteres" });
  }

  const results = Object.values(stopsCache)
    .filter((stop) => {
      const name = (stop.stop_name || "").toLowerCase();
      const id = (stop.stop_id || "").toLowerCase();
      const code = (stop.stop_code || "").toLowerCase();
      return name.includes(query) || id.includes(query) || code.includes(query);
    })
    .slice(0, 20);

  res.json({ query, results });
});

app.get("/stops/all", (_req, res) => {
  res.json({ stops: Object.values(stopsCache) });
});

app.get("/stops/:stop_id", (req, res) => {
  const resolvedStopId = resolveStopId(req.params.stop_id);
  const stop = resolvedStopId ? stopsCache[resolvedStopId] : null;
  if (!stop) {
    return res.status(404).json({ error: "Parada no encontrada" });
  }
  res.json(stop);
});

app.post("/walking-time", async (req, res) => {
  const { to_lat: toLat, to_lon: toLon } = req.body;

  if (!toLat || !toLon) {
    return res.status(400).json({ error: "Faltan coordenadas (to_lat, to_lon)" });
  }

  const walking = await calculateWalkingMetrics(DEFAULT_USER_LAT, DEFAULT_USER_LON, toLat, toLon);

  res.json({
    distance_km: walking.distance_km,
    walking_time_minutes: walking.walking_time_minutes,
    user_location: { lat: DEFAULT_USER_LAT, lon: DEFAULT_USER_LON },
    destination: { lat: toLat, lon: toLon },
    walking_speed_kmh: WALKING_SPEED_KMH,
    source: walking.source,
  });
});

app.post("/walking-time-between", async (req, res) => {
  const { from_lat: fromLat, from_lon: fromLon, to_lat: toLat, to_lon: toLon } = req.body;

  if (fromLat == null || fromLon == null || toLat == null || toLon == null) {
    return res.status(400).json({ error: "Faltan coordenadas (from_lat, from_lon, to_lat, to_lon)" });
  }

  const walking = await calculateWalkingMetrics(Number(fromLat), Number(fromLon), Number(toLat), Number(toLon));

  res.json({
    distance_km: walking.distance_km,
    walking_time_minutes: walking.walking_time_minutes,
    from: { lat: Number(fromLat), lon: Number(fromLon) },
    to: { lat: Number(toLat), lon: Number(toLon) },
    source: walking.source,
  });
});

app.post("/transit-time-between", async (req, res) => {
  const {
    from_lat: fromLat,
    from_lon: fromLon,
    to_lat: toLat,
    to_lon: toLon,
    transport_type: transportType,
  } = req.body;

  if (fromLat == null || fromLon == null || toLat == null || toLon == null) {
    return res.status(400).json({ error: "Faltan coordenadas (from_lat, from_lon, to_lat, to_lon)" });
  }

  const transit = await calculateTransitMetrics(
    Number(fromLat),
    Number(fromLon),
    Number(toLat),
    Number(toLon),
    String(transportType || "")
  );

  res.json({
    transit_time_minutes: transit.transit_time_minutes,
    from: { lat: Number(fromLat), lon: Number(fromLon) },
    to: { lat: Number(toLat), lon: Number(toLon) },
    transport_type: String(transportType || ""),
    source: transit.source,
  });
});

app.get("/stop-departures", async (req, res) => {
  const stopInput = req.query.stop_id;
  const linesStr = req.query.lines;
  const lines = linesStr ? String(linesStr).split(",").map((v) => v.trim()) : null;

  const resolvedStopId = resolveStopId(stopInput);
  if (!resolvedStopId || !stopsCache[resolvedStopId]) {
    return res.status(400).json({ error: "Parada no válida" });
  }

  const stop = stopsCache[resolvedStopId];

  try {
    let departures = [];
    let dataSource = "fallback";
    let stopName = stop.stop_name;
    let tickerMessage = "";
    const collectedSources = [];
    const collectedDepartures = [];

    // 1) Czynaczas API realtime/static-confirmed
    const czynaczasStopId = stop.stop_code || resolvedStopId;
    const czynaczasDepartures = applyLineFilter(await fetchCzynaczasDepartures(czynaczasStopId), lines);
    if (czynaczasDepartures.length > 0) {
      collectedDepartures.push(...czynaczasDepartures);
      collectedSources.push("realtime-czynaczas");
    }

    // 2) GTFS-RT realtime
    const gtfsRtDepartures = applyLineFilter(await fetchGtfsRtDepartures(stop), lines);
    if (gtfsRtDepartures.length > 0) {
      collectedDepartures.push(...gtfsRtDepartures);
      collectedSources.push("realtime-gtfsrt");
    }

    // 3) ITS XML realtime (MPK Łódź)
    if (stop.stop_code) {
      const itsData = await fetchItsDepartures(stop.stop_code);
      const itsDepartures = applyLineFilter(itsData?.departures || [], lines);
      if (itsData && itsDepartures.length > 0) {
        collectedDepartures.push(...itsDepartures);
        collectedSources.push("realtime-its");
        stopName = itsData.stopName || stopName;
        tickerMessage = itsData.tickerMessage || "";
      }
    }

    if (collectedDepartures.length > 0) {
      departures = preferLaterDeparturesWithinFiveMinutes(collectedDepartures).slice(0, 30);
      dataSource = [...new Set(collectedSources)].join("+");
    }

    // 4) Static GTFS fallback
    if (departures.length === 0) {
      const nowSecondsOfDay = getNowSecondsOfDay();
      const stopTimes = stopTimesCache[resolvedStopId] || [];

      const buildStaticDepartures = (maxEtaMinutes) =>
        stopTimes
          .map((st) => {
            const trip = tripsCache[st.trip_id];
            if (!trip) return null;

            const route = routesCache[trip.route_id] || {
              route_id: trip.route_id,
              route_short_name: trip.route_id,
              route_long_name: "",
              route_type: "3",
            };

            const routeName = route.route_short_name || route.route_id;
            const etaMinutes = Math.ceil((st.departure_secs - nowSecondsOfDay) / 60);
            if (etaMinutes <= 0 || etaMinutes > maxEtaMinutes) return null;

            return {
              routeId: route.route_id,
              routeName,
              direction: trip.trip_headsign || "",
              vehicleType: routeTypeToVehicle(route.route_type),
              departureTime: secondsToHHmm(st.departure_secs),
              etaMinutes,
            };
          })
          .filter(Boolean)
          .sort((a, b) => a.etaMinutes - b.etaMinutes)
          .slice(0, 30);

      departures = buildStaticDepartures(180);

      // If the strict 3h window has no results, widen window to keep line visibility.
      if (departures.length === 0) {
        departures = buildStaticDepartures(720);
      }

      departures = applyLineFilter(departures, lines);

      departures = preferLaterDeparturesWithinFiveMinutes(departures);

      if (departures.length > 0) {
        dataSource = "gtfs-static";
      }
    }

    // NO simulated fallback - only real or confirmed data

    res.json({
      stopId: resolvedStopId,
      stopCode: stop.stop_code,
      stopName,
      stop_lat: stop.stop_lat,
      stop_lon: stop.stop_lon,
      count: departures.length,
      departures: departures.slice(0, 20),
      currentTime: new Date().toLocaleTimeString("es-ES"),
      dataSource,
      tickerMessage,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error procesando horarios" });
  }
});

app.get("/routes/all", (_req, res) => {
  res.json({ routes: Object.values(routesCache) });
});

app.get("/route-info", (req, res) => {
  const shortName = req.query.route_short_name;
  if (!shortName) return res.status(400).json({ error: "Missing route_short_name" });

  const matchingRoutes = Object.values(routesCache).filter(
    (r) => r.route_short_name === shortName
  );
  if (matchingRoutes.length === 0) return res.status(404).json({ error: "Route not found" });

  const route = matchingRoutes[0];
  res.json({
    route_id: route.route_id,
    route_short_name: route.route_short_name,
    route_long_name: route.route_long_name,
    route_type: route.route_type === "0" ? "tram" : "bus",
  });
});

app.get("/travel-time", (req, res) => {
  const fromInput = req.query.from_stop;
  const toInput = req.query.to_stop;
  const routeQuery = req.query.route;

  if (!fromInput || !toInput || !routeQuery) {
    return res.status(400).json({ error: "Missing from_stop, to_stop, route" });
  }

  const fromStop = resolveStopId(fromInput);
  const toStop = resolveStopId(toInput);
  if (!fromStop || !toStop) {
    return res.status(400).json({ error: "Invalid stop ids" });
  }

  let totalMins = 0;
  let count = 0;
  const fromTimes = stopTimesCache[fromStop] || [];
  const toTimes = stopTimesCache[toStop] || [];

  for (const fromSt of fromTimes) {
    const fromTrip = tripsCache[fromSt.trip_id];
    if (!fromTrip) continue;

    const route = routesCache[fromTrip.route_id];
    const routeName = route?.route_short_name || fromTrip.route_id;
    if (routeName !== routeQuery && fromTrip.route_id !== routeQuery) continue;

    for (const toSt of toTimes) {
      if (fromSt.trip_id === toSt.trip_id && fromSt.departure_secs < toSt.arrival_secs) {
        totalMins += (toSt.arrival_secs - fromSt.departure_secs) / 60;
        count++;
        break;
      }
    }
  }

  res.json({ avg_travel_minutes: count > 0 ? Math.round(totalMins / count) : 0, matches: count });
});

app.get("/walking-from-stop", (req, res) => {
  const stopInput = req.query.stop_id;
  const resolvedStopId = resolveStopId(stopInput);
  const stop = resolvedStopId ? stopsCache[resolvedStopId] : null;
  if (!stop || !stop.stop_lat || !stop.stop_lon) {
    return res.status(400).json({ error: "Stop not found or no coords" });
  }

  const distanceKm = calculateDistance(stop.stop_lat, stop.stop_lon, DEFAULT_USER_LAT, DEFAULT_USER_LON);
  const walkMins = Math.round((distanceKm / WALKING_SPEED_KMH) * 60);

  res.json({
    stop_id: stop.stop_id,
    stop_name: stop.stop_name,
    distance_km: Math.round(distanceKm * 10) / 10,
    walking_time_minutes: walkMins,
    walking_speed_kmh: WALKING_SPEED_KMH,
  });
});

app.get("/routes", (_req, res) => {
  const routeShortNames = Object.values(routesCache).map((r) => r.route_short_name);
  res.json({ routes: [...new Set(routeShortNames)].sort() });
});

function extractPinterestPinId(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (!parsed.hostname.toLowerCase().includes("pinterest.")) return null;
    return parsed.pathname.match(/\/pin\/(\d+)/i)?.[1] || null;
  } catch {
    return null;
  }
}

async function normalizePinterestUrl(inputUrl) {
  const raw = String(inputUrl || "").trim();
  const parsed = new URL(raw);
  const host = parsed.hostname.toLowerCase();

  if (host.includes("pin.it")) {
    try {
      const response = await axios.get(raw, {
        timeout: 7000,
        maxRedirects: 10,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
      });

      const redirectedUrl = response?.request?.res?.responseUrl || raw;
      return String(redirectedUrl || raw);
    } catch {
      return raw;
    }
  }

  return raw;
}

function pinterestImageDedupKey(urlValue) {
  try {
    const parsed = new URL(String(urlValue || "").trim());
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname || "";

    if (host.includes("pinimg.com")) {
      const parts = pathname.split("/").filter(Boolean);
      const file = parts[parts.length - 1] || "";
      const filenameNoExt = file.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
      if (filenameNoExt) return `pinimg:${filenameNoExt}`;
    }

    return `${host}${pathname}`.toLowerCase();
  } catch {
    return String(urlValue || "").trim().toLowerCase();
  }
}

function dedupePinterestImagesByKey(urls, maxResults = 120) {
  const result = [];
  const seen = new Set();
  const hardLimit = Math.max(1, Number(maxResults) || 120);

  for (const raw of Array.isArray(urls) ? urls : []) {
    const value = String(raw || "").trim();
    if (!value) continue;
    const key = pinterestImageDedupKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= hardLimit) break;
  }

  return result;
}

function extractFirstImageFromHtml(html) {
  const content = String(html || "");
  if (!content) return null;

  const $ = cheerio.load(content);
  const candidate =
    $("img").first().attr("src") ||
    $("meta[property='og:image']").attr("content") ||
    null;

  if (!candidate) return null;
  return String(candidate).trim() || null;
}

function buildPinterestFeedUrl(canonicalUrl) {
  const parsed = new URL(String(canonicalUrl || "").trim());
  parsed.search = "";
  parsed.hash = "";
  const basePath = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
  parsed.pathname = `${basePath}feed.rss`;
  return parsed.toString();
}

function sanitizeXmlEntities(xmlText) {
  return String(xmlText || "").replace(/&(?!#\d+;|#x[\da-fA-F]+;|[a-zA-Z][a-zA-Z0-9]+;)/g, "&amp;");
}

function extractRssItemsByRegex(feedXml, canonicalUrl) {
  const content = String(feedXml || "");
  const itemMatches = content.match(/<item\b[\s\S]*?<\/item>/gi) || [];

  return itemMatches
    .map((block) => {
      const title = (block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1] ||
        block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ||
        "Pinterest")
        .replace(/<[^>]+>/g, "")
        .trim();

      const link =
        (block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "").trim() ||
        String(canonicalUrl || "");

      const htmlBlock =
        block.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/i)?.[1] ||
        block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i)?.[1] ||
        block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ||
        "";

      const imageUrl = extractFirstImageFromHtml(htmlBlock);
      if (!imageUrl) return null;

      return { imageUrl, title, link };
    })
    .filter(Boolean);
}

async function fetchPinterestBoardRssImages(boardUrl, maxResults = 200) {
  const normalizedUrl = await normalizePinterestUrl(boardUrl);
  const boardResponse = await axios.get(normalizedUrl, {
    timeout: 12000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });

  const boardHtml = String(boardResponse.data || "");
  const canonicalUrl = extractCanonicalPinterestUrl(boardHtml, normalizedUrl) || normalizedUrl;
  const feedUrl = buildPinterestFeedUrl(canonicalUrl);

  const feedResponse = await axios.get(feedUrl, {
    timeout: 12000,
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });

  const feedXmlRaw = String(feedResponse.data || "");
  const feedXml = sanitizeXmlEntities(feedXmlRaw);

  let mapped = [];
  try {
    const parsed = await xml2js.parseStringPromise(feedXml, {
      explicitArray: false,
      mergeAttrs: true,
      trim: true,
    });

    const rawItems = parsed?.rss?.channel?.item;
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

    mapped = items
      .map((item) => {
        const title = String(item?.title || "Pinterest").trim();
        const link = String(item?.link || canonicalUrl || "").trim();
        const rawHtml = String(item?.["content:encoded"] || item?.description || "");
        const imageUrl = extractFirstImageFromHtml(rawHtml);
        if (!imageUrl) return null;

        return {
          imageUrl,
          title,
          link,
        };
      })
      .filter(Boolean);
  } catch {
    mapped = extractRssItemsByRegex(feedXmlRaw, canonicalUrl);
  }

  let finalItems = [];

  if (mapped.length > 0) {
    const dedupedImages = dedupePinterestImagesByKey(
      mapped.map((item) => item.imageUrl),
      maxResults
    );
    const allowed = new Set(dedupedImages);

    finalItems = mapped
      .filter((item) => allowed.has(item.imageUrl))
      .slice(0, Math.max(1, Number(maxResults) || 200));
  }

  if (finalItems.length === 0) {
    const scraped = await fetchPinterestBoardImages(canonicalUrl, maxResults);
    finalItems = scraped.images.map((imageUrl, index) => ({
      imageUrl,
      title: `Pinterest ${index + 1}`,
      link: scraped.pinLinks[index] || canonicalUrl,
    }));
  }

  return {
    canonicalUrl,
    feedUrl,
    items: finalItems,
  };
}

function extractPinterestImagesFromHtml(html, maxResults = 120) {
  const content = String(html || "");
  if (!content) return [];

  const $ = cheerio.load(content);
  const candidates = [];

  const pushCandidate = (value) => {
    if (!value) return;
    let normalized = String(value)
      .trim()
      .replace(/\\u002F/g, "/")
      .replace(/\\\//g, "/");

    if (!normalized) return;
    if (normalized.startsWith("//")) normalized = `https:${normalized}`;

    const lowered = normalized.toLowerCase();
    if (!lowered.startsWith("http")) return;
    if (!lowered.includes("pinimg.com")) return;

    candidates.push(normalized);
  };

  $("meta[property='og:image']").each((_, el) => pushCandidate($(el).attr("content")));
  $("img[src]").each((_, el) => pushCandidate($(el).attr("src")));
  $("img[srcset]").each((_, el) => {
    const srcset = String($(el).attr("srcset") || "");
    srcset
      .split(",")
      .map((entry) => entry.trim().split(" ")[0])
      .filter(Boolean)
      .forEach((url) => pushCandidate(url));
  });

  const regexMatches = content.match(/https?:\/\/\S*pinimg\.com\S*/gi) || [];
  regexMatches.forEach((match) => pushCandidate(match));

  return dedupePinterestImagesByKey(candidates, maxResults);
}

function extractCanonicalPinterestUrl(html, fallbackUrl) {
  try {
    const $ = cheerio.load(String(html || ""));
    const options = [
      $("meta[property='og:url']").attr("content"),
      $("link[rel='canonical']").attr("href"),
      $("meta[name='twitter:url']").attr("content"),
    ].filter(Boolean);

    for (const candidate of options) {
      try {
        const parsed = new URL(String(candidate), String(fallbackUrl || "https://www.pinterest.com/"));
        const host = parsed.hostname.toLowerCase();
        if (host.includes("pinterest.")) {
          return parsed.toString();
        }
      } catch {
        // continue
      }
    }
  } catch {
    // ignore parsing issues
  }

  return String(fallbackUrl || "");
}

function extractPinterestPinLinks(html, fallbackUrl, maxResults = 120) {
  const content = String(html || "");
  if (!content) return [];

  const $ = cheerio.load(content);
  const links = [];

  const pushLink = (value) => {
    if (!value) return;
    try {
      const candidate = new URL(String(value), String(fallbackUrl || "https://www.pinterest.com/"));
      const host = candidate.hostname.toLowerCase();
      if (!host.includes("pinterest.")) return;

      const match = candidate.pathname.match(/\/pin\/(\d+)\//i);
      if (!match?.[1]) return;

      links.push(`https://www.pinterest.com/pin/${match[1]}/`);
    } catch {
      // ignore invalid URLs
    }
  };

  $("a[href]").each((_, el) => pushLink($(el).attr("href")));

  const regexMatches = content.match(/https?:\/\/[^"'\s<>]*pinterest\.[^"'\s<>]*\/pin\/\d+\//gi) || [];
  regexMatches.forEach((match) => pushLink(match));

  return [...new Set(links)].slice(0, Math.max(1, Number(maxResults) || 120));
}

async function extractPinterestImagesFromPinLinks(pinLinks, maxResults = 120) {
  const hardLimit = Math.max(1, Number(maxResults) || 120);
  const links = Array.isArray(pinLinks) ? pinLinks.slice(0, Math.min(hardLimit, 40)) : [];
  if (links.length === 0) return [];

  const responses = await Promise.allSettled(
    links.map((pinLink) =>
      axios.get(pinLink, {
        timeout: 7000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
      })
    )
  );

  const images = [];
  for (const result of responses) {
    if (result.status !== "fulfilled") continue;
    const html = String(result.value?.data || "");
    if (!html) continue;

    const $ = cheerio.load(html);
    const ogImage = $("meta[property='og:image']").attr("content");
    if (ogImage) {
      images.push(String(ogImage));
      continue;
    }

    const extracted = extractPinterestImagesFromHtml(html, hardLimit);
    if (extracted.length > 0) {
      images.push(extracted[0]);
    }
  }

  return dedupePinterestImagesByKey(images, hardLimit);
}

async function fetchPinterestBoardImages(boardUrl, maxResults = 120) {
  let normalizedUrl = await normalizePinterestUrl(boardUrl);
  const response = await axios.get(normalizedUrl, {
    timeout: 12000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });

  const html = String(response.data || "");
  const canonicalUrl = extractCanonicalPinterestUrl(html, normalizedUrl) || normalizedUrl;
  const baseImages = extractPinterestImagesFromHtml(html, maxResults);
  const pinLinks = extractPinterestPinLinks(html, canonicalUrl, maxResults);
  const imagesFromPins = await extractPinterestImagesFromPinLinks(pinLinks, maxResults);
  const images = dedupePinterestImagesByKey(
    [...imagesFromPins, ...baseImages],
    Math.max(1, Number(maxResults) || 120)
  );

  return {
    canonicalUrl,
    images,
    pinLinks,
  };
}

async function fetchPinterestPreview(pinUrl) {
  let normalizedUrl = await normalizePinterestUrl(pinUrl);
  const pinId = extractPinterestPinId(normalizedUrl);
  if (!pinId) {
    try {
      const response = await axios.get(normalizedUrl, {
        timeout: 9000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
      });

      const html = String(response.data || "");
      const $ = cheerio.load(html);
      let galleryImages = extractPinterestImagesFromHtml(html, 120);
      if (galleryImages.length === 0) {
        const pinLinks = extractPinterestPinLinks(html, normalizedUrl, 120);
        const fromPins = await extractPinterestImagesFromPinLinks(pinLinks, 120);
        if (fromPins.length > 0) {
          galleryImages = fromPins;
        }
      }
      const canonicalUrl = extractCanonicalPinterestUrl(html, normalizedUrl);

      return {
        imageUrl: galleryImages[0] || null,
        title:
          $("meta[property='og:title']").attr("content") ||
          $("title").text()?.trim() ||
          "Pinterest",
        pinId: null,
        normalizedUrl: canonicalUrl || normalizedUrl,
        galleryImages,
      };
    } catch {
      return { imageUrl: null, title: "Pinterest", pinId: null, normalizedUrl, galleryImages: [] };
    }
  }

  try {
    const oembedUrl = `https://www.pinterest.com/oembed/?url=${encodeURIComponent(normalizedUrl)}&format=json`;
    const oembedResponse = await axios.get(oembedUrl, {
      timeout: 7000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    });

    const thumbnailUrl = oembedResponse?.data?.thumbnail_url || null;
    const canonicalFromOembed = String(oembedResponse?.data?.url || "").trim();
    if (canonicalFromOembed && canonicalFromOembed.includes("pinterest.")) {
      normalizedUrl = canonicalFromOembed;
    }
    const title = oembedResponse?.data?.title || "Pinterest Pin";
    if (thumbnailUrl) {
      return { imageUrl: thumbnailUrl, title, pinId, normalizedUrl, galleryImages: [thumbnailUrl] };
    }
  } catch (_err) {
    // continue with HTML methods
  }

  const embedUrl = `https://assets.pinterest.com/ext/embed.html?id=${pinId}`;

  try {
    const embedResponse = await axios.get(embedUrl, {
      timeout: 7000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    });

    const $embed = cheerio.load(String(embedResponse.data || ""));
    const imageUrl =
      $embed("img[src*='pinimg.com']").first().attr("src") ||
      $embed("meta[property='og:image']").attr("content") ||
      null;
    const title =
      $embed("meta[property='og:title']").attr("content") ||
      $embed("title").text()?.trim() ||
      "Pinterest Pin";

    const galleryImages = extractPinterestImagesFromHtml(String(embedResponse.data || ""), 120);
    if (imageUrl || galleryImages.length > 0) {
      return { imageUrl: imageUrl || galleryImages[0] || null, title, pinId, normalizedUrl, galleryImages };
    }
  } catch (_err) {
    // fallback below
  }

  try {
    const pageResponse = await axios.get(normalizedUrl, {
      timeout: 7000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    });

    const $page = cheerio.load(String(pageResponse.data || ""));
    const pageHtml = String(pageResponse.data || "");
    const canonicalUrl = extractCanonicalPinterestUrl(pageHtml, normalizedUrl);
    const imageUrl = $page("meta[property='og:image']").attr("content") || null;
    let galleryImages = extractPinterestImagesFromHtml(pageHtml, 120);
    if (galleryImages.length === 0) {
      const pinLinks = extractPinterestPinLinks(pageHtml, canonicalUrl || normalizedUrl, 120);
      const fromPins = await extractPinterestImagesFromPinLinks(pinLinks, 120);
      if (fromPins.length > 0) {
        galleryImages = fromPins;
      }
    }
    const title =
      $page("meta[property='og:title']").attr("content") ||
      $page("title").text()?.trim() ||
      "Pinterest Pin";

    return {
      imageUrl: imageUrl || galleryImages[0] || null,
      title,
      pinId,
      normalizedUrl: canonicalUrl || normalizedUrl,
      galleryImages,
    };
  } catch (_err) {
    return { imageUrl: null, title: "Pinterest Pin", pinId, normalizedUrl, galleryImages: [] };
  }
}

app.get("/api/pinterest-preview", async (req, res) => {
  const rawUrl = String(req.query.url || "").trim();
  if (!rawUrl) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes("pinterest.") && !host.includes("pin.it")) {
      return res.status(400).json({ error: "Only Pinterest URLs are supported" });
    }

    const preview = await fetchPinterestPreview(rawUrl);
    return res.json({
      url: preview.normalizedUrl || rawUrl,
      pinId: preview.pinId,
      imageUrl: preview.imageUrl,
      title: preview.title,
      galleryImages: Array.isArray(preview.galleryImages) ? preview.galleryImages : [],
    });
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }
});

app.get("/api/pinterest-board-images", async (req, res) => {
  const rawUrl = String(req.query.url || "").trim();
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(10, Math.round(requestedLimit))) : 120;

  if (!rawUrl) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes("pinterest.") && !host.includes("pin.it")) {
      return res.status(400).json({ error: "Only Pinterest URLs are supported" });
    }

    const boardData = await fetchPinterestBoardImages(rawUrl, limit);
    return res.json({
      inputUrl: rawUrl,
      url: boardData.canonicalUrl,
      count: boardData.images.length,
      images: boardData.images,
      pinLinks: boardData.pinLinks,
      syncedAt: new Date().toISOString(),
      source: "pinterest-board-sync",
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to sync Pinterest board images",
      detail: error?.message || "unknown error",
    });
  }
});

app.get("/api/pinterest-rss-images", async (req, res) => {
  const rawUrl = String(req.query.url || "").trim();
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit) ? Math.min(300, Math.max(10, Math.round(requestedLimit))) : 200;

  if (!rawUrl) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes("pinterest.") && !host.includes("pin.it")) {
      return res.status(400).json({ error: "Only Pinterest URLs are supported" });
    }

    const rssData = await fetchPinterestBoardRssImages(rawUrl, limit);
    return res.json({
      inputUrl: rawUrl,
      url: rssData.canonicalUrl,
      feedUrl: rssData.feedUrl,
      count: rssData.items.length,
      items: rssData.items,
      syncedAt: new Date().toISOString(),
      source: "pinterest-rss-feed",
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch Pinterest RSS images",
      detail: error?.message || "unknown error",
    });
  }
});

app.get("/api/app-state", (_req, res) => {
  const state = readAppState();
  return res.json(state);
});

app.put("/api/app-state", (req, res) => {
  try {
    const links = Array.isArray(req.body?.links) ? req.body.links : null;
    if (!links) {
      return res.status(400).json({ error: "Body must contain links[]" });
    }

    const normalized = links
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const url = String(entry.url || "").trim();
        if (!url) return null;
        return {
          id: String(entry.id || crypto.randomUUID()),
          url,
          sourceUrl: typeof entry.sourceUrl === "string" ? entry.sourceUrl : undefined,
          title: String(entry.title || "Enlace"),
          note: String(entry.note || ""),
          domain: String(entry.domain || ""),
          createdAt: String(entry.createdAt || new Date().toISOString()),
        };
      })
      .filter(Boolean);

    const saved = writeAppState({ links: normalized });
    return res.json(saved);
  } catch (error) {
    return res.status(500).json({ error: "Failed to save app state", detail: error?.message || "unknown" });
  }
});

app.post("/api/cache-image", async (req, res) => {
  const rawUrl = String(req.body?.url || "").trim();
  if (!rawUrl) {
    return res.status(400).json({ error: "Missing image url" });
  }

  try {
    const parsed = new URL(rawUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return res.status(400).json({ error: "Only http/https URLs are allowed" });
    }

    const response = await axios.get(rawUrl, {
      responseType: "arraybuffer",
      timeout: 12000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      maxContentLength: 8 * 1024 * 1024,
    });

    const contentType = String(response.headers?.["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      return res.status(400).json({ error: "URL does not point to an image" });
    }

    const buffer = Buffer.from(response.data);
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(413).json({ error: "Image too large (max 8MB)" });
    }

    const hash = crypto.createHash("sha1").update(buffer).digest("hex");
    const ext = guessImageExtension(contentType, rawUrl);
    const filename = `${hash}.${ext}`;
    const filePath = path.join(PINTEREST_CACHE_DIR, filename);

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, buffer);
    }

    const cachedUrl = `${req.protocol}://${req.get("host")}/cached-images/${filename}`;

    return res.json({
      sourceUrl: rawUrl,
      cachedUrl,
      filename,
      size: buffer.length,
      persistedAt: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to cache image", detail: error?.message || "unknown" });
  }
});

const MPK_BASE_URL = "https://www.mpk.lodz.pl";
const MPK_DAY_LABELS = {
  ROBOCZY: "weekday",
  SOBOTA: "saturday",
  NIEDZIELA: "sunday_holiday",
  "NIEDZIELA I SWIETA": "sunday_holiday",
  "NIEDZIELA I ŚWIĘTA": "sunday_holiday",
};

const mpkScheduleCache = new Map();

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMpkDateParam(dateStr) {
  const fallback = new Date().toISOString().slice(0, 10);
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || "")) ? String(dateStr) : fallback;
  return `${safeDate}-12:00:00`;
}

function normalizeMpkDayType(rawLabel, isWeekend) {
  const normalized = String(rawLabel || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

  if (normalized && MPK_DAY_LABELS[normalized]) return MPK_DAY_LABELS[normalized];
  return isWeekend ? "weekend" : "weekday";
}

async function fetchMpkStopPage(stopNumber, dateParam) {
  const url = `${MPK_BASE_URL}/rozklady/przystanek.jsp`;
  const response = await axios.get(url, {
    timeout: 7000,
    params: {
      stopNumber: String(stopNumber),
      date: dateParam,
    },
  });

  return String(response.data || "");
}

function findTabliczkaForLine(stopHtml, line, preferredDirection) {
  const $ = cheerio.load(stopHtml);
  const targetLine = String(line || "").trim().toUpperCase();
  let bestMatch = null;

  $("a[href*='tabliczka.jsp']").each((_, el) => {
    const anchor = $(el);
    const anchorText = anchor.text().trim().toUpperCase();
    if (anchorText !== targetLine) return;

    const href = anchor.attr("href");
    if (!href) return;

    const tabliczkaUrl = new URL(href, MPK_BASE_URL);
    const directionParam = Number(tabliczkaUrl.searchParams.get("direction") || "0");
    const wrapperText = (anchor.parent().text() || "").replace(/\s+/g, " ").trim();
    const directionText = wrapperText.replace(new RegExp(`^${escapeRegex(anchor.text().trim())}`), "").trim();

    const score = preferredDirection && Number(preferredDirection) === directionParam ? 2 : 1;
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        url: tabliczkaUrl.toString(),
        direction: directionText || "",
        directionParam,
        score,
      };
    }
  });

  return bestMatch;
}

function parseMpkTimesFromTabliczka(tabliczkaHtml) {
  const $ = cheerio.load(tabliczkaHtml);
  const times = [];

  $("tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;

    const hourText = $(cells[0]).text().trim();
    if (!/^\d{1,2}$/.test(hourText)) return;

    const hour = Number(hourText);
    if (!Number.isFinite(hour) || hour < 0 || hour > 29) return;

    const minutesText = $(cells[1]).text().replace(/\s+/g, " ").trim();
    if (!minutesText) return;

    for (const token of minutesText.split(" ")) {
      const match = token.match(/^(\d{1,2})/);
      if (!match) continue;
      const minute = Number(match[1]);
      if (!Number.isFinite(minute) || minute < 0 || minute > 59) continue;
      times.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    }
  });

  const uniqueSorted = [...new Set(times)].sort();

  const fullText = $("body").text().replace(/\s+/g, " ").trim();
  const dayLabelMatch = fullText.match(/\b(ROBOCZY|SOBOTA|NIEDZIELA(?:\s+I\s+(?:SWIETA|ŚWIĘTA))?)\b/i);
  const dayLabel = dayLabelMatch ? dayLabelMatch[1].toUpperCase() : "";

  return {
    times: uniqueSorted,
    dayLabel,
  };
}

async function fetchMpkLineSchedule({ line, stopCandidates, preferredDirection, fallbackDirection, stopAlias }, selectedDate, isWeekend) {
  const dateParam = buildMpkDateParam(selectedDate);
  const cacheKey = `${line}|${selectedDate}|${preferredDirection || "*"}|${stopCandidates.join(",")}`;
  const now = Date.now();
  const cached = mpkScheduleCache.get(cacheKey);
  if (cached && now - cached.fetchedAt < 5 * 60 * 1000) {
    return cached.value;
  }

  for (const stopNumber of stopCandidates) {
    try {
      const stopHtml = await fetchMpkStopPage(stopNumber, dateParam);
      const tabliczka = findTabliczkaForLine(stopHtml, line, preferredDirection);
      if (!tabliczka?.url) continue;

      const tabResponse = await axios.get(tabliczka.url, { timeout: 7000 });
      const parsed = parseMpkTimesFromTabliczka(String(tabResponse.data || ""));
      if (!parsed.times.length) continue;

      const result = {
        line: String(line),
        direction: tabliczka.direction || fallbackDirection,
        times: parsed.times,
        stop: stopAlias,
        dayType: normalizeMpkDayType(parsed.dayLabel, isWeekend),
        source: "mpk-official",
      };

      mpkScheduleCache.set(cacheKey, { fetchedAt: now, value: result });
      return result;
    } catch (_err) {
      // try next candidate stop
    }
  }

  return null;
}

// Schedule endpoint for university commute future plans (hardcoded full-day)
app.get("/api/schedule/:routeType", (req, res) => {
  const rawRouteType = req.params.routeType;
  const selectedDateRaw = String(req.query.date || "").trim();

  const routeAlias = {
    coviToJorge: "toFaculty",
    jorgeToCovi: "toResidence",
  };

  const routeType = routeAlias[rawRouteType] || rawRouteType;

  if (!["toFaculty", "toResidence"].includes(routeType)) {
    return res.status(400).json({ error: "Invalid routeType. Must be 'toFaculty' or 'toResidence'" });
  }

  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(selectedDateRaw)
    ? new Date(`${selectedDateRaw}T12:00:00`)
    : new Date();

  const day = selectedDate.getDay();
  const dayType = day === 6 ? "saturday" : day === 0 ? "sunday" : "weekday";

  const buildTimesRange = (startHHmm, endHHmm, stepMinutes) => {
    const [startH, startM] = String(startHHmm).split(":").map(Number);
    const [endH, endM] = String(endHHmm).split(":").map(Number);

    let current = startH * 60 + startM;
    const end = endH * 60 + endM;
    const times = [];

    while (current <= end) {
      const h = String(Math.floor(current / 60)).padStart(2, "0");
      const m = String(current % 60).padStart(2, "0");
      times.push(`${h}:${m}`);
      current += stepMinutes;
    }

    return times;
  };

  const hardcodedSchedules = {
    toFaculty: {
      weekday: [
        { line: "12", direction: "Stoki", stop: "Resi", start: "04:40", end: "23:40", step: 20 },
        { line: "18", direction: "Telefoniczna", stop: "Resi", start: "04:50", end: "23:50", step: 20 },
        { line: "77", direction: "Dw. Północny", stop: "Resi", start: "04:32", end: "23:52", step: 20 },
        { line: "57", direction: "Dw. Północny", stop: "Resi", start: "04:30", end: "23:30", step: 30 },
      ],
      saturday: [
        { line: "12", direction: "Stoki", stop: "Resi", start: "05:00", end: "23:30", step: 30 },
        { line: "18", direction: "Telefoniczna", stop: "Resi", start: "05:10", end: "23:40", step: 30 },
        { line: "77", direction: "Dw. Północny", stop: "Resi", start: "05:20", end: "23:20", step: 40 },
        { line: "57", direction: "Dw. Północny", stop: "Resi", start: "05:15", end: "23:15", step: 40 },
      ],
      sunday: [
        { line: "12", direction: "Stoki", stop: "Resi", start: "05:30", end: "23:30", step: 40 },
        { line: "18", direction: "Telefoniczna", stop: "Resi", start: "05:40", end: "23:40", step: 40 },
        { line: "77", direction: "Dw. Północny", stop: "Resi", start: "06:00", end: "23:00", step: 60 },
        { line: "57", direction: "Dw. Północny", stop: "Resi", start: "05:50", end: "22:50", step: 60 },
      ],
    },
    toResidence: {
      weekday: [
        { line: "12", direction: "Retkinia", stop: "Uni", start: "04:35", end: "23:35", step: 20 },
        { line: "18", direction: "Retkinia", stop: "Uni", start: "04:45", end: "23:45", step: 20 },
        { line: "77", direction: "Stare Rokicie", stop: "Uni", start: "04:30", end: "23:50", step: 20 },
        { line: "57", direction: "Piastów Kurak", stop: "Uni", start: "04:25", end: "23:25", step: 30 },
      ],
      saturday: [
        { line: "12", direction: "Retkinia", stop: "Uni", start: "05:00", end: "23:30", step: 30 },
        { line: "18", direction: "Retkinia", stop: "Uni", start: "05:10", end: "23:40", step: 30 },
        { line: "77", direction: "Stare Rokicie", stop: "Uni", start: "05:20", end: "23:20", step: 40 },
        { line: "57", direction: "Piastów Kurak", stop: "Uni", start: "05:15", end: "23:15", step: 40 },
      ],
      sunday: [
        { line: "12", direction: "Retkinia", stop: "Uni", start: "05:30", end: "23:30", step: 40 },
        { line: "18", direction: "Retkinia", stop: "Uni", start: "05:40", end: "23:40", step: 40 },
        { line: "77", direction: "Stare Rokicie", stop: "Uni", start: "06:00", end: "23:00", step: 60 },
        { line: "57", direction: "Piastów Kurak", stop: "Uni", start: "05:50", end: "22:50", step: 60 },
      ],
    },
  };

  const schedules = (hardcodedSchedules[routeType][dayType] || []).map((item) => ({
    line: item.line,
    direction: item.direction,
    stop: item.stop,
    times: buildTimesRange(item.start, item.end, item.step),
  }));

  return res.json({
    routeType,
    selectedDate: selectedDate.toISOString().slice(0, 10),
    dayType,
    schedules,
    generatedAt: new Date().toISOString(),
    source: "hardcoded-future-schedules",
  });
});

app.listen(PORT, () => {
  console.log(`Backend API escuchando en http://localhost:${PORT}`);
  console.log(`✓ Loaded ${Object.keys(stopsCache).length} stops, ${Object.keys(routesCache).length} routes from GTFS`);
  console.log("Endpoints:");
  console.log("  GET  /stops/search?q=query        - Buscar paradas");
  console.log("  GET  /stops/:stop_id              - Obtener parada específica");
  console.log("  GET  /stop-departures?stop_id=X   - Próximos buses/tranvías");
  console.log("  POST /walking-time                - Calcular tiempo de caminata");
  console.log("  GET  /routes/all                  - All GTFS routes");
  console.log("  GET  /routes                      - Route short names");
});
