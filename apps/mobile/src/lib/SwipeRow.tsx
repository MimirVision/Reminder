import { useRef, type ReactNode } from 'react';
import { Animated, PanResponder, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { isHorizontal, swipeOffset, swipeResult } from '../shared/lib/swipe';
import { useI18n } from './i18n';
import { font, useTheme } from './theme';

// Swipe right to finish, left to delete. A tap or a vertical drag still works as usual.
export function SwipeRow({ children, onDone, onDelete }: { children: ReactNode; onDone: () => void; onDelete: () => void }) {
  const th = useTheme();
  const { t } = useI18n();
  const x = useRef(new Animated.Value(0)).current;
  const started = useRef(0);
  const cb = useRef({ onDone, onDelete });
  cb.current = { onDone, onDelete };

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => isHorizontal(g.dx, g.dy),
    onPanResponderGrant: () => { started.current = Date.now(); },
    onPanResponderMove: (_, g) => x.setValue(swipeOffset(g.dx)),
    onPanResponderRelease: (_, g) => {
      const action = swipeResult(g.dx, g.dy, Date.now() - started.current);
      Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      if (action === 'done') { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); cb.current.onDone(); }
      else if (action === 'delete') { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); cb.current.onDelete(); }
    },
    onPanResponderTerminate: () => { Animated.spring(x, { toValue: 0, useNativeDriver: true }).start(); },
  })).current;

  return (
    <View style={{ overflow: 'hidden' }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18 }}>
        <Text style={{ color: '#1F8A4C', fontFamily: font.semi }}>✓ {t('row.swipeDone')}</Text>
        <Text style={{ color: th.danger, fontFamily: font.semi }}>{t('row.swipeDelete')}</Text>
      </View>
      <Animated.View style={{ backgroundColor: th.card, transform: [{ translateX: x }] }} {...pan.panHandlers}>{children}</Animated.View>
    </View>
  );
}
