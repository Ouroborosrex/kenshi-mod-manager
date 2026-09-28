Autosort now reads the records inside .mod files.

- Detects field overwrites, equipment/vendor-list changes, and removal markers.
- Finds dependencies from records that mods edit or reference, even when the header omits them.
- Preserves existing overwrite order where dependencies and your rules allow it. Patch names no longer take priority over these choices.
- Search conflicting records and values, see the last writer before/after sorting, and add a load-after rule to prefer another mod.
- Requires review when a sort changes winning values or a scan is incomplete.
- Reports missing providers, duplicate definitions, and unsupported data.

Sorting cannot recover a previously working order by itself. Import an earlier CFG backup if that is the order you want to preserve. Meshes, textures, external level files and saved-game state are not analyzed. Whole-record deletions and incompatible mods may need a compatibility patch.

Windows: setup .exe or portable .zip. Linux: AppImage or .tar.gz. Builds are unsigned; SHA-256 checksums are included.
