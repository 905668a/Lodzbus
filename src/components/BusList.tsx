import { useEffect, useState } from "react";
import { getStopDepartures, calculateWalkingTime, getWalkingFromStop, getTravelTime } from "../services/api";
import type { StopDepartures, WalkingTimeResult, Stop } from "../services/api";
import { Clock, MapPin, AlertCircle } from "lucide-react";

interface BusListProps {
  stopId: string;
  lines?: string[];
  destStop?: Stop;
}

export default function BusList({ stopId, lines, destStop }: BusListProps) {
  const [departures, setDepartures] = useState<StopDepartures | null>(null);
  const [walkOrigin, setWalkOrigin] = useState<WalkingTimeResult | null>(null);
  const [travelTimes, setTravelTimes] = useState<Record<string, number>>({});
  const [walkDest, setWalkDest] = useState<WalkingTimeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const depsData = await getStopDepartures(stopId, lines);
        setDepartures(depsData);

        // Walk to origin
        if (depsData.stop_lat && depsData.stop_lon) {
          try {
            const walkOriginTime = await calculateWalkingTime(depsData.stop_lat, depsData.stop_lon);
            setWalkOrigin(walkOriginTime);
          } catch (error) {
            console.error("Error calculating walking time to origin:", error);
          }
        }

        // If destStop, fetch walk_dest and travel per line
        if (destStop) {
          try {
            const walkDestTime = await getWalkingFromStop(destStop.stop_id);
            setWalkDest(walkDestTime);
          } catch (error) {
            console.error("Error calculating walking time from destination:", error);
          }

          // Fetch travel time per departure line (batch or sequential)
          const travelPromises = depsData.departures.slice(0, 5).map(async (dep) => {
            try {
              const travel = await getTravelTime(stopId, destStop.stop_id, dep.routeId);
              return { routeId: dep.routeId, minutes: travel.avg_travel_minutes };
            } catch (error) {
              console.error(`Error getting travel time for route ${dep.routeId}:`, error);
              return null;
            }
          });
          const travels = await Promise.all(travelPromises);
          const travelMap = travels.reduce((acc, t) => {
            if (t) acc[t.routeId] = t.minutes;
            return acc;
          }, {} as Record<string, number>);
          setTravelTimes(travelMap);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        setLoading(false);
      }
    };

    if (stopId) fetchData();

    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [stopId, lines, destStop]);

  if (loading) {
    return <div className="bus-list loading">Cargando buses...</div>;
  }

  if (error) {
    return (
      <div className="bus-list error">
        <AlertCircle size={20} />
        <p>{error}</p>
      </div>
    );
  }

  if (!departures) {
    return <div className="bus-list empty">No hay datos disponibles</div>;
  }

  return (
    <div className="bus-list">
      <div className="bus-list-header">
        <MapPin size={20} />
        <h2>{departures.stopName || departures.stopId}</h2>
      </div>

{walkOrigin && (
        <div className="walking-time-info">
          <Clock size={18} />
          <div>
            <strong>{walkOrigin.walking_time_minutes} min</strong> caminata al origen
          </div>
        </div>
      )}

{departures.count === 0 ? (
        <div className="no-buses">No hay buses en próximos 120 min</div>
      ) : destStop ? (
        <div className="bus-cards">
          {departures.departures.map((dep, idx) => {
            const travel = travelTimes[dep.routeId] || 0;
            const etaOrigin = dep.etaMinutes;
            const walkD = walkDest?.walking_time_minutes || 0;
            const totalMin = etaOrigin + travel + walkD;
            const leaveMin = (walkOrigin?.walking_time_minutes || 0) + etaOrigin;
            const arrivalTime = new Date(Date.now() + totalMin * 60 * 1000).toLocaleTimeString('es-ES', { 
              hour: 'numeric', 
              minute: '2-digit' 
            });
            const departureTime = new Date(Date.now() + leaveMin * 60 * 1000).toLocaleTimeString('es-ES', { 
              hour: 'numeric', 
              minute: '2-digit' 
            });
            return (
              <div key={idx} className={`bus-card urgency-${leaveMin < 10 ? 'urgent' : leaveMin < 30 ? 'soon' : 'normal'}`}>



                <div className="bus-header">
                  <div className="route-big">{dep.routeId}</div>
                  <div className="eta-small">{etaOrigin}' ETA</div>
                </div>
                <div className="time-pair">
                  <div className="time-box departure">
                    <div className="time-icon">🚶</div>
                    <div className="time-label">Salir</div>
                    <div className="time-big">{departureTime}</div>
                    <div className="time-sub">{leaveMin}' ahora</div>
                  </div>
                  <div className="time-box arrival">
                    <div className="time-icon">🏁</div>
                    <div className="time-label">Llegada</div>
                    <div className="time-big">{arrivalTime}</div>
                    <div className="time-sub">{totalMin}' total</div>
                  </div>
                </div>
                <div className="breakdown">
                  <span>🚌 {travel || '?'}' viaje</span>
                  <span>🚶 {walkD}' destino</span>
                </div>
              </div>
            );
          })}
        </div>

      ) : (
        <div className="bus-cards no-dest">
          {departures.departures.map((dep, idx) => (
            <div key={idx} className="bus-card simple">
              <div className="bus-header">
                <div className="route-big">{dep.routeId}</div>
                <div className="eta-small">{dep.etaMinutes}'</div>
              </div>
              <div className="time-big">{dep.departureTime}</div>
            </div>
          ))}
        </div>

      )}
    </div>
  );
}
