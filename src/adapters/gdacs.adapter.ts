import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import { SourceAdapter, NormalizedEvent } from './types';

const EVENT_TYPE_MAP: Record<string, NormalizedEvent['disasterType']> = {
  EQ: 'earthquake',
  TC: 'tropical_cyclone',
  FL: 'flood',
  VO: 'volcano',
  DR: 'other',
  WF: 'wildfire'
};

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
      .filter((item: any) => (item.country ?? '').toLowerCase().includes('philippines'))
      .map((item: any): NormalizedEvent | null => {
        const eventType = EVENT_TYPE_MAP[item.eventtype] ?? 'other';
        const lat = parseFloat(item.point?.lat ?? item.lat);
        const lon = parseFloat(item.point?.long ?? item.long);
        if (isNaN(lat) || isNaN(lon)) return null;
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
