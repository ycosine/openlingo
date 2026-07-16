/**
 * One-time migration of user configuration from chrome.storage.local to
 * chrome.storage.sync. Settings and BYOK credentials used to live in Local,
 * which is wiped on uninstall and scoped to a single browser install. Sync
 * survives reinstalls and follows the signed-in profile.
 *
 * Idempotent: a key is copied only while Sync has no value for it, so user
 * edits made after the first run are never overwritten. Local values are kept
 * as a fallback for downgrades.
 */

const SYNCED_KEYS = ['translation-settings', 'provider-credentials', 'asr-credentials'];

export const migrateLocalSettingsToSync = async (): Promise<void> => {
  try {
    const [local, sync] = await Promise.all([
      chrome.storage.local.get(SYNCED_KEYS),
      chrome.storage.sync.get(SYNCED_KEYS),
    ]);
    const missing: Record<string, unknown> = {};
    for (const key of SYNCED_KEYS) {
      if (local[key] !== undefined && sync[key] === undefined) missing[key] = local[key];
    }
    if (Object.keys(missing).length > 0) await chrome.storage.sync.set(missing);
  } catch (error) {
    console.warn('[OpenLingo] settings migration to sync storage failed:', error);
  }
};
