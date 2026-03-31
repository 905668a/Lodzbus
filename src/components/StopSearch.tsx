import { useState, useCallback, useEffect } from "react";
import { getAllStops } from "../services/api";
import { getFavorites, addFavorite, removeFavorite, isFavorite } from "../services/favorites";
import type { Stop } from "../services/api";
import { Search, Heart } from "lucide-react";

interface StopSearchProps {
  onSelectStop: (stop: Stop) => void;
  onSelectStops?: (stops: Stop[]) => void;
  multiSelect?: boolean;
}

export default function StopSearch({
  onSelectStop,
  onSelectStops,
  multiSelect = false,
}: StopSearchProps) {
  const [allStops, setAllStops] = useState<Stop[]>([]);
  const [filteredStops, setFilteredStops] = useState<Stop[]>([]);
  const [favorites, setFavorites] = useState<Stop[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedStops, setSelectedStops] = useState<Stop[]>([]);

  useEffect(() => {
    const loadStops = async () => {
      try {
        const stops = await getAllStops();
        
        // Filtrar solo paradas relevantes para rutas entre student depot y institute of philosophy
        const relevantStops = stops.filter(stop => {
          const name = (stop.stop_name || "").toLowerCase();
          return name.includes('narutowicza') || name.includes('unii lubelskiej') || name.includes('kampus');
        });
        
        // Renombrar paradas con nombres descriptivos y dirección
        const renamedStops = relevantStops.map(stop => {
          let newName = stop.stop_name;
          let direction = '';
          
          if (stop.stop_name.toLowerCase().includes('narutowicza') || stop.stop_name.toLowerCase().includes('kampus')) {
            newName = `Vuelta a Residencia Estudiantil - ${stop.stop_name}`;
            direction = 'Desde Instituto de Filosofía hacia dormitorios';
          } else if (stop.stop_name.toLowerCase().includes('unii lubelskiej')) {
            newName = `Ida a Facultad de Filosofía - ${stop.stop_name}`;
            direction = 'Desde dormitorios hacia Instituto de Filosofía';
          }
          
          // Agregar coordenadas como dirección aproximada
          const address = `Coordenadas: ${stop.stop_lat?.toFixed(6)}, ${stop.stop_lon?.toFixed(6)}`;
          
          return {
            ...stop,
            stop_name: `${newName} (${address})`,
            direction: direction
          };
        });
        
        setAllStops(renamedStops);
        setFilteredStops(renamedStops);
      } catch (error) {
        console.error("Error loading stops:", error);
      } finally {
        setLoading(false);
      }
    };
    loadStops();
    setFavorites(getFavorites());
  }, []);

  const handleSearch = useCallback((searchQuery: string) => {
    setQuery(searchQuery);
    if (searchQuery.length < 2) {
      setFilteredStops(allStops);
    } else {
      const filtered = allStops.filter((stop) => {
        const name = (stop.stop_name || "").toLowerCase();
        const id = (stop.stop_id || "").toLowerCase();
        return name.includes(searchQuery.toLowerCase()) || id.includes(searchQuery.toLowerCase());
      });
      setFilteredStops(filtered);
    }
  }, [allStops]);

  const handleSelectStop = (stop: Stop) => {
    if (multiSelect) {
      const isSelected = selectedStops.find((s) => s.stop_id === stop.stop_id);
      if (isSelected) {
        setSelectedStops(selectedStops.filter((s) => s.stop_id !== stop.stop_id));
      } else {
        setSelectedStops([...selectedStops, stop]);
      }
    } else {
      onSelectStop(stop);
      setQuery("");
      setFilteredStops(allStops);
    }
  };

  const handleToggleFavorite = (e: React.MouseEvent, stop: Stop) => {
    e.stopPropagation();
    if (isFavorite(stop.stop_id)) {
      removeFavorite(stop.stop_id);
      setFavorites(favorites.filter((f) => f.stop_id !== stop.stop_id));
    } else {
      addFavorite(stop);
      setFavorites([...favorites, stop]);
    }
  };

  const handleConfirmSelection = () => {
    if (multiSelect && onSelectStops && selectedStops.length > 0) {
      onSelectStops(selectedStops);
      setSelectedStops([]);
      setQuery("");
      setFilteredStops(allStops);
    }
  };

  if (loading) {
    return <div className="stop-search">Cargando paradas...</div>;
  }

  return (
    <div className="stop-search">
      <div className="search-input-wrapper">
        <Search size={20} className="search-icon" />
        <input
          type="text"
          placeholder="Buscar parada por nombre o ID..."
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          className="search-input"
        />
      </div>

      <div className="results-section">
        <div className="results-header">
          <h3>Selecciona una parada</h3>
          {multiSelect && selectedStops.length > 0 && (
            <button onClick={handleConfirmSelection} className="confirm-btn">
              Confirmar selección ({selectedStops.length})
            </button>
          )}
        </div>

        <div className="stops-list">
          {filteredStops.map((stop) => (
            <div
              key={stop.stop_id}
              className={`stop-item ${selectedStops.find((s) => s.stop_id === stop.stop_id) ? "selected" : ""}`}
              onClick={() => handleSelectStop(stop)}
            >
              <div className="stop-info">
                <div className="stop-name">{stop.stop_name}</div>
                <div className="stop-id">ID: {stop.stop_id}</div>
              </div>
              <button
                className={`favorite-btn ${isFavorite(stop.stop_id) ? "favorited" : ""}`}
                onClick={(e) => handleToggleFavorite(e, stop)}
              >
                <Heart size={16} />
              </button>
            </div>
          ))}
        </div>

        {filteredStops.length === 0 && query && (
          <div className="no-results">No se encontraron paradas</div>
        )}
      </div>
    </div>
  );
}
