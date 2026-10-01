/**
 * Application shell.
 *
 * Navigation is four items and no more. The Lab is the default view because the
 * experiment is the product; nothing has to be discovered before one can be
 * run.
 */

import { useEffect, useRef } from "react";
import { LabView } from "./ui/LabView";
import { ButterflyView } from "./ui/ButterflyView";
import { ExperimentsView } from "./ui/ExperimentsView";
import { AboutView } from "./ui/AboutView";
import { useLabActions, useLabState } from "./state/LabProvider";
import type { View } from "./state/labState";

const NAV: readonly { id: View; label: string }[] = [
  { id: "lab", label: "Lab" },
  { id: "butterfly", label: "Butterfly" },
  { id: "experiments", label: "Experiments" },
  { id: "about", label: "About" },
];

export function App() {
  const state = useLabState();
  const actions = useLabActions();
  const mainRef = useRef<HTMLElement | null>(null);
  const firstRender = useRef(true);

  // A view change in a single-page app is navigation: move focus to the
  // top of the new view so a keyboard or screen-reader user is not stranded.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [state.view]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to the experiment
      </a>

      <header className="masthead">
        {/*
          The wordmark is the page's single h1, so every view has a top-level
          heading whether or not it renders one of its own.
        */}
        <h1 className="wordmark">
          <span>
            Bit Flip <span className="wordmark__mark">Lab</span>
          </span>
          <span className="wordmark__sub">Fault injection bench</span>
        </h1>

        <nav className="nav" aria-label="Primary">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className="nav__item"
              aria-current={state.view === item.id ? "page" : undefined}
              onClick={() => actions.setView(item.id)}
            >
              {item.label}
              {item.id === "experiments" && state.records.length > 0 ? (
                <span className="numeric" style={{ marginLeft: "0.4rem", color: "var(--accent)" }}>
                  {state.records.length}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
      </header>

      <main id="main" ref={mainRef} tabIndex={-1}>
        {state.view === "lab" ? <LabView /> : null}
        {state.view === "butterfly" ? <ButterflyView /> : null}
        {state.view === "experiments" ? <ExperimentsView /> : null}
        {state.view === "about" ? <AboutView /> : null}
      </main>

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {state.announcement}
      </div>
    </div>
  );
}