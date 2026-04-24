"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { fn } = ns;

  const PAGE_SOURCE = "openfront-autojoin-page";
  const EXT_SOURCE = "openfront-autojoin-extension";
  const CORE_SCRIPTS = [
    "src/vendor/page-bridge/runtime.js",
    "src/vendor/page-bridge/shared-utils.js",
    "src/vendor/page-bridge/selective-trade-policy.js",
    "src/vendor/page-bridge/bootstrap.js",
  ];
  const MODULE_GROUPS = {
    alliances: ["src/vendor/page-bridge/alliances.js"],
    botMarkers: ["src/vendor/page-bridge/bot-markers.js"],
    goldPerMinute: ["src/vendor/page-bridge/gold-per-minute.js"],
    tradeBalances: ["src/vendor/page-bridge/trade-balances.js"],
    attackAmounts: ["src/vendor/page-bridge/attack-amounts.js"],
    nukePrediction: ["src/vendor/page-bridge/nuke-prediction.js"],
    nukeSuggestions: ["src/vendor/page-bridge/nuke-suggestions.js"],
    boatPrediction: ["src/vendor/page-bridge/boat-prediction.js"],
    heatmaps: ["src/vendor/page-bridge/heatmaps.js"],
  };

  let bridgeCoreReady = false;
  let bridgeAvailable = false;
  let syncInterval = null;
  let lastSyncSignature = "";
  let bridgeBaseUrl = "";
  let scriptLoadChain = Promise.resolve();
  const loadedScripts = new Set();
  let syncInFlight = false;
  let syncQueued = false;
  let syncQueuedForce = false;

  function isPrimaryOpenFrontHost() {
    const host = String(location.hostname || "").toLowerCase();
    return (
      host === "openfront.io" ||
      host === "www.openfront.io" ||
      host === "openfront.dev" ||
      host === "www.openfront.dev" ||
      host.endsWith(".openfront.dev")
    );
  }

  function getBridgeBaseUrl() {
    if (bridgeBaseUrl) return bridgeBaseUrl;
    const raw = document.documentElement
      ? document.documentElement.getAttribute("data-ofe-extension-url")
      : "";
    bridgeBaseUrl = typeof raw === "string" ? raw : "";
    if (bridgeBaseUrl && !bridgeBaseUrl.endsWith("/")) {
      bridgeBaseUrl += "/";
    }
    return bridgeBaseUrl;
  }

  function readBridgeSettings() {
    const settings = fn.getEffectiveExtensionSettings
      ? fn.getEffectiveExtensionSettings()
      : {};
    const intensityRaw = Number(settings.economyHeatmapIntensity);
    const intensity = Number.isFinite(intensityRaw)
      ? Math.max(0, Math.min(2, Math.round(intensityRaw)))
      : 1;

    return {
      markBotNationsRed: Boolean(settings.markBotNationsRed),
      markHoveredAlliesGreen: Boolean(settings.markHoveredAlliesGreen),
      showGoldPerMinute: Boolean(settings.showGoldPerMinute),
      showTeamGoldPerMinute: Boolean(settings.showTeamGoldPerMinute),
      showTopGoldPerMinute: Boolean(settings.showTopGoldPerMinute),
      showTradeBalances: Boolean(settings.showTradeBalances),
      selectiveTradePolicyEnabled: Boolean(settings.selectiveTradePolicyEnabled),
      fpsSaver: Boolean(settings.fpsSaver),
      showAttackAmounts: Boolean(settings.showAttackAmounts),
      showNukePrediction: Boolean(settings.showNukePrediction),
      showBoatPrediction: Boolean(settings.showBoatPrediction),
      showNukeSuggestions:
        Boolean(settings.showNukeSuggestions) && Boolean(settings.cheatsAvailable),
      autoNuke: Boolean(settings.autoNuke) && Boolean(settings.cheatsAvailable),
      autoNukeIncludeAllies: Boolean(settings.autoNukeIncludeAllies),
      showEconomyHeatmap: Boolean(settings.showEconomyHeatmap),
      economyHeatmapIntensity: intensity,
      showExportPartnerHeatmap: Boolean(settings.showExportPartnerHeatmap),
      showNukeTargetHeatmap: Boolean(settings.showNukeTargetHeatmap),
    };
  }

  function postToPageBridge(type, payload) {
    window.postMessage(
      {
        source: EXT_SOURCE,
        type,
        payload,
      },
      "*",
    );
  }

  function ensureScriptLoaded(scriptPath) {
    if (loadedScripts.has(scriptPath)) return Promise.resolve();
    const baseUrl = getBridgeBaseUrl();
    if (!baseUrl) return Promise.resolve();

    scriptLoadChain = scriptLoadChain.then(
      () =>
        new Promise((resolve) => {
          if (loadedScripts.has(scriptPath)) {
            resolve();
            return;
          }
          const root = document.head || document.documentElement;
          if (!root) {
            resolve();
            return;
          }
          const script = document.createElement("script");
          script.async = false;
          script.dataset.ofeCompanionBridge = "1";
          script.src = `${baseUrl}${scriptPath}`;
          script.addEventListener("load", () => {
            loadedScripts.add(scriptPath);
            script.remove();
            resolve();
          });
          script.addEventListener("error", () => {
            resolve();
          });
          root.appendChild(script);
        }),
    );
    return scriptLoadChain;
  }

  async function ensureCoreScripts() {
    if (bridgeCoreReady || !isPrimaryOpenFrontHost()) return;
    const baseUrl = getBridgeBaseUrl();
    if (!baseUrl) return;
    for (const scriptPath of CORE_SCRIPTS) {
      await ensureScriptLoaded(scriptPath);
    }
    bridgeCoreReady = CORE_SCRIPTS.every((scriptPath) => loadedScripts.has(scriptPath));
    bridgeAvailable = bridgeCoreReady;
  }

  function neededModuleGroups(settings) {
    const needed = [];
    if (settings.markBotNationsRed) needed.push("botMarkers");
    if (settings.markHoveredAlliesGreen) needed.push("alliances");
    if (settings.showGoldPerMinute || settings.showTeamGoldPerMinute || settings.showTopGoldPerMinute) {
      needed.push("goldPerMinute");
    }
    if (settings.showTradeBalances) needed.push("tradeBalances");
    if (settings.showAttackAmounts) needed.push("attackAmounts");
    if (settings.showNukePrediction) needed.push("nukePrediction");
    if (settings.showBoatPrediction) needed.push("boatPrediction");
    if (settings.showNukeSuggestions || settings.autoNuke) needed.push("nukeSuggestions");
    if (
      settings.showEconomyHeatmap ||
      settings.showExportPartnerHeatmap ||
      settings.showNukeTargetHeatmap
    ) {
      needed.push("heatmaps");
    }
    return needed;
  }

  function hasAnyBridgeFeatureEnabled(settings) {
    if (!settings) return false;
    if (settings.selectiveTradePolicyEnabled || settings.fpsSaver) return true;
    return neededModuleGroups(settings).length > 0;
  }

  async function ensureModulesForSettings(settings) {
    const groups = neededModuleGroups(settings);
    for (const group of groups) {
      const scripts = MODULE_GROUPS[group] || [];
      for (const scriptPath of scripts) {
        await ensureScriptLoaded(scriptPath);
      }
    }
  }

  function hasModule(groupName) {
    const scripts = MODULE_GROUPS[groupName] || [];
    return scripts.length > 0 && scripts.every((scriptPath) => loadedScripts.has(scriptPath));
  }

  function applyBridgeSettings(settings, force = false) {
    if (!bridgeAvailable) return;
    const hasBotMarkers = hasModule("botMarkers");
    const hasAlliances = hasModule("alliances");
    const hasGoldPerMinute = hasModule("goldPerMinute");
    const hasTradeBalances = hasModule("tradeBalances");
    const hasAttackAmounts = hasModule("attackAmounts");
    const hasNukePrediction = hasModule("nukePrediction");
    const hasBoatPrediction = hasModule("boatPrediction");
    const hasNukeSuggestions = hasModule("nukeSuggestions");
    const hasHeatmaps = hasModule("heatmaps");

    const signature = {
      settings,
      modules: {
        bot: hasBotMarkers,
        ally: hasAlliances,
        gpm: hasGoldPerMinute,
        trade: hasTradeBalances,
        atk: hasAttackAmounts,
        nukePred: hasNukePrediction,
        boatPred: hasBoatPrediction,
        nukeSug: hasNukeSuggestions,
        heat: hasHeatmaps,
      },
    };
    const nextSignature = JSON.stringify(signature);
    if (!force && nextSignature === lastSyncSignature) return;
    lastSyncSignature = nextSignature;

    postToPageBridge("APPLY_BRIDGE_SETTINGS", {
      settings,
      modules: {
        botMarkers: hasBotMarkers,
        alliances: hasAlliances,
        goldPerMinute: hasGoldPerMinute,
        tradeBalances: hasTradeBalances,
        attackAmounts: hasAttackAmounts,
        nukePrediction: hasNukePrediction,
        boatPrediction: hasBoatPrediction,
        nukeSuggestions: hasNukeSuggestions,
        heatmaps: hasHeatmaps,
      },
    });
  }

  async function syncBridgeSettings(force = false) {
    if (syncInFlight) {
      syncQueued = true;
      syncQueuedForce = syncQueuedForce || force;
      return;
    }
    syncInFlight = true;
    try {
      const settings = readBridgeSettings();
      if (!bridgeCoreReady && !hasAnyBridgeFeatureEnabled(settings)) return;
      await ensureCoreScripts();
      if (!bridgeAvailable) return;
      await ensureModulesForSettings(settings);
      applyBridgeSettings(settings, force);
    } finally {
      syncInFlight = false;
      if (syncQueued) {
        const nextForce = syncQueuedForce;
        syncQueued = false;
        syncQueuedForce = false;
        void syncBridgeSettings(nextForce);
      }
    }
  }

  function onBridgeMessage(event) {
    if (!event || event.source !== window) return;
    const data = event && event.data;
    if (!data || data.source !== PAGE_SOURCE) return;

    if (data.type === "SELECTIVE_TRADE_POLICY_AVAILABILITY") {
      fn.saveExtensionSetting?.(
        "autoCancelDeniedTradesAvailable",
        Boolean(data.payload && data.payload.available),
      );
      return;
    }

    if (data.type === "CHEATS_AVAILABILITY") {
      fn.saveExtensionSetting?.(
        "cheatsAvailable",
        Boolean(data.payload && data.payload.available),
      );
    }
  }

  fn.initHelperBridge = () => {
    if (!isPrimaryOpenFrontHost()) return;
    if (syncInterval) return;
    window.addEventListener("message", onBridgeMessage);
    window.addEventListener("ofe-settings-updated", () => {
      void syncBridgeSettings(true);
    });
    void syncBridgeSettings(true);
    syncInterval = setInterval(() => {
      if (document.hidden) return;
      void syncBridgeSettings(false);
    }, 15000);
  };
})();
