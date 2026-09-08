<p align="center">
  <img src="src/assets/brand.png" alt="FerroLauncher" width="600" />
</p>

<p align="center">
  <a href="https://github.com/4DRI4N-OFF/FerroLauncher/releases"><img src="https://img.shields.io/github/v/release/4DRI4N-OFF/FerroLauncher" alt="Release" /></a>
  <img src="https://img.shields.io/badge/License-MIT-amber.svg" alt="License: MIT" />
  <img src="https://img.shields.io/badge/platform-Windows-blue.svg" alt="Platform" />
  <img src="https://img.shields.io/badge/built%20with-Electron-47848f.svg" alt="Electron" />
  <a href="https://discord.gg/vTujTm3hE"><img src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="https://www.youtube.com/@4dri4n-08"><img src="https://img.shields.io/badge/YouTube-@4dri4n--08-red?logo=youtube" alt="YouTube" /></a>
</p>

<p align="center"><b>Open-source Minecraft: Java Edition launcher for Windows.</b><br />Instances, loaders, mods and modpacks in one place — with a liquid-glass ember UI.</p>

---

## ✨ Features

| Area | What you get |
|---|---|
| 🎮 Play | Offline + Microsoft login (OAuth 2.0 + PKCE, auto-refresh, multi-account) |
| 🧩 Loaders | Vanilla, Fabric, Quilt, Forge, NeoForge (official installers) |
| 📦 Instances | Isolated dirs, per-instance RAM / Java / resolution, start-stop console |
| 🧪 Content | Mods, shaders, resource packs + one-click `.mrpack` modpacks (Modrinth) |
| ☕ Java | Auto-detects the required version, downloads Temurin when missing |
| 🎨 UI | Liquid-glass ember theme + Midnight / Forest / Sakura, ES/EN, sounds, toasts |
| 🛡️ Safety | Premium-name anti-impersonation, download verification, backups |
| 🔄 More | Auto-updater, skins & capes, Discord RPC + webhooks, crash viewer, gallery |

## 📥 Install (players)

1. Download `FerroLauncher Setup x.y.z.exe` from [**Releases**](https://github.com/4DRI4N-OFF/FerroLauncher/releases).
2. Run it (unsigned yet: Windows SmartScreen will warn once — click *More info → Run anyway*).
3. Create an instance and press **PLAY**. No account needed for offline.

> A Microsoft account owning Minecraft: Java Edition unlocks online servers (pending Mojang app approval — offline works fully meanwhile).

## 🛠️ Dev

```powershell
npm install
npm run electron:dev     # Vite + Electron with hot reload
npm run build            # UI bundle check
npm run dist:full        # NSIS installer + portable .exe in release/
```

Project layout: `core/` launcher engine (Mojang/Fabric/Modrinth/Xbox APIs) · `electron/` main + preload (IPC) · `src/` React UI.

## 🗺️ Roadmap

- [x] Offline launch (all 5 loaders) · [x] Modrinth content · [x] Skins, backups, multi-account
- [x] Auto-updater, icon, sounds, themes, Discord · [x] ES/EN
- [ ] CurseForge browsing · [ ] Installer signing · [ ] Microsoft login approval

## 🤝 Contributing

Issues and PRs welcome (ES/EN). Keep PRs small and tested (`npm run build`). See open [issues](https://github.com/4DRI4N-OFF/FerroLauncher/issues) for ideas.

## 🙏 Acknowledgments

[Mojang](https://www.minecraft.net/) official APIs · [Modrinth](https://modrinth.com/) · [Fabric](https://fabricmc.net/), [Quilt](https://quiltmc.org/), [Forge](https://minecraftforge.net/), [NeoForge](https://neoforged.net/) · [Electron](https://www.electronjs.org/) · UI sounds synthesized in-app · Brand icons by [Simple Icons](https://simpleicons.org/) (CC0).

## 📄 License

MIT — see [LICENSE](LICENSE).

## ⚖️ Disclaimer

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
FerroLauncher downloads game files exclusively from official Mojang/Microsoft servers and
never redistributes them. Minecraft is a trademark of Mojang Synergies AB.

## 📬 Contact

Owner: Adrián García Martínez ([@4DRI4N-OFF](https://github.com/4DRI4N-OFF)).
Issues and contact: <https://github.com/4DRI4N-OFF/FerroLauncher/issues> ·
Discord: <https://discord.gg/vTujTm3hE>.
