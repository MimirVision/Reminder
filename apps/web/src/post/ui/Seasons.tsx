import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { LOOKS_BY_SEASON, activeSeason, piecesFor, type Glyph, type Season, type SeasonalSettings } from '../core/seasons.ts';

/** What the seasonal touches are right now: the season (null for none) and whether the avatar badge is on. */
const SeasonCtx = createContext<{ season: Season | null; badge: boolean }>({ season: null, badge: false });
export const SeasonProvider = SeasonCtx.Provider;

/** The season for the settings, re-checked every half hour so a phone left open over midnight changes by itself. */
export function useSeason(cfg: SeasonalSettings): Season | null {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30 * 60_000); return () => clearInterval(t); }, []);
  return activeSeason(cfg.mode, now);
}

const PALETTE: Record<string, string[]> = {
  leaf: ['#C8582A', '#D9822B', '#A8442A'], leafGold: ['#D9A441', '#E0B54F', '#C98A2E'], petal: ['#F2B8C8', '#FFFFFF', '#F5D6A8'],
  heart: ['#E2557D', '#F08AA6', '#D43F6C'], egg: ['#F2C14E', '#B9A0E0', '#8FCB9B'], confetti: ['#C0392B', '#FFFFFF', '#2F5AA8'],
};
const NEWYEAR = ['#D9A441', '#E27A9C', '#6DB38A'];

/** One small picture, drawn in a 24-unit box. Nothing here is a photo or an emoji, so it looks the same on every phone. */
export function GlyphSvg({ g, hue = 0, season }: { g: Glyph | 'hat' | 'sun' | 'flower' | 'flag'; hue?: number; season?: Season }) {
  const pal = (g === 'confetti' && season === 'newyear' ? NEWYEAR : PALETTE[g])?.[hue % 3];
  switch (g) {
    case 'leaf': case 'leafGold':
      return <svg viewBox="0 0 24 24"><path d="M12 2C6.5 6.5 4.5 11.5 6.5 16 8 19.5 10.5 21.5 12 22c1.5-.5 4-2.5 5.5-6 2-4.5 0-9.5-5.5-14z" fill={pal} /><path d="M12 5v16" stroke="#00000033" strokeWidth="1.2" strokeLinecap="round" fill="none" /></svg>;
    case 'pumpkin':
      return <svg viewBox="0 0 24 24"><path d="M12 6.5c.2-1.4.8-2.4 2-3" stroke="#4E7A3A" strokeWidth="2" strokeLinecap="round" fill="none" /><ellipse cx="7.6" cy="14" rx="5.4" ry="7" fill="#E8803A" /><ellipse cx="16.4" cy="14" rx="5.4" ry="7" fill="#E8803A" /><ellipse cx="12" cy="14" rx="4.2" ry="7.4" fill="#F29A52" /><path d="M8.6 12.2l1.6 2.2H7zm6.8 0l1.6 2.2h-3.2zM9 17.2c1 1.2 5 1.2 6 0" fill="#5A2E12" stroke="#5A2E12" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" /></svg>;
    case 'ghost':
      return <svg viewBox="0 0 24 24"><path d="M12 2.5c-4.2 0-6.5 3-6.5 7v10.3c0 .8.9 1.2 1.5.7l1.7-1.5 1.8 1.6c.9.7 2 .7 2.9 0l1.8-1.6 1.7 1.5c.6.5 1.5.1 1.5-.7V9.5c0-4-2.3-7-6.4-7z" fill="#F7F4FC" stroke="#9A90B8" strokeWidth="1.2" /><circle cx="9.4" cy="10" r="1.3" fill="#4A4166" /><circle cx="14.6" cy="10" r="1.3" fill="#4A4166" /><ellipse cx="12" cy="13.6" rx="1.4" ry="1.8" fill="#4A4166" /></svg>;
    case 'bat':
      return <svg viewBox="0 0 24 24"><path d="M12 8c1-1.4 2-1.4 2.4-3 1.6 1.6 2.6 2.4 4.6 2.6 2.4.2 3.6 1.8 3.6 1.8-1.4-.4-2.6-.2-3.4.8-.6-.8-1.6-1-2.6-.6-.6.8-.4 1.8-.6 2.8-.8-.8-1.4-1-2-.4-.6-.6-1.2-.4-2 .4-.2-1 0-2-.6-2.8-1-.4-2 0-2.6.6-.8-1-2-1.2-3.4-.8 0 0 1.2-1.6 3.6-1.8 2-.2 3-1 4.6-2.6C10 6.6 11 6.6 12 8z" fill="#4A3A6A" /></svg>;
    case 'flake':
      return <svg viewBox="0 0 24 24" fill="none" stroke="#8FB4DE" strokeWidth="1.7" strokeLinecap="round"><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9.5 4.6L12 7l2.5-2.4M9.5 19.4L12 17l2.5 2.4" /></svg>;
    case 'dot':
      return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill={season === 'summer' ? '#F2C14E' : season === 'spring' ? '#B9E0C4' : '#BBD3EC'} /></svg>;
    case 'heart':
      return <svg viewBox="0 0 24 24"><path d="M12 21C5 15.5 2.5 12 2.5 8.4 2.5 5.6 4.6 3.6 7 3.6c1.9 0 3.7 1 5 3 1.3-2 3.1-3 5-3 2.4 0 4.5 2 4.5 4.8 0 3.6-2.5 7.1-9.5 12.6z" fill={pal} /></svg>;
    case 'egg':
      return <svg viewBox="0 0 24 24"><path d="M12 2.5c-4 0-7 6.5-7 11.2C5 18 8 21.5 12 21.5s7-3.5 7-7.8C19 9 16 2.5 12 2.5z" fill={pal} /><path d="M5.3 13.5l2.2-2 2.2 2 2.3-2 2.3 2 2.2-2 2 2" stroke="#FFFFFFB0" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round" /></svg>;
    case 'petal':
      return <svg viewBox="0 0 24 24"><path d="M12 2.5c5 3.5 7 8 4.5 12.5-1.4 2.6-3.2 4.4-4.5 6.5-1.3-2.1-3.1-3.9-4.5-6.5C5 10.5 7 6 12 2.5z" fill={pal} stroke="#00000014" strokeWidth="1" /></svg>;
    case 'spark':
      return <svg viewBox="0 0 24 24"><path d="M12 2c.8 5.2 2.8 8.2 10 10-7.2 1.8-9.2 4.8-10 10-.8-5.2-2.8-8.2-10-10 7.2-1.8 9.2-4.8 10-10z" fill={season === 'summer' ? '#F2C14E' : '#D9A441'} /></svg>;
    case 'star':
      return <svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.2 6.6.8-4.9 4.6 1.3 6.7L12 17.5l-5.9 3.3 1.3-6.7L2.5 9.5l6.6-.8z" fill="#E0B54F" strokeLinejoin="round" /></svg>;
    case 'confetti':
      return <svg viewBox="0 0 24 24"><rect x="7" y="3" width="8" height="18" rx="1.5" fill={pal} stroke="#0000001F" strokeWidth="1" /></svg>;
    case 'hat':
      return <svg viewBox="0 0 24 24"><path d="M3.5 17C4.5 9 9 3.5 15.5 4c1.6 1.6 3 4 4.5 9.5z" fill="#D64541" /><rect x="2.5" y="15.5" width="19" height="5" rx="2.5" fill="#FFFFFF" stroke="#0000001F" strokeWidth="1" /><circle cx="17.5" cy="4.5" r="2.6" fill="#FFFFFF" stroke="#0000001F" strokeWidth="1" /></svg>;
    case 'sun':
      return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5.2" fill="#F2B63E" /><g stroke="#F2B63E" strokeWidth="2" strokeLinecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" /></g></svg>;
    case 'flower':
      return <svg viewBox="0 0 24 24"><g fill="#F2A8C0">{[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="12" cy="6.4" rx="3.4" ry="4.6" transform={`rotate(${a} 12 12)`} />)}</g><circle cx="12" cy="12" r="3" fill="#F2C14E" /></svg>;
    case 'flag':
      return <svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="2" fill="#C0392B" /><rect x="8" y="5" width="4.6" height="14" fill="#FFFFFF" /><rect x="2.5" y="10.1" width="19" height="4.6" fill="#FFFFFF" /><rect x="9.2" y="5" width="2.2" height="14" fill="#2F5AA8" /><rect x="2.5" y="11.2" width="19" height="2.2" fill="#2F5AA8" /></svg>;
  }
}

