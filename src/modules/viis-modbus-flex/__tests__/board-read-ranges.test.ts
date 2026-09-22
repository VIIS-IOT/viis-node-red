import { planRegisterReads } from "../board-read-ranges";

test("splits board2 coils on the real map gap", () => {
    const coils = [
        ...Array.from({ length: 16 }, (_, i) => 160 + i),
        ...Array.from({ length: 16 }, (_, i) => 200 + i),
    ];
    expect(planRegisterReads(coils, 1)).toEqual([
        { payload: { fc: 1, unitid: 1, address: 160, quantity: 16 }, startAddress: 160 },
        { payload: { fc: 1, unitid: 1, address: 200, quantity: 16 }, startAddress: 200 },
    ]);
});

test("splits board2 holding into 0-15 and 20-35", () => {
    const holding = [
        ...Array.from({ length: 16 }, (_, i) => i),
        ...Array.from({ length: 16 }, (_, i) => 20 + i),
    ];
    expect(planRegisterReads(holding, 3)).toEqual([
        { payload: { fc: 3, unitid: 1, address: 0, quantity: 16 }, startAddress: 0 },
        { payload: { fc: 3, unitid: 1, address: 20, quantity: 16 }, startAddress: 20 },
    ]);
});
