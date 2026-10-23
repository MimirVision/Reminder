// Change or remove a day off (ferie, fri, avspasering).
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useStore } from '../data/store';
import { longDate } from '../lib/format';
import { DAY_OFF_LABEL, type DayOff, type DayOffKind } from '../lib/types';
import { Button, Chip, Label, Sheet, inputClass } from './ui';

export function DayOffSheet({ day, onClose }: { day: DayOff; onClose: () => void }) {
  const { saveDayOff, deleteDayOff, toast } = useStore();
  const [d, setD] = useState(day);
  return (
    <Sheet title={DAY_OFF_LABEL[d.kind]} onClose={onClose} footer={
      <div className="flex gap-2">
        <Button variant="danger" aria-label="Fjern dagen" className="px-4" onClick={() => void deleteDayOff(day.id).then((ok) => {
          if (ok) { toast('Fjernet', { undo: () => void saveDayOff(day) }); onClose(); }
        })}><Trash2 className="size-5" /></Button>
        <Button variant="primary" className="flex-1" onClick={() => void saveDayOff(d).then((ok) => ok && onClose())}>Lagre</Button>
      </div>
    }>
      <p className="mb-4 text-[15px] font-semibold capitalize">{longDate(d.date)}</p>
      <Label>Hva slags dag</Label>
      <div className="mb-4 flex gap-2">
        {(Object.keys(DAY_OFF_LABEL) as DayOffKind[]).map((k) => <Chip key={k} active={d.kind === k} onClick={() => setD({ ...d, kind: k })}>{DAY_OFF_LABEL[k]}</Chip>)}
      </div>
      <Label hint="valgfritt">Notat</Label>
      <input className={inputClass} aria-label="Notat" maxLength={200} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} />
    </Sheet>
  );
}
