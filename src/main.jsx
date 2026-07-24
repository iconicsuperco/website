import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const isAdminRoute = window.location.pathname.startsWith("/admin");
const App = lazy(() => import("./App"));
const AdminApp = lazy(() => import("./admin/AdminApp"));

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {isAdminRoute ? (
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
      <Suspense
        fallback={
          <div className="route-loading" role="status">
            Loading Kelenate…
          </div>
        }
      >
        <App />
      </Suspense>
    )}
  </StrictMode>,
);
