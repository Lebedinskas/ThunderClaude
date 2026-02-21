import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateStatus {
  available: boolean;
  version?: string;
  notes?: string;
  error?: string;
}

/**
 * Check for app updates via the configured endpoint.
 * Returns update status — caller decides whether to prompt user.
 */
export async function checkForUpdates(): Promise<UpdateStatus> {
  try {
    const update = await check();
    if (update) {
      return {
        available: true,
        version: update.version,
        notes: update.body ?? undefined,
      };
    }
    return { available: false };
  } catch (err) {
    console.warn("[Updater] Check failed:", err);
    return { available: false, error: String(err) };
  }
}

/**
 * Download and install the latest update, then relaunch the app.
 * Call this after the user confirms they want to update.
 */
export async function installUpdate(): Promise<void> {
  const update = await check();
  if (!update) throw new Error("No update available");
  await update.downloadAndInstall();
  await relaunch();
}
