# Kenshi Mod Manager

## Interaction
A desktop workbench, not a dashboard. Warm neutral surfaces, restrained ochre accent, ordinary title bar. Large typography and persistent 100–175% UI scale. Saved lists left, ordered mod table center, selection details right. No game files change until Apply to game. Working drafts autosave separately. Applying backs up the existing bytes and refuses an external-change race. Import/export standard mods.cfg or rich portable JSON. Undo is for edits in the session, not an implicit rewrite of game files.

## Sort specification
The record-aware extension and current conflict behavior are specified in [RECORDS.md](RECORDS.md). The following describes the original metadata-only baseline.

Input: complete ordered entries with enabled state, parsed dependencies/references, patch overrides, user after-rules, and pinned positions. Output: a permutation of enabled entries, preserving disabled entries in their existing slots, or a cycle diagnostic. Never enable/disable mods or remove missing entries during sorting.

Hard edges: dependency -> dependent for active declared dependencies; active reference -> referring mod; user load-after; original preceding/following entries -> pinned anchor -> following entries. Base-game files are excluded. Name resolution is exact, case-insensitive; no substring matching. Missing hard requirements and disabled requirements are diagnosed separately. References are optional if not active.

Soft preference: normal, patch, explicitly load-last. Patch detection uses a patch/compatibility word in the filename or an explicit self-description as a patch at the start of the description, or a named fix/tweak of a declared dependency. Multiple dependencies and generic 'fix' alone are insufficient. Users can override every classification. Within equal priority, keep original order. Priority never overrides hard edges. Dependencies of late patches can themselves be late, but must still precede their consumers.

Candidates: (1) stable partition by patch name: simple but breaks dependencies; (2) iterative moves after parents: order-sensitive and can loop; (3) stable priority topological sort: explicit constraints, deterministic, detects cycles. Choose (3), with binary heap: O((V+E) log V) time and O(V+E) space; pinned edges add O(VP). An iterative DFS reports an actual cycle, excluding downstream blocked nodes. No claim of globally minimal movement or game-data conflict resolution.

Validation: both observed binary header formats; Unicode/truncated headers; dependency chains; reference-only patches; false-positive fix names; overrides; pinned boundaries; cycles; missing/disabled parents; stable repeated sort; randomized acyclic graphs. Real installed library is scanned read-only. File writes tested on temporary Kenshi trees, including exact backup, invalid names, missing entries, external change rejection, profile round trips, and import validation. Desktop tests exercise search, toggle, undo, save/load, preview, apply on fixture, restart, and UI scale. Real mods.cfg must remain byte-identical during development.

## Metadata provenance
Header layout verified against the installed files and https://steamcommunity.com/sharedfiles/filedetails/?id=797652627 . Type 16 strings begin at byte 8; type 17 at byte 12. Read bounded header data only; unsupported or corrupt metadata stays visible as a diagnostic. No borrowed application implementation or remote AI sorting service.
