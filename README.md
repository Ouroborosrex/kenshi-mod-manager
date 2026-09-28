# Kenshi Mod Manager

A desktop mod manager for Kenshi on Windows and Linux.

Save and switch mod lists, reorder mods, and preview an autosort that puts patches after their dependencies. Includes search, bulk enable/disable, custom ordering rules, undo, and adjustable UI size.

[Download the latest release](https://github.com/Ouroborosrex/kenshi-mod-manager/releases/latest).

- **Windows:** run the setup `.exe`, or extract the `.zip` and open `Kenshi Mod Manager.exe`.
- **Linux:** make the `.AppImage` executable and run it. A `.tar.gz` is also available; extract it and run `kenshi-mod-manager`.

The app finds Steam installations automatically. You can also choose your Kenshi folder. Changes reach the game only when you click **Apply to game**, which backs up `mods.cfg` first. Keep Kenshi's launcher closed while applying.

Autosort uses mod metadata and patch-name hints. It cannot resolve every conflict; review the proposed order and override individual rules when needed.

## Build

Requires Node.js 22 or later.

```sh
npm ci
npm test
npm run build
npm start
```

`npm run package -- --linux --x64` builds Linux packages; use `--win` on Windows. GitHub Actions tests both platforms and publishes packages when a `v*` tag matching the package version is pushed.

MIT licensed. Not affiliated with Lo-Fi Games.
