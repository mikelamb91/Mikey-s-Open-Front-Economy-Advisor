"use strict";

/**
 * Clean-room lobby auto-join: listens for the game's `public-lobbies-update` event
 * (dispatched from the OpenFront client) and joins the first public lobby that matches
 * saved filter rules. Not derived from any third-party extension bundle.
 */
(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { fn } = ns;

  const STORAGE_KEY = "ofe.autojoin.rules.v1";
  const PANEL_ID = "ofe-autojoin-root";
  const GAME_MODE_FFA = "Free For All";
  const GAME_MODE_TEAM = "Team";
  const TEAM_DUOS = "Duos";
  const TEAM_TRIOS = "Trios";
  const TEAM_QUADS = "Quads";
  const HVN = "Humans Vs Nations";

  /** @typedef {{ enabled: boolean, sound: boolean, types: { ffa: boolean, teamDuos: boolean, teamTrios: boolean, teamLarge: boolean, special: boolean }, randomSpawn: string, alliancesDisabled: string, doubleGold: string, startingGold: string }} AutoJoinRules */

  /** @returns {AutoJoinRules} */
  function defaultRules() {
    return {
      enabled: false,
      sound: true,
      types: {
        ffa: true,
        teamDuos: true,
        teamTrios: true,
        teamLarge: true,
        special: true,
      },
      randomSpawn: "any",
      alliancesDisabled: "any",
      doubleGold: "any",
      startingGold: "any",
    };
  }

  /** @returns {AutoJoinRules} */
  function loadRules() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultRules();
      const o = JSON.parse(raw);
      return {
        ...defaultRules(),
        ...o,
        types: { ...defaultRules().types, ...(o.types || {}) },
      };
    } catch (_) {
      return defaultRules();
    }
  }

  /** @param {AutoJoinRules} r */
  function saveRules(r) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
    } catch (_) {}
  }

  /** @param {unknown} cfg */
  function teamSizeBucket(cfg) {
    if (!cfg || typeof cfg !== "object") return null;
    const mode = /** @type {{ gameMode?: string; playerTeams?: unknown }} */ (cfg).gameMode;
    if (mode !== GAME_MODE_TEAM) return null;
    const pt = /** @type {{ gameMode?: string; playerTeams?: unknown }} */ (cfg).playerTeams;
    if (pt === TEAM_DUOS || pt === 2) return "duos";
    if (pt === TEAM_TRIOS || pt === 3) return "trios";
    if (pt === TEAM_QUADS || pt === 4 || pt === HVN) return "large";
    if (typeof pt === "number") {
      if (pt < 2) return null;
      return "large";
    }
    return "large";
  }

  /**
   * @param {Record<string, unknown>} lobby
   * @param {AutoJoinRules} rules
   */
  function lobbyMatches(lobby, rules) {
    const cfg = lobby.gameConfig;
    if (!cfg || typeof cfg !== "object") return false;

    const publicGameType = lobby.publicGameType;
    if (publicGameType === "ffa") {
      if (!rules.types.ffa) return false;
      if (/** @type {{ gameMode?: string }} */ (cfg).gameMode !== GAME_MODE_FFA) return false;
    } else if (publicGameType === "team") {
      const b = teamSizeBucket(cfg);
      if (b === "duos" && !rules.types.teamDuos) return false;
      if (b === "trios" && !rules.types.teamTrios) return false;
      if (b === "large" && !rules.types.teamLarge) return false;
      if (!b) return false;
    } else if (publicGameType === "special") {
      if (!rules.types.special) return false;
    } else {
      return false;
    }

    const mods =
      /** @type {{ publicGameModifiers?: Record<string, unknown> }} */ (cfg).publicGameModifiers ||
      {};

    if (rules.randomSpawn === "yes" && !mods.isRandomSpawn) return false;
    if (rules.randomSpawn === "no" && mods.isRandomSpawn) return false;

    if (rules.alliancesDisabled === "yes" && !mods.isAlliancesDisabled) return false;
    if (rules.alliancesDisabled === "no" && mods.isAlliancesDisabled) return false;

    const mult = Number(mods.goldMultiplier);
    const isDouble = Number.isFinite(mult) && Math.abs(mult - 2) < 0.001;
    if (rules.doubleGold === "yes" && !isDouble) return false;
    if (rules.doubleGold === "no" && isDouble) return false;

    const rawGold = mods.startingGold;
    const goldM =
      rawGold == null || rawGold === ""
        ? 0
        : Math.round(Number(rawGold) / 1_000_000);
    if (rules.startingGold === "0") {
      if (Number(rawGold) > 0) return false;
    } else if (rules.startingGold === "5") {
      if (goldM !== 5) return false;
    } else if (rules.startingGold === "25") {
      if (goldM !== 25) return false;
    }

    return true;
  }

  /**
   * @param {Record<string, unknown[]>} games
   * @returns {Record<string, unknown>[]}
   */
  function orderedLobbies(games) {
    if (!games || typeof games !== "object") return [];
    const order = ["ffa", "team", "special"];
    const out = [];
    for (const key of order) {
      const arr = games[key];
      if (!Array.isArray(arr)) continue;
      for (const lobby of arr) {
        if (lobby && typeof lobby === "object") out.push(lobby);
      }
    }
    return out;
  }

  let lastJoinId = "";
  let lastJoinAt = 0;
  let rules = loadRules();
  let panelEl = null;

  function inGame() {
    try {
      return document.body && document.body.classList.contains("in-game");
    } catch (_) {
      return false;
    }
  }

  function playJoinSound() {
    if (!rules.sound) return;
    try {
      fn.playExtensionSound?.("gameStart", true);
    } catch (_) {}
  }

  /**
   * @param {Record<string, unknown>} lobby
   */
  function dispatchJoin(lobby) {
    const gameID = lobby.gameID;
    if (typeof gameID !== "string" || !gameID) return;

    const now = Date.now();
    if (gameID === lastJoinId && now - lastJoinAt < 8000) return;
    lastJoinId = gameID;
    lastJoinAt = now;

    document.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID,
          source: "public",
          publicLobbyInfo: lobby,
        },
        bubbles: true,
        composed: true,
      }),
    );

    rules.enabled = false;
    saveRules(rules);
    syncPanelFromRules();
    playJoinSound();
  }

  function onPublicLobbiesUpdate(ev) {
    if (!rules.enabled || inGame()) return;
    const payload = ev && ev.detail && ev.detail.payload;
    if (!payload || typeof payload !== "object") return;

    const games = /** @type {{ games?: Record<string, unknown[]> }} */ (payload).games;
    const list = orderedLobbies(games || {});
    for (const lobby of list) {
      if (lobbyMatches(lobby, rules)) {
        dispatchJoin(lobby);
        break;
      }
    }
  }

  function ensurePanel() {
    if (panelEl && document.body.contains(panelEl)) return;
    panelEl = null;

    if (!document.getElementById("ofe-autojoin-style")) {
      const style = document.createElement("style");
      style.id = "ofe-autojoin-style";
      style.textContent =
        "#" +
        PANEL_ID +
        " .ofe-aj-l{display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px}";
      document.documentElement.appendChild(style);
    }

    panelEl = document.createElement("div");
    panelEl.id = PANEL_ID;
    panelEl.setAttribute("data-ofe-autojoin", "1");
    panelEl.style.cssText = [
      "position:fixed",
      "z-index:2147483000",
      "left:12px",
      "bottom:12px",
      "max-width:min(360px,calc(100vw - 24px))",
      "font:12px/1.35 system-ui,sans-serif",
      "color:#e5e7eb",
      "background:rgba(15,23,42,0.92)",
      "border:1px solid rgba(148,163,184,0.35)",
      "border-radius:10px",
      "padding:10px 12px",
      "box-shadow:0 8px 28px rgba(0,0,0,0.45)",
      "backdrop-filter:blur(6px)",
    ].join(";");
    panelEl.innerHTML = [
      "<div style='display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px'>",
      "<strong style='font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#93c5fd'>OFE · Auto-join</strong>",
      "<label style='display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px'>",
      "<input type='checkbox' id='ofe-autojoin-enabled' />",
      "<span>On</span>",
      "</label>",
      "</div>",
      "<div id='ofe-autojoin-filters' style='display:grid;gap:6px;opacity:0.85'>",
      "<div style='font-size:10px;color:#94a3b8'>Lobby types</div>",
      "<div style='display:flex;flex-wrap:wrap;gap:6px 10px'>",
      "<label class='ofe-aj-l'><input type='checkbox' data-type='ffa'/> FFA</label>",
      "<label class='ofe-aj-l'><input type='checkbox' data-type='teamDuos'/> Duos</label>",
      "<label class='ofe-aj-l'><input type='checkbox' data-type='teamTrios'/> Trios</label>",
      "<label class='ofe-aj-l'><input type='checkbox' data-type='teamLarge'/> 4+ / large</label>",
      "<label class='ofe-aj-l'><input type='checkbox' data-type='special'/> Special</label>",
      "</div>",
      "<div style='display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px'>",
      "<label style='display:flex;flex-direction:column;gap:2px;font-size:10px;color:#94a3b8'>Random spawn<select id='ofe-aj-rand' style='margin-top:2px;padding:4px;border-radius:6px;background:#0f172a;color:#e5e7eb;border:1px solid #334155'><option value='any'>Any</option><option value='yes'>Yes</option><option value='no'>No</option></select></label>",
      "<label style='display:flex;flex-direction:column;gap:2px;font-size:10px;color:#94a3b8'>Alliances off<select id='ofe-aj-all' style='margin-top:2px;padding:4px;border-radius:6px;background:#0f172a;color:#e5e7eb;border:1px solid #334155'><option value='any'>Any</option><option value='yes'>Yes</option><option value='no'>No</option></select></label>",
      "<label style='display:flex;flex-direction:column;gap:2px;font-size:10px;color:#94a3b8'>2× gold<select id='ofe-aj-gold2' style='margin-top:2px;padding:4px;border-radius:6px;background:#0f172a;color:#e5e7eb;border:1px solid #334155'><option value='any'>Any</option><option value='yes'>Yes</option><option value='no'>No</option></select></label>",
      "<label style='display:flex;flex-direction:column;gap:2px;font-size:10px;color:#94a3b8'>Start gold<select id='ofe-aj-sg' style='margin-top:2px;padding:4px;border-radius:6px;background:#0f172a;color:#e5e7eb;border:1px solid #334155'><option value='any'>Any</option><option value='0'>0M</option><option value='5'>5M</option><option value='25'>25M</option></select></label>",
      "</div>",
      "<label style='display:flex;align-items:center;gap:6px;margin-top:6px;cursor:pointer;font-size:11px;color:#cbd5e1'>",
      "<input type='checkbox' id='ofe-autojoin-sound' /> Chime when joining",
      "</label>",
      "<p style='margin:8px 0 0;font-size:9px;line-height:1.35;color:#64748b'>Unofficial helper. Turns off after one join attempt. Uses the same <code style='font-size:9px'>join-lobby</code> event as the site UI.</p>",
      "</div>",
    ].join("");

    document.body.appendChild(panelEl);

    panelEl.querySelector("#ofe-autojoin-enabled")?.addEventListener("change", (e) => {
      rules.enabled = !!(/** @type {HTMLInputElement} */ (e.target).checked);
      saveRules(rules);
      syncPanelFromRules();
    });
    panelEl.querySelector("#ofe-autojoin-sound")?.addEventListener("change", (e) => {
      rules.sound = !!(/** @type {HTMLInputElement} */ (e.target).checked);
      saveRules(rules);
    });
    panelEl.querySelectorAll("input[data-type]").forEach((el) => {
      el.addEventListener("change", () => {
        panelEl.querySelectorAll("input[data-type]").forEach((box) => {
          const key = /** @type {HTMLInputElement} */ (box).dataset.type;
          if (key && rules.types && key in rules.types) {
            rules.types[/** @type {keyof AutoJoinRules['types']} */ (key)] =
              /** @type {HTMLInputElement} */ (box).checked;
          }
        });
        saveRules(rules);
      });
    });
    ["ofe-aj-rand", "ofe-aj-all", "ofe-aj-gold2", "ofe-aj-sg"].forEach((id) => {
      panelEl.querySelector("#" + id)?.addEventListener("change", (e) => {
        const v = /** @type {HTMLSelectElement} */ (e.target).value;
        if (id === "ofe-aj-rand") rules.randomSpawn = v;
        if (id === "ofe-aj-all") rules.alliancesDisabled = v;
        if (id === "ofe-aj-gold2") rules.doubleGold = v;
        if (id === "ofe-aj-sg") rules.startingGold = v;
        saveRules(rules);
      });
    });
  }

  function syncPanelFromRules() {
    if (!panelEl) return;
    const en = panelEl.querySelector("#ofe-autojoin-enabled");
    if (en) /** @type {HTMLInputElement} */ (en).checked = rules.enabled;
    const snd = panelEl.querySelector("#ofe-autojoin-sound");
    if (snd) /** @type {HTMLInputElement} */ (snd).checked = rules.sound;
    panelEl.querySelectorAll("input[data-type]").forEach((box) => {
      const key = /** @type {HTMLInputElement} */ (box).dataset.type;
      if (key && rules.types && key in rules.types) {
        /** @type {HTMLInputElement} */ (box).checked =
          !!rules.types[/** @type {keyof AutoJoinRules['types']} */ (key)];
      }
    });
    const sel = (id, val) => {
      const n = panelEl.querySelector("#" + id);
      if (n) /** @type {HTMLSelectElement} */ (n).value = val;
    };
    sel("ofe-aj-rand", rules.randomSpawn);
    sel("ofe-aj-all", rules.alliancesDisabled);
    sel("ofe-aj-gold2", rules.doubleGold);
    sel("ofe-aj-sg", rules.startingGold);
    const filters = panelEl.querySelector("#ofe-autojoin-filters");
    if (filters)
      /** @type {HTMLElement} */ (filters).style.opacity = rules.enabled ? "1" : "0.55";
  }

  function updateVisibility() {
    rules = loadRules();
    const uiHidden = fn.isUiHidden ? fn.isUiHidden() : false;
    const show = !inGame() && !!document.querySelector("game-mode-selector") && !uiHidden;
    if (!show) {
      if (panelEl) panelEl.style.display = "none";
      return;
    }
    ensurePanel();
    if (panelEl) {
      panelEl.style.display = "";
      syncPanelFromRules();
    }
  }

  let bodyObserverStarted = false;

  function startBodyObserver() {
    if (bodyObserverStarted) return;
    bodyObserverStarted = true;
    try {
      new MutationObserver(() => updateVisibility()).observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
        subtree: false,
      });
    } catch (_) {}
  }

  function initLobbyAutoJoin() {
    document.addEventListener("public-lobbies-update", onPublicLobbiesUpdate);
    const onReady = () => {
      updateVisibility();
      startBodyObserver();
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", onReady, { once: true });
    } else {
      onReady();
    }
    setInterval(updateVisibility, 4000);
    window.addEventListener("ofe-settings-updated", updateVisibility);
  }

  fn.initLobbyAutoJoin = initLobbyAutoJoin;
})();
