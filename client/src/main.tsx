import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./api/http";
import { keys } from "./api/queries";
import { AuthProvider } from "./auth/AuthProvider";
import { App } from "./App";
import "./styles.css";

const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // Don't hammer the API on 4xx; do retry transient failures once.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 1,
    },
  },
  queryCache: new QueryCache({
    // Session expired mid-use → drop the user so the router sends them to sign in.
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) queryClient.setQueryData(keys.me, null);
    },
  }),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
