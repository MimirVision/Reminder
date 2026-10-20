// Which overlay is open: the task panel, the new-task dialog, the schedule editor, the command palette.
// Kept above the screens so any screen can open them and the list underneath keeps its place.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ISODate } from '../lib/dates';
import type { Schedule } from '../lib/types';

export interface NewTaskDefaults { clientId?: string; dueDate?: ISODate; title?: string; /** Open in several-clients mode. */ multi?: boolean }
/** The meeting dialog: a new one (with defaults) or an existing one. */
export type MeetingEditor = { mode: 'new'; date?: ISODate; start?: string; end?: string; clientId?: string } | { mode: 'edit'; id: string } | null;
export type ScheduleEditor = { mode: 'new'; clientId?: string; from?: Schedule } | { mode: 'edit'; id: string } | null;

interface UI {
  taskId: string | null;
  openTask(id: string | null): void;
  newTask: NewTaskDefaults | null;
  openNewTask(d?: NewTaskDefaults): void;
  closeNewTask(): void;
  schedule: ScheduleEditor;
  openSchedule(s: ScheduleEditor): void;
  palette: boolean;
  setPalette(o: boolean): void;
  newClient: boolean;
  setNewClient(o: boolean): void;
  meeting: MeetingEditor;
  openMeeting(m: MeetingEditor): void;
}

const Ctx = createContext<UI | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [taskId, openTask] = useState<string | null>(null);
  const [newTask, setNewTask] = useState<NewTaskDefaults | null>(null);
  const [schedule, openSchedule] = useState<ScheduleEditor>(null);
  const [palette, setPalette] = useState(false);
  const [newClient, setNewClient] = useState(false);
  const [meeting, openMeeting] = useState<MeetingEditor>(null);
  const value = useMemo<UI>(() => ({
    taskId, openTask, newTask, openNewTask: (d = {}) => setNewTask(d), closeNewTask: () => setNewTask(null),
    schedule, openSchedule, palette, setPalette, newClient, setNewClient, meeting, openMeeting,
  }), [taskId, newTask, schedule, palette, newClient, meeting]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUI(): UI {
  const u = useContext(Ctx);
  if (!u) throw new Error('useUI outside UIProvider');
  return u;
}
