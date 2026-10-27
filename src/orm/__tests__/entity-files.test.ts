import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { entityFiles } from "../entity-files";

describe("entityFiles", () => {
    let root: string;
    const touch = (rel: string) => {
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

        expect(entityFiles(root).map((file) => path.relative(root, file))).toEqual([
            path.join("device", "TabiotDevice.js"),
            path.join("production-function", "TabioProductionFunction.js"),
            path.join("schedule", "Schedule.ts"),
        ]);
    });

    test("a missing directory gives no files", () => {
        expect(entityFiles(path.join(root, "nope"))).toEqual([]);
    });
});
