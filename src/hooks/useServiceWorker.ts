import { useEffect } from "react";

export function useServiceWorker() {
  useEffect(() => {
    // Solo registrar en producción o si está disponible
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/service-worker.js").then((registration) => {
          console.log("Service Worker registrado:", registration);

          // Manejar actualizaciones
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                  console.log("Actualizacion disponible");
                  // Aquí podrías mostrar un mensaje al usuario
                }
              });
            }
          });
        });
      });
    }
  }, []);
}
