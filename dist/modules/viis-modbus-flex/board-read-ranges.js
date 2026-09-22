"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planRegisterReads = planRegisterReads;
function planRegisterReads(addresses, fc, unitId = 1) {
    const sorted = [...new Set(addresses)]
        .filter((address) => Number.isInteger(address) && address >= 0)
        .sort((a, b) => a - b);
    const ranges = [];
    for (const address of sorted) {
        const last = ranges[ranges.length - 1];
        if (last && address === last.startAddress + last.payload.quantity) {
            last.payload.quantity += 1;
        }
        else {
            ranges.push({
                payload: { fc, unitid: unitId, address, quantity: 1 },
                startAddress: address,
            });
        }
    }
    return ranges;
}
