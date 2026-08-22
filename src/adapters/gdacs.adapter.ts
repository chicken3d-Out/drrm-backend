import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import { SourceAdapter, NormalizedEvent } from './types';
import { PAR_BBOX } from '../config/env';

const EVENT_TYPE_MAP: Record<string, NormalizedEvent['disasterType']> = {
  EQ: 'earthquake',
  TC: 'tropical_cyclone',
  FL: 'flood',
  VO: 'volcano',
  DR: 'other',
  WF: 'wildfire'
};

function withinParBbox(lon: number, lat: number): boolean {
  return lon >= PAR_BBOX.minLon && lon <= PAR_BBOX.maxLon && lat >= PAR_BBOX.minLat && lat <= PAR_BBOX.maxLat;
}

// GDACS RSS feed — public, no API key required.
// Docs: https://www.gdacs.org/ (Global Disaster Alert and Coordination System)
export class GdacsAdapter implements SourceAdapter {
  name = 'GDACS';

  async fetchLatest(): Promise<NormalizedEvent[]> {
    const { data } = await axios.get('https://www.gdacs.org/xml/rss.xml', { timeout: 15000 });
    const parsed = await parseStringPromise(data, { explicitArray: false, tagNameProcessors: [stripPrefix] });

    const items = parsed?.rss?.channel?.item;
    const list = Array.isArray(items) ? items : items ? [items] : [];

    return list
      .map((item: any): NormalizedEvent | null => {
        const eventType = EVENT_TYPE_MAP[item.eventtype] ?? 'other';
        const lat = parseFloat(item.point?.lat ?? item.lat);
        const lon = parseFloat(item.point?.long ?? item.long);
        if (isNaN(lat) || isNaN(lon)) return null;

        // Tropical cyclones: use the wide PAR box regardless of GDACS's own
        // "country" tag, since that tag reflects GDACS's current forecast of
        // affected countries — a typhoon still approaching from the Pacific
        // may not yet be tagged "Philippines" even though it's worth tracking.
        // Everything else keeps the country-name filter (those hazard types
        // aren't something that "approaches" from outside the country).
        const inScope =
          eventType === 'tropical_cyclone'
            ? withinParBbox(lon, lat)
            : (item.country ?? '').toLowerCase().includes('philippines');
        if (!inScope) return null;

        return {
          externalId: item.eventid ?? item.guid,
          dataSourceName: this.name,
          disasterType: eventType,
          officialTitle: item.title,
          sourceAgency: 'GDACS',
          warningLevel: item.alertlevel,
          description: item.description,
          issuedAt: item.pubdate ? new Date(item.pubdate) : new Date(),
          officialSourceUrl: item.link,
          point: { lon, lat }
        };
      })
      .filter((e: NormalizedEvent | null): e is NormalizedEvent => e !== null);
  }
}

function stripPrefix(name: string): string {
  return name.includes(':') ? name.split(':')[1] : name;
}
