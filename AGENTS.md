# AGENTS.md

Guidance for cloud agents working in this multi-repo workspace (`/agent/repos/*`).

## Workspace layout

| Repo | Path | Type |
|------|------|------|
| Mikel | `/agent/repos/mikel` | Static PWA (`index.html`) |
| Tono homepage | `/agent/repos/tono-homepage` | Static marketing site |
| Tono web designs | `/agent/repos/tono-web-designs` | Markdown docs only (no app) |
| Tucson Pool Pros | `/agent/repos/tucson-pool-pros` | Static marketing site |

There is no root `package.json`, monorepo tooling, Docker, or build step. Python 3 is preinstalled and used only to serve files over HTTP.

## Running apps (development)

Serve each repo from its own directory on a distinct port so multiple sites can run at once:

```bash
cd /agent/repos/mikel && python3 -m http.server 8081
cd /agent/repos/tono-homepage && python3 -m http.server 8082
cd /agent/repos/tucson-pool-pros && python3 -m http.server 8083
```

Open `http://localhost:<port>/` in a browser. Do not rely on `file://` — some features behave better over HTTP.

Use tmux for long-running servers (see cloud instructions below).

## Lint / test / build

None of the repos define lint, test, or build scripts. Verification is manual: page load, navigation, and interactive UI (theme toggle, PIN unlock, forms).

## External services (optional)

- **Mikel**: Groq API key entered in-browser (`localStorage`) for AI features; Yahoo Finance via corsproxy.io for market widget. UI works without them.
- **Tono homepage / Tucson Pool Pros**: Formspree endpoints are placeholders until wired for real submissions.

## Mikel quick test

Default dashboard PIN is `2007`. On first load, dismiss or skip the Groq API key modal to reach the main UI.

## Cursor Cloud specific instructions

- **No dependency install step** — repos are self-contained single-file HTML sites (plus markdown in `tono-web-designs`).
- **Dev servers**: Run one `python3 -m http.server <port>` per repo from that repo’s directory. Ports `8081` (mikel), `8082` (tono-homepage), and `8083` (tucson-pool-pros) avoid collisions if all three run together.
- **tmux**: Back long-running servers with `tmux -f /exec-daemon/tmux.portal.conf` (e.g. sessions `mikel-dev`, `tono-dev`, `pool-pros-dev`).
- **`tono-web-designs`**: Documentation only — no HTTP server required unless previewing markdown externally.
- **Internet**: Required for Google Fonts, external images, and optional third-party APIs (Groq, Formspree, corsproxy.io).
