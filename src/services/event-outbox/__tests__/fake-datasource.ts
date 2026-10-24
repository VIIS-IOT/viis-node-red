/**
 * In-memory stand-in for the slice of the TypeORM DataSource the event outbox uses: `query` (DDL only),
 * `transaction`, and per-entity repositories with insert/save/find/findOne/update/delete over plain
 * equality and the IsNull / LessThan / LessThanOrEqual operators. The repo has no sqlite driver, so this
 * replaces an in-memory database; rows are deep-copied in and out like a real round trip.
 */
import { FindOperator } from "typeorm";

type Row = Record<string, any>;

const PRIMARY: Record<string, string> = {
    TabiotEventOutbox: "seq",
    TabiotGatewayAlarmState: "alarm_key",
};
const UNIQUE: Record<string, string[]> = {
    TabiotEventOutbox: ["event_id"],
};

function clone<T>(value: T): T {
    if (value instanceof Date) return new Date(value.getTime()) as any;
    if (Array.isArray(value)) return value.map(clone) as any;
    if (value && typeof value === "object") {
        const out: Row = {};
        for (const [k, v] of Object.entries(value)) out[k] = clone(v);
        return out as T;
    }
    return value;
}

function comparable(v: any): any {
    return v instanceof Date ? v.getTime() : v;
}

function matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, cond]) => {
        const actual = row[key];
        if (cond instanceof FindOperator) {
            switch (cond.type) {
                case "isNull": return actual === null || actual === undefined;
                case "lessThan": return actual != null && comparable(actual) < comparable(cond.value);
                case "lessThanOrEqual": return actual != null && comparable(actual) <= comparable(cond.value);
                default: throw new Error(`fake datasource: unsupported operator ${cond.type}`);
            }
        }
        return comparable(actual) === comparable(cond);
    });
}

export class FakeRepository {
    rows: Row[] = [];
    private nextSeq = 1;

    constructor(private readonly name: string) {}

    private get pk(): string {
        return PRIMARY[this.name];
    }

    async insert(input: Row): Promise<void> {
        const row = clone(input);
        if (this.pk === "seq") row.seq = String(this.nextSeq++);
        if (this.rows.some(r => comparable(r[this.pk]) === comparable(row[this.pk]))) {
            throw new Error(`ER_DUP_ENTRY: ${this.name}.${this.pk}`);
        }
        for (const col of UNIQUE[this.name] ?? []) {
            if (this.rows.some(r => r[col] === row[col])) throw new Error(`ER_DUP_ENTRY: ${this.name}.${col}`);
        }
        this.rows.push(row);
    }

    async save(input: Row): Promise<Row> {
        const existing = this.rows.find(r => input[this.pk] !== undefined && r[this.pk] === input[this.pk]);
        if (existing) Object.assign(existing, clone(input));
        else await this.insert(input);
        return clone(input);
    }

    async find(options: { where?: Row; order?: Row; take?: number } = {}): Promise<Row[]> {
        let out = this.rows.filter(r => matches(r, options.where));
        const [orderKey, dir] = Object.entries(options.order ?? {})[0] ?? [];
        if (orderKey) {
            const sign = String(dir).toUpperCase() === "DESC" ? -1 : 1;
            out = [...out].sort((a, b) => sign * (Number(a[orderKey]) - Number(b[orderKey])));
        }
        if (options.take !== undefined) out = out.slice(0, options.take);
        return out.map(clone);
    }

    async findOne(options: { where?: Row }): Promise<Row | null> {
        return (await this.find({ where: options.where, take: 1 }))[0] ?? null;
    }

    async update(where: Row, patch: Row): Promise<{ affected: number }> {
        const hit = this.rows.filter(r => matches(r, where));
        hit.forEach(r => Object.assign(r, clone(patch)));
        return { affected: hit.length };
    }

    async delete(where: Row): Promise<{ affected: number }> {
        const before = this.rows.length;
        this.rows = this.rows.filter(r => !matches(r, where));
        return { affected: before - this.rows.length };
    }
}

export class FakeDataSource {
    readonly isInitialized = true;
    readonly ddl: string[] = [];
    private readonly repos = new Map<string, FakeRepository>();

    async query(sql: string): Promise<void> {
        this.ddl.push(sql);
    }

    getRepository(entity: { name: string }): FakeRepository {
        if (!this.repos.has(entity.name)) this.repos.set(entity.name, new FakeRepository(entity.name));
        return this.repos.get(entity.name)!;
    }

    async transaction<T>(work: (manager: { getRepository(entity: { name: string }): FakeRepository }) => Promise<T>): Promise<T> {
        return work({ getRepository: e => this.getRepository(e) });
    }

    /** Every stored value, serialised: used to prove nothing secret landed in any table. */
    dump(): string {
        return JSON.stringify([...this.repos.values()].map(r => r.rows));
    }
}
