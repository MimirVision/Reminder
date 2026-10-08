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
  place_trigger?: 'arrive' | 'leave'; // ring when you arrive at the place (default) or when you leave it
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

export type MaintenanceTask = {
  id: string;
  title: string;
  notes: string | null;
  zone: 'house' | 'garden' | 'other';
  schedule: 'interval' | 'seasonal';
  interval_months: number | null;
  window_start_month: number | null;
  window_end_month: number | null;
  next_due_at: string; // yyyy-mm-dd
  due_until: string | null;
  last_done_at: string | null;
  active: boolean;
};
