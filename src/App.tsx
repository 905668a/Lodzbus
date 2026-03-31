import { useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import RouteResults from "./components/RouteResults";
import TeAmo from "./components/TeAmo";
import "./App.css";
import { Bus } from "lucide-react";


// Tipos para las rutas

// Coordenadas de ubicaciones clave
const LOCATIONS = {
  studentDepot: { lat: 51.757, lon: 19.467, name: "Student Depot Salsa Łódź" },
  institutePhilosophy: { lat: 51.774, lon: 19.480, name: "Institute of Philosophy" },
  coviHome: { lat: 51.765, lon: 19.475, name: "Casa de Covi" },
  jorgeHome: { lat: 51.780, lon: 19.485, name: "Casa de Jorge" }
};

const MIN_TO_METERS = 83.33;
const minsToDistance = (mins: number) => Math.round(mins * MIN_TO_METERS);

// Paradas clave
// Updated stops with line-specific stops for 12/18 distinction
const STOPS = {
  // Shared
  dwFabryczna: { id: "2166", name: "Dw. Łódź Fabryczna", lat: 51.770070, lon: 19.471110 },
  // Bus near depot
  sienPogotowie: { id: "1044", name: "Sienkiewicza-Pogotowie Rat", lat: 51.754510, lon: 19.464160 },
  sienPogotowieBack: { id: "1049", name: "Sienkiewicza-Pogotowie Rat", lat: 51.754940, lon: 19.463910 },
  // Tram near depot (for 12/18 diff)
  wiguryStudentDepot12: { id: "4871", name: "Wigury-Sienkiewicza", lat: 51.756380, lon: 19.464440 },
  pilsSienkiewiczaToStoki12: { id: "0734", name: "Piłsudskiego-Sienkiewicza", lat: 51.760200, lon: 19.462700 },
  wiguryStudentDepot18: { id: "1290", name: "Wigury-Kilińskiego NŻ", lat: 51.757200, lon: 19.468860 },
  wiguryStudentDepot77: { id: "4871", name: "Wigury-Sienkiewicza", lat: 51.756380, lon: 19.464440 },
  // Near faculty
  philosophyNear12: { id: "0590", name: "Narutowicza-Matejki (kampus UŁ)", lat: 51.773410, lon: 19.488400 },
  philosophyNear18: { id: "0596", name: "Narutowicza-Matejki (kampus UŁ)", lat: 51.773730, lon: 19.490050 },
  narutowiczaTramwajowa12: { id: "0600", name: "Narutowicza-Tramwajowa", lat: 51.772520, lon: 19.477060 },
  tuwimaKindermann: { id: "0492", name: "Tuwima-Rodziny Kindermannów NŻ", lat: 51.768890, lon: 19.477620 },
  narutowiczaDabrowskiego57: { id: "0585", name: "Narutowicza-pl. Dąbrowskiego", lat: 51.772900, lon: 19.480100 },
};

// FIXED ROUTES with user-confirmed walking times
const ROUTES = {
  toFaculty: {
    name: "Student Depot Salsa Łódź → Institute of Philosophy",
    origin: LOCATIONS.studentDepot,
    destination: LOCATIONS.institutePhilosophy,
    options: [
      {
        type: "tram",
        line: "12",
        departureStopId: STOPS.pilsSienkiewiczaToStoki12.id,
        walkToStop: { stop: STOPS.pilsSienkiewiczaToStoki12, distance: minsToDistance(12) },
        transport: { type: "tram", line: "12", direction: "Stoki", durationMinutes: 11 },
        walkFromStop: { stop: STOPS.philosophyNear12, distance: minsToDistance(7) },
        description: "Tram 12 (30 min)"
      },
      {
        type: "tram",
        line: "18",
        departureStopId: STOPS.pilsSienkiewiczaToStoki12.id,
        walkToStop: { stop: STOPS.pilsSienkiewiczaToStoki12, distance: minsToDistance(12) },
        transport: { type: "tram", line: "18", direction: "Telefoniczna", durationMinutes: 11 },
        walkFromStop: { stop: STOPS.philosophyNear18, distance: minsToDistance(4) },
        description: "Tram 18 (27 min)"
      },
      {
        type: "bus",
        line: "77",
        departureStopId: STOPS.sienPogotowie.id,
        walkToStop: { stop: STOPS.sienPogotowie, distance: minsToDistance(4) },
        transport: { type: "bus", line: "77", direction: "Retkinia", durationMinutes: 12 },
        walkFromStop: { stop: STOPS.philosophyNear18, distance: minsToDistance(9) },
        description: "Bus 77 (25 min)"
      },
      {
        type: "bus",
        line: "57",
        departureStopId: STOPS.sienPogotowie.id,
        walkToStop: { stop: STOPS.sienPogotowie, distance: minsToDistance(4) },
        transport: { type: "bus", line: "57", direction: "Dw. Północny", durationMinutes: 13 },
        walkFromStop: { stop: STOPS.philosophyNear18, distance: minsToDistance(9) },
        description: "Bus 57 (26 min)"
      }
    ]
  },
  toResidence: {
    name: "Institute of Philosophy → Student Depot Salsa Łódź",
    origin: LOCATIONS.institutePhilosophy,
    destination: LOCATIONS.studentDepot,
    options: [
      {
        type: "bus",
        line: "77",
        departureStopId: STOPS.dwFabryczna.id,
        walkToStop: { stop: STOPS.dwFabryczna, distance: minsToDistance(7) },
        transport: { type: "bus", line: "77", direction: "Stare Rokicie", durationMinutes: 12 },
        walkFromStop: { stop: STOPS.wiguryStudentDepot77, distance: minsToDistance(6) },
        description: "Bus 77 (26 min)"
      },
      {
        type: "bus",
        line: "57",
        departureStopId: STOPS.narutowiczaDabrowskiego57.id,
        walkToStop: { stop: STOPS.narutowiczaDabrowskiego57, distance: minsToDistance(6) },
        transport: { type: "bus", line: "57", direction: "Piastów Kurak", durationMinutes: 13 },
        walkFromStop: { stop: STOPS.sienPogotowieBack, distance: minsToDistance(3) },
        description: "Bus 57 (22 min)"
      },
      {
        type: "tram",
        line: "12",
        departureStopId: STOPS.narutowiczaTramwajowa12.id,
        walkToStop: { stop: STOPS.narutowiczaTramwajowa12, distance: minsToDistance(4) },
        transport: { type: "tram", line: "12", direction: "Retkinia", durationMinutes: 11 },
        walkFromStop: { stop: STOPS.wiguryStudentDepot12, distance: minsToDistance(11) },
        description: "Tram 12 (25 min)"
      },
      {
        type: "tram",
        line: "18",
        departureStopId: STOPS.philosophyNear18.id,
        walkToStop: { stop: STOPS.philosophyNear18, distance: minsToDistance(4) },
        transport: { type: "tram", line: "18", direction: "Retkinia", durationMinutes: 11 },
        walkFromStop: { stop: STOPS.wiguryStudentDepot18, distance: minsToDistance(11) },
        description: "Tram 18 (26 min)"
      }
    ]
  }
};

export default function App() {
  const [currentRoute, setCurrentRoute] = useState<'toFaculty' | 'toResidence'>('toFaculty');
  const [currentPage, setCurrentPage] = useState<'routes' | 'teAmo'>('routes');
  const [menuOpen, setMenuOpen] = useState(false);
  const routeData = ROUTES[currentRoute];

  const handleRouteSwitch = (route: 'toFaculty' | 'toResidence') => {
    setCurrentRoute(route);
    setMenuOpen(false);
    window.location.hash = `#/rutas?route=${route}`;
  };

  return (
    <ErrorBoundary>
      <div className="app">
        <header className="app-header">
          <button 
            className="hamburger-btn"
            onClick={() => setMenuOpen(!menuOpen)}
            title="Menú"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>

          <div className="header-content">
            <Bus size={32} className="header-icon" />
            <h1>Łódź Travel Planner</h1>
            <p className="subtitle">Student Depot Salsa Łódź ↔ Institute of Philosophy</p>
          </div>

          {currentPage === 'routes' && (
            <div className="header-buttons">
              <button 
                className={`header-btn ${currentRoute === 'toFaculty' ? 'active' : ''}`}
                onClick={() => handleRouteSwitch('toFaculty')}
              >
                Ida
              </button>
              <button 
                className={`header-btn ${currentRoute === 'toResidence' ? 'active' : ''}`}
                onClick={() => handleRouteSwitch('toResidence')}
              >
                Vuelta
              </button>
            </div>
          )}

        </header>

        {menuOpen && (
          <nav className="sidebar-menu">
            <div className="menu-header">
              <h2>Navegación</h2>
              <button 
                className="menu-close-btn"
                onClick={() => setMenuOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="menu-items">
              <button 
                className={`menu-item ${currentPage === 'routes' ? 'active' : ''}`}
                onClick={() => {
                  setCurrentPage('routes');
                  setMenuOpen(false);
                }}
              >
                🚌 Rutas
              </button>
              <button 
                className={`menu-item ${currentPage === 'teAmo' ? 'active' : ''}`}
                onClick={() => {
                  setCurrentPage('teAmo');
                  setMenuOpen(false);
                }}
              >
                💕 Te Amo
              </button>
            </div>
          </nav>
        )}

        <main className="app-main">
          {currentPage === 'routes' && (
            <RouteResults key={currentRoute} routeData={routeData} onBack={undefined} />
          )}
          {currentPage === 'teAmo' && (
            <TeAmo onBack={() => setCurrentPage('routes')} />
          )}
        </main>
      </div>
    </ErrorBoundary>
  );
}

