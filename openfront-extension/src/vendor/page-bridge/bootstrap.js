// Final message routing and bridge startup.

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    const data = event.data;
    if (!data || data.source !== EXTENSION_SOURCE) {
      return;
    }

    if (data.type === "JOIN_PUBLIC_LOBBY" && data.payload?.gameID) {
      document.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: data.payload.gameID,
            source: "public",
            publicLobbyInfo: data.payload.publicLobbyInfo,
          },
          bubbles: true,
          composed: true,
        }),
      );
    }

    if (data.type === "APPLY_BRIDGE_SETTINGS") {
      const settings = data.payload?.settings || {};
      const modules = data.payload?.modules || {};
      if (modules.botMarkers) {
        setBotMarkersEnabled(settings.markBotNationsRed);
      }
      if (modules.goldPerMinute) {
        setGoldPerMinuteEnabled(settings.showGoldPerMinute);
        setTeamGoldPerMinuteEnabled(settings.showTeamGoldPerMinute);
        setTopGoldPerMinuteEnabled(settings.showTopGoldPerMinute);
      }
      if (modules.alliances) {
        setAllyMarkersEnabled(settings.markHoveredAlliesGreen);
      }
      if (modules.tradeBalances) {
        setTradeBalancesEnabled(settings.showTradeBalances);
      }
      setFpsSaverEnabled(settings.fpsSaver);
      setSelectiveTradePolicyEnabled(Boolean(settings.selectiveTradePolicyEnabled));
      if (modules.attackAmounts) {
        setAttackAmountsEnabled(settings.showAttackAmounts);
      }
      if (modules.nukePrediction) {
        setNukePredictionEnabled(settings.showNukePrediction);
      }
      if (modules.boatPrediction) {
        setBoatPredictionEnabled(settings.showBoatPrediction);
      }
      if (modules.nukeSuggestions) {
        setNukeSuggestionsEnabled(settings.showNukeSuggestions);
        setAutoNukeEnabled(settings.autoNuke, settings.autoNukeIncludeAllies);
      }
      if (modules.heatmaps) {
        setEconomyHeatmapIntensity(settings.economyHeatmapIntensity);
        setEconomyHeatmapEnabled(settings.showEconomyHeatmap);
        setExportPartnerHeatmapEnabled(settings.showExportPartnerHeatmap);
        setNukeTargetHeatmapEnabled(settings.showNukeTargetHeatmap);
      }
      return;
    }

    if (data.type === "MARK_BOT_NATIONS_RED") {
      setBotMarkersEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_GOLD_PER_MINUTE") {
      setGoldPerMinuteEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_TEAM_GOLD_PER_MINUTE") {
      setTeamGoldPerMinuteEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_TOP_GOLD_PER_MINUTE") {
      setTopGoldPerMinuteEnabled(data.payload?.enabled);
    }

    if (data.type === "MARK_HOVERED_ALLIES_GREEN") {
      setAllyMarkersEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_TRADE_BALANCES") {
      setTradeBalancesEnabled(data.payload?.enabled);
    }

    if (data.type === "SET_FPS_SAVER") {
      setFpsSaverEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_ATTACK_AMOUNTS") {
      setAttackAmountsEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_NUKE_PREDICTION") {
      setNukePredictionEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_BOAT_PREDICTION") {
      setBoatPredictionEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_NUKE_SUGGESTIONS") {
      setNukeSuggestionsEnabled(data.payload?.enabled);
    }

    if (data.type === "SET_AUTO_NUKE") {
      setAutoNukeEnabled(data.payload?.enabled, data.payload?.includeAllies);
    }

    if (data.type === "SHOW_ECONOMY_HEATMAP") {
      setEconomyHeatmapIntensity(data.payload?.intensity);
      setEconomyHeatmapEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_EXPORT_PARTNER_HEATMAP") {
      setExportPartnerHeatmapEnabled(data.payload?.enabled);
    }

    if (data.type === "SHOW_NUKE_TARGET_HEATMAP") {
      setNukeTargetHeatmapEnabled(data.payload?.enabled);
    }

    if (data.type === "APPLY_SELECTIVE_TRADE_POLICY") {
      const requestedAt = Number(data.payload?.requestedAt);
      if (Number.isFinite(requestedAt) && requestedAt !== lastSelectiveTradePolicyRequestAt) {
        lastSelectiveTradePolicyRequestAt = requestedAt;
        applySelectiveTradePolicy();
      }
    }

    if (data.type === "SET_SELECTIVE_TRADE_POLICY") {
      setSelectiveTradePolicyEnabled(Boolean(data.payload?.enabled));
    }
  });

  window.setInterval(() => {
    if (typeof refreshBridgeAvailability === "function") {
      refreshBridgeAvailability();
      return;
    }
    refreshSelectiveTradePolicyAvailability();
    refreshCheatsAvailability();
  }, 1500);
  if (typeof refreshBridgeAvailability === "function") {
    refreshBridgeAvailability();
  } else {
    refreshSelectiveTradePolicyAvailability();
    refreshCheatsAvailability();
  }

  window.__openfrontAutoJoinBridgeReady = true;
