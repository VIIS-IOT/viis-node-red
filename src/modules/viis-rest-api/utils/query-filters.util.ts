import { logger } from './logger';
import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

export type FilterTuple = [string, string, any] | [string, string, string, any];

/**
 * Apply dynamic filters to a TypeORM QueryBuilder
 * @param qb The TypeORM QueryBuilder instance
 * @param filters Array of filter tuples: [alias?, field, operator, value]
 * @param defaultTable Optional default alias if none provided
 */
export function applyQueryFilters<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  filters?: FilterTuple[],
  defaultTable?: string,
): SelectQueryBuilder<T> {
  if (!filters || !Array.isArray(filters)) {
    return qb;
  }

  // Determine the primary alias and all valid aliases
  const primaryAlias = qb.alias;
  const validAliases = qb.expressionMap.aliases.map(a => a.name);
  const defaultAlias = defaultTable && validAliases.includes(defaultTable)
    ? defaultTable
    : primaryAlias;

  filters.forEach((filter, index) => {
    // Normalize to [alias, field, operator, value]
    let alias: string;
    let field: string;
    let operator: string;
    let value: any;

    if (filter.length === 4) {
      [alias, field, operator, value] = filter as [string, string, string, any];
    } else {
      [field, operator, value] = filter as [string, string, any];
      alias = defaultAlias;
    }

    // Remap real table names to the primary alias if needed
    const tableAlias = validAliases.includes(alias) ? alias : primaryAlias;
    const paramKey = `param${index}`;

    // Quote the field name using MySQL backticks to preserve case sensitivity
    const fieldPath = `${tableAlias}.\`${field}\``;

    switch (operator.toLowerCase()) {
      case '=':
      case 'eq':
        qb.andWhere(`${fieldPath} = :${paramKey}`, { [paramKey]: value });
        break;
      case 'like':
        // Use MySQL-compatible LIKE syntax (no ::text cast, use LIKE instead of ILIKE)
        qb.andWhere(`${fieldPath} LIKE :${paramKey}`, { [paramKey]: `%${value}%` });
        break;
      case 'in':
        if (Array.isArray(value)) {
          qb.andWhere(`${fieldPath} IN (:...${paramKey})`, { [paramKey]: value });
        }
        break;
      case '>':
      case 'gt':
        qb.andWhere(`${fieldPath} > :${paramKey}`, { [paramKey]: value });
        break;
      case '<':
      case 'lt':
        qb.andWhere(`${fieldPath} < :${paramKey}`, { [paramKey]: value });
        break;
      case '>=':
      case 'gte':
        qb.andWhere(`${fieldPath} >= :${paramKey}`, { [paramKey]: value });
        break;
      case '<=':
      case 'lte':
        qb.andWhere(`${fieldPath} <= :${paramKey}`, { [paramKey]: value });
        break;
      case 'between':
        if (Array.isArray(value) && value.length === 2) {
          qb.andWhere(
            `${fieldPath} BETWEEN :${paramKey}0 AND :${paramKey}1`,
            { [`${paramKey}0`]: value[0], [`${paramKey}1`]: value[1] }
          );
        }
        break;
      case 'isnull':
        qb.andWhere(`${fieldPath} IS NULL`);
        break;
      case 'notnull':
        qb.andWhere(`${fieldPath} IS NOT NULL`);
        break;
      default:
        console.warn(`Unsupported operator: ${operator}`);
    }
  });

  return qb;
}

/**
 * Apply dynamic OR filters to a TypeORM QueryBuilder
 * @param qb The TypeORM QueryBuilder instance
 * @param filters Array of filter tuples: [alias?, field, operator, value]
 * @param defaultTable Optional default alias if none provided
 */
export function applyOrQueryFilters<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  filters?: FilterTuple[],
  defaultTable?: string,
): SelectQueryBuilder<T> {
  if (!filters || !Array.isArray(filters) || filters.length === 0) {
    return qb;
  }

  // Determine the primary alias and all valid aliases
  const primaryAlias = qb.alias;
  const validAliases = qb.expressionMap.aliases.map(a => a.name);
  const defaultAlias = defaultTable && validAliases.includes(defaultTable)
    ? defaultTable
    : primaryAlias;

  // Build OR conditions
  const orConditions: string[] = [];
  const parameters: { [key: string]: any } = {};

  filters.forEach((filter, index) => {
    // Normalize to [alias, field, operator, value]
    let alias: string;
    let field: string;
    let operator: string;
    let value: any;

    if (filter.length === 4) {
      [alias, field, operator, value] = filter as [string, string, string, any];
    } else {
      [field, operator, value] = filter as [string, string, any];
      alias = defaultAlias;
    }

    // Remap real table names to the primary alias if needed
    const tableAlias = validAliases.includes(alias) ? alias : primaryAlias;
    const paramKey = `orParam${index}`;

    // Quote the field name using MySQL backticks to preserve case sensitivity
    const fieldPath = `${tableAlias}.\`${field}\``;

    switch (operator.toLowerCase()) {
      case '=':
      case 'eq':
        orConditions.push(`${fieldPath} = :${paramKey}`);
        parameters[paramKey] = value;
        break;
      case 'like':
        orConditions.push(`${fieldPath} LIKE :${paramKey}`);
        parameters[paramKey] = `%${value}%`;
        break;
      case 'in':
        if (Array.isArray(value)) {
          orConditions.push(`${fieldPath} IN (:...${paramKey})`);
          parameters[paramKey] = value;
        }
        break;
      case '>':
      case 'gt':
        orConditions.push(`${fieldPath} > :${paramKey}`);
        parameters[paramKey] = value;
        break;
      case '<':
      case 'lt':
        orConditions.push(`${fieldPath} < :${paramKey}`);
        parameters[paramKey] = value;
        break;
      case '>=':
      case 'gte':
        orConditions.push(`${fieldPath} >= :${paramKey}`);
        parameters[paramKey] = value;
        break;
      case '<=':
      case 'lte':
        orConditions.push(`${fieldPath} <= :${paramKey}`);
        parameters[paramKey] = value;
        break;
      case 'between':
        if (Array.isArray(value) && value.length === 2) {
          orConditions.push(`${fieldPath} BETWEEN :${paramKey}0 AND :${paramKey}1`);
          parameters[`${paramKey}0`] = value[0];
          parameters[`${paramKey}1`] = value[1];
        }
        break;
      case 'isnull':
        orConditions.push(`${fieldPath} IS NULL`);
        break;
      case 'notnull':
        orConditions.push(`${fieldPath} IS NOT NULL`);
        break;
      default:
        console.warn(`Unsupported operator: ${operator}`);
    }
  });

  // Apply OR conditions if any exist
  if (orConditions.length > 0) {
    const orClause = orConditions.join(' OR ');
    qb.andWhere(`(${orClause})`, parameters);
  }

  return qb;
}
