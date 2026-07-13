import { INVALID_MODBUS_ADDRESSES } from "../constants";
import { AddressRange, RangePlanInput } from "../types";

function isReadableAddress(address: number | undefined): address is number {
  return (
    Number.isInteger(address) &&
    address >= 0 &&
    !INVALID_MODBUS_ADDRESSES.includes(address as (typeof INVALID_MODBUS_ADDRESSES)[number])
  );
}

function toAddressRecord(address: number, keys: string[]): Record<number, string[]> {
  return { [address]: keys };
}

export function planAddressRanges(input: RangePlanInput): AddressRange[] {
  const keysByAddress = new Map<number, string[]>();

  for (const key of input.requestedKeys) {
    const address = input.mapping[key];
    if (!isReadableAddress(address)) {
      continue;
    }

    const aliases = keysByAddress.get(address) ?? [];
    aliases.push(key);
    keysByAddress.set(address, aliases);
  }

  const addresses = Array.from(keysByAddress.keys()).sort((left, right) => left - right);
  const ranges: AddressRange[] = [];

  for (const address of addresses) {
    const currentRange = ranges[ranges.length - 1];
    const previousAddress = currentRange?.addresses[currentRange.addresses.length - 1];
    const gap = previousAddress === undefined ? 0 : address - previousAddress;
    const nextQuantity = currentRange ? address - currentRange.start + 1 : 1;
    const aliases = keysByAddress.get(address) ?? [];

    if (!currentRange || gap > input.maxGap || nextQuantity > input.maxQuantity) {
      ranges.push({
        registerType: input.registerType,
        functionCode: input.functionCode,
        start: address,
        quantity: 1,
        addresses: [address],
        keysByAddress: toAddressRecord(address, aliases),
      });
      continue;
    }

    currentRange.addresses.push(address);
    currentRange.quantity = nextQuantity;
    currentRange.keysByAddress[address] = aliases;
  }

  return ranges;
}
