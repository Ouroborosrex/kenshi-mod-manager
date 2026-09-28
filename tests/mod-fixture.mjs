import fs from "node:fs/promises";
import path from "node:path";
const i = (n) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n | 0);
  return b;
};
const f = (n) => {
  const b = Buffer.alloc(4);
  b.writeFloatLE(n);
  return b;
};
const s = (value) => {
  const b = Buffer.from(value);
  return Buffer.concat([i(b.length), b]);
};
const list = (values, encode) =>
  Buffer.concat([i(values.length), ...values.map(encode)]);
export function modFile({
  format = 16,
  author = "Fixture author",
  description = "",
  dependencies = "",
  references = "",
  records = [],
  deleteRequests = [],
} = {}) {
  const header = Buffer.concat([
    i(1),
    s(author),
    s(description),
    s(dependencies),
    s(references),
  ]);
  const extended = Buffer.concat([
    header,
    i(1),
    i(0),
    Buffer.from([0, deleteRequests.length]),
    ...deleteRequests.map((x) =>
      Buffer.concat([s(x.mod), i(1), s(x.records.join(":"))]),
    ),
  ]);
  const encode = (r) =>
    Buffer.concat([
      i(0),
      i(r.type ?? 3),
      i(0),
      s(r.name || r.id),
      s(r.id),
      i(r.flags ?? 17),
      ...["bool", "float", "int", "vector3", "vector4", "string", "file"].map(
        (kind) =>
          list(Object.entries(r[kind] || {}), ([k, v]) =>
            Buffer.concat([
              s(k),
              kind === "bool"
                ? Buffer.from([v ? 1 : 0])
                : kind === "float"
                  ? f(v)
                  : kind === "int"
                    ? i(v)
                    : kind.startsWith("vector")
                      ? Buffer.concat(v.map(f))
                      : s(v),
            ]),
          ),
      ),
      list(Object.entries(r.refs || {}), ([category, values]) =>
        Buffer.concat([
          s(category),
          list(values, (v) =>
            Buffer.concat([s(v.target), ...(v.values || [1, 0, 0]).map(i)]),
          ),
        ]),
      ),
      list(r.instances || [], (v) =>
        Buffer.concat([
          s(v.id),
          s(v.target || ""),
          ...[0, 0, 0, 1, 0, 0, 0].map(f),
          list(v.states || [], s),
        ]),
      ),
    ]);
  return Buffer.concat([
    i(format),
    ...(format === 17 ? [i(extended.length), extended] : [header]),
    i(0),
    list(records, encode),
  ]);
}
export async function baseFiles(game, records = []) {
  await fs.mkdir(path.join(game, "data"), { recursive: true });
  for (const name of [
    "gamedata.base",
    "Newwworld.mod",
    "Dialogue.mod",
    "rebirth.mod",
  ])
    await fs.writeFile(
      path.join(game, "data", name),
      modFile({ records: name === "gamedata.base" ? records : [] }),
    );
}
