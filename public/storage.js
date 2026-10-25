// IndexedDB holds large public job descriptions and private decisions on-device.
// Existing localStorage boards migrate only after a successful durable write.
const key = () =>
  `shortlist:v1:${location.pathname.replace(/index\.html$/, "")}`;
async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(key(), 1);
    request.onupgradeneeded = () => request.result.createObjectStore("board");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          "Private browser storage could not be opened. Check this site’s storage permissions.",
        ),
      );
  });
}
async function access(mode, value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("board", mode);
      const store = tx.objectStore("board");
      const request =
        mode === "readonly" ? store.get("state") : store.put(value, "state");
      tx.oncomplete = () =>
        resolve(mode === "readonly" ? request.result : undefined);
      tx.onerror = tx.onabort = () =>
        reject(
          new Error(
            "Browser storage could not save this board. Free space or allow site storage; your previous board is unchanged.",
          ),
        );
    });
  } finally {
    db.close();
  }
}
export async function readBoard() {
  if (typeof indexedDB === "undefined") {
    const old = localStorage.getItem(key());
    return old ? JSON.parse(old) : null;
  }
  const current = await access("readonly");
  if (current) return current;
  const old = localStorage.getItem(key());
  if (!old) return null;
  const state = JSON.parse(old);
  await writeBoard(state);
  return state;
}
export async function writeBoard(state) {
  if (typeof indexedDB === "undefined") {
    try {
      localStorage.setItem(key(), JSON.stringify(state));
    } catch {
      throw new Error(
        "Browser storage is unavailable or full. Free space or try a smaller import; this change was not saved.",
      );
    }
  } else {
    await access("readwrite", state);
    localStorage.removeItem(key());
  }
}
