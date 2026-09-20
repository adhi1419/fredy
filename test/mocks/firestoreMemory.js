/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Small Firestore-shaped in-memory store for unit tests that exercise storage behavior without
 * coupling the test to a SQL schema or a live emulator.
 *
 * @returns {{connection: Object, clear: Function, seed: Function, read: Function}}
 */
export function createFirestoreMemory() {
  const collections = new Map();

  const collectionMap = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  };

  const snapshotFor = (path, id) => {
    const values = collectionMap(path);
    const value = values.get(id);
    return {
      id,
      exists: value !== undefined,
      data: () => (value === undefined ? undefined : { ...value }),
      ref: documentRef(path, id),
    };
  };

  const documentRef = (path, id) => ({
    id,
    get: async () => snapshotFor(path, id),
    set: async (value) => {
      collectionMap(path).set(id, { ...value });
    },
    create: async (value) => {
      if (collectionMap(path).has(id)) throw Object.assign(new Error('Already exists'), { code: 6 });
      collectionMap(path).set(id, { ...value });
    },
    update: async (value) => {
      const current = collectionMap(path).get(id);
      if (current === undefined) throw new Error(`Missing document: ${path}/${id}`);
      collectionMap(path).set(id, { ...current, ...value });
    },
    delete: async () => {
      collectionMap(path).delete(id);
    },
    collection: (subcollection) => collectionRef(`${path}/${id}/${subcollection}`),
  });

  const matchingDocs = (path, filters) => {
    const values = collectionMap(path);
    return [...values.keys()]
      .filter((id) => {
        const value = values.get(id);
        return filters.every(({ field, operator, expected }) => {
          if (operator !== '==') throw new Error(`Unsupported test query operator: ${operator}`);
          return value?.[field] === expected;
        });
      })
      .map((id) => snapshotFor(path, id));
  };

  const queryRef = (path, filters = []) => ({
    where: (field, operator, expected) => queryRef(path, [...filters, { field, operator, expected }]),
    orderBy: () => queryRef(path, filters),
    get: async () => ({ docs: matchingDocs(path, filters), size: matchingDocs(path, filters).length }),
    count: () => ({ get: async () => ({ data: () => ({ count: matchingDocs(path, filters).length }) }) }),
  });

  const collectionRef = (path) => ({
    ...queryRef(path),
    doc: (id) => documentRef(path, id),
  });

  const batch = () => {
    const operations = [];
    return {
      set: (ref, value) => operations.push(() => ref.set(value)),
      update: (ref, value) => operations.push(() => ref.update(value)),
      delete: (ref) => operations.push(() => ref.delete()),
      commit: async () => {
        for (const operation of operations) await operation();
      },
    };
  };

  const connection = {
    collection: (name) => collectionRef(name),
    getConnection: () => connection,
    batch,
    recursiveDelete: async (ref) => ref.delete(),
    // Minimal transaction shim: reads and writes run against the same in-memory maps the rest of
    // the mock uses, so the ledger's reserve/finish transactions exercise their real read-modify-
    // write logic. It is intentionally serial (single-threaded tests), which is enough to prove the
    // state-machine guards; it does not simulate optimistic-concurrency retries.
    runTransaction: async (updateFn) => {
      const operationsQueue = [];
      const transaction = {
        get: async (ref) => ref.get(),
        set: (ref, value) => operationsQueue.push(() => ref.set(value)),
        update: (ref, value) => operationsQueue.push(() => ref.update(value)),
        delete: (ref) => operationsQueue.push(() => ref.delete()),
      };
      const result = await updateFn(transaction);
      for (const operation of operationsQueue) await operation();
      return result;
    },
  };

  return {
    connection,
    clear: () => collections.clear(),
    seed: (collection, id, value) => {
      collectionMap(collection).set(id, { ...value });
      return id;
    },
    read: (collection, id) => {
      const value = collectionMap(collection).get(id);
      return value === undefined ? undefined : { ...value };
    },
    list: (collection) => [...collectionMap(collection).entries()].map(([id, value]) => ({ id, ...value })),
  };
}
