import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LabProvider } from "./state/LabProvider";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app.css";

const container = document.getElementById("root");
if (!container) throw new Error("Bit Flip Lab: #root is missing from the document.");

createRoot(container).render(
  <StrictMode>
    <LabProvider>
      <App />
    </LabProvider>
  </StrictMode>,
);