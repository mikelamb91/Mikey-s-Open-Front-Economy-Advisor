// Attack amount markers for visible troop movements.

  function ensureAttackAmountStyles() {
    if (document.getElementById(ATTACK_AMOUNT_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = ATTACK_AMOUNT_STYLE_ID;
    style.textContent = `
      #${ATTACK_AMOUNT_CONTAINER_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        pointer-events: none;
      }

      #${ATTACK_AMOUNT_CONTAINER_ID} .openfront-helper-attack-amount {
        position: fixed;
        left: var(--attack-x);
        top: var(--attack-y);
        min-width: 38px;
        padding: 3px 7px;
        border: 1px solid rgba(250, 204, 21, 0.58);
        border-radius: 8px;
        background: rgba(7, 12, 18, 0.82);
        box-shadow:
          0 6px 16px rgba(0, 0, 0, 0.36),
          0 0 13px rgba(250, 204, 21, 0.22);
        color: var(--attack-color, #facc15);
        font: 900 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-variant-numeric: tabular-nums;
        text-align: center;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.92);
        transform: translate(-50%, -50%);
        transition:
          left 240ms ease-in-out,
          top 240ms ease-in-out;
        white-space: nowrap;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureAttackAmountContainer() {
    ensureAttackAmountStyles();

    let container = document.getElementById(ATTACK_AMOUNT_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = ATTACK_AMOUNT_CONTAINER_ID;
      container.setAttribute("aria-hidden", "true");
      (document.body || document.documentElement).appendChild(container);
    }
    return container;
  }

  function formatTroopAmount(value) {
    const troopCount = Math.max(0, toFiniteNumber(value) / 10);
    const absValue = Math.abs(troopCount);
    if (absValue >= 10_000_000) {
      return `${(Math.floor(absValue / 100000) / 10).toFixed(1)}M`;
    }
    if (absValue >= 1_000_000) {
      return `${(Math.floor(absValue / 10000) / 100).toFixed(2)}M`;
    }
    if (absValue >= 100_000) {
      return `${Math.floor(absValue / 1000)}K`;
    }
    if (absValue >= 10_000) {
      return `${(Math.floor(absValue / 100) / 10).toFixed(1)}K`;
    }
    if (absValue >= 1_000) {
      return `${(Math.floor(absValue / 10) / 100).toFixed(2)}K`;
    }
    return String(Math.floor(absValue));
  }

  function getPlayerOutgoingAttacks(player) {
    try {
      return Array.from(player?.outgoingAttacks?.() || []).filter(
        (attack) => attack && !attack.retreating,
      );
    } catch (_error) {
      return [];
    }
  }

  function getPlayerIncomingAttacks(player) {
    try {
      return Array.from(player?.incomingAttacks?.() || []).filter(
        (attack) => attack && !attack.retreating,
      );
    } catch (_error) {
      return [];
    }
  }

  function getPlayerBySmallId(players, smallId) {
    const numericSmallId = Number(smallId);
    if (!Number.isFinite(numericSmallId)) {
      return null;
    }

    return players.find((player, index) => {
      try {
        return getPlayerSmallId(player, index) === numericSmallId;
      } catch (_error) {
        return false;
      }
    }) || null;
  }

  function isAttackAmountTargetPlayer(player) {
    if (!player?.isPlayer?.()) {
      return false;
    }

    try {
      const playerType = player?.type?.() ?? player?.data?.playerType;
      return playerType === "HUMAN" || playerType === "NATION";
    } catch (_error) {
      return false;
    }
  }

  function collectAttackAmountRecords(players) {
    const records = new Map();

    for (let playerIndex = 0; playerIndex < players.length; playerIndex++) {
      const player = players[playerIndex];
      if (!player?.isAlive?.()) {
        continue;
      }

      for (const attack of getPlayerOutgoingAttacks(player)) {
        const attackId = String(attack?.id ?? "");
        if (!attackId || records.has(attackId)) {
          continue;
        }
        const target = getPlayerBySmallId(players, attack.targetID);
        if (!isAttackAmountTargetPlayer(target)) {
          continue;
        }
        records.set(attackId, {
          attack,
          attacker: player,
          target,
        });
      }

      for (const attack of getPlayerIncomingAttacks(player)) {
        const attackId = String(attack?.id ?? "");
        if (!attackId || records.has(attackId)) {
          continue;
        }
        if (!isAttackAmountTargetPlayer(player)) {
          continue;
        }
        records.set(attackId, {
          attack,
          attacker: getPlayerBySmallId(players, attack.attackerID),
          target: player,
        });
      }
    }

    return records;
  }

  function requestAttackAmountBorderTiles(player) {
    if (!player?.isPlayer?.()) {
      return;
    }

    const playerId = getPlayerSmallId(player);
    if (!Number.isFinite(playerId) || attackAmountBorderTileRequests.has(playerId)) {
      return;
    }
    if (typeof player?.borderTiles !== "function") {
      return;
    }

    attackAmountBorderTileRequests.add(playerId);
    let borderRequest;
    try {
      borderRequest = Promise.resolve(player.borderTiles());
    } catch (_error) {
      attackAmountBorderTileRequests.delete(playerId);
      return;
    }

    borderRequest
      .then((result) => {
        attackAmountBorderTiles.set(playerId, {
          tiles: Array.from(result?.borderTiles || []),
          updatedAt: performance.now(),
        });
      })
      .catch(() => {})
      .finally(() => {
        attackAmountBorderTileRequests.delete(playerId);
      });
  }

  function refreshAttackAmountBorderTiles(records) {
    const activePlayerIds = new Set();
    for (const record of records.values()) {
      for (const player of [record.attacker, record.target]) {
        if (!player?.isPlayer?.()) {
          continue;
        }
        const playerId = getPlayerSmallId(player);
        if (!Number.isFinite(playerId)) {
          continue;
        }
        activePlayerIds.add(playerId);
        requestAttackAmountBorderTiles(player);
      }
    }

    for (const playerId of attackAmountBorderTiles.keys()) {
      if (!activePlayerIds.has(playerId)) {
        attackAmountBorderTiles.delete(playerId);
      }
    }
  }

  function refreshAttackAmountPositions(players, records) {
    const activeAttackIds = new Set(records.keys());
    if (activeAttackIds.size === 0) {
      attackAmountPositions.clear();
      attackAmountBorderTiles.clear();
      return;
    }

    if (attackAmountPositionRequestInFlight) {
      return;
    }

    const version = ++attackAmountPositionVersion;

    for (const [attackId, entry] of attackAmountPositions.entries()) {
      if (!activeAttackIds.has(attackId) || entry.version < version - 2) {
        attackAmountPositions.delete(attackId);
      }
    }

    attackAmountPositionRequestInFlight = true;
    let pendingRequests = 0;

    function finishRequest() {
      pendingRequests -= 1;
      if (pendingRequests <= 0) {
        attackAmountPositionRequestInFlight = false;
      }
    }

    for (const player of players) {
      if (!player?.isAlive?.() || typeof player.attackClusteredPositions !== "function") {
        continue;
      }

      const hasRelevantAttack = [
        ...getPlayerOutgoingAttacks(player),
        ...getPlayerIncomingAttacks(player),
      ].some((attack) => activeAttackIds.has(String(attack?.id ?? "")));
      if (!hasRelevantAttack) {
        continue;
      }

      pendingRequests += 1;
      let positionRequest;
      try {
        positionRequest = Promise.resolve(player.attackClusteredPositions());
      } catch (_error) {
        finishRequest();
        continue;
      }

      positionRequest
        .then((clusters) => {
          for (const cluster of Array.from(clusters || [])) {
            const attackId = String(cluster?.id ?? "");
            if (!activeAttackIds.has(attackId)) {
              continue;
            }
            attackAmountPositions.set(attackId, {
              positions: Array.from(cluster?.positions || []),
              version,
            });
          }
        })
        .catch(() => {})
        .finally(finishRequest);
    }

    if (pendingRequests === 0) {
      attackAmountPositionRequestInFlight = false;
    }
  }

  function getBorderTilesForPlayer(player) {
    const playerId = getPlayerSmallId(player);
    return Array.from(attackAmountBorderTiles.get(playerId)?.tiles || []);
  }

  function getTilePoint(game, tile) {
    try {
      return {
        x: game.x(tile),
        y: game.y(tile),
      };
    } catch (_error) {
      return null;
    }
  }

  function getAttackBorderFallbackPosition(game, record) {
    const attackerId = getPlayerSmallId(record.attacker);
    const targetId = getPlayerSmallId(record.target);
    if (!Number.isFinite(attackerId) || !Number.isFinite(targetId)) {
      return null;
    }

    const attackerLocation = record.attacker?.nameLocation?.();
    const targetLocation = record.target?.nameLocation?.();
    const reference =
      attackerLocation &&
      targetLocation &&
      Number.isFinite(attackerLocation.x) &&
      Number.isFinite(attackerLocation.y) &&
      Number.isFinite(targetLocation.x) &&
      Number.isFinite(targetLocation.y)
        ? {
            x: (attackerLocation.x + targetLocation.x) / 2,
            y: (attackerLocation.y + targetLocation.y) / 2,
          }
        : null;

    let bestPoint = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    function considerBorderTiles(neighborOwnerId, tiles) {
      for (const tile of tiles) {
        let neighbors = [];
        try {
          neighbors = Array.from(game.neighbors?.(tile) || []);
        } catch (_error) {
          neighbors = [];
        }

        for (const neighbor of neighbors) {
          let ownerId = NaN;
          try {
            ownerId = Number(game.ownerID?.(neighbor));
          } catch (_error) {
            ownerId = NaN;
          }
          if (ownerId !== neighborOwnerId) {
            continue;
          }

          const tilePoint = getTilePoint(game, tile);
          const neighborPoint = getTilePoint(game, neighbor);
          if (!tilePoint || !neighborPoint) {
            continue;
          }

          const point = {
            x: (tilePoint.x + neighborPoint.x) / 2,
            y: (tilePoint.y + neighborPoint.y) / 2,
          };
          const distance = reference
            ? Math.hypot(point.x - reference.x, point.y - reference.y)
            : 0;
          if (distance < bestDistance) {
            bestDistance = distance;
            bestPoint = point;
          }
        }
      }
    }

    considerBorderTiles(targetId, getBorderTilesForPlayer(record.attacker));
    if (!bestPoint) {
      considerBorderTiles(attackerId, getBorderTilesForPlayer(record.target));
    }

    return bestPoint;
  }

  function getAttackMarkerPositions(game, attackId, record) {
    const cached = attackAmountPositions.get(attackId);
    const positions = Array.from(cached?.positions || []);
    if (positions.length > 0) {
      return positions;
    }

    const borderPosition = getAttackBorderFallbackPosition(game, record);
    return borderPosition ? [borderPosition] : [];
  }

  function isAttackTargetingMyPlayer(game, record) {
    try {
      const myPlayer = game?.myPlayer?.();
      if (!myPlayer?.isPlayer?.()) {
        return false;
      }
      return getPlayerSmallId(record.target) === getPlayerSmallId(myPlayer);
    } catch (_error) {
      return false;
    }
  }

  function isNationPlayer(player) {
    try {
      const playerType = player?.type?.() ?? player?.data?.playerType;
      return playerType === "NATION";
    } catch (_error) {
      return false;
    }
  }

  function isAttackFromMyPlayerToNation(game, record) {
    try {
      const myPlayer = game?.myPlayer?.();
      if (!myPlayer?.isPlayer?.()) {
        return false;
      }
      return (
        getPlayerSmallId(record.attacker) === getPlayerSmallId(myPlayer) &&
        isNationPlayer(record.target)
      );
    } catch (_error) {
      return false;
    }
  }

  function getAttackAmountColor(game, record) {
    if (isAttackTargetingMyPlayer(game, record)) {
      return "#ef4444";
    }
    if (isAttackFromMyPlayerToNation(game, record)) {
      return "#22c55e";
    }

    const team = getPlayerTeamName(record.attacker);
    return team ? getTeamColor(team, game) : "#facc15";
  }

  function syncAttackAmountMarkers() {
    if (!attackAmountsEnabled) {
      document.getElementById(ATTACK_AMOUNT_CONTAINER_ID)?.remove();
      attackAmountAnimationFrame = null;
      return;
    }

    const container = ensureAttackAmountContainer();
    const context = getOpenFrontGameContext();
    if (!context?.game || !context?.transform) {
      container.replaceChildren();
      attackAmountAnimationFrame = requestAnimationFrame(syncAttackAmountMarkers);
      return;
    }

    const players = Array.from(context.game.playerViews?.() || []);
    const records = collectAttackAmountRecords(players);
    const now = performance.now();
    if (now >= nextAttackAmountPositionRefreshAt) {
      nextAttackAmountPositionRefreshAt = now + 300;
      refreshAttackAmountPositions(players, records);
      refreshAttackAmountBorderTiles(records);
    }

    const activeIds = new Set();
    for (const [attackId, record] of records.entries()) {
      const attackColor = getAttackAmountColor(context.game, record);
      const positions = getAttackMarkerPositions(context.game, attackId, record);

      for (let positionIndex = 0; positionIndex < positions.length; positionIndex++) {
        const position = positions[positionIndex];
        let screenPos = null;
        try {
          screenPos = context.transform.worldToScreenCoordinates(position);
        } catch (_error) {
          screenPos = null;
        }

        if (
          !Number.isFinite(screenPos?.x) ||
          !Number.isFinite(screenPos?.y) ||
          screenPos.x < -40 ||
          screenPos.y < -40 ||
          screenPos.x > window.innerWidth + 40 ||
          screenPos.y > window.innerHeight + 40
        ) {
          continue;
        }

        const markerId = `${attackId}:${positionIndex}`;
        activeIds.add(markerId);
        let marker = container.querySelector(
          `.openfront-helper-attack-amount[data-attack-id="${escapeCssIdentifier(markerId)}"]`,
        );
        if (!marker) {
          marker = document.createElement("div");
          marker.className = "openfront-helper-attack-amount";
          marker.dataset.attackId = markerId;
          container.appendChild(marker);
        }

        marker.textContent = formatTroopAmount(record.attack.troops);
        marker.style.setProperty("--attack-x", `${screenPos.x}px`);
        marker.style.setProperty("--attack-y", `${screenPos.y}px`);
        marker.style.setProperty("--attack-color", attackColor);
      }
    }

    for (const marker of container.querySelectorAll(".openfront-helper-attack-amount")) {
      if (!activeIds.has(marker.dataset.attackId || "")) {
        marker.remove();
      }
    }

    attackAmountAnimationFrame = requestAnimationFrame(syncAttackAmountMarkers);
  }

  function setAttackAmountsEnabled(enabled) {
    attackAmountsEnabled = Boolean(enabled);
    if (!attackAmountsEnabled) {
      if (attackAmountAnimationFrame !== null) {
        cancelAnimationFrame(attackAmountAnimationFrame);
      }
      attackAmountAnimationFrame = null;
      nextAttackAmountPositionRefreshAt = 0;
      attackAmountPositionVersion = 0;
      attackAmountPositionRequestInFlight = false;
      attackAmountPositions.clear();
      document.getElementById(ATTACK_AMOUNT_CONTAINER_ID)?.remove();
      return;
    }

    if (attackAmountAnimationFrame === null) {
      syncAttackAmountMarkers();
    }
  }

