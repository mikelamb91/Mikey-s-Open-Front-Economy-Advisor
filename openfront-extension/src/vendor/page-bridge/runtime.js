// Shared page-context runtime, constants, and low-level helpers.

const PAGE_SOURCE = "openfront-autojoin-page";
const EXTENSION_SOURCE = "openfront-autojoin-extension";
const BOT_MARKER_CONTAINER_ID = "openfront-helper-bot-marker-layer";
const BOT_MARKER_STYLE_ID = "openfront-helper-bot-marker-styles";
const ALLY_MARKER_CONTAINER_ID = "openfront-helper-ally-marker-layer";
const ALLY_MARKER_STYLE_ID = "openfront-helper-ally-marker-styles";
const ECONOMY_HEATMAP_CONTAINER_ID = "openfront-helper-economy-heatmap-layer";
const ECONOMY_HEATMAP_STYLE_ID = "openfront-helper-economy-heatmap-styles";
const ECONOMY_HEATMAP_CANVAS_CLASS = "openfront-helper-economy-heatmap-canvas";
const EXPORT_PARTNER_HEATMAP_CONTAINER_ID =
  "openfront-helper-export-partner-heatmap-layer";
const EXPORT_PARTNER_HEATMAP_STYLE_ID =
  "openfront-helper-export-partner-heatmap-styles";
const EXPORT_PARTNER_HEATMAP_CANVAS_CLASS =
  "openfront-helper-export-partner-heatmap-canvas";
const NUKE_TARGET_HEATMAP_CONTAINER_ID =
  "openfront-helper-nuke-target-heatmap-layer";
const NUKE_TARGET_HEATMAP_STYLE_ID =
  "openfront-helper-nuke-target-heatmap-styles";
const NUKE_TARGET_HEATMAP_CANVAS_CLASS =
  "openfront-helper-nuke-target-heatmap-canvas";
const HELPER_STATS_CONTAINER_ID = "openfront-helper-stats-container";
const HELPER_STATS_STYLE_ID = "openfront-helper-stats-container-styles";
const GOLD_PER_MINUTE_BADGE_ID = "openfront-helper-gpm-badge";
const GOLD_PER_MINUTE_STYLE_ID = "openfront-helper-gpm-styles";
const TEAM_GOLD_PER_MINUTE_BADGE_ID = "openfront-helper-team-gpm-badge";
const TEAM_GOLD_PER_MINUTE_STYLE_ID = "openfront-helper-team-gpm-styles";
const TOP_GOLD_PER_MINUTE_BADGE_ID = "openfront-helper-top-gpm-badge";
const TOP_GOLD_PER_MINUTE_STYLE_ID = "openfront-helper-top-gpm-styles";
const TRADE_BALANCE_BADGE_ID = "openfront-helper-trade-balance-badge";
const TRADE_BALANCE_STYLE_ID = "openfront-helper-trade-balance-styles";
const ATTACK_AMOUNT_CONTAINER_ID = "openfront-helper-attack-amount-layer";
const ATTACK_AMOUNT_STYLE_ID = "openfront-helper-attack-amount-styles";
const NUKE_LANDING_CONTAINER_ID = "openfront-helper-nuke-landing-layer";
const NUKE_LANDING_STYLE_ID = "openfront-helper-nuke-landing-styles";
const BOAT_LANDING_CONTAINER_ID = "openfront-helper-boat-landing-layer";
const BOAT_LANDING_STYLE_ID = "openfront-helper-boat-landing-styles";
const NUKE_SUGGESTION_CONTAINER_ID = "openfront-helper-nuke-suggestion-layer";
const NUKE_SUGGESTION_STYLE_ID = "openfront-helper-nuke-suggestion-styles";
const NUKE_SUGGESTION_REFRESH_MS = 1800;
const GOLD_PER_MINUTE_SAMPLE_MS = 1000;
const GOLD_PER_MINUTE_WINDOW_MS = 60000;
const ECONOMY_HEATMAP_DRAW_MS = 66;
const ECONOMY_HEATMAP_DATA_REFRESH_MS = 1000;
const ECONOMY_HEATMAP_VIEWPORT_PADDING = 120;
const ECONOMY_HEATMAP_REVENUE_WINDOW_MS = 180000;
const HEATMAP_REFERENCE_ZOOM = 1.8;
const TEAM_COLORS = {
  Red: "#ef4444",
  Blue: "#3b82f6",
  Teal: "#14b8a6",
  Purple: "#a855f7",
  Yellow: "#facc15",
  Orange: "#f97316",
  Green: "#22c55e",
  Humans: "#60a5fa",
  Nations: "#ef4444",
};

