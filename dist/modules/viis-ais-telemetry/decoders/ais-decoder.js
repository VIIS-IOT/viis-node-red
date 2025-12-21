"use strict";
/**
 * AIS Decoder class
 * Handles decoding of AIS messages from NMEA VDM/VDO sentences
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AisDecoder = void 0;
const constants_1 = require("../constants");
const coordinate_validator_1 = require("../utils/coordinate-validator");
class AisDecoder {
    /**
     * Decode 6-bit ASCII to binary (AIS armoring)
     */
    static payloadToBinary(payload) {
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
    /**
     * Extract bits from binary string
     */
    static extractBits(binary, start, length) {
        return binary.substring(start, start + length);
    }
    /**
     * Convert binary string to unsigned integer
     */
    static binaryToInt(binary) {
        return parseInt(binary, 2) || 0;
    }
    /**
     * Convert binary string to signed integer (two's complement)
     */
    static binaryToSignedInt(binary) {
        const value = parseInt(binary, 2);
        const bits = binary.length;
        const max = Math.pow(2, bits - 1);
        return value >= max ? value - Math.pow(2, bits) : value;
    }
    /**
     * Get message type from payload
     */
    static getMessageType(payload) {
        const bits = this.payloadToBinary(payload);
        if (!bits)
            return null;
        return this.binaryToInt(this.extractBits(bits, 0, 6));
    }
    /**
     * Remove fill bits from binary string
     */
    static removeFillBits(bits, fillBits) {
        if (fillBits && fillBits > 0) {
            return bits.slice(0, bits.length - fillBits);
        }
        return bits;
    }
    /**
     * Convert raw SOG to knots
     */
    static convertSog(rawSog) {
        return rawSog === constants_1.AIS_INVALID_SOG ? null : rawSog / constants_1.AIS_SOG_DIVISOR;
    }
    /**
     * Convert raw COG to degrees
     */
    static convertCog(rawCog) {
        return rawCog === constants_1.AIS_INVALID_COG ? null : rawCog / constants_1.AIS_COG_DIVISOR;
    }
    /**
     * Convert raw heading to degrees
     */
    static convertHeading(rawHdg) {
        return rawHdg === constants_1.AIS_INVALID_HEADING ? null : rawHdg;
    }
    /**
     * Decode AIS position report (Type 1, 2, 3)
     * Class A position reports
     */
    static decodePositionReport(payload, fillBits) {
        let bits = this.payloadToBinary(payload);
        if (!bits)
            return null;
        bits = this.removeFillBits(bits, fillBits);
        if (bits.length < constants_1.AIS_MIN_BITS_POSITION_REPORT) {
            return null;
        }
        const msgType = this.binaryToInt(this.extractBits(bits, 0, 6));
        const mmsi = this.binaryToInt(this.extractBits(bits, 8, 30));
        const navStatus = this.binaryToInt(this.extractBits(bits, 38, 4));
        const rotRaw = this.binaryToSignedInt(this.extractBits(bits, 42, 8));
        const sogRaw = this.binaryToInt(this.extractBits(bits, 50, 10));
        const posAcc = this.binaryToInt(this.extractBits(bits, 60, 1));
        const lonRaw = this.binaryToSignedInt(this.extractBits(bits, 61, 28));
        const latRaw = this.binaryToSignedInt(this.extractBits(bits, 89, 27));
        const cogRaw = this.binaryToInt(this.extractBits(bits, 116, 12));
        const hdgRaw = this.binaryToInt(this.extractBits(bits, 128, 9));
        const timestamp = this.binaryToInt(this.extractBits(bits, 137, 6));
        return {
            msgType,
            mmsi,
            navStatus,
            posAcc: posAcc === 1,
            sogKnots: this.convertSog(sogRaw),
            cogDeg: this.convertCog(cogRaw),
            headingDeg: this.convertHeading(hdgRaw),
            rateOfTurnRaw: rotRaw,
            lat: coordinate_validator_1.CoordinateValidator.convertLatitude(latRaw),
            lon: coordinate_validator_1.CoordinateValidator.convertLongitude(lonRaw),
            timestampSec: timestamp
        };
    }
    /**
     * Decode AIS Type 18 (Class B Position Report)
     */
    static decodeType18(payload, fillBits) {
        let bits = this.payloadToBinary(payload);
        if (!bits)
            return null;
        bits = this.removeFillBits(bits, fillBits);
        if (bits.length < constants_1.AIS_MIN_BITS_POSITION_REPORT) {
            return null;
        }
        const msgType = this.binaryToInt(this.extractBits(bits, 0, 6));
        const mmsi = this.binaryToInt(this.extractBits(bits, 8, 30));
        const sogRaw = this.binaryToInt(this.extractBits(bits, 46, 10));
        const posAcc = this.binaryToInt(this.extractBits(bits, 56, 1));
        const lonRaw = this.binaryToSignedInt(this.extractBits(bits, 57, 28));
        const latRaw = this.binaryToSignedInt(this.extractBits(bits, 85, 27));
        const cogRaw = this.binaryToInt(this.extractBits(bits, 112, 12));
        const hdgRaw = this.binaryToInt(this.extractBits(bits, 124, 9));
        return {
            msgType,
            mmsi,
            navStatus: null,
            posAcc: posAcc === 1,
            sogKnots: this.convertSog(sogRaw),
            cogDeg: this.convertCog(cogRaw),
            headingDeg: this.convertHeading(hdgRaw),
            rateOfTurnRaw: null,
            lat: coordinate_validator_1.CoordinateValidator.convertLatitude(latRaw),
            lon: coordinate_validator_1.CoordinateValidator.convertLongitude(lonRaw),
            timestampSec: null
        };
    }
    /**
     * Decode AIS message based on type
     * Returns null if message type is not supported
     */
    static decode(payload, fillBits) {
        const msgType = this.getMessageType(payload);
        if (msgType === null)
            return null;
        switch (msgType) {
            case constants_1.AIS_MESSAGE_TYPES.POSITION_REPORT_1:
            case constants_1.AIS_MESSAGE_TYPES.POSITION_REPORT_2:
            case constants_1.AIS_MESSAGE_TYPES.POSITION_REPORT_3:
                return this.decodePositionReport(payload, fillBits);
            case constants_1.AIS_MESSAGE_TYPES.CLASS_B_POSITION:
                return this.decodeType18(payload, fillBits);
            default:
                return null;
        }
    }
}
exports.AisDecoder = AisDecoder;
