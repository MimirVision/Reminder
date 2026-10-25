import * as Updates from 'expo-updates';

// Over-the-air updates (scripts/publish-ota.mjs): small changes arrive without installing the app again.
export type UpdateResult = 'off' | 'none' | 'ready' | 'failed';

/** Asks the update server for a newer version and downloads it. 'ready' means it starts after a restart. */
export async function checkAndFetch(): Promise<UpdateResult> {
  try {
    if (!Updates.isEnabled) return 'off'; // development builds and Expo Go have no updates
    const r = await Updates.checkForUpdateAsync();
    if (!r.isAvailable) return 'none';
    await Updates.fetchUpdateAsync();
    return 'ready';
  } catch {
    return 'failed';
  }
}

export const restartApp = () => Updates.reloadAsync().catch(() => {});

/** Which JavaScript version is running: the one built into the install, or a downloaded update (and from when). */
export function runningUpdate(): { enabled: boolean; embedded: boolean; createdAt: Date | null; id: string | null } {
  return { enabled: Updates.isEnabled, embedded: Updates.isEmbeddedLaunch, createdAt: Updates.createdAt ?? null, id: Updates.updateId ?? null };
}
