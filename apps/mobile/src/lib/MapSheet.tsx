import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, useTheme } from './theme';

export type Snap = 'peek' | 'half' | 'full';
/** Room taken at the bottom by the floating tab bar. */
export const tabBarSpace = (insetBottom: number) => Math.max(insetBottom, 12) + 66 + 10;

// The bottom sheet on the map: a handle and title you can drag or tap (peek, half, full), and a list that scrolls once it is open.
// It stops above the floating tab bar, so nothing is ever hidden behind it.
export function MapSheet({ snap, onSnap, onHeight, title, children }: {
  snap: Snap; onSnap: (s: Snap) => void; onHeight?: (visible: number) => void; title: string; children: ReactNode;
}) {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const barSpace = tabBarSpace(insets.bottom); // the floating tab bar and a little air
  const heights = useMemo(() => ({ peek: 92, half: Math.round(winH * 0.46), full: Math.round(winH * 0.8) }), [winH]);
  const visible = useRef(new Animated.Value(heights[snap])).current;
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const start = useRef(heights[snap]);

  const go = useCallback((s: Snap) => {
    Animated.spring(visible, { toValue: heights[s], useNativeDriver: false, bounciness: 3, speed: 16 }).start();
    onHeight?.(heights[s]);
  }, [visible, heights, onHeight]);
  useEffect(() => { go(snap); }, [snap, go]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
    onPanResponderGrant: () => { start.current = heights[snapRef.current]; visible.stopAnimation((v) => { start.current = v; }); },
    onPanResponderMove: (_, g) => visible.setValue(Math.max(heights.peek - 20, Math.min(heights.full, start.current - g.dy))),
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dy) < 6 && Math.abs(g.dx) < 6) { onSnap(snapRef.current === 'peek' ? 'half' : 'peek'); return; } // a tap
      const target = start.current - g.dy - g.vy * 120; // let a flick carry a little further
      const order: Snap[] = ['peek', 'half', 'full'];
      const next = order.reduce((best, s) => (Math.abs(heights[s] - target) < Math.abs(heights[best] - target) ? s : best), 'peek' as Snap);
      if (next === snapRef.current) go(next); else onSnap(next);
    },
  }), [heights, visible, onSnap, go]);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: Animated.add(visible, barSpace),
        backgroundColor: th.sheet, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden',
        shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: -4 },
      }}
    >
      <View {...pan.panHandlers} accessibilityRole="button" accessibilityLabel={title} style={{ paddingTop: 10, paddingHorizontal: 20, paddingBottom: 8 }}>
        <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: th.line, alignSelf: 'center', marginBottom: 12 }} />
        <Text style={{ color: th.ink, fontSize: 22, fontFamily: font.display }}>{title}</Text>
      </View>
      <ScrollView scrollEnabled={snap !== 'peek'} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: barSpace + 16, gap: 10 }} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
      {snap === 'peek' && <Pressable accessibilityElementsHidden style={{ position: 'absolute', left: 0, right: 0, top: 70, bottom: 0 }} onPress={() => onSnap('half')} />}
    </Animated.View>
  );
}
