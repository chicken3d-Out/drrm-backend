import axios from 'axios';
import { SourceAdapter, NormalizedEvent, TrackPoint } from './types';
import { PH_BBOX } from '../config/env';

const CATEGORY_MAP: Record<string, NormalizedEvent['disasterType']> = {
  volcanoes: 'volcano',
  wildfires: 'wildfire',
  severeStorms: 'tropical_cyclone',
  floods: 'flood'
};

function withinPhilippines(lon: number, lat: number): boolean {
  return lon >= PH_BBOX.minLon && lon <= PH_BBOX.maxLon && lat >= PH_BBOX.minLat && lat <= PH_BBOX.maxLat;
}

// NASA EONET v3 — public, no API key required.
// Docs: https://eonet.gsfc.nasa.gov/docs/v3
export class EonetAdapter implements SourceAdapter {
  name = 'EONET';

  async fetchLatest(): Promise<NormalizedEvent[]> {
    const { data } = await axios.get('https://eonet.gsfc.nasa.gov/api/v3/events', {
      params: { status: 'open', limit: 200 },
      timeout: 15000
    });

    const events: NormalizedEvent[] = [];
    for (const ev of data.events ?? []) {
      const category = ev.categories?.[0]?.id;
      const disasterType = CATEGORY_MAP[category];
      if (!disasterType) continue; // skip categories we don't track (e.g. dust/haze, snow, temperature)

      const geometryHistory = (ev.geometry ?? []).filter((g: any) => g.type === 'Point');
      const latestGeom = geometryHistory[geometryHistory.length - 1];
      if (!latestGeom) continue;
      const [lon, lat] = latestGeom.coordinates;
      if (lon == null || lat == null || !withinPhilippines(lon, lat)) continue;

      // Storms move over time — EONET's geometry array is the full track
      // history for this event, so we keep all of it (not just the latest
      // point) to support animated track playback on the map.
      let track: TrackPoint[] | undefined;
      if (disasterType === 'tropical_cyclone' && geometryHistory.length > 1) {
        track = geometryHistory.map((g: any) => ({
          lon: g.coordinates[0],
          lat: g.coordinates[1],
          date: g.date
        }));
      }

      events.push({
        externalId: ev.id,
        dataSourceName: this.name,
        disasterType,
        officialTitle: ev.title,
        sourceAgency: 'NASA EONET',
        description: ev.description ?? undefined,
        issuedAt: new Date(latestGeom.date),
        officialSourceUrl: ev.sources?.[0]?.url ?? ev.link,
        point: { lon, lat },
        track
      });
    }
    return events;
  }
}
