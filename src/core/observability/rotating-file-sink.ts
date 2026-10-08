import * as fs from "fs/promises";
import * as path from "path";

export interface RotatingFileSinkOptions {
    directory: string;
    fileName?: string;
    maxBytes?: number;
    maxFiles?: number;
    maxQueueBytes?: number;
    retryDelayMs?: number;
}

export class RotatingFileSink {
    private readonly filePath: string;
    private readonly maxBytes: number;
    private readonly maxFiles: number;
    private readonly maxQueueBytes: number;
    private readonly retryDelayMs: number;
    private queue: string[] = [];
    private queuedBytes = 0;
    private draining = false;
    private closed = false;
    private droppedEvents = 0;
    private lastErrorAt?: string;
    private retryAfter = 0;

    constructor(
        options: RotatingFileSinkOptions,
        private readonly onError?: (error: Error) => void,
        private readonly onRecovered?: () => void,
    ) {
        const fileName = options.fileName || "rpc-events.ndjson";
        if (path.basename(fileName) !== fileName) throw new Error("Diagnostic file name must not contain a path");
        this.filePath = path.join(path.resolve(options.directory), fileName);
        this.maxBytes = Math.max(1024, options.maxBytes || 10 * 1024 * 1024);
        this.maxFiles = Math.max(1, Math.min(20, Math.floor(options.maxFiles || 5)));
        this.maxQueueBytes = Math.max(4096, options.maxQueueBytes || 4 * 1024 * 1024);
        this.retryDelayMs = Math.max(1000, options.retryDelayMs || 30000);
    }

    write(line: string): boolean {
        if (this.closed) return false;
        const normalized = line.endsWith("\n") ? line : `${line}\n`;
        const bytes = Buffer.byteLength(normalized, "utf8");
        if (bytes > this.maxBytes || this.queuedBytes + bytes > this.maxQueueBytes) {
            this.droppedEvents++;
            return false;
        }
        this.queue.push(normalized);
        this.queuedBytes += bytes;
        void this.drain();
        return true;
    }

    getStatus(): { status: "healthy" | "degraded"; droppedEvents: number; queuedBytes: number; lastErrorAt?: string } {
        return {
            status: this.lastErrorAt ? "degraded" : "healthy",
            droppedEvents: this.droppedEvents,
            queuedBytes: this.queuedBytes,
            ...(this.lastErrorAt ? { lastErrorAt: this.lastErrorAt } : {}),
        };
    }

    async flush(timeoutMs = 1000): Promise<void> {
        const deadline = Date.now() + Math.max(0, timeoutMs);
        while ((this.draining || this.queue.length > 0) && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }

    async close(timeoutMs = 1000): Promise<void> {
        await this.flush(timeoutMs);
        this.closed = true;
    }

    private async drain(): Promise<void> {
        if (this.draining || this.closed || this.queue.length === 0) return;
        if (Date.now() < this.retryAfter) {
            this.droppedEvents += this.queue.length;
            this.queue = [];
            this.queuedBytes = 0;
            return;
        }
        this.draining = true;
        try {
            while (this.queue.length > 0 && !this.closed) {
                const line = this.queue[0];
                await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o750 });
                await this.rotateIfNeeded(Buffer.byteLength(line, "utf8"));
                await fs.appendFile(this.filePath, line, { encoding: "utf8", mode: 0o640 });
                this.queue.shift();
                this.queuedBytes -= Buffer.byteLength(line, "utf8");
            }
            const recovered = Boolean(this.lastErrorAt);
            this.lastErrorAt = undefined;
            this.retryAfter = 0;
            if (recovered) {
                try { this.onRecovered?.(); } catch { /* diagnostics must not affect control */ }
            }
        } catch (error) {
            this.lastErrorAt = new Date().toISOString();
            this.retryAfter = Date.now() + this.retryDelayMs;
            this.droppedEvents += this.queue.length;
            this.queue = [];
            this.queuedBytes = 0;
            try { this.onError?.(error as Error); } catch { /* diagnostics must not affect control */ }
        } finally {
            this.draining = false;
            if (this.queue.length > 0 && Date.now() >= this.retryAfter) void this.drain();
        }
    }

    private async rotateIfNeeded(incomingBytes: number): Promise<void> {
        let currentSize = 0;
        try { currentSize = (await fs.stat(this.filePath)).size; } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (currentSize === 0 || currentSize + incomingBytes <= this.maxBytes) return;

        if (this.maxFiles === 1) {
            await fs.unlink(this.filePath);
            return;
        }

        const oldest = `${this.filePath}.${this.maxFiles - 1}`;
        try { await fs.unlink(oldest); } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        for (let index = this.maxFiles - 2; index >= 1; index--) {
            try { await fs.rename(`${this.filePath}.${index}`, `${this.filePath}.${index + 1}`); } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
        }
        try { await fs.rename(this.filePath, `${this.filePath}.1`); } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }
}
