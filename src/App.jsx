import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Plus,
  Save,
  ArrowDownUp,
  Undo2,
  Redo2,
  FolderOpen,
  Download,
  Upload,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  ChevronsUp,
  ChevronsDown,
  Pin,
  Check,
  X,
  AlertTriangle,
  List,
  CheckSquare,
  Layers,
  ExternalLink,
  Play,
  Settings2,
  ArrowRight,
  Info,
  Trash2,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { buildGraph, classification, key } from "../core/order.mjs";
import OverwriteReview from "./OverwriteReview.jsx";
const api = window.manager;
const displayName = (name) => name.replace(/\.mod$/i, "");
const copy = (value) => structuredClone(value);
const sig = (entries) =>
  entries
    .filter((e) => e.enabled)
    .map((e) => e.name)
    .join("\n");
const blankRule = { kind: "auto", pinned: false, after: [] };
function IconButton({ label, children, ...props }) {
  return (
    <button className="icon-button" title={label} aria-label={label} {...props}>
      {children}
    </button>
  );
}
function Modal({ title, children, onClose, wide = false, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-shell">
        <header>
          <h2>{title}</h2>
          <IconButton label="Close dialog" onClick={onClose}>
            <X />
          </IconButton>
        </header>
        <div className="modal-content">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </dialog>
  );
}
function mergeDraft(draft, mods) {
  const seen = new Set(draft.entries.map((e) => e.id));
  return {
    ...draft,
    entries: [
      ...draft.entries,
      ...mods
        .filter((m) => !seen.has(m.id) && !m.missing)
        .map((m) => ({ id: m.id, name: m.name, enabled: false })),
    ],
  };
}
export default function App() {
  const [state, setState] = useState(null),
    [draft, setDraft] = useState(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState("");
  const [selected, setSelected] = useState(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  const [modal, setModal] = useState(null),
    [profileName, setProfileName] = useState(""),
    [activeProfile, setActiveProfile] = useState(null);
  const [history, setHistory] = useState([]),
    [future, setFuture] = useState([]),
    [scale, setScale] = useState(1.25);
  const [details, setDetails] = useState(
      () => !window.matchMedia("(max-width: 980px)").matches,
    ),
    [afterTarget, setAfterTarget] = useState(""),
    [jump, setJump] = useState("");
  const [sessionStatus, setSessionStatus] = useState("Saved locally");
  const searchRef = useRef(null),
    dragId = useRef(null);
  const analysisRequest = useRef(0);
  const [reviewedOverwrites, setReviewedOverwrites] = useState(false);
  useEffect(() => {
    const compact = window.matchMedia("(max-width: 980px)");
    const hideOverlay = (event) => {
      if (event.matches) setDetails(false);
    };
    compact.addEventListener("change", hideOverlay);
    return () => compact.removeEventListener("change", hideOverlay);
  }, []);
  function installSnapshot(next, reset = false) {
    setState(next);
    setScale(next.scale || 1.25);
    if (next.error) setError(next.error);
    if (next.draft) {
      setDraft(next.draft);
      setSelected((id) =>
        next.draft.entries.some((e) => e.id === id)
          ? id
          : next.draft.entries[0]?.id,
      );
      setActiveProfile(next.activeProfile || null);
    }
    if (reset) {
      setHistory([]);
      setFuture([]);
    }
  }
  useEffect(() => {
    if (!api) {
      setError("Open this application using its desktop launcher.");
      return;
    }
    api
      .initial()
      .then((s) => installSnapshot(s, true))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!draft || !state?.fingerprint) return;
    setSessionStatus("Saving draft…");
    let canceled = false;
    api
      .session({ draft, fingerprint: state.fingerprint, activeProfile })
      .then(() => {
        if (!canceled) setSessionStatus("Saved locally");
      })
      .catch((e) => {
        if (!canceled) {
          setSessionStatus("Draft not saved");
          setError(e.message);
        }
      });
    return () => {
      canceled = true;
    };
  }, [draft, state?.fingerprint, activeProfile]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  const mods = useMemo(() => {
    const map = new Map((state?.mods || []).map((m) => [m.id, m]));
    for (const e of draft?.entries || [])
      if (!map.has(e.id))
        map.set(e.id, {
          ...e,
          missing: true,
          source: "Missing",
          dependencies: [],
          references: [],
          description: "",
        });
    return map;
  }, [state?.mods, draft?.entries]);
  const graph = useMemo(
    () => (draft ? buildGraph(draft, [...mods.values()]) : null),
    [draft, mods],
  );
  const issueMap = useMemo(() => {
    const map = new Map();
    for (const issue of graph?.issues || [])
      map.set(issue.id, [...(map.get(issue.id) || []), issue]);
    return map;
  }, [graph]);
  const active = useMemo(
    () => draft?.entries.filter((e) => e.enabled) || [],
    [draft],
  );
  const positions = useMemo(
    () => new Map(active.map((e, i) => [e.id, i + 1])),
    [active],
  );
  const classes = useMemo(
    () =>
      new Map(
        [...mods].map(([id, m]) => [id, classification(m, draft?.rules[id])]),
      ),
    [mods, draft?.rules],
  );
  const patchCount = [...classes.values()].filter(
    (c) => c.kind !== "normal",
  ).length;
  const filtered = useMemo(
    () =>
      (draft?.entries || []).filter((e) => {
        const m = mods.get(e.id),
          terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
        if (
          (filter === "enabled" && !e.enabled) ||
          (filter === "disabled" && e.enabled) ||
          (filter === "patches" && classes.get(e.id)?.kind === "normal") ||
          (filter === "issues" && !issueMap.has(e.id))
        )
          return false;
        const haystack =
          `${e.name} ${m?.title || ""} ${m?.author || ""} ${m?.source || ""}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      }),
    [draft?.entries, mods, search, filter, classes, issueMap],
  );
  const mod = mods.get(selected),
    entry = draft?.entries.find((e) => e.id === selected),
    rule = draft?.rules[selected] || blankRule;
  const dirty =
    !!draft &&
    !!state?.gameEntries &&
    sig(draft.entries) !== sig(state.gameEntries);
  const external = state?.fingerprint !== state?.currentFingerprint;
  const profile = state?.profiles?.find((p) => p.id === activeProfile);
  function commit(next, message) {
    setHistory((h) => [...h.slice(-49), { draft: copy(draft), activeProfile }]);
    setFuture([]);
    setDraft(next);
    if (message) setNotice(message);
  }
  function undo() {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setFuture((f) => [...f, { draft: copy(draft), activeProfile }]);
    setHistory((h) => h.slice(0, -1));
    setDraft(prev.draft);
    setActiveProfile(prev.activeProfile);
  }
  function redo() {
    if (!future.length) return;
    const next = future[future.length - 1];
    setHistory((h) => [...h, { draft: copy(draft), activeProfile }]);
    setFuture((f) => f.slice(0, -1));
    setDraft(next.draft);
    setActiveProfile(next.activeProfile);
  }
  function toggle(id) {
    commit({
      ...draft,
      entries: draft.entries.map((e) =>
        e.id === id ? { ...e, enabled: !e.enabled } : e,
      ),
    });
  }
  function setRule(patch) {
    commit({
      ...draft,
      rules: {
        ...draft.rules,
        [selected]: { ...blankRule, ...rule, ...patch },
      },
    });
  }
  function move(id, target) {
    const entries = [...draft.entries],
      from = entries.findIndex((e) => e.id === id);
    if (from < 0) return;
    target = Math.max(0, Math.min(entries.length - 1, target));
    if (from === target) return;
    const [item] = entries.splice(from, 1);
    entries.splice(target, 0, item);
    commit({ ...draft, entries });
  }
  function moveActive(where) {
    if (!entry) return;
    const items = draft.entries.filter((e) => e.enabled === entry.enabled);
    const index = items.findIndex((e) => e.id === selected);
    const next =
      where === "first"
        ? 0
        : where === "last"
          ? items.length - 1
          : index + where;
    if (next < 0 || next >= items.length) return;
    move(
      selected,
      draft.entries.findIndex((e) => e.id === items[next].id),
    );
  }
  async function run(label, action) {
    if (busy) return;
    setBusy(label);
    try {
      return await action();
    } catch (e) {
      setError(e.message);
      setModal(null);
    } finally {
      setBusy("");
    }
  }
  async function previewSort(next = draft) {
    const request = ++analysisRequest.current;
    setReviewedOverwrites(false);
    setModal({ type: "scanning" });
    await run("Reading mod records", async () => {
      const result = await api.analyze(next);
      if (analysisRequest.current === request)
        setModal({ type: "sort", result });
    });
  }
  async function preferOverwrite(id, writers) {
    const current = draft.rules[id] || blankRule;
    const next = {
      ...draft,
      rules: {
        ...draft.rules,
        [id]: {
          ...current,
          after: [
            ...new Set([
              ...current.after,
              ...writers
                .filter((other) => other !== id)
                .map((other) => mods.get(other)?.name || other),
            ]),
          ],
        },
      },
    };
    commit(
      next,
      "Load-after rule added. Review its effect on other records before applying.",
    );
    await previewSort(next);
  }
  function saveList(asNew = false) {
    setProfileName(asNew ? "" : profile?.name || "My Kenshi list");
    setModal({ type: "save", asNew });
  }
  async function loadProfile(id) {
    await run("Loading list", async () => {
      const p = await api.loadProfile(id);
      commit(
        mergeDraft(p.draft, [...mods.values()]),
        `Loaded “${p.name}” into your draft.`,
      );
      setActiveProfile(id);
    });
  }
  async function refresh() {
    await run("Scanning mods", async () => {
      const next = await api.refresh();
      setState((s) => ({ ...s, ...next, draft: undefined }));
      setDraft((d) => mergeDraft(d, next.mods));
      setNotice("Installed mods refreshed. Your working order was kept.");
    });
  }
  async function importFile() {
    await run("Importing list", async () => {
      const result = await api.import();
      if (result) {
        commit(
          mergeDraft(result.draft, [...mods.values()]),
          `Imported “${result.name}”. Save it as a list to keep a named copy.`,
        );
        setActiveProfile(null);
      }
    });
  }
  function bulk(enabled) {
    const ids = new Set(filtered.map((e) => e.id));
    commit(
      {
        ...draft,
        entries: draft.entries.map((e) =>
          ids.has(e.id) ? { ...e, enabled } : e,
        ),
      },
      `${enabled ? "Enabled" : "Disabled"} ${ids.size} selected mods.`,
    );
    setModal(null);
  }
  useEffect(() => {
    const onKey = (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (modal) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (draft) saveList();
      }
      if (!typing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if (!typing && (e.ctrlKey || e.metaKey) && e.key === "ArrowUp") {
        e.preventDefault();
        moveActive(-1);
      }
      if (!typing && (e.ctrlKey || e.metaKey) && e.key === "ArrowDown") {
        e.preventDefault();
        moveActive(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const showMod = (id) => {
    setSelected(id);
    setDetails(true);
    setModal(null);
  };
  if (!state || state.needsSetup)
    return (
      <main className="setup">
        <div className="wordmark">
          <span className="mark">K</span>
          <span>
            KENSHI <small>MOD MANAGER</small>
          </span>
        </div>
        <h1>
          {state?.needsSetup
            ? "Choose your Kenshi folder"
            : "Opening your mod library…"}
        </h1>
        <p>
          {state?.needsSetup
            ? "Select the game folder that contains data/mods.cfg. Steam Workshop mods in the same library are discovered automatically."
            : "Reading the current load order and installed mod headers."}
        </p>
        {error && <p className="error">{error}</p>}
        {state?.needsSetup && (
          <button
            className="primary"
            onClick={() =>
              run("Opening folder", async () => {
                const s = await api.chooseGame();
                if (s) {
                  setError("");
                  installSnapshot(s, true);
                }
              })
            }
          >
            <FolderOpen />
            Choose game folder
          </button>
        )}
      </main>
    );
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="wordmark">
          <span className="mark">K</span>
          <span>
            KENSHI <small>MOD MANAGER</small>
          </span>
        </div>
        <div className="sidebar-label">LIBRARY</div>
        <nav aria-label="Library filters">
          {[
            ["all", List, "All mods", draft.entries.length],
            ["enabled", CheckSquare, "Enabled", active.length],
            ["patches", Layers, "Patches & late", patchCount],
            ["issues", AlertTriangle, "Needs attention", issueMap.size],
          ].map(([value, Icon, label, count]) => (
            <button
              key={value}
              className={`nav-item ${filter === value ? "active" : ""}`}
              onClick={() => setFilter(value)}
            >
              <Icon />
              <span>{label}</span>
              <span
                className={
                  value === "issues" && count ? "count warning" : "count"
                }
              >
                {count}
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-label lists-heading">
          SAVED LISTS
          <IconButton label="Save as a new list" onClick={() => saveList(true)}>
            <Plus size={17} />
          </IconButton>
        </div>
        <div className="saved-lists">
          {!state.profiles.length ? (
            <p className="sidebar-help">
              Keep a list for each playthrough. Save your current setup to get
              started.
            </p>
          ) : (
            state.profiles.map((p) => (
              <button
                key={p.id}
                className={`profile-item ${activeProfile === p.id ? "active" : ""}`}
                onClick={() => loadProfile(p.id)}
                title={`Load ${p.name}`}
                aria-label={`Load ${p.name}`}
                disabled={!!busy}
              >
                <List size={17} />
                <span>
                  <strong>{p.name}</strong>
                  <small>{p.count} enabled mods</small>
                </span>
                {activeProfile === p.id && <span className="small-dot" />}
              </button>
            ))
          )}
        </div>
        <div className="sidebar-bottom">
          <button onClick={importFile} disabled={!!busy}>
            <Download />
            Import list
          </button>
          <button onClick={() => setModal({ type: "export" })}>
            <Upload />
            Export list
          </button>
          <button onClick={() => setModal({ type: "settings" })}>
            <Settings2 />
            Settings & backups
          </button>
          <div className="install-status">
            <span className="small-dot" />
            Steam installation <span title={state.gamePath}>Kenshi</span>
          </div>
          <div
            className="build-info"
            aria-label="Mod manager version"
            title={`Commit ${__APP_COMMIT__}`}
          >
            <span>v{__APP_VERSION__}</span>
            <span className="build-hash">{__APP_COMMIT__.slice(0, 7)}</span>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="workspace-title">
            <div className="eyebrow">{profile?.name || "CURRENT SETUP"}</div>
            <h1>Load order</h1>
          </div>
          <div className="main-actions">
            <button onClick={() => saveList()} disabled={!!busy}>
              <Save />
              Save list
            </button>
            <button
              onClick={() => previewSort()}
              disabled={!!busy || !active.length}
            >
              <ArrowDownUp />
              Autosort
            </button>
            <button
              className="primary"
              onClick={() => setModal({ type: "apply" })}
              disabled={!!busy || !dirty}
            >
              <Check />
              Apply to game
            </button>
          </div>
        </header>
        <div className="contextbar">
          <span>
            <strong>{active.length}</strong> enabled{" "}
            <span className="dot-separator">·</span>{" "}
            {draft.entries.length - active.length} disabled
          </span>
          <span className={dirty ? "pending-state" : "saved-state"}>
            <span className="small-dot" />
            {dirty ? "Changes not applied" : "Matches game load order"}
          </span>
          <div className="context-tools">
            <label className="scale-label">
              UI size{" "}
              <select
                aria-label="Interface size"
                value={scale}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  run("Resizing", async () => {
                    await api.scale(value);
                    setScale(value);
                  });
                }}
              >
                {[1, 1.15, 1.25, 1.5, 1.75].map((n) => (
                  <option key={n} value={n}>
                    {Math.round(n * 100)}%
                  </option>
                ))}
              </select>
            </label>
            <IconButton
              label={details ? "Hide mod details" : "Show mod details"}
              onClick={() => setDetails(!details)}
            >
              {details ? <PanelRightClose /> : <PanelRightOpen />}
            </IconButton>
          </div>
        </div>
        {external && (
          <div className="banner">
            <AlertTriangle />
            <span>
              The game’s load order changed outside this app. Reload it before
              applying.
            </span>
            <button onClick={() => setModal({ type: "reload" })}>
              Reload from game
            </button>
          </div>
        )}
        {error && (
          <div className="banner error" role="alert">
            <AlertTriangle />
            <span>{error}</span>
            <IconButton label="Dismiss error" onClick={() => setError("")}>
              <X />
            </IconButton>
          </div>
        )}
        <div className={`workbench ${details ? "" : "without-details"}`}>
          <section className="list-pane" aria-label="Mod load order">
            <div className="list-toolbar">
              <div className="search">
                <Search />
                <input
                  ref={searchRef}
                  aria-label="Search mods"
                  placeholder="Search mods, authors…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search ? (
                  <IconButton
                    label="Clear search"
                    onClick={() => setSearch("")}
                  >
                    <X size={17} />
                  </IconButton>
                ) : (
                  <kbd>Ctrl F</kbd>
                )}
              </div>
              <IconButton
                label="Rescan installed mods"
                onClick={refresh}
                disabled={!!busy}
              >
                <RefreshCw className={busy === "Scanning mods" ? "spin" : ""} />
              </IconButton>
            </div>
            <div className="filterline">
              <div className="tabs">
                {[
                  ["all", "All"],
                  ["enabled", "Enabled"],
                  ["disabled", "Disabled"],
                ].map(([value, label]) => (
                  <button
                    className={filter === value ? "active" : ""}
                    key={value}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
                {["issues", "patches"].includes(filter) && (
                  <button className="active" onClick={() => setFilter("all")}>
                    {filter === "issues" ? "Needs attention" : "Patches & late"}{" "}
                    <X size={13} />
                  </button>
                )}
              </div>
              <span>{filtered.length} shown</span>
              <button
                className="text-button"
                onClick={() => setModal({ type: "bulk" })}
                disabled={!filtered.length}
              >
                Select actions
              </button>
            </div>
            <div
              className="table-scroll"
              role="table"
              aria-label="Mods"
              aria-rowcount={filtered.length + 1}
            >
              <div className="table-head mod-grid" role="row">
                <span role="columnheader" title="Enabled">
                  <CheckSquare size={16} />
                </span>
                <span role="columnheader">Order</span>
                <span role="columnheader">
                  Mod name <span className="muted">↓ loads later</span>
                </span>
                <span role="columnheader">Sorting</span>
                <span role="columnheader">Source</span>
              </div>
              {filtered.map((e, i) => {
                const m = mods.get(e.id),
                  c = classes.get(e.id),
                  problems = issueMap.get(e.id) || [];
                return (
                  <div
                    key={e.id}
                    role="row"
                    aria-rowindex={i + 2}
                    aria-selected={selected === e.id}
                    data-testid="mod-row"
                    data-mod-id={e.id}
                    className={`mod-row mod-grid ${selected === e.id ? "selected" : ""} ${!e.enabled ? "disabled-mod" : ""} ${m.missing ? "missing-mod" : ""}`}
                    onClick={() => {
                      setSelected(e.id);
                      setAfterTarget("");
                    }}
                    tabIndex={selected === e.id ? 0 : -1}
                    draggable
                    onDragStart={(event) => {
                      dragId.current = e.id;
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", e.id);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragId.current) {
                        move(
                          dragId.current,
                          draft.entries.findIndex((x) => x.id === e.id),
                        );
                        dragId.current = null;
                      }
                    }}
                    onDragEnd={() => (dragId.current = null)}
                    onKeyDown={(event) => {
                      if (event.target.tagName === "INPUT") return;
                      if (event.key === " ") {
                        event.preventDefault();
                        toggle(e.id);
                      }
                      if (
                        !event.ctrlKey &&
                        ["ArrowUp", "ArrowDown"].includes(event.key)
                      ) {
                        event.preventDefault();
                        const next =
                          filtered[i + (event.key === "ArrowUp" ? -1 : 1)];
                        if (next) {
                          setSelected(next.id);
                          event.currentTarget.parentElement
                            .querySelectorAll('[data-testid="mod-row"]')
                            [i + (event.key === "ArrowUp" ? -1 : 1)]?.focus();
                        }
                      }
                    }}
                  >
                    <span role="cell">
                      <input
                        type="checkbox"
                        aria-label={`Enable ${e.name}`}
                        checked={e.enabled}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => toggle(e.id)}
                      />
                    </span>
                    <span role="cell" className="order-number">
                      {positions.get(e.id) || "—"}
                    </span>
                    <span role="cell" className="mod-name" title={e.name}>
                      <span className="name-text">{displayName(e.name)}</span>
                      {draft.rules[e.id]?.pinned && (
                        <Pin size={15} className="pin-indicator" />
                      )}
                      {problems.length > 0 && (
                        <AlertTriangle
                          size={16}
                          className="warning"
                          aria-label={`${problems.length} warnings`}
                          title={problems.map((p) => p.message).join("\n")}
                        />
                      )}
                    </span>
                    <span role="cell">
                      {c.kind !== "normal" ? (
                        <span className={`badge ${c.kind}`} title={c.reason}>
                          {c.kind === "last" ? "Load last" : "Patch"}
                        </span>
                      ) : (
                        <span className="muted sorting-default">—</span>
                      )}
                    </span>
                    <span
                      role="cell"
                      className={`source ${m.missing ? "warning" : ""}`}
                    >
                      {m.source}
                    </span>
                  </div>
                );
              })}
              {!filtered.length && (
                <div className="empty-state">
                  <Search size={30} />
                  <h3>No mods found</h3>
                  <p>Try another search or filter.</p>
                  <button
                    onClick={() => {
                      setSearch("");
                      setFilter("all");
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </div>
            <footer className="list-footer">
              <div className="undo-controls">
                <IconButton
                  label="Undo (Ctrl Z)"
                  onClick={undo}
                  disabled={!history.length || !!busy}
                >
                  <Undo2 />
                </IconButton>
                <IconButton
                  label="Redo (Ctrl Shift Z)"
                  onClick={redo}
                  disabled={!future.length || !!busy}
                >
                  <Redo2 />
                </IconButton>
              </div>
              <span>{sessionStatus}</span>
              <button
                className="text-button"
                onClick={() => setModal({ type: "reload" })}
              >
                <RefreshCw size={14} />
                Reload from game
              </button>
            </footer>
          </section>
          {details && (
            <aside className="inspector" aria-label="Mod details">
              {mod && entry ? (
                <>
                  <div className="inspector-heading">
                    <span className="eyebrow">MOD DETAILS</span>
                    <span className={`badge ${entry.enabled ? "on" : "off"}`}>
                      {entry.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <h2>{displayName(entry.name)}</h2>
                  <p className="author">
                    {mod.author
                      ? `by ${mod.author}`
                      : mod.missing
                        ? "File not installed"
                        : "Author not specified"}
                  </p>
                  <div className="detail-links">
                    {mod.workshopId && (
                      <button
                        onClick={() =>
                          run("Opening Workshop", () => api.workshop(mod.id))
                        }
                      >
                        <ExternalLink size={15} />
                        Workshop
                      </button>
                    )}
                    {!mod.missing && (
                      <button
                        onClick={() =>
                          run("Opening folder", () => api.openFolder(mod.id))
                        }
                      >
                        <FolderOpen size={15} />
                        Files
                      </button>
                    )}
                  </div>
                  <section className="inspector-section">
                    <h3>
                      Position{" "}
                      <span>
                        {entry.enabled
                          ? `${positions.get(entry.id)} of ${active.length}`
                          : "Not in active order"}
                      </span>
                    </h3>
                    <div className="position-controls">
                      <IconButton
                        label="Move to top"
                        onClick={() => moveActive("first")}
                      >
                        <ChevronsUp />
                      </IconButton>
                      <IconButton
                        label="Move up"
                        onClick={() => moveActive(-1)}
                      >
                        <ChevronUp />
                      </IconButton>
                      <IconButton
                        label="Move down"
                        onClick={() => moveActive(1)}
                      >
                        <ChevronDown />
                      </IconButton>
                      <IconButton
                        label="Move to bottom"
                        onClick={() => moveActive("last")}
                      >
                        <ChevronsDown />
                      </IconButton>
                      <button
                        className={
                          rule.pinned ? "pin-button pinned" : "pin-button"
                        }
                        aria-pressed={rule.pinned}
                        onClick={() => setRule({ pinned: !rule.pinned })}
                      >
                        <Pin size={15} />
                        {rule.pinned ? "Pinned" : "Pin"}
                      </button>
                    </div>
                    {entry.enabled && (
                      <form
                        className="jump-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const target = Number(jump);
                          if (
                            Number.isInteger(target) &&
                            target > 0 &&
                            target <= active.length
                          ) {
                            move(
                              selected,
                              draft.entries.findIndex(
                                (x) => x.id === active[target - 1].id,
                              ),
                            );
                            setJump("");
                          }
                        }}
                      >
                        <label htmlFor="jump">Move to</label>
                        <input
                          id="jump"
                          aria-label="Target load order position"
                          type="number"
                          min="1"
                          max={active.length}
                          placeholder="#"
                          value={jump}
                          onChange={(e) => setJump(e.target.value)}
                        />
                        <button type="submit">Go</button>
                      </form>
                    )}
                    <p className="helper">
                      Drag a row or use Ctrl ↑ / ↓. A pin keeps this position
                      during autosort.
                    </p>
                  </section>
                  {(issueMap.get(selected)?.length > 0 || mod.error) && (
                    <section className="inspector-section issue-section">
                      <h3>
                        <AlertTriangle size={16} />
                        Needs attention
                      </h3>
                      {(issueMap.get(selected) || [{ message: mod.error }]).map(
                        (issue, i) => (
                          <p key={i}>{issue.message}</p>
                        ),
                      )}
                    </section>
                  )}
                  <section className="inspector-section">
                    <h3>Sorting rule</h3>
                    <select
                      aria-label="Sorting rule"
                      value={rule.kind}
                      onChange={(e) => setRule({ kind: e.target.value })}
                    >
                      <option value="auto">Automatic detection</option>
                      <option value="normal">Standard mod</option>
                      <option value="patch">Patch — load late</option>
                      <option value="last">Load last</option>
                    </select>
                    <p className="helper">
                      <span className="rule-result">
                        {classes.get(selected)?.kind === "normal"
                          ? "Standard mod"
                          : classes.get(selected)?.kind === "last"
                            ? "Load last"
                            : "Patch"}
                      </span>{" "}
                      · {classes.get(selected)?.reason}. Dependencies always
                      come first.
                    </p>
                    <label className="field-label" htmlFor="after-target">
                      Always load after
                    </label>
                    <div className="after-form">
                      <select
                        id="after-target"
                        value={afterTarget}
                        onChange={(e) => setAfterTarget(e.target.value)}
                      >
                        <option value="">Choose a mod…</option>
                        {active
                          .filter((e) => e.id !== selected)
                          .map((e) => (
                            <option key={e.id} value={e.name}>
                              {displayName(e.name)}
                            </option>
                          ))}
                      </select>
                      <IconButton
                        label="Add load-after rule"
                        disabled={
                          !afterTarget ||
                          (rule.after || []).includes(afterTarget)
                        }
                        onClick={() => {
                          setRule({
                            after: [...(rule.after || []), afterTarget],
                          });
                          setAfterTarget("");
                        }}
                      >
                        <Plus />
                      </IconButton>
                    </div>
                    {rule.after.map((name) => (
                      <div className="rule-row" key={name}>
                        <span>{displayName(name)}</span>
                        <IconButton
                          label={`Remove rule for ${name}`}
                          onClick={() =>
                            setRule({
                              after: rule.after.filter((x) => x !== name),
                            })
                          }
                        >
                          <X size={14} />
                        </IconButton>
                      </div>
                    ))}
                  </section>
                  <section className="inspector-section">
                    <h3>
                      Dependencies <span>{mod.dependencies?.length || 0}</span>
                    </h3>
                    {mod.dependencies?.length ? (
                      mod.dependencies.map((name) => (
                        <button
                          className={`dependency ${!positions.has(key(name)) ? "warning" : ""}`}
                          key={name}
                          onClick={() => {
                            if (mods.has(key(name))) showMod(key(name));
                          }}
                          title={
                            positions.has(key(name))
                              ? "Select dependency"
                              : "Required mod is missing or disabled"
                          }
                        >
                          <span className="dependency-state">
                            {positions.has(key(name)) ? (
                              <Check size={14} />
                            ) : (
                              <AlertTriangle size={14} />
                            )}
                          </span>
                          <span>{displayName(name)}</span>
                          <ArrowRight size={14} />
                        </button>
                      ))
                    ) : (
                      <p className="helper">
                        No additional dependencies declared.
                      </p>
                    )}
                    {mod.references?.length > 0 && (
                      <>
                        <h4>Optional references</h4>
                        {mod.references.map((name) => (
                          <div className="reference" key={name}>
                            {displayName(name)}
                            <small>
                              {positions.has(key(name))
                                ? "Enabled · sorted before this mod"
                                : "Not enabled"}
                            </small>
                          </div>
                        ))}
                      </>
                    )}
                  </section>
                  {mod.description && (
                    <section className="inspector-section">
                      <h3>Author’s description</h3>
                      <p className="description">
                        {mod.description.replace(
                          /\[(?:\/?(?:b|i|u|h[1-6]|list|olist|\*|hr|quote)|\/?url[^\]]*)\]/gi,
                          "",
                        )}
                      </p>
                    </section>
                  )}
                  <div className="filename">{entry.name}</div>
                </>
              ) : (
                <div className="empty-state">
                  <Info />
                  <p>
                    Select a mod to view its dependencies and sorting rules.
                  </p>
                </div>
              )}
            </aside>
          )}
        </div>
        <footer className="statusbar">
          <span>
            {busy ? (
              <>
                <span className="small-dot" />
                {busy}…
              </>
            ) : (
              notice || "Mods at the bottom load later and take priority."
            )}
          </span>
          <button onClick={() => setModal({ type: "launch" })}>
            <Play size={14} />
            Launch Kenshi
          </button>
        </footer>
      </main>
      {modal?.type === "save" && (
        <Modal
          title={modal.asNew ? "Save a new list" : "Save mod list"}
          onClose={() => setModal(null)}
          footer={
            <>
              <button onClick={() => setModal(null)}>Cancel</button>
              <button
                className="primary"
                disabled={!profileName.trim() || !!busy}
                onClick={() =>
                  run("Saving list", async () => {
                    const result = await api.saveProfile({
                      id: modal.asNew ? null : activeProfile,
                      name: profileName,
                      draft,
                    });
                    setState((s) => ({ ...s, profiles: result.profiles }));
                    setActiveProfile(result.profile.id);
                    setModal(null);
                    setNotice(`Saved “${result.profile.name}”.`);
                  })
                }
              >
                <Save />
                Save list
              </button>
            </>
          }
        >
          <p>
            Save enabled states, load order, and your sorting rules. You can
            load this setup again for another playthrough.
          </p>
          <label className="field-label" htmlFor="profile-name">
            List name
          </label>
          <input
            autoFocus
            id="profile-name"
            value={profileName}
            maxLength={100}
            onChange={(e) => setProfileName(e.target.value)}
          />
          <div className="summary-line">
            <strong>{active.length}</strong> enabled mods <span>·</span>{" "}
            {Object.keys(draft.rules).length} custom rules
          </div>
          {profile && !modal.asNew && (
            <button
              className="text-button"
              onClick={() => setModal({ ...modal, asNew: true })}
            >
              Save as a separate list instead
            </button>
          )}
        </Modal>
      )}
      {modal?.type === "scanning" && (
        <Modal
          title="Reading mod records"
          onClose={() => {
            analysisRequest.current++;
            setModal(null);
          }}
        >
          <p>
            Checking fields, equipment and vendor lists, and record
            dependencies. Large libraries may take a few seconds.
          </p>
          <p className="helper">
            You can close this window; no load order changes will be accepted.
          </p>
        </Modal>
      )}
      {modal?.type === "sort" && (
        <Modal
          wide
          title="Review autosort"
          onClose={() => setModal(null)}
          footer={
            <>
              <span className="footer-note">
                Only changes your working draft.
              </span>
              <button onClick={() => setModal(null)}>Cancel</button>
              <button
                className="primary"
                disabled={
                  !modal.result.ok ||
                  !modal.result.moves.length ||
                  ((modal.result.analysis.changedCount > 0 ||
                    modal.result.analysis.summary.incomplete.length > 0) &&
                    !reviewedOverwrites)
                }
                onClick={() => {
                  commit(
                    modal.result.draft,
                    "Autosort accepted. Review your draft, then apply to game when ready.",
                  );
                  setModal(null);
                }}
              >
                <Check />
                Accept order
              </button>
            </>
          }
        >
          <p>
            Dependencies and records a mod needs load first. Existing overwrite
            order is preserved where those dependencies and your rules allow it.
            Patch labels only move mods where they will not change those
            choices.
          </p>
          <div className="sort-summary">
            <span>
              <strong>{modal.result.analysis.summary.scanned}</strong> /{" "}
              {modal.result.analysis.summary.total} files read
            </span>
            <span>
              <strong>{modal.result.analysis.inferred.length}</strong> record
              dependency links
            </span>
            <span>
              <strong>
                {modal.result.analysis.changedCount.toLocaleString()}
              </strong>{" "}
              overwrite values change
            </span>
          </div>
          {(modal.result.analysis.changedCount > 0 ||
            modal.result.analysis.summary.incomplete.length > 0) && (
            <div className="record-review-warning">
              <p>
                {modal.result.analysis.changedCount > 0
                  ? "Dependencies or your rules require changing existing overwrite choices. Review the affected records below."
                  : "Some files could not be fully analyzed. Their positions are kept where possible."}
              </p>
              {modal.result.analysis.summary.incomplete.length > 0 && (
                <details>
                  <summary>
                    Scan limitations (
                    {modal.result.analysis.summary.incomplete.length})
                  </summary>
                  <ul>
                    {modal.result.analysis.summary.incomplete.map((item, i) => (
                      <li key={i}>
                        <strong>{mods.get(item.id)?.name || item.id}</strong>:{" "}
                        {item.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={reviewedOverwrites}
                  onChange={(e) => setReviewedOverwrites(e.target.checked)}
                />{" "}
                I reviewed the overwrite changes and scan limitations
              </label>
            </div>
          )}
          {modal.result.analysis.issues.length > 0 && (
            <details className="record-issues">
              <summary>
                Record dependency warnings (
                {modal.result.analysis.issues.length})
              </summary>
              <ul>
                {modal.result.analysis.issues.map((issue, i) => (
                  <li key={i}>
                    <strong>{mods.get(issue.id)?.name || issue.id}</strong>:{" "}
                    {issue.message} ({issue.count})
                    <small>{issue.examples.join(" · ")}</small>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {modal.result.analysis.inferred.length > 0 && (
            <details className="record-issues">
              <summary>
                Detected record dependencies (
                {modal.result.analysis.inferred.length})
              </summary>
              <ul>
                {modal.result.analysis.inferred.map((edge, i) => (
                  <li key={i}>
                    <strong>{mods.get(edge.from)?.name || edge.from}</strong>{" "}
                    before <strong>{mods.get(edge.to)?.name || edge.to}</strong>
                    <small>{edge.examples.join(" · ")}</small>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!modal.result.ok ? (
            <div className="cycle-warning">
              <h3>
                <AlertTriangle />
                Conflicting order rules
              </h3>
              <p>{modal.result.message}</p>
              {modal.result.cycle.map((id) => (
                <button
                  key={id}
                  className="dependency"
                  onClick={() => showMod(id)}
                >
                  {displayName(mods.get(id)?.name || id)}
                  <ArrowRight size={16} />
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="sort-summary">
                <span>
                  <strong>{modal.result.moves.length}</strong> positions change
                </span>
                <span>
                  <strong>{modal.result.patchCount}</strong> patches / late mods
                </span>
                <span>
                  <strong>{active.length}</strong> enabled mods kept
                </span>
              </div>
              <p className="helper">
                This reads .mod records. It does not check textures, meshes,
                external level files, scripts, or existing save state. Sorting
                cannot merge incompatible edits or restore missing assets.
              </p>
              {modal.result.issues.some((i) => i.type !== "order") && (
                <div className="inline-warning">
                  <AlertTriangle size={18} />
                  {
                    modal.result.issues.filter((i) => i.type !== "order").length
                  }{" "}
                  existing dependency or file warnings remain. Sorting cannot
                  install or enable missing requirements.
                </div>
              )}
              <details
                className="sort-moves"
                open={modal.result.analysis.conflictCount === 0}
              >
                <summary>
                  Load order changes ({modal.result.moves.length})
                </summary>
                <div className="sort-table">
                  <div className="sort-row sort-head">
                    <span>Mod</span>
                    <span>Before</span>
                    <span>After</span>
                  </div>
                  {modal.result.moves.map((move) => (
                    <div className="sort-row" key={move.id}>
                      <div>
                        <strong>{displayName(move.name)}</strong>
                        <small>{move.reason}</small>
                      </div>
                      <span>{move.from}</span>
                      <span className={move.kind !== "normal" ? "accent" : ""}>
                        {move.to}
                      </span>
                    </div>
                  ))}
                  {!modal.result.moves.length && (
                    <div className="empty-state">
                      <Check />
                      <h3>No changes needed</h3>
                      <p>Your order already meets these rules.</p>
                    </div>
                  )}
                </div>
              </details>
            </>
          )}
          <OverwriteReview
            analysis={modal.result.analysis}
            mods={mods}
            onPrefer={preferOverwrite}
          />
        </Modal>
      )}
      {modal?.type === "apply" && (
        <Modal
          title="Apply this load order?"
          onClose={() => setModal(null)}
          footer={
            <>
              <button onClick={() => setModal(null)}>Cancel</button>
              <button
                className="primary"
                disabled={!!busy}
                onClick={() =>
                  run("Applying load order", async () => {
                    const result = await api.apply({
                      draft,
                      fingerprint: state.fingerprint,
                    });
                    setState((s) => ({
                      ...s,
                      fingerprint: result.fingerprint,
                      currentFingerprint: result.fingerprint,
                      gameEntries: result.gameEntries,
                    }));
                    setModal(null);
                    setNotice(
                      "Load order applied. A backup of the previous configuration was saved.",
                    );
                  })
                }
              >
                <Check />
                Apply {active.length} mods
              </button>
            </>
          }
        >
          <p>
            Kenshi will use this order the next time it loads. Your previous{" "}
            <code>mods.cfg</code> will be backed up first.
          </p>
          <div className="apply-diff">
            <div>
              <span>Enabled</span>
              <strong>{active.length}</strong>
            </div>
            <div>
              <span>Newly enabled</span>
              <strong>
                {
                  active.filter(
                    (e) => !state.gameEntries.some((g) => g.id === e.id),
                  ).length
                }
              </strong>
            </div>
            <div>
              <span>Disabled</span>
              <strong>
                {state.gameEntries.filter((g) => !positions.has(g.id)).length}
              </strong>
            </div>
          </div>
          {graph.issues.length > 0 && (
            <div className="inline-warning">
              <AlertTriangle />
              <span>
                {graph.issues.length} warnings remain across {issueMap.size}{" "}
                mods. Applying does not resolve dependency or compatibility
                issues.
              </span>
            </div>
          )}
          {!active.length && (
            <p className="error">
              This will disable every mod. Only apply if you intend to play
              without mods.
            </p>
          )}
          <p className="helper">
            Close Kenshi’s launcher before applying so it cannot overwrite your
            changes.
          </p>
        </Modal>
      )}
      {modal?.type === "reload" && (
        <Modal
          title="Reload the game’s load order?"
          onClose={() => setModal(null)}
          footer={
            <>
              <button onClick={() => setModal(null)}>Cancel</button>
              <button
                className="primary"
                onClick={() =>
                  run("Reloading game order", async () => {
                    const next = await api.reloadGame();
                    commit(
                      next.draft,
                      "Loaded the game’s current configuration. Undo restores your previous draft.",
                    );
                    setState(next);
                    setActiveProfile(null);
                    setModal(null);
                  })
                }
              >
                Reload order
              </button>
            </>
          }
        >
          <p>
            Replace your working draft with the current <code>mods.cfg</code>.
            Saved lists stay available. You can undo this change during this
            session.
          </p>
        </Modal>
      )}
      {modal?.type === "bulk" && (
        <Modal
          title="Selected mod actions"
          onClose={() => setModal(null)}
          footer={<button onClick={() => setModal(null)}>Cancel</button>}
        >
          <p>
            These actions affect the <strong>{filtered.length} mods</strong>{" "}
            selected by your current search and filter. You can undo them.
          </p>
          <div className="bulk-actions">
            <button onClick={() => bulk(true)}>
              <CheckSquare />
              Enable selected mods
            </button>
            <button onClick={() => bulk(false)}>
              <X />
              Disable selected mods
            </button>
          </div>
        </Modal>
      )}
      {modal?.type === "export" && (
        <Modal
          title="Export your mod list"
          onClose={() => setModal(null)}
          footer={<button onClick={() => setModal(null)}>Cancel</button>}
        >
          <p>Share the current draft or keep a portable copy.</p>
          <button
            className="export-option"
            onClick={() =>
              run("Exporting", async () => {
                const result = await api.export({
                  draft,
                  format: "json",
                  name: profile?.name,
                });
                if (result) {
                  setModal(null);
                  setNotice(`Exported to ${result}`);
                }
              })
            }
          >
            <Upload />
            <span>
              <strong>Complete mod list (.json)</strong>
              <small>Order, enabled states, pins, and custom rules</small>
            </span>
            <ArrowRight />
          </button>
          <button
            className="export-option"
            onClick={() =>
              run("Exporting", async () => {
                const result = await api.export({ draft, format: "cfg" });
                if (result) {
                  setModal(null);
                  setNotice(`Exported to ${result}`);
                }
              })
            }
          >
            <List />
            <span>
              <strong>Kenshi load order (.cfg)</strong>
              <small>Enabled mod filenames, in order</small>
            </span>
            <ArrowRight />
          </button>
        </Modal>
      )}
      {modal?.type === "settings" && (
        <Modal
          title="Settings & backups"
          onClose={() => setModal(null)}
          footer={<button onClick={() => setModal(null)}>Done</button>}
        >
          <h3>Game folder</h3>
          <p className="path-text">{state.gamePath}</p>
          <button
            onClick={() =>
              run("Choosing game folder", async () => {
                const next = await api.chooseGame();
                if (next) {
                  installSnapshot(next, true);
                  setModal(null);
                }
              })
            }
          >
            <FolderOpen />
            Change game folder
          </button>
          <h3>Configuration backups</h3>
          <p>
            A timestamped backup is saved before each application of a load
            order. To restore one, import its .cfg file and apply it.
          </p>
          <button
            onClick={() =>
              run("Opening backups", async () => {
                const error = await api.openBackups();
                if (error)
                  throw new Error(
                    "No backups yet. A backup is created when you first apply a load order.",
                  );
              })
            }
          >
            <FolderOpen />
            Open backups
          </button>
          <h3>Saved lists</h3>
          {state.profiles.length ? (
            state.profiles.map((p) => (
              <div className="settings-profile" key={p.id}>
                <span>{p.name}</span>
                <IconButton
                  label={`Delete ${p.name}`}
                  onClick={() => setModal({ type: "delete", profile: p })}
                >
                  <Trash2 size={17} />
                </IconButton>
              </div>
            ))
          ) : (
            <p>No named lists yet.</p>
          )}
          {state.warnings.length > 0 && (
            <>
              <h3>Library scan notes</h3>
              {state.warnings.map((w) => (
                <p key={w} className="helper">
                  {w}
                </p>
              ))}
            </>
          )}
        </Modal>
      )}
      {modal?.type === "delete" && (
        <Modal
          title="Delete saved list?"
          onClose={() => setModal(null)}
          footer={
            <>
              <button onClick={() => setModal(null)}>Cancel</button>
              <button
                className="danger"
                onClick={() =>
                  run("Deleting saved list", async () => {
                    const profiles = await api.deleteProfile(modal.profile.id);
                    setState((s) => ({ ...s, profiles }));
                    if (activeProfile === modal.profile.id)
                      setActiveProfile(null);
                    setModal(null);
                  })
                }
              >
                Delete list
              </button>
            </>
          }
        >
          <p>
            Delete “{modal.profile.name}”? This removes the saved list only.
            Your working draft and installed mods are kept.
          </p>
        </Modal>
      )}
      {modal?.type === "launch" && (
        <Modal
          title="Launch Kenshi"
          onClose={() => setModal(null)}
          footer={
            <>
              <button onClick={() => setModal(null)}>Cancel</button>
              <button
                className="primary"
                onClick={() =>
                  run("Launching Kenshi", async () => {
                    await api.launch();
                    setModal(null);
                  })
                }
              >
                <Play />
                Launch via Steam
              </button>
            </>
          }
        >
          <p>
            {dirty
              ? "Your draft has unapplied changes. Kenshi will use the order currently saved in the game, not this draft. Cancel and apply first if you want these changes."
              : "Launch Kenshi through Steam using the applied load order."}
          </p>
        </Modal>
      )}
    </div>
  );
}
