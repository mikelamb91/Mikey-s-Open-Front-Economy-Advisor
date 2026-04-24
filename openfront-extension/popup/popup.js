"use strict";

(() => {
  const SOUND_KEYS = [
    ["spawnEntry", "Spawn phase"],
    ["gameStart", "Game start"],
    ["boatLanding", "Boat landing"],
    ["boatDestroyed", "Boat destroyed"],
    ["warshipDestroyed", "Warship destroyed"],
    ["neighborSleeping", "Neighbor sleeping"],
    ["neighborTraitor", "Neighbor traitor"],
    ["nukeInbound", "Atom nuke"],
    ["hydrogenInbound", "Hydrogen bomb"],
    ["mirvInbound", "MIRV"],
  ];

  const HELPER_KEYS = [
    ["markBotNationsRed", "Mark bot nations red"],
    ["markHoveredAlliesGreen", "Alliances"],
    ["fpsSaver", "FPS saver"],
    ["showAttackAmounts", "Attack amounts"],
    ["showNukePrediction", "Nuke prediction"],
    ["showBoatPrediction", "Boat prediction"],
    ["showGoldPerMinute", "Gold per minute"],
    ["showTeamGoldPerMinute", "Team GPM"],
    ["showTopGoldPerMinute", "Top 10 GPM"],
    ["showTradeBalances", "Trade balances"],
    ["selectiveTradePolicyEnabled", "Auto-cancel denied trades"],
    ["showNukeSuggestions", "Nuke suggestions"],
    ["autoNuke", "Auto nuke"],
    ["autoNukeIncludeAllies", "Auto nuke includes allies"],
    ["showEconomyHeatmap", "Economic heatmap"],
    ["showExportPartnerHeatmap", "Export partner heatmap"],
    ["showNukeTargetHeatmap", "Nuke target heatmap"],
    ["showSignalDock", "Always-on signal dock"],
    ["showEconomyAdvisorPanel", "Economy advisor panel"],
  ];

  let activeTabId = null;
  let activeState = null;
  let patchTimer = null;
  let pendingPatch = null;

  function notice(text) {
    const el = document.getElementById("statusNotice");
    if (el) el.textContent = text;
  }

  function isOpenFrontUrl(url) {
    const raw = String(url || "").toLowerCase();
    return (
      raw.startsWith("https://openfront.io/") ||
      raw.startsWith("https://www.openfront.io/") ||
      raw.startsWith("https://openfront.dev/") ||
      raw.startsWith("https://www.openfront.dev/") ||
      raw.includes(".openfront.dev/")
    );
  }

  function makeToggle(container, key, label, value, onChange) {
    const row = document.createElement("label");
    row.className = "toggle-row";
    row.innerHTML = `<span>${label}</span><input type="checkbox">`;
    const input = row.querySelector("input");
    input.checked = Boolean(value);
    input.addEventListener("change", () => onChange(Boolean(input.checked)));
    container.appendChild(row);
  }

  async function queryActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs.length > 0 ? tabs[0] : null;
  }

  async function sendToTab(type, payload) {
    if (activeTabId == null) return null;
    try {
      return await chrome.tabs.sendMessage(activeTabId, { type, payload });
    } catch {
      return null;
    }
  }

  async function refreshState() {
    const response = await sendToTab("OFE_POPUP_GET_STATE");
    if (!response || !response.ok || !response.state) {
      activeState = null;
      notice("Could not read OFE settings from this tab.");
      return;
    }
    activeState = response.state;
    const host = activeState.host || "unknown";
    notice(`Connected: ${host}`);
    renderState();
  }

  async function sendPatchNow() {
    if (!activeState || !pendingPatch) return;
    const payload = pendingPatch;
    pendingPatch = null;
    const response = await sendToTab("OFE_POPUP_PATCH_STATE", payload);
    if (response && response.ok && response.state) {
      activeState = response.state;
      renderState();
      return;
    }
    notice("Failed to save changes in page storage.");
  }

  function queuePatch(key, value) {
    pendingPatch = { key, value };
    if (patchTimer) window.clearTimeout(patchTimer);
    patchTimer = window.setTimeout(() => {
      patchTimer = null;
      void sendPatchNow();
    }, 140);
  }

  function renderState() {
    if (!activeState) return;

    const rules = activeState.rules || {};
    const settings = activeState.settings || {};

    const autojoinEnabled = document.getElementById("autojoinEnabled");
    const autojoinSound = document.getElementById("autojoinSound");
    const companionHint = document.getElementById("companionHint");
    const heatmapIntensity = document.getElementById("heatmapIntensity");
    const helperSection = document.getElementById("helperToggles")?.closest(".section");

    autojoinEnabled.checked = Boolean(rules.enabled);
    autojoinSound.checked = Boolean(rules.sound);
    heatmapIntensity.value = String(
      Number.isFinite(Number(settings.economyHeatmapIntensity))
        ? Math.max(0, Math.min(2, Math.round(Number(settings.economyHeatmapIntensity))))
        : 1,
    );

    const companionEligible = Boolean(activeState.companionEligible);
    companionHint.textContent = companionEligible
      ? "Bundled helper modules are active on this host."
      : "Helper controls are only active on openfront.io/openfront.dev hosts.";
    if (helperSection) {
      helperSection.classList.toggle("disabled", !companionEligible);
    }

    const soundContainer = document.getElementById("soundToggles");
    const helperContainer = document.getElementById("helperToggles");
    soundContainer.innerHTML = "";
    helperContainer.innerHTML = "";

    for (const [key, label] of SOUND_KEYS) {
      makeToggle(soundContainer, key, label, settings[key], (next) => {
        activeState.settings[key] = next;
        queuePatch(`settings.${key}`, next);
      });
    }

    for (const [key, label] of HELPER_KEYS) {
      makeToggle(helperContainer, key, label, settings[key], (next) => {
        activeState.settings[key] = next;
        queuePatch(`settings.${key}`, next);
      });
    }
  }

  function bindStaticControls() {
    document.getElementById("autojoinEnabled").addEventListener("change", (event) => {
      if (!activeState) return;
      activeState.rules.enabled = Boolean(event.currentTarget.checked);
      queuePatch("rules.enabled", activeState.rules.enabled);
    });

    document.getElementById("autojoinSound").addEventListener("change", (event) => {
      if (!activeState) return;
      activeState.rules.sound = Boolean(event.currentTarget.checked);
      queuePatch("rules.sound", activeState.rules.sound);
    });

    document.getElementById("heatmapIntensity").addEventListener("change", (event) => {
      if (!activeState) return;
      const next = Number(event.currentTarget.value);
      activeState.settings.economyHeatmapIntensity = Number.isFinite(next)
        ? Math.max(0, Math.min(2, Math.round(next)))
        : 1;
      queuePatch(
        "settings.economyHeatmapIntensity",
        activeState.settings.economyHeatmapIntensity,
      );
    });
  }

  async function init() {
    const tab = await queryActiveTab();
    if (!tab || tab.id == null || !isOpenFrontUrl(tab.url || "")) {
      notice("Open an OpenFront tab and keep it active to control settings.");
      return;
    }

    activeTabId = tab.id;
    bindStaticControls();
    await refreshState();
  }

  void init();
})();
