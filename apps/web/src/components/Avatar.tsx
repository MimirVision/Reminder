import { avatarHue, initials } from '../lib/avatar';

// Who added or finished something. Only shown when the household has more than one person.
export function Avatar({ id, name, size = 22 }: { id: string; name: string | null | undefined; size?: number }) {
  const h = avatarHue(id);
  return (
    <span className="avatar" title={name ?? ''} aria-label={name ?? undefined} style={{ width: size, height: size, fontSize: size * 0.48, background: `hsl(${h} 60% 42%)` }}>
      {initials(name)}
    </span>
  );
}
