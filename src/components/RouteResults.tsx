import { useState, useEffect, useCallback, useMemo } from "react";
import { ArrowLeft, Bus, Train, Footprints, ChevronDown, ChevronUp } from "lucide-react";
import { calculateTransitBetween } from "../services/api";

interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

interface Location {
  lat: number;
  lon: number;
  name: string;
}

interface RouteOption {
  type: string;
  line: string;
  departureStopId: string;
  walkToStop: { stop?: Stop; distance: number };
  transport: { type: string; line: string; direction?: string; durationMinutes: number };
  walkFromStop: { stop?: Stop; distance: number };
  description: string;
}

interface RouteData {
  name: string;
  origin: Location;
  destination: Location;
  options: RouteOption[];
}

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";
const RECENT_PAST_WINDOW_MS = 10 * 60 * 1000;
const RECENT_PAST_VISIBLE_MS = 5 * 60 * 1000;
const VALID_LATE_MARGIN_MS = 1 * 60 * 1000;
const STUDENT_DEPOT_ORIGIN_ADDRESS = "Student Depot Łódź, Stanisława Wigury 7 B, 90-301 Łódź";
const ONE_MINUTE_MS = 60 * 1000;
const DUPLICATE_ROUTE_WINDOW_MS = 5 * 60 * 1000;

interface RouteResultsProps {
  routeData: RouteData;
  onBack?: () => void;
}

interface ApiDeparture {
  routeId: string;
  routeName: string;
  departureTime: string;
  etaMinutes: number;
  direction?: string;
  vehicleType?: string;
}

interface DepartureBucket {
  source: string;
  departures: ApiDeparture[];
  error?: string;
}

interface ProcessedRouteOption extends RouteOption {
  departureTime: Date;
  transportStartTime: Date;
  busArrivalTime: Date;
  arrivalTime: Date;
  transportTime: number;
  walkToTime: number;
  walkFromTime: number;
  totalTime: number;
  nextDeparture: { etaMinutes: number };
}

interface OptionWalkingTimes {
  walkToTime: number;
  walkFromTime: number;
}

interface OptionTransitTime {
  transportTime: number;
  source: string;
}

function bucketKey(line: string, stopId: string) {
  return `${line}::${stopId}`;
}

