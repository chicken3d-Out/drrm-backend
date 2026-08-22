export interface TrackPoint {
  lon: number;
  lat: number;
  date: string; // ISO timestamp
}

export interface NormalizedEvent {
  externalId: string;
  dataSourceName: string; // must match `name` in data_sources table
  disasterType:
    | 'rainfall'
    | 'tropical_cyclone'
    | 'earthquake'
    | 'tsunami'
    | 'volcano'
    | 'flood'
    | 'landslide'
    | 'wildfire'
    | 'storm_surge'
    | 'other';
  officialTitle: string;
  sourceAgency: string; // verbatim, e.g. "USGS", "PAGASA", "PHIVOLCS"
  warningLevel?: string; // verbatim, never invented
  description?: string;
  issuedAt: Date;
  officialSourceUrl?: string;
  // Geometry: either a point (lon/lat) or a polygon (array of [lon,lat] rings)
  point?: { lon: number; lat: number };
  polygon?: number[][][];
  // Historical positions for moving hazards (tropical cyclones). Ordered
  // oldest-to-newest. Omitted for single-point hazards.
  track?: TrackPoint[];
}

export interface SourceAdapter {
  name: string;
  fetchLatest(): Promise<NormalizedEvent[]>;
}
