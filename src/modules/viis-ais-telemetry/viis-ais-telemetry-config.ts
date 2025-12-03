/**
 * Configuration types for viis-ais-telemetry node
 * AIS Gateway data collection and telemetry
 */

import { NodeDef } from "node-red";

export interface ViisAisTelemetryNodeDef extends NodeDef {
  // AIS Gateway connection
  aisHost: string;           // AIS Gateway IP address
  aisPort: number;           // AIS Gateway port (default: 8899)
  
  // Output intervals
  outputInterval: number;    // Interval to output data (ms), default: 300000 (5 min)
  
  // AIS configuration
  aisTtlSec: number;         // Time-to-live for AIS targets (seconds), default: 3600 (1 hour)
  nearbyRadiusNm: number;    // Radius for nearby vessels (nautical miles), default: 10
  nearbyMaxAgeSec: number;   // Max age for nearby vessels (seconds), default: 600 (10 min)
  
  // Own ship position source
  useOwnShipFromAis: boolean; // Use AIVDO (own ship) as position source
}

export interface AisGatewayConfig {
  host: string;
  port: number;
  reconnectDelay: number;
}

export interface AisOutputConfig {
  outputInterval: number;
  aisTtlSec: number;
  nearbyRadiusNm: number;
  nearbyMaxAgeSec: number;
}

/**
 * VDR State - stores all parsed NMEA/AIS data
 */
export interface VdrState {
  // GPS position (own ship)
  position?: {
    lat: number | null;
    lon: number | null;
    sogKnots: number | null;
    cogDeg: number | null;
    time: string | null;
    source: string;
    updatedAt: string;
  };
  
  // VTG - course & speed
  vtg?: {
    trackTrue: number | null;
    trackMag: number | null;
    speedKnots: number | null;
    speedKmh: number | null;
    mode: string | null;
    updatedAt: string;
  };
  
  // Heading
  heading?: {
    headingTrue: number | null;
    reference: string;
    updatedAt: string;
  };
  
  // Rate of turn
  rot?: {
    rateOfTurnDegPerMin: number | null;
    status: string | null;
    updatedAt: string;
  };
  
  // Doppler speed log
  vbw?: {
    waterLongitudinal: number | null;
    waterTransverse: number | null;
    groundLongitudinal: number | null;
    groundTransverse: number | null;
    sternSpeed: number | null;
    updatedAt: string;
  };
  
  // ZDA time/date
  time?: {
    isoTime: string | null;
    day: string | null;
    month: string | null;
    year: string | null;
    updatedAt: string;
  };
  
  // Datum
  datum?: {
    localDatum: string | null;
    referenceDatum: string | null;
    latOffsetMinutes: number | null;
    lonOffsetMinutes: number | null;
    altOffsetMeters: number | null;
    updatedAt: string;
  };
  
  // AIS targets by MMSI
  ais: Record<string, AisTarget>;
  
  // AIS alarms
  aisAlarms: AisAlarm[];
  
  // Last update timestamp
  lastUpdate: string | null;
}

export interface AisTarget {
  mmsi: string;
  lat: number | null;
  lon: number | null;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  navStatus: number | null;
  msgType: number | null;
  posAcc: boolean | null;
  rotRaw: number | null;
  timestampSec: number | null;
  updatedAt: string;
}

export interface AisAlarm {
  alarmNumber: string | null;
  condition: string | null;
  acknowledged: string | null;
  message: string | null;
  rawFields: string[] | null;
  recvAt: string;
}

export interface NearbyVessel {
  mmsi: string;
  distance_nm: number;
  bearing_deg: number;
  lat: number | null;
  lon: number | null;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  navStatus: number | null;
  updatedAt: string;
}

/**
 * Output payload format (matching boss's flow)
 */
export interface AisTelemetryPayload {
  // Own ship position
  location?: [number, number];
  lat?: number;
  lon?: number;
  sog?: number;
  cog?: number;
  gps_time?: string;
  
  // VTG speed
  speed_vtg?: number;
  speed_vtg_kmh?: number;
  track_true?: number;
  track_mag?: number;
  
  // Heading
  heading_true?: number;
  
  // Rate of turn
  rot?: number;
  
  // Doppler speed log
  speed_vbw_water_lng?: number;
  speed_vbw_water_trn?: number;
  speed_vbw_ground_lng?: number;
  speed_vbw_ground_trn?: number;
  speed_vbw_stern?: number;
  
  // UTC time
  zda_time?: string;
  zda_day?: string;
  zda_month?: string;
  zda_year?: string;
  
  // Datum
  datum_local?: string;
  datum_ref?: string;
  datum_lat_offset?: number;
  datum_lon_offset?: number;
  datum_alt_offset?: number;
  
  // AIS targets
  ais_targets?: AisTarget[];
  
  // AIS alarms
  ais_alarms?: {
    alarmNumber: string | null;
    condition: string | null;
    acknowledged: string | null;
    message: string | null;
    recvAt: string;
  }[];
  
  // Nearby vessels
  nearby_vessels?: NearbyVessel[];
}
