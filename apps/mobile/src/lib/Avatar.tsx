import { Text, View } from 'react-native';
import { avatarHue, initials } from '../shared/lib/avatar';
import { font } from './theme';

// Who added or finished something. Shown once the household has more than one person.
export function Avatar({ id, name, size = 24 }: { id: string; name: string | null | undefined; size?: number }) {
  return (
    <View accessibilityLabel={name ?? undefined} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `hsl(${avatarHue(id)}, 60%, 42%)`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#FFFFFF', fontSize: size * 0.46, fontFamily: font.semi }}>{initials(name)}</Text>
    </View>
  );
}
