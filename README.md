# Kenshi Mod Manager

A desktop mod manager for Kenshi on Windows and Linux.

Save and switch mod lists, reorder mods, and preview an autosort that reads mod records and dependencies. Includes search, bulk enable/disable, custom ordering rules, undo, and adjustable UI size.

[Download the latest release](https://github.com/Ouroborosrex/kenshi-mod-manager/releases/latest).

- **Windows:** run the setup `.exe`, or extract the `.zip` and open `Kenshi Mod Manager.exe`.
- **Linux:** make the `.AppImage` executable and run it. A `.tar.gz` is also available; extract it and run `kenshi-mod-manager`.

The app finds Steam installations automatically. You can also choose your Kenshi folder. Changes reach the game only when you click **Apply to game**, which backs up `mods.cfg` first. Keep Kenshi's launcher closed while applying.

Autosort compares fields and equipment/vendor-list entries, finds record dependencies, and preserves existing overwrite choices where possible. Search the preview to see which mod writes each conflicting value, or add a rule to prefer another mod. Changes to winning values require review.

It cannot decide every conflict or fix missing meshes, textures, or saved-game state. To recover an older order, import a CFG from your backups folder under **Settings & backups**. [Analysis details and limits](design/RECORDS.md).

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
