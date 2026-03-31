import { useState, useEffect } from 'react';
import { getRoutes, type Route } from '../services/api';
import { CheckSquare, Square } from 'lucide-react';

interface LineSelectorProps {
  onChange: (selectedLines: string[]) => void;
  selectedLines?: string[];
}

export default function LineSelector({ onChange, selectedLines = [] }: LineSelectorProps) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [expandedRoutesFlat, setExpandedRoutesFlat] = useState<{id: string, name: string}[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);


  useEffect(() => {
    getRoutes().then(routes => {
      const expandedRoutesFlat = routes.flatMap(route => {
        const names = route.route_short_name.split('/');
        if (names.length === 1) {
          return [{ id: route.route_id, name: route.route_short_name }];
        } else {
          return names.map(name => ({ id: `${route.route_id}-${name.trim()}`, name: name.trim() }));
        }
      });
      setExpandedRoutesFlat(expandedRoutesFlat);
      setRoutes(routes);
      setLoading(false);
    }).catch(console.error);
  }, []);


  const toggleLine = (routeId: string) => {
    const newSelected = selectedLines.includes(routeId)
      ? selectedLines.filter(id => id !== routeId)
      : [...selectedLines, routeId];
    onChange(newSelected);
  };

  const allSelected = expandedRoutesFlat.length > 0 && selectedLines.length === expandedRoutesFlat.length;
  const toggleAll = () => {
    if (allSelected) {
      onChange([]);
    } else {
      onChange(expandedRoutesFlat.map(r => r.id));
    }
  };


  if (loading) return <div className="line-selector loading">Cargando líneas...</div>;

  const expandedRoutes = expanded ? expandedRoutesFlat : expandedRoutesFlat.slice(0, 10);


  return (
    <div className="line-selector">
      <div className="selector-header">
        <h3>Líneas</h3>
        <div className="selector-controls">
          <button className="toggle-all" onClick={toggleAll}>
            {allSelected ? <CheckSquare size={16} /> : <Square size= {16} />}
            Todos
          </button>
          {routes.length > 10 && (
            <button className="expand-btn" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Menos' : `+${routes.length - 10}`}
            </button>
          )}
        </div>
      </div>
      
      <div className="routes-grid">
{expandedRoutes.map(expanded => (
          <label key={expanded.id} className="route-checkbox">
            <input
              type="checkbox"
              checked={selectedLines.includes(expanded.id)}
              onChange={() => toggleLine(expanded.id)}
            />
            <span className="route-badge">{expanded.name}</span>
          </label>
        ))}

      </div>

      {selectedLines.length > 0 && (
        <div className="selected-count">
          Seleccionadas: {selectedLines.length}
        </div>
      )}
    </div>
  );
}