let botMarkersEnabled = false;
let botMarkerAnimationFrame = null;
let allyMarkersEnabled = false;
let allyMarkerAnimationFrame = null;
let goldPerMinuteEnabled = false;
let goldPerMinuteInterval = null;
let goldPerMinuteAnimationFrame = null;
let lastGoldPerMinuteSampleAt = 0;
let lastProcessedIncomingGoldTransferTick = null;
let teamGoldPerMinuteEnabled = false;
let teamGoldPerMinuteAnimationFrame = null;
let topGoldPerMinuteEnabled = false;
let topGoldPerMinuteAnimationFrame = null;
let tradeBalancesEnabled = false;
let tradeBalanceAnimationFrame = null;
let lastProcessedTradeBalanceTick = null;
let fpsSaverEnabled = false;
let fpsSaverPatchInstalled = false;
let attackAmountsEnabled = false;
let attackAmountAnimationFrame = null;
let nukePredictionEnabled = false;
let nukeLandingAnimationFrame = null;
let boatPredictionEnabled = false;
let boatLandingAnimationFrame = null;
let nukeSuggestionsEnabled = false;
let nukeSuggestionAnimationFrame = null;
let autoNukeEnabled = false;
let autoNukePatchTimeout = null;
let lastNukeSuggestionComputedAt = 0;
let lastNukeSuggestionSignature = "";
let lastNukeSuggestionSignatureCheckAt = 0;
let currentNukeSuggestionResults = [];
let nukeSuggestionTileComputeKey = null;
let nextAttackAmountPositionRefreshAt = 0;
let attackAmountPositionVersion = 0;
let attackAmountPositionRequestInFlight = false;
let economyHeatmapEnabled = false;
let economyHeatmapAnimationFrame = null;
let lastEconomyHeatmapDrawAt = 0;
let lastEconomyHeatmapDataAt = 0;
let economyHeatmapDataGame = null;
let economyHeatmapSources = [];
let economyHeatmapIntensity = 1;
let exportPartnerHeatmapEnabled = false;
let exportPartnerHeatmapAnimationFrame = null;
let lastExportPartnerHeatmapDrawAt = 0;
let nukeTargetHeatmapEnabled = false;
let nukeTargetHeatmapAnimationFrame = null;
let lastNukeTargetHeatmapDrawAt = 0;
let selectiveTradePolicyEnabled = false;
let selectiveTradePolicyNeedsEmbargoSync = false;
let selectiveTradePolicyMyPlayerId = null;
let lastSelectiveTradePolicyRequestAt = null;
let lastReportedSelectiveTradePolicyAvailability = null;
let lastReportedCheatsAvailability = null;
let lastOpenFrontGameContext = null;

const goldTrackers = new Map();
const incomingGoldTransfers = new Map();
const tradeBalanceTrackers = new Map();
const exportPartnerSourceTrackers = new Map();
const economyRevenueSourceTrackers = new Map();
const factoryPortSpendTrackers = new Map();
const factoryPortUnitTrackers = new Map();
const trainTradeTrackers = new Map();
const tradeShipSourceTrackers = new Map();
const attackAmountPositions = new Map();
const attackAmountBorderTiles = new Map();
const attackAmountBorderTileRequests = new Set();
const autoNukeOriginalRootSubMenus = new Map();
const autoNukeOriginalAttackSubMenus = new Map();
const selectiveTradePolicyAllowedPartnerIds = new Set();
const originalPlayerHasEmbargoMethods = new WeakMap();
const trackedNukeFx = new WeakSet();
const trackedFxArrays = new Set();
const originalArrayConcat = Array.prototype.concat;

function postToExtension(type, payload) {
  window.postMessage(
    {
      source: PAGE_SOURCE,
      type,
      payload,
    },
    "*",
  );
}

// Kept disabled until the extension registers a consumer for this stream.

function toFiniteNumber(value, fallback = 0) {
  const numberValue = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function getUnitLevel(unit) {
  return Math.max(1, toFiniteNumber(unit?.level?.(), 1));
}

function canStationTradeWith(player, otherPlayer) {
  if (!player || !otherPlayer) {
    return false;
  }
  if (getPlayerSmallId(player) === getPlayerSmallId(otherPlayer)) {
    return true;
  }
  return canPlayersTrade(player, otherPlayer);
}

function getHeatmapTypePriority(type) {
  if (type === "Factory") {
    return 4;
  }
  if (type === "Port") {
    return 3;
  }
  if (type === "City") {
    return 2;
  }
  return 1;
}

function addEconomicSource(sources, tile, weight, type = "Industry") {
  if (tile == null || !Number.isFinite(weight) || weight <= 0) {
    return;
  }

  const key = String(tile);
  const existing = sources.find((source) => String(source.tile) === key);
  if (existing) {
    existing.weight += weight;
    if (getHeatmapTypePriority(type) > getHeatmapTypePriority(existing.type)) {
      existing.type = type;
    }
    return;
  }

  sources.push({
    tile,
    weight,
    type,
  });
}
