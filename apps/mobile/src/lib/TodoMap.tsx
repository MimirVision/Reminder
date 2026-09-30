import { StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import type { LatLon } from '../core/types.ts';
import type { Pin } from './reminders';
import { font, useTheme } from './theme';
import { Icon } from './ui';

// Map view of the to-do list: a pin for every place that has open to-dos, with the count.
export function TodoMap({ pins, here, onOpen }: { pins: Pin[]; here: LatLon | null; onOpen: (p: Pin) => void }) {
  const t = useTheme();
  const region = here
    ? { latitude: here.lat, longitude: here.lon, latitudeDelta: 0.06, longitudeDelta: 0.06 }
    : { latitude: 59.9139, longitude: 10.7522, latitudeDelta: 0.25, longitudeDelta: 0.25 };
  return (
    <MapView style={StyleSheet.absoluteFill} initialRegion={region} showsUserLocation={!!here} userInterfaceStyle={t.dark ? 'dark' : 'light'}>
      {pins.filter((p) => p.fixed).map((p) => (
        <Circle key={`c${p.key}`} center={{ latitude: p.lat, longitude: p.lon }} radius={p.radius} fillColor="rgba(200,67,31,0.12)" strokeColor="rgba(200,67,31,0.5)" />
      ))}
      {pins.map((p) => (
        <Marker key={p.key} coordinate={{ latitude: p.lat, longitude: p.lon }} onPress={() => onOpen(p)} tracksViewChanges={false}>
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' }}>
              <Icon name="mappin" size={18} color="#FFFFFF" />
            </View>
            {p.count > 0 && (
              <View style={{ position: 'absolute', top: -6, right: -8, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: t.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
                <Text style={{ color: t.card, fontSize: 12, fontFamily: font.semi }}>{p.count}</Text>
              </View>
            )}
          </View>
        </Marker>
      ))}
    </MapView>
  );
}