/** The small thing on a person's avatar. Only people get one (automatic mail is a rounded square and stays plain), so a list is not covered in them. */
export function SeasonBadge() {
  const { season, badge } = useContext(SeasonCtx);
  if (!season || !badge) return null;
  return <span className={`ssb ssb-${season}`} aria-hidden="true"><GlyphSvg g={LOOKS_BY_SEASON[season].badge} season={season} /></span>;
}

/** The wash of colour and the slow fall. It sits over the screen but takes no taps, hides itself for people who asked their phone for less motion, and is skipped when switched off. */
export function SeasonLayer({ season, cfg, wide }: { season: Season | null; cfg: SeasonalSettings; wide: boolean }) {
  const look = season ? LOOKS_BY_SEASON[season] : null;
  const pieces = useMemo(() => (season && cfg.motion ? piecesFor(season, wide ? 13 : 8) : []), [season, cfg.motion, wide]);
  if (!season || !look || (!cfg.colours && !pieces.length)) return null;
  return (
    <div className={`sz sz-${season}`} aria-hidden="true" data-season={season}
      style={{ '--wl': look.wash[0], '--wd': look.wash[1] } as CSSProperties}>
      {cfg.colours && <div className="sz-wash" />}
      {pieces.map((p, i) => (
        <span key={i} className={`pc m-${p.mode} g-${p.glyph}`} style={{ '--t': `${p.top}%`, '--l': `${p.left}%`, '--s': `${p.size}px`, '--d': `${p.dur}s`, '--dl': `${p.delay}s`, '--sw': `${p.sway}px`, '--sp': `${p.spin}deg`, '--o': p.opacity } as CSSProperties}>
          <i><GlyphSvg g={look.glyphs[i % look.glyphs.length]} hue={p.hue} season={season} /></i>
        </span>
      ))}
    </div>
  );
}
