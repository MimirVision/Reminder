const P: Record<string, string> = {
  todo: 'M12 3.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM8.5 12.5l2.5 2.5 4.5-5',
  house: 'M4 11l8-7 8 7v9H4zM10 20v-5h4v5',
  places: 'M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0113 0C18.5 15.4 12 21 12 21zM12 8.2a2.3 2.3 0 100 4.6 2.3 2.3 0 000-4.6z',
  settings: 'M5 8h14M5 16h14M9 5.8a2.2 2.2 0 100 4.4 2.2 2.2 0 000-4.4zM15 13.8a2.2 2.2 0 100 4.4 2.2 2.2 0 000-4.4z',
  plus: 'M12 5v14M5 12h14',
  camera: 'M4 8h3l1.5-2h7L17 8h3v11H4zM12 9.8a3.2 3.2 0 100 6.4 3.2 3.2 0 000-6.4z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  pin: 'M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0113 0C18.5 15.4 12 21 12 21zM12 8.2a2.3 2.3 0 100 4.6 2.3 2.3 0 000-4.6z',
  x: 'M6 6l12 12M18 6L6 18',
  calendar: 'M5 6h14v13H5zM5 10h14M9 4v4M15 4v4',
  clock: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 8v4.5l3 1.5',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM16.5 16.5L20 20',
  navigate: 'M4 11.5L20 4l-7.5 16-2-6.5z',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5',
  locate: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 3v3M12 18v3M3 12h3M18 12h3',
  minus: 'M5 12h14',
  chevron: 'M9 6l6 6-6 6',
  store: 'M4 9l1.5-4h13L20 9M4.5 9v10h15V9M4 9a2.7 2.7 0 005.3 0 2.7 2.7 0 005.4 0A2.7 2.7 0 0020 9M10 19v-5h4v5',
};

export function Icon({ name, size = 22 }: { name: keyof typeof P; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d={P[name]} />
    </svg>
  );
}
