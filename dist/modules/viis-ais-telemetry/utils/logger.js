"use strict";
/**
 * Logger interface with conditional logging support
 * Implements the Strategy pattern for different logging behaviors
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsoleLogger = exports.NullLogger = exports.ConditionalLogger = exports.NodeRedLogger = void 0;
/**
 * Base logger that wraps Node-RED's logging functions
 */
class NodeRedLogger {
    constructor(logFn, warnFn, errorFn) {
        this.logFn = logFn;
        this.warnFn = warnFn;
        this.errorFn = errorFn;
    }
    debug(message) {
        this.logFn(message);
    }
    info(message) {
        this.logFn(message);
    }
    warn(message) {
        this.warnFn(message);
    }
    error(message) {
        this.errorFn(message);
    }
}
exports.NodeRedLogger = NodeRedLogger;
/**
 * Conditional logger that only logs when enabled
 * Wraps another logger and conditionally forwards calls
 */
class ConditionalLogger {
    constructor(baseLogger, debugEnabled = false) {
        this.baseLogger = baseLogger;
        this.debugEnabled = debugEnabled;
    }
    debug(message) {
        if (this.debugEnabled) {
            this.baseLogger.debug(message);
        }
    }
    info(message) {
        this.baseLogger.info(message);
    }
    warn(message) {
        this.baseLogger.warn(message);
    }
    error(message) {
        this.baseLogger.error(message);
    }
    setDebugEnabled(enabled) {
        this.debugEnabled = enabled;
    }
}
exports.ConditionalLogger = ConditionalLogger;
/**
 * Null logger for testing - discards all messages
 */
class NullLogger {
    debug(_message) { }
    info(_message) { }
    warn(_message) { }
    error(_message) { }
}
exports.NullLogger = NullLogger;
/**
 * Console logger for testing/debugging outside Node-RED
 */
class ConsoleLogger {
    constructor(prefix = "[AIS]") {
        this.prefix = prefix;
    }
    debug(message) {
        console.log(`${this.prefix} [DEBUG] ${message}`);
    }
    info(message) {
        console.log(`${this.prefix} [INFO] ${message}`);
    }
    warn(message) {
        console.warn(`${this.prefix} [WARN] ${message}`);
    }
    error(message) {
        console.error(`${this.prefix} [ERROR] ${message}`);
    }
}
exports.ConsoleLogger = ConsoleLogger;
