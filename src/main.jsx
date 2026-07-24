import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const isAdminRoute = window.location.pathname.startsWith("/admin");
const AdminApp = lazy(() => import("./admin/AdminApp"));

if (import.meta.env.DEV && "serviceWorker" in navigator) {
  window.addEventListener(
    "load",
    () => {
      navigator.serviceWorker
        .getRegistrations()
        .then(async (registrations) => {
          const removed = await Promise.all(
            registrations.map((registration) => registration.unregister()),
          );
          if (removed.some(Boolean) && "caches" in window) {
            const cacheNames = await window.caches.keys();
            await Promise.all(
              cacheNames.map((cacheName) => window.caches.delete(cacheName)),
            );
          }
        })
        .catch(() => {
          // A stale localhost worker must never stop the storefront from booting.
        });
    },
    { once: true },
  );
}

createRoot(document.getElementById("root")).render(
  isAdminRoute ? (
    <Suspense
      fallback={
        <div className="route-loading" role="status">
          Loading Kelenate Commerce…
        </div>
      }
    >
      <AdminApp />
    </Suspense>
  ) : (
    <App />
  ),
);
