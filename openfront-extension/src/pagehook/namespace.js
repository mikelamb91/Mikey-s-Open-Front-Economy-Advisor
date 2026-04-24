"use strict";

(() => {
  const ns = (window.__OFE = window.__OFE || {});

  ns.constants = ns.constants || {};
  ns.fn = ns.fn || {};

  if (!ns.state) {
    ns.state = {
      // Worker-derived runtime game state
      playerTypeById: {},
      myPlayerTroops: 0,
      myClientID: null,
      playerTroopsById: {},
      clientIDToPlayerID: {},
      mapWidth: 0,
      mapHeight: 0,
      myTilesSet: new Set(),
      myTilesVersion: 0,

      // Pointer position for hover-driven shortcuts
      lastMouseX: window.innerWidth / 2,
      lastMouseY: window.innerHeight / 2,

      // Search overlays
      chatSearchState: null,
      chatSearchWatch: null,
      emojiSearchState: null,
      emojiSearchWatch: null,

      // Network/socket tracking
      latestGameSocket: null,
      overrideNextBoat: false,
      boatDispatching: false,
      lastBoatLandingSoundTick: -1,
      lastBoatDestroyedSoundTick: -1,
      lastWarshipDestroyedSoundTick: -1,
      lastMirvInboundSoundTick: -1,
      lastNukeInboundSoundTick: -1,
      lastHydrogenInboundSoundTick: -1,

      // Territory cycle
      territoryCycleIndex: 0,

      // Info panel
      shortcutPanelState: null,
      shortcutPanelWatch: null,
      extensionSettingsTabActive: false,
      extensionSettingsCache: null,

      // Neighbor status monitor
      neighborWatchInterval: null,
      neighborWatchBusy: false,
      neighborStatusById: {},

      // Throttled notifications
      lastShortcutWarnAt: {},

      // Game phase tracking
      gamePhase: "none",

      // Always-on helper signal counters
      signalStats: {
        boatLanded: 0,
        boatDestroyed: 0,
        warshipDestroyed: 0,
        mirvInbound: 0,
        nukeInbound: 0,
        hydrogenInbound: 0,
        lastEventTick: 0,
        lastEventAt: 0,
      },
      strategicSnapshot: null,
      perf: {},
    };
  }

  ns._phaseListeners = ns._phaseListeners || [];
})();
