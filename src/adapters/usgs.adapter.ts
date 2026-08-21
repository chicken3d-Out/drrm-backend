import axios from 'axios';
import { SourceAdapter, NormalizedEvent } from './types';
import { PH_BBOX } from '../config/env';

// USGS FDSN Event Web Service — public, no API key required.
// Docs: https://earthquake.usgs.gov/fdsnws/event/1/
export class UsgsAdapter implements SourceAdapter {
  name = 'USGS';

  async fetchLatest(): Promise<NormalizedEvent[]> {
    const params = {
      format: 'geojson',
      starttime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      minlatitude: PH_BBOX.minLat,
      maxlatitude: PH_BBOX.maxLat,
      minlongitude: PH_BBOX.minLon,
      maxlongitude: PH_BBOX.maxLon,
      minmagnitude: 2.5,
      orderby: 'time'
    };
    const { data } = await axios.get('https://earthquake.usgs.gov/fdsnws/event/1/query', {
      params,
      timeout: 15000
    });

    return (data.features ?? []).map((f: any): NormalizedEvent => {
      const [lon, lat, depthKm] = f.geometry.coordinates;
      const mag = f.properties.mag;
      return {
        externalId: f.id,
        dataSourceName: this.name,
        disasterType: 'earthquake',
        officialTitle: f.properties.title ?? `M${mag} earthquake`,
        sourceAgency: 'USGS',
        warningLevel: mag != null ? `M${mag.toFixed(1)}` : undefined,
        description: `Depth ${depthKm ?? 'unknown'} km. Reported by USGS global monitoring network.`,
        issuedAt: new Date(f.properties.time),
        officialSourceUrl: f.properties.url,
        point: { lon, lat }
      };
    });
  }
}
