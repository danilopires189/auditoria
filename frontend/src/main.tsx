import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

const SERVICE_WORKER_UPDATE_INTERVAL_MS = 10 * 60 * 1000;

const routerBasename = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL.slice(0, -1)
  : import.meta.env.BASE_URL;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter basename={routerBasename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    void navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        let lastUpdateAt = 0;
        let updateInFlight = false;

        const promoteWaitingWorker = (worker: ServiceWorker | null) => {
          if (!worker) return;
          worker.postMessage({ type: "SKIP_WAITING" });
        };

        const requestRegistrationUpdate = () => {
          const now = Date.now();
          if (updateInFlight) return;
          if (now - lastUpdateAt < SERVICE_WORKER_UPDATE_INTERVAL_MS) return;

          updateInFlight = true;
          lastUpdateAt = now;
          void registration.update().finally(() => {
            updateInFlight = false;
          });
        };

        const handleVisibleUpdate = () => {
          if (document.visibilityState !== "visible") return;
          requestRegistrationUpdate();
        };

        promoteWaitingWorker(registration.waiting);

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              promoteWaitingWorker(registration.waiting);
            }
          });
        });

        window.setInterval(() => {
          requestRegistrationUpdate();
        }, SERVICE_WORKER_UPDATE_INTERVAL_MS);
        window.addEventListener("focus", requestRegistrationUpdate);
        document.addEventListener("visibilitychange", handleVisibleUpdate);
      })
      .catch(() => {
        // Mantem o app funcional mesmo se o registro do SW falhar.
      });
  });

  let hasRefreshedForNewWorker = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hasRefreshedForNewWorker) return;
    hasRefreshedForNewWorker = true;
    window.location.reload();
  });
}
