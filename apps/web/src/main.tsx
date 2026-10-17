import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Toaster } from "sonner";
import { App } from "./App";
import "./index.css";
import { setUnauthorizedHandler } from "./lib/api";
import { queryClient } from "./lib/queries";

// A 401 anywhere sends the user to the login page and back here afterwards.
setUnauthorizedHandler((loginPath) => {
  if (!window.location.pathname.startsWith("/login")) window.location.assign(loginPath);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster theme="dark" position="bottom-right" richColors closeButton />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
