import { useState, useCallback, useEffect } from "react";
import { getAllStops } from "../services/api";
import { getFavorites, addFavorite, removeFavorite, isFavorite } from "../services/favorites";
import type { Stop } from "../services/api";
import { Search, Heart } from "lucide-react";

interface DestinationSearchProps {
  onSelectDest: (stop: Stop) => void;
}

export default function DestinationSearch({ onSelectDest }: DestinationSearchProps) {
  const [allStops, setAllStops] = useState<Stop[]>([]);
  const [filteredStops, setFilteredStops] = useState<Stop[]>([]);
  const [favorites, setFavorites] = useState<Stop[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStops = async () => {
      try {
        const stops = await getAllStops();
        setAllStops(stops);
        setFilteredStops(stops.slice(0, 50));
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
      setFilteredStops(allStops.slice(0, 50));
    } else {
      const filtered = allStops.filter((stop) => {
        const name = (stop.stop_name || "").toLowerCase();
        const id = (stop.stop_id || "").toLowerCase();
        return name.includes(searchQuery.toLowerCase()) || id.includes(searchQuery.toLowerCase());
      });
      setFilteredStops(filtered.slice(0, 100));
    }
  }, [allStops]);

  const handleSelectStop = (stop: Stop) => {
    onSelectDest(stop);
    setQuery("");
    setFilteredStops(allStops.slice(0, 50));
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

  if (loading) {
    return <div className="destination-search">Cargando paradas...</div>;
  }

  return (
    <div className="destination-search stop-search">
      <div className="search-input-wrapper">
        <Search size={20} className="search-icon" />
        <input
          type="text"
          placeholder="Destino (ej: Universidad, 123)"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          className="search-input"
        />
      </div>

      <div className="results-section">
        <h3>Destino</h3>
        <div className="stops-list">
          {filteredStops.map((stop) => (
            <div
              key={stop.stop_id}
              className="stop-item"
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

