"use strict";
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
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const entity_files_1 = require("../entity-files");
describe("entityFiles", () => {
    let root;
    const touch = (rel) => {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "");
    };
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "entities-"));
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
    test("lists entity modules and skips tests, so TypeORM never loads a jest file at runtime", () => {
        touch("device/TabiotDevice.js");
        touch("production-function/TabioProductionFunction.js");
        touch("production-function/__tests__/TabioProductionFunction.test.js");
        touch("schedule/Schedule.spec.ts");
        touch("schedule/Schedule.ts");
        touch("schedule/Schedule.d.ts");
        touch("schedule/Schedule.js.map");
        expect((0, entity_files_1.entityFiles)(root).map((file) => path.relative(root, file))).toEqual([
            path.join("device", "TabiotDevice.js"),
            path.join("production-function", "TabioProductionFunction.js"),
            path.join("schedule", "Schedule.ts"),
        ]);
    });
    test("a missing directory gives no files", () => {
        expect((0, entity_files_1.entityFiles)(path.join(root, "nope"))).toEqual([]);
    });
});
