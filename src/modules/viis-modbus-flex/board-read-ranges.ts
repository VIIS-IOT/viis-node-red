export interface RegisterReadRequest {
    payload: { fc: number; unitid: number; address: number; quantity: number };
    startAddress: number;
}

export function planRegisterReads(addresses: number[], fc: number, unitId = 1): RegisterReadRequest[] {
    const sorted = [...new Set(addresses)]
        .filter((address) => Number.isInteger(address) && address >= 0)
        .sort((a, b) => a - b);
    const ranges: RegisterReadRequest[] = [];
    for (const address of sorted) {
        const last = ranges[ranges.length - 1];
        if (last && address === last.startAddress + last.payload.quantity) {
            last.payload.quantity += 1;
        } else {
            ranges.push({
                payload: { fc, unitid: unitId, address, quantity: 1 },
                startAddress: address,
            });
        }
    }
    return ranges;
}
