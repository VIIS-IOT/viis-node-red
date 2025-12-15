"use strict";
/**
 * NMEA Parser with Strategy Pattern
 * Each sentence type has its own parser implementation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NmeaParser = void 0;
const constants_1 = require("../constants");
const ais_decoder_1 = require("../decoders/ais-decoder");
const coordinate_validator_1 = require("../utils/coordinate-validator");
// ===== HELPER FUNCTIONS =====
function parseFloatOrNull(v) {
    if (!v)
        return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
}
// ===== PARSER IMPLEMENTATIONS =====
class RmcParser {
    canParse(type) {
        return type === constants_1.NMEA_TYPES.RMC;
    }
    parse(fields) {
        const timeStr = fields[1] || null;
        const latStr = fields[3];
        const latHem = fields[4];
        const lonStr = fields[5];
        const lonHem = fields[6];
        const sog = parseFloatOrNull(fields[7]);
        const cog = parseFloatOrNull(fields[8]);
        const dateStr = fields[9];
        const { lat, lon } = coordinate_validator_1.CoordinateValidator.parseNmeaLatLon(latStr, latHem, lonStr, lonHem);
        if (lat == null && lon == null)
            return null;
        return {
            type: "position",
            lat,
            lon,
            sogKnots: sog,
            cogDeg: cog,
            time: `${timeStr || ""} ${dateStr || ""}`.trim() || null,
            source: "RMC"
        };
    }
}
class GgaParser {
    canParse(type) {
        return type === constants_1.NMEA_TYPES.GGA || type === constants_1.NMEA_TYPES.GNS || type === constants_1.NMEA_TYPES.GLL;
    }
    parse(fields, fullType) {
        const type = fullType.slice(2); // Remove talker ID
        let latStr;
        let latHem;
        let lonStr;
        let lonHem;
        if (type === constants_1.NMEA_TYPES.GGA || type === constants_1.NMEA_TYPES.GNS) {
            latStr = fields[2];
            latHem = fields[3];
            lonStr = fields[4];
            lonHem = fields[5];
        }
        else if (type === constants_1.NMEA_TYPES.GLL) {
            latStr = fields[1];
            latHem = fields[2];
            lonStr = fields[3];
            lonHem = fields[4];
        }
        const { lat, lon } = coordinate_validator_1.CoordinateValidator.parseNmeaLatLon(latStr, latHem, lonStr, lonHem);
        if (lat == null && lon == null)
            return null;
        return {
            type: "position",
            lat,
            lon,
            sogKnots: null,
            cogDeg: null,
            time: null,
            source: type
        };
    }
}
class VtgParser {
    canParse(type) {
        return type === constants_1.NMEA_TYPES.VTG;
    }
    parse(fields) {
        return {
            type: "vtg",
            trackTrue: parseFloatOrNull(fields[1]),
            trackMag: parseFloatOrNull(fields[3]),
            speedKnots: parseFloatOrNull(fields[5]),
            speedKmh: parseFloatOrNull(fields[7]),
            mode: fields[9] || null
        };
    }
}
class HdtParser {
    canParse(type) {
        return type === constants_1.NMEA_TYPES.HDT;
    }
    parse(fields) {
        return {
            type: "heading",
            headingTrue: parseFloatOrNull(fields[1]),
            reference: fields[2] || "T"
        };
    }
}
class RotParser {
    canParse(type) {
        return type === constants_1.NMEA_TYPES.ROT;
    }
    parse(fields) {
        return {
            type: "rot",
            rateOfTurnDegPerMin: parseFloatOrNull(fields[1]),
            status: fields[2] || null
        };
    }
}
class VbwParser {
    canParse(type) {
        return type === constants_1.NMEA_TYPES.VBW;
    }
    parse(fields) {
        return {
            type: "vbw",
            waterLongitudinal: parseFloatOrNull(fields[1]),
            waterTransverse: parseFloatOrNull(fields[2]),
            groundLongitudinal: parseFloatOrNull(fields[4]),
            groundTransverse: parseFloatOrNull(fields[5]),
            sternSpeed: parseFloatOrNull(fields[7])
        };
    }
}
class ZdaParser {
    canParse(type) {
        return type === constants_1.NMEA_TYPES.ZDA;
    }
    parse(fields) {
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
            catch (e) {
                // Invalid time format
            }
        }
        return {
            type: "time",
            isoTime,
            day: ddStr,
            month: mmStr,
            year: yyyyStr
        };
    }
}
class DtmParser {
    canParse(type) {
        return type === constants_1.NMEA_TYPES.DTM;
    }
    parse(fields) {
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
        return {
            type: "datum",
            localDatum: fields[1] || null,
            referenceDatum: fields[8] || null,
            latOffsetMinutes: latOffsetSigned,
            lonOffsetMinutes: lonOffsetSigned,
            altOffsetMeters: parseFloatOrNull(fields[7])
        };
    }
}
class AlrParser {
    canParse(type) {
        return type === constants_1.NMEA_TYPES.ALR;
    }
    parse(fields) {
        return {
            type: "alarm",
            alarmNumber: fields[2] || null,
            condition: fields[3] || null,
            acknowledged: fields[4] || null,
            message: fields[5] || null
        };
    }
}
class VdmVdoParser {
    canParse(type) {
        return type === constants_1.NMEA_TYPES.VDM || type === constants_1.NMEA_TYPES.VDO;
    }
    parse(fields, fullType) {
        var _a;
        const type = fullType.slice(2);
        const fragCount = parseInt(fields[1] || "1", 10);
        const fragNum = parseInt(fields[2] || "1", 10);
        const payload = fields[5] || "";
        const fillBits = parseInt(((_a = fields[6]) === null || _a === void 0 ? void 0 : _a.split("*")[0]) || "0", 10);
        // Only handle single-fragment messages
        if (fragCount !== 1 || fragNum !== 1 || !payload) {
            return null;
        }
        const decoded = ais_decoder_1.AisDecoder.decode(payload, fillBits);
        if (!decoded || !decoded.mmsi) {
            return null;
        }
        return {
            type: "ais",
            sentenceType: type,
            data: decoded
        };
    }
}
// ===== NMEA PARSER FACTORY =====
class NmeaParser {
    constructor() {
        this.parsers = [
            new VdmVdoParser(),
            new RmcParser(),
            new GgaParser(),
            new VtgParser(),
            new HdtParser(),
            new RotParser(),
            new VbwParser(),
            new ZdaParser(),
            new DtmParser(),
            new AlrParser()
        ];
    }
    /**
     * Parse a single NMEA line
     * @returns Parsed data or null if invalid/unsupported
     */
    parse(line) {
        if (!line)
            return null;
        const trimmed = line.trim();
        if (!trimmed)
            return null;
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
            return null;
        const nmeaLine = trimmed.slice(startIdx);
        const match = nmeaLine.match(/^([$!].*)\*([0-9A-Fa-f]{2})$/);
        if (!match)
            return null;
        const body = match[1].slice(1);
        const fields = body.split(",");
        const talkerAndType = fields[0] || "";
        const type = talkerAndType.slice(2);
        const parser = this.parsers.find(p => p.canParse(type));
        if (!parser)
            return null;
        return parser.parse(fields, talkerAndType);
    }
}
exports.NmeaParser = NmeaParser;
