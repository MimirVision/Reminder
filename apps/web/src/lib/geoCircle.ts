// A circle of a given radius in metres as a GeoJSON polygon (for the "how close counts as at the shop" area on the map).
export function circlePolygon(lat: number, lon: number, radiusM: number, steps = 48): [number, number][] {
  const out: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    out.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return out;
}
