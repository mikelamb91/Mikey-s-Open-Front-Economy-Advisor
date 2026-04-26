"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, fn } = ns;
  const ROOT_ID = "ofe-signal-dock";
  let dockEl = null;
  let tickTimer = null;
  let lastSignature = "";
  let lastTickAt = 0;

  function isEnabled() {
    if (fn.isUiHidden && fn.isUiHidden()) return false;
    const settings = fn.getEffectiveExtensionSettings
      ? fn.getEffectiveExtensionSettings()
      : {};
    return settings.showSignalDock !== false;
  }

  function ensureDock() {
    if (dockEl && document.body.contains(dockEl)) return dockEl;
    if (!document.body) return null;

    dockEl = document.createElement("div");
    dockEl.id = ROOT_ID;
    dockEl.style.cssText = [
      "position:fixed",
      "top:10px",
      "right:10px",
      "z-index:2147483200",
      "min-width:230px",
      "max-width:280px",
      "padding:8px 10px",
      "border-radius:10px",
      "background:rgba(2,6,23,0.88)",
      "border:1px solid rgba(59,130,246,0.35)",
      "box-shadow:0 10px 24px rgba(2,6,23,0.55)",
      "font:12px/1.35 system-ui,sans-serif",
      "color:#e2e8f0",
      "pointer-events:none",
    ].join(";");
    document.body.appendChild(dockEl);
    return dockEl;
  }

  function fmtAgo(ms) {
    if (!ms || ms < 0) return "-";
    const sec = Math.floor(ms / 1000);
    if (sec < 1) return "now";
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return rem === 0 ? `${min}m` : `${min}m ${rem}s`;
  }

  function render() {
    if (document.hidden) return;
    if (!isEnabled()) {
      if (dockEl) dockEl.style.display = "none";
      lastSignature = "";
      return;
    }
    const el = ensureDock();
    if (!el) return;
    el.style.display = "";

    const stats = state.signalStats || {};
    const snapshot = state.strategicSnapshot || {};
    const sleeping = Number(snapshot.sleeping || 0);
    const traitor = Number(snapshot.traitor || 0);
    const lastAt = Number(stats.lastEventAt) || 0;
    const since = lastAt ? Date.now() - lastAt : 0;
    const phase = String(state.gamePhase || "none");
    const nextSignature = [
      phase,
      Number(stats.boatLanded || 0),
      Number(stats.boatDestroyed || 0),
      Number(stats.warshipDestroyed || 0),
      Number(stats.mirvInbound || 0),
      Number(stats.nukeInbound || 0),
      Number(stats.hydrogenInbound || 0),
      sleeping,
      traitor,
      lastAt ? Math.floor(since / 1000) : -1,
    ].join("|");
    if (nextSignature === lastSignature) return;
    lastSignature = nextSignature;

    el.innerHTML = [
      "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:6px'>",
      "<strong style='letter-spacing:.04em;text-transform:uppercase;color:#93c5fd;font-size:10px'>OFE Signals</strong>",
      `<span style='font-size:10px;color:#94a3b8'>${phase}</span>`,
      "</div>",
      "<div style='display:grid;grid-template-columns:1fr 1fr;gap:4px 10px'>",
      `<span>Boat landed</span><strong>${Number(stats.boatLanded || 0)}</strong>`,
      `<span>Boat destroyed</span><strong>${Number(stats.boatDestroyed || 0)}</strong>`,
      `<span>Warship destroyed</span><strong>${Number(stats.warshipDestroyed || 0)}</strong>`,
      `<span>MIRV inbound</span><strong>${Number(stats.mirvInbound || 0)}</strong>`,
      `<span>Nuke inbound</span><strong>${Number(stats.nukeInbound || 0)}</strong>`,
      `<span>Hydrogen inbound</span><strong>${Number(stats.hydrogenInbound || 0)}</strong>`,
      `<span>Sleeping neighbors</span><strong>${sleeping}</strong>`,
      `<span>Traitor neighbors</span><strong>${traitor}</strong>`,
      "</div>",
      `<div style='margin-top:6px;font-size:10px;color:#94a3b8'>Last signal: ${lastAt ? fmtAgo(since) : "-"}</div>`,
    ].join("");
  }

  fn.initSignalDock = () => {
    if (tickTimer) return;
    let pending = false;
    const scheduleRender = () => {
      const now = Date.now();
      const tier = String((state.strategicSnapshot && state.strategicSnapshot.threatTier) || "D1");
      const minGap = tier === "D3" ? 700 : tier === "D2" ? 1500 : 5000;
      if (now - lastTickAt < minGap) return;
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        lastTickAt = Date.now();
        render();
      });
    };
    const boot = () => {
      render();
      tickTimer = setInterval(() => {
        if (document.hidden) return;
        render();
      }, 5000);
      window.addEventListener("ofe-live-stats-updated", scheduleRender);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
  };
})();
