/**
 * CSVAT — IndexedDB Tile Store for GeoTIFF Caching.
 *
 * Stores downloaded TIFF ArrayBuffers in IndexedDB so that:
 *   - Re-analysis of the same village doesn't re-download tiles
 *   - Page refreshes don't lose cached data
 *   - RAM isn't consumed holding many TIFFs simultaneously
 *
 * Key format: `${villageName}__${fiscalYear}__tile${idx}`
 * Value: { arrayBuffer: ArrayBuffer, metadata: { bbox, crs, timestamp, sizeBytes } }
 */

const DB_NAME = 'csvat-tiff-store';
const DB_VERSION = 1;
const STORE_NAME = 'tiff-tiles';
const MAX_STORAGE_BYTES = 500 * 1024 * 1024; // 500 MB auto-cleanup threshold

let _db = null;

/**
 * Open (or create) the IndexedDB database. Cached after first call.
 */
export async function openDB() {
  if (_db) return _db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('village', 'village', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      _db = event.target.result;
      resolve(_db);
    };

    request.onerror = (event) => {
      console.error('[TiffStore] IndexedDB open failed:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Store a TIFF ArrayBuffer with metadata.
 */
export async function storeTile(key, arrayBuffer, metadata = {}) {
  const db = await openDB();
  const village = key.split('__')[0] || 'unknown';

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    store.put({
      key,
      village,
      arrayBuffer,
      metadata: {
        ...metadata,
        sizeBytes: arrayBuffer.byteLength,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    });

    tx.oncomplete = () => resolve();
    tx.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Retrieve a cached TIFF ArrayBuffer by key.
 * Returns null if not found.
 */
export async function getTile(key) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => {
      const result = request.result;
      resolve(result || null);
    };
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Check whether a tile exists in the cache.
 */
export async function hasTile(key) {
  const tile = await getTile(key);
  return tile !== null;
}

/**
 * Clear cached tiles. If villageKey is provided, only clear tiles for that village.
 * Otherwise clear everything.
 */
export async function clearTiles(villageKey) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    if (!villageKey) {
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = (event) => reject(event.target.error);
      return;
    }

    // Clear only tiles matching the village
    const index = store.index('village');
    const request = index.openCursor(IDBKeyRange.only(villageKey));

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Get storage usage statistics.
 * Returns { totalBytes, tileCount, villages: { [name]: { bytes, count } } }
 */
export async function getStorageStats() {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();

    let totalBytes = 0;
    let tileCount = 0;
    const villages = {};

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const record = cursor.value;
        const bytes = record.metadata?.sizeBytes || record.arrayBuffer?.byteLength || 0;
        const village = record.village || 'unknown';

        totalBytes += bytes;
        tileCount++;

        if (!villages[village]) villages[village] = { bytes: 0, count: 0 };
        villages[village].bytes += bytes;
        villages[village].count++;

        cursor.continue();
      } else {
        resolve({ totalBytes, tileCount, villages });
      }
    };
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Auto-cleanup: remove oldest village data if total storage exceeds threshold.
 * Keeps the most recently accessed villages.
 */
export async function autoCleanup() {
  try {
    const stats = await getStorageStats();
    if (stats.totalBytes < MAX_STORAGE_BYTES) return;

    console.warn(`[TiffStore] Storage ${(stats.totalBytes / 1024 / 1024).toFixed(1)} MB exceeds ${MAX_STORAGE_BYTES / 1024 / 1024} MB threshold. Cleaning oldest villages…`);

    // Sort villages by oldest tile timestamp
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');

    const villageTimes = {};

    await new Promise((resolve) => {
      const request = index.openCursor();
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const village = cursor.value.village;
          if (!villageTimes[village]) villageTimes[village] = cursor.value.timestamp;
          cursor.continue();
        } else {
          resolve();
        }
      };
    });

    // Remove oldest villages until under threshold
    const sorted = Object.entries(villageTimes).sort((a, b) => a[1] - b[1]);
    let freedBytes = 0;
    const targetFree = stats.totalBytes - MAX_STORAGE_BYTES * 0.7; // Free down to 70%

    for (const [village] of sorted) {
      if (freedBytes >= targetFree) break;
      const villageBytes = stats.villages[village]?.bytes || 0;
      await clearTiles(village);
      freedBytes += villageBytes;
      console.log(`[TiffStore] Cleared "${village}" (${(villageBytes / 1024 / 1024).toFixed(1)} MB)`);
    }
  } catch (err) {
    console.warn('[TiffStore] Auto-cleanup failed:', err.message);
  }
}
