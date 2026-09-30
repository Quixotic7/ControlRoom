import { SessionGate } from "./SessionGate";
import React from "react";
import { createRoot } from "react-dom/client";
import { AgentActivityProvider } from "./AgentActivity";
import { App } from "./App";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "@fontsource/pixelify-sans/latin-400.css";
import "@fontsource/pixelify-sans/latin-500.css";
import "@fontsource/pixelify-sans/latin-600.css";
import "@fontsource/pixelify-sans/latin-700.css";
import "@fontsource/silkscreen/latin-400.css";
import "@fontsource/silkscreen/latin-700.css";
import "./styles.css";
import "./project.css";
import "./retro.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SessionGate>
      <AgentActivityProvider>
        <App />
      </AgentActivityProvider>
    </SessionGate>
  </React.StrictMode>,
);
