import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
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
        const promoteWaitingWorker = (worker: ServiceWorker | null) => {
          if (!worker) return;
          worker.postMessage({ type: "SKIP_WAITING" });
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
          void registration.update();
        }, 60_000);
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
