export type LatLon = { lat: number; lon: number };

export type PlaceRow = {
  id: string;
  name: string;
  kind: 'fixed' | 'category';
  category: string | null;
  lat: number | null;
  lon: number | null;
  radius_m: number;
};

export type MemoryRow = {
  id: string;
  body: string;
  status: 'inbox' | 'active' | 'done' | 'dismissed';
  place_id: string | null;
  snoozed_until: string | null;
};

// A concrete shop found for a category place ("any pharmacy").
export type Poi = { id: string; name: string; lat: number; lon: number };

export type Region = {
  identifier: string; // `${placeId}|${poiId or 'fixed'}`
  placeId: string;
  label: string;
  latitude: number;
  longitude: number;
  radius: number;
};
