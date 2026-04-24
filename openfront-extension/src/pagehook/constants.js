"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  ns.constants.SHORTCUT_PANEL_VISIBLE_KEY = "ofe.shortcuts.panel.visible";

  // Values from OpenFront MessageType enum.
  ns.constants.MESSAGE_TYPE = {
    MIRV_INBOUND: 4,
    NUKE_INBOUND: 5,
    HYDROGEN_BOMB_INBOUND: 6,
    NAVAL_INVASION_INBOUND: 7,
    ALLIANCE_REQUEST: 15,
    UNIT_DESTROYED: 12,
    CHAT: 23,
  };

  ns.constants.GAME_UPDATE_TYPE = {
    UNIT: 1,
    DISPLAY_EVENT: 3,
    UNIT_INCOMING: 14,
  };

  ns.constants.EXT_SHORTCUTS = {
    chatSearch: {
      action: "chatSearch",
      label: "Chat Search",
      desc: "Hovered player chat + search",
      defaultCode: "KeyZ",
    },
    emojiSearch: {
      action: "emojiSearch",
      label: "Emoji Search",
      desc: "Emoji selector + search",
      defaultCode: "KeyX",
    },
    allianceRequest: {
      action: "allianceRequest",
      label: "Alliance Request",
      desc: "Send alliance request to hovered player",
      defaultCode: "KeyV",
    },
    boatOnePercent: {
      action: "boatOnePercent",
      label: "Boat 1%",
      desc: "Boat attack with fixed 1% troops",
      defaultCode: "KeyN",
    },
    territoryCycle: {
      action: "territoryCycle",
      label: "Mini Territories",
      desc: "Jump camera between disconnected mini territories (100 tiles or fewer)",
      defaultCode: "KeyL",
    },
  };

  ns.constants.EXT_SOUND_SETTINGS = {
    spawnEntry: {
      label: "OFE: Spawn Phase",
      desc: "Play a short chime when spawn phase begins.",
    },
    gameStart: {
      label: "OFE: Game Start",
      desc: "Play a short chime when the match starts.",
    },
    boatLanding: {
      label: "OFE: Boat Landing",
      desc: "Play a harbor bell when one of your transport ships lands.",
    },
    boatDestroyed: {
      label: "OFE: Boat Destroyed",
      desc: "Play a splash-like alert when one of your transport ships is destroyed.",
    },
    warshipDestroyed: {
      label: "OFE: Warship Destroyed",
      desc: "Play a heavy horn when one of your warships is destroyed.",
    },
    neighborSleeping: {
      label: "OFE: Neighbor Sleeping",
      desc: "Play a soft drooping alert when a neighboring player falls asleep.",
    },
    neighborTraitor: {
      label: "OFE: Neighbor Traitor",
      desc: "Play a sharp warning when a neighboring player betrays and becomes traitor.",
    },
    nukeInbound: {
      label: "OFE: Atom Nuke",
      desc: "Play an air-raid warning when an atom bomb is inbound.",
    },
    hydrogenInbound: {
      label: "OFE: Hydrogen Bomb",
      desc: "Play a deeper long-form alarm when a hydrogen bomb is inbound.",
    },
    mirvInbound: {
      label: "OFE: MIRV",
      desc: "Play the highest-urgency alarm when a MIRV is inbound.",
    },
  };

  ns.constants.EXT_HELPER_SETTINGS = {
    markBotNationsRed: {
      label: "Mark bot nations red",
      desc: "Adds red markers to nation AI names on the map.",
    },
    markHoveredAlliesGreen: {
      label: "Alliances",
      desc: "Highlights allied nations and alliance timing context.",
    },
    fpsSaver: {
      label: "FPS Saver",
      desc: "Disables nuke explosion effects to reduce lag spikes.",
    },
    showAttackAmounts: {
      label: "Attack amounts",
      desc: "Shows estimated troops used when players attack.",
    },
    showNukePrediction: {
      label: "Nuke prediction",
      desc: "Shows predicted nuke landing positions and blast radius.",
    },
    showBoatPrediction: {
      label: "Boat prediction",
      desc: "Shows likely enemy boat landing paths and target hints.",
    },
    showGoldPerMinute: {
      label: "Gold per minute",
      desc: "Adds a per-player GPM indicator to hover information.",
    },
    showTeamGoldPerMinute: {
      label: "Team gold per minute",
      desc: "Shows aggregate team economy in team matches.",
    },
    showTopGoldPerMinute: {
      label: "Top 10 gold per minute",
      desc: "Shows the highest observed GPM players.",
    },
    showTradeBalances: {
      label: "Trade balances",
      desc: "Tracks and displays observed imports and exports.",
    },
    selectiveTradePolicyEnabled: {
      label: "Auto-cancel denied trades",
      desc: "Automatically denies trades outside allowed partners when available.",
    },
    showNukeSuggestions: {
      label: "Nuke suggestions (solo/custom)",
      desc: "Shows suggested high-impact nuke targets.",
    },
    autoNuke: {
      label: "Auto nuke (solo/custom)",
      desc: "Adds automated nuke actions in supported game modes.",
    },
    autoNukeIncludeAllies: {
      label: "Auto nuke includes allies",
      desc: "Allows auto nuke planning to include allied territory targets.",
    },
    showEconomyHeatmap: {
      label: "Economic heatmap",
      desc: "Highlights structures with observed economic value.",
    },
    showExportPartnerHeatmap: {
      label: "Export partner heatmap",
      desc: "Highlights partner industries that support exports.",
    },
    showNukeTargetHeatmap: {
      label: "Nuke target heatmap",
      desc: "Highlights likely high-value nuke targets.",
    },
    showSignalDock: {
      label: "Always-on signal dock",
      desc: "Shows live signal counters in a compact in-game overlay.",
    },
    showEconomyAdvisorPanel: {
      label: "Economy advisor panel",
      desc: "Shows safe-send and economy recommendations in a full panel.",
    },
  };

  ns.constants.EMOJI_SEARCH_PRIORITY = {
    "🏭": 40,
    "🚂": 34,
    "❤️": 32,
    "💔": 28,
    "🤝": 30,
    "☢️": 29,
    "🆘": 27,
  };

  ns.constants.EMOJI_KEYWORDS = {
    "😀": ["grin", "happy", "smile"],
    "😊": ["smile", "blush", "nice"],
    "🥰": ["love", "hearts", "adorable"],
    "😇": ["angel", "innocent", "halo"],
    "😎": ["cool", "sunglasses", "swag"],
    "😞": ["sad", "down", "disappointed"],
    "🥺": ["please", "beg", "puppy"],
    "😭": ["cry", "tears", "sob"],
    "😱": ["shock", "scream", "scared"],
    "😡": ["angry", "mad", "rage"],
    "😈": ["devil", "evil"],
    "🤡": ["clown", "joke"],
    "🥱": ["yawn", "bored", "sleepy"],
    "🫡": ["salute", "respect", "sir"],
    "🖕": ["middle", "finger", "rude"],
    "👋": ["wave", "hello", "bye"],
    "👏": ["clap", "applause", "gg"],
    "✋": ["stop", "hand", "halt"],
    "🙏": ["pray", "thanks", "please"],
    "💪": ["strong", "flex", "power"],
    "👍": ["thumbs", "up", "yes", "good"],
    "👎": ["thumbs", "down", "no", "bad"],
    "🫴": ["offer", "give", "hand"],
    "🤌": ["pinch", "what", "italian"],
    "🤦‍♂️": ["facepalm", "fail", "disbelief"],
    "🤝": ["handshake", "deal", "ally"],
    "🆘": ["help", "sos", "rescue"],
    "🕊️": ["peace", "dove", "calm"],
    "🏳️": ["white", "flag", "surrender"],
    "⏳": ["wait", "time", "soon"],
    "🔥": ["fire", "hot", "burn"],
    "💥": ["boom", "explode", "impact"],
    "💀": ["skull", "dead", "rip"],
    "☢️": ["nuke", "nuclear", "nucelar", "radiation"],
    "⚠️": ["warning", "alert", "danger"],
    "↖️": ["northwest", "up", "left"],
    "⬆️": ["up", "north", "top"],
    "↗️": ["northeast", "up", "right"],
    "👑": ["crown", "king", "winner"],
    "🥇": ["gold", "first", "1st"],
    "⬅️": ["left", "west", "back"],
    "🎯": ["target", "aim", "focus"],
    "➡️": ["right", "east", "forward"],
    "🥈": ["silver", "second", "2nd"],
    "🥉": ["bronze", "third", "3rd"],
    "↙️": ["southwest", "down", "left"],
    "⬇️": ["down", "south", "bottom"],
    "↘️": ["southeast", "down", "right"],
    "❤️": ["heart", "love", "care"],
    "💔": ["broken", "heart", "sad"],
    "💰": ["money", "gold", "cash"],
    "⚓": ["anchor", "navy", "port"],
    "⛵": ["boat", "sail", "ship"],
    "🏡": ["home", "house", "base"],
    "🛡️": ["shield", "defense", "protect"],
    "🏭": ["factory", "industry", "build"],
    "🚂": ["train", "rail", "locomotive"],
    "❓": ["question", "what", "confused"],
    "🐔": ["chicken", "coward", "bird"],
    "🐀": ["rat", "sneaky", "rodent"],
  };
})();
