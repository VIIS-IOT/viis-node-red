/**
 * State Manager for AIS Telemetry
 * Centralized state management with clean update methods
 */

import {
  VdrState,
  AisTarget,
  AisAlarm
} from "../viis-ais-telemetry-config";
import { MAX_AIS_ALARMS } from "../constants";
import {
  ParsedData,
  ParsedPosition,
  ParsedVtg,
  ParsedHeading,
  ParsedRot,
  ParsedVbw,
  ParsedTime,
  ParsedDatum,
  ParsedAlarm,
  ParsedAis
} from "../parsers/nmea-parser";
import { ILogger } from "../utils/logger";

export interface StateManagerConfig {
  aisTtlSec: number;
  nearbyRadiusNm: number;
  nearbyMaxAgeSec: number;
  useOwnShipFromAis: boolean;
}

export class StateManager {
  private state: VdrState;
  private config: StateManagerConfig;
  private logger: ILogger;

  constructor(config: StateManagerConfig, logger: ILogger) {
    this.config = config;
    this.logger = logger;
    this.state = {
      ais: {},
      aisAlarms: [],
      lastUpdate: null
    };
  }

  /**
   * Get the current state (read-only)
   */
  getState(): Readonly<VdrState> {
    return this.state;
  }

  /**
   * Get AIS targets map
   */
  getAisTargets(): Record<string, AisTarget> {
    return this.state.ais;
  }

  /**
   * Get AIS target count
   */
  getAisTargetCount(): number {
    return Object.keys(this.state.ais).length;
  }

  /**
   * Process parsed NMEA data and update state
   */
  updateFromParsedData(data: ParsedData): void {
    const now = new Date().toISOString();

    switch (data.type) {
      case "position":
        this.updatePosition(data, now);
        break;
      case "vtg":
        this.updateVtg(data, now);
        break;
      case "heading":
        this.updateHeading(data, now);
        break;
      case "rot":
        this.updateRot(data, now);
        break;
      case "vbw":
        this.updateVbw(data, now);
        break;
      case "time":
        this.updateTime(data, now);
        break;
      case "datum":
        this.updateDatum(data, now);
        break;
      case "alarm":
        this.addAlarm(data, now);
        break;
      case "ais":
        this.updateAisTarget(data, now);
        break;
    }

    this.state.lastUpdate = now;
  }

  private updatePosition(data: ParsedPosition, now: string): void {
    if (data.lat == null && data.lon == null) return;

    this.state.position = this.state.position || {
      lat: null,
      lon: null,
      sogKnots: null,
      cogDeg: null,
      time: null,
      source: data.source,
      updatedAt: now
    };

    if (data.lat != null) this.state.position.lat = data.lat;
    if (data.lon != null) this.state.position.lon = data.lon;
    if (data.sogKnots != null) this.state.position.sogKnots = data.sogKnots;
    if (data.cogDeg != null) this.state.position.cogDeg = data.cogDeg;
    if (data.time != null) this.state.position.time = data.time;
    this.state.position.source = data.source;
    this.state.position.updatedAt = now;
  }

  private updateVtg(data: ParsedVtg, now: string): void {
    this.state.vtg = {
      trackTrue: data.trackTrue,
      trackMag: data.trackMag,
      speedKnots: data.speedKnots,
      speedKmh: data.speedKmh,
      mode: data.mode,
      updatedAt: now
    };
  }

  private updateHeading(data: ParsedHeading, now: string): void {
    this.state.heading = {
      headingTrue: data.headingTrue,
      reference: data.reference,
      updatedAt: now
    };
  }

  private updateRot(data: ParsedRot, now: string): void {
    this.state.rot = {
      rateOfTurnDegPerMin: data.rateOfTurnDegPerMin,
      status: data.status,
      updatedAt: now
    };
  }

  private updateVbw(data: ParsedVbw, now: string): void {
    this.state.vbw = {
      waterLongitudinal: data.waterLongitudinal,
      waterTransverse: data.waterTransverse,
      groundLongitudinal: data.groundLongitudinal,
      groundTransverse: data.groundTransverse,
      sternSpeed: data.sternSpeed,
      updatedAt: now
    };
  }

  private updateTime(data: ParsedTime, now: string): void {
    this.state.time = {
      isoTime: data.isoTime,
      day: data.day,
      month: data.month,
      year: data.year,
      updatedAt: now
    };
  }

