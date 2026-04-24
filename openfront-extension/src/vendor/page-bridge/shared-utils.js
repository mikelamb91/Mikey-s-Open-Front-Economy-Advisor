// Shared player, team, overlay, and formatting helpers used across bridge features.

function normalizeEconomyHeatmapIntensity(value) {
  const intensity = Number(value);
  if (!Number.isFinite(intensity)) {
    return 1;
  }
  return Math.max(0, Math.min(2, Math.round(intensity)));
}

function escapeCssIdentifier(value) {
  if (globalThis.CSS?.escape) {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function getPlayerSmallId(player, fallbackIndex = 0) {
  try {
    return Number(player?.smallID?.() ?? player?.data?.smallID ?? fallbackIndex);
  } catch (_error) {
    return Number(fallbackIndex);
  }
}

function getPlayerDisplayName(player) {
  try {
    return String(
      player?.displayName?.() ??
        player?.name?.() ??
        player?.data?.displayName ??
        player?.data?.name ??
        "Unknown",
    );
  } catch (_error) {
    return "Unknown";
  }
}

function getPlayerTeamName(player) {
  try {
    const team = player?.team?.();
    return team == null ? null : String(team);
  } catch (_error) {
    return null;
  }
}

function getTeamColor(team, game = null) {
  if (team != null && game?.config?.().theme?.().teamColor) {
    try {
      const color = game.config().theme().teamColor(String(team));
      const hex = color?.toHex?.();
      if (hex) {
        return hex;
      }
    } catch (_error) {
      // Fall back to the local palette when the game theme is unavailable.
    }
  }

  const teamKey = String(team ?? "");
  const normalizedKey = teamKey.trim().toLowerCase();
  const directMatch = Object.entries(TEAM_COLORS).find(
    ([name]) => name.toLowerCase() === normalizedKey,
  );
  if (directMatch) {
    return directMatch[1];
  }

  return TEAM_COLORS[teamKey] || "#4ade80";
}

function getTeamColorBackground(team, game = null) {
  const color = getTeamColor(team, game);
  return `${color}2b`;
}

function isNationBotPlayer(player) {
  try {
    const playerType = player?.type?.() ?? player?.data?.playerType;
    return playerType === "NATION";
  } catch (_error) {
    return false;
  }
}

function getPlayerMarkerId(player, fallbackIndex) {
  try {
    return String(
      player?.id?.() ??
        player?.smallID?.() ??
        player?.data?.id ??
        player?.displayName?.() ??
        fallbackIndex,
    );
  } catch (_error) {
    return String(fallbackIndex);
  }
}

function getPlayerGoldNumber(player) {
  try {
    const gold = player?.gold?.();
    if (typeof gold === "bigint") {
      return Number(gold);
    }
    return Number(gold);
  } catch (_error) {
    return NaN;
  }
}

let _cachedInfoOverlayEl = null;

function getHoveredPlayerInfoOverlay() {
  if (!_cachedInfoOverlayEl?.isConnected) {
    _cachedInfoOverlayEl = document.querySelector("player-info-overlay") ?? null;
  }
  const overlay = _cachedInfoOverlayEl;
  if (!overlay?.player) {
    return null;
  }

  const visible = overlay._isInfoVisible ?? overlay.isInfoVisible;
  if (visible === false) {
    return null;
  }

  return overlay;
}

function getPlayerInfoPanelRect(overlay) {
  const panel =
    overlay.querySelector('[class*="bg-gray-800"]') ??
    overlay.querySelector('[class*="backdrop-blur"]') ??
    overlay;
  const rect = panel.getBoundingClientRect?.();
  if (rect && (rect.width > 0 || rect.height > 0)) {
    return rect;
  }

  return null;
}

function normalizeTradeName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findPlayerByTradeName(players, name) {
  const normalizedName = normalizeTradeName(name);
  if (!normalizedName) {
    return null;
  }

  return (
    players.find(
      (player) => normalizeTradeName(getPlayerDisplayName(player)) === normalizedName,
    ) ?? players.find((player) => normalizeTradeName(player?.name?.()) === normalizedName) ?? null
  );
}
