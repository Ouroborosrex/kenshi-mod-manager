import React, { useEffect, useState } from "react";

export default function OverwriteReview({ analysis, mods, onPrefer }) {
  const [query, setQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(analysis.changedCount > 0);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let canceled = false;
    setPage(null);
    setError("");
    const timer = setTimeout(() => {
      window.manager
        .conflicts({ token: analysis.token, query, changedOnly, offset })
        .then((result) => {
          if (!canceled) setPage(result);
        })
        .catch((e) => {
          if (!canceled) setError(e.message);
        });
    }, 120);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [analysis.token, query, changedOnly, offset]);
  const name = (id) => mods.get(id)?.name || id;
  return (
    <section className="overwrite-review" aria-label="Record overwrites">
      <h3>
        Record overwrites{" "}
        <span className="muted">{analysis.conflictCount.toLocaleString()}</span>
      </h3>
      <p className="helper">
        Different values written to the same field or list entry. Separate
        additions to a shop or equipment list are allowed to coexist. These are
        conflicts to review, not proof that a mod is broken.
      </p>
      <div className="overwrite-tools">
        <input
          aria-label="Search record overwrites"
          placeholder="Search clothing, a mod, record, or field…"
          maxLength={500}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
        <label>
          <input
            type="checkbox"
            checked={changedOnly}
            onChange={(e) => {
              setChangedOnly(e.target.checked);
              setOffset(0);
            }}
          />{" "}
          Changed by this sort ({analysis.changedCount})
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {!page && !error && <p className="helper">Loading overwrites…</p>}
      {page?.results.map((conflict, i) => (
        <article className="overwrite-card" key={`${offset}-${i}`}>
          <header>
            <strong>{conflict.name}</strong>
            <span>{conflict.type}</span>
            {conflict.changed && (
              <span className="warning">Winner changes</span>
            )}
          </header>
          <p className="overwrite-field">{conflict.field}</p>
          <code className="record-id">{conflict.recordId}</code>
          {conflict.kind === "removal" && (
            <p className="helper warning">
              A mod deletes this record. Later edits may not restore it; inspect
              this combination in the FCS.
            </p>
          )}
          {conflict.writers.map((writer) => (
            <div
              className={`overwrite-value ${writer.mod === conflict.proposedWinner ? "winning" : ""}`}
              key={writer.mod}
            >
              <div>
                <strong>{name(writer.mod)}</strong>
                <small>
                  {writer.mod === conflict.currentWinner
                    ? "Current last writer"
                    : ""}
                  {writer.mod === conflict.proposedWinner
                    ? " · Last after sort"
                    : ""}
                </small>
              </div>
              <code>{writer.value}</code>
              {writer.mod !== conflict.proposedWinner &&
                conflict.kind !== "removal" && (
                  <button
                    onClick={() =>
                      onPrefer(
                        writer.mod,
                        conflict.writers.map((w) => w.mod),
                      )
                    }
                  >
                    Load this mod last
                  </button>
                )}
            </div>
          ))}
        </article>
      ))}
      {page && !page.total && (
        <p className="helper">No overwrites match this filter.</p>
      )}
      {page && page.total > 0 && (
        <div className="overwrite-pagination">
          <span>
            {offset + 1}–{Math.min(offset + 20, page.total)} of{" "}
            {page.total.toLocaleString()}
          </span>
          <button
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            Previous
          </button>
          <button
            disabled={offset + 20 >= page.total}
            onClick={() => setOffset(offset + 20)}
          >
            Next
          </button>
        </div>
      )}
      <p className="helper">
        “Load this mod last” adds a load-after rule for the other mods shown on
        that record and opens a new preview. It affects the whole mod, including
        its other records.
      </p>
    </section>
  );
}
