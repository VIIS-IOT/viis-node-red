"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const modbus_serial_1 = __importDefault(require("modbus-serial"));
const client_registry_1 = __importDefault(require("../../../core/client-registry"));
const config_resolver_1 = require("../services/config-resolver");
const config_validator_1 = require("../services/config-validator");
const multi_board_poll_1 = require("../services/multi-board-poll");
const poll_runner_1 = require("../services/poll-runner");
const DEVICE1_PATH = path_1.default.resolve(__dirname, "../../../../../../../env/configs/device1.json");
function loadDevice1() {
    return JSON.parse(fs_1.default.readFileSync(DEVICE1_PATH, "utf8"));
}
function fakeNode() {
    return {
        id: "e2e-poller",
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        status: jest.fn(),
    };
}
function makeGlobal(config, host, tcpPort) {
    const boards = config.modbusBoards.map((board) => (Object.assign(Object.assign({}, board), { host,
        tcpPort, port: tcpPort })));
    const values = {
        device_id: config.deviceIdentity.DEVICE_ID,
        DEVICE_ID: config.deviceIdentity.DEVICE_ID,
        modbusBoards: boards,
        modbus_boards: boards,
        modbusDefaultBoard: config.modbusDefaultBoard,
        modbus_default_board: config.modbusDefaultBoard,
        modbusMappings: config.modbusMappings,
        modbusPollGroups: config.modbusPollGroups,
        modbusPublishThresholds: config.modbusPublishThresholds,
        scaleConfigs: config.scaleConfigs,
    };
    return {
        get: (key) => values[key],
    };
}
function startDualUnitServer(port) {
    const coils = {
        1: { 0: true, 30: true },
        3: { 0: true },
    };
    const holding = {
        1: { 17: 2500 },
        3: { 0: 77, 1: 215 },
    };
    const input = {
        1: { 20: 4 },
        3: {},
    };
    const vector = {
        getCoil: (addr, unitID) => { var _a; return Boolean((_a = coils[unitID]) === null || _a === void 0 ? void 0 : _a[addr]); },
        getHoldingRegister: (addr, unitID) => { var _a, _b; return (_b = (_a = holding[unitID]) === null || _a === void 0 ? void 0 : _a[addr]) !== null && _b !== void 0 ? _b : 0; },
        getInputRegister: (addr, unitID) => { var _a, _b; return (_b = (_a = input[unitID]) === null || _a === void 0 ? void 0 : _a[addr]) !== null && _b !== void 0 ? _b : 0; },
        setCoil: (addr, value, unitID) => {
            coils[unitID] = coils[unitID] || {};
            coils[unitID][addr] = value;
        },
        setRegister: (addr, value, unitID) => {
            holding[unitID] = holding[unitID] || {};
            holding[unitID][addr] = value;
        },
    };
    const server = new modbus_serial_1.default.ServerTCP(vector, {
        host: "127.0.0.1",
        port,
        unitID: 255,
    });
    return { server, coils, holding, input };
}
async function waitForListen(server, timeoutMs = 3000) {
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Modbus server did not start")), timeoutMs);
        server.on("initialized", () => {
            clearTimeout(timer);
            resolve();
        });
        server.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
describe("device1.json multi-board end to end", () => {
    const port = 18503;
    let server;
    beforeAll(async () => {
        ({ server } = startDualUnitServer(port));
        await waitForListen(server);
    });
    afterAll(async () => {
        client_registry_1.default.resetForTests();
        await new Promise((resolve) => server.close(() => resolve()));
    });
    it("accepts the local device1.json with two same-bus slaves and polls both unit ids", async () => {
        var _a, _b, _c;
        const device = loadDevice1();
        expect(device.modbusBoards).toHaveLength(2);
        expect(device.modbusBoards.map((board) => board.unitId)).toEqual([1, 3]);
        expect(device.modbusBoards.map((board) => `${board.host}:${board.tcpPort}`)).toEqual([
            "modbus-server-test:503",
            "modbus-server-test:503",
        ]);
        expect(device.modbusMappings.board2.coils.aux_pump).toBe(0);
        const resolved = (0, config_resolver_1.resolvePollerConfig)({ boardId: "board1" }, makeGlobal(device, "127.0.0.1", port));
        const validation = (0, config_validator_1.validateResolvedConfig)(resolved);
        expect(validation.errors).toEqual([]);
        expect((_a = resolved.boards) === null || _a === void 0 ? void 0 : _a.map((board) => board.boardId)).toEqual(["board1", "board2"]);
        expect((_b = resolved.boards) === null || _b === void 0 ? void 0 : _b[1].pollingConfig.realtime.coils).toEqual(["aux_pump"]);
        expect((_c = resolved.boards) === null || _c === void 0 ? void 0 : _c[1].pollingConfig.sensors.holding).toEqual(["soil_moisture", "soil_temp"]);
        client_registry_1.default.resetForTests();
        client_registry_1.default.initializeMultiBoardConfig({
            mode: "multi",
            defaultBoard: "board1",
            boards: resolved.boards.map((board) => ({
                id: board.boardId,
                type: "TCP",
                host: "127.0.0.1",
                tcpPort: port,
                unitId: board.unitId,
            })),
        }, fakeNode());
        const node = fakeNode();
        const board1Client = await client_registry_1.default.getModbusClientV2("board1", node);
        const board2Client = await client_registry_1.default.getModbusClientV2("board2", fakeNode());
        expect(board1Client).not.toBe(board2Client);
        expect(client_registry_1.default.getHostConnectionCounts()).toEqual({ [`127.0.0.1:${port}`]: 1 });
        const targets = (0, multi_board_poll_1.getPollTargets)(resolved);
        const tickResults = [];
        for (const board of targets) {
            const client = board.boardId === "board1" ? board1Client : board2Client;
            tickResults.push(await (0, poll_runner_1.runPollTick)({
                modbusClient: client,
                dueGroups: ["realtime", "sensors"],
                config: Object.assign(Object.assign({}, resolved), { boardId: board.boardId, mappings: board.mappings, pollingConfig: board.pollingConfig }),
                previousState: {},
                options: {
                    maxGap: 5,
                    maxCoilsPerRead: 64,
                    maxRegistersPerRead: 32,
                    publishFullSnapshot: true,
                },
            }));
        }
        const merged = (0, multi_board_poll_1.mergePollTickResults)(tickResults);
        expect(merged.latestData.power).toBe(true);
        expect(merged.latestData.main_pump).toBe(true);
        expect(merged.latestData.aux_pump).toBe(true);
        expect(merged.latestData.soil_moisture).toBe(77);
        expect(merged.latestData.soil_temp).toBe(215);
        expect(merged.diagnostics.boardId).toBe("board1,board2");
        expect(merged.diagnostics.errorCount).toBe(0);
    }, 30000);
});
