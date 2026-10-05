import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { appendLog } from './log';

export const BG_TASK = 'post-background-check';

// iOS decides when this runs (typically every few hours at best, based on how you use the phone). The log shows what
// really happens, which is what the spike is for. Later this is where new mail is fetched and a notification is raised.
TaskManager.defineTask(BG_TASK, async () => {
  appendLog('background', 'task ran');
  return BackgroundTask.BackgroundTaskResult.Success;
});

export async function registerBackgroundCheck() {
  await BackgroundTask.registerTaskAsync(BG_TASK, { minimumInterval: 15 });
}
