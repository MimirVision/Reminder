import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from './i18n';
import { font } from './theme';

// Full-screen photo: swipe sideways between the photos of a to-do, pinch to zoom, the cross (or the system back gesture) closes it.
export function PhotoViewer({ urls, start = 0, onClose }: { urls: string[]; start?: number; onClose: () => void }) {
  const { t } = useI18n();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(Math.min(Math.max(start, 0), Math.max(urls.length - 1, 0)));
  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} contentOffset={{ x: index * width, y: 0 }}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}>
          {urls.map((u, i) => (
            <ScrollView key={u} maximumZoomScale={4} minimumZoomScale={1} bouncesZoom centerContent showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
              contentContainerStyle={{ width, height }} style={{ width, height }}>
              <Image source={{ uri: u }} accessibilityLabel={t('photo.of', { n: i + 1, total: urls.length })} resizeMode="contain" style={{ width, height }} />
            </ScrollView>
          ))}
        </ScrollView>
        <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text accessibilityLiveRegion="polite" style={{ color: '#FFFFFF', fontFamily: font.semi, fontSize: 15, opacity: urls.length > 1 ? 1 : 0 }}>{t('photo.of', { n: index + 1, total: urls.length })}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('photo.close')} onPress={onClose} hitSlop={12}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#FFFFFF', fontSize: 22, lineHeight: 24, fontFamily: font.semi }}>✕</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
