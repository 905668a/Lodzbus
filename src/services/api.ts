const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

export interface Stop {
  stop_id: string;
  stop_name: string;
  stop_lat: number | null;
  stop_lon: number | null;
}

export interface Departure {
  routeId: string;
  routeName: string;
  direction?: string;
  vehicleType?: string;
  departureTime: string;
  etaMinutes: number;
  features?: string;
}

export interface StopDepartures {
  stopId: string;
  stopCode?: string;
  stopName: string | null;
  stop_lat: number | null;
  stop_lon: number | null;
  count: number;
  departures: Departure[];
  dataSource?: string;
  tickerMessage?: string;
}

export interface WalkingTimeResult {
  distance_km: number;
  walking_time_minutes: number;
  user_location: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  walking_speed_kmh: number;
  source?: string;
}

export interface WalkingBetweenResult {
  distance_km: number;
  walking_time_minutes: number;
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  source: string;
}

export interface TransitBetweenResult {
  transit_time_minutes: number | null;
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  transport_type: string;
  source: string;
}

// Buscar paradas por nombre o ID
export async function searchStops(query: string): Promise<Stop[]> {
  const response = await fetch(`${API_BASE}/stops/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error("Error buscando paradas");
  const data = await response.json();
  return data.results;
}

// Obtener todas las paradas
export async function getAllStops(): Promise<Stop[]> {
  const response = await fetch(`${API_BASE}/stops/all`);
  if (!response.ok) throw new Error("Error obteniendo todas las paradas");
  const data = await response.json();
  return data.stops;
}

// Obtener parada específica
export async function getStop(stopId: string): Promise<Stop> {
  const response = await fetch(`${API_BASE}/stops/${stopId}`);
  if (!response.ok) throw new Error("Parada no encontrada");
  return response.json();
}

// Obtener departures/arrivals para una parada
export async function getStopDepartures(
  stopId: string,
  lines?: string[]
): Promise<StopDepartures> {
  const params = new URLSearchParams({ stop_id: stopId });
  if (lines && lines.length > 0) {
    params.append("lines", lines.join(","));
  }
  
  const response = await fetch(`${API_BASE}/stop-departures?${params}`);
  if (!response.ok) throw new Error("Error obteniendo departures");
  return response.json();
}

// Obtener líneas disponibles
export interface Route {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  route_type: string;
}

export async function getRoutes(): Promise<Route[]> {
  const response = await fetch(`${API_BASE}/routes/all`);
  if (!response.ok) throw new Error("Error obteniendo rutas");
  const data = await response.json();
  return data.routes;
}

// Calcular tiempo de caminata desde ubicación por defecto a un punto
export interface RouteInfo {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  route_type: 'tram' | 'bus';
}

export async function getRouteInfo(shortName: string): Promise<RouteInfo> {
  const response = await fetch(`${API_BASE}/route-info?route_short_name=${encodeURIComponent(shortName)}`);
  if (!response.ok) throw new Error(`Error obteniendo info de línea ${shortName}`);
  return response.json();
}

export async function getWalkingFromStop(stopId: string): Promise<WalkingTimeResult> {
  const response = await fetch(`${API_BASE}/walking-from-stop?stop_id=${stopId}`);
  if (!response.ok) throw new Error("Error calculando caminata desde parada");
  return response.json();
}

export async function getTravelTime(fromStop: string, toStop: string, route: string): Promise<{ avg_travel_minutes: number; matches: number }> {
  const response = await fetch(`${API_BASE}/travel-time?from_stop=${fromStop}&to_stop=${toStop}&route=${route}`);
  if (!response.ok) throw new Error("Error calculando tiempo de viaje");
  return response.json();
}

export async function calculateWalkingTime(
  toLat: number,
  toLon: number
): Promise<WalkingTimeResult> {
  const response = await fetch(`${API_BASE}/walking-time`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to_lat: toLat,
      to_lon: toLon,
    }),
  });
  
  if (!response.ok) throw new Error("Error calculando tiempo de caminata");
  return response.json();
}

export async function calculateWalkingBetween(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): Promise<WalkingBetweenResult> {
  const response = await fetch(`${API_BASE}/walking-time-between`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from_lat: fromLat,
      from_lon: fromLon,
      to_lat: toLat,
      to_lon: toLon,
    }),
  });

  if (!response.ok) throw new Error("Error calculando caminata entre puntos");
  return response.json();
}

export async function calculateTransitBetween(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  transportType: string
): Promise<TransitBetweenResult> {
  const response = await fetch(`${API_BASE}/transit-time-between`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from_lat: fromLat,
      from_lon: fromLon,
      to_lat: toLat,
      to_lon: toLon,
      transport_type: transportType,
    }),
  });

  if (!response.ok) throw new Error("Error calculando tiempo de transporte");
  return response.json();
}
