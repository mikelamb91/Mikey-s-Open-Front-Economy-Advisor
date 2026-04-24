// Bot marker overlay for nation AI players.

  function ensureBotMarkerStyles() {
    if (document.getElementById(BOT_MARKER_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = BOT_MARKER_STYLE_ID;
    style.textContent = `
      #${BOT_MARKER_CONTAINER_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        pointer-events: none;
      }

      #${BOT_MARKER_CONTAINER_ID} .openfront-helper-bot-dot {
        position: fixed;
        width: 13px;
        height: 13px;
        margin: -6.5px 0 0 -6.5px;
        border-radius: 50%;
        background: rgba(239, 68, 68, 0.68);
        box-shadow:
          0 0 0 2px rgba(127, 29, 29, 0.34),
          0 0 10px rgba(239, 68, 68, 0.72);
        transform: translate(var(--bot-x), var(--bot-y));
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureBotMarkerContainer() {
    ensureBotMarkerStyles();

    let container = document.getElementById(BOT_MARKER_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = BOT_MARKER_CONTAINER_ID;
      (document.body || document.documentElement).appendChild(container);
    }
    return container;
  }

  function syncBotMarkers() {
    if (!botMarkersEnabled) {
      document.getElementById(BOT_MARKER_CONTAINER_ID)?.remove();
      botMarkerAnimationFrame = null;
      return;
    }

    const context = getOpenFrontGameContext();
    const container = ensureBotMarkerContainer();
    if (!context) {
      container.replaceChildren();
      botMarkerAnimationFrame = requestAnimationFrame(syncBotMarkers);
      return;
    }

    const activeIds = new Set();
    const players = Array.from(context.game.playerViews?.() || []);

    for (let index = 0; index < players.length; index++) {
      const player = players[index];
      if (!isNationBotPlayer(player) || !player?.isAlive?.()) {
        continue;
      }

      const nameLocation = player.nameLocation?.();
      if (!nameLocation) {
        continue;
      }

      const screenPos = context.transform.worldToScreenCoordinates(nameLocation);
      if (
        !Number.isFinite(screenPos?.x) ||
        !Number.isFinite(screenPos?.y) ||
        screenPos.x < -30 ||
        screenPos.y < -30 ||
        screenPos.x > window.innerWidth + 30 ||
        screenPos.y > window.innerHeight + 30
      ) {
        continue;
      }

      const markerId = getPlayerMarkerId(player, index);
      activeIds.add(markerId);

      let marker = container.querySelector(
        `.openfront-helper-bot-dot[data-bot-id="${escapeCssIdentifier(markerId)}"]`,
      );
      if (!marker) {
        marker = document.createElement("div");
        marker.className = "openfront-helper-bot-dot";
        marker.dataset.botId = markerId;
        container.appendChild(marker);
      }

      marker.style.setProperty("--bot-x", `${screenPos.x}px`);
      marker.style.setProperty("--bot-y", `${screenPos.y}px`);
    }

    for (const marker of container.querySelectorAll(".openfront-helper-bot-dot")) {
      if (!activeIds.has(marker.dataset.botId || "")) {
        marker.remove();
      }
    }

    botMarkerAnimationFrame = requestAnimationFrame(syncBotMarkers);
  }

  function setBotMarkersEnabled(enabled) {
    botMarkersEnabled = Boolean(enabled);
    if (!botMarkersEnabled) {
      if (botMarkerAnimationFrame !== null) {
        cancelAnimationFrame(botMarkerAnimationFrame);
      }
      botMarkerAnimationFrame = null;
      document.getElementById(BOT_MARKER_CONTAINER_ID)?.remove();
      return;
    }

    if (botMarkerAnimationFrame === null) {
      syncBotMarkers();
    }
  }

