import { deriveLuoiStates, luoiKeysFromCoils } from "../services/luoi-state";

describe("luoiKeysFromCoils", () => {
  it("returns curtains whose thu and dai coils are both mapped", () => {
    expect(luoiKeysFromCoils(["luoi_2_thu", "luoi_1_dai", "luoi_1_thu", "luoi_3_dai", "quat_1"])).toEqual(["luoi_1"]);
  });
});

describe("deriveLuoiStates", () => {
  const keys = ["luoi_1", "luoi_2", "luoi_3", "luoi_4"];

  it("maps the running coil to Thu (0) or Dải (1)", () => {
    const states = deriveLuoiStates(
      keys,
      { luoi_1_thu: true, luoi_1_dai: false, luoi_2_thu: false, luoi_2_dai: true },
      {},
    );
    expect(states).toEqual({ luoi_1: 0, luoi_2: 1 });
  });

  it("keeps the last direction when both coils are off", () => {
    const states = deriveLuoiStates(
      keys,
      { luoi_1_thu: false, luoi_1_dai: false, luoi_2_thu: false, luoi_2_dai: false },
      { luoi_1: 1, luoi_2: 0 },
    );
    expect(states).toEqual({ luoi_1: 1, luoi_2: 0 });
  });

  it("reports N/A (2) with no history or both coils on", () => {
    const states = deriveLuoiStates(
      keys,
      { luoi_3_thu: false, luoi_3_dai: false, luoi_4_thu: true, luoi_4_dai: true },
      { luoi_3: 2 },
    );
    expect(states).toEqual({ luoi_3: 2, luoi_4: 2 });
  });
});
