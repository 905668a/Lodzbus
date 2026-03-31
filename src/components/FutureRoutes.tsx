import { useState, useEffect } from "react";
import { Clock, AlertCircle, RefreshCw } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

interface RouteSchedule {
  line: string;
  direction: string;
  times: string[];
  stop: string;
}

interface FutureRoutesProps {
  routeType: 'toFaculty' | 'toResidence';
}

export default function FutureRoutes({ routeType }: FutureRoutesProps) {
  const [schedules, setSchedules] = useState<RouteSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    fetchSchedules();
    const interval = setInterval(fetchSchedules, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [routeType, selectedDate]);

  const fetchSchedules = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date: selectedDate });
      const response = await fetch(`${API_BASE}/api/schedule/${routeType}?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Error: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("El backend devolvió HTML en vez de JSON. Revisa que backend esté encendido en puerto 3000.");
      }

      const data = await response.json();
      setSchedules(Array.isArray(data?.schedules) ? data.schedules : []);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar horarios");
      // Load fallback data that also changes by selected date (weekday/weekend)
      setSchedules(getFallbackSchedules(selectedDate));
    } finally {
      setLoading(false);
    }
  };

  const getFallbackSchedules = (dateStr: string) => {
    const d = new Date(`${dateStr}T12:00:00`);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;

    const baseSchedules = {
      toFaculty: [
        {
          line: "12",
          direction: "Stoki",
          stop: "Resi",
          times: isWeekend
            ? ["07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00"]
            : ["06:15", "06:45", "07:15", "07:45", "08:15", "08:45", "09:15", "09:45", "10:15", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30"]
        },
        {
          line: "18",
          direction: "Telefoniczna",
          stop: "Resi",
          times: isWeekend
            ? ["07:10", "07:40", "08:10", "08:40", "09:10", "09:40", "10:10", "10:40", "11:10"]
            : ["06:20", "06:50", "07:20", "07:50", "08:20", "08:50", "09:20", "09:50", "10:20", "14:35", "15:05", "15:35", "16:05", "16:35", "17:05", "17:35"]
        },
        {
          line: "57",
          direction: "Dw. Północny",
          stop: "Resi",
          times: isWeekend
            ? ["07:20", "08:00", "08:40", "09:20", "10:00", "10:40", "11:20"]
            : ["06:10", "06:40", "07:10", "07:40", "08:10", "08:40", "09:10", "09:40", "10:10", "14:20", "14:50", "15:20", "15:50", "16:20", "16:50", "17:20"]
        },
        {
          line: "77",
          direction: "Dw. Północny",
          stop: "Resi",
          times: isWeekend
            ? ["07:15", "07:55", "08:35", "09:15", "09:55", "10:35", "11:15"]
            : ["06:12", "06:32", "06:52", "07:12", "07:32", "07:52", "08:12", "08:32", "08:52", "09:12", "09:32", "09:52"]
        }
      ],
      toResidence: [
        {
          line: "77",
          direction: "Stare Rokicie",
          stop: "Uni",
          times: isWeekend
            ? ["12:40", "13:20", "14:00", "14:40", "15:20", "16:00", "16:40", "17:20"]
            : ["06:30", "07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "14:45", "15:15", "15:45", "16:15", "16:45", "17:15", "17:45"]
        },
        {
          line: "57",
          direction: "Piastów Kurak",
          stop: "Uni",
          times: isWeekend
            ? ["12:35", "13:15", "13:55", "14:35", "15:15", "15:55", "16:35", "17:15"]
            : ["06:25", "06:55", "07:25", "07:55", "08:25", "08:55", "09:25", "14:40", "15:10", "15:40", "16:10", "16:40", "17:10", "17:40"]
        },
        {
          line: "12",
          direction: "Retkinia",
          stop: "Uni",
          times: isWeekend
            ? ["12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00"]
            : ["06:35", "07:05", "07:35", "08:05", "08:35", "09:05", "09:35", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30"]
        },
        {
          line: "18",
          direction: "Retkinia",
          stop: "Uni",
          times: isWeekend
            ? ["12:45", "13:15", "13:45", "14:15", "14:45", "15:15", "15:45", "16:15", "16:45", "17:15"]
            : ["12:40", "13:00", "13:20", "13:40", "14:00", "14:20", "14:40", "15:00", "15:20", "15:40", "16:00", "16:20", "16:40", "17:00", "17:20"]
        }
      ]
    };
    return baseSchedules[routeType] || [];
  };

  const isTramLine = (line: string) => ["12", "18"].includes(String(line).trim());

  const getTitle = () => {
    return routeType === 'toFaculty' ? 'Resi → Uni' : 'Uni → Resi';
  };

  return (
    <div className="future-routes-container">
      <div className="future-routes-header">
        <div className="future-routes-title">
          <Clock size={28} className="header-icon" />
          <div>
            <h2>{getTitle()}</h2>
            <p className="last-update">
              Todos los horarios (bus/tram)
              {lastUpdate && ` • Última actualización: ${lastUpdate.toLocaleTimeString()}`}
            </p>
          </div>
        </div>

        <div className="future-routes-controls">
          <label htmlFor="future-date" className="future-date-label">Fecha</label>
          <input
            id="future-date"
            type="date"
            className="future-date-input"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
          <button 
            className="refresh-button"
            onClick={fetchSchedules}
            disabled={loading}
            title="Actualizar horarios"
          >
            <RefreshCw size={20} className={loading ? 'rotating' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {loading && schedules.length === 0 ? (
        <div className="schedule-loading">
          <div className="spinner"></div>
          <p>Cargando horarios...</p>
        </div>
      ) : (
        <div className="schedules-grid">
          {schedules.map((schedule, idx) => (
            <div key={idx} className="schedule-card">
              <div className="schedule-header">
                <span className={`line-badge ${isTramLine(schedule.line) ? 'tram' : 'bus'}`}>{schedule.line}</span>
                <span className="direction-text">{schedule.direction}</span>
              </div>
              
              <div className="schedule-stop">
                <p>{schedule.stop}</p>
              </div>

              <div className="times-section">
                <p className="times-label">Horarios del día:</p>
                <div className="times-list">
                  {schedule.times.map((time, i) => (
                    <div key={i} className="time-chip">
                      {time}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && schedules.length === 0 && (
        <div className="no-data-message">
          <p>No hay datos disponibles en este momento</p>
        </div>
      )}
    </div>
  );
}
