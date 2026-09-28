# Record-aware sorting

## Goal and limits

Input: installed `.mod` files, the four base data files, the enabled draft order,
header dependencies, pins and user rules. Output: a proposed permutation plus
record evidence and overwrite changes. Analysis writes no mod, save, asset or
game configuration. Accepting a preview changes only the draft.

There is no universal correct winner for two different edits to the same field.
The objective is to put demonstrable providers before consumers, preserve
existing overwrite choices when possible, and expose choices that must change.
It cannot recover a previously working order from an already broken order.
Import an earlier CFG backup when that is the baseline you want to preserve.

## Format evidence

The decoder was implemented independently using the [published format notes](https://steamcommunity.com/sharedfiles/filedetails/?id=797652627),
the [format-17 research](https://github.com/LucasSKrewer/kenshi-modkit/blob/main/FORMATO.md),
and comparison with [OpenConstructionSet's reader](https://github.com/lmaydev/OpenConstructionSet/blob/main/OpenConstructionSet/IO/OcsReader.cs).
The installed FCS loader was inspected locally to resolve disagreements between
sources. No FCS implementation or game data is distributed in this repository.

Verified details:

- Formats 16 and 17 have the same record body; 17 has a bounded header extension.
- Identity is the exact string ID, not a substring or filename guess. Vanilla
  records can contain historic mod filenames in their IDs.
- Bit 0 of saved flags distinguishes modifications from definitions. Old
  high-bit flags and modern save counters must not be compared as whole integers.
- Properties merge by field. References merge by category and target ID:
  two mods adding different clothes to the same vendor are not a conflict.
- A reference's third integer equal to `2147483647` marks removal. Requiring all
  three integers to match would miss valid removals.
- `REMOVED=true` is a record deletion. Empty instance targets mark instance
  removal. Whole-record deletions are hazards, not promised to be repaired by a
  later field edit.
- Format-17 delete requests are colon-separated record strings with a version,
  not arrays of length-prefixed strings. Their merge semantics are outside this
  model: affected files are marked incomplete and their order is preserved where
  it does not contradict dependencies or manual rules.

## Alternatives considered

1. Header/name-only priority sort: fast but can reverse field winners merely
   because a broad mod calls itself a patch.
2. Greedily minimize conflict counts: overlapping edits can be intended; a
   smaller count does not establish the desired item or shop behavior.
3. Graph constraints from records with overwrite preservation: explainable
   dependencies, cycle diagnostics, and visible manual choices.

The third approach is used. It is an exact topological sort for accepted
constraints, with a deterministic greedy policy for preserving overwrite order.
It is not a global minimum-movement or compatibility optimization.

## Algorithm

1. Decode base IDs and installed records. Include disabled mods when diagnosing
   unavailable providers. Two passes retain fields only for records touched by
   multiple enabled mods. Equal values do not create conflicts.
2. For a modified record or live reference absent from the base, find actual
   new-record definitions. A single enabled definition supplies a dependency.
   Multiple definitions are ambiguous; no edge is guessed. Without an enabled
   provider, report disabled or absent providers. Disable inference if base data
   could not be completely read.
3. Add those edges to declared dependencies, references, pins and user rules.
   Preserve positions of unreadable files and unsupported header effects where
   compatible with those hard constraints; accepting incomplete scans needs review.
4. For fields with differing writes, preserve the existing writer chain. Add
   an edge only if it cannot contradict an existing path. Whole-record removal
   also protects its order against other record edits.
5. Topologically sort; patch labels choose only among eligible mods. Keep
   disabled slots and enabled states unchanged. Refuse hard cycles.
6. Compare exact typed final values before/after. Show changed last writers and
   require review before accepting changed values or incomplete scans. Display
   values may be shortened; comparisons are not.

The UI searches and pages the full report in the main process; twenty records
cross IPC at a time. Scanning runs in a worker with a two-minute timeout and heap
limit. Files, counts, strings and total bytes read also have visible limits.

## Invariants and complexity

- Never enable, disable, drop or duplicate an entry while sorting.
- Respect every accepted dependency, manual rule and pin, or return no order.
- If all preservation edges fit, final field winners remain identical.
- When hard constraints prevent preservation, explicitly compare the result;
  never describe an inferred change as automatically compatible.
- Report unknown data; never present a partial decode as complete.
- Reread files for each analysis. Size/mtime changes between passes invalidate
  that file, rather than reusing a persistent cache after Workshop updates.

For B bytes, R records, W overlapping writes, V mods, E hard edges and P distinct
preservation pairs: decoding is O(B), indexing O(R + W), topological sort
O((V + E + P) log V), and cycle checks up to O(P(V + E + P)). Memory is
O(R + W + V + E + P), bounded operationally by worker limits.

## Verification and remaining limits

Fixtures cover both formats, typed fields, Unicode, every-byte truncation,
invalid counts, deletions, duplicate IDs, missing/disabled/ambiguous providers,
misleading ID suffixes, independent vendor additions, equal values, patch-name
regressions, explicit winner changes, unreadable files, cycles, IPC, and paging.
Desktop tests cover record search, distribution dependencies, a winner rule,
the review gate, draft-only acceptance, apply and exact backups. Packaged tests
launch the worker inside the ASAR on Windows and Linux.

Not modeled: asset existence/overrides, external level files, script behavior,
merge deletion effects, schema-specific string references, engine handling of
duplicate definitions, and saved world state. In-game verification of a missing
item remains necessary.
