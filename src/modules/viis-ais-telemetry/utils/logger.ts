/**
 * Logger interface with conditional logging support
 * Implements the Strategy pattern for different logging behaviors
 */

export interface ILogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Base logger that wraps Node-RED's logging functions
 */
export class NodeRedLogger implements ILogger {
  constructor(
    private logFn: (msg: string) => void,
    private warnFn: (msg: string) => void,
    private errorFn: (msg: string) => void
  ) {}

  debug(message: string): void {
    this.logFn(message);
  }

  info(message: string): void {
    this.logFn(message);
  }

  warn(message: string): void {
    this.warnFn(message);
  }

  error(message: string): void {
    this.errorFn(message);
  }
}

/**
 * Conditional logger that only logs when enabled
 * Wraps another logger and conditionally forwards calls
 */
export class ConditionalLogger implements ILogger {
  constructor(
    private baseLogger: ILogger,
    private debugEnabled: boolean = false
  ) {}

  debug(message: string): void {
    if (this.debugEnabled) {
      this.baseLogger.debug(message);
    }
  }

  info(message: string): void {
    this.baseLogger.info(message);
  }

  warn(message: string): void {
    this.baseLogger.warn(message);
  }

  error(message: string): void {
    this.baseLogger.error(message);
  }

  setDebugEnabled(enabled: boolean): void {
    this.debugEnabled = enabled;
  }
}

/**
 * Null logger for testing - discards all messages
 */
export class NullLogger implements ILogger {
  debug(_message: string): void {}
  info(_message: string): void {}
  warn(_message: string): void {}
  error(_message: string): void {}
}

/**
 * Console logger for testing/debugging outside Node-RED
 */
export class ConsoleLogger implements ILogger {
  constructor(private prefix: string = "[AIS]") {}

  debug(message: string): void {
    console.log(`${this.prefix} [DEBUG] ${message}`);
  }

  info(message: string): void {
    console.log(`${this.prefix} [INFO] ${message}`);
  }

  warn(message: string): void {
    console.warn(`${this.prefix} [WARN] ${message}`);
  }

  error(message: string): void {
    console.error(`${this.prefix} [ERROR] ${message}`);
  }
}
