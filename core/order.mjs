export const key = (name) => name.trim().toLowerCase();
export const BASE = new Set([
  "gamedata.base",
  "rebirth.mod",
  "newwworld.mod",
  "dialogue.mod",
]);
export function validName(name) {
  return (
    typeof name === "string" &&
    name.length > 4 &&
    name.length <= 500 &&
    /\.mod$/i.test(name) &&
    !/[\r\n\0/\\]/.test(name) &&
    name === name.trim()
  );
}
export function parseConfig(text) {
  const names = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length > 20000)
    throw new Error("This list is too large (maximum 20,000 entries).");
  const seen = new Set();
  return names.map((name) => {
    if (!validName(name))
      throw new Error(`Invalid mod filename: ${name.slice(0, 80)}`);
    const id = key(name);
    if (seen.has(id)) throw new Error(`Duplicate mod in list: ${name}`);
    seen.add(id);
    return { id, name, enabled: true };
  });
}
export function normalizeDraft(draft) {
  if (!draft || !Array.isArray(draft.entries) || draft.entries.length > 20000)
    throw new Error("Invalid mod list.");
  const seen = new Set();
  const entries = draft.entries.map((entry) => {
    if (!validName(entry.name) || typeof entry.enabled !== "boolean")
      throw new Error("A list entry has an invalid filename or enabled state.");
    const id = key(entry.name);
    if (seen.has(id)) throw new Error(`Duplicate mod: ${entry.name}`);
    seen.add(id);
    return { id, name: entry.name, enabled: entry.enabled };
  });
  const rules = {};
  for (const [id, rule] of Object.entries(draft.rules || {})) {
    if (!seen.has(id)) continue;
    if (!["auto", "normal", "patch", "last"].includes(rule.kind || "auto"))
      throw new Error("Unknown sorting rule.");
    if (
      !Array.isArray(rule.after || []) ||
      (rule.after || []).some((x) => !validName(x))
    )
      throw new Error("Invalid load-after rule.");
    rules[id] = {
      kind: rule.kind || "auto",
      pinned: !!rule.pinned,
      after: [...new Set(rule.after || [])],
    };
  }
  return { entries, rules };
}
export function classification(mod, rule = {}) {
  if (rule.kind && rule.kind !== "auto")
    return {
      kind: rule.kind,
      reason: "Your sorting override",
      confidence: "Manual",
    };
  const name = (mod?.name || "").replace(/\.mod$/i, "");
  if (
    /(?:^|[\s_\-()[\]])(?:patch(?:es)?|compat(?:ibility)?)(?:$|[\s_\-()[\]])/i.test(
      name,
    )
  ) {
    return {
      kind: "patch",
      reason: "Patch or compatibility label in filename",
      confidence: "Name hint",
    };
  }
  const intro = (mod?.description || "")
    .replace(/\[[^\]]*\]/g, "")
    .trim()
    .replace(/^summary\s*:\s*/i, "")
    .slice(0, 300);
  if (
    /^(?:(?:this(?: mod)? is|it is)\s+)?(?:(?:a|an|the)\s+)?(?:(?:simple|small|massive|minor|lightweight|unofficial)\s+){0,2}(?:compatibility|compatability|compat)\s+patch\b/i.test(
      intro,
    )
  )
    return {
      kind: "patch",
      reason: "Description identifies a compatibility patch",
      confidence: "Description hint",
    };
  if (
    /\b(?:this(?: mod)? is (?:an? |the )?(?:[\w'-]+ ){0,4}patch\b|this patch\b|(?:an? (?:small |simple |lightweight |minor )?|simple |small |lightweight )patch (?:for|to|which|that)\b)|^[^.!?\n]{0,80}\bpatch for\b/i.test(
      intro,
    )
  ) {
    return {
      kind: "patch",
      reason: "Description introduces this mod as a patch",
      confidence: "Description hint",
    };
  }
  if (
    /\b(?:fix(?:es)?|revert|tweaks?)\b/i.test(name) &&
    (mod?.dependencies || []).some((dep) => {
      const parent = dep.replace(/\.mod$/i, "").toLowerCase();
      return parent.length >= 5 && name.toLowerCase().includes(parent);
    })
  )
    return {
      kind: "patch",
      reason: "Named fix or tweak of a declared dependency",
      confidence: "Dependency + name hint",
    };
  return {
    kind: "normal",
    reason: "Keep the current relative order",
    confidence: "Default",
  };
}
export function buildGraph(draft, mods, analysis = null) {
  const active = draft.entries.filter((e) => e.enabled);
  const byId = new Map(mods.map((m) => [m.id, m]));
  const entries = new Map(draft.entries.map((e) => [e.id, e]));
  const ids = new Set(active.map((e) => e.id));
  const edges = new Map(active.map((e) => [e.id, new Set()]));
  const reasons = new Map(active.map((e) => [e.id, []]));
  const issues = [];
  const position = new Map(active.map((e, i) => [e.id, i]));
  const add = (from, to, reason) => {
    if (!ids.has(from) || !ids.has(to)) return;
    edges.get(from).add(to);
    reasons.get(to).push(reason);
    if (position.get(from) >= position.get(to))
      issues.push({ id: to, type: "order", message: reason });
  };
  for (const entry of active) {
    const mod = byId.get(entry.id);
    if (!mod || mod.missing)
      issues.push({
        id: entry.id,
        type: "missing",
        message: "No installed file matches this enabled entry.",
      });
    if (mod?.error)
      issues.push({ id: entry.id, type: "metadata", message: mod.error });
    if (mod?.duplicates?.length)
      issues.push({
        id: entry.id,
        type: "duplicate",
        message:
          "Multiple installed copies. Metadata is read from the local copy when present; remove the unwanted copy if they differ.",
      });
    for (const dep of mod?.dependencies || []) {
      const parent = key(dep);
      if (BASE.has(parent)) continue;
      if (!ids.has(parent) || byId.get(parent)?.missing || !byId.has(parent)) {
        issues.push({
          id: entry.id,
          type: "dependency",
          message: `${dep} is ${entries.has(parent) && !entries.get(parent).enabled && byId.has(parent) && !byId.get(parent).missing ? "disabled" : "not installed"}.`,
        });
      }
      if (ids.has(parent))
        add(parent, entry.id, `Requires ${dep} before this mod`);
    }
    for (const ref of mod?.references || [])
      if (!BASE.has(key(ref)))
        add(key(ref), entry.id, `References ${ref}; load it first`);
    for (const after of draft.rules[entry.id]?.after || []) {
      if (!ids.has(key(after)))
        issues.push({
          id: entry.id,
          type: "rule",
          message: `Your load-after target ${after} is not enabled.`,
        });
      else add(key(after), entry.id, `Your rule: load after ${after}`);
    }
  }
  for (const edge of analysis?.inferred || [])
    add(
      edge.from,
      edge.to,
      `Record dependency: ${byId.get(edge.from)?.name || edge.from} supplies ${edge.count} used or edited records (${edge.examples[0]})`,
    );
  // Preserve incomplete files against name hints, but do not invent hard rules
  // that prevent a real record dependency from being repaired.
  const opaque = new Set(analysis?.opaque || []);
  const anchors = [];
  active.forEach((entry, i) => {
    if (opaque.has(entry.id)) {
      active.forEach((other, j) => {
        if (j === i) return;
        anchors.push({
          from: j < i ? other.id : entry.id,
          to: j < i ? entry.id : other.id,
          count: 1,
          example: "Incomplete scan: preserve existing relative position",
        });
      });
    }
    if (!draft.rules[entry.id]?.pinned) return;
    active.forEach((other, j) => {
      if (j < i) edges.get(other.id).add(entry.id);
      if (j > i) edges.get(entry.id).add(other.id);
    });
    reasons
      .get(entry.id)
      .push("Pinned: keep its position and prevent other mods crossing it");
  });
  const relaxed = [];
  const reaches = (start, target) => {
    const seen = new Set(),
      pending = [start];
    while (pending.length) {
      const id = pending.pop();
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const next of edges.get(id) || []) pending.push(next);
    }
    return false;
  };
  for (const edge of [...anchors, ...(analysis?.protections || [])]) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    if (reaches(edge.to, edge.from)) {
      relaxed.push(edge);
      continue;
    }
    add(
      edge.from,
      edge.to,
      `Preserve existing overwrite order with ${byId.get(edge.from)?.name || edge.from}: ${edge.example}`,
    );
  }
  return { active, edges, issues, reasons, byId, position, relaxed };
}
// Iterative DFS avoids stack exhaustion for very large user lists.
function cycleMembers(edges, remaining) {
  const state = new Map();
  const parent = new Map();
  for (const root of remaining) {
    if (state.has(root)) continue;
    const stack = [
      [root, [...edges.get(root)].filter((x) => remaining.has(x)), 0],
    ];
    state.set(root, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame[2] === frame[1].length) {
        state.set(frame[0], 2);
        stack.pop();
        continue;
      }
      const next = frame[1][frame[2]++];
      if (state.get(next) === 1) {
        const cycle = [next];
        let current = frame[0];
        while (current !== next) {
          cycle.push(current);
          current = parent.get(current);
        }
        return cycle.reverse();
      }
      if (!state.has(next)) {
        parent.set(next, frame[0]);
        state.set(next, 1);
        stack.push([
          next,
          [...edges.get(next)].filter((x) => remaining.has(x)),
          0,
        ]);
      }
    }
  }
  return [];
}
class Heap {
  constructor(compare) {
    this.items = [];
    this.compare = compare;
  }
  push(x) {
    const a = this.items;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.compare(a[p], a[i]) <= 0) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const out = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      while (true) {
        let best = i;
        const l = i * 2 + 1;
        const r = l + 1;
        if (l < a.length && this.compare(a[l], a[best]) < 0) best = l;
        if (r < a.length && this.compare(a[r], a[best]) < 0) best = r;
        if (best === i) break;
        [a[best], a[i]] = [a[i], a[best]];
        i = best;
      }
    }
    return out;
  }
}
export function sortDraft(draft, mods, analysis = null) {
  const { active, edges, issues, reasons, byId, position, relaxed } =
    buildGraph(draft, mods, analysis);
  const classes = new Map(
    active.map((e) => [
      e.id,
      classification(byId.get(e.id) || e, draft.rules[e.id]),
    ]),
  );
  const priorities = { normal: 0, patch: 1, last: 2 };
  const incoming = new Map(active.map((e) => [e.id, 0]));
  for (const targets of edges.values())
    for (const id of targets) incoming.set(id, incoming.get(id) + 1);
  const heap = new Heap(
    (a, b) =>
      priorities[classes.get(a).kind] - priorities[classes.get(b).kind] ||
      position.get(a) - position.get(b),
  );
  for (const [id, count] of incoming) if (!count) heap.push(id);
  const result = [];
  while (heap.items.length) {
    const id = heap.pop();
    result.push(id);
    for (const next of edges.get(id)) {
      const count = incoming.get(next) - 1;
      incoming.set(next, count);
      if (!count) heap.push(next);
    }
  }
  if (result.length !== active.length) {
    const remaining = new Set(
      [...incoming].filter(([, n]) => n > 0).map(([id]) => id),
    );
    const cycle = cycleMembers(edges, remaining);
    return {
      ok: false,
      cycle,
      issues,
      relaxed,
      moves: [],
      message:
        "These dependencies, record dependencies or fixed positions contradict each other. Review the named mods, adjust a rule or unpin a mod, then try again.",
    };
  }
  const entriesById = new Map(active.map((e) => [e.id, e]));
  let index = 0;
  const entries = draft.entries.map((e) =>
    e.enabled ? entriesById.get(result[index++]) : e,
  );
  const moves = result.flatMap((id, to) => {
    const from = position.get(id);
    if (from === to) return [];
    const c = classes.get(id);
    return [
      {
        id,
        name: entriesById.get(id).name,
        from: from + 1,
        to: to + 1,
        kind: c.kind,
        reason: [...new Set([...(reasons.get(id) || []), c.reason])].join(
          " · ",
        ),
      },
    ];
  });
  return {
    ok: true,
    draft: { ...draft, entries },
    moves,
    issues,
    relaxed,
    patchCount: [...classes.values()].filter((c) => c.kind !== "normal").length,
  };
}