function normalizeText(value?: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function directionMatches(expected?: string, actual?: string) {
  const expectedNorm = normalizeText(expected);
  const actualNorm = normalizeText(actual);

  if (!expectedNorm) return true;
  if (!actualNorm) return true;
  if (actualNorm.includes(expectedNorm) || expectedNorm.includes(actualNorm)) return true;

  const expectedTokens = expectedNorm.split(/\s+/).filter((t) => t.length >= 4);
  return expectedTokens.some((token) => actualNorm.includes(token));
}

function normalizeLineToken(value?: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function matchesLine(optionLine: string, dep: ApiDeparture) {
  const target = normalizeLineToken(optionLine);
  const routeName = normalizeLineToken(dep.routeName);
  const routeId = normalizeLineToken(dep.routeId);

  return (
    routeName === target ||
    routeId === target ||
    routeName.startsWith(target) ||
    routeId.startsWith(target)
  );
}

function minuteStamp(date: Date) {
  return Math.floor(date.getTime() / 60000);
}

function optionCacheKey(option: ProcessedRouteOption) {
  return `${option.type}|${option.line}|${option.departureStopId}|${minuteStamp(option.transportStartTime)}`;
}

function dedupeOptions(items: ProcessedRouteOption[]) {
  const seen = new Set<string>();
  const deduped: ProcessedRouteOption[] = [];

  for (const option of items) {
    const key = optionCacheKey(option);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(option);
    }
  }

  return deduped;
}

function dedupeRoutesWithin5Minutes(items: ProcessedRouteOption[]) {
  const sortedByDeparture = [...items].sort(
    (a, b) => a.departureTime.getTime() - b.departureTime.getTime()
  );
  const deduped: ProcessedRouteOption[] = [];
  const lastIndexByRoute = new Map<string, number>();

  for (const option of sortedByDeparture) {
    const routeKey = `${option.type}|${option.line}|${option.departureStopId}`;
    const previousIndex = lastIndexByRoute.get(routeKey);

    if (previousIndex == null) {
      deduped.push(option);
      lastIndexByRoute.set(routeKey, deduped.length - 1);
      continue;
    }

    const previous = deduped[previousIndex];
    const diffMs = Math.abs(option.departureTime.getTime() - previous.departureTime.getTime());

    if (diffMs <= DUPLICATE_ROUTE_WINDOW_MS) {
      if (option.transportStartTime.getTime() >= previous.transportStartTime.getTime()) {
        deduped[previousIndex] = option;
      }
      continue;
    }

    deduped.push(option);
    lastIndexByRoute.set(routeKey, deduped.length - 1);
  }

  return deduped;
}

function dedupePastByRoute(items: ProcessedRouteOption[]) {
  const bestByRoute = new Map<string, ProcessedRouteOption>();

  for (const option of items) {
    const key = `${option.type}|${option.line}|${option.departureStopId}`;
    const previous = bestByRoute.get(key);
    if (!previous || option.departureTime.getTime() > previous.departureTime.getTime()) {
      bestByRoute.set(key, option);
    }
  }

  return [...bestByRoute.values()];
}

export default function RouteResults({ routeData, onBack }: RouteResultsProps) {
  const [routeOptions, setRouteOptions] = useState<ProcessedRouteOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [departureBuckets, setDepartureBuckets] = useState<Record<string, DepartureBucket>>({});
  const [walkingByOption, setWalkingByOption] = useState<Record<string, OptionWalkingTimes>>({});
  const [transitByOption, setTransitByOption] = useState<Record<string, OptionTransitTime>>({});
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [showOlderPast, setShowOlderPast] = useState(false);
  const [showRecentPast, setShowRecentPast] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const calculateWalkingTime = (distance: number) => Math.ceil(distance / 83.33);
  const walkingKey = (option: RouteOption, index: number) => `${index}:${option.line}:${option.departureStopId}`;

  const fetchWalkingTimes = useCallback(async () => {
    const entries = routeData.options.map((option, index) => {
      const key = walkingKey(option, index);
      const walkToTime = option.walkToStop.distance ? calculateWalkingTime(option.walkToStop.distance) : 0;
      const walkFromTime = option.walkFromStop.distance ? calculateWalkingTime(option.walkFromStop.distance) : 0;
      return [key, { walkToTime, walkFromTime }] as const;
    });

    setWalkingByOption(Object.fromEntries(entries));
  }, [routeData.options]);

  const parseNearbyDeparture = (timeStr: string) => {
    const parts = String(timeStr || "").split(":").map((v) => Number(v));
    if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
      return new Date(Date.now() + 5 * 60 * 1000);
    }

    const [hours, minutes] = parts;
    const now = new Date();
    const departure = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);
    if (departure.getTime() < now.getTime()) departure.setDate(departure.getDate() + 1);
    return departure;
  };

  const fetchStopDepartures = useCallback(async () => {
    const pairs = Array.from(new Set(routeData.options.map((option) => `${option.line}|${option.departureStopId}`))).map((entry) => {
      const [line, stopId] = entry.split("|");
      return { line, stopId };
    });

    const results = await Promise.all(
      pairs.map(async ({ line, stopId }) => {
        const key = bucketKey(line, stopId);
        const params = new URLSearchParams({ stop_id: stopId, lines: line });

        try {
          const response = await fetch(`${API_BASE}/stop-departures?${params.toString()}`);
          if (!response.ok) throw new Error(`Error ${response.status}`);

          const data = await response.json();
          return {
            key,
            value: {
              source: data.dataSource || "unknown",
              departures: (data.departures || []).slice(0, 4),
            } as DepartureBucket,
          };
        } catch (error) {
          return {
            key,
            value: {
              source: "fallback",
              departures: [],
              error: (error as Error).message || "Error fetching departures",
            } as DepartureBucket,
          };
        }
      })
    );

    const nextBuckets = results.reduce<Record<string, DepartureBucket>>((acc, item) => {
      acc[item.key] = item.value;
      return acc;
    }, {});

    setDepartureBuckets(nextBuckets);
    setLastRefresh(new Date());
  }, [routeData.options]);

  useEffect(() => {
    void fetchStopDepartures();
    const refreshTimer = setInterval(() => {
      void fetchStopDepartures();
    }, 30000);

    return () => clearInterval(refreshTimer);
  }, [fetchStopDepartures]);

  useEffect(() => {
    void fetchWalkingTimes();
  }, [fetchWalkingTimes]);

  const fetchTransitTimes = useCallback(async () => {
    const results = await Promise.all(
      routeData.options.map(async (option, index) => {
        const key = walkingKey(option, index);
        const fromStop = option.walkToStop.stop;
        const toStop = option.walkFromStop.stop;

        if (!fromStop || !toStop) {
          return [
            key,
            {
              transportTime: option.transport.durationMinutes || 12,
              source: "fixed-config",
            },
          ] as const;
        }

        try {
          const transit = await calculateTransitBetween(
            fromStop.lat,
            fromStop.lon,
            toStop.lat,
            toStop.lon,
            option.transport.type
          );

          const dynamic = Number(transit.transit_time_minutes);
          if (Number.isFinite(dynamic) && dynamic > 0) {
            return [
              key,
              {
                transportTime: dynamic,
                source: transit.source || "google-maps-transit",
              },
            ] as const;
          }
        } catch (_err) {
          // fallback below
        }

        return [
          key,
          {
            transportTime: option.transport.durationMinutes || 12,
            source: "fixed-config",
          },
        ] as const;
      })
    );

    setTransitByOption(Object.fromEntries(results));
  }, [routeData.options]);

  useEffect(() => {
    void fetchTransitTimes();
  }, [fetchTransitTimes]);

  const calculateRouteOptions = useCallback(() => {
    setLoading(true);
    const options: ProcessedRouteOption[] = [];
    const nowMs = Date.now();

    for (const [optionIndex, option] of routeData.options.entries()) {
      const walking = walkingByOption[walkingKey(option, optionIndex)];
      const transit = transitByOption[walkingKey(option, optionIndex)];
      const walkToTime = walking?.walkToTime ?? (option.walkToStop.distance ? calculateWalkingTime(option.walkToStop.distance) : 0);
      const transportTime = option.transport.durationMinutes || transit?.transportTime || 12;
      const walkFromTime = walking?.walkFromTime ?? (option.walkFromStop.distance ? calculateWalkingTime(option.walkFromStop.distance) : 0);
      const totalTime = walkToTime + transportTime + walkFromTime;

      const key = bucketKey(option.line, option.departureStopId);
      const bucket = departureBuckets[key];
      const lineDepartures = (bucket?.departures || []).filter((dep) => matchesLine(option.line, dep));
      const directionalDepartures = lineDepartures.filter((dep) => directionMatches(option.transport.direction, dep.direction));
      const departuresForLine = (directionalDepartures.length > 0 ? directionalDepartures : lineDepartures).slice(0, 4);

      if (departuresForLine.length > 0) {
        const candidateDepartures = departuresForLine.map((d) => {
          const transportStartTime =
            d.etaMinutes >= 0 && d.etaMinutes <= 240
              ? new Date(Date.now() + d.etaMinutes * 60 * 1000)
              : parseNearbyDeparture(d.departureTime);
          const departureTime = new Date(transportStartTime.getTime() - (walkToTime + 1) * 60 * 1000);
          return { dep: d, transportStartTime, departureTime };
        });

        const selectedCandidate =
          candidateDepartures
            .filter((c) => c.departureTime.getTime() > nowMs - RECENT_PAST_WINDOW_MS)
            .sort((a, b) => a.transportStartTime.getTime() - b.transportStartTime.getTime())[0] ||
          candidateDepartures[candidateDepartures.length - 1];

        const dep = selectedCandidate.dep;
        const transportStartTime = selectedCandidate.transportStartTime;
        const departureTime = selectedCandidate.departureTime;
        const busArrivalTime = new Date(transportStartTime.getTime() + transportTime * 60 * 1000);
        const arrivalTime = new Date(busArrivalTime.getTime() + walkFromTime * 60 * 1000);

        options.push({
          ...option,
          departureTime,
          transportStartTime,
          busArrivalTime,
          arrivalTime,
          transportTime,
          walkToTime,
          walkFromTime,
          totalTime,
          nextDeparture: { etaMinutes: dep.etaMinutes },
        });
      }
    }

    options.sort((a, b) => a.arrivalTime.getTime() - b.arrivalTime.getTime());

    setRouteOptions((prevOptions) => {
      const recentPastFromPrevious = prevOptions.filter(
        (prevOption) =>
          prevOption.departureTime.getTime() <= nowMs &&
          prevOption.departureTime.getTime() >= nowMs - RECENT_PAST_WINDOW_MS
      );

      const merged = [...options];
      const seen = new Set(options.map((option) => optionCacheKey(option)));

      for (const prevOption of recentPastFromPrevious) {
        const key = optionCacheKey(prevOption);
        if (!seen.has(key)) {
          merged.push(prevOption);
          seen.add(key);
        }
      }

      return dedupeRoutesWithin5Minutes(dedupeOptions(merged)).sort(
        (a, b) => a.arrivalTime.getTime() - b.arrivalTime.getTime()
      );
    });

    setLoading(false);
  }, [routeData.options, departureBuckets, walkingByOption, transitByOption]);

  useEffect(() => {
    void calculateRouteOptions();
  }, [calculateRouteOptions]);

  const formatTime = (date: Date) => date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

  const buildWalkingMapsUrl = (stop?: Stop) => {
    if (!stop) return null;
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(STUDENT_DEPOT_ORIGIN_ADDRESS)}&destination=${stop.lat},${stop.lon}&travelmode=walking`;
  };

  const visibleOptions = routeOptions.filter(
    (option) => option.departureTime.getTime() > currentTime.getTime() - RECENT_PAST_WINDOW_MS
  );

  const recentPastOptions = visibleOptions.filter(
    (option) => option.departureTime.getTime() <= currentTime.getTime() - VALID_LATE_MARGIN_MS
  );

  const nearRecentPastOptions = recentPastOptions.filter((option) =>
    currentTime.getTime() - option.departureTime.getTime() <= RECENT_PAST_VISIBLE_MS
  );

  const olderRecentPastOptions = recentPastOptions.filter((option) =>
    currentTime.getTime() - option.departureTime.getTime() > RECENT_PAST_VISIBLE_MS
  );

  const upcomingOptions = visibleOptions.filter(
    (option) => option.departureTime.getTime() > currentTime.getTime() - VALID_LATE_MARGIN_MS
  );

  const sortedUpcomingOptions = dedupeOptions(
    [...upcomingOptions].sort((a, b) => {
      const arrivalDiff = a.arrivalTime.getTime() - b.arrivalTime.getTime();

      if (Math.abs(arrivalDiff) <= ONE_MINUTE_MS) {
        const walkingDiff = (a.walkToTime + a.walkFromTime) - (b.walkToTime + b.walkFromTime);
        if (walkingDiff !== 0) return walkingDiff;
      }

      if (arrivalDiff !== 0) return arrivalDiff;

      const walkingDiff = (a.walkToTime + a.walkFromTime) - (b.walkToTime + b.walkFromTime);
      if (walkingDiff !== 0) return walkingDiff;

      return a.departureTime.getTime() - b.departureTime.getTime();
    })
  );

  const sortedNearRecentPastOptions = dedupePastByRoute(
    [...nearRecentPastOptions].sort((a, b) => b.departureTime.getTime() - a.departureTime.getTime())
  );

  const sortedOlderRecentPastOptions = dedupePastByRoute(
    [...olderRecentPastOptions].sort((a, b) => b.departureTime.getTime() - a.departureTime.getTime())
  );

  const sourceSummary = useMemo(() => {
    const values = Object.values(departureBuckets);
    const uniqueSources = [...new Set(values.map((v) => v.source))];
    const hasErrors = values.some((v) => Boolean(v.error));
    return { uniqueSources, hasErrors };
  }, [departureBuckets]);

  if (loading) {
    return (
      <div className="route-results">
        <div className="loading">Calculando mejores rutas...</div>
      </div>
    );
  }

  return (
    <div className="route-results">
      <div className="route-header">
        {onBack && (
          <button className="back-button" onClick={onBack}>
            <ArrowLeft size={20} />
            Volver
          </button>
        )}
        <h2>{routeData.origin.name.includes("Student Depot") ? "Resi → Facultad" : "Facultad → Resi"}</h2>
        <div className="route-current-time">
          {currentTime.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>

      <div className="route-source-row">
        {sourceSummary.hasErrors ? (
          <div className="data-warning">Algunas líneas no tienen tiempo real; se muestra estimación local.</div>
        ) : (
          <div className="data-source">
            Fuente de horarios: {sourceSummary.uniqueSources.join(", ") || "desconocida"}
            {lastRefresh ? ` · actualizado ${formatTime(lastRefresh)}` : ""}
          </div>
        )}
      </div>

      <div className="route-options-list">
        {sortedNearRecentPastOptions.length > 0 && (
          <div className="past-routes-section">
            <button
              className="past-dropdown-toggle"
              onClick={() => setShowRecentPast(!showRecentPast)}
            >
              <span>⏱️ Acaban de pasar ({sortedNearRecentPastOptions.length})</span>
              {showRecentPast ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
            {showRecentPast && (
              <div className="past-dropdown-content">
                {sortedNearRecentPastOptions.map((option, pastIndex) => {
                  const walkingTotal = option.walkToTime + option.walkFromTime;
                  const walkingMapsUrl = buildWalkingMapsUrl(option.walkToStop.stop);
                  const minsSinceLeave = Math.abs(
                    Math.round((option.departureTime.getTime() - currentTime.getTime()) / 60000)
                  );

                  return (
                    <div key={`past-${pastIndex}`} className="route-option-card recent-past">
                      <div className="route-card-meta">
                        <div className="route-state-tag past">
                          Acaba de salir · hace {minsSinceLeave} min
                        </div>
                      </div>

                      <div className="route-top-row">
                        <div className={`line-flag ${option.type === "bus" ? "bus" : "tram"}`}>
                          <span className="line-number">{option.line}</span>
                          <span className="line-label">{option.type === "bus" ? "BUS" : "TRAM"}</span>
                        </div>

                        <div className="timeline-column">
                          <div className="time-axis">
                            <div className="time-block highlight-leave">
                              <div className="time-label">Salió a las</div>
                              <div className="time-value">{formatTime(option.departureTime)}</div>
                              <div className="time-duration">Andar {option.walkToTime} min</div>
                            </div>
                            <div className="timeline-arrow">→</div>
                            <div className="time-block highlight-pass">
                              <div className="time-label">Pasó por parada</div>
                              <div className="time-value">{formatTime(option.transportStartTime)}</div>
                              <div className="time-duration">Viaje {option.transportTime} min</div>
                            </div>
                            <div className="timeline-arrow">→</div>
                            <div className="time-block highlight-arrive-stop">
                              <div className="time-label">Llegó a parada destino</div>
                              <div className="time-value">{formatTime(option.busArrivalTime)}</div>
                              <div className="time-duration">Bajar y caminar {option.walkFromTime} min</div>
                            </div>
                            <div className="timeline-arrow">→</div>
                            <div className="time-block">
                              <div className="time-label">Llegó a destino</div>
                              <div className="time-value">{formatTime(option.arrivalTime)}</div>
                              <div className="time-duration">Andar final {option.walkFromTime} min</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="route-body totals-row">
                        <div className="route-step">
                          {option.type === "bus" ? <Bus size={18} /> : <Train size={18} />}
                          <div>
                            <div className="step-title">Transporte total</div>
                            <div className="step-subtitle">Línea {option.line} · {option.transportTime} min</div>
                          </div>
                        </div>

                        <div className="route-step">
                          <Footprints size={18} />
                          <div>
                            <div className="step-title">Andar total</div>
                            <div className="step-subtitle">{walkingTotal} min ({option.walkToTime} + {option.walkFromTime})</div>
                          </div>
                        </div>
                      </div>

                      <div className="route-footer">
                        <div className="arrival-tag">
                          Hubiera llegado a las {formatTime(option.arrivalTime)}
                        </div>
                        {walkingMapsUrl && (
                          <a className="walk-map-link" href={walkingMapsUrl} target="_blank" rel="noreferrer">
                            📍 Ver ubicación parada en mapa
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {sortedUpcomingOptions.length === 0 && sortedNearRecentPastOptions.length === 0 ? (
          <div className="route-option-card">
            <div className="arrival-tag">No hay salidas (ni en los últimos 10 min) para estas líneas.</div>
          </div>
        ) : (
          sortedUpcomingOptions.map((option, index) => {
            const walkingTotal = option.walkToTime + option.walkFromTime;
            const walkingMapsUrl = buildWalkingMapsUrl(option.walkToStop.stop);
            const minsToLeave = Math.round((option.departureTime.getTime() - currentTime.getTime()) / 60000);
            const upcomingLabel =
              minsToLeave > 0 ? `Sales en ${minsToLeave} min` : "Sales ahora";

            return (
              <div key={`${optionCacheKey(option)}-${index}`}>
                {index === 0 && (
                  <div className="list-section-label">Próximas salidas</div>
                )}

                <div className={`route-option-card ${index === 0 ? "best-route" : ""}`}>
                  <div className="route-card-meta">
                    {index === 0 && <div className="best-route-badge">⭐ Mejor ruta ahora</div>}
                    <div className="route-state-tag upcoming">
                      {upcomingLabel}
                    </div>
                  </div>

                  <div className="route-top-row">
                    <div className={`line-flag ${option.type === "bus" ? "bus" : "tram"}`}>
                      <span className="line-number">{option.line}</span>
                      <span className="line-label">{option.type === "bus" ? "BUS" : "TRAM"}</span>
                    </div>

                    <div className="timeline-column">
                      <div className="time-axis">
                        <div className="time-block highlight-leave">
                          <div className="time-label">Salir de origen</div>
                          <div className="time-value">{formatTime(option.departureTime)}</div>
                          <div className="time-duration">Andar {option.walkToTime} min</div>
                        </div>
                        <div className="timeline-arrow">→</div>
                        <div className="time-block highlight-pass">
                          <div className="time-label">Pasa por parada</div>
                          <div className="time-value">{formatTime(option.transportStartTime)}</div>
                          <div className="time-duration">Viaje {option.transportTime} min</div>
                        </div>
                        <div className="timeline-arrow">→</div>
                        <div className="time-block highlight-arrive-stop">
                          <div className="time-label">Llega a parada destino</div>
                          <div className="time-value">{formatTime(option.busArrivalTime)}</div>
                          <div className="time-duration">Bajar y caminar {option.walkFromTime} min</div>
                        </div>
                        <div className="timeline-arrow">→</div>
                        <div className="time-block">
                          <div className="time-label">Llegas a destino</div>
                          <div className="time-value">{formatTime(option.arrivalTime)}</div>
                          <div className="time-duration">Andar final {option.walkFromTime} min</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="route-body totals-row">
                    <div className="route-step">
                      {option.type === "bus" ? <Bus size={18} /> : <Train size={18} />}
                      <div>
                        <div className="step-title">Transporte total</div>
                        <div className="step-subtitle">Línea {option.line} · {option.transportTime} min</div>
                      </div>
                    </div>

                    <div className="route-step">
                      <Footprints size={18} />
                      <div>
                        <div className="step-title">Andar total</div>
                        <div className="step-subtitle">{walkingTotal} min ({option.walkToTime} + {option.walkFromTime})</div>
                      </div>
                    </div>
                  </div>

                  <div className="route-footer">
                    <div className="arrival-tag">
                      Te quedan {Math.max(0, minsToLeave)} min para salir de casa
                    </div>
                    {walkingMapsUrl && (
                      <a className="walk-map-link" href={walkingMapsUrl} target="_blank" rel="noreferrer">
                        Ir andando a la parada (Google Maps)
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {sortedOlderRecentPastOptions.length > 0 && (
          <div className="past-dropdown">
            <button
              type="button"
              className="past-dropdown-toggle"
              onClick={() => setShowOlderPast((prev) => !prev)}
            >
              <span>Rutas pasadas antiguas (&gt; 5 min): {sortedOlderRecentPastOptions.length}</span>
              {showOlderPast ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showOlderPast && (
              <div className="past-dropdown-content">
                <div className="list-section-label">Ocultas · salieron hace más de 5 min</div>
                {sortedOlderRecentPastOptions.map((option, index) => {
                  const walkingTotal = option.walkToTime + option.walkFromTime;
                  const walkingMapsUrl = buildWalkingMapsUrl(option.walkToStop.stop);
                  const minsToLeave = Math.round((option.departureTime.getTime() - currentTime.getTime()) / 60000);
                  const minsSinceLeave = Math.abs(minsToLeave);

                  return (
                    <div key={`older-${optionCacheKey(option)}-${index}`} className="route-option-card recent-past">
                      <div className="route-card-meta">
                        <div className="route-state-tag past">Acaba de salir · hace {minsSinceLeave} min</div>
                      </div>

                      <div className="route-top-row">
                        <div className={`line-flag ${option.type === "bus" ? "bus" : "tram"}`}>
                          <span className="line-number">{option.line}</span>
                          <span className="line-label">{option.type === "bus" ? "BUS" : "TRAM"}</span>
                        </div>

                        <div className="timeline-column">
                          <div className="time-axis">
                            <div className="time-block highlight-leave">
                              <div className="time-label">Salir de origen</div>
                              <div className="time-value">{formatTime(option.departureTime)}</div>
                              <div className="time-duration">Andar {option.walkToTime} min</div>
                            </div>
                            <div className="timeline-arrow">→</div>
                            <div className="time-block highlight-pass">
                              <div className="time-label">Pasa por parada</div>
                              <div className="time-value">{formatTime(option.transportStartTime)}</div>
                              <div className="time-duration">Viaje {option.transportTime} min</div>
                            </div>
                            <div className="timeline-arrow">→</div>
                            <div className="time-block highlight-arrive-stop">
                              <div className="time-label">Llega a parada destino</div>
                              <div className="time-value">{formatTime(option.busArrivalTime)}</div>
                              <div className="time-duration">Bajar y caminar {option.walkFromTime} min</div>
                            </div>
                            <div className="timeline-arrow">→</div>
                            <div className="time-block">
                              <div className="time-label">Llegas a destino</div>
                              <div className="time-value">{formatTime(option.arrivalTime)}</div>
                              <div className="time-duration">Andar final {option.walkFromTime} min</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="route-body totals-row">
                        <div className="route-step">
                          {option.type === "bus" ? <Bus size={18} /> : <Train size={18} />}
                          <div>
                            <div className="step-title">Transporte total</div>
                            <div className="step-subtitle">Línea {option.line} · {option.transportTime} min</div>
                          </div>
                        </div>

                        <div className="route-step">
                          <Footprints size={18} />
                          <div>
                            <div className="step-title">Andar total</div>
                            <div className="step-subtitle">{walkingTotal} min ({option.walkToTime} + {option.walkFromTime})</div>
                          </div>
                        </div>
                      </div>

                      <div className="route-footer">
                        <div className="arrival-tag">
                          Tendrías que haber salido hace {minsSinceLeave} mins (${formatTime(option.departureTime)})
                        </div>
                        {walkingMapsUrl && (
                          <a className="walk-map-link" href={walkingMapsUrl} target="_blank" rel="noreferrer">
                            Ir andando a la parada (Google Maps)
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
