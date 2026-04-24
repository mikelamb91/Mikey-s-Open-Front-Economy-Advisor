"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, fn } = ns;
  const ROOT_ID = "ofe-economy-advisor-panel";
  const COLLAPSE_KEY = "ofe.econ.advisor.collapsed";
  const OVERLAY_ID = "ofe-economy-advisor-overlay";
  let panelEl = null;
  let overlayEl = null;
  let timer = null;
  let sendTickTimer = null;
  let collapsed = false;
  let planCache = { at: 0, key: "", targets: [] };
  let spawnCache = { raw: "", at: 0, candidates: [] };
  let terrainIntelCache = { at: 0, key: "", data: null };
  let calcCache = { at: 0, data: null };
  let lastPanelHtml = "";
  let lastOverlaySignature = "";
  const overlayLayers = {
    spawn: true,
    build: true,
    target: true,
    route: true,
  };
  let overlayEnabled = true;
  const OVERLAY_HELPER_KEYS = {
    boats: "showBoatPrediction",
    troops: "showAttackAmounts",
    alliances: "markHoveredAlliesGreen",
  };
  const ATOM_BOMB_COST = 750000;
  const HYDROGEN_BOMB_COST = 5000000;
  const MIRV_COST = 25000000;
  const MISSILE_SILO_COST = 1000000;
  const APPROACHING_THRESHOLD = 0.8;
  const MISSILE_SILO_BUILD_FALLBACK_SEC = 90;
  const MAX_GOLD_HISTORY_SAMPLES = 24;
  const enemyGoldHistory = new Map();
  const CALC_CACHE_MS = 700;
  const PERF_SAMPLE_MS = 10000;
  let lastPerfFlushAt = 0;

  function bumpPerfMetric(name, ms) {
    if (!state.perf) state.perf = {};
    if (!state.perf.economyAdvisor) {
      state.perf.economyAdvisor = {
        counts: {},
        totalsMs: {},
        lastFlushAt: 0,
      };
    }
    const perf = state.perf.economyAdvisor;
    perf.counts[name] = Number(perf.counts[name] || 0) + 1;
    perf.totalsMs[name] = Number(perf.totalsMs[name] || 0) + Number(ms || 0);
    const now = Date.now();
    if (now - lastPerfFlushAt >= PERF_SAMPLE_MS) {
      lastPerfFlushAt = now;
      perf.lastFlushAt = now;
    }
  }

  function getThreatTier() {
    return String((state.strategicSnapshot && state.strategicSnapshot.threatTier) || "D1");
  }

  function calcCacheMsByTier() {
    const tier = getThreatTier();
    if (tier === "D3") return 700;
    if (tier === "D2") return 1600;
    if (tier === "D0") return 2500;
    return 2200;
  }

  function isEnabled() {
    const settings = fn.getEffectiveExtensionSettings
      ? fn.getEffectiveExtensionSettings()
      : {};
    return settings.showEconomyAdvisorPanel !== false;
  }

  function inGame() {
    return Boolean(document.body && document.body.classList.contains("in-game"));
  }

  function loadCollapsed() {
    try {
      collapsed = localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch (_) {
      collapsed = false;
    }
  }

  function saveCollapsed() {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch (_) {}
  }

  function ensurePanel() {
    if (panelEl && document.body.contains(panelEl)) return panelEl;
    if (!document.body) return null;

    panelEl = document.createElement("div");
    panelEl.id = ROOT_ID;
    panelEl.style.cssText = [
      "position:fixed",
      "top:12px",
      "left:12px",
      "width:min(384px,calc(100vw - 24px))",
      "max-height:72vh",
      "overflow:auto",
      "z-index:2147483250",
      "background:rgba(2,6,23,.92)",
      "border:1px solid rgba(56,189,248,.28)",
      "box-shadow:0 14px 36px rgba(2,6,23,.6)",
      "border-radius:10px",
      "padding:8px",
      "font:11px/1.35 system-ui,sans-serif",
      "color:#e2e8f0",
      "pointer-events:auto",
    ].join(";");
    document.body.appendChild(panelEl);
    return panelEl;
  }

  function ensureOverlay() {
    if (overlayEl && document.contains(overlayEl)) return overlayEl;
    const nameLayer = getNameLayerContainer();
    if (!nameLayer) return null;
    overlayEl = document.createElement("div");
    overlayEl.id = OVERLAY_ID;
    overlayEl.style.cssText =
      "position:absolute;left:0;top:0;pointer-events:none;z-index:5;";
    nameLayer.appendChild(overlayEl);
    return overlayEl;
  }

  function clearOverlay() {
    if (overlayEl) overlayEl.innerHTML = "";
  }

  function getNameLayerContainer() {
    const divs = document.querySelectorAll("div[style*='position: fixed']");
    for (const div of divs) {
      if (
        div.style.left === "50%" &&
        div.style.top === "50%" &&
        div.style.zIndex === "2" &&
        div.style.pointerEvents === "none"
      ) {
        return div;
      }
    }
    return null;
  }

  function drawOverlayPoint(point, color, label) {
    if (!overlayEnabled || !point) return;
    const layer = ensureOverlay();
    if (!layer) return;
    const dot = document.createElement("div");
    dot.style.cssText = [
      "position:absolute",
      "left:0",
      "top:0",
      `transform:translate(${point.x}px,${point.y}px) translate(-50%,-50%)`,
      "width:10px",
      "height:10px",
      "border-radius:50%",
      `background:${color}`,
      "box-shadow:0 0 0 10px rgba(0,0,0,.12), 0 0 18px rgba(255,255,255,.12)",
    ].join(";");
    layer.appendChild(dot);
    if (label) {
      const tag = document.createElement("div");
      tag.textContent = label;
      tag.style.cssText = [
        "position:absolute",
        "left:0",
        "top:0",
        `transform:translate(${point.x + 10}px,${point.y - 10}px)`,
        "font:10px/1.2 system-ui,sans-serif",
        "color:#e2e8f0",
        "background:rgba(2,6,23,.72)",
        "border:1px solid rgba(148,163,184,.3)",
        "padding:1px 4px",
        "border-radius:4px",
        "white-space:nowrap",
      ].join(";");
      layer.appendChild(tag);
    }
  }

  function drawOverlayLine(from, to, color, label) {
    if (!overlayEnabled || !from || !to) return;
    const layer = ensureOverlay();
    if (!layer) return;
    const dx = Number(to.x) - Number(from.x);
    const dy = Number(to.y) - Number(from.y);
    const length = Math.sqrt(dx * dx + dy * dy);
    if (!Number.isFinite(length) || length < 4) return;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const line = document.createElement("div");
    line.style.cssText = [
      "position:absolute",
      "left:0",
      "top:0",
      `transform:translate(${from.x}px,${from.y}px) rotate(${angle}deg)`,
      `width:${length}px`,
      "height:2px",
      `background:${color}`,
      "transform-origin:0 50%",
      "opacity:.9",
      "box-shadow:0 0 8px rgba(56,189,248,.4)",
    ].join(";");
    layer.appendChild(line);
    if (label) {
      const mx = Number(from.x) + dx * 0.5;
      const my = Number(from.y) + dy * 0.5;
      const tag = document.createElement("div");
      tag.textContent = label;
      tag.style.cssText = [
        "position:absolute",
        "left:0",
        "top:0",
        `transform:translate(${mx + 6}px,${my - 8}px)`,
        "font:10px/1.2 system-ui,sans-serif",
        "color:#bae6fd",
        "background:rgba(2,6,23,.74)",
        "border:1px solid rgba(56,189,248,.35)",
        "padding:1px 4px",
        "border-radius:4px",
      ].join(";");
      layer.appendChild(tag);
    }
  }

  function readLive() {
    const out = {
      troops: 0,
      gold: 0,
      spawn: false,
      troopCap: 0,
      troopSource: "player",
      tiles: 0,
      ticks: 0,
    };
    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (!game || typeof game.myPlayer !== "function") return out;

    try {
      if (typeof game.inSpawnPhase === "function") out.spawn = Boolean(game.inSpawnPhase());
      if (typeof game.ticks === "function") {
        const ticks = Number(game.ticks());
        out.ticks = Number.isFinite(ticks) ? ticks : 0;
      }
    } catch (_) {}

    let me = null;
    try {
      me = game.myPlayer();
    } catch (_) {
      me = null;
    }
    if (!me) return out;

    // First preference: values shown by game UI panel.
    const controlPanel = document.querySelector("control-panel");
    const panelTroops = Number(controlPanel && controlPanel._troops);
    const panelCap = Number(controlPanel && controlPanel._maxTroops);
    const panelGold = Number(controlPanel && controlPanel._gold);

    if (Number.isFinite(panelTroops) && panelTroops >= 0) {
      out.troops = panelTroops;
      out.troopSource = "control-panel";
    } else {
      try {
        if (typeof me.troops === "function") {
          const troops = Number(me.troops());
          if (Number.isFinite(troops) && troops >= 0) out.troops = troops;
        }
      } catch (_) {}
    }

    if (Number.isFinite(panelCap) && panelCap > 0) {
      out.troopCap = panelCap;
    } else {
      try {
        const cfg = typeof game.config === "function" ? game.config() : null;
        if (cfg && typeof cfg.maxTroops === "function") {
          const cap = Number(cfg.maxTroops(me));
          if (Number.isFinite(cap) && cap > 0) out.troopCap = cap;
        }
      } catch (_) {}
    }

    if (Number.isFinite(panelGold) && panelGold >= 0) {
      out.gold = panelGold;
    } else {
      try {
        if (typeof me.gold === "function") {
          const gold = Number(me.gold());
          if (Number.isFinite(gold) && gold >= 0) out.gold = gold;
        }
      } catch (_) {}
    }

    try {
      if (typeof me.numTilesOwned === "function") {
        const tiles = Number(me.numTilesOwned());
        out.tiles = Number.isFinite(tiles) && tiles >= 0 ? tiles : 0;
      }
    } catch (_) {
      out.tiles = 0;
    }

    // Hard sanity clamp: troop read cannot exceed cap in advisor math.
    if (out.troopCap > 0) {
      out.troops = Math.min(out.troops, out.troopCap);
    }
    return out;
  }

  function readAttackRatio() {
    const controlPanel = document.querySelector("control-panel");
    if (controlPanel && Number.isFinite(Number(controlPanel.attackRatio))) {
      const ratio = Number(controlPanel.attackRatio);
      return Math.min(1, Math.max(0.01, ratio));
    }
    try {
      const raw = Number(localStorage.getItem("settings.attackRatio") || "0.2");
      if (Number.isFinite(raw)) return Math.min(1, Math.max(0.01, raw));
    } catch (_) {}
    return 0.2;
  }

  function refToXY(ref, width) {
    return { x: ref % width, y: Math.floor(ref / width) };
  }

  function distSq(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  function formatCompact(value, suffix = "") {
    const n = Math.max(0, Number(value) || 0);
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M${suffix}`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K${suffix}`;
    return `${Math.round(n).toLocaleString()}${suffix}`;
  }

  // Game troop values are raw tenths; match UI wording by rendering in display units.
  function formatTroopsUi(rawTroops) {
    return formatCompact((Math.max(0, Number(rawTroops) || 0)) / 10);
  }

  function toGridLabel(game, x, y) {
    const gx = Math.max(0, Math.round(Number(x) || 0));
    const gy = Math.max(0, Math.round(Number(y) || 0));
    try {
      if (
        game &&
        typeof game.ref === "function" &&
        typeof game.isValidCoord === "function" &&
        game.isValidCoord(gx, gy)
      ) {
        return `Grid #${String(game.ref(gx, gy))}`;
      }
    } catch (_) {}
    return `Grid #${gy}:${gx}`;
  }

  function getOverlayHelperState() {
    const settings = fn.getEffectiveExtensionSettings
      ? fn.getEffectiveExtensionSettings()
      : {};
    return {
      boats: Boolean(settings[OVERLAY_HELPER_KEYS.boats]),
      troops: Boolean(settings[OVERLAY_HELPER_KEYS.troops]),
      alliances: Boolean(settings[OVERLAY_HELPER_KEYS.alliances]),
    };
  }

  function setOverlayHelperState(nextState) {
    if (!fn.saveExtensionSetting) return;
    const keys = Object.keys(OVERLAY_HELPER_KEYS);
    for (const action of keys) {
      const settingKey = OVERLAY_HELPER_KEYS[action];
      fn.saveExtensionSetting(settingKey, Boolean(nextState[action]));
    }
  }

  function computeBuildTargets() {
    const now = Date.now();
    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (
      !game ||
      typeof game.width !== "function" ||
      typeof game.height !== "function" ||
      typeof game.ownerID !== "function" ||
      typeof game.myPlayer !== "function"
    ) {
      return planCache.targets || [];
    }

    const me = game.myPlayer();
    if (!me || typeof me.smallID !== "function") return planCache.targets || [];
    const myId = Number(me.smallID());
    if (!Number.isFinite(myId) || myId <= 0) return planCache.targets || [];

    const width = Number(game.width());
    const height = Number(game.height());
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return planCache.targets || [];
    }

    const tilesVersion = Number(state.myTilesVersion || 0);
    const cacheKey = `${myId}:${width}:${height}:${Math.floor(tilesVersion / 40)}:${Math.floor(now / 20000)}`;
    if (planCache.key === cacheKey && now - planCache.at < 19800) {
      return planCache.targets;
    }

    const hasRef = typeof game.ref === "function";
    const ownedRefs = [];
    let sumX = 0;
    let sumY = 0;
    const tileSetIterable =
      state.myTilesSet && typeof state.myTilesSet[Symbol.iterator] === "function"
        ? state.myTilesSet
        : null;
    if (tileSetIterable) {
      for (const ref of tileSetIterable) {
        const refNum = Number(ref);
        if (!Number.isFinite(refNum) || refNum < 0) continue;
        const x = refNum % width;
        const y = Math.floor(refNum / width);
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        ownedRefs.push(refNum);
        sumX += x;
        sumY += y;
      }
    }
    if (ownedRefs.length === 0) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const ref = hasRef ? game.ref(x, y) : y * width + x;
          if (Number(game.ownerID(ref)) === myId) {
            ownedRefs.push(ref);
            sumX += x;
            sumY += y;
          }
        }
      }
    }
    if (ownedRefs.length === 0) return planCache.targets || [];

    const center = { x: sumX / ownedRefs.length, y: sumY / ownedRefs.length };
    const border = [];
    const interior = [];
    const allOwnedPoints = [];

    for (const ref of ownedRefs) {
      const { x, y } = refToXY(ref, width);
      const candidates = [
        x > 0 ? (hasRef ? game.ref(x - 1, y) : y * width + (x - 1)) : null,
        x < width - 1 ? (hasRef ? game.ref(x + 1, y) : y * width + (x + 1)) : null,
        y > 0 ? (hasRef ? game.ref(x, y - 1) : (y - 1) * width + x) : null,
        y < height - 1 ? (hasRef ? game.ref(x, y + 1) : (y + 1) * width + x) : null,
      ];

      let enemySides = 0;
      let allySides = 0;
      for (const n of candidates) {
        if (n == null) continue;
        const owner = Number(game.ownerID(n));
        if (owner === myId) allySides += 1;
        else enemySides += 1;
      }

      const point = { x, y, ref, enemySides, allySides };
      allOwnedPoints.push(point);
      if (enemySides > 0) border.push(point);
      else interior.push(point);
    }

    border.sort((a, b) => b.enemySides - a.enemySides);
    interior.sort((a, b) => b.allySides - a.allySides);

    const frontline = border[0] || { x: Math.round(center.x), y: Math.round(center.y) };
    let expansion = border.find((p) => distSq(p, frontline) > Math.max(36, width * 0.12));
    if (!expansion) expansion = border[Math.min(1, border.length - 1)] || frontline;
    let core = interior[0] || null;
    if (!core) {
      // If there is no strict interior tile yet, pick the least-exposed owned tile
      // that is farthest from the frontline to keep factory recommendation safer.
      const sortedFallback = [...allOwnedPoints].sort((a, b) => {
        if (a.enemySides !== b.enemySides) return a.enemySides - b.enemySides;
        return distSq(b, frontline) - distSq(a, frontline);
      });
      core = sortedFallback.find((p) => p.x !== frontline.x || p.y !== frontline.y) || sortedFallback[0] || null;
    }
    if (!core) core = { x: Math.round(center.x), y: Math.round(center.y) };
    if (core.x === frontline.x && core.y === frontline.y) {
      const altCore =
        interior.find((p) => p.x !== frontline.x || p.y !== frontline.y) ||
        allOwnedPoints.find((p) => p.x !== frontline.x || p.y !== frontline.y);
      if (altCore) core = altCore;
    }
    const terrainIntel = getTerrainEconomyIntel(game, me, []);
    const logisticsLabel = terrainIntel && terrainIntel.portViable ? "Port" : "City";
    const logisticsWhy = terrainIntel && terrainIntel.portViable
      ? "Pressure lane / enemy contact"
      : "Landlocked logistics hub near frontline";
    const expansionWhy = terrainIntel && terrainIntel.portViable
      ? "Second lane / flank pressure"
      : "Landlocked expansion hub for trade support";

    const econStructures = getOwnedEconomyStructures(game, me);
    const targets = [
      {
        key: terrainIntel && terrainIntel.portViable ? "frontlinePort" : "frontlineCity",
        label: `Frontline ${logisticsLabel}`,
        why: logisticsWhy,
        x: frontline.x,
        y: frontline.y,
      },
      {
        key: terrainIntel && terrainIntel.portViable ? "expansionPort" : "expansionCity",
        label: `Expansion ${logisticsLabel}`,
        why: expansionWhy,
        x: expansion.x,
        y: expansion.y,
      },
      {
        key: "factoryCore",
        label: "Factory Core",
        why: "Safer interior economy anchor",
        x: core.x,
        y: core.y,
      },
    ].map((t) => ({
      ...t,
      econScore: scoreEconomyCluster(t, center, econStructures),
    }));

    planCache = { at: now, key: cacheKey, targets };
    return targets;
  }

  function computeSpawnCandidates() {
    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (game && typeof game.inSpawnPhase === "function") {
      try {
        if (!game.inSpawnPhase()) return [];
      } catch (_) {}
    }
    let raw = "";
    try {
      raw = String(document.documentElement.getAttribute("data-ofe-nations") || "");
    } catch (_) {
      raw = "";
    }
    const now = Date.now();
    if (spawnCache.raw === raw && now - spawnCache.at < 1800) {
      return spawnCache.candidates;
    }
    let nations = {};
    try {
      nations = raw ? JSON.parse(raw) : {};
    } catch (_) {
      nations = {};
    }
    const points = Object.values(nations || {})
      .filter((v) => v && Number.isFinite(v.x) && Number.isFinite(v.y))
      .map((v) => ({ x: Number(v.x), y: Number(v.y) }));
    if (points.length < 3) {
      spawnCache = { raw, at: now, candidates: [] };
      return [];
    }

    const scored = points.map((p) => {
      let minDist = Infinity;
      for (const q of points) {
        if (q === p) continue;
        const d = Math.sqrt(distSq(p, q));
        if (d < minDist) minDist = d;
      }
      return {
        x: p.x,
        y: p.y,
        strength: Math.max(0, Math.min(1, minDist / 180)),
        reason:
          minDist > 120
            ? "High spacing from nearby nations."
            : "Moderate spacing; scout surrounding lanes.",
      };
    });
    scored.sort((a, b) => b.strength - a.strength);
    const candidates = scored.slice(0, 4);
    spawnCache = { raw, at: now, candidates };
    return candidates;
  }

  function computeSamPlan() {
    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (!game || typeof game.players !== "function" || typeof game.myPlayer !== "function") {
      return { required: 0, current: 0, threats: ["No enemy missile economy threats detected."] };
    }

    let me = null;
    try {
      me = game.myPlayer();
    } catch (_) {
      me = null;
    }
    if (!me || typeof me.smallID !== "function") {
      return { required: 0, current: 0, threats: ["No enemy missile economy threats detected."] };
    }

    const myId = Number(me.smallID());
    const now = Date.now();
    const seenEnemyIds = new Set();
    const enemyThreats = [];

    function formatEta(totalSeconds) {
      if (!Number.isFinite(totalSeconds) || totalSeconds >= 9999) return "n/a";
      const safe = Math.max(0, Math.floor(totalSeconds));
      const mm = Math.floor(safe / 60);
      const ss = safe % 60;
      return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
    }

    function readReadiness(unit) {
      try {
        if (typeof unit.missileReadinesss === "function") {
          const v = Number(unit.missileReadinesss());
          if (Number.isFinite(v)) return Math.max(0, Math.min(1, v));
        }
      } catch (_) {}
      try {
        if (typeof unit.missileReadiness === "function") {
          const v = Number(unit.missileReadiness());
          if (Number.isFinite(v)) return Math.max(0, Math.min(1, v));
        }
      } catch (_) {}
      return 0;
    }

    function readLevel(unit) {
      try {
        if (typeof unit.level === "function") {
          const v = Number(unit.level());
          if (Number.isFinite(v) && v > 0) return Math.floor(v);
        }
      } catch (_) {}
      return 1;
    }

    function computeGoldPerSec(playerId, goldNow) {
      const pid = Number(playerId);
      if (!Number.isFinite(pid)) return 0;
      const arr = enemyGoldHistory.get(pid) || [];
      arr.push({ at: now, gold: goldNow });
      while (arr.length > MAX_GOLD_HISTORY_SAMPLES) arr.shift();
      enemyGoldHistory.set(pid, arr);
      if (arr.length < 2) return 0;
      const first = arr[0];
      const last = arr[arr.length - 1];
      const dt = Math.max(1, (last.at - first.at) / 1000);
      return Math.max(0, (last.gold - first.gold) / dt);
    }

    const players = game.players() || [];
    for (const p of players) {
      if (!p || typeof p.smallID !== "function") continue;
      const pid = Number(p.smallID());
      if (!Number.isFinite(pid) || pid === myId) continue;
      try {
        if (typeof p.isAlive === "function" && !p.isAlive()) continue;
      } catch (_) {}
      if (typeof me.isFriendly === "function") {
        try {
          if (me.isFriendly(p)) continue;
        } catch (_) {}
      }

      seenEnemyIds.add(pid);
      const gold = Math.max(0, Number(typeof p.gold === "function" ? p.gold() : 0) || 0);
      const goldPerSec = computeGoldPerSec(pid, gold);
      const goldPerMin = goldPerSec * 60;

      let units = [];
      try {
        const u = typeof p.units === "function" ? p.units() : [];
        if (Array.isArray(u)) units = u;
      } catch (_) {
        units = [];
      }

      const silos = units.filter((unit) => {
        const t = getUnitTypeName(unit).toLowerCase();
        if (!t.includes("silo")) return false;
        try {
          if (typeof unit.isUnderConstruction === "function" && unit.isUnderConstruction()) {
            return false;
          }
        } catch (_) {}
        try {
          if (typeof unit.isActive === "function" && !unit.isActive()) {
            return false;
          }
        } catch (_) {}
        return true;
      });
      const hasSilo = silos.length > 0;
      const bestReadiness = silos.reduce((mx, s) => Math.max(mx, readReadiness(s)), 0);
      const totalSiloCapacity = silos.reduce((sum, s) => sum + readLevel(s), 0);
      const readySlotsNow = silos.reduce(
        (sum, s) => sum + Math.max(0, Math.floor(readLevel(s) * readReadiness(s))),
        0,
      );
      const affordableAtomNow = Math.floor(gold / ATOM_BOMB_COST);
      const missilesReadyNow = Math.min(affordableAtomNow, readySlotsNow);
      const affordableAtomIn60 = Math.floor(
        (gold + Math.max(0, goldPerSec) * 60) / ATOM_BOMB_COST,
      );
      const missilesReadyIn60s = Math.min(affordableAtomIn60, totalSiloCapacity);

      let siloBuildSec = MISSILE_SILO_BUILD_FALLBACK_SEC;
      try {
        if (typeof game.unitInfo === "function") {
          const info =
            game.unitInfo("Missile Silo") ||
            game.unitInfo("MissileSilo") ||
            game.unitInfo("Missile_Silo");
          const duration = Number(info && info.constructionDuration);
          if (Number.isFinite(duration) && duration > 0) {
            siloBuildSec = Math.ceil(duration / 10);
          }
        }
      } catch (_) {}

      const cooldownTicks = (() => {
        try {
          const cfg = typeof game.config === "function" ? game.config() : null;
          if (cfg && typeof cfg.SiloCooldown === "function") {
            const v = Number(cfg.SiloCooldown());
            if (Number.isFinite(v) && v > 0) return v;
          }
        } catch (_) {}
        return 0;
      })();
      const readinessDelaySec = hasSilo
        ? Math.ceil(Math.max(0, 1 - bestReadiness) * (cooldownTicks > 0 ? cooldownTicks / 10 : 0))
        : 0;

      const timeToGold = (target) =>
        gold >= target ? 0 : Math.ceil((target - gold) / Math.max(1, Math.max(0, goldPerSec)));
      const atomEtaSec = hasSilo
        ? missilesReadyNow > 0
          ? 0
          : Math.max(timeToGold(ATOM_BOMB_COST), readinessDelaySec)
        : timeToGold(MISSILE_SILO_COST + ATOM_BOMB_COST) + siloBuildSec;
      const hydrogenEtaSec =
        (hasSilo ? 0 : timeToGold(MISSILE_SILO_COST) + siloBuildSec) +
        timeToGold(HYDROGEN_BOMB_COST);
      const mirvEtaSec =
        (hasSilo ? 0 : timeToGold(MISSILE_SILO_COST) + siloBuildSec) + timeToGold(MIRV_COST);

      const availableAfterSilo = Math.max(0, gold - (hasSilo ? 0 : MISSILE_SILO_COST));
      const atomAffordableCount = Math.floor(availableAfterSilo / ATOM_BOMB_COST);
      const hydrogenAffordableCount = Math.floor(availableAfterSilo / HYDROGEN_BOMB_COST);
      const mirvAffordableCount = Math.floor(availableAfterSilo / MIRV_COST);

      const name =
        typeof p.displayName === "function"
          ? String(p.displayName() || `#${pid}`)
          : `#${pid}`;
      enemyThreats.push({
        pid,
        name,
        gold,
        goldPerMin,
        hasSilo,
        siloPoints: silos
          .map((silo) => getUnitPoint(game, silo))
          .filter((pnt) => pnt && Number.isFinite(pnt.x) && Number.isFinite(pnt.y)),
        bestReadiness,
        missilesReadyNow,
        missilesReadyIn60s,
        atomEtaSec,
        hydrogenEtaSec,
        mirvEtaSec,
        atomAffordableCount,
        hydrogenAffordableCount,
        mirvAffordableCount,
      });
    }

    for (const pid of Array.from(enemyGoldHistory.keys())) {
      if (!seenEnemyIds.has(pid)) enemyGoldHistory.delete(pid);
    }

    let currentSam = 0;
    try {
      const myUnits = typeof me.units === "function" ? me.units() : [];
      if (Array.isArray(myUnits)) {
        currentSam = myUnits.filter((unit) => {
          const t = getUnitTypeName(unit).toLowerCase();
          if (!t.includes("sam")) return false;
          try {
            if (typeof unit.isUnderConstruction === "function" && unit.isUnderConstruction()) {
              return false;
            }
          } catch (_) {}
          try {
            if (typeof unit.isActive === "function" && !unit.isActive()) {
              return false;
            }
          } catch (_) {}
          return true;
        }).length;
      }
    } catch (_) {
      currentSam = 0;
    }

    const myTiles =
      state.myTilesSet && typeof state.myTilesSet.size === "number"
        ? Number(state.myTilesSet.size)
        : Number(typeof me.numTilesOwned === "function" ? me.numTilesOwned() : 0) || 0;
    const territorySamCap = myTiles < 200 ? 1 : myTiles < 500 ? 2 : myTiles < 900 ? 3 : 4;

    const criticalNow = enemyThreats.filter(
      (t) => t.atomEtaSec === 0 || t.hydrogenEtaSec === 0 || t.mirvEtaSec === 0,
    ).length;
    const atomSoon2m = enemyThreats.filter((t) => t.atomEtaSec > 0 && t.atomEtaSec <= 120).length;
    const highYieldSoon = enemyThreats.filter(
      (t) => t.hydrogenEtaSec <= 300 || t.mirvEtaSec <= 600,
    ).length;
    const missileWindow = enemyThreats.filter(
      (t) =>
        t.hasSilo &&
        t.bestReadiness >= 0.7 &&
        t.gold >= ATOM_BOMB_COST * APPROACHING_THRESHOLD,
    ).length;

    let requiredRaw = criticalNow * 2 + atomSoon2m + (highYieldSoon > 0 ? 1 : 0);
    if (requiredRaw === 0 && missileWindow > 0) requiredRaw = 1;
    let required = Math.min(territorySamCap, Math.max(0, requiredRaw));
    if (myTiles < 120 && required > 1) required = 1;

    const threatScore = (t) => {
      const nearestEta = Math.min(t.atomEtaSec, t.hydrogenEtaSec, t.mirvEtaSec);
      const etaPressure = Math.max(0, 240 - Math.min(240, Number(nearestEta || 0))) / 12;
      const readyNow =
        (t.missilesReadyNow > 0 ? 16 : 0) +
        (t.atomEtaSec === 0 ? 10 : 0) +
        (t.hydrogenEtaSec === 0 ? 8 : 0) +
        (t.mirvEtaSec === 0 ? 12 : 0);
      const highYield =
        Math.min(6, Number(t.hydrogenAffordableCount || 0) * 2) +
        Math.min(8, Number(t.mirvAffordableCount || 0) * 3);
      const readiness = Number(t.hasSilo ? 4 + t.bestReadiness * 8 : 0);
      const economyMomentum = Math.min(8, Math.max(0, Number(t.goldPerMin || 0)) / 25000);
      return readyNow + highYield + readiness + etaPressure + economyMomentum;
    };

    const threats = enemyThreats
      .sort((a, b) => threatScore(b) - threatScore(a))
      .slice(0, 4)
      .map(
        (t) =>
          `${t.name}: ${Math.round(t.gold).toLocaleString()} gold, ${Math.round(t.goldPerMin).toLocaleString()} gpm, silo ${t.hasSilo ? `yes (${Math.round(t.bestReadiness * 100)}% ready)` : "no"}, Atom ETA ${formatEta(t.atomEtaSec)}, Hydrogen ETA ${formatEta(t.hydrogenEtaSec)}, MIRV ETA ${formatEta(t.mirvEtaSec)}.`,
      );

    const samPlacements = [];
    try {
      const myUnits = typeof me.units === "function" ? me.units() : [];
      if (Array.isArray(myUnits)) {
        const enemySiloPoints = enemyThreats.flatMap((t) => t.siloPoints || []);
        const candidates = [];
        for (const unit of myUnits) {
          const t = getUnitTypeName(unit).toLowerCase();
          if (!t) continue;
          if (!t.includes("city") && !t.includes("factory") && !t.includes("silo")) continue;
          let active = true;
          try {
            if (typeof unit.isUnderConstruction === "function" && unit.isUnderConstruction()) {
              active = false;
            }
          } catch (_) {}
          if (!active) continue;
          const pnt = getUnitPoint(game, unit);
          if (!pnt) continue;
          let nearestSiloDist = Number.POSITIVE_INFINITY;
          for (const ep of enemySiloPoints) {
            const d = Math.sqrt(distSq(pnt, ep));
            if (d < nearestSiloDist) nearestSiloDist = d;
          }
          const typeWeight = t.includes("silo") ? 3.2 : t.includes("factory") ? 2.5 : 2.0;
          const proximityWeight = Number.isFinite(nearestSiloDist)
            ? Math.max(0, 180 - Math.min(180, nearestSiloDist)) / 22
            : 0;
          const score = typeWeight + proximityWeight;
          const reason = t.includes("silo")
            ? "Protect your missile silo from counter-strike."
            : t.includes("factory")
              ? "Shield your highest factory throughput cluster."
              : "Protect a major city economy cluster.";
          candidates.push({ x: pnt.x, y: pnt.y, score, reason });
        }
        candidates.sort((a, b) => b.score - a.score);
        for (const c of candidates) {
          if (samPlacements.length >= 3) break;
          const tooClose = samPlacements.some((p) => distSq(p, c) < 20 * 20);
          if (tooClose) continue;
          samPlacements.push({
            x: Math.round(c.x),
            y: Math.round(c.y),
            grid: toGridLabel(game, c.x, c.y),
            reason: c.reason,
          });
        }
      }
    } catch (_) {}

    const sortedThreats = [...enemyThreats].sort((a, b) => threatScore(b) - threatScore(a));
    const topImminent = sortedThreats.find(
      (t) =>
        t.missilesReadyNow > 0 ||
        t.atomEtaSec <= 180 ||
        t.hydrogenEtaSec <= 420 ||
        t.mirvEtaSec <= 600,
    ) || null;
    const topImminentScore = topImminent ? threatScore(topImminent) : 0;
    const inboundNow =
      Number(state.signalStats?.mirvInbound || 0) +
      Number(state.signalStats?.nukeInbound || 0) +
      Number(state.signalStats?.hydrogenInbound || 0);
    let highValueCount = 0;
    try {
      const myUnits = typeof me.units === "function" ? me.units() : [];
      if (Array.isArray(myUnits)) {
        highValueCount = myUnits.filter((unit) => {
          const t = getUnitTypeName(unit).toLowerCase();
          if (!t) return false;
          if (t.includes("city") || t.includes("factory") || t.includes("silo")) return true;
          return false;
        }).length;
      }
    } catch (_) {
      highValueCount = 0;
    }
    const recommendSamNow = Boolean(
      (topImminent &&
        (topImminent.missilesReadyNow > 0 ||
          topImminent.atomEtaSec <= 180 ||
          (topImminent.hydrogenEtaSec <= 420 && highValueCount >= 3) ||
          (topImminent.mirvEtaSec <= 600 && highValueCount >= 2)) &&
        required > currentSam) ||
      inboundNow > 0,
    );
    const recommendSamReason = topImminent
      ? `${topImminent.name} is in an imminent missile window (Atom ${formatEta(topImminent.atomEtaSec)}, Hydrogen ${formatEta(topImminent.hydrogenEtaSec)}, MIRV ${formatEta(topImminent.mirvEtaSec)}).`
      : inboundNow > 0
        ? "Incoming strategic missiles detected; immediate SAM coverage is recommended."
        : "";

    if (threats.length === 0) {
      threats.push("No enemy missile economy threats detected.");
    }

    return {
      required,
      current: currentSam,
      threats,
      samPlacements,
      recommendSamNow,
      recommendSamReason,
      topImminentScore,
    };
  }

  function buildTargetActions(topThreat, sendPlan, buildTargets, bestAction) {
    const out = [];
    if (topThreat) {
      out.push({
        action: "contain_threat",
        target: topThreat.name,
        sendTroops: sendPlan.recommendedSendTroops,
        sendPercent: sendPlan.recommendedSendPercent,
        reason: "Slow enemy growth while preserving your reserve.",
      });
    }
    if (buildTargets[0]) {
      out.push({
        action: "eco_expand",
        target: buildTargets[0].label,
        sendTroops: 0,
        sendPercent: 0,
        reason: "Anchor your next production lane.",
      });
    }
    if (bestAction === "nuke") {
      out.push({
        action: "strategic_strike",
        target: topThreat ? topThreat.name : "highest value enemy",
        sendTroops: 0,
        sendPercent: 0,
        reason: "Enemy economy lead is high and strike timing is favorable.",
      });
    }
    return out;
  }

  function computeThreatAndEnemyFromSnapshot(live, neighbors, snapshot) {
    if (!snapshot) return null;
    const topThreat = {
      name: String(snapshot.topThreatName || "Top enemy"),
      gold: Number(snapshot.topEnemyGold || 0),
      troops: Number(snapshot.topEnemyTroops || 0),
      tiles: Number(snapshot.topEnemyTiles || 0),
      pressure:
        Number(snapshot.topEnemyGold || 0) / 1_000_000 +
        Number(snapshot.topEnemyTroops || 0) / 120_000 +
        Number(snapshot.topEnemyTiles || 0) / 120,
      troopCap: Number(snapshot.topEnemyTroopCap || 0),
    };
    const myScore = Number(live.gold || 0) / 1_000_000 + Number(live.troops || 0) / 120_000;
    const enemyScore = Number(topThreat.pressure || 0);
    const behindRatio = enemyScore > 0 ? Math.max(0, (enemyScore - myScore) / enemyScore) : 0;
    const isLeadingEconomy = myScore >= enemyScore;
    const pct = Math.round(behindRatio * 100);
    const enemyLeadSummary = isLeadingEconomy
      ? `You are ahead of ${topThreat.name} on economy pressure.`
      : `${topThreat.name} leads by ~${pct}% pressure score.`;
    const sleeping = Number(snapshot.sleeping || 0);
    const traitor = Number(snapshot.traitor || 0);
    const inbound = Number(snapshot.inboundNow || 0);
    const threatScore = inbound * 2 + traitor * 2 + Math.max(0, 2 - sleeping);
    const alerts = [];
    if (topThreat.gold >= 25_000_000) {
      alerts.push({
        message: `${topThreat.name} can likely field MIRV-level pressure now.`,
        urgency: "critical",
      });
    } else if (topThreat.gold >= 5_000_000) {
      alerts.push({
        message: `${topThreat.name} is near hydrogen timing window.`,
        urgency: "warn",
      });
    } else if (topThreat.gold >= 750_000) {
      alerts.push({
        message: `${topThreat.name} can afford atom bomb pressure.`,
        urgency: "info",
      });
    }
    return {
      topThreat,
      enemyLeadSummary,
      isLeadingEconomy,
      behindRatio,
      alerts,
      myTroopCap: Number(snapshot.myTroopCap || 0),
      topEnemyTroopCap: Number(snapshot.topEnemyTroopCap || 0),
      sleeping,
      traitor,
      inbound,
      threatScore,
    };
  }

  function computeSamPlanFromSnapshot(snapshot) {
    if (!snapshot) return null;
    const inbound = Number(snapshot.inboundNow || 0);
    const imminent = Number(snapshot.imminentThreatCount || 0);
    const hasSilo = Number(snapshot.hasSiloThreatCount || 0);
    const myTiles =
      state.myTilesSet && typeof state.myTilesSet.size === "number" ? Number(state.myTilesSet.size) : 0;
    const territorySamCap = myTiles < 200 ? 1 : myTiles < 500 ? 2 : myTiles < 900 ? 3 : 4;
    const requiredRaw = inbound > 0 ? 2 : imminent > 0 ? 1 : hasSilo > 0 ? 1 : 0;
    const required = Math.min(territorySamCap, requiredRaw);
    const current = Number(snapshot.currentSam || 0);
    const recommendSamNow = required > current && (inbound > 0 || imminent > 0);
    return {
      required,
      current,
      threats:
        inbound > 0 || imminent > 0
          ? [
              `${String(snapshot.topThreatName || "Top enemy")}: elevated missile threat window detected.`,
            ]
          : ["No enemy missile economy threats detected."],
      samPlacements: [],
      recommendSamNow,
      recommendSamReason: recommendSamNow
        ? "Incoming or imminent missile pressure detected; defensive value exceeds economy-only expansion."
        : "",
      topImminentScore: inbound > 0 ? 24 : imminent > 0 ? 14 : 0,
    };
  }

  function computeThreatAndEnemy(live, neighbors) {
    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    let topThreat = null;
    let enemyLeadSummary = "No enemy data yet.";
    let isLeadingEconomy = true;
    let behindRatio = 0;
    const alerts = [];
    let myTroopCap = 0;
    let topEnemyTroopCap = 0;

    if (game && typeof game.players === "function" && typeof game.myPlayer === "function") {
      let me = null;
      try {
        me = game.myPlayer();
      } catch (_) {
        me = null;
      }
      const myId =
        me && typeof me.smallID === "function" ? Number(me.smallID()) : Number.NaN;
      const players = game.players() || [];
      const cfg = typeof game.config === "function" ? game.config() : null;
      for (const p of players) {
        if (!p || typeof p.smallID !== "function") continue;
        if (Number(p.smallID()) === myId) continue;
        try {
          if (typeof p.isAlive === "function" && !p.isAlive()) continue;
        } catch (_) {}
        if (me && typeof me.isFriendly === "function") {
          try {
            if (me.isFriendly(p)) continue;
          } catch (_) {}
        }

        const gold = typeof p.gold === "function" ? Number(p.gold()) : 0;
        const troops = typeof p.troops === "function" ? Number(p.troops()) : 0;
        const tiles =
          typeof p.numTilesOwned === "function" ? Number(p.numTilesOwned()) : 0;
        const pressure = gold / 1_000_000 + troops / 120_000 + tiles / 120;

        let troopCap = 0;
        try {
          if (cfg && typeof cfg.maxTroops === "function") {
            const cap = Number(cfg.maxTroops(p));
            if (Number.isFinite(cap) && cap > 0) troopCap = cap;
          }
        } catch (_) {}
        if (troopCap > topEnemyTroopCap) topEnemyTroopCap = troopCap;

        if (!topThreat || pressure > topThreat.pressure) {
          const name =
            typeof p.displayName === "function"
              ? String(p.displayName() || `#${p.smallID()}`)
              : `#${p.smallID()}`;
          topThreat = { name, gold, troops, tiles, pressure, troopCap };
        }
      }

      try {
        if (cfg && typeof cfg.maxTroops === "function" && me) {
          const cap = Number(cfg.maxTroops(me));
          if (Number.isFinite(cap) && cap > 0) myTroopCap = cap;
        }
      } catch (_) {}

      const myScore = live.gold / 1_000_000 + live.troops / 120_000;
      const enemyScore = topThreat ? topThreat.pressure : 0;
      behindRatio = enemyScore > 0 ? Math.max(0, (enemyScore - myScore) / enemyScore) : 0;
      isLeadingEconomy = myScore >= enemyScore;
      if (!topThreat) {
        enemyLeadSummary = "No active enemy pressure detected.";
      } else {
        const pct = Math.round(behindRatio * 100);
        enemyLeadSummary = isLeadingEconomy
          ? `You are ahead of ${topThreat.name} on economy pressure.`
          : `${topThreat.name} leads by ~${pct}% pressure score.`;
      }
      if (topThreat && topThreat.gold >= 25_000_000) {
        alerts.push({
          message: `${topThreat.name} can likely field MIRV-level pressure now.`,
          urgency: "critical",
        });
      } else if (topThreat && topThreat.gold >= 5_000_000) {
        alerts.push({
          message: `${topThreat.name} is near hydrogen timing window.`,
          urgency: "warn",
        });
      } else if (topThreat && topThreat.gold >= 750_000) {
        alerts.push({
          message: `${topThreat.name} can afford atom bomb pressure.`,
          urgency: "info",
        });
      }
    }

    const sleeping = Object.values(neighbors).filter((v) => v && v.sleeping).length;
    const traitor = Object.values(neighbors).filter((v) => v && v.betrayed).length;
    const inbound =
      Number(state.signalStats?.mirvInbound || 0) +
      Number(state.signalStats?.nukeInbound || 0) +
      Number(state.signalStats?.hydrogenInbound || 0);
    const threatScore = inbound * 2 + traitor * 2 + Math.max(0, 2 - sleeping);

    return {
      topThreat,
      enemyLeadSummary,
      isLeadingEconomy,
      behindRatio,
      alerts,
      myTroopCap,
      topEnemyTroopCap,
      sleeping,
      traitor,
      inbound,
      threatScore,
    };
  }

  function getUnitTypeName(unit) {
    if (!unit) return "";
    try {
      if (typeof unit.unitType === "function") return String(unit.unitType());
    } catch (_) {}
    try {
      if (typeof unit.type === "function") return String(unit.type());
    } catch (_) {}
    if (typeof unit.unitType === "string") return unit.unitType;
    if (typeof unit.type === "string") return unit.type;
    if (unit.constructor && unit.constructor.name) return String(unit.constructor.name);
    return "";
  }

  function getUnitPoint(game, unit) {
    try {
      if (typeof unit.x === "function" && typeof unit.y === "function") {
        const x = Number(unit.x());
        const y = Number(unit.y());
        if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
      }
    } catch (_) {}
    let tile = null;
    try {
      if (typeof unit.ref === "function") tile = Number(unit.ref());
    } catch (_) {}
    try {
      if (tile == null && typeof unit.tile === "function") tile = Number(unit.tile());
    } catch (_) {}
    if (tile != null && Number.isFinite(tile) && typeof game.x === "function" && typeof game.y === "function") {
      try {
        return { x: Number(game.x(tile)), y: Number(game.y(tile)) };
      } catch (_) {}
    }
    return null;
  }

  function getOwnedSupportStructures(game, me) {
    if (!me || typeof me.units !== "function") return [];
    let units = [];
    try {
      const u = me.units();
      if (Array.isArray(u)) units = u;
    } catch (_) {
      units = [];
    }
    const supports = [];
    for (const unit of units) {
      const typeName = getUnitTypeName(unit).toLowerCase();
      if (!typeName) continue;
      if (!typeName.includes("city") && !typeName.includes("port")) continue;
      const pos = getUnitPoint(game, unit);
      if (!pos) continue;
      supports.push(pos);
    }
    return supports;
  }

  function getOwnedEconomyStructures(game, me) {
    if (!me || typeof me.units !== "function") return [];
    let units = [];
    try {
      const u = me.units();
      if (Array.isArray(u)) units = u;
    } catch (_) {
      units = [];
    }
    const structures = [];
    for (const unit of units) {
      const typeName = getUnitTypeName(unit).toLowerCase();
      if (!typeName) continue;
      let weight = 0;
      if (typeName.includes("factory")) weight = 1.6;
      else if (typeName.includes("city")) weight = 1.3;
      else if (typeName.includes("port")) weight = 1.1;
      if (weight <= 0) continue;
      const pos = getUnitPoint(game, unit);
      if (!pos) continue;
      structures.push({ x: pos.x, y: pos.y, weight });
    }
    return structures;
  }

  function scoreEconomyCluster(target, center, structures) {
    if (!target) return 0;
    let supportScore = 0;
    for (const s of structures || []) {
      const d = Math.sqrt(distSq(target, s));
      supportScore += (Number(s.weight) || 0) / (1 + d / 12);
    }
    const centerDist = Math.sqrt(distSq(target, center || target));
    const centerBonus = Math.max(0, 1.6 - centerDist / 40);
    return Number((supportScore + centerBonus).toFixed(3));
  }

  function hasSupportNearTarget(game, me, target, maxDistSq = 900) {
    if (!target) return false;
    const supports = getOwnedSupportStructures(game, me);
    if (!supports.length) return false;
    return supports.some((point) => distSq(point, target) <= maxDistSq);
  }

  function getTerrainEconomyIntel(game, me, buildTargets = []) {
    if (!game || !me || typeof me.smallID !== "function") {
      return {
        mapHasWater: true,
        ownsShore: false,
        nearbyAllyPorts: 0,
        nearbyAllyFactories: 0,
        landlockedAllies: 0,
        portViable: true,
      };
    }
    const now = Date.now();
    const myId = Number(me.smallID());
    const width = Number(typeof game.width === "function" ? game.width() : 0);
    const height = Number(typeof game.height === "function" ? game.height() : 0);
    const cacheKey = `${myId}:${width}:${height}:${Math.floor(now / 5000)}`;
    if (terrainIntelCache.key === cacheKey && now - terrainIntelCache.at < 4900) {
      return terrainIntelCache.data;
    }

    let mapHasWater = false;
    if (width > 0 && height > 0 && typeof game.ref === "function" && typeof game.isWater === "function") {
      const sx = Math.max(1, Math.floor(width / 24));
      const sy = Math.max(1, Math.floor(height / 24));
      for (let y = 0; y < height && !mapHasWater; y += sy) {
        for (let x = 0; x < width; x += sx) {
          try {
            if (game.isWater(game.ref(x, y))) {
              mapHasWater = true;
              break;
            }
          } catch (_) {}
        }
      }
    }

    let ownsShore = false;
    if (
      mapHasWater &&
      typeof game.isShore === "function" &&
      state.myTilesSet &&
      typeof state.myTilesSet[Symbol.iterator] === "function"
    ) {
      for (const ref of state.myTilesSet) {
        try {
          if (game.isShore(ref)) {
            ownsShore = true;
            break;
          }
        } catch (_) {}
      }
    }

    let myCenter = { x: 0, y: 0 };
    try {
      if (typeof me.nameLocation === "function") {
        const p = me.nameLocation();
        myCenter = { x: Number(p.x) || 0, y: Number(p.y) || 0 };
      }
    } catch (_) {}

    let nearbyAllyPorts = 0;
    let nearbyAllyFactories = 0;
    let landlockedAllies = 0;
    if (typeof game.players === "function") {
      const players = game.players() || [];
      for (const p of players) {
        if (!p || typeof p.smallID !== "function") continue;
        if (Number(p.smallID()) === myId) continue;
        try {
          if (typeof p.isAlive === "function" && !p.isAlive()) continue;
        } catch (_) {}
        if (typeof me.isFriendly === "function") {
          try {
            if (!me.isFriendly(p)) continue;
          } catch (_) {
            continue;
          }
        } else {
          continue;
        }
        let allyPortCount = 0;
        let allyFactoryCount = 0;
        try {
          const units = typeof p.units === "function" ? p.units() : [];
          if (Array.isArray(units)) {
            for (const unit of units) {
              const t = getUnitTypeName(unit).toLowerCase();
              if (t.includes("port")) allyPortCount += 1;
              if (t.includes("factory")) allyFactoryCount += 1;
            }
          }
        } catch (_) {}
        let d2 = Number.POSITIVE_INFINITY;
        try {
          if (typeof p.nameLocation === "function") {
            const pos = p.nameLocation();
            const dx = (Number(pos.x) || 0) - myCenter.x;
            const dy = (Number(pos.y) || 0) - myCenter.y;
            d2 = dx * dx + dy * dy;
          }
        } catch (_) {}
        if (d2 <= 180 * 180) {
          nearbyAllyPorts += allyPortCount;
          nearbyAllyFactories += allyFactoryCount;
        }
        if (mapHasWater && allyPortCount === 0) {
          try {
            if (typeof p.numTilesOwned === "function" && Number(p.numTilesOwned()) > 0) {
              landlockedAllies += 1;
            }
          } catch (_) {}
        }
      }
    }

    let targetNearWater = false;
    if (
      mapHasWater &&
      typeof game.ref === "function" &&
      typeof game.circleSearch === "function" &&
      typeof game.isWater === "function"
    ) {
      for (const target of buildTargets) {
        if (!target || !Number.isFinite(Number(target.x)) || !Number.isFinite(Number(target.y))) continue;
        try {
          const ref = game.ref(Number(target.x), Number(target.y));
          const nearby = game.circleSearch(ref, 8, (tile) => game.isValidRef(tile));
          for (const tile of nearby) {
            if (game.isWater(tile)) {
              targetNearWater = true;
              break;
            }
          }
        } catch (_) {}
        if (targetNearWater) break;
      }
    }

    const portViable = mapHasWater && (ownsShore || nearbyAllyPorts > 0 || targetNearWater);
    const data = {
      mapHasWater,
      ownsShore,
      nearbyAllyPorts,
      nearbyAllyFactories,
      landlockedAllies,
      portViable,
    };
    terrainIntelCache = { at: now, key: cacheKey, data };
    return data;
  }

  function pickBestBuilding(live, threatScore, behindRatio, buildTargets, threatData, samPlan) {
    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    let me = null;
    try {
      me = game && typeof game.myPlayer === "function" ? game.myPlayer() : null;
    } catch (_) {
      me = null;
    }

    const intel = game && me ? getTerrainEconomyIntel(game, me, buildTargets || []) : null;
    const canUsePorts = !intel ? true : Boolean(intel.portViable);

    if (samPlan && samPlan.recommendSamNow) {
      const samGap = Math.max(
        0,
        Number(samPlan.required || 0) - Number(samPlan.current || 0),
      );
      const inboundNow = Math.max(0, Number(threatData.inbound || 0));
      const capGap = Math.max(
        0,
        Number(threatData.topEnemyTroopCap || 0) - Number(threatData.myTroopCap || 0),
      );
      const defenseValue =
        Number(samPlan.topImminentScore || 0) + inboundNow * 12 + samGap * 5;
      const economyValue =
        Number(behindRatio || 0) * 14 +
        (capGap > 0 ? 4 : 0) +
        (Number(live.gold || 0) < 20000 ? 2 : 0);
      const shouldPrioritizeSam =
        inboundNow > 0 || defenseValue >= economyValue + 6;
      if (!shouldPrioritizeSam) {
        // Economy snowball matters more than defensive spend in low-urgency windows.
      } else {
      let samCost = 0;
      try {
        if (game && typeof game.unitInfo === "function") {
          const info =
            game.unitInfo("SAM Launcher") ||
            game.unitInfo("SAMLauncher") ||
            game.unitInfo("SAM_Launcher");
          const rawCost = Number(info && (info.cost ?? info.goldCost));
          if (Number.isFinite(rawCost) && rawCost > 0) samCost = rawCost;
        }
      } catch (_) {}
      if (samCost <= 0 || Number(live.gold || 0) >= samCost) {
        return {
          building: "SAM Launcher",
          reason:
            samPlan.recommendSamReason ||
            "Missile threat is imminent and defensive value is higher than another economy build right now.",
        };
      }
      }
    }

    const capGap = Number(threatData.topEnemyTroopCap || 0) - Number(threatData.myTroopCap || 0);
    if (capGap > 0) {
      return {
        building: "City",
        reason: "Neighboring enemy troop cap is higher; city scaling improves your cap curve.",
      };
    }

    if (live.spawn) {
      return {
        building: canUsePorts ? "Port" : "City",
        reason: canUsePorts
          ? "Spawn phase favors lane access and flexible expansion routes."
          : "Map position is landlocked; city scaling is stronger than port early.",
      };
    }

    const factoryTarget =
      (buildTargets || []).find((t) => t && t.key === "factoryCore") || null;
    if (factoryTarget && game && me) {
      const hasSupport = hasSupportNearTarget(game, me, factoryTarget);
      if (!hasSupport) {
        return {
          building: canUsePorts ? "Port" : "City",
          reason: canUsePorts
            ? "Factory anchor has no nearby city/port support in your territory; build port first."
            : "Factory anchor has no support and ports are not terrain-viable; build city first.",
        };
      }
    }

    const openingWindow = Number(live.troops || 0) < 3000 && Number(live.gold || 0) < 25000;
    if (openingWindow) {
      return {
        building: canUsePorts ? "Port" : "City",
        reason: canUsePorts
          ? "Opening economy: establish lane access before factory scaling."
          : "Opening economy on landlocked terrain: prioritize city growth before factory scaling.",
      };
    }

    if (threatScore >= 6) {
      return {
        building: "Factory",
        reason: "High threat: stabilize economy and reserve before wide expansion.",
      };
    }
    if (live.gold < 12000) {
      return { building: "Factory", reason: "Low gold: improve sustained economy first." };
    }
    if (behindRatio > 0.2) {
      return { building: "Factory", reason: "Behind economy: prioritize scalable growth." };
    }
    if (live.gold > 90000) {
      return {
        building: canUsePorts ? "Port" : "Factory",
        reason: canUsePorts
          ? "High liquidity: pressure map edges with additional logistics lanes."
          : "High liquidity on landlocked terrain: convert economy to factory throughput.",
      };
    }

    if (factoryTarget && game && me) {
      return {
        building: "Factory",
        reason: "Factory target is connected to nearby city/port support.",
      };
    }

    return {
      building: canUsePorts ? "Port" : "Factory",
      reason: canUsePorts
        ? "Balanced state: convert economy to map pressure."
        : "Balanced landlocked state: factory scaling outperforms port logistics.",
    };
  }

  function buildCatchUpPlan(behindRatio, topThreat, live) {
    if (behindRatio <= 0.05) return [];
    const name = topThreat ? topThreat.name : "leading enemy";
    const plan = [
      `Match ${name} growth by adding 1-2 factories before over-sending.`,
      "Hold reserve against nuke windows; avoid all-in pushes.",
    ];
    if (live.gold < 25000) {
      plan.push("Delay extra ports until stable mid-gold threshold.");
    } else {
      plan.push("Open one pressure lane while keeping economy upgrades flowing.");
    }
    return plan;
  }

  function computeActionAndReason(threatScore, behindRatio, live, topThreat) {
    const targetName = topThreat ? topThreat.name : "enemy";
    if (threatScore >= 7) {
      return {
        bestAction: "hold",
        reason: `Defend and stabilize: threat is elevated versus ${targetName}.`,
      };
    }
    if (behindRatio > 0.28) {
      return {
        bestAction: "build",
        reason: `Economy catch-up needed against ${targetName} before large commits.`,
      };
    }
    if (live.gold > 5_000_000 && behindRatio < 0.1) {
      return {
        bestAction: "nuke",
        reason: `Strong economy window: strategic strike pressure is available.`,
      };
    }
    return {
      bestAction: "attack",
      reason: `Maintain map tempo with controlled sends and focused pressure.`,
    };
  }

  function computeSendPlan(live, myTroopCap, strongestEnemyTroops, behindRatio) {
    const rawTroops = Math.max(0, Number(live.troops) || 0);
    let cap = Math.max(0, Number(myTroopCap) || 0);
    if (!cap) cap = rawTroops;
    const troops = cap > 0 ? Math.min(rawTroops, cap) : rawTroops;
    const enemyTroops = Math.max(0, Number(strongestEnemyTroops) || 0);
    // Match game regeneration behavior: (10 + troops^0.73 / 4) * (1 - troops/max).
    const growthAt = (t) => {
      if (cap <= 0) return 0;
      const clamped = Math.max(0, Math.min(cap, Number(t) || 0));
      const ratio = 1 - clamped / cap;
      return Math.max(0, (10 + Math.pow(clamped, 0.73) / 4) * ratio);
    };
    let peakTroops = 0;
    let peakGrowth = -1;
    const steps = 60;
    for (let i = 0; i <= steps; i += 1) {
      const t = Math.floor((cap * i) / steps);
      const g = growthAt(t);
      if (g > peakGrowth) {
        peakGrowth = g;
        peakTroops = t;
      }
    }
    const bandThreshold = peakGrowth * 0.95;
    let bandLow = 0;
    let bandHigh = cap;
    for (let i = 0; i <= steps; i += 1) {
      const t = Math.floor((cap * i) / steps);
      if (growthAt(t) >= bandThreshold) {
        bandLow = t;
        break;
      }
    }
    for (let i = steps; i >= 0; i -= 1) {
      const t = Math.floor((cap * i) / steps);
      if (growthAt(t) >= bandThreshold) {
        bandHigh = t;
        break;
      }
    }

    // Threat floor protects from over-sending into vulnerable windows.
    const reserveFromThreat = Math.floor(enemyTroops * 0.4);
    const reserveFromCap = Math.floor(cap * 0.22);
    const reserveFloor = Math.max(180, reserveFromThreat, reserveFromCap);
    const minSafeTroops = Math.max(bandLow, reserveFloor);
    const hardMax = Math.max(0, Math.min(troops - minSafeTroops, troops));

    // Recommended send targets optimal regen (slightly below peak when behind).
    const targetTroops = Math.max(
      minSafeTroops,
      Math.min(
        bandHigh,
        Math.floor(
          peakTroops *
            (behindRatio > 0.25 ? 0.94 : 1),
        ),
      ),
    );
    const hardRecommended = Math.max(0, Math.min(troops - targetTroops, hardMax));

    const finalMaxPercent = troops > 0 ? Math.min(100, Math.round((hardMax / troops) * 100)) : 0;
    const finalRecommendedPercent =
      troops > 0 ? Math.min(100, Math.round((hardRecommended / troops) * 100)) : 0;
    return {
      maxSafeSendTroops: hardMax,
      maxSafeSendPercent: finalMaxPercent,
      recommendedSendTroops: hardRecommended,
      recommendedSendPercent: finalRecommendedPercent,
      inputTroops: troops,
      inputCap: cap,
      inputAttackRatio: readAttackRatio(),
      inputEarlyWindow: false,
      inputTicks: Number(live.ticks || 0),
      inputTiles: Number(live.tiles || 0),
      inputOptimalLow: bandLow,
      inputOptimalHigh: bandHigh,
      inputOptimalPeak: peakTroops,
    };
  }

  function calc() {
    const now = Date.now();
    const dynamicCacheMs = calcCacheMsByTier();
    if (calcCache.data && now - calcCache.at < dynamicCacheMs) {
      // Fast path: keep heavy strategic sections cached, but refresh send math
      // so Recommended/Max Safe values stay responsive to live troop changes.
      const live = readLive();
      const cached = calcCache.data;
      const enemyTroops =
        cached && cached.topThreatTroops != null
          ? Number(cached.topThreatTroops || 0)
          : Number(cached.sendInputCap || 0);
      const behindRatio = Number(cached && cached.behindRatio != null ? cached.behindRatio : 0);
      const sendPlan = computeSendPlan(
        live,
        live.troopCap > 0 ? live.troopCap : Number(cached.sendInputCap || 0),
        enemyTroops,
        behindRatio,
      );
      const targetActions = buildTargetActions(
        cached.topThreat || null,
        sendPlan,
        cached.targets || [],
        cached.bestAction || "hold",
      );
      return {
        ...cached,
        recommendedSendTroops: sendPlan.recommendedSendTroops,
        recommendedSendPercent: sendPlan.recommendedSendPercent,
        maxSafeSendTroops: sendPlan.maxSafeSendTroops,
        maxSafeSendPercent: sendPlan.maxSafeSendPercent,
        sendInputTroops: sendPlan.inputTroops,
        sendInputCap: sendPlan.inputCap,
        sendInputAttackRatio: sendPlan.inputAttackRatio,
        sendInputEarlyWindow: sendPlan.inputEarlyWindow,
        sendInputTicks: sendPlan.inputTicks,
        sendInputTiles: sendPlan.inputTiles,
        sendInputOptimalLow: sendPlan.inputOptimalLow,
        sendInputOptimalHigh: sendPlan.inputOptimalHigh,
        sendInputOptimalPeak: sendPlan.inputOptimalPeak,
        sendInputSource: String(live.troopSource || cached.sendInputSource || "fallback"),
        targetActions,
      };
    }
    const calcStart = performance.now();
    const live = readLive();
    const neighbors = state.neighborStatusById || {};
    const snapshot = fn.getStrategicSnapshot ? fn.getStrategicSnapshot() : state.strategicSnapshot;
    const tier = String((snapshot && snapshot.threatTier) || "D1");
    const useSnapshotOnly = tier === "D0" || tier === "D1" || tier === "D2";
    const threatStart = performance.now();
    const threatData =
      computeThreatAndEnemyFromSnapshot(live, neighbors, snapshot) ||
      computeThreatAndEnemy(live, neighbors);
    bumpPerfMetric("computeThreatAndEnemy", performance.now() - threatStart);
    const samStart = performance.now();
    const sam = useSnapshotOnly
      ? computeSamPlanFromSnapshot(snapshot) || computeSamPlan()
      : computeSamPlan();
    bumpPerfMetric("computeSamPlan", performance.now() - samStart);
    const sendPlan = computeSendPlan(
      live,
      live.troopCap > 0 ? live.troopCap : threatData.myTroopCap,
      threatData.topThreat ? threatData.topThreat.troops : 0,
      threatData.behindRatio,
    );
    const action = computeActionAndReason(
      threatData.threatScore,
      threatData.behindRatio,
      live,
      threatData.topThreat,
    );
    const buildStart = performance.now();
    const buildTargets = computeBuildTargets();
    bumpPerfMetric("computeBuildTargets", performance.now() - buildStart);
    const buildingPlan = pickBestBuilding(
      live,
      threatData.threatScore,
      threatData.behindRatio,
      buildTargets,
      threatData,
      sam,
    );
    const spawnCandidates = computeSpawnCandidates();
    const targetActions = buildTargetActions(
      threatData.topThreat,
      sendPlan,
      buildTargets,
      action.bestAction,
    );
    const catchUpPlan = buildCatchUpPlan(
      threatData.behindRatio,
      threatData.topThreat,
      live,
    );
    const cityTarget =
      (buildTargets || []).find(
        (t) =>
          t &&
          (String(t.label || "").toLowerCase().includes("city") ||
            String(t.key || "").toLowerCase().includes("city")),
      ) ||
      (buildTargets || []).find((t) => t && String(t.key || "") === "factoryCore") ||
      (buildTargets || [])[0] ||
      null;
    const samTarget = (sam.samPlacements && sam.samPlacements[0]) || null;

    const data = {
      threatTier: tier,
      phase: String(state.gamePhase || "none"),
      topThreat: threatData.topThreat || null,
      topThreatTroops: threatData.topThreat ? Number(threatData.topThreat.troops || 0) : 0,
      behindRatio: Number(threatData.behindRatio || 0),
      bestAction: action.bestAction,
      actionReason: action.reason,
      recommendedSendTroops: sendPlan.recommendedSendTroops,
      recommendedSendPercent: sendPlan.recommendedSendPercent,
      maxSafeSendTroops: sendPlan.maxSafeSendTroops,
      maxSafeSendPercent: sendPlan.maxSafeSendPercent,
      sendInputTroops: sendPlan.inputTroops,
      sendInputCap: sendPlan.inputCap,
      sendInputAttackRatio: sendPlan.inputAttackRatio,
      sendInputEarlyWindow: sendPlan.inputEarlyWindow,
      sendInputTicks: sendPlan.inputTicks,
      sendInputTiles: sendPlan.inputTiles,
      sendInputOptimalLow: sendPlan.inputOptimalLow,
      sendInputOptimalHigh: sendPlan.inputOptimalHigh,
      sendInputOptimalPeak: sendPlan.inputOptimalPeak,
      sendInputSource: String(live.troopSource || "fallback"),
      bestBuilding: buildingPlan.building,
      bestBuildingReason: buildingPlan.reason,
      enemyLeadSummary: threatData.enemyLeadSummary,
      isLeadingEconomy: threatData.isLeadingEconomy,
      catchUpPlan,
      alerts: threatData.alerts,
      requiredSamLaunchers: sam.required,
      currentSamLaunchers: sam.current,
      samThreats: sam.threats,
      samPlacements: sam.samPlacements || [],
      inbound: threatData.inbound,
      sleeping: threatData.sleeping,
      traitor: threatData.traitor,
      targets: buildTargets,
      cityTarget,
      samTarget,
      profitableTargets: [...buildTargets].sort(
        (a, b) => Number(b.econScore || 0) - Number(a.econScore || 0),
      ),
      targetActions,
      spawnCandidates,
      spawnRecommendation: spawnCandidates[0] || null,
    };
    calcCache = { at: now, data };
    bumpPerfMetric("calc", performance.now() - calcStart);
    return data;
  }

  function refreshSendOnly() {
    if (document.hidden || !isEnabled() || !inGame() || collapsed) return;
    if (!panelEl || !document.body.contains(panelEl)) return;
    if (!calcCache.data) return;
    const base = calcCache.data;
    const live = readLive();
    const enemyTroops =
      base && base.topThreatTroops != null
        ? Number(base.topThreatTroops || 0)
        : Number(base.sendInputCap || 0);
    const behindRatio = Number(base && base.behindRatio != null ? base.behindRatio : 0);
    const sendPlan = computeSendPlan(
      live,
      live.troopCap > 0 ? live.troopCap : Number(base.sendInputCap || 0),
      enemyTroops,
      behindRatio,
    );
    const recEl = panelEl.querySelector("#ofe-send-rec-value");
    const maxEl = panelEl.querySelector("#ofe-send-max-value");
    const inputsEl = panelEl.querySelector("#ofe-send-inputs");
    if (recEl) {
      recEl.textContent = `${formatTroopsUi(sendPlan.recommendedSendTroops)} (${Number(sendPlan.recommendedSendPercent || 0)}%)`;
    }
    if (maxEl) {
      maxEl.textContent = `${formatTroopsUi(sendPlan.maxSafeSendTroops)} (${Number(sendPlan.maxSafeSendPercent || 0)}%)`;
    }
    if (inputsEl) {
      inputsEl.textContent = `Send inputs: troops ${formatTroopsUi(sendPlan.inputTroops)} | cap ${formatTroopsUi(sendPlan.inputCap)} | optimal ${formatTroopsUi(sendPlan.inputOptimalLow)}-${formatTroopsUi(sendPlan.inputOptimalHigh)} (peak ${formatTroopsUi(sendPlan.inputOptimalPeak)}) | ratio ${Math.round((Number(sendPlan.inputAttackRatio || 0) * 100))}% | tick ${Math.round(Number(sendPlan.inputTicks || 0)).toLocaleString()} | tiles ${Math.round(Number(sendPlan.inputTiles || 0)).toLocaleString()} | src ${String(live.troopSource || base.sendInputSource || "fallback")}`;
    }
  }

  function renderAlerts(alerts) {
    if (!alerts || alerts.length === 0) {
      return "<div style='font-size:11px;color:#cbd5e1'>No critical enemy strategic signals right now.</div>";
    }
    return alerts
      .map((alert) => {
        const style =
          alert.urgency === "critical"
            ? "border:1px solid rgba(248,113,113,.5);background:rgba(239,68,68,.14);color:#fecaca;"
            : alert.urgency === "warn"
              ? "border:1px solid rgba(251,191,36,.5);background:rgba(245,158,11,.13);color:#fde68a;"
              : "border:1px solid rgba(96,165,250,.5);background:rgba(59,130,246,.12);color:#bfdbfe;";
        return `<div style='font-size:11px;border-radius:6px;padding:4px 6px;${style}'>${alert.message}</div>`;
      })
      .join("");
  }

  function renderExpanded(data) {
    let perfLine = "";
    try {
      if (localStorage.getItem("ofe.perf.debug") === "1") {
        const perf = state.perf && state.perf.economyAdvisor;
        if (perf && perf.counts) {
          const calcAvg = perf.counts.calc
            ? (Number(perf.totalsMs.calc || 0) / Number(perf.counts.calc || 1)).toFixed(2)
            : "0.00";
          const samAvg = perf.counts.computeSamPlan
            ? (Number(perf.totalsMs.computeSamPlan || 0) / Number(perf.counts.computeSamPlan || 1)).toFixed(2)
            : "0.00";
          const buildAvg = perf.counts.computeBuildTargets
            ? (Number(perf.totalsMs.computeBuildTargets || 0) / Number(perf.counts.computeBuildTargets || 1)).toFixed(2)
            : "0.00";
          perfLine = `Perf avg (ms): calc ${calcAvg} | sam ${samAvg} | build ${buildAvg}`;
        }
      }
    } catch (_) {}
    return [
      "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:6px'>",
      "<strong style='color:#67e8f9;letter-spacing:.04em'>Economy Advisor</strong>",
      "<button id='ofe-econ-collapse' type='button' style='font-size:10px;padding:2px 6px;border-radius:6px;border:1px solid rgba(148,163,184,.35);background:#0f172a;color:#cbd5e1;cursor:pointer'>Collapse</button>",
      "</div>",
      "<div style='border:1px solid rgba(56,189,248,.35);background:rgba(6,182,212,.12);border-radius:8px;padding:6px;margin-bottom:6px'>",
      "<div style='font-size:10px;text-transform:uppercase;color:#a5f3fc'>Best Next Step</div>",
      `<div style='font-weight:700'>${String(data.bestAction || "hold").toUpperCase()}</div>`,
      `<div style='font-size:11px;color:#e2e8f0'>${data.actionReason}</div>`,
      `<div style='font-size:11px;color:#cbd5e1;margin-top:2px'>Best build now: ${data.bestBuilding || "None"}.</div>`,
      `<div style='font-size:10px;color:#94a3b8'>${data.bestBuildingReason || ""}</div>`,
      perfLine
        ? `<div style='font-size:10px;color:#67e8f9;margin-top:2px'>${perfLine}</div>`
        : "",
      "<div style='margin-top:5px;display:flex;gap:4px;flex-wrap:wrap'>",
      `<button data-ofe-overlay='toggle' type='button' style='font-size:10px;padding:2px 6px;border-radius:6px;border:1px solid rgba(52,211,153,.45);background:${overlayEnabled ? "rgba(16,185,129,.2)" : "rgba(15,23,42,.7)"};color:#d1fae5;cursor:pointer'>Hide Map Overlay</button>`,
      `<button data-ofe-overlay='spawn' type='button' style='font-size:10px;padding:2px 6px;border-radius:6px;border:1px solid rgba(248,113,113,.4);background:${overlayLayers.spawn ? "rgba(239,68,68,.2)" : "rgba(15,23,42,.7)"};color:#fecaca;cursor:pointer'>Spawn dots</button>`,
      `<button data-ofe-overlay='build' type='button' style='font-size:10px;padding:2px 6px;border-radius:6px;border:1px solid rgba(74,222,128,.4);background:${overlayLayers.build ? "rgba(34,197,94,.2)" : "rgba(15,23,42,.7)"};color:#bbf7d0;cursor:pointer'>Build spot</button>`,
      `<button data-ofe-overlay='target' type='button' style='font-size:10px;padding:2px 6px;border-radius:6px;border:1px solid rgba(251,113,133,.4);background:${overlayLayers.target ? "rgba(244,63,94,.2)" : "rgba(15,23,42,.7)"};color:#fecdd3;cursor:pointer'>Target dot</button>`,
      `<button data-ofe-overlay='route' type='button' style='font-size:10px;padding:2px 6px;border-radius:6px;border:1px solid rgba(56,189,248,.4);background:${overlayLayers.route ? "rgba(14,165,233,.2)" : "rgba(15,23,42,.7)"};color:#bae6fd;cursor:pointer'>Route line</button>`,
      `<button data-ofe-overlay='boats' type='button' style='font-size:10px;padding:2px 6px;border-radius:6px;border:1px solid rgba(125,211,252,.45);background:${getOverlayHelperState().boats ? "rgba(14,165,233,.2)" : "rgba(15,23,42,.7)"};color:#bae6fd;cursor:pointer'>Landing boats</button>`,
      `<button data-ofe-overlay='troops' type='button' style='font-size:10px;padding:2px 6px;border-radius:6px;border:1px solid rgba(167,139,250,.45);background:${getOverlayHelperState().troops ? "rgba(139,92,246,.2)" : "rgba(15,23,42,.7)"};color:#ddd6fe;cursor:pointer'>Troops sent</button>`,
      `<button data-ofe-overlay='alliances' type='button' style='font-size:10px;padding:2px 6px;border-radius:6px;border:1px solid rgba(74,222,128,.45);background:${getOverlayHelperState().alliances ? "rgba(34,197,94,.2)" : "rgba(15,23,42,.7)"};color:#bbf7d0;cursor:pointer'>Alliance links</button>`,
      "</div>",
      "</div>",
      "<div style='display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px'>",
      "<div style='border:1px solid rgba(148,163,184,.3);border-radius:8px;padding:6px;background:rgba(15,23,42,.65)'>",
      "<div style='font-size:10px;text-transform:uppercase;color:#94a3b8'>Recommended Send</div>",
      `<div id='ofe-send-rec-value' style='font-weight:700'>${formatTroopsUi(data.recommendedSendTroops)} (${Number(data.recommendedSendPercent || 0)}%)</div>`,
      "</div>",
      "<div style='border:1px solid rgba(148,163,184,.3);border-radius:8px;padding:6px;background:rgba(15,23,42,.65)'>",
      "<div style='font-size:10px;text-transform:uppercase;color:#94a3b8'>Max Safe Send</div>",
      `<div id='ofe-send-max-value' style='font-weight:700'>${formatTroopsUi(data.maxSafeSendTroops)} (${Number(data.maxSafeSendPercent || 0)}%)</div>`,
      "</div>",
      "</div>",
      `<div id='ofe-send-inputs' style='margin:-2px 0 6px;font-size:10px;color:#94a3b8'>Send inputs: troops ${formatTroopsUi(data.sendInputTroops)} | cap ${formatTroopsUi(data.sendInputCap)} | optimal ${formatTroopsUi(data.sendInputOptimalLow)}-${formatTroopsUi(data.sendInputOptimalHigh)} (peak ${formatTroopsUi(data.sendInputOptimalPeak)}) | ratio ${Math.round((Number(data.sendInputAttackRatio || 0) * 100))}% | tick ${Math.round(Number(data.sendInputTicks || 0)).toLocaleString()} | tiles ${Math.round(Number(data.sendInputTiles || 0)).toLocaleString()} | src ${String(data.sendInputSource || "fallback")}</div>`,
      "<div style='border:1px solid rgba(148,163,184,.3);border-radius:8px;padding:6px;background:rgba(15,23,42,.65);margin-bottom:6px'>",
      "<div style='font-size:10px;text-transform:uppercase;color:#94a3b8'>Enemy Economy Lead</div>",
      `<div style='font-size:11px;color:#e2e8f0'>${data.enemyLeadSummary}</div>`,
      "</div>",
      data.isLeadingEconomy
        ? ""
        : "<div style='border:1px solid rgba(148,163,184,.3);border-radius:8px;padding:6px;background:rgba(15,23,42,.65);margin-bottom:6px'><div style='font-size:10px;text-transform:uppercase;color:#94a3b8'>Catch-Up Plan</div><ul style='margin:4px 0 0;padding-left:15px'>" +
          (data.catchUpPlan || []).map((line) => `<li style='font-size:11px;color:#e2e8f0'>${line}</li>`).join("") +
          "</ul></div>",
      "<div style='border:1px solid rgba(148,163,184,.3);border-radius:8px;padding:6px;background:rgba(15,23,42,.65);margin-bottom:6px'>",
      "<div style='font-size:10px;text-transform:uppercase;color:#94a3b8;margin-bottom:4px'>Strategic Alerts</div>",
      renderAlerts(data.alerts),
      "</div>",
      "<div style='border:1px solid rgba(148,163,184,.3);border-radius:8px;padding:6px;background:rgba(15,23,42,.65);margin-bottom:6px'>",
      "<div style='font-size:10px;text-transform:uppercase;color:#94a3b8'>Action Plan</div>",
      "<ul style='margin:4px 0 0;padding-left:15px'>",
      ...(data.targetActions || []).map(
        (a) =>
          `<li style='font-size:11px;color:#e2e8f0'><strong>${a.action}</strong> -> <strong>${a.target}</strong>${a.sendTroops > 0 ? ` (${formatTroopsUi(a.sendTroops)} / ${a.sendPercent}%)` : ""} <span style='color:#94a3b8'>- ${a.reason}</span></li>`,
      ),
      "</ul>",
      "</div>",
      "<div style='border:1px solid rgba(148,163,184,.3);border-radius:8px;padding:6px;background:rgba(15,23,42,.65);margin-bottom:6px'>",
      "<div style='font-size:10px;text-transform:uppercase;color:#94a3b8'>SAM Plan</div>",
      `<div style='font-size:11px;color:#e2e8f0'>Need about ${Number(data.requiredSamLaunchers || 0)} SAM launchers (${Number(data.currentSamLaunchers || 0)} built).</div>`,
      "<div style='font-size:10px;text-transform:uppercase;color:#94a3b8;margin-top:4px'>Threat Breakdown</div>",
      "<ul style='margin:4px 0 0;padding-left:15px'>",
      ...(data.samThreats || []).map((line) => `<li style='font-size:11px;color:#e2e8f0'>${line}</li>`),
      "</ul>",
      "<div style='font-size:10px;text-transform:uppercase;color:#94a3b8;margin-top:4px'>Suggested Coverage</div>",
      (data.samPlacements && data.samPlacements.length
        ? "<div style='display:grid;gap:4px;margin-top:4px'>" +
          data.samPlacements
            .map(
              (p, idx) =>
                "<div style='display:flex;justify-content:space-between;align-items:center;gap:6px;border:1px solid rgba(51,65,85,.8);border-radius:6px;padding:4px 6px'>" +
                "<div style='min-width:0'>" +
                `<div style='font-size:11px;font-weight:700;color:#e2e8f0'>${String(p.grid || "Grid")}</div>` +
                `<div style='font-size:10px;color:#94a3b8'>${String(p.reason || "")}</div>` +
                "</div>" +
                `<button data-ofe-sam-goto='${idx}' data-ofe-x='${Number(p.x) || 0}' data-ofe-y='${Number(p.y) || 0}' type='button' style='font-size:10px;padding:3px 8px;border-radius:6px;border:1px solid rgba(56,189,248,.45);background:#082f49;color:#bae6fd;cursor:pointer'>Go</button>` +
                "</div>",
            )
            .join("") +
          "</div>"
        : "<div style='font-size:11px;color:#94a3b8;margin-top:2px'>Coverage suggestions will appear when high-value clusters are identified.</div>"),
      "</div>",
      data.spawnRecommendation
        ? "<div style='border:1px solid rgba(148,163,184,.3);border-radius:8px;padding:6px;background:rgba(15,23,42,.65);margin-bottom:6px'><div style='font-size:10px;text-transform:uppercase;color:#94a3b8'>Start Positions (Live)</div>" +
          `<div style='font-weight:700'>(${data.spawnRecommendation.x}, ${data.spawnRecommendation.y})</div>` +
          `<div style='font-size:11px;color:#e2e8f0'>${data.spawnRecommendation.reason}</div>` +
          "<div style='font-size:10px;color:#94a3b8'>Red brightness indicates recommendation strength.</div></div>"
        : "",
      "<div style='border:1px solid rgba(148,163,184,.3);border-radius:8px;padding:6px;background:rgba(15,23,42,.65)'>",
      "<div style='font-size:10px;color:#a5b4fc;margin-bottom:4px;text-transform:uppercase'>Plan In Action (Where to Build)</div>",
      (data.cityTarget
        ? "<div style='display:flex;justify-content:space-between;align-items:center;gap:6px;border:1px solid rgba(96,165,250,.45);border-radius:6px;padding:4px 6px;margin-bottom:4px;background:rgba(30,64,175,.12)'>" +
          "<div style='min-width:0'>" +
          `<div style='font-weight:700'>City anchor <span style='color:#94a3b8;font-weight:400'>(${Number(data.cityTarget.x) || 0}, ${Number(data.cityTarget.y) || 0})</span></div>` +
          "<div style='font-size:10px;color:#93c5fd'>Build city here when scaling cap/econ is the priority.</div>" +
          "</div>" +
          `<button data-ofe-goto='city' data-ofe-x='${Number(data.cityTarget.x) || 0}' data-ofe-y='${Number(data.cityTarget.y) || 0}' type='button' style='font-size:10px;padding:3px 8px;border-radius:6px;border:1px solid rgba(96,165,250,.55);background:#1e3a8a;color:#dbeafe;cursor:pointer'>Go City</button>` +
          "</div>"
        : ""),
      (data.samTarget
        ? "<div style='display:flex;justify-content:space-between;align-items:center;gap:6px;border:1px solid rgba(251,113,133,.45);border-radius:6px;padding:4px 6px;margin-bottom:4px;background:rgba(159,18,57,.12)'>" +
          "<div style='min-width:0'>" +
          `<div style='font-weight:700'>SAM coverage <span style='color:#94a3b8;font-weight:400'>${String(data.samTarget.grid || `(${Number(data.samTarget.x) || 0}, ${Number(data.samTarget.y) || 0})`)}</span></div>` +
          `<div style='font-size:10px;color:#fda4af'>${String(data.samTarget.reason || "Defend high-value economy clusters from missile windows.")}</div>` +
          "</div>" +
          `<button data-ofe-sam-goto='quick' data-ofe-x='${Number(data.samTarget.x) || 0}' data-ofe-y='${Number(data.samTarget.y) || 0}' type='button' style='font-size:10px;padding:3px 8px;border-radius:6px;border:1px solid rgba(251,113,133,.55);background:#881337;color:#ffe4e6;cursor:pointer'>Go SAM</button>` +
          "</div>"
        : ""),
      ...(data.targets || []).map(
        (target, idx) =>
          "<div style='display:flex;justify-content:space-between;align-items:center;gap:6px;border:1px solid rgba(51,65,85,.8);border-radius:6px;padding:4px 6px;margin-bottom:4px'>" +
          "<div style='min-width:0'>" +
          `<div style='font-weight:700'>${target.label} <span style='color:#94a3b8;font-weight:400'>(${target.x}, ${target.y})</span></div>` +
          `<div style='font-size:10px;color:#94a3b8'>${target.why}</div>` +
          "</div>" +
          `<button data-ofe-goto='${idx}' data-ofe-x='${target.x}' data-ofe-y='${target.y}' type='button' style='font-size:10px;padding:3px 8px;border-radius:6px;border:1px solid rgba(56,189,248,.45);background:#082f49;color:#bae6fd;cursor:pointer'>Go</button>` +
          "</div>",
      ),
      "</div>",
    ].join("");
  }

  function renderCollapsed() {
    return [
      "<div style='display:flex;justify-content:space-between;align-items:center'>",
      "<strong style='color:#67e8f9;letter-spacing:.04em'>Economy Advisor</strong>",
      "<button id='ofe-econ-collapse' type='button' style='font-size:10px;padding:2px 6px;border-radius:6px;border:1px solid rgba(148,163,184,.35);background:#0f172a;color:#cbd5e1;cursor:pointer'>Expand</button>",
      "</div>",
    ].join("");
  }

  function bindCollapse() {
    const btn = panelEl && panelEl.querySelector("#ofe-econ-collapse");
    if (!btn) return;
    btn.addEventListener("click", () => {
      collapsed = !collapsed;
      saveCollapsed();
      render();
    });
  }

  function bindPlanActions() {
    if (!panelEl) return;
    panelEl.querySelectorAll("[data-ofe-goto]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const x = Number(btn.getAttribute("data-ofe-x"));
        const y = Number(btn.getAttribute("data-ofe-y"));
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (typeof fn.navigateToPosition === "function") {
          fn.navigateToPosition(x, y, true);
        }
        fn.pushBottomRightLog?.(`Economy Advisor target: (${x}, ${y})`);
      });
    });
  }

  function bindSamActions() {
    if (!panelEl) return;
    panelEl.querySelectorAll("[data-ofe-sam-goto]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const x = Number(btn.getAttribute("data-ofe-x"));
        const y = Number(btn.getAttribute("data-ofe-y"));
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (typeof fn.navigateToPosition === "function") {
          fn.navigateToPosition(x, y, true);
        }
        fn.pushBottomRightLog?.(`SAM coverage target: (${x}, ${y})`);
      });
    });
  }

  function bindOverlayActions() {
    if (!panelEl) return;
    panelEl.querySelectorAll("[data-ofe-overlay]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-ofe-overlay");
        if (action === "toggle") {
          // Kill-all switch: disable every overlay channel.
          overlayEnabled = false;
          overlayLayers.spawn = false;
          overlayLayers.build = false;
          overlayLayers.target = false;
          overlayLayers.route = false;
          setOverlayHelperState({ boats: false, troops: false, alliances: false });
        } else if (action) {
          // Single-select mode: turn on only the clicked overlay.
          overlayEnabled = true;
          overlayLayers.spawn = false;
          overlayLayers.build = false;
          overlayLayers.target = false;
          overlayLayers.route = false;
          const nextHelpers = { boats: false, troops: false, alliances: false };

          if (Object.prototype.hasOwnProperty.call(overlayLayers, action)) {
            overlayLayers[action] = true;
          } else if (Object.prototype.hasOwnProperty.call(OVERLAY_HELPER_KEYS, action)) {
            nextHelpers[action] = true;
          }
          setOverlayHelperState(nextHelpers);
        }
        render();
      });
    });
  }

  function drawOverlayFromData(data) {
    if (!overlayEnabled || !inGame()) {
      lastOverlaySignature = "";
      clearOverlay();
      return;
    }
    const target = data.targetActions && data.targetActions[0];
    const build = data.targets && data.targets[0];
    const profitable = (data.profitableTargets || []).slice(0, 1);
    const spawnTop =
      (data.spawnCandidates || [])
        .slice(0, 5)
        .map((c) => `${Number(c.x) || 0},${Number(c.y) || 0},${Number(c.strength || 0).toFixed(2)}`)
        .join("|") || "";
    const nextSignature = [
      overlayEnabled ? "1" : "0",
      overlayLayers.spawn ? "1" : "0",
      overlayLayers.build ? "1" : "0",
      overlayLayers.target ? "1" : "0",
      overlayLayers.route ? "1" : "0",
      target ? `${Number(target.targetX) || 0},${Number(target.targetY) || 0}` : "",
      build ? `${Number(build.x) || 0},${Number(build.y) || 0}` : "",
      profitable
        .map((p) => `${Number(p.x) || 0},${Number(p.y) || 0},${Number(p.econScore || 0).toFixed(2)}`)
        .join("|"),
      spawnTop,
    ].join(";");
    if (nextSignature === lastOverlaySignature) return;
    lastOverlaySignature = nextSignature;
    clearOverlay();

    if (overlayLayers.target && target && Number.isFinite(Number(target.targetX)) && Number.isFinite(Number(target.targetY))) {
      drawOverlayPoint(
        { x: Number(target.targetX), y: Number(target.targetY) },
        "rgba(248,113,113,.92)",
        "Target",
      );
    }
    if (overlayLayers.build && build) {
      drawOverlayPoint(
        { x: Number(build.x), y: Number(build.y) },
        "rgba(74,222,128,.92)",
        "Build",
      );
    }
    if (overlayLayers.spawn) {
      (data.spawnCandidates || []).forEach((candidate, idx) => {
        drawOverlayPoint(
          { x: Number(candidate.x), y: Number(candidate.y) },
          `rgba(248,113,113,${Math.max(0.35, Math.min(1, Number(candidate.strength || 0.6))).toFixed(2)})`,
          idx === 0 ? "Top spawn" : "",
        );
      });
    }
    if (overlayLayers.route) {
      const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
      let from = null;
      try {
        const me = game && typeof game.myPlayer === "function" ? game.myPlayer() : null;
        if (me && typeof me.nameLocation === "function") {
          const p = me.nameLocation();
          from = { x: Number(p.x) || 0, y: Number(p.y) || 0 };
        }
      } catch (_) {
        from = null;
      }
      if (from) {
        profitable.forEach((t, idx) => {
          drawOverlayLine(
            from,
            { x: Number(t.x), y: Number(t.y) },
            idx === 0 ? "rgba(125,211,252,.95)" : "rgba(56,189,248,.75)",
            idx === 0 ? "Top profit route" : "Profit route",
          );
        });
      }
    }
  }

  function render() {
    const startedAt = performance.now();
    if (document.hidden) return;
    if (!isEnabled() || !inGame()) {
      if (panelEl) panelEl.style.display = "none";
      lastPanelHtml = "";
      lastOverlaySignature = "";
      clearOverlay();
      return;
    }
    const el = ensurePanel();
    if (!el) return;
    const data = calc();
    el.style.display = "";
    const nextHtml = collapsed ? renderCollapsed() : renderExpanded(data);
    if (nextHtml !== lastPanelHtml) {
      lastPanelHtml = nextHtml;
      el.innerHTML = nextHtml;
      bindCollapse();
      bindPlanActions();
      bindSamActions();
      bindOverlayActions();
    }
    drawOverlayFromData(data);
    bumpPerfMetric("render", performance.now() - startedAt);
  }

  fn.initEconomyAdvisorPanel = () => {
    if (timer) return;
    loadCollapsed();
    let pendingFrame = false;
    let lastRenderAt = 0;
    const minRenderGap = () => {
      const tier = getThreatTier();
      if (tier === "D3") return 700;
      if (tier === "D2") return 1400;
      if (tier === "D0") return 2600;
      return 2200;
    };
    const scheduleRender = () => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastRenderAt < minRenderGap()) return;
      if (pendingFrame) return;
      pendingFrame = true;
      requestAnimationFrame(() => {
        pendingFrame = false;
        lastRenderAt = Date.now();
        render();
      });
    };
    const boot = () => {
      render();
      // Fallback cadence intentionally low; live updates are throttled above.
      timer = setInterval(() => {
        if (document.hidden) return;
        render();
      }, 2600);
      // Keep send component very reactive without speeding the rest of the panel.
      sendTickTimer = setInterval(() => {
        if (document.hidden) return;
        refreshSendOnly();
      }, 120);
      // Primary refresh trigger: every live game_update tick.
      window.addEventListener("ofe-live-stats-updated", scheduleRender);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
  };
})();
