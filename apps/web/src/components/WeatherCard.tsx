import { useI18n } from '../i18n';
import { doneItems, reasonText, type WeatherAlert, type WeatherDone } from '../lib/weather';

// On the to-do list while a weather alert is live: what the weather is doing and the checklist to tick off.
export function WeatherCard({ alerts, done, onTick }: { alerts: WeatherAlert[]; done: WeatherDone[]; onTick: (a: WeatherAlert, item: string) => void }) {
  const { t } = useI18n();
  if (alerts.length === 0) return null;
  return (
    <>
      {alerts.map((a) => {
        const ticked = doneItems(a, done);
        return (
          <section key={`${a.rule.id}-${a.forDate}`} className="card wx-card" aria-label={a.rule.name}>
            <strong>{a.rule.name}</strong>
            <span className="muted">{reasonText(t, a)}</span>
            <ul className="wx-items">
              {a.rule.items.map((item) => (
                <li key={item}>
                  <label className="row">
                    <input type="checkbox" checked={ticked.includes(item)} onChange={() => onTick(a, item)} />
                    <span className={ticked.includes(item) ? 'wx-done' : ''}>{item}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
