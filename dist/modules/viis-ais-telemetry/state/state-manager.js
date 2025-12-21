"use strict";
/**
 * State Manager for AIS Telemetry
 * Centralized state management with clean update methods
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateManager = void 0;
const constants_1 = require("../constants");
class StateManager {
    constructor(config, logger) {
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
    getState() {
        return this.state;
    }
    /**
     * Get AIS targets map
     */
    getAisTargets() {
        return this.state.ais;
    }
    /**
     * Get AIS target count
     */
    getAisTargetCount() {
        return Object.keys(this.state.ais).length;
    }
    /**
     * Process parsed NMEA data and update state
     */
    updateFromParsedData(data) {
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
    updatePosition(data, now) {
        if (data.lat == null && data.lon == null)
            return;
        this.state.position = this.state.position || {
            lat: null,
            lon: null,
            sogKnots: null,
            cogDeg: null,
            time: null,
            source: data.source,
            updatedAt: now
        };
        if (data.lat != null)
            this.state.position.lat = data.lat;
        if (data.lon != null)
            this.state.position.lon = data.lon;
        if (data.sogKnots != null)
            this.state.position.sogKnots = data.sogKnots;
        if (data.cogDeg != null)
            this.state.position.cogDeg = data.cogDeg;
        if (data.time != null)
            this.state.position.time = data.time;
        this.state.position.source = data.source;
        this.state.position.updatedAt = now;
    }
    updateVtg(data, now) {
        this.state.vtg = {
            trackTrue: data.trackTrue,
            trackMag: data.trackMag,
            speedKnots: data.speedKnots,
            speedKmh: data.speedKmh,
            mode: data.mode,
            updatedAt: now
        };
    }
    updateHeading(data, now) {
        this.state.heading = {
            headingTrue: data.headingTrue,
            reference: data.reference,
            updatedAt: now
        };
    }
    updateRot(data, now) {
        this.state.rot = {
            rateOfTurnDegPerMin: data.rateOfTurnDegPerMin,
            status: data.status,
            updatedAt: now
        };
    }
    updateVbw(data, now) {
        this.state.vbw = {
            waterLongitudinal: data.waterLongitudinal,
            waterTransverse: data.waterTransverse,
            groundLongitudinal: data.groundLongitudinal,
            groundTransverse: data.groundTransverse,
            sternSpeed: data.sternSpeed,
            updatedAt: now
        };
    }
    updateTime(data, now) {
        this.state.time = {
            isoTime: data.isoTime,
            day: data.day,
            month: data.month,
            year: data.year,
            updatedAt: now
        };
    }
    updateDatum(data, now) {
        this.state.datum = {
            localDatum: data.localDatum,
            referenceDatum: data.referenceDatum,
            latOffsetMinutes: data.latOffsetMinutes,
            lonOffsetMinutes: data.lonOffsetMinutes,
            altOffsetMeters: data.altOffsetMeters,
            updatedAt: now
        };
    }
    addAlarm(data, now) {
        const alarm = {
            alarmNumber: data.alarmNumber,
            condition: data.condition,
            acknowledged: data.acknowledged,
            message: data.message,
            rawFields: null,
            recvAt: now
        };
        this.state.aisAlarms.push(alarm);
        // Limit alarm history
        if (this.state.aisAlarms.length > constants_1.MAX_AIS_ALARMS) {
            this.state.aisAlarms = this.state.aisAlarms.slice(-constants_1.MAX_AIS_ALARMS);
        }
    }
    updateAisTarget(data, now) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
        const info = data.data;
        const mmsi = String(info.mmsi);
        const target = {
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
            lat: (_a = target.lat) !== null && _a !== void 0 ? _a : ((_b = existing === null || existing === void 0 ? void 0 : existing.lat) !== null && _b !== void 0 ? _b : null),
            lon: (_c = target.lon) !== null && _c !== void 0 ? _c : ((_d = existing === null || existing === void 0 ? void 0 : existing.lon) !== null && _d !== void 0 ? _d : null),
            sog: (_e = target.sog) !== null && _e !== void 0 ? _e : ((_f = existing === null || existing === void 0 ? void 0 : existing.sog) !== null && _f !== void 0 ? _f : null),
            cog: (_g = target.cog) !== null && _g !== void 0 ? _g : ((_h = existing === null || existing === void 0 ? void 0 : existing.cog) !== null && _h !== void 0 ? _h : null),
            heading: (_j = target.heading) !== null && _j !== void 0 ? _j : ((_k = existing === null || existing === void 0 ? void 0 : existing.heading) !== null && _k !== void 0 ? _k : null),
            navStatus: (_l = target.navStatus) !== null && _l !== void 0 ? _l : ((_m = existing === null || existing === void 0 ? void 0 : existing.navStatus) !== null && _m !== void 0 ? _m : null),
            msgType: (_o = target.msgType) !== null && _o !== void 0 ? _o : ((_p = existing === null || existing === void 0 ? void 0 : existing.msgType) !== null && _p !== void 0 ? _p : null),
            posAcc: (_q = target.posAcc) !== null && _q !== void 0 ? _q : ((_r = existing === null || existing === void 0 ? void 0 : existing.posAcc) !== null && _r !== void 0 ? _r : null),
            rotRaw: (_s = target.rotRaw) !== null && _s !== void 0 ? _s : ((_t = existing === null || existing === void 0 ? void 0 : existing.rotRaw) !== null && _t !== void 0 ? _t : null),
            timestampSec: (_u = target.timestampSec) !== null && _u !== void 0 ? _u : ((_v = existing === null || existing === void 0 ? void 0 : existing.timestampSec) !== null && _v !== void 0 ? _v : null),
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
    cleanupOldTargets() {
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
    clearState() {
        this.state.ais = {};
        this.state.aisAlarms = [];
        this.logger.debug("[AIS] State cleared");
    }
    /**
     * Get own ship position
     */
    getPosition() {
        if (!this.state.position)
            return null;
        return {
            lat: this.state.position.lat,
            lon: this.state.position.lon
        };
    }
}
exports.StateManager = StateManager;
