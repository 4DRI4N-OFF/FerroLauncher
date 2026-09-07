# ⛏️ FerroLauncher

Open-source **Minecraft: Java Edition** launcher for Windows, built with Electron + React + Node.js.
A Prism-style launcher: instances, loaders, mods and modpacks in one place.

> ⚠️ Work in progress — not the final app. Loader and feature coverage is growing.

## Features

- **Auth:** offline mode + Microsoft-account login (OAuth 2.0 + PKCE, auto-refresh)
- **Loaders:** Vanilla, Fabric ✅ · Forge, NeoForge, Quilt 🛠️ (roadmap)
- **Instances:** isolated game dirs, per-instance RAM / Java / resolution, start-stop from console
- **Mods:** search, install, enable/disable and update from **Modrinth**
- **Modpacks:** one-click `.mrpack` install (mods + configs + overrides)
- **Java:** auto-detects the required version, downloads Temurin when missing
- **Console:** live logs with level/text filters, autoscroll
- **UI:** liquid-glass theme, Spanish + English

## Roadmap

- [x] Offline launch (Vanilla + Fabric)
- [x] Modrinth mods & modpacks
- [x] Microsoft login flow (pending Mojang app approval)
- [ ] Forge / NeoForge / Quilt support
- [ ] CurseForge browsing, shaderpacks & resource packs tabs
- [ ] Skins & capes manager, servers list
- [ ] Backups, instance export/import (.ferro / .mrpack)
- [ ] Auto-updater, custom icon, installer signing
- [ ] Multi-account switcher

## Install (users)

Download `FerroLauncher Setup x.y.z.exe` from **Releases** and run it.
No account needed for offline play; a Microsoft account with
Minecraft: Java Edition unlocks online servers.

## Dev

```powershell
npm install
npm run electron:dev     # dev UI + Electron
npm run dist             # NSIS installer + portable .exe in release/
```

## Tech

`core/` launcher engine (Mojang/Fabric/Modrinth/Xbox APIs) ·
`electron/` main + preload (IPC) · `src/` React UI.

## Contributing

Issues and PRs welcome. Keep PRs small and tested (`npm run build`).

## License

MIT — see LICENSE.

## Disclaimer

Not affiliated with Mojang AB or Microsoft. Minecraft is a trademark
of Mojang Synergies AB.
