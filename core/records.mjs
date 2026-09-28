// Read-only Kenshi format 16/17 decoder. See design/RECORDS.md for provenance.
export const RECORD_LIMITS = {
  bytes: 256 * 1024 * 1024,
  records: 500000,
  values: 5000000,
};
const decoder = new TextDecoder("utf-8", { fatal: true });

export function parseRecords(bytes) {
  if (bytes.length > RECORD_LIMITS.bytes)
    throw new Error("Mod exceeds the 256 MiB scan limit.");
  let offset = 0,
    budget = RECORD_LIMITS.values;
  const need = (size) => {
    if (size < 0 || offset + size > bytes.length)
      throw new Error(`Truncated mod data at byte ${offset}.`);
  };
  const int = () => {
    need(4);
    const n = bytes.readInt32LE(offset);
    offset += 4;
    return n;
  };
  const byte = () => {
    need(1);
    return bytes[offset++];
  };
  const count = (minimum = 1) => {
    const n = int();
    if (n < 0 || n > budget || n * minimum > bytes.length - offset)
      throw new Error(`Invalid count at byte ${offset - 4}.`);
    budget -= n;
    return n;
  };
  const string = () => {
    const n = int();
    if (n > 16 * 1024 * 1024)
      throw new Error("Mod string exceeds the scan limit.");
    need(n);
    const s = decoder.decode(bytes.subarray(offset, offset + n));
    offset += n;
    return s;
  };
  const float = () => {
    need(4);
    const n = bytes.readFloatLE(offset);
    offset += 4;
    return Number.isFinite(n)
      ? n
      : `float:${bytes.subarray(offset - 4, offset).toString("hex")}`;
  };
  const format = int();
  if (format !== 16 && format !== 17)
    throw new Error(`Unsupported record format ${format}.`);
  const headerEnd = format === 17 ? int() + 8 : null;
  int(); // Mod version.
  const author = string(),
    description = string(),
    dependencies = string(),
    references = string();
  const warnings = [];
  if (headerEnd !== null) {
    if (headerEnd < offset || headerEnd > bytes.length - 8)
      throw new Error("Invalid format-17 header length.");
    // Merge bookkeeping is not an ordering hint. Delete requests need a merge-aware loader.
    if (offset < headerEnd) {
      int();
      int();
      const merges = byte();
      for (let i = 0; i < merges; i++) {
        string();
        int();
        int();
      }
      if (offset < headerEnd) {
        const deletions = byte();
        for (let i = 0; i < deletions; i++) {
          string();
          int();
          string();
        }
        if (deletions)
          warnings.push(
            "Header contains merge deletion requests; their effects are not modeled.",
          );
      }
      if (offset !== headerEnd)
        throw new Error("Unknown format-17 header extension.");
    }
    offset = headerEnd;
  }
  int(); // Next record ID.
  const total = count(56);
  if (total > RECORD_LIMITS.records)
    throw new Error("Too many records to scan.");
  const records = [],
    seen = new Set();
  for (let i = 0; i < total; i++) {
    int(); // Serialized size / instance bookkeeping, not an array count.
    const type = int();
    int();
    const name = string(),
      id = string(),
      flags = int() >>> 0;
    if (!id || seen.has(id))
      throw new Error(`Empty or duplicate record ID: ${id.slice(0, 100)}`);
    seen.add(id);
    const fields = [],
      targets = new Set();
    const readers = [
      () => byte() !== 0,
      float,
      int,
      () => [float(), float(), float()],
      () => [float(), float(), float(), float()],
      string,
      string,
    ];
    const kinds = [
      "bool",
      "float",
      "int",
      "vector3",
      "vector4",
      "string",
      "file",
    ];
    let removed = false;
    for (let section = 0; section < readers.length; section++) {
      const n = count(5);
      for (let j = 0; j < n; j++) {
        const key = string(),
          value = readers[section]();
        if (section === 0 && key === "REMOVED" && value) removed = true;
        fields.push({
          key: JSON.stringify(["value", key]),
          label: key,
          kind: kinds[section],
          value,
        });
      }
    }
    const categories = count(8);
    for (let j = 0; j < categories; j++) {
      const category = string(),
        n = count(16);
      for (let k = 0; k < n; k++) {
        const target = string(),
          value = [int(), int(), int()];
        const deleted = value[2] === 2147483647;
        fields.push({
          key: JSON.stringify(["reference", category, target]),
          label: `${category} → ${target}`,
          kind: "reference",
          target,
          deleted,
          value: deleted ? "Removed" : value,
        });
        if (!deleted && target) targets.add(target);
      }
    }
    const instances = count(40);
    for (let j = 0; j < instances; j++) {
      const instance = string(),
        target = string();
      const transform = Array.from({ length: 7 }, float);
      const states = Array.from({ length: count(4) }, string);
      fields.push({
        key: JSON.stringify(["instance", instance]),
        label: `Instance ${instance}`,
        kind: "instance",
        target,
        deleted: !target,
        value: target ? { target, transform } : "Removed",
      });
      if (target) targets.add(target);
      // Instance states are additive references, not a replace-all array.
      for (const state of new Set(states))
        if (state && target) {
          targets.add(state);
          fields.push({
            key: JSON.stringify(["instance-state", instance, state]),
            label: `Instance ${instance} state → ${state}`,
            kind: "reference",
            target: state,
            value: true,
          });
        }
    }
    const newRecord = !(flags & 1);
    // The name is stored even for edits, so equal names are filtered like equal values.
    fields.push({
      key: '["name"]',
      label: "Name",
      kind: "string",
      value: name,
    });
    if (new Set(fields.map((f) => f.key)).size !== fields.length)
      throw new Error(`Duplicate field in record ${id}.`);
    records.push({
      id,
      type,
      name,
      flags,
      newRecord,
      removed,
      fields,
      targets: [...targets],
    });
  }
  if (offset !== bytes.length)
    throw new Error(
      `Unrecognized trailing data (${bytes.length - offset} bytes).`,
    );
  return {
    format,
    author,
    description,
    dependencies,
    references,
    records,
    warnings,
  };
}
