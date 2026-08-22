/**
 * A small promise wrapper over IndexedDB.
 *
 * IndexedDB's event-based API is unpleasant to use directly and every wrapper library brings more
 * than this project needs (ADR 7). What is actually required is: open with a migration, get, put,
 * delete, read an index, and run a transaction that either commits or throws. That is this file.
 */

export interface StoreSchema {
  name: string;
  keyPath: string;
  indexes?: { name: string; keyPath: string | string[]; unique?: boolean }[];
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export function openDatabase(
  name: string,
  version: number,
  stores: StoreSchema[],
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, version);

    open.onupgradeneeded = () => {
      const db = open.result;
      for (const schema of stores) {
        const store = db.objectStoreNames.contains(schema.name)
          ? open.transaction!.objectStore(schema.name)
          : db.createObjectStore(schema.name, { keyPath: schema.keyPath });
        for (const index of schema.indexes ?? []) {
          if (!store.indexNames.contains(index.name)) {
            store.createIndex(index.name, index.keyPath, { unique: index.unique ?? false });
          }
        }
      }
    };

    open.onsuccess = () => {
      const db = open.result;
      // Another tab upgrading the schema must not be blocked by this connection.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    open.onerror = () => reject(open.error ?? new Error('Failed to open IndexedDB'));
    open.onblocked = () =>
      reject(new Error('IndexedDB upgrade is blocked by another tab holding the database open'));
  });
}

/**
 * Runs `work` inside one transaction and resolves when it actually commits.
 *
 * Resolving on the transaction's `complete` event rather than on the callback's return value is
 * the difference between "the writes were requested" and "the writes are durable" — a distinction
 * that matters when a file move touches several records.
 */
export function transact<T>(
  db: IDBDatabase,
  storeNames: string | string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result: T;
    let failed = false;

    tx.oncomplete = () => {
      if (!failed) resolve(result);
    };
    tx.onerror = () => reject(tx.error ?? new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));

    void (async () => {
      try {
        result = await work(tx);
      } catch (error) {
        failed = true;
        try {
          tx.abort();
        } catch {
          /* Already finished. */
        }
        reject(error);
      }
    })();
  });
}

export const idb = {
  get: <T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | undefined> =>
    request(store.get(key) as IDBRequest<T | undefined>),

  getAll: <T>(source: IDBObjectStore | IDBIndex, query?: IDBKeyRange | IDBValidKey): Promise<T[]> =>
    request(source.getAll(query) as IDBRequest<T[]>),

  put: (store: IDBObjectStore, value: unknown): Promise<IDBValidKey> =>
    request(store.put(value) as IDBRequest<IDBValidKey>),

  delete: (store: IDBObjectStore, key: IDBValidKey): Promise<undefined> =>
    request(store.delete(key) as IDBRequest<undefined>),

  count: (source: IDBObjectStore | IDBIndex, query?: IDBKeyRange): Promise<number> =>
    request(source.count(query) as IDBRequest<number>),

  clear: (store: IDBObjectStore): Promise<undefined> =>
    request(store.clear() as IDBRequest<undefined>),
};
