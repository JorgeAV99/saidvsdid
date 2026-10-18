// Tables looked up by names that come from what saidvsdid reads — the analysed code, a config file, a
// transcript, a runner's output, the Python scope reader's reply. A plain object answers for the members of
// `Object.prototype` too (`toString`, `constructor`, `valueOf`, `__proto__`…): `MARK_KINDS['constructor']`
// is `Object`, so `@pytest.mark.constructor` read as a marker. Every such table is therefore built here,
// without a prototype, and registered (`test/name-tables.test.ts` walks every one, and checks that no
// object literal of the sources typed with a string index escapes `nameTable`); a parsed record looked up by
// such a name goes through `ownRecord`. Sets and Maps need nothing.

const registry = new Map<string, object>();

/** A lookup table with no prototype, frozen, registered under `id`: only its own keys answer. */
export function nameTable<T extends object>(id: string, entries: T): Readonly<T> {
  const table = Object.freeze(Object.assign(Object.create(null) as T, entries));
  registry.set(id, table);
  return table;
}

/** Every table built by `nameTable`, by id (for `test/name-tables.test.ts`). */
export function nameTables(): ReadonlyMap<string, object> {
  return registry;
}

/** A parsed record (JSON) as a lookup table: its own properties only, no prototype. */
export function ownRecord<V>(record: Readonly<Record<string, V>>): Record<string, V> {
  return Object.assign(Object.create(null) as Record<string, V>, record);
}
