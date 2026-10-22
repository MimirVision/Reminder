// One short, honest line for the top of the overview: the most encouraging thing that is true this month.
import { kr } from './format';

export interface MonthPicture {
  earned: number;
  planned: number;
  supplements: number;
  goal: number | null;
  /** The best earlier month's total, or 0 if there is none. */
  bestBefore: number;
  shiftsDone: number;
  shiftsLeft: number;
  isCurrent: boolean;
  isPast: boolean;
}

export function motivation(p: MonthPicture): { emoji: string; text: string } {
  const total = p.earned + p.planned;
  if (p.shiftsDone + p.shiftsLeft === 0) {
    return p.isPast ? { emoji: '🌙', text: 'Ingen vakter registrert denne måneden.' } : { emoji: '✨', text: 'Legg inn første vakt, så regner jeg ut resten.' };
  }
  if (p.goal && p.earned >= p.goal) return { emoji: '🎉', text: `Du har nådd målet! Alt du tjener nå er ${p.isPast ? 'ekstra' : 'bonus'}.` };
  if (p.bestBefore > 0 && p.earned > p.bestBefore) return { emoji: '🏆', text: 'Rekordmåned! Du har aldri tjent mer på en måned.' };
  if (p.goal && !p.isPast && total >= p.goal) return { emoji: '🙌', text: `Med vaktene du har satt opp når du målet – og litt til (${kr(total - p.goal)}).` };
  if (p.goal && p.earned >= p.goal * 0.75 && !p.isPast) return { emoji: '💪', text: `Nesten der! Bare ${kr(p.goal - p.earned)} igjen til målet.` };
  if (p.bestBefore > 0 && total > p.bestBefore && !p.isPast) return { emoji: '🚀', text: 'Denne måneden ligger an til å bli din beste til nå.' };
  if (p.supplements >= 1000) return { emoji: '✨', text: `Tilleggene har gitt deg ${kr(p.supplements)} ekstra denne måneden.` };
  if (p.shiftsLeft > 0 && p.isCurrent) return { emoji: '🌱', text: `${p.shiftsLeft} ${p.shiftsLeft === 1 ? 'vakt' : 'vakter'} igjen denne måneden – ${kr(p.planned)} på vei inn.` };
  return { emoji: '💜', text: `${p.shiftsDone} ${p.shiftsDone === 1 ? 'vakt' : 'vakter'} og ${kr(p.earned)} tjent. Godt jobba!` };
}
