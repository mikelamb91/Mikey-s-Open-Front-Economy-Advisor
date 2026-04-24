# OpenFront workspace

This folder brings together:

- **`openfrontio/`** — Game client and server (fork of [OpenFrontIO](https://github.com/openfrontio/OpenFrontIO)). Run the client with `npm run dev` or `npm run dev:prod` from that directory (Vite listens on **port 9000**).
- **`openfront-extension/`** — [OpenFront Enhanced](https://github.com/marijnbent/openfront-extension), vendored here with extra workspace tweaks (localhost matches, **lobby auto-join** panel that mirrors the *publicly described* behavior of store extensions such as [Auto-Join & Helpers for OpenFront](https://chromewebstore.google.com/detail/openfront-auto-join-helpe/gpidldaeodhacaecoikekiogjcgfhinp) — implemented from the game’s own events, not from that extension’s unpublished source).

## Using the extension with local development

1. In Chrome, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and choose **`openfront-extension/`** (the directory that contains `manifest.json`).
2. Start the game from `openfrontio/` (for example `npm run dev:prod`).
3. Open `http://localhost:9000`. The vendored manifest includes `localhost:9000` and `127.0.0.1:9000` so the extension runs on the same port as this repo’s Vite config.

Upstream-only installs should use the original repository; this copy may diverge slightly (for example localhost `matches` / `host_permissions`) to match this workspace.
