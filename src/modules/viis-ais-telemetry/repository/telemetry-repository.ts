/**
 * Telemetry Repository with Repository Pattern
 * Abstracts database operations for testability
 */

import { DataSource, Repository } from "typeorm";
import { NodeContext } from "node-red";
import { createDataSource } from "../../../orm/dataSource";
import { TabiotDeviceTelemetry } from "../../../orm/entities/device-telemetry/TabiotDeviceTelemetry";
import { AisTelemetryPayload } from "../viis-ais-telemetry-config";
import { ILogger } from "../utils/logger";
import {
  DB_MAX_INIT_ATTEMPTS,
  DB_MAX_RETRY_DELAY_MS,
  DB_RETRY_BACKOFF_BASE,
  DB_RETRY_MAX_EXPONENT
} from "../constants";

/**
 * Repository interface for dependency injection and testing
 */
export interface ITelemetryRepository {
  initialize(): Promise<void>;
  save(payload: AisTelemetryPayload): Promise<void>;
  isInitialized(): boolean;
  close(): Promise<void>;
}

/**
 * Database implementation of telemetry repository
 */
export class DatabaseTelemetryRepository implements ITelemetryRepository {
  private dataSource: DataSource | null = null;
  private telemetryRepo: Repository<TabiotDeviceTelemetry> | null = null;
  private nodeContext: NodeContext;
  private deviceId: string;
  private logger: ILogger;

  private dbInitStarted = false;
  private dbInitFailed = false;
  private dbInitAttempt = 0;
  private dbInitNextRetryAt = 0;
  private isSaving = false;
  private pendingPayload: AisTelemetryPayload | null = null;
  private lastSavedTimestamp = 0;
  private isClosing = false;

  constructor(nodeContext: NodeContext, deviceId: string, logger: ILogger) {
    this.nodeContext = nodeContext;
    this.deviceId = deviceId;
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    if (this.dbInitFailed || this.dbInitStarted) return;

    const now = Date.now();
    if (this.dbInitNextRetryAt && now < this.dbInitNextRetryAt) return;

    this.dbInitStarted = true;
    try {
      this.dataSource = await createDataSource(this.nodeContext);
      if (!this.dataSource.isInitialized) {
        await this.dataSource.initialize();
      }
      this.telemetryRepo = this.dataSource.getRepository(TabiotDeviceTelemetry);
      this.logger.info("[AIS] Database initialized for local telemetry storage");
    } catch (err) {
      this.handleInitError(err as Error);
    } finally {
      this.dbInitStarted = false;
    }
  }

  private handleInitError(err: Error): void {
    this.dbInitAttempt++;
    this.dbInitStarted = false;

    if (this.dbInitAttempt >= DB_MAX_INIT_ATTEMPTS) {
      this.dbInitFailed = true;
    }

    const delayMs = Math.min(
      DB_MAX_RETRY_DELAY_MS,
      DB_RETRY_BACKOFF_BASE * Math.pow(2, Math.min(this.dbInitAttempt, DB_RETRY_MAX_EXPONENT))
    );
    this.dbInitNextRetryAt = Date.now() + delayMs;
    this.logger.warn(`[AIS] Failed to initialize database: ${err.message}`);
  }

  isInitialized(): boolean {
    return this.telemetryRepo !== null;
  }

  private getMonotonicTimestamp(): number {
    const now = Date.now();
    if (now <= this.lastSavedTimestamp) {
      this.lastSavedTimestamp = this.lastSavedTimestamp + 1;
      return this.lastSavedTimestamp;
    }
    this.lastSavedTimestamp = now;
    return now;
  }

  private sanitizeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9_]/g, "_");
  }

  private buildEntities(timestamp: number, payload: AisTelemetryPayload): TabiotDeviceTelemetry[] {
    const entities: TabiotDeviceTelemetry[] = [];

    const addScalar = (key: string, value: number | string | boolean) => {
      const entity = new TabiotDeviceTelemetry();
      entity.device_id = this.deviceId;
      entity.timestamp = timestamp;
      entity.key_name = `ais_${this.sanitizeKey(key)}`;

      if (typeof value === "number") {
        entity.value_type = "float";
        entity.float_value = value;
      } else if (typeof value === "boolean") {
        entity.value_type = "boolean";
        entity.boolean_value = value;
      } else {
        entity.value_type = "string";
        entity.string_value = String(value).slice(0, 255);
      }

      entities.push(entity);
    };

    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined || value === null) continue;
      if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
        addScalar(key, value);
      }
    }

    // Add full JSON snapshot
    const snapshot = new TabiotDeviceTelemetry();
    snapshot.device_id = this.deviceId;
    snapshot.timestamp = timestamp;
    snapshot.key_name = "ais_payload";
    snapshot.value_type = "json";
    snapshot.json_value = payload as any;
    entities.push(snapshot);

    return entities;
  }

  async save(payload: AisTelemetryPayload): Promise<void> {
    if (this.isClosing || this.dbInitFailed) return;

    if (this.isSaving) {
      this.pendingPayload = payload;
      return;
    }

    if (!this.telemetryRepo) {
      await this.initialize();
      if (!this.telemetryRepo) return;
    }

    const timestamp = this.getMonotonicTimestamp();
    const entities = this.buildEntities(timestamp, payload);
    if (entities.length === 0) return;

    this.isSaving = true;
    try {
      await this.telemetryRepo.save(entities);
      this.logger.debug(`[AIS] Saved ${entities.length} telemetry records to database`);
    } catch (err) {
      this.logger.warn(`[AIS] Failed to save telemetry: ${(err as Error).message}`);
    } finally {
      this.isSaving = false;
      const nextPayload = this.pendingPayload;
      this.pendingPayload = null;
      if (nextPayload) {
        void this.save(nextPayload);
      }
    }
  }

  async close(): Promise<void> {
    this.isClosing = true;
    if (this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
    }
  }

  setClosing(closing: boolean): void {
    this.isClosing = closing;
  }
}

/**
 * Mock repository for testing
 */
export class MockTelemetryRepository implements ITelemetryRepository {
  private savedPayloads: AisTelemetryPayload[] = [];
  private _isInitialized = false;

  async initialize(): Promise<void> {
    this._isInitialized = true;
  }

  isInitialized(): boolean {
    return this._isInitialized;
  }

  async save(payload: AisTelemetryPayload): Promise<void> {
    this.savedPayloads.push(payload);
  }

  async close(): Promise<void> {
    this._isInitialized = false;
  }

  getSavedPayloads(): AisTelemetryPayload[] {
    return this.savedPayloads;
  }

  clearPayloads(): void {
    this.savedPayloads = [];
  }
}