  private updateDatum(data: ParsedDatum, now: string): void {
    this.state.datum = {
      localDatum: data.localDatum,
      referenceDatum: data.referenceDatum,
      latOffsetMinutes: data.latOffsetMinutes,
      lonOffsetMinutes: data.lonOffsetMinutes,
      altOffsetMeters: data.altOffsetMeters,
      updatedAt: now
    };
  }

  private addAlarm(data: ParsedAlarm, now: string): void {
    const alarm: AisAlarm = {
      alarmNumber: data.alarmNumber,
      condition: data.condition,
      acknowledged: data.acknowledged,
      message: data.message,
      rawFields: null,
      recvAt: now
    };

    this.state.aisAlarms.push(alarm);

    // Limit alarm history
    if (this.state.aisAlarms.length > MAX_AIS_ALARMS) {
      this.state.aisAlarms = this.state.aisAlarms.slice(-MAX_AIS_ALARMS);
    }
  }

  private updateAisTarget(data: ParsedAis, now: string): void {
    const info = data.data;
    const mmsi = String(info.mmsi);

    const target: AisTarget = {
      mmsi,
      lat: info.lat,
      lon: info.lon,
      sog: info.sogKnots,
      cog: info.cogDeg,
      heading: info.headingDeg,
      navStatus: info.navStatus,
      msgType: info.msgType,
      posAcc: info.posAcc,
      rotRaw: info.rateOfTurnRaw,
      timestampSec: info.timestampSec,
      updatedAt: now
    };

    // Merge with existing target data
    const existing = this.state.ais[mmsi];
    this.state.ais[mmsi] = {
      mmsi,
      lat: target.lat ?? (existing?.lat ?? null),
      lon: target.lon ?? (existing?.lon ?? null),
      sog: target.sog ?? (existing?.sog ?? null),
      cog: target.cog ?? (existing?.cog ?? null),
      heading: target.heading ?? (existing?.heading ?? null),
      navStatus: target.navStatus ?? (existing?.navStatus ?? null),
      msgType: target.msgType ?? (existing?.msgType ?? null),
      posAcc: target.posAcc ?? (existing?.posAcc ?? null),
      rotRaw: target.rotRaw ?? (existing?.rotRaw ?? null),
      timestampSec: target.timestampSec ?? (existing?.timestampSec ?? null),
      updatedAt: now
    };

    // Update own ship position from AIVDO if enabled
    if (data.sentenceType === "VDO" && this.config.useOwnShipFromAis) {
      if (info.lat != null && info.lon != null) {
        this.state.position = {
          lat: info.lat,
          lon: info.lon,
          sogKnots: info.sogKnots,
          cogDeg: info.cogDeg,
          time: null,
          source: "AIVDO",
          updatedAt: now
        };
      }
    }

    this.logger.debug(`[AIS] Updated target MMSI ${mmsi} - lat: ${info.lat}, lon: ${info.lon}, sog: ${info.sogKnots}`);
  }

  /**
   * Remove stale AIS targets based on TTL
   * @returns Number of removed targets
   */
  cleanupOldTargets(): number {
    const nowMs = Date.now();
    let removedCount = 0;

    for (const mmsi of Object.keys(this.state.ais)) {
      const target = this.state.ais[mmsi];
      if (!target || !target.updatedAt) {
        delete this.state.ais[mmsi];
        removedCount++;
        continue;
      }

      const ts = Date.parse(target.updatedAt);
      if (isNaN(ts)) {
        delete this.state.ais[mmsi];
        removedCount++;
        continue;
      }

      const ageSec = (nowMs - ts) / 1000;
      if (ageSec > this.config.aisTtlSec) {
        delete this.state.ais[mmsi];
        removedCount++;
      }
    }

    return removedCount;
  }

  /**
   * Clear all state
   */
  clearState(): void {
    this.state.ais = {};
    this.state.aisAlarms = [];
    this.logger.debug("[AIS] State cleared");
  }

  /**
   * Get own ship position
   */
  getPosition(): { lat: number | null; lon: number | null } | null {
    if (!this.state.position) return null;
    return {
      lat: this.state.position.lat,
      lon: this.state.position.lon
    };
  }
}
