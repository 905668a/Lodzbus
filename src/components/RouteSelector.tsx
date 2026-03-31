import { ArrowRight, Home, GraduationCap, MapPin } from "lucide-react";

interface RouteSelectorProps {
  onRouteSelect: (route: 'toFaculty' | 'toResidence') => void;
}

export default function RouteSelector({ onRouteSelect }: RouteSelectorProps) {
  return (
    <div className="route-selector">
      <div className="route-selector-header">
        <h2>¿Hacia dónde vas?</h2>
        <p>Student Depot Salsa Łódź ↔ Institute of Philosophy</p>
      </div>

      <div className="route-options">
        <button
          className="route-option route-to-faculty"
          onClick={() => onRouteSelect('toFaculty')}
        >
          <div className="route-visual">
            <div className="route-start">
              <Home size={28} />
              <span>Student Depot</span>
            </div>
            <ArrowRight size={20} className="route-arrow" />
            <div className="route-end">
              <GraduationCap size={28} />
              <span>Institute</span>
            </div>
          </div>
          <div className="route-badge">
            <MapPin size={14} />
            Ruta más común
          </div>
        </button>

        <button
          className="route-option route-to-residence"
          onClick={() => onRouteSelect('toResidence')}
        >
          <div className="route-visual">
            <div className="route-start">
              <GraduationCap size={28} />
              <span>Institute</span>
            </div>
            <ArrowRight size={20} className="route-arrow" />
            <div className="route-end">
              <Home size={28} />
              <span>Student Depot</span>
            </div>
          </div>
          <div className="route-badge">
            <MapPin size={14} />
            Ruta de vuelta
          </div>
        </button>
      </div>
    </div>
  );
}