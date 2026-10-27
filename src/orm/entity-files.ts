import * as fs from "fs";
import * as path from "path";

const MODULE_FILE = /\.[cm]?[jt]s$/;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]s$/;
const TEST_DIRS = new Set(["__tests__", "tests"]);

/**
 * The entity modules under `dir`, for TypeORM's `entities`. A plain `entities/**\/*.js` glob also matched compiled
 * jest files (`__tests__/*.test.js` land in `dist` when the build includes tests): TypeORM required them at startup,
 * hit `describe is not defined`, and every node that needs the gateway database failed to start.
 */
export function entityFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const files: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!TEST_DIRS.has(entry.name)) files.push(...entityFiles(full));
        } else if (MODULE_FILE.test(entry.name) && !entry.name.endsWith(".d.ts") && !TEST_FILE.test(entry.name)) {
            files.push(full);
        }
    }
    return files.sort();
}
