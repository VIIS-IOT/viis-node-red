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
exports.RotatingFileSink = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
class RotatingFileSink {
    constructor(options, onError, onRecovered) {
        this.onError = onError;
        this.onRecovered = onRecovered;
        this.queue = [];
        this.queuedBytes = 0;
        this.draining = false;
        this.closed = false;
        this.droppedEvents = 0;
        this.retryAfter = 0;
        const fileName = options.fileName || "rpc-events.ndjson";
        if (path.basename(fileName) !== fileName)
            throw new Error("Diagnostic file name must not contain a path");
        this.filePath = path.join(path.resolve(options.directory), fileName);
        this.maxBytes = Math.max(1024, options.maxBytes || 10 * 1024 * 1024);
        this.maxFiles = Math.max(1, Math.min(20, Math.floor(options.maxFiles || 5)));
        this.maxQueueBytes = Math.max(4096, options.maxQueueBytes || 4 * 1024 * 1024);
        this.retryDelayMs = Math.max(1000, options.retryDelayMs || 30000);
    }
    write(line) {
        if (this.closed)
            return false;
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
    getStatus() {
        return Object.assign({ status: this.lastErrorAt ? "degraded" : "healthy", droppedEvents: this.droppedEvents, queuedBytes: this.queuedBytes }, (this.lastErrorAt ? { lastErrorAt: this.lastErrorAt } : {}));
    }
    async flush(timeoutMs = 1000) {
        const deadline = Date.now() + Math.max(0, timeoutMs);
        while ((this.draining || this.queue.length > 0) && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }
    async close(timeoutMs = 1000) {
        await this.flush(timeoutMs);
        this.closed = true;
    }
    async drain() {
        var _a, _b;
        if (this.draining || this.closed || this.queue.length === 0)
            return;
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
                try {
                    (_a = this.onRecovered) === null || _a === void 0 ? void 0 : _a.call(this);
                }
                catch ( /* diagnostics must not affect control */_c) { /* diagnostics must not affect control */ }
            }
        }
        catch (error) {
            this.lastErrorAt = new Date().toISOString();
            this.retryAfter = Date.now() + this.retryDelayMs;
            this.droppedEvents += this.queue.length;
            this.queue = [];
            this.queuedBytes = 0;
            try {
                (_b = this.onError) === null || _b === void 0 ? void 0 : _b.call(this, error);
            }
            catch ( /* diagnostics must not affect control */_d) { /* diagnostics must not affect control */ }
        }
        finally {
            this.draining = false;
            if (this.queue.length > 0 && Date.now() >= this.retryAfter)
                void this.drain();
        }
    }
    async rotateIfNeeded(incomingBytes) {
        let currentSize = 0;
        try {
            currentSize = (await fs.stat(this.filePath)).size;
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
        if (currentSize === 0 || currentSize + incomingBytes <= this.maxBytes)
            return;
        if (this.maxFiles === 1) {
            await fs.unlink(this.filePath);
            return;
        }
        const oldest = `${this.filePath}.${this.maxFiles - 1}`;
        try {
            await fs.unlink(oldest);
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
        for (let index = this.maxFiles - 2; index >= 1; index--) {
            try {
                await fs.rename(`${this.filePath}.${index}`, `${this.filePath}.${index + 1}`);
            }
            catch (error) {
                if (error.code !== "ENOENT")
                    throw error;
            }
        }
        try {
            await fs.rename(this.filePath, `${this.filePath}.1`);
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
    }
}
exports.RotatingFileSink = RotatingFileSink;
