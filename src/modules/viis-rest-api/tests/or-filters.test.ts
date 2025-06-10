/**
 * @fileoverview Test for OR filtering functionality
 */

import { applyOrQueryFilters, FilterTuple } from '../utils/query-filters.util';
import { SelectQueryBuilder } from 'typeorm';

// Mock TypeORM QueryBuilder for testing
class MockQueryBuilder {
    public alias = 'notification';
    public expressionMap = {
        aliases: [{ name: 'notification' }, { name: 'customer' }]
    };
    
    private conditions: string[] = [];
    private params: { [key: string]: any } = {};

    andWhere(condition: string, parameters?: { [key: string]: any }): this {
        this.conditions.push(condition);
        if (parameters) {
            Object.assign(this.params, parameters);
        }
        return this;
    }

    getConditions(): string[] {
        return this.conditions;
    }

    getParameters(): { [key: string]: any } {
        return this.params;
    }
}

describe('OR Filters Functionality', () => {
    let mockQb: MockQueryBuilder;

    beforeEach(() => {
        mockQb = new MockQueryBuilder();
    });

    test('should apply single OR filter correctly', () => {
        const filters: FilterTuple[] = [
            ['iot_notification', 'customer_id', '=', 'c08d3dd4-9786-4e94-b3bb-10d01b499ce9']
        ];

        applyOrQueryFilters(mockQb as any, filters, 'notification');

        const conditions = mockQb.getConditions();
        const params = mockQb.getParameters();

        expect(conditions).toHaveLength(1);
        expect(conditions[0]).toContain('notification.`customer_id` = :orParam0');
        expect(params.orParam0).toBe('c08d3dd4-9786-4e94-b3bb-10d01b499ce9');
    });

    test('should apply multiple OR filters correctly', () => {
        const filters: FilterTuple[] = [
            ['iot_notification', 'customer_id', '=', 'c08d3dd4-9786-4e94-b3bb-10d01b499ce9'],
            ['iot_notification', 'customer_user', '=', 'a08abc5c-039b-44a3-afa3-c1fc6ab28675']
        ];

        applyOrQueryFilters(mockQb as any, filters, 'notification');

        const conditions = mockQb.getConditions();
        const params = mockQb.getParameters();

        expect(conditions).toHaveLength(1);
        expect(conditions[0]).toContain('notification.`customer_id` = :orParam0 OR notification.`customer_user` = :orParam1');
        expect(params.orParam0).toBe('c08d3dd4-9786-4e94-b3bb-10d01b499ce9');
        expect(params.orParam1).toBe('a08abc5c-039b-44a3-afa3-c1fc6ab28675');
    });

    test('should handle empty filters array', () => {
        const filters: FilterTuple[] = [];

        applyOrQueryFilters(mockQb as any, filters, 'notification');

        const conditions = mockQb.getConditions();
        expect(conditions).toHaveLength(0);
    });

    test('should handle undefined filters', () => {
        applyOrQueryFilters(mockQb as any, undefined, 'notification');

        const conditions = mockQb.getConditions();
        expect(conditions).toHaveLength(0);
    });

    test('should support different operators', () => {
        const filters: FilterTuple[] = [
            ['iot_notification', 'customer_id', '=', 'test-id'],
            ['iot_notification', 'created_at', '>', '2023-01-01'],
            ['iot_notification', 'message', 'like', 'error']
        ];

        applyOrQueryFilters(mockQb as any, filters, 'notification');

        const conditions = mockQb.getConditions();
        const params = mockQb.getParameters();

        expect(conditions).toHaveLength(1);
        expect(conditions[0]).toContain('notification.`customer_id` = :orParam0 OR notification.`created_at` > :orParam1 OR notification.`message` LIKE :orParam2');
        expect(params.orParam0).toBe('test-id');
        expect(params.orParam1).toBe('2023-01-01');
        expect(params.orParam2).toBe('%error%');
    });
});
