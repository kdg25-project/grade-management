import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import "../app/globals.css";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { ToastProvider } from "@/components/toast-provider";
import { AppRoutes } from "./routes";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
);
