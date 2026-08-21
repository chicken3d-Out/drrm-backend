import axios from 'axios';
import { SourceAdapter, NormalizedEvent } from './types';

// Leyte municipalities/cities to check against the PAGASA TenDay API.
// This is a forecast product (rainfall, temperature, wind), not the official
// PAGASA rainfall-warning/wind-signal bulletin — those still come through the
// manual-entry adapter with verbatim wording. This adapter surfaces
// heavy-rainfall / strong-wind FORECAST conditions as informational entries,
// clearly distinct from an official warning.
const LEYTE_LOCATIONS = [
  'Tacloban City',
  'Palo',
  'Tanauan',
  'Tolosa',
  'Alangalang',
  'Ormoc City',
  'Baybay City',
  'Carigara',
  'Jaro',
  'Dulag'
];

// Thresholds above which a forecast is worth surfacing as an informational entry.
const HEAVY_RAINFALL_MM = 30; // per-day forecast rainfall
const STRONG_WIND_KPH = 40;

export class PagasaTendayAdapter implements SourceAdapter {
  name = 'PAGASA_TENDAY';

  async fetchLatest(): Promise<NormalizedEvent[]> {
    const events: NormalizedEvent[] = [];

    for (const municity of LEYTE_LOCATIONS) {
      try {
        const { data } = await axios.get('https://tenday.pagasa.dost.gov.ph/api/v1/tenday/current', {
          params: { municity },
          timeout: 10000
        });
        const forecast = Array.isArray(data) ? data[0] : data?.data?.[0] ?? data;
        if (!forecast) continue;

        const rainfallMm = parseFloat(forecast.rainfall ?? forecast.rf ?? '0');
        const windKph = parseFloat(forecast.wind_speed ?? forecast.windSpeed ?? '0');

        if (rainfallMm >= HEAVY_RAINFALL_MM) {
          events.push({
            externalId: `rainfall-${municity}-${forecast.date ?? new Date().toISOString().slice(0, 10)}`,
            dataSourceName: this.name,
            disasterType: 'rainfall',
            officialTitle: `Forecast heavy rainfall — ${municity}`,
            sourceAgency: 'PAGASA (TenDay Forecast)',
            warningLevel: `Forecast ${rainfallMm}mm`,
            description:
              'Forecast condition from the PAGASA 10-day outlook, not an official rainfall warning bulletin. Cross-check with the official PAGASA rainfall warning for verbatim wording.',
            issuedAt: new Date(),
            officialSourceUrl: 'https://www.pagasa.dost.gov.ph/'
          });
        }
        if (windKph >= STRONG_WIND_KPH) {
          events.push({
            externalId: `wind-${municity}-${forecast.date ?? new Date().toISOString().slice(0, 10)}`,
            dataSourceName: this.name,
            disasterType: 'tropical_cyclone',
            officialTitle: `Forecast strong winds — ${municity}`,
            sourceAgency: 'PAGASA (TenDay Forecast)',
            warningLevel: `Forecast ${windKph} kph`,
            description:
              'Forecast condition from the PAGASA 10-day outlook, not an official wind signal number. Cross-check with the official PAGASA tropical cyclone bulletin for the verbatim signal.',
            issuedAt: new Date(),
            officialSourceUrl: 'https://www.pagasa.dost.gov.ph/'
          });
        }
      } catch {
        // One municipality failing shouldn't break the whole sync cycle.
        continue;
      }
    }
    return events;
  }
}
