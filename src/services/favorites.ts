import type { Stop } from "./api";

const FAVORITES_KEY = "lodz-bus-favorites";

export function getFavorites(): Stop[] {
  try {
    const data = localStorage.getItem(FAVORITES_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function addFavorite(stop: Stop): void {
  try {
    const favorites = getFavorites();
    if (!favorites.find((f) => f.stop_id === stop.stop_id)) {
      favorites.push(stop);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    }
  } catch (error) {
    console.error("Error adding favorite:", error);
  }
}

export function removeFavorite(stopId: string): void {
  try {
    const favorites = getFavorites().filter((f) => f.stop_id !== stopId);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } catch (error) {
    console.error("Error removing favorite:", error);
  }
}

export function isFavorite(stopId: string): boolean {
  return getFavorites().some((f) => f.stop_id === stopId);
}
