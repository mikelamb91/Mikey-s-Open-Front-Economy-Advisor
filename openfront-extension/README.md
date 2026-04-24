# OpenFront Enhanced

![Screenshot of spawn phase with nation markers and shortcut panel](screenshot.png)

Chrome extension that adds quality-of-life improvements to [openfront.io](https://openfront.io) and [openfront.dev](https://openfront.dev).

## Features

### Spawn phase
- **Nation markers** — Red dots on nations during spawn selection, visible at any zoom level. Removed when the game starts.
- **Sound notifications** — A chime plays when the spawn phase begins and another when the game starts, so you don't have to stare at the screen.

### Sound alerts
- **Per-sound settings** — Every OFE sound has its own toggle in the Extension settings tab, plus a `Listen` button so you can preview it without waiting for the in-game event.
- **Transport ship sounds** — A distinct sound plays when one of your transport ships lands, and a different sound plays when one is destroyed.
- **Warship destroyed sound** — A separate alert plays when one of your warships is destroyed.
- **Neighbor alerts** — Sleeping neighbors and traitor neighbors each have their own sound and setting.
- **Missile alerts** — Separate alarms play for atom bombs, hydrogen bombs, and MIRVs.

### Territory cycle
- **Mini Territories cycle** — The `Mini Territories` shortcut cycles the camera through your disconnected mini territories (100 tiles or fewer), skipping the shortcut if your land is fully connected or there are no mini territories.

### Keyboard shortcuts

All shortcuts are rebindable in the extension's `Extension` settings tab.

| Default key | Action | Description |
|---|---|---|
| `Z` | Chat Search | Opens chat directed at the hovered player with search |
| `X` | Emoji Search | Opens emoji selector with keyword search |
| `V` | Alliance Request | Sends an alliance request to the hovered player |
| `N` | Boat 1% | Sends a boat attack using only 1% of your troops |
| `L` | Mini Territories | Jumps camera between your disconnected mini territories (100 tiles or fewer) |

### Neighbor alerts
Notifications appear in the bottom-right when a neighboring player:
- **Falls asleep** (disconnects)
- **Betrays** an alliance and becomes a traitor

### Other
- **Emoji priority & keyword search** — Frequently used emojis are boosted to the top, and all emojis are searchable by keyword.

### Bundled helper modules (single package)

OpenFront Enhanced now ships helper bridge modules inside this extension package.

- On OpenFront hosts, OFE injects bundled helper modules from `src/vendor/page-bridge`.
- OFE's **Extension** settings tab includes helper toggles for predictions, heatmaps, trade balances, FPS saver, helper overlays, and related controls.
- OFE popup includes a single combined control center for Auto-Join, OFE sounds, and helper controls.
- OFE ships a native **Always-on signal dock** overlay to keep critical battle signals visible at all times.
- You no longer need to install the separate companion extension for helper bridge features.

### Lobby auto-join (workspace addition)

A small **OFE · Auto-join** panel appears on the main lobby screen (when the game’s `game-mode-selector` is present). It listens for the client’s `public-lobbies-update` event and dispatches the same `join-lobby` custom event the UI uses when a lobby matches your filters (FFA / Duos / Trios / large team / special; random spawn; alliances disabled; 2× gold; starting gold 0M / 5M / 25M). It turns **off** after one join attempt and can play a short chime.

This behavior is a **clean-room** implementation aimed at parity with publicly described store extensions (for example [Auto-Join & Helpers for OpenFront](https://chromewebstore.google.com/detail/openfront-auto-join-helpe/gpidldaeodhacaecoikekiogjcgfhinp)), **not** a reverse-engineered or republished copy of their minified source — that listing does not link a GitHub repository.

## Installation

1. Download or clone this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select this repository’s root directory (the folder that contains `manifest.json`)

The extension will activate automatically when you visit `openfront.io`, `openfront.dev`, any `*.openfront.dev` subdomain, or a local dev server at `http://localhost:9000` / `http://127.0.0.1:9000` (matches the Vite port in this workspace’s game client).

## Contributing

Found a bug or have a feature idea? [Open an issue](../../issues/new/choose).
