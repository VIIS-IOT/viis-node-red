/**
 * Plan Task 8: with the event outbox on, scenario trigger events are stored in the outbox (delivered in
 * order, retried across backend outages); with it off, or before the executor started it, they are POSTed.
 */
import axios from "axios";
import { createScenarioTriggerSender } from "../services/scenarioTriggerSender";
import { ScenarioTriggeredEvent } from "../services/scenarioTriggerEvents";
import { initEventOutbox, resetEventOutbox } from "../../../services/event-outbox/registry";
import { FakeDataSource } from "../../../services/event-outbox/__tests__/fake-datasource";
import { TabiotEventOutbox } from "../../../orm/entities/event-outbox/TabiotEventOutbox";
import { CircuitBreakerManager } from "../../viis-schedule-executor/resilience-utils";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const TOKEN = "tok-scenario";
const env = { getEnvVar: (n: string, d?: any) => ({ VIIS_BACKEND: "http://backend.test", DEVICE_ACCESS_TOKEN: TOKEN } as Record<string, any>)[n] ?? d };
const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

const event = {
    alarm_name: "Tưới khi khô",
    msg: "Kịch bản đã chạy",
    message_key: "iot.notification.scenario.triggered",
    message_params: { scenarioId: "intent-42", triggerId: "trigger-1", result: "success" },
    severity: "notification",
} as unknown as ScenarioTriggeredEvent;

describe("scenario trigger sender with the event outbox", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedAxios.post.mockResolvedValue({ status: 200, data: {} });
    });

    afterEach(() => {
        resetEventOutbox();
        (CircuitBreakerManager.getInstance() as any).circuits = new Map();
    });

    it("outbox not started: posts as before", async () => {
        const send = createScenarioTriggerSender(env, logger, { maxRetries: 1 });
        expect(await send(event)).toBe(true);
        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
        expect(mockedAxios.post.mock.calls[0][1]).toBe(event);
    });

    it("scenario sender enqueues when outbox enabled", async () => {
        const ds = new FakeDataSource();
        await initEventOutbox(ds as any, { getEnvVar: (n: string, d?: any) => (n === "EVENT_OUTBOX_ENABLED" ? "true" : d) }, { intervalMs: 3600000 });
        const send = createScenarioTriggerSender(env, logger, { maxRetries: 1 });

        expect(await send(event)).toBe(true);

        expect(mockedAxios.post).not.toHaveBeenCalled();
        const rows = ds.getRepository(TabiotEventOutbox).rows;
        expect(rows).toHaveLength(1);
        expect(rows[0].payload).toMatchObject({ ...event, event_id: rows[0].event_id });
        expect(JSON.stringify(rows)).not.toContain(TOKEN);
    });
});
