"use strict";
/**
 * @fileoverview Test for OR filtering functionality
 */
Object.defineProperty(exports, "__esModule", { value: true });
const query_filters_util_1 = require("../utils/query-filters.util");
// Mock TypeORM QueryBuilder for testing
class MockQueryBuilder {
    constructor() {
        this.alias = 'notification';
        this.expressionMap = {
            aliases: [{ name: 'notification' }, { name: 'customer' }]
        };
        this.conditions = [];
        this.params = {};
    }
    andWhere(condition, parameters) {
        this.conditions.push(condition);
        if (parameters) {
            Object.assign(this.params, parameters);
        }
        return this;
    }
    getConditions() {
        return this.conditions;
    }
    getParameters() {
        return this.params;
    }
}
describe('OR Filters Functionality', () => {
    let mockQb;
    beforeEach(() => {
        mockQb = new MockQueryBuilder();
    });
    test('should apply single OR filter correctly', () => {
        const filters = [
            ['iot_notification', 'customer_id', '=', 'c08d3dd4-9786-4e94-b3bb-10d01b499ce9']
        ];
        (0, query_filters_util_1.applyOrQueryFilters)(mockQb, filters, 'notification');
        const conditions = mockQb.getConditions();
        const params = mockQb.getParameters();
        expect(conditions).toHaveLength(1);
        expect(conditions[0]).toContain('notification.`customer_id` = :orParam0');
        expect(params.orParam0).toBe('c08d3dd4-9786-4e94-b3bb-10d01b499ce9');
    });
    test('should apply multiple OR filters correctly', () => {
        const filters = [
            ['iot_notification', 'customer_id', '=', 'c08d3dd4-9786-4e94-b3bb-10d01b499ce9'],
            ['iot_notification', 'customer_user', '=', 'a08abc5c-039b-44a3-afa3-c1fc6ab28675']
        ];
        (0, query_filters_util_1.applyOrQueryFilters)(mockQb, filters, 'notification');
        const conditions = mockQb.getConditions();
        const params = mockQb.getParameters();
        expect(conditions).toHaveLength(1);
        expect(conditions[0]).toContain('notification.`customer_id` = :orParam0 OR notification.`customer_user` = :orParam1');
        expect(params.orParam0).toBe('c08d3dd4-9786-4e94-b3bb-10d01b499ce9');
        expect(params.orParam1).toBe('a08abc5c-039b-44a3-afa3-c1fc6ab28675');
    });
    test('should handle empty filters array', () => {
        const filters = [];
        (0, query_filters_util_1.applyOrQueryFilters)(mockQb, filters, 'notification');
        const conditions = mockQb.getConditions();
        expect(conditions).toHaveLength(0);
    });
    test('should handle undefined filters', () => {
        (0, query_filters_util_1.applyOrQueryFilters)(mockQb, undefined, 'notification');
        const conditions = mockQb.getConditions();
        expect(conditions).toHaveLength(0);
    });
    test('should support different operators', () => {
        const filters = [
            ['iot_notification', 'customer_id', '=', 'test-id'],
            ['iot_notification', 'created_at', '>', '2023-01-01'],
            ['iot_notification', 'message', 'like', 'error']
        ];
        (0, query_filters_util_1.applyOrQueryFilters)(mockQb, filters, 'notification');
        const conditions = mockQb.getConditions();
        const params = mockQb.getParameters();
        expect(conditions).toHaveLength(1);
        expect(conditions[0]).toContain('notification.`customer_id` = :orParam0 OR notification.`created_at` > :orParam1 OR notification.`message` LIKE :orParam2');
        expect(params.orParam0).toBe('test-id');
        expect(params.orParam1).toBe('2023-01-01');
        expect(params.orParam2).toBe('%error%');
    });
});
