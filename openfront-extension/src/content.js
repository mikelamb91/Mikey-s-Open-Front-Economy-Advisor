/**
 * OpenFront Enhanced — Content Script (runs in ISOLATED world)
 *
 * During spawn phase: adds highly visible markers on every nation so you can
 * see them from any zoom level when picking a start location. Removed when
 * the game starts.
 *
 * Reads data from attributes on <html> set by page-hook.js (MAIN world):
 *   - data-ofe-nations: nation positions for spawn dots
 */

"use strict";

(() => {
  try {
    document.documentElement.setAttribute(
      "data-ofe-extension-url",
      chrome.runtime.getURL(""),
    );
  } catch (_) {}

  let watchInterval = null;
  let spawnActive = false;
  let dotContainer = null;
  let cachedNameLayerContainer = null;
  let cachedSpawnTimer = null;
  let nationsObserver = null;
  const markerById = new Map();
  const MARKER_SIZE = 24;
  const MARKER_TARGET_SCREEN_SIZE = 24;
  const MARKER_MIN_SCALE = 0.03;
  const MARKER_MAX_SCALE = 1.15;
  const MARKER_SVG_DATA_URI =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
        "<circle cx='50' cy='50' r='36' fill='none' stroke='#111827' stroke-width='12' opacity='0.75'/>" +
        "<circle cx='50' cy='50' r='31' fill='none' stroke='#ffffff' stroke-width='8'/>" +
        "<circle cx='50' cy='50' r='20' fill='none' stroke='#ef4444' stroke-width='10'/>" +
        "<circle cx='50' cy='50' r='7' fill='#ef4444'/>" +
      "</svg>",
    );

  function getNationPositions() {
    try {
      const raw = document.documentElement.getAttribute("data-ofe-nations");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function getNameLayerContainer() {
    if (
      cachedNameLayerContainer &&
      document.contains(cachedNameLayerContainer) &&
      cachedNameLayerContainer.style &&
      cachedNameLayerContainer.style.left === "50%" &&
      cachedNameLayerContainer.style.top === "50%" &&
      cachedNameLayerContainer.style.zIndex === "2"
    ) {
      return cachedNameLayerContainer;
    }

    // Match the container by its structural CSS properties set in NameLayer.init():
    // position: fixed, left: 50%, top: 50%, pointer-events: none, z-index: 2
    const divs = document.querySelectorAll("div[style*='position: fixed']");
    for (const div of divs) {
      if (
        div.style.left === "50%" &&
        div.style.top === "50%" &&
        div.style.zIndex === "2" &&
        div.style.pointerEvents === "none"
      ) {
        cachedNameLayerContainer = div;
        return div;
      }
    }
    cachedNameLayerContainer = null;
    return null;
  }

  function extractScaleFromTransform(tf) {
    if (!tf || tf === "none") return 1;

    if (tf.startsWith("matrix3d(")) {
      const values = tf.slice(9, -1).split(",").map((v) => Number(v.trim()));
      if (values.length === 16 && values.every((v) => Number.isFinite(v))) {
        const sx = Math.sqrt(values[0] * values[0] + values[1] * values[1]);
        return sx > 0 ? sx : 1;
      }
    }

    if (tf.startsWith("matrix(")) {
      const values = tf.slice(7, -1).split(",").map((v) => Number(v.trim()));
      if (values.length === 6 && values.every((v) => Number.isFinite(v))) {
        const sx = Math.sqrt(values[0] * values[0] + values[1] * values[1]);
        return sx > 0 ? sx : 1;
      }
    }

    const sMatch = tf.match(/scale\(\s*([-\d.]+)\s*\)/);
    if (sMatch) {
      const s = Number(sMatch[1]);
      return Number.isFinite(s) && s > 0 ? s : 1;
    }

    return 1;
  }

  function isSpawnPhase() {
    let timer = cachedSpawnTimer;
    if (!timer || !document.contains(timer)) {
      timer = document.querySelector("spawn-timer");
      cachedSpawnTimer = timer || null;
    }
    if (!timer) return false;
    // SpawnTimer uses light DOM (createRenderRoot returns this).
    // During spawn phase it renders a div with class "w-full".
    if (timer.querySelector(".w-full") !== null) {
      const style = getComputedStyle(timer);
      return style.display !== "none" && style.visibility !== "hidden";
    }
    return false;
  }

  function ensureDotContainer() {
    const nameLayerContainer = getNameLayerContainer();
    if (!nameLayerContainer) return false;

    if (dotContainer && nameLayerContainer.contains(dotContainer)) return true;
    if (dotContainer) dotContainer.remove();

    dotContainer = document.createElement("div");
    dotContainer.id = "ofe-dot-container";
    dotContainer.style.cssText =
      "position:absolute;left:0;top:0;pointer-events:none;z-index:4;" +
      "--ofe-marker-scale:1;";
    nameLayerContainer.appendChild(dotContainer);
    return true;
  }

  function updateMarkerScale() {
    if (!spawnActive || !dotContainer) return;
    const nameLayerContainer = getNameLayerContainer();
    if (!nameLayerContainer) return;
    const tf = nameLayerContainer.style.transform || getComputedStyle(nameLayerContainer).transform;
    const zoomScale = Math.max(0.0001, extractScaleFromTransform(tf));
    const highZoomTarget =
      zoomScale > 8 ? MARKER_TARGET_SCREEN_SIZE * 0.72 : MARKER_TARGET_SCREEN_SIZE;
    const desiredScale = highZoomTarget / (MARKER_SIZE * zoomScale);
    const clampedScale = Math.max(MARKER_MIN_SCALE, Math.min(MARKER_MAX_SCALE, desiredScale));
    const next = clampedScale.toFixed(4);
    if (dotContainer.style.getPropertyValue("--ofe-marker-scale") !== next) {
      dotContainer.style.setProperty("--ofe-marker-scale", next);
    }
  }

  function clearMarkers() {
    markerById.clear();
    if (dotContainer) {
      dotContainer.remove();
      dotContainer = null;
    }
  }

  function getOrCreateMarker(markerId) {
    let marker = markerById.get(markerId);
    if (marker && dotContainer && dotContainer.contains(marker)) return marker;

    marker = document.createElement("div");
    marker.id = markerId;
    marker.style.cssText =
      "position:absolute;left:0;top:0;pointer-events:none;will-change:transform;" +
      `width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;` +
      "background-repeat:no-repeat;background-size:contain;background-position:center;" +
      "filter:drop-shadow(0 0 6px rgba(239,68,68,0.55));" +
      `background-image:url(\"${MARKER_SVG_DATA_URI}\");`;

    markerById.set(markerId, marker);
    dotContainer.appendChild(marker);
    return marker;
  }

  function updateSpawnDots() {
    if (!spawnActive) return;
    if (!ensureDotContainer()) return;

    const nations = getNationPositions();
    const usedDots = new Set();

    for (const pid in nations) {
      const pos = nations[pid];
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
        continue;
      }

      const markerId = `ofe-dot-${pid}`;
      const marker = getOrCreateMarker(markerId);
      marker.style.transform =
        `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%) scale(var(--ofe-marker-scale))`;

      usedDots.add(markerId);
    }

    for (const [id, marker] of markerById.entries()) {
      if (!usedDots.has(id)) {
        marker.remove();
        markerById.delete(id);
      }
    }
  }

  function initNationsObserver() {
    if (nationsObserver) return;
    nationsObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== "attributes" || mutation.attributeName !== "data-ofe-nations") {
          continue;
        }
        if (spawnActive) updateSpawnDots();
        break;
      }
    });
    nationsObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-ofe-nations"],
    });
  }

  function syncSpawnState() {
    const spawning = isSpawnPhase();
    if (spawning === spawnActive) return;

    spawnActive = spawning;
    if (spawnActive) {
      updateSpawnDots();
      updateMarkerScale();
      return;
    }

    clearMarkers();
  }

  function init() {
    if (watchInterval) return;
    initNationsObserver();
    watchInterval = setInterval(() => {
      if (document.hidden) return;
      syncSpawnState();
      if (spawnActive) {
        if (!dotContainer || !document.contains(dotContainer)) {
          updateSpawnDots();
        }
        updateMarkerScale();
      }
    }, 220);
    syncSpawnState();
  }

  function waitForCanvas() {
    if (document.querySelector("canvas")) {
      init();
      return;
    }
    const target = document.body || document.documentElement;
    const observer = new MutationObserver(() => {
      if (document.querySelector("canvas")) {
        observer.disconnect();
        init();
      }
    });
    observer.observe(target, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitForCanvas);
  } else {
    waitForCanvas();
  }

  const OFE_SETTINGS_KEY = "ofe.settings";
  const OFE_AUTOJOIN_RULES_KEY = "ofe.autojoin.rules.v1";

  function defaultPopupSettings() {
    return {
      spawnEntry: true,
      gameStart: true,
      boatLanding: true,
      boatDestroyed: true,
      warshipDestroyed: true,
      neighborSleeping: true,
      neighborTraitor: true,
      nukeInbound: true,
      hydrogenInbound: true,
      mirvInbound: true,
      markBotNationsRed: false,
      markHoveredAlliesGreen: false,
      showGoldPerMinute: false,
      showTeamGoldPerMinute: false,
      showTopGoldPerMinute: false,
      showTradeBalances: false,
      selectiveTradePolicyEnabled: false,
      autoCancelDeniedTradesAvailable: false,
      cheatsAvailable: false,
      fpsSaver: false,
      showAttackAmounts: false,
      showNukePrediction: false,
      showNukeSuggestions: false,
      showBoatPrediction: false,
      autoNuke: false,
      autoNukeIncludeAllies: false,
      showEconomyHeatmap: false,
      economyHeatmapIntensity: 1,
      showExportPartnerHeatmap: false,
      showNukeTargetHeatmap: false,
      showSignalDock: true,
      showEconomyAdvisorPanel: true,
      uiHidden: false,
    };
  }

  function defaultAutoJoinRules() {
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

  function readLocalJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return fallback;
      }
      return parsed;
    } catch {
      return fallback;
    }
  }

  function writeLocalJsonIfChanged(key, value) {
    try {
      const next = JSON.stringify(value);
      const prev = localStorage.getItem(key);
      if (prev === next) return true;
      localStorage.setItem(key, next);
      return true;
    } catch {
      return false;
    }
  }

  function buildPopupState() {
    const settings = {
      ...defaultPopupSettings(),
      ...readLocalJson(OFE_SETTINGS_KEY, {}),
    };
    const rulesRaw = readLocalJson(OFE_AUTOJOIN_RULES_KEY, {});
    const rules = {
      ...defaultAutoJoinRules(),
      ...rulesRaw,
      types: {
        ...defaultAutoJoinRules().types,
        ...(rulesRaw.types || {}),
      },
    };
    const host = String(location.hostname || "").toLowerCase();
    return {
      host,
      companionEligible:
        host === "openfront.io" ||
        host === "www.openfront.io" ||
        host === "openfront.dev" ||
        host === "www.openfront.dev" ||
        host.endsWith(".openfront.dev"),
      settings,
      rules,
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return;

    if (message.type === "OFE_POPUP_GET_STATE") {
      sendResponse({ ok: true, state: buildPopupState() });
      return;
    }

    if (message.type === "OFE_POPUP_SET_STATE") {
      const payload = message.payload || {};
      const current = buildPopupState();
      const settings = {
        ...current.settings,
        ...(payload.settings && typeof payload.settings === "object"
          ? payload.settings
          : {}),
      };
      const rulesRaw =
        payload.rules && typeof payload.rules === "object" ? payload.rules : {};
      const rules = {
        ...current.rules,
        ...rulesRaw,
        types: {
          ...current.rules.types,
          ...(rulesRaw.types && typeof rulesRaw.types === "object"
            ? rulesRaw.types
            : {}),
        },
      };

      const settingsOk = writeLocalJsonIfChanged(OFE_SETTINGS_KEY, settings);
      const rulesOk = writeLocalJsonIfChanged(OFE_AUTOJOIN_RULES_KEY, rules);
      if (settingsOk || rulesOk) {
        window.dispatchEvent(new CustomEvent("ofe-settings-updated"));
      }
      sendResponse({ ok: settingsOk && rulesOk, state: buildPopupState() });
      return;
    }

    if (message.type === "OFE_POPUP_PATCH_STATE") {
      const payload = message.payload || {};
      const current = buildPopupState();
      const keyPath = String(payload.key || "");
      const value = payload.value;
      let settings = current.settings;
      let rules = current.rules;
      let handled = false;
      if (keyPath.startsWith("settings.")) {
        const key = keyPath.slice("settings.".length);
        if (key) {
          settings = { ...current.settings, [key]: value };
          handled = true;
        }
      } else if (keyPath === "rules.enabled" || keyPath === "rules.sound") {
        const key = keyPath.split(".")[1];
        rules = { ...current.rules, [key]: Boolean(value) };
        handled = true;
      } else if (keyPath.startsWith("rules.types.")) {
        const typeKey = keyPath.slice("rules.types.".length);
        if (typeKey) {
          rules = {
            ...current.rules,
            types: {
              ...current.rules.types,
              [typeKey]: Boolean(value),
            },
          };
          handled = true;
        }
      }
      if (!handled) {
        sendResponse({ ok: false, state: current });
        return;
      }
      const settingsOk = writeLocalJsonIfChanged(OFE_SETTINGS_KEY, settings);
      const rulesOk = writeLocalJsonIfChanged(OFE_AUTOJOIN_RULES_KEY, rules);
      if (settingsOk || rulesOk) {
        window.dispatchEvent(new CustomEvent("ofe-settings-updated"));
      }
      sendResponse({ ok: settingsOk && rulesOk, state: buildPopupState() });
    }
  });
})();
