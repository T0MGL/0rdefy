import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installConsoleSanitizer, sanitizeForClientLogs } from "./utils/sanitize";

installConsoleSanitizer();

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    sendDefaultPii: false,
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
    beforeSend(event) {
      return sanitizeForClientLogs(event);
    },
  });
}

const SentryApp = import.meta.env.VITE_SENTRY_DSN
  ? Sentry.withErrorBoundary(App, { fallback: <div>Something went wrong.</div> })
  : App;

createRoot(document.getElementById("root")!).render(<SentryApp />);
