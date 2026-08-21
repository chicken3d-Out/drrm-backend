import axios from 'axios';
import { SourceAdapter, NormalizedEvent } from './types';
import { PH_BBOX } from '../config/env';
import { env } from '../config/env';

// NASA FIRMS active fire/hotspot data — requires a free MAP_KEY (register at
// https://firms.modaps.eosdis.nasa.gov/api/map_key/). Rate-limited, so we only
// query the Philippines bounding box, most-recent day, once per sync cycle.
export class FirmsAdapter implements SourceAdapter {
  name = 'FIRMS';

  async fetchLatest(): Promise<NormalizedEvent[]> {
    if (!env.firmsMapKey) {
      // No key configured — skip silently rather than failing the whole sync run.
      return [];
    }
    const bbox = `${PH_BBOX.minLon},${PH_BBOX.minLat},${PH_BBOX.maxLon},${PH_BBOX.maxLat}`;
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${env.firmsMapKey}/VIIRS_SNPP_NRT/${bbox}/1`;

    const { data } = await axios.get(url, { timeout: 20000, responseType: 'text' });
    const lines = String(data).trim().split('\n');
    if (lines.length < 2) return [];

    const header = lines[0].split(',');
    const latIdx = header.indexOf('latitude');
    const lonIdx = header.indexOf('longitude');
    const confIdx = header.indexOf('confidence');
    const dateIdx = header.indexOf('acq_date');
    const timeIdx = header.indexOf('acq_time');

    // FIRMS returns individual hotspot detections, not pre-clustered fires.
    // We surface high/nominal-confidence detections as informational wildfire events;
    // clustering into named incidents is left as a future refinement.
    return lines
      .slice(1)
      .map((line) => line.split(','))
      .filter((cols) => (confIdx >= 0 ? cols[confIdx] !== 'low' : true))
      .slice(0, 50) // cap per cycle to avoid flooding the events table with raw hotspots
      .map((cols, i): NormalizedEvent => {
        const lat = parseFloat(cols[latIdx]);
        const lon = parseFloat(cols[lonIdx]);
        const date = cols[dateIdx];
        const time = cols[timeIdx]?.padStart(4, '0') ?? '0000';
        const issuedAt = new Date(`${date}T${time.slice(0, 2)}:${time.slice(2)}:00Z`);
        return {
          externalId: `${date}-${time}-${lat.toFixed(4)}-${lon.toFixed(4)}-${i}`,
          dataSourceName: this.name,
          disasterType: 'wildfire',
          officialTitle: 'Active fire hotspot detected (satellite)',
          sourceAgency: 'NASA FIRMS',
          description: `Satellite-detected thermal hotspot, confidence: ${cols[confIdx] ?? 'unknown'}.`,
          issuedAt,
          officialSourceUrl: 'https://firms.modaps.eosdis.nasa.gov/',
          point: { lon, lat }
        };
      });
  }
}
