/**
 * CSVAT — IndexedDB TIFF Tile Storage.
 *
 * Stores downloaded GeoTIFF ArrayBuffers in IndexedDB for:
 *   - Offline caching (re-analysis without re-download)
 *   - Persistence across page refreshes
 *   - No RAM pressure from holding many TIFFs in memory
 *
 * Auto-cleanup: keeps only the most recent MAX_VILLAGES villages.
 * When a new village exceeds the limit, the oldest village's tiles are purged.
 */

const DB_NAME = 'csvat-tiff-store';
// Bump version whenever cached TIFF format or affine convention changes.
// The browser will drop the old store and start fresh on next open.
const DB_VERSION = 2;
const STORE_NAME = 'tiff-tiles';
const MAX_VILLAGES = 5;

// ─── Database helpers ───

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      // On version upgrade: drop the old store entirely so stale TIFFs
      // (downloaded with incorrect EPSG:4326 affine) don't poison future runs.
      if (event.oldVersion > 0 && db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
        console.info(`[TiffStore] DB upgraded v${event.oldVersion}→v${DB_VERSION}: cleared stale TIFF cache`);
      }
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      store.createIndex('village', 'village', { unique: false });
      store.createIndex('timestamp', 'timestamp', { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Build a unique key: villageName__fiscalYear__tileIdx */
export function tileKey(villageName, fiscalYear, tileIdx) {
  const safe = villageName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return `${safe}__${fiscalYear}__tile${tileIdx}`;
}

/** Store a TIFF ArrayBuffer. */
export async function storeTile(key, arrayBuffer, metadata = {}) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const village = key.split('__')[0] || 'unknown';
    tx.objectStore(STORE_NAME).put({
      key, village, arrayBuffer,
      sizeBytes: arrayBuffer.byteLength,
      timestamp: Date.now(),
      ...metadata,
    });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** Retrieve a TIFF ArrayBuffer. Returns null if missing. */
export async function getTile(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => { db.close(); resolve(req.result || null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** Check if tile exists in IndexedDB. */
export async function hasTile(key) {
  return (await getTile(key)) !== null;
}

/** Clear all tiles for a specific village. */
export async function clearVillageTiles(villageName) {
  const safe = villageName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const idx = tx.objectStore(STORE_NAME).index('village');
    const cur = idx.openCursor(IDBKeyRange.only(safe));
    cur.onsuccess = () => { const c = cur.result; if (c) { c.delete(); c.continue(); } };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** Clear ALL cached tiles from every village. Useful after CRS/format changes. */
export async function clearAllTiles() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => { db.close(); console.info('[TiffStore] All TIFF tiles cleared.'); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Auto-cleanup: remove tiles from the oldest villages when > MAX_VILLAGES.
 * Called after storing new tiles.
 */
export async function autoCleanup() {
  const db = await openDB();
  const villages = new Map(); // village → latestTimestamp

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const cur = tx.objectStore(STORE_NAME).openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) {
        const { village, timestamp } = c.value;
        if ((timestamp || 0) > (villages.get(village) || 0)) villages.set(village, timestamp);
        c.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  if (villages.size <= MAX_VILLAGES) { db.close(); return; }

  const sorted = [...villages.entries()].sort((a, b) => a[1] - b[1]);
  const toRemove = sorted.slice(0, sorted.length - MAX_VILLAGES).map(([v]) => v);

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const idx = tx.objectStore(STORE_NAME).index('village');
    for (const v of toRemove) {
      const cur = idx.openCursor(IDBKeyRange.only(v));
      cur.onsuccess = () => { const c = cur.result; if (c) { c.delete(); c.continue(); } };
    }
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });

  //console.log(`[TiffStore] Auto-cleanup: purged ${toRemove.length} old village(s): ${toRemove.join(', ')}`);
}

/** Get storage usage stats. */
export async function getStorageStats() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const cur = tx.objectStore(STORE_NAME).openCursor();
    let totalTiles = 0, totalBytes = 0;
    const vSet = new Set();
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) { totalTiles++; totalBytes += c.value.sizeBytes || 0; vSet.add(c.value.village); c.continue(); }
    };
    tx.oncomplete = () => {
      db.close();
      resolve({ totalTiles, totalBytes, totalMB: +(totalBytes / 1048576).toFixed(2), villageCount: vSet.size });
    };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
