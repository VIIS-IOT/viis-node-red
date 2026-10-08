import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { RotatingFileSink } from "../rotating-file-sink";

describe("RotatingFileSink", () => {
    let directory: string;

    beforeEach(async () => {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), "viis-diag-"));
    });

    afterEach(async () => {
        await fs.rm(directory, { recursive: true, force: true });
    });

    test("rotates by UTF-8 byte size and bounds archive count", async () => {
        const sink = new RotatingFileSink({ directory, maxBytes: 4096, maxFiles: 3 });
        const line = JSON.stringify({ value: "đ".repeat(900) }) + "\n";
        for (let index = 0; index < 8; index++) sink.write(line);
        await sink.flush(2000);
        const files = (await fs.readdir(directory)).filter(name => name.startsWith("rpc-events.ndjson"));
        expect(files.length).toBeLessThanOrEqual(3);
        expect(files).toContain("rpc-events.ndjson");
        await sink.close();
    });

    test("reports bounded queue overflow without throwing", async () => {
        const sink = new RotatingFileSink({ directory, maxQueueBytes: 4096 });
        const accepted = sink.write("x".repeat(3000));
        const overflow = sink.write("y".repeat(3000));
        expect(accepted).toBe(true);
        expect(overflow).toBe(false);
        expect(sink.getStatus().droppedEvents).toBe(1);
        await sink.flush(2000);
        await sink.close();
    });

    test("maxFiles=1 keeps only the current file after rotation", async () => {
        const sink = new RotatingFileSink({ directory, maxBytes: 1024, maxFiles: 1 });
        for (let index = 0; index < 4; index++) sink.write(`${index}:${"x".repeat(700)}`);
        await sink.flush(2000);
        const files = (await fs.readdir(directory)).filter(name => name.startsWith("rpc-events.ndjson"));
        expect(files).toEqual(["rpc-events.ndjson"]);
        await sink.close();
    });
});
