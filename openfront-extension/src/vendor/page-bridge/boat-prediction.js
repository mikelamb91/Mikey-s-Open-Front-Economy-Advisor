// Enemy boat prediction: landing markers for transport ships.

  const BOAT_UNIT_TYPES = ["Transport"];
  const BOAT_LANDING_HOVER_RADIUS_PX = 18;
  let boatLandingMouseX = -9999;
  let boatLandingMouseY = -9999;
  let boatMouseListenerInstalled = false;

  function ensureBoatLandingStyles() {
    if (document.getElementById(BOAT_LANDING_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = BOAT_LANDING_STYLE_ID;
    style.textContent = `
      #${BOAT_LANDING_CONTAINER_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        pointer-events: none;
      }

      #${BOAT_LANDING_CONTAINER_ID} .openfront-helper-boat-marker {
        position: fixed;
        left: var(--boat-x);
        top: var(--boat-y);
        width: 20px;
        height: 20px;
        border: 2px solid var(--boat-color);
        border-radius: 50%;
        background: var(--boat-bg);
        box-shadow: 0 0 10px var(--boat-color);
        transform: translate(-50%, -50%);
      }

      #${BOAT_LANDING_CONTAINER_ID} .openfront-helper-boat-marker::before,
      #${BOAT_LANDING_CONTAINER_ID} .openfront-helper-boat-marker::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        background: var(--boat-color);
        transform: translate(-50%, -50%);
      }

      #${BOAT_LANDING_CONTAINER_ID} .openfront-helper-boat-marker::before {
        width: 14px;
        height: 2px;
      }

      #${BOAT_LANDING_CONTAINER_ID} .openfront-helper-boat-marker::after {
        width: 2px;
        height: 14px;
      }

      #${BOAT_LANDING_CONTAINER_ID} .openfront-helper-boat-label {
        position: fixed;
        left: var(--boat-x);
        top: calc(var(--boat-y) - 16px);
        padding: 3px 7px;
        border: 1px solid var(--boat-color);
        border-radius: 8px;
        background: rgba(7, 12, 18, 0.86);
        color: var(--boat-color);
        font: 900 11px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.92);
        transform: translate(-50%, -100%);
        white-space: nowrap;
      }

      @keyframes openfront-helper-boat-highlight-pulse {
        0%, 100% { box-shadow: 0 0 10px var(--boat-color), 0 0 20px var(--boat-color); }
        50% { box-shadow: 0 0 18px var(--boat-color), 0 0 36px var(--boat-color); opacity: 0.7; }
      }

      #${BOAT_LANDING_CONTAINER_ID} .openfront-helper-boat-highlight {
        position: fixed;
        left: var(--boat-x);
        top: var(--boat-y);
        width: 28px;
        height: 28px;
        border: 2.5px solid var(--boat-color);
        border-radius: 50%;
        background: var(--boat-bg);
        box-shadow: 0 0 12px var(--boat-color);
        transform: translate(-50%, -50%);
        animation: openfront-helper-boat-highlight-pulse 1.1s ease-in-out infinite;
      }

      #${BOAT_LANDING_CONTAINER_ID} .openfront-helper-boat-hover-svg {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        overflow: visible;
        pointer-events: none;
      }

      #${BOAT_LANDING_CONTAINER_ID} .openfront-helper-boat-route-polyline {
        fill: none;
        stroke-width: 2;
        stroke-dasharray: 4 3;
        stroke-linecap: round;
        stroke-linejoin: round;
        opacity: 0.75;
      }

    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureBoatLandingContainer() {
    ensureBoatLandingStyles();

    let container = document.getElementById(BOAT_LANDING_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = BOAT_LANDING_CONTAINER_ID;
      container.setAttribute("aria-hidden", "true");
      (document.body || document.documentElement).appendChild(container);
    }
    return container;
  }

  function ensureBoatMouseListener() {
    if (boatMouseListenerInstalled) {
      return;
    }
    boatMouseListenerInstalled = true;
    document.addEventListener(
      "mousemove",
      (e) => {
        boatLandingMouseX = e.clientX;
        boatLandingMouseY = e.clientY;
      },
      { passive: true },
    );
  }

  function ensureBoatHoverLineSvg(container) {
    let svg = container.querySelector(".openfront-helper-boat-hover-svg");
    if (!svg) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.classList.add("openfront-helper-boat-hover-svg");
      svg.setAttribute("aria-hidden", "true");
      container.prepend(svg);
    }
    return svg;
  }

  function getBoatRouteScreenPoints(game, transform, unit, motionPlanUnitId, boatScreenPos, landingScreenPos) {
    const points = [];

    if (boatScreenPos) {
      points.push({ x: boatScreenPos.x, y: boatScreenPos.y });
    }

    try {
      if (Number.isFinite(motionPlanUnitId)) {
        const plan = game?.motionPlans?.()?.get(motionPlanUnitId);
        if (plan?.path && plan.path.length > 0) {
          const path = plan.path;
          const currentTick = Number(game?.ticks?.());
          const elapsed = Number.isFinite(currentTick) ? currentTick - plan.startTick : 0;
          const currentStep = Math.max(
            0,
            Math.min(
              Math.floor(elapsed / Math.max(1, plan.ticksPerStep)),
              path.length - 1,
            ),
          );
          const remainingLength = path.length - currentStep;
          const maxSamples = 40;
          const sampleStep = Math.max(1, Math.floor(remainingLength / maxSamples));

          for (let i = currentStep; i < path.length; i += sampleStep) {
            const pt = toScreenPoint(game, transform, path[i]);
            if (pt) {
              points.push({ x: pt.x, y: pt.y });
            }
          }
        }
      }
    } catch (_error) {
      // Fall back to direct line if route unavailable.
    }

    if (landingScreenPos) {
      points.push({ x: landingScreenPos.x, y: landingScreenPos.y });
    }

    return points;
  }

  function isEnemyBoatUnit(game, unit) {
    const owner = unit?.owner?.();
    const myPlayer = game?.myPlayer?.();
    if (!owner?.isPlayer?.() || !myPlayer?.isPlayer?.()) {
      return false;
    }
    if (owner.smallID?.() === myPlayer.smallID?.()) {
      return false;
    }
    try {
      return !owner.isFriendly?.(myPlayer) && !myPlayer.isFriendly?.(owner);
    } catch (_error) {
      return true;
    }
  }

  function isBoatTargetingMyPlayer(game, targetTile) {
    try {
      const myPlayer = game?.myPlayer?.();
      if (!myPlayer?.isPlayer?.()) {
        return false;
      }
      const ownerId = game.ownerID?.(targetTile);
      return Number(ownerId) === Number(myPlayer.smallID?.());
    } catch (_error) {
      return false;
    }
  }

  function asFiniteTileRef(value) {
    const tile = Number(value);
    return Number.isFinite(tile) ? tile : null;
  }

  function getBoatTargetTile(unit) {
    return asFiniteTileRef(unit?.targetTile?.());
  }

  function getBoatOwnerLabel(unit) {
    const owner = unit?.owner?.();
    if (!owner) {
      return "Unknown";
    }

    let name = "Unknown";
    try {
      name = typeof getPlayerDisplayName === "function"
        ? getPlayerDisplayName(owner)
        : String(owner.displayName?.() ?? owner.name?.() ?? "Unknown");
    } catch (_error) {
      name = "Unknown";
    }

    const compactName = String(name || "Unknown").trim();
    if (compactName.length <= 18) {
      return compactName;
    }
    return `${compactName.slice(0, 17)}...`;
  }

  function toScreenPoint(game, transform, tile) {
    if (tile == null) {
      return null;
    }
    try {
      const worldX = game.x(tile);
      const worldY = game.y(tile);
      const point = transform.worldToScreenCoordinates({ x: worldX, y: worldY });
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
        return null;
      }
      return { x: point.x, y: point.y, worldX, worldY };
    } catch (_error) {
      return null;
    }
  }

  function isNearViewport(point, padding = 220) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
      return false;
    }
    return (
      point.x >= -padding &&
      point.y >= -padding &&
      point.x <= window.innerWidth + padding &&
      point.y <= window.innerHeight + padding
    );
  }

  function syncBoatPrediction() {
    if (!boatPredictionEnabled) {
      document.getElementById(BOAT_LANDING_CONTAINER_ID)?.remove();
      boatLandingAnimationFrame = null;
      return;
    }

    const container = ensureBoatLandingContainer();
    ensureBoatMouseListener();
    const context = getOpenFrontGameContext();
    if (!context?.game || !context?.transform) {
      container.replaceChildren();
      boatLandingAnimationFrame = requestAnimationFrame(syncBoatPrediction);
      return;
    }

    const activeIds = new Set();
    const now = Date.now();
    const transportHoverData = [];

    for (const unit of context.game.units(...BOAT_UNIT_TYPES)) {
      if (!unit?.isActive?.() || !isEnemyBoatUnit(context.game, unit)) {
        continue;
      }

      try {
        if (unit.retreating?.()) {
          continue;
        }
      } catch (_error) {
        // ignore
      }

      const targetTile = getBoatTargetTile(unit);
      if (targetTile === null) {
        continue;
      }

      const screenPos = toScreenPoint(context.game, context.transform, targetTile);
      if (!isNearViewport(screenPos, 200)) {
        continue;
      }

      const targeting = isBoatTargetingMyPlayer(context.game, targetTile);
      const color = targeting ? "rgba(248, 113, 113, 0.95)" : "rgba(250, 204, 21, 0.95)";
      const bg = targeting ? "rgba(127, 29, 29, 0.22)" : "rgba(113, 90, 0, 0.18)";
      const labelText = `${targeting ? "Landing!" : "Landing"} · ${getBoatOwnerLabel(unit)}`;

      const unitId = String(unit.id?.() ?? `${screenPos.worldX}:${screenPos.worldY}`);
      const motionPlanUnitId = Number(unit.id?.());
      const boatTile = asFiniteTileRef(unit?.tile?.());
      const boatScreenPos = toScreenPoint(context.game, context.transform, boatTile);

      transportHoverData.push({
        domUnitId: unitId,
        motionPlanUnitId: Number.isFinite(motionPlanUnitId) ? motionPlanUnitId : null,
        unit,
        landingScreenPos: screenPos,
        boatScreenPos,
        color,
        bg,
      });

      activeIds.add(`${unitId}-marker`);
      activeIds.add(`${unitId}-label`);

      let marker = container.querySelector(
        `.openfront-helper-boat-marker[data-boat-id="${escapeCssIdentifier(`${unitId}-marker`)}"]`,
      );
      if (!marker) {
        marker = document.createElement("div");
        marker.className = "openfront-helper-boat-marker";
        marker.dataset.boatId = `${unitId}-marker`;
        container.appendChild(marker);
      }

      let label = container.querySelector(
        `.openfront-helper-boat-label[data-boat-id="${escapeCssIdentifier(`${unitId}-label`)}"]`,
      );
      if (!label) {
        label = document.createElement("div");
        label.className = "openfront-helper-boat-label";
        label.dataset.boatId = `${unitId}-label`;
        container.appendChild(label);
      }

      marker.style.setProperty("--boat-x", `${screenPos.x}px`);
      marker.style.setProperty("--boat-y", `${screenPos.y}px`);
      marker.style.setProperty("--boat-color", color);
      marker.style.setProperty("--boat-bg", bg);
      label.style.setProperty("--boat-x", `${screenPos.x}px`);
      label.style.setProperty("--boat-y", `${screenPos.y}px`);
      label.style.setProperty("--boat-color", color);
      label.textContent = labelText;
    }

    // Hover: highlight the boat and show its route when hovering a landing marker.
    const routeSvg = ensureBoatHoverLineSvg(container);
    let hoveredTransport = null;
    for (const data of transportHoverData) {
      const dx = data.landingScreenPos.x - boatLandingMouseX;
      const dy = data.landingScreenPos.y - boatLandingMouseY;
      if (Math.hypot(dx, dy) <= BOAT_LANDING_HOVER_RADIUS_PX) {
        hoveredTransport = data;
        break;
      }
    }

    if (hoveredTransport) {
      const { domUnitId, motionPlanUnitId, unit, landingScreenPos, boatScreenPos, color, bg } = hoveredTransport;
      const routePoints = getBoatRouteScreenPoints(
        context.game,
        context.transform,
        unit,
        motionPlanUnitId,
        boatScreenPos,
        landingScreenPos,
      );

      if (boatScreenPos) {
        const highlightId = `${domUnitId}-highlight`;
        activeIds.add(highlightId);
        let highlight = container.querySelector(
          `.openfront-helper-boat-highlight[data-boat-id="${escapeCssIdentifier(highlightId)}"]`,
        );
        if (!highlight) {
          highlight = document.createElement("div");
          highlight.className = "openfront-helper-boat-highlight";
          highlight.dataset.boatId = highlightId;
          container.appendChild(highlight);
        }
        highlight.style.setProperty("--boat-x", `${boatScreenPos.x}px`);
        highlight.style.setProperty("--boat-y", `${boatScreenPos.y}px`);
        highlight.style.setProperty("--boat-color", color);
        highlight.style.setProperty("--boat-bg", bg);
      }

      if (routePoints.length >= 2) {
        const routeId = `${domUnitId}-route`;
        activeIds.add(routeId);
        let routeLine = routeSvg.querySelector(
          `.openfront-helper-boat-route-polyline[data-boat-id="${escapeCssIdentifier(routeId)}"]`,
        );
        if (!routeLine) {
          routeLine = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
          routeLine.classList.add("openfront-helper-boat-route-polyline");
          routeLine.dataset.boatId = routeId;
          routeSvg.appendChild(routeLine);
        }
        routeLine.setAttribute("points", routePoints.map((p) => `${p.x},${p.y}`).join(" "));
        routeLine.style.stroke = color;
        routeLine.style.filter = `drop-shadow(0 0 4px ${color})`;
      }
    }

    for (const el of container.querySelectorAll("[data-boat-id]")) {
      if (!activeIds.has(el.dataset.boatId || "")) {
        el.remove();
      }
    }

    boatLandingAnimationFrame = requestAnimationFrame(syncBoatPrediction);
  }

  function setBoatPredictionEnabled(enabled) {
    boatPredictionEnabled = Boolean(enabled);
    if (!boatPredictionEnabled) {
      if (boatLandingAnimationFrame !== null) {
        cancelAnimationFrame(boatLandingAnimationFrame);
      }
      boatLandingAnimationFrame = null;
      document.getElementById(BOAT_LANDING_CONTAINER_ID)?.remove();
      return;
    }

    if (boatLandingAnimationFrame === null) {
      syncBoatPrediction();
    }
  }
