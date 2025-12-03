"use strict";
/**
 * viis-ais-telemetry Node
 * Connects to AIS Gateway, parses NMEA/AIS data, and outputs telemetry
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const net = __importStar(require("net"));
module.exports = function (RED) {
    // ===== AIS DECODING HELPERS =====
    /**
     * Decode 6-bit ASCII to binary (AIS armoring)
     */
    function payloadToBinary(payload) {
        let binary = "";
        for (let i = 0; i < payload.length; i++) {
            const charCode = payload.charCodeAt(i);
            let value = charCode - 48;
            if (value > 40) {
                value -= 8;
            }
            if (value < 0 || value > 63) {
                return null;
            }
            binary += value.toString(2).padStart(6, "0");
        }
        return binary;
    }
    function extractBits(binary, start, length) {
        return binary.substring(start, start + length);
    }
    function binaryToInt(binary) {
        return parseInt(binary, 2) || 0;
    }
    function binaryToSignedInt(binary) {
        const value = parseInt(binary, 2);
        const bits = binary.length;
        const max = Math.pow(2, bits - 1);
        return value >= max ? value - Math.pow(2, bits) : value;
    }
    function parseFloatOrNull(v) {
        if (!v)
            return null;
        const n = parseFloat(v);
        return isNaN(n) ? null : n;
    }
    /**
     * Parse NMEA lat/lon (ddmm.mmmm format)
     */
    function parseLatLon(latStr, latHem, lonStr, lonHem) {
        let lat = null;
        let lon = null;
        if (latStr && latHem) {
            const v = parseFloat(latStr);
            if (!isNaN(v)) {
                const deg = Math.floor(v / 100);
                const min = v - deg * 100;
                lat = deg + min / 60.0;
                if (latHem === "S")
                    lat = -lat;
            }
        }
        if (lonStr && lonHem) {
            const v = parseFloat(lonStr);
            if (!isNaN(v)) {
                const deg = Math.floor(v / 100);
                const min = v - deg * 100;
                lon = deg + min / 60.0;
                if (lonHem === "W")
                    lon = -lon;
            }
        }
        return { lat, lon };
    }
    /**
     * Decode AIS position report (Type 1, 2, 3)
     */
    function decodeAisPosReport(payload, fillBits) {
        let bits = payloadToBinary(payload);
        if (!bits)
            return null;
        if (fillBits && fillBits > 0) {
            bits = bits.slice(0, bits.length - fillBits);
        }
        if (bits.length < 168) {
            return null;
        }
        const msgType = binaryToInt(extractBits(bits, 0, 6));
        const mmsi = binaryToInt(extractBits(bits, 8, 30));
        const navStatus = binaryToInt(extractBits(bits, 38, 4));
        const rotRaw = binaryToSignedInt(extractBits(bits, 42, 8));
        const sogRaw = binaryToInt(extractBits(bits, 50, 10));
        const posAcc = binaryToInt(extractBits(bits, 60, 1));
        const lonRaw = binaryToSignedInt(extractBits(bits, 61, 28));
        const latRaw = binaryToSignedInt(extractBits(bits, 89, 27));
        const cogRaw = binaryToInt(extractBits(bits, 116, 12));
        const hdgRaw = binaryToInt(extractBits(bits, 128, 9));
        const timestamp = binaryToInt(extractBits(bits, 137, 6));
        let lon = lonRaw / 600000.0;
        let lat = latRaw / 600000.0;
        if (lon < -180 || lon > 180)
            lon = null;
        if (lat < -90 || lat > 90)
            lat = null;
        const sog = sogRaw === 1023 ? null : sogRaw / 10.0;
        const cog = cogRaw === 3600 ? null : cogRaw / 10.0;
        const hdg = hdgRaw === 511 ? null : hdgRaw;
        return {
            msgType,
            mmsi,
            navStatus,
            posAcc: posAcc === 1,
            sogKnots: sog,
            cogDeg: cog,
            headingDeg: hdg,
            rateOfTurnRaw: rotRaw,
            lat,
            lon,
            timestampSec: timestamp
        };
    }
    /**
     * Decode AIS Type 18 (Class B Position Report)
     */
    function decodeAisType18(payload, fillBits) {
        let bits = payloadToBinary(payload);
        if (!bits)
            return null;
        if (fillBits && fillBits > 0) {
            bits = bits.slice(0, bits.length - fillBits);
        }
        if (bits.length < 168) {
            return null;
        }
        const msgType = binaryToInt(extractBits(bits, 0, 6));
        const mmsi = binaryToInt(extractBits(bits, 8, 30));
        const sogRaw = binaryToInt(extractBits(bits, 46, 10));
        const posAcc = binaryToInt(extractBits(bits, 56, 1));
        const lonRaw = binaryToSignedInt(extractBits(bits, 57, 28));
        const latRaw = binaryToSignedInt(extractBits(bits, 85, 27));
        const cogRaw = binaryToInt(extractBits(bits, 112, 12));
        const hdgRaw = binaryToInt(extractBits(bits, 124, 9));
        let lon = lonRaw / 600000.0;
        let lat = latRaw / 600000.0;
        if (lon < -180 || lon > 180)
            lon = null;
        if (lat < -90 || lat > 90)
            lat = null;
        const sog = sogRaw === 1023 ? null : sogRaw / 10.0;
        const cog = cogRaw === 3600 ? null : cogRaw / 10.0;
        const hdg = hdgRaw === 511 ? null : hdgRaw;
        return {
            msgType,
            mmsi,
            navStatus: null,
            posAcc: posAcc === 1,
            sogKnots: sog,
            cogDeg: cog,
            headingDeg: hdg,
            rateOfTurnRaw: null,
            lat,
            lon,
            timestampSec: null
        };
    }
    // ===== GEOMETRY HELPERS =====
    function toRad(deg) {
        return deg * Math.PI / 180;
    }
    function toDeg(rad) {
        return rad * 180 / Math.PI;
    }
    function distanceNm(lat1, lon1, lat2, lon2) {
        if (lat1 == null || lon1 == null || lat2 == null || lon2 == null)
            return null;
        const R_earth_nm = 3440.065;
        const φ1 = toRad(lat1);
        const φ2 = toRad(lat2);
        const Δφ = toRad(lat2 - lat1);
        const Δλ = toRad(lon2 - lon1);
        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R_earth_nm * c;
    }
    function bearingDeg(lat1, lon1, lat2, lon2) {
        if (lat1 == null || lon1 == null || lat2 == null || lon2 == null)
            return null;
        const φ1 = toRad(lat1);
        const φ2 = toRad(lat2);
        const λ1 = toRad(lon1);
        const λ2 = toRad(lon2);
        const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
        const x = Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
        const θ = Math.atan2(y, x);
        return (toDeg(θ) + 360) % 360;
    }
    // ===== MAIN NODE IMPLEMENTATION =====
    function ViisAisTelemetryNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        // Configuration
        const aisHost = config.aisHost || "192.168.20.246";
        const aisPort = config.aisPort || 8899;
        const outputInterval = config.outputInterval || 300000; // 5 minutes
        const aisTtlSec = config.aisTtlSec || 3600; // 1 hour
        const nearbyRadiusNm = config.nearbyRadiusNm || 10;
        const nearbyMaxAgeSec = config.nearbyMaxAgeSec || 600; // 10 minutes
        const useOwnShipFromAis = config.useOwnShipFromAis !== false;
        // State
        const vdrState = {
            ais: {},
            aisAlarms: [],
            lastUpdate: null
        };
        let tcpClient = null;
        let buffer = "";
        let outputTimer = null;
        let reconnectTimer = null;
        let messageCount = 0;
        let isClosing = false;
        node.log(`[AIS] Initializing - Host: ${aisHost}:${aisPort}, Output interval: ${outputInterval}ms`);
        /**
         * Parse a single NMEA line and update state
         */
        function parseNmeaLine(line) {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w;
            if (!line)
                return;
            const trimmed = line.trim();
            if (!trimmed)
                return;
            // Find start of NMEA sentence
            const dollarIdx = trimmed.indexOf("$");
            const bangIdx = trimmed.indexOf("!");
            let startIdx = -1;
            if (dollarIdx !== -1 && bangIdx !== -1) {
                startIdx = Math.min(dollarIdx, bangIdx);
            }
            else if (dollarIdx !== -1) {
                startIdx = dollarIdx;
            }
            else if (bangIdx !== -1) {
                startIdx = bangIdx;
            }
            if (startIdx === -1)
                return;
            const nmeaLine = trimmed.slice(startIdx);
            const m = nmeaLine.match(/^([$!].*)\\*([0-9A-Fa-f]{2})$/);
            if (!m)
                return;
            const body = m[1].slice(1);
            const fields = body.split(",");
            const talkerAndType = fields[0] || "";
            const type = talkerAndType.slice(2);
            const now = new Date().toISOString();
            messageCount++;
            // AIS: VDM (other ships) / VDO (own ship)
            if (type === "VDM" || type === "VDO") {
                const fragCount = parseInt(fields[1] || "1", 10);
                const fragNum = parseInt(fields[2] || "1", 10);
                const channel = fields[4] || "";
                const payload = fields[5] || "";
                const fillBits = parseInt(((_a = fields[6]) === null || _a === void 0 ? void 0 : _a.split("*")[0]) || "0", 10);
                if (fragCount === 1 && fragNum === 1 && payload) {
                    // Get message type from first 6 bits
                    const bits = payloadToBinary(payload);
                    if (!bits)
                        return;
                    const msgType = binaryToInt(extractBits(bits, 0, 6));
                    let info = null;
                    if (msgType === 1 || msgType === 2 || msgType === 3) {
                        info = decodeAisPosReport(payload, fillBits);
                    }
                    else if (msgType === 18) {
                        info = decodeAisType18(payload, fillBits);
                    }
                    if (info && info.mmsi) {
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
                        // Merge with existing
                        const existing = vdrState.ais[mmsi];
                        vdrState.ais[mmsi] = {
                            mmsi,
                            lat: (_b = target.lat) !== null && _b !== void 0 ? _b : ((_c = existing === null || existing === void 0 ? void 0 : existing.lat) !== null && _c !== void 0 ? _c : null),
                            lon: (_d = target.lon) !== null && _d !== void 0 ? _d : ((_e = existing === null || existing === void 0 ? void 0 : existing.lon) !== null && _e !== void 0 ? _e : null),
                            sog: (_f = target.sog) !== null && _f !== void 0 ? _f : ((_g = existing === null || existing === void 0 ? void 0 : existing.sog) !== null && _g !== void 0 ? _g : null),
                            cog: (_h = target.cog) !== null && _h !== void 0 ? _h : ((_j = existing === null || existing === void 0 ? void 0 : existing.cog) !== null && _j !== void 0 ? _j : null),
                            heading: (_k = target.heading) !== null && _k !== void 0 ? _k : ((_l = existing === null || existing === void 0 ? void 0 : existing.heading) !== null && _l !== void 0 ? _l : null),
                            navStatus: (_m = target.navStatus) !== null && _m !== void 0 ? _m : ((_o = existing === null || existing === void 0 ? void 0 : existing.navStatus) !== null && _o !== void 0 ? _o : null),
                            msgType: (_p = target.msgType) !== null && _p !== void 0 ? _p : ((_q = existing === null || existing === void 0 ? void 0 : existing.msgType) !== null && _q !== void 0 ? _q : null),
                            posAcc: (_r = target.posAcc) !== null && _r !== void 0 ? _r : ((_s = existing === null || existing === void 0 ? void 0 : existing.posAcc) !== null && _s !== void 0 ? _s : null),
                            rotRaw: (_t = target.rotRaw) !== null && _t !== void 0 ? _t : ((_u = existing === null || existing === void 0 ? void 0 : existing.rotRaw) !== null && _u !== void 0 ? _u : null),
                            timestampSec: (_v = target.timestampSec) !== null && _v !== void 0 ? _v : ((_w = existing === null || existing === void 0 ? void 0 : existing.timestampSec) !== null && _w !== void 0 ? _w : null),
                            updatedAt: now
                        };
                        // If AIVDO (own ship) and enabled, update position
                        if (type === "VDO" && useOwnShipFromAis && info.lat != null && info.lon != null) {
                            vdrState.position = {
                                lat: info.lat,
                                lon: info.lon,
                                sogKnots: info.sogKnots,
                                cogDeg: info.cogDeg,
                                time: null,
                                source: "AIVDO",
                                updatedAt: now
                            };
                        }
                        vdrState.lastUpdate = now;
                    }
                }
            }
            // RMC - GPS position
            else if (type === "RMC") {
                const timeStr = fields[1] || null;
                const status = fields[2] || null;
                const latStr = fields[3];
                const latHem = fields[4];
                const lonStr = fields[5];
                const lonHem = fields[6];
                const sog = parseFloatOrNull(fields[7]);
                const cog = parseFloatOrNull(fields[8]);
                const dateStr = fields[9];
                const { lat, lon } = parseLatLon(latStr, latHem, lonStr, lonHem);
                if (lat != null || lon != null) {
                    vdrState.position = vdrState.position || { lat: null, lon: null, sogKnots: null, cogDeg: null, time: null, source: "RMC", updatedAt: now };
                    if (lat != null)
                        vdrState.position.lat = lat;
                    if (lon != null)
                        vdrState.position.lon = lon;
                    if (sog != null)
                        vdrState.position.sogKnots = sog;
                    if (cog != null)
                        vdrState.position.cogDeg = cog;
                    vdrState.position.time = `${timeStr || ""} ${dateStr || ""}`.trim() || null;
                    vdrState.position.source = "RMC";
                    vdrState.position.updatedAt = now;
                }
                vdrState.lastUpdate = now;
            }
            // GGA - GPS fix
            else if (type === "GGA" || type === "GNS" || type === "GLL") {
                let latStr, latHem, lonStr, lonHem;
                if (type === "GGA") {
                    latStr = fields[2];
                    latHem = fields[3];
                    lonStr = fields[4];
                    lonHem = fields[5];
                }
                else if (type === "GNS") {
                    latStr = fields[2];
                    latHem = fields[3];
                    lonStr = fields[4];
                    lonHem = fields[5];
                }
                else if (type === "GLL") {
                    latStr = fields[1];
                    latHem = fields[2];
                    lonStr = fields[3];
                    lonHem = fields[4];
                }
                const { lat, lon } = parseLatLon(latStr, latHem, lonStr, lonHem);
                if (lat != null || lon != null) {
                    vdrState.position = vdrState.position || { lat: null, lon: null, sogKnots: null, cogDeg: null, time: null, source: type, updatedAt: now };
                    if (lat != null)
                        vdrState.position.lat = lat;
                    if (lon != null)
                        vdrState.position.lon = lon;
                    vdrState.position.source = type;
                    vdrState.position.updatedAt = now;
                }
                vdrState.lastUpdate = now;
            }
            // VTG - course & speed
            else if (type === "VTG") {
                vdrState.vtg = {
                    trackTrue: parseFloatOrNull(fields[1]),
                    trackMag: parseFloatOrNull(fields[3]),
                    speedKnots: parseFloatOrNull(fields[5]),
                    speedKmh: parseFloatOrNull(fields[7]),
                    mode: fields[9] || null,
                    updatedAt: now
                };
                vdrState.lastUpdate = now;
            }
            // HDT - true heading
            else if (type === "HDT") {
                vdrState.heading = {
                    headingTrue: parseFloatOrNull(fields[1]),
                    reference: fields[2] || "T",
                    updatedAt: now
                };
                vdrState.lastUpdate = now;
            }
            // ROT - rate of turn
            else if (type === "ROT") {
                vdrState.rot = {
                    rateOfTurnDegPerMin: parseFloatOrNull(fields[1]),
                    status: fields[2] || null,
                    updatedAt: now
                };
                vdrState.lastUpdate = now;
            }
            // VBW - doppler speed log
            else if (type === "VBW") {
                vdrState.vbw = {
                    waterLongitudinal: parseFloatOrNull(fields[1]),
                    waterTransverse: parseFloatOrNull(fields[2]),
                    groundLongitudinal: parseFloatOrNull(fields[4]),
                    groundTransverse: parseFloatOrNull(fields[5]),
                    sternSpeed: parseFloatOrNull(fields[7]),
                    updatedAt: now
                };
                vdrState.lastUpdate = now;
            }
            // ZDA - UTC time/date
            else if (type === "ZDA") {
                const timeStr = fields[1] || null;
                const ddStr = fields[2] || null;
                const mmStr = fields[3] || null;
                const yyyyStr = fields[4] || null;
                let isoTime = null;
                if (timeStr && ddStr && mmStr && yyyyStr) {
                    try {
                        const hh = parseInt(timeStr.slice(0, 2), 10);
                        const mi = parseInt(timeStr.slice(2, 4), 10);
                        const ss = parseInt(timeStr.slice(4, 6), 10);
                        const date = new Date(Date.UTC(parseInt(yyyyStr), parseInt(mmStr) - 1, parseInt(ddStr), hh, mi, ss));
                        isoTime = date.toISOString();
                    }
                    catch (e) { }
                }
                vdrState.time = {
                    isoTime,
                    day: ddStr,
                    month: mmStr,
                    year: yyyyStr,
                    updatedAt: now
                };
                vdrState.lastUpdate = now;
            }
            // DTM - datum
            else if (type === "DTM") {
                const latOff = parseFloatOrNull(fields[3]);
                const latHem = fields[4] || null;
                const lonOff = parseFloatOrNull(fields[5]);
                const lonHem = fields[6] || null;
                let latOffsetSigned = latOff;
                if (latOffsetSigned != null && latHem === "S") {
                    latOffsetSigned = -latOffsetSigned;
                }
                let lonOffsetSigned = lonOff;
                if (lonOffsetSigned != null && lonHem === "W") {
                    lonOffsetSigned = -lonOffsetSigned;
                }
                vdrState.datum = {
                    localDatum: fields[1] || null,
                    referenceDatum: fields[8] || null,
                    latOffsetMinutes: latOffsetSigned,
                    lonOffsetMinutes: lonOffsetSigned,
                    altOffsetMeters: parseFloatOrNull(fields[7]),
                    updatedAt: now
                };
                vdrState.lastUpdate = now;
            }
            // ALR - AIS alarm
            else if (type === "ALR") {
                const alarm = {
                    alarmNumber: fields[2] || null,
                    condition: fields[3] || null,
                    acknowledged: fields[4] || null,
                    message: fields[5] || null,
                    rawFields: null,
                    recvAt: now
                };
                vdrState.aisAlarms.push(alarm);
                if (vdrState.aisAlarms.length > 50) {
                    vdrState.aisAlarms = vdrState.aisAlarms.slice(-50);
                }
                vdrState.lastUpdate = now;
            }
        }
        /**
         * Cleanup old AIS targets
         */
        function cleanupOldTargets() {
            const nowMs = Date.now();
            let removedCount = 0;
            for (const mmsi of Object.keys(vdrState.ais)) {
                const target = vdrState.ais[mmsi];
                if (!target || !target.updatedAt) {
                    delete vdrState.ais[mmsi];
                    removedCount++;
                    continue;
                }
                const ts = Date.parse(target.updatedAt);
                if (isNaN(ts)) {
                    delete vdrState.ais[mmsi];
                    removedCount++;
                    continue;
                }
                const ageSec = (nowMs - ts) / 1000;
                if (ageSec > aisTtlSec) {
                    delete vdrState.ais[mmsi];
                    removedCount++;
                }
            }
            return removedCount;
        }
        /**
         * Build output payload
         */
        function buildPayload() {
            var _a, _b;
            const out = {};
            // Own ship position
            if (vdrState.position) {
                if (vdrState.position.lat != null && vdrState.position.lon != null) {
                    out.location = [vdrState.position.lat, vdrState.position.lon];
                    out.lat = vdrState.position.lat;
                    out.lon = vdrState.position.lon;
                }
                if (vdrState.position.sogKnots != null)
                    out.sog = vdrState.position.sogKnots;
                if (vdrState.position.cogDeg != null)
                    out.cog = vdrState.position.cogDeg;
                if (vdrState.position.time)
                    out.gps_time = vdrState.position.time;
            }
            // VTG
            if (vdrState.vtg) {
                if (vdrState.vtg.speedKnots != null)
                    out.speed_vtg = vdrState.vtg.speedKnots;
                if (vdrState.vtg.speedKmh != null)
                    out.speed_vtg_kmh = vdrState.vtg.speedKmh;
                if (vdrState.vtg.trackTrue != null)
                    out.track_true = vdrState.vtg.trackTrue;
                if (vdrState.vtg.trackMag != null)
                    out.track_mag = vdrState.vtg.trackMag;
            }
            // Heading
            if (vdrState.heading) {
                if (vdrState.heading.headingTrue != null)
                    out.heading_true = vdrState.heading.headingTrue;
            }
            // ROT
            if (vdrState.rot) {
                if (vdrState.rot.rateOfTurnDegPerMin != null)
                    out.rot = vdrState.rot.rateOfTurnDegPerMin;
            }
            // VBW
            if (vdrState.vbw) {
                if (vdrState.vbw.waterLongitudinal != null)
                    out.speed_vbw_water_lng = vdrState.vbw.waterLongitudinal;
                if (vdrState.vbw.waterTransverse != null)
                    out.speed_vbw_water_trn = vdrState.vbw.waterTransverse;
                if (vdrState.vbw.groundLongitudinal != null)
                    out.speed_vbw_ground_lng = vdrState.vbw.groundLongitudinal;
                if (vdrState.vbw.groundTransverse != null)
                    out.speed_vbw_ground_trn = vdrState.vbw.groundTransverse;
                if (vdrState.vbw.sternSpeed != null)
                    out.speed_vbw_stern = vdrState.vbw.sternSpeed;
            }
            // ZDA
            if (vdrState.time) {
                if (vdrState.time.isoTime)
                    out.zda_time = vdrState.time.isoTime;
                if (vdrState.time.day)
                    out.zda_day = vdrState.time.day;
                if (vdrState.time.month)
                    out.zda_month = vdrState.time.month;
                if (vdrState.time.year)
                    out.zda_year = vdrState.time.year;
            }
            // Datum
            if (vdrState.datum) {
                if (vdrState.datum.localDatum)
                    out.datum_local = vdrState.datum.localDatum;
                if (vdrState.datum.referenceDatum)
                    out.datum_ref = vdrState.datum.referenceDatum;
                if (vdrState.datum.latOffsetMinutes != null)
                    out.datum_lat_offset = vdrState.datum.latOffsetMinutes;
                if (vdrState.datum.lonOffsetMinutes != null)
                    out.datum_lon_offset = vdrState.datum.lonOffsetMinutes;
                if (vdrState.datum.altOffsetMeters != null)
                    out.datum_alt_offset = vdrState.datum.altOffsetMeters;
            }
            // AIS targets
            const aisList = [];
            for (const mmsi of Object.keys(vdrState.ais)) {
                const t = vdrState.ais[mmsi];
                if (t) {
                    aisList.push(Object.assign({}, t));
                }
            }
            if (aisList.length > 0) {
                out.ais_targets = aisList;
            }
            // AIS alarms (last 10)
            if (vdrState.aisAlarms.length > 0) {
                out.ais_alarms = vdrState.aisAlarms.slice(-10).map(a => ({
                    alarmNumber: a.alarmNumber,
                    condition: a.condition,
                    acknowledged: a.acknowledged,
                    message: a.message,
                    recvAt: a.recvAt
                }));
            }
            // Nearby vessels
            const ownLat = (_a = vdrState.position) === null || _a === void 0 ? void 0 : _a.lat;
            const ownLon = (_b = vdrState.position) === null || _b === void 0 ? void 0 : _b.lon;
            if (ownLat != null && ownLon != null) {
                const nearby = [];
                const nowMs = Date.now();
                for (const mmsi of Object.keys(vdrState.ais)) {
                    const t = vdrState.ais[mmsi];
                    if (!t || t.lat == null || t.lon == null)
                        continue;
                    // Check freshness
                    if (t.updatedAt) {
                        const ts = Date.parse(t.updatedAt);
                        if (!isNaN(ts)) {
                            const ageSec = (nowMs - ts) / 1000;
                            if (ageSec > nearbyMaxAgeSec)
                                continue;
                        }
                    }
                    const dNm = distanceNm(ownLat, ownLon, t.lat, t.lon);
                    if (dNm == null || dNm > nearbyRadiusNm)
                        continue;
                    const brg = bearingDeg(ownLat, ownLon, t.lat, t.lon);
                    nearby.push({
                        mmsi: t.mmsi,
                        distance_nm: Math.round(dNm * 100) / 100,
                        bearing_deg: brg != null ? Math.round(brg * 10) / 10 : 0,
                        lat: t.lat,
                        lon: t.lon,
                        sog: t.sog,
                        cog: t.cog,
                        heading: t.heading,
                        navStatus: t.navStatus,
                        updatedAt: t.updatedAt
                    });
                }
                // Sort by distance
                nearby.sort((a, b) => a.distance_nm - b.distance_nm);
                if (nearby.length > 0) {
                    out.nearby_vessels = nearby;
                }
            }
            return out;
        }
        /**
         * Output data to node
         */
        function outputData() {
            const removedCount = cleanupOldTargets();
            if (removedCount > 0) {
                node.log(`[AIS] Cleaned up ${removedCount} stale targets`);
            }
            const payload = buildPayload();
            const targetCount = Object.keys(vdrState.ais).length;
            node.log(`[AIS] Outputting data: ${targetCount} AIS targets, ${messageCount} messages received`);
            node.send({
                topic: "ais-telemetry",
                payload
            });
            node.status({
                fill: "green",
                shape: "dot",
                text: `${targetCount} targets @ ${new Date().toLocaleTimeString()}`
            });
        }
        /**
         * Connect to AIS gateway
         */
        function connectToGateway() {
            if (isClosing)
                return;
            node.log(`[AIS] Connecting to ${aisHost}:${aisPort}...`);
            node.status({ fill: "yellow", shape: "ring", text: "Connecting..." });
            tcpClient = new net.Socket();
            tcpClient.on("connect", () => {
                node.log("[AIS] Connected to AIS Gateway");
                node.status({ fill: "green", shape: "dot", text: "Connected" });
                buffer = "";
                messageCount = 0;
            });
            tcpClient.on("data", (data) => {
                buffer += data.toString();
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() || "";
                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            parseNmeaLine(line);
                        }
                        catch (err) {
                            node.warn(`[AIS] Parse error: ${err.message}`);
                        }
                    }
                }
            });
            tcpClient.on("error", (err) => {
                node.error(`[AIS] Connection error: ${err.message}`);
                node.status({ fill: "red", shape: "ring", text: `Error: ${err.message}` });
            });
            tcpClient.on("close", () => {
                node.log("[AIS] Connection closed");
                if (!isClosing) {
                    node.status({ fill: "yellow", shape: "ring", text: "Reconnecting..." });
                    reconnectTimer = setTimeout(connectToGateway, 5000);
                }
            });
            tcpClient.connect(aisPort, aisHost);
        }
        // Start output timer
        outputTimer = setInterval(outputData, outputInterval);
        node.log(`[AIS] Output timer started: ${outputInterval}ms interval`);
        // Connect to gateway
        connectToGateway();
        // Handle input messages
        node.on("input", (msg) => {
            if (msg.getStatus === true) {
                const targetCount = Object.keys(vdrState.ais).length;
                node.send({
                    topic: "ais-status",
                    payload: {
                        connected: (tcpClient === null || tcpClient === void 0 ? void 0 : tcpClient.readable) || false,
                        targetCount,
                        messageCount,
                        lastUpdate: vdrState.lastUpdate
                    }
                });
            }
            if (msg.forceOutput === true) {
                outputData();
            }
            if (msg.clearState === true) {
                vdrState.ais = {};
                vdrState.aisAlarms = [];
                node.log("[AIS] State cleared");
            }
        });
        // Cleanup on close
        node.on("close", (done) => {
            isClosing = true;
            node.log("[AIS] Shutting down...");
            if (outputTimer) {
                clearInterval(outputTimer);
                outputTimer = null;
            }
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            if (tcpClient) {
                tcpClient.destroy();
                tcpClient = null;
            }
            const targetCount = Object.keys(vdrState.ais).length;
            node.log(`[AIS] Closed. Final stats: ${targetCount} targets, ${messageCount} messages`);
            done();
        });
    }
    RED.nodes.registerType("viis-ais-telemetry", ViisAisTelemetryNode);
};
