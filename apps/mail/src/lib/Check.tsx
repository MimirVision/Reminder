import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useTheme } from './theme';

export type CheckStatus = 'idle' | 'running' | 'pass' | 'fail' | 'skip';
export type CheckState = { status: CheckStatus; lines: string[] };

export const idle: CheckState = { status: 'idle', lines: [] };

// Runs `fn` and shows every line it reports. A thrown error is a fail; the message is kept so it can be pasted back.
export function useCheck(name: string, record: (name: string, s: CheckState) => void) {
  const [state, setState] = useState<CheckState>(idle);
  const run = useCallback(
    async (fn: (say: (line: string) => void) => Promise<'pass' | 'skip' | void>) => {
      const lines: string[] = [];
      const push = (s: CheckState) => {
        setState(s);
        record(name, s);
      };
      push({ status: 'running', lines });
      const say = (l: string) => {
        lines.push(l);
        setState({ status: 'running', lines: [...lines] });
      };
      try {
        const r = await fn(say);
        push({ status: r === 'skip' ? 'skip' : 'pass', lines: [...lines] });
      } catch (e) {
        lines.push(`FAILED: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
        push({ status: 'fail', lines: [...lines] });
      }
    },
    [name, record],
  );
  return [state, run] as const;
}

export function CheckCard(props: { title: string; why: string; state: CheckState; onRun?: () => void; runLabel?: string; children?: ReactNode }) {
  const t = useTheme();
  const { status, lines } = props.state;
  const color = status === 'pass' ? t.ok : status === 'fail' ? t.danger : status === 'skip' ? t.muted : t.accentText;
  const label = status === 'idle' ? 'Not run' : status === 'running' ? 'Running' : status === 'pass' ? 'Works' : status === 'fail' ? 'Failed' : 'Skipped';
  return (
    <View style={{ backgroundColor: t.card, borderRadius: 20, padding: 16, marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, color: t.ink, fontSize: 17, fontWeight: '700' }}>{props.title}</Text>
        {status === 'running' ? <ActivityIndicator color={t.accentText} /> : null}
        <Text style={{ color, fontSize: 13, fontWeight: '700' }}>{label}</Text>
      </View>
      <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 4, lineHeight: 19 }}>{props.why}</Text>
      {props.children}
      {props.onRun ? (
        <Pressable
          accessibilityRole="button"
          onPress={props.onRun}
          disabled={status === 'running'}
          style={{ marginTop: 12, height: 48, borderRadius: 24, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', opacity: status === 'running' ? 0.5 : 1 }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{props.runLabel ?? 'Run check'}</Text>
        </Pressable>
      ) : null}
      {lines.length ? (
        <View style={{ marginTop: 10, gap: 3 }}>
          {lines.map((l, i) => (
            <Text key={i} selectable style={{ color: l.startsWith('FAILED') ? t.danger : t.ink, fontSize: 12.5, fontFamily: 'Menlo' }}>
              {l}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
