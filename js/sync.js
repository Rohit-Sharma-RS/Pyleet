/* ============================================
   PyLeet — Cloud Sync Layer (Realtime Database)
   ============================================ */

// --- Sync State ---
let isSyncing = false;
let syncTimeout = null;

// --- Sync Status UI ---
function setSyncStatus(status) {
  const indicator = document.getElementById("syncIndicator");
  const text = document.getElementById("syncStatusText");
  if (!indicator) return;

  indicator.className = "sync-indicator";

  switch (status) {
    case "syncing":
      indicator.classList.add("syncing");
      if (text) text.textContent = "Syncing...";
      break;
    case "synced":
      indicator.classList.add("synced");
      if (text) text.textContent = "Synced";
      break;
    case "offline":
      indicator.classList.add("offline");
      if (text) text.textContent = "Offline";
      break;
    case "error":
      indicator.classList.add("error");
      if (text) text.textContent = "Sync error";
      break;
    default:
      if (text) text.textContent = "";
  }
}

// --- Push Local History to Cloud ---
async function syncPushToCloud() {
  const userId = getCurrentUserId();
  if (!userId) return;

  const history = getHistory(); // from localStorage

  try {
    setSyncStatus("syncing");
    isSyncing = true;

    await rtdb.ref("users/" + userId + "/history").set(history);
    await rtdb.ref("users/" + userId + "/lastUpdated").set(firebase.database.ServerValue.TIMESTAMP);

    setSyncStatus("synced");
  } catch (err) {
    console.error("Sync push failed:", err);
    setSyncStatus("error");
  } finally {
    isSyncing = false;
  }
}

// --- Load History from Cloud ---
async function syncLoadFromCloud() {
  const userId = getCurrentUserId();
  if (!userId) return;

  try {
    setSyncStatus("syncing");

    const snapshot = await rtdb.ref("users/" + userId + "/history").once("value");
    const cloudHistory = snapshot.val();

    if (cloudHistory && Array.isArray(cloudHistory)) {
      const localHistory = getHistory();

      // Merge: cloud is source of truth, but keep any local-only items
      const merged = mergeHistories(cloudHistory, localHistory);

      localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
    }

    setSyncStatus("synced");
  } catch (err) {
    console.error("Sync load failed:", err);
    setSyncStatus("error");
  }
}

// --- Merge Local Data into Cloud (on login with existing local data) ---
async function syncMergeLocalToCloud(localHistory) {
  const userId = getCurrentUserId();
  if (!userId) return;

  try {
    setSyncStatus("syncing");

    const snapshot = await rtdb.ref("users/" + userId + "/history").once("value");
    let cloudHistory = snapshot.val() || [];
    if (!Array.isArray(cloudHistory)) cloudHistory = [];

    // Merge: cloud wins on conflicts, local-only items are added
    const merged = mergeHistories(cloudHistory, localHistory);

    // Save merged to both cloud and local
    await rtdb.ref("users/" + userId + "/history").set(merged);
    await rtdb.ref("users/" + userId + "/lastUpdated").set(firebase.database.ServerValue.TIMESTAMP);

    localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
    loadHistory();

    setSyncStatus("synced");
  } catch (err) {
    console.error("Merge sync failed:", err);
    setSyncStatus("error");
  }
}

// --- Merge Two History Arrays ---
// cloudHistory is the source of truth for conflicts (same slug)
function mergeHistories(cloudHistory, localHistory) {
  const merged = [...cloudHistory];
  const cloudSlugs = new Set(cloudHistory.map((h) => h.slug));

  // Add any local-only items (not in cloud)
  for (const local of localHistory) {
    if (!cloudSlugs.has(local.slug)) {
      merged.push(local);
    }
  }

  return merged;
}

// --- Debounced Sync (call this after any data mutation) ---
function debouncedSync() {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    syncPushToCloud();
  }, 1000); // Wait 1 second after last change before syncing
}

// --- Listen for Online/Offline ---
window.addEventListener("online", () => {
  setSyncStatus("syncing");
  syncPushToCloud();
});

window.addEventListener("offline", () => {
  setSyncStatus("offline");
});
