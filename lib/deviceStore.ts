async function openDeviceStore(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("hotel-work", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Stockage de cet appareil indisponible. Ne fermez pas le formulaire."));
  });
}

// IndexedDB keeps compressed photos off the synchronous localStorage path.
export async function deviceStore<T>(action: "get" | "put" | "delete" | "all", key = "", value?: T): Promise<T> {
  const db = await openDeviceStore();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("records", action === "get" || action === "all" ? "readonly" : "readwrite");
      const store = tx.objectStore("records");
      const request = action === "get" ? store.get(key) : action === "all" ? store.getAll(IDBKeyRange.bound("queue:", "queue:\uffff")) : action === "delete" ? store.delete(key) : store.put(value, key);
      tx.oncomplete = () => resolve(request.result as T);
      tx.onerror = () => reject(new Error("Impossible de sauvegarder sur cet appareil. Libérez de l’espace puis réessayez."));
      tx.onabort = () => reject(new Error("Sauvegarde locale interrompue. Réessayez."));
    });
  } finally { db.close(); }
}

type DeviceChange = { action: "put"; key: string; value: unknown } | { action: "delete"; key: string };

// Replacing a refused request must never lose the original before its replacement
// is durable, or leave both requests behind if the browser closes between writes.
export async function deviceStoreBatch(changes: DeviceChange[]): Promise<void> {
  if (!changes.length) return;
  const db = await openDeviceStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("records", "readwrite");
      const records = tx.objectStore("records");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error("Impossible de sauvegarder sur cet appareil. La demande précédente est conservée."));
      tx.onabort = () => reject(new Error("Sauvegarde locale interrompue. La demande précédente est conservée."));
      try {
        for (const change of changes) {
          if (change.action === "put") records.put(change.value, change.key);
          else records.delete(change.key);
        }
      } catch {
        tx.abort();
      }
    });
  } finally { db.close(); }
}
