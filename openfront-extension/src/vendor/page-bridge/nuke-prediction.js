// Enemy nuke prediction: landing markers and blast radius overlay.

  const NUKE_UNIT_TYPES = ["Atom Bomb", "Hydrogen Bomb", "MIRV Warhead"];

  function ensureNukeLandingStyles() {
    if (document.getElementById(NUKE_LANDING_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = NUKE_LANDING_STYLE_ID;
    style.textContent = `
      #${NUKE_LANDING_CONTAINER_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        pointer-events: none;
      }

      #${NUKE_LANDING_CONTAINER_ID} .openfront-helper-nuke-zone {
        position: fixed;
        left: var(--nuke-x);
        top: var(--nuke-y);
        width: var(--nuke-diameter);
        height: var(--nuke-diameter);
        border: 2px dashed rgba(248, 113, 113, 0.92);
        border-radius: 50%;
        background: rgba(127, 29, 29, 0.18);
        box-shadow:
          0 0 18px rgba(248, 113, 113, 0.36),
          inset 0 0 24px rgba(248, 113, 113, 0.18);
        transform: translate(-50%, -50%);
      }

      #${NUKE_LANDING_CONTAINER_ID} .openfront-helper-nuke-zone::before,
      #${NUKE_LANDING_CONTAINER_ID} .openfront-helper-nuke-zone::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        background: rgba(254, 202, 202, 0.94);
        box-shadow: 0 0 10px rgba(248, 113, 113, 0.6);
        transform: translate(-50%, -50%);
      }

      #${NUKE_LANDING_CONTAINER_ID} .openfront-helper-nuke-zone::before {
        width: 28px;
        height: 2px;
      }

      #${NUKE_LANDING_CONTAINER_ID} .openfront-helper-nuke-zone::after {
        width: 2px;
        height: 28px;
      }

      #${NUKE_LANDING_CONTAINER_ID} .openfront-helper-nuke-label {
        position: fixed;
        left: var(--nuke-x);
        top: calc(var(--nuke-y) - var(--nuke-radius) - 10px);
        padding: 4px 8px;
        border: 1px solid rgba(248, 113, 113, 0.52);
        border-radius: 8px;
        background: rgba(7, 12, 18, 0.86);
        color: #fecaca;
        font: 900 11px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.92);
        transform: translate(-50%, -100%);
        white-space: nowrap;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureNukeLandingContainer() {
    ensureNukeLandingStyles();

    let container = document.getElementById(NUKE_LANDING_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = NUKE_LANDING_CONTAINER_ID;
      container.setAttribute("aria-hidden", "true");
      (document.body || document.documentElement).appendChild(container);
    }
    return container;
  }

  function isEnemyNukeUnit(game, unit) {
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

  function getNukeLandingRadius(game, unit) {
    try {
      const magnitude = game?.config?.().nukeMagnitudes?.(unit.type());
      const radius = Number(magnitude?.outer ?? magnitude?.inner);
      if (Number.isFinite(radius) && radius > 0) {
        return radius;
      }
    } catch (_error) {
      // Fall back to the same radii used by OpenFront's nuke FX layer.
    }

    return unit?.type?.() === "Hydrogen Bomb" ? 160 : 70;
  }

  function getNukeLandingScreenRadius(transform, screenPos, worldRadius) {
    const scale = Number(transform?.scale);
    if (Number.isFinite(scale) && scale > 0) {
      return worldRadius * scale;
    }

    try {
      const reference = transform.worldToScreenCoordinates({
        x: screenPos.worldX + worldRadius,
        y: screenPos.worldY,
      });
      const dx = reference.x - screenPos.x;
      const dy = reference.y - screenPos.y;
      return Math.hypot(dx, dy);
    } catch (_error) {
      return worldRadius;
    }
  }

  function syncNukePrediction() {
    if (!nukePredictionEnabled) {
      document.getElementById(NUKE_LANDING_CONTAINER_ID)?.remove();
      nukeLandingAnimationFrame = null;
      return;
    }

    const container = ensureNukeLandingContainer();
    const context = getOpenFrontGameContext();
    if (!context?.game || !context?.transform) {
      container.replaceChildren();
      nukeLandingAnimationFrame = requestAnimationFrame(syncNukePrediction);
      return;
    }

    const activeIds = new Set();
    for (const unit of context.game.units(...NUKE_UNIT_TYPES)) {
      if (!unit?.isActive?.() || !isEnemyNukeUnit(context.game, unit)) {
        continue;
      }

      const targetTile = unit.targetTile?.();
      if (targetTile === undefined) {
        continue;
      }

      const worldX = context.game.x(targetTile);
      const worldY = context.game.y(targetTile);
      let screenPos = null;
      try {
        screenPos = context.transform.worldToScreenCoordinates({ x: worldX, y: worldY });
      } catch (_error) {
        screenPos = null;
      }

      if (
        !Number.isFinite(screenPos?.x) ||
        !Number.isFinite(screenPos?.y) ||
        screenPos.x < -300 ||
        screenPos.y < -300 ||
        screenPos.x > window.innerWidth + 300 ||
        screenPos.y > window.innerHeight + 300
      ) {
        continue;
      }

      const unitId = String(unit.id?.() ?? targetTile);
      activeIds.add(unitId);
      let zone = container.querySelector(
        `.openfront-helper-nuke-zone[data-nuke-id="${escapeCssIdentifier(unitId)}"]`,
      );
      if (!zone) {
        zone = document.createElement("div");
        zone.className = "openfront-helper-nuke-zone";
        zone.dataset.nukeId = unitId;
        container.appendChild(zone);
      }

      let label = container.querySelector(
        `.openfront-helper-nuke-label[data-nuke-id="${escapeCssIdentifier(unitId)}"]`,
      );
      if (!label) {
        label = document.createElement("div");
        label.className = "openfront-helper-nuke-label";
        label.dataset.nukeId = unitId;
        container.appendChild(label);
      }

      const radius = Math.max(
        12,
        getNukeLandingScreenRadius(
          context.transform,
          { ...screenPos, worldX, worldY },
          getNukeLandingRadius(context.game, unit),
        ),
      );
      zone.style.setProperty("--nuke-x", `${screenPos.x}px`);
      zone.style.setProperty("--nuke-y", `${screenPos.y}px`);
      zone.style.setProperty("--nuke-radius", `${radius}px`);
      zone.style.setProperty("--nuke-diameter", `${radius * 2}px`);
      label.style.setProperty("--nuke-x", `${screenPos.x}px`);
      label.style.setProperty("--nuke-y", `${screenPos.y}px`);
      label.style.setProperty("--nuke-radius", `${radius}px`);
      label.textContent = "Enemy nuke";
    }

    for (const marker of container.querySelectorAll("[data-nuke-id]")) {
      if (!activeIds.has(marker.dataset.nukeId || "")) {
        marker.remove();
      }
    }

    nukeLandingAnimationFrame = requestAnimationFrame(syncNukePrediction);
  }

  function setNukePredictionEnabled(enabled) {
    nukePredictionEnabled = Boolean(enabled);
    if (!nukePredictionEnabled) {
      if (nukeLandingAnimationFrame !== null) {
        cancelAnimationFrame(nukeLandingAnimationFrame);
      }
      nukeLandingAnimationFrame = null;
      document.getElementById(NUKE_LANDING_CONTAINER_ID)?.remove();
      return;
    }

    if (nukeLandingAnimationFrame === null) {
      syncNukePrediction();
    }
  }
