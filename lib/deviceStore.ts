// IndexedDB keeps compressed photos off the synchronous localStorage path.
export async function deviceStore<T>(action: "get" | "put" | "delete" | "all", key = "", value?: T): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("hotel-work", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Stockage de cet appareil indisponible. Ne fermez pas le formulaire."));
  });
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
