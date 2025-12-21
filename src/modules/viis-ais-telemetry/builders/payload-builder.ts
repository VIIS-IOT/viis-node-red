/**
 * Payload Builder with Builder Pattern
 * Constructs AIS telemetry output payload
 */

import {
  VdrState,
  AisTarget,
  NearbyVessel,
  AisTelemetryPayload
} from "../viis-ais-telemetry-config";
import { MAX_ALARMS_IN_OUTPUT } from "../constants";
import { distanceNm, bearingDeg } from "../utils/geometry";

export interface PayloadBuilderConfig {
  nearbyRadiusNm: number;
  nearbyMaxAgeSec: number;
}

export class TelemetryPayloadBuilder {
  private payload: AisTelemetryPayload = {};
  private config: PayloadBuilderConfig;

  constructor(config: PayloadBuilderConfig) {
    this.config = config;
  }

  /**
   * Reset the builder for a new payload
   */
  reset(): this {
    this.payload = {};
    return this;
  }

  /**
   * Add own ship position data
   */
  withPosition(position: VdrState["position"]): this {
    if (!position) return this;

    if (position.lat != null && position.lon != null) {
      this.payload.location = [position.lat, position.lon];
      this.payload.lat = position.lat;
      this.payload.lon = position.lon;
    }
    if (position.sogKnots != null) this.payload.sog = position.sogKnots;
    if (position.cogDeg != null) this.payload.cog = position.cogDeg;
    if (position.time) this.payload.gps_time = position.time;

    return this;
  }

  /**
   * Add VTG (course & speed) data
   */
  withVtg(vtg: VdrState["vtg"]): this {
    if (!vtg) return this;

    if (vtg.speedKnots != null) this.payload.speed_vtg = vtg.speedKnots;
    if (vtg.speedKmh != null) this.payload.speed_vtg_kmh = vtg.speedKmh;
    if (vtg.trackTrue != null) this.payload.track_true = vtg.trackTrue;
    if (vtg.trackMag != null) this.payload.track_mag = vtg.trackMag;

    return this;
  }

  /**
   * Add heading data
   */
  withHeading(heading: VdrState["heading"]): this {
    if (!heading) return this;

    if (heading.headingTrue != null) {
      this.payload.heading_true = heading.headingTrue;
    }

    return this;
  }

  /**
   * Add rate of turn data
   */
  withRot(rot: VdrState["rot"]): this {
    if (!rot) return this;

    if (rot.rateOfTurnDegPerMin != null) {
      this.payload.rot = rot.rateOfTurnDegPerMin;
    }

    return this;
  }

  /**
   * Add VBW (doppler speed log) data
   */
  withVbw(vbw: VdrState["vbw"]): this {
    if (!vbw) return this;

    if (vbw.waterLongitudinal != null) this.payload.speed_vbw_water_lng = vbw.waterLongitudinal;
    if (vbw.waterTransverse != null) this.payload.speed_vbw_water_trn = vbw.waterTransverse;
    if (vbw.groundLongitudinal != null) this.payload.speed_vbw_ground_lng = vbw.groundLongitudinal;
    if (vbw.groundTransverse != null) this.payload.speed_vbw_ground_trn = vbw.groundTransverse;
    if (vbw.sternSpeed != null) this.payload.speed_vbw_stern = vbw.sternSpeed;

    return this;
  }

  /**
   * Add ZDA (time/date) data
   */
  withTime(time: VdrState["time"]): this {
    if (!time) return this;

    if (time.isoTime) this.payload.zda_time = time.isoTime;
    if (time.day) this.payload.zda_day = time.day;
    if (time.month) this.payload.zda_month = time.month;
    if (time.year) this.payload.zda_year = time.year;

    return this;
  }

  /**
   * Add datum data
   */
  withDatum(datum: VdrState["datum"]): this {
    if (!datum) return this;

    if (datum.localDatum) this.payload.datum_local = datum.localDatum;
    if (datum.referenceDatum) this.payload.datum_ref = datum.referenceDatum;
    if (datum.latOffsetMinutes != null) this.payload.datum_lat_offset = datum.latOffsetMinutes;
    if (datum.lonOffsetMinutes != null) this.payload.datum_lon_offset = datum.lonOffsetMinutes;
    if (datum.altOffsetMeters != null) this.payload.datum_alt_offset = datum.altOffsetMeters;

    return this;
  }

  /**
   * Add AIS targets
   */
  withAisTargets(aisTargets: Record<string, AisTarget>): this {
    const aisList: AisTarget[] = [];
    for (const mmsi of Object.keys(aisTargets)) {
      const target = aisTargets[mmsi];
      if (target) {
        aisList.push({ ...target });
      }
    }

    if (aisList.length > 0) {
      this.payload.ais_targets = aisList;
    }

    return this;
  }

  /**
   * Add AIS alarms (last 10)
   */
  withAlarms(alarms: VdrState["aisAlarms"]): this {
    if (!alarms || alarms.length === 0) return this;

    this.payload.ais_alarms = alarms.slice(-MAX_ALARMS_IN_OUTPUT).map(a => ({
      alarmNumber: a.alarmNumber,
      condition: a.condition,
      acknowledged: a.acknowledged,
      message: a.message,
      recvAt: a.recvAt
    }));

    return this;
  }

  /**
   * Calculate and add nearby vessels
   */
  withNearbyVessels(
    ownLat: number | null,
    ownLon: number | null,
    aisTargets: Record<string, AisTarget>
  ): this {
    if (ownLat == null || ownLon == null) return this;

    const nearby: NearbyVessel[] = [];
    const nowMs = Date.now();

    for (const mmsi of Object.keys(aisTargets)) {
      const target = aisTargets[mmsi];
      if (!target || target.lat == null || target.lon == null) continue;

      // Check freshness
      if (target.updatedAt) {
        const ts = Date.parse(target.updatedAt);
        if (!isNaN(ts)) {
          const ageSec = (nowMs - ts) / 1000;
          if (ageSec > this.config.nearbyMaxAgeSec) continue;
        }
      }

      const dNm = distanceNm(ownLat, ownLon, target.lat, target.lon);
      if (dNm == null || dNm > this.config.nearbyRadiusNm) continue;

      const brg = bearingDeg(ownLat, ownLon, target.lat, target.lon);

      nearby.push({
        mmsi: target.mmsi,
        distance_nm: Math.round(dNm * 100) / 100,
        bearing_deg: brg != null ? Math.round(brg * 10) / 10 : 0,
        lat: target.lat,
        lon: target.lon,
        sog: target.sog,
        cog: target.cog,
        heading: target.heading,
        navStatus: target.navStatus,
        updatedAt: target.updatedAt
      });
    }

    // Sort by distance
    nearby.sort((a, b) => a.distance_nm - b.distance_nm);

    if (nearby.length > 0) {
      this.payload.nearby_vessels = nearby;
    }

    return this;
  }

  /**
   * Build payload from full VDR state
   */
  fromState(state: VdrState): this {
    return this
      .reset()
      .withPosition(state.position)
      .withVtg(state.vtg)
      .withHeading(state.heading)
      .withRot(state.rot)
      .withVbw(state.vbw)
      .withTime(state.time)
      .withDatum(state.datum)
      .withAisTargets(state.ais)
      .withAlarms(state.aisAlarms)
      .withNearbyVessels(
        state.position?.lat ?? null,
        state.position?.lon ?? null,
        state.ais
      );
  }

  /**
   * Build and return the payload
   */
  build(): AisTelemetryPayload {
    return this.payload;
  }
}
