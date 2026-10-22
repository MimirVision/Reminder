// A short walkthrough the first time she opens the app: a spotlight moves over the parts that matter, with a card
// that explains each one. Elements are found by their data-tour attribute; a step whose element isn't on the
// screen (the filter with only one employer) is skipped.
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft } from 'lucide-react';
import { Button, cn } from './ui';

export interface TourStep { target?: string; emoji: string; title: string; text: string }

const PAD = 8;

export function Tour({ steps, onDone, finalLabel = 'Kom i gang' }: { steps: TourStep[]; onDone: (finished: boolean) => void; finalLabel?: string }) {
  const visible = steps.filter((s) => !s.target || document.querySelector(`[data-tour="${s.target}"]`));
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = visible[i];
  const last = i === visible.length - 1;

  const measure = useCallback(() => {
    const el = step?.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  useLayoutEffect(() => {
    const el = step?.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
    const r = el?.getBoundingClientRect();
    // Bring it into view first if it is off screen (the bar at the bottom is always in view).
    if (el && r && (r.top < 80 || r.bottom > innerHeight - 100)) el.scrollIntoView({ block: 'center' });
    measure();
  }, [step, measure]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone(false); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure); window.removeEventListener('keydown', onKey); };
  }, [measure, onDone]);

  if (!step) return null;
  const next = () => (last ? onDone(true) : setI(i + 1));

  // The card sits below the spotlight when there is room, above it otherwise, and in the middle when nothing is lit.
  const below = rect ? rect.bottom + PAD + 16 + 230 < innerHeight : false;
  const cardStyle: React.CSSProperties = !rect
    ? { top: '50%', transform: 'translateY(-50%)' }
    : below ? { top: rect.bottom + PAD + 14 } : { bottom: innerHeight - rect.top + PAD + 14 };
  const cardWidth = Math.min(400, innerWidth - 32);
  const cardLeft = (innerWidth - cardWidth) / 2;
  const arrowX = rect ? Math.min(Math.max(rect.left + rect.width / 2 - cardLeft - 8, 20), cardWidth - 36) : 0;

  return createPortal(
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal aria-label="Gjennomgang">
      {/* Clicks outside the card do nothing, so she can't wander off mid-way by accident. */}
      <div className="absolute inset-0" />
      {rect ? (
        <div className="pointer-events-none absolute rounded-[24px] transition-all duration-300 ease-out"
          style={{
            top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgb(18 10 26 / 0.62), 0 0 0 3px rgb(255 255 255 / 0.9)',
          }} />
      ) : (
        <div className="absolute inset-0 animate-fade-in bg-[rgb(18_10_26/0.62)]" />
      )}
      <div className="absolute inset-x-4 mx-auto max-w-[400px] transition-all duration-300" style={cardStyle}>
        {rect && (
          <div className={cn('absolute size-4 rotate-45 bg-surface', below ? '-top-2' : '-bottom-2')}
            style={{ left: arrowX }} />
        )}
        <div key={i} className="relative animate-pop-in rounded-3xl bg-surface p-5 shadow-[0_20px_50px_-12px_rgb(0_0_0/0.45)]">
          <div className="mb-1 flex items-center gap-2.5">
            <span className="text-[26px] leading-none" aria-hidden>{step.emoji}</span>
            <h2 className="text-[18px] font-bold tracking-tight">{step.title}</h2>
          </div>
          <p className="text-[15px] leading-relaxed text-ink-2">{step.text}</p>
          <div className="mt-3 flex gap-1.5" aria-label={`Steg ${i + 1} av ${visible.length}`}>
            {visible.map((_, j) => <span key={j} className={cn('h-1.5 rounded-full transition-all', j === i ? 'hero w-5' : 'w-1.5 bg-line')} />)}
          </div>
          <div className="mt-4 flex items-center gap-2">
            {!last ? <button className="mr-auto py-2 text-[14px] font-semibold text-ink-3" onClick={() => onDone(false)}>Hopp over</button> : <span className="mr-auto" />}
            {i > 0 && <Button variant="soft" aria-label="Tilbake" className="min-h-11 px-3.5" onClick={() => setI(i - 1)}><ChevronLeft className="size-5" /></Button>}
            <Button variant="primary" className="min-h-11 px-6 text-[15px]" onClick={next}>{last ? finalLabel : 'Neste'}</Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Setup's "Vis gjennomgangen igjen" asks the main screen to start the tour with this event. */
export const TOUR_EVENT = 'vakt-tour';

export function appTour(name: string, employers: number): TourStep[] {
  return [
    { emoji: '👋', title: name ? `Velkommen, ${name}!` : 'Velkommen!', text: 'Her er en rask runde på 30 sekunder, så vet du hvor alt er.' },
    { target: 'hero', emoji: '💰', title: 'Månedens lønn', text: 'Det store tallet er det du har tjent så langt. Den lyse delen av streken er vakter du har planlagt, og streken fylles opp mot målet ditt.' },
    { target: 'month', emoji: '📅', title: 'Bla mellom måneder', text: 'Se tilbake på tidligere måneder, eller fremover for å legge inn turnusen.' },
    ...(employers > 1 ? [{ target: 'filter', emoji: '🏥', title: 'Én avdeling eller alle', text: 'Trykk på en avdeling for å se bare den. «Alle» viser alt samlet.' }] : []),
    { target: 'add', emoji: '➕', title: 'Legg inn en vakt', text: 'Velg vakttype og dato, så ser du med en gang hva vakta gir – med alle tilleggene. «Lagre + ny» går rett til neste dag.' },
    { target: 'tab-vakter', emoji: '🗓️', title: 'Alle vaktene', text: 'Månedens vakter uke for uke. Trykk på en vakt for å endre eller slette den.' },
    { target: 'tab-aar', emoji: '📈', title: 'Året', text: 'Måned for måned, din beste måned og hva tilleggene har gitt deg i år.' },
    { target: 'tab-oppsett', emoji: '⚙️', title: 'Oppsett', text: 'Timelønn, tillegg og vakttyper. Endrer du noe her, regnes alle vaktene ut på nytt av seg selv.' },
    { emoji: '🎉', title: 'Klar!', text: 'Legg inn den første vakta di, så er du i gang. Du finner denne gjennomgangen igjen under Oppsett.' },
  ];
}
