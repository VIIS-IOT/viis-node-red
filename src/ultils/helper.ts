import * as crypto from 'crypto';

const { v4: uuidv4 } = require('uuid');

export function adjustToUTC7(date: Date | string): Date {
    const utcDate = new Date(date);
    utcDate.setHours(utcDate.getHours() + 7);
    return utcDate;
}


// Hàm kiểm tra xem có giá trị không hợp lệ trong object hay không
export function getInvalidFields(data: any): { invalidFields: string[]; invalidValues: string[] } {
    const invalidFields: string[] = [];
    const invalidValues: string[] = [];

    // Đặc tả các kí tự không an toàn (unsafe characters) bạn muốn kiểm tra
    const unsafeCharacterPattern = /[!#$&'()*+,/:;=?@\[\]]/;

    for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
            const value = data[key];

            // Kiểm tra giá trị của mỗi trường có chứa kí tự không an toàn không
            if (typeof value === 'string' && unsafeCharacterPattern.test(value)) {
                invalidFields.push(key);
                invalidValues.push(value);
            }
        }
    }

    return { invalidFields, invalidValues };
}

export function areAllArraysEqual(arrays: any[]) {
    if (!arrays || arrays.length <= 1) {
        return true; // If there's only one or zero arrays, they are equal by default
    }

    const arraySets = arrays.map(array => new Set(array));

    for (let i = 1; i < arraySets.length; i++) {
        if (!areSetsEqual(arraySets[0], arraySets[i])) {
            return false;
        }
    }

    return true;
}

function areSetsEqual(set1: any, set2: any) {
    if (set1.size !== set2.size) {
        return false;
    }

    for (const element of set1) {
        if (!set2.has(element)) {
            return false;
        }
    }

    return true;
}

//////////////////////////////////////////////FOR CREATE TASK ARRAY/////////////////////////
function escapeSingleQuotes(str: string) {
    return str.replace(/'/g, "''");
}

function formatDateForSQL(date: any) {
    return date.toISOString().slice(0, 10);
}

function getObjectValues(obj: any) {
    return Object.values(obj).map(value => {
        if (value === null) {
            return 'NULL';
        } else if (typeof value === 'string') {
            return `'${escapeSingleQuotes(value)}'`;
        } else if (value instanceof Date) {
            return `'${formatDateForSQL(value)}'`;
        } else {
            return value;
        }
    });
}

export function generateInsertSQLTaskArray(dataArray: any[], originalArray: any[], added_in_diary: number = 0) {
    try {
        let sqlQueryCreateTask = `INSERT INTO "tabiot_farming_plan_task" (`;
        let sqlQueryCreateAssignUser = `INSERT INTO "tabiot_assign_user" (name, customer_user, task) VALUES`;
        let sqlQueryCreateTodo = `INSERT INTO "tabiot_todo" (`;
        let sqlQueryCreateiotItem = `INSERT INTO "tabiot_warehouse_item_task_used" (`;
        let sqlQueryCreateiotWorksheet = `INSERT INTO "tabiot_farming_plan_task_worksheet" (`;
        let sqlQueryCreateProdQuantity = `INSERT INTO "tabiot_production_quantity" (`;
        if (dataArray.length === 0) {
            throw new Error('Data array is empty');
        }

        // Assuming all objects have the same structure, use the first object's keys as field names
        const fieldNames = Object.keys(dataArray[0]).join(', ');
        sqlQueryCreateTask += `name, added_in_diary, ${fieldNames}) VALUES `;

        const d = originalArray[0];
        //todo
        const todoFieldNames = d.todo_list.length ? Object.keys(d.todo_list[0]).join(', ') : '';
        sqlQueryCreateTodo += `name, ${todoFieldNames}, farming_plan_task) VALUES `;
        console.log('sqlQueryCreateTodo', sqlQueryCreateTodo);
        //item
        const itemFieldNames = d.item_list.length ? Object.keys(d.item_list[0]).join(', ') : '';
        sqlQueryCreateiotItem += `name, ${itemFieldNames}, task_id) VALUES `;
        //worksheet
        const workSheetFieldNames = d.worksheet_list.length ? Object.keys(d.worksheet_list[0]).join(', ') : '';
        sqlQueryCreateiotWorksheet += `name, ${workSheetFieldNames}, task_id) VALUES `;
        //pro quantity
        const prodQuantityFieldNames = d.prod_quantity_list.length ? Object.keys(d.prod_quantity_list[0]).join(', ') : '';
        sqlQueryCreateProdQuantity += `name, ${prodQuantityFieldNames}, task_id) VALUES `;

        let checkAssignUser: boolean = false;
        dataArray.forEach((data, index) => {
            const randomUUID = uuidv4();
            originalArray.map((d: any, i: number) => {
                if (index === i) {
                    d.involve_in_users.forEach((involve: any) => {
                        // const assignUserUUID = uuidv4()
                        const assignUserUUID = `${involve.customer_user}-${randomUUID}`;
                        console.log('assignUserUUID', assignUserUUID);
                        sqlQueryCreateAssignUser += `('${assignUserUUID}', '${involve.customer_user}', '${randomUUID}'),`;
                        checkAssignUser = true;
                    });
                    //todo
                    d.todo_list.forEach((todo: any) => {
                        const todoUUID = uuidv4();
                        const dataValues = getObjectValues(todo).join(', ');
                        sqlQueryCreateTodo += `('${todoUUID}', ${dataValues}, '${randomUUID}'),`;
                    });
                    //item
                    d.item_list.forEach((item: any) => {
                        const itemUUID = uuidv4();
                        const dataValues = getObjectValues(item).join(', ');
                        sqlQueryCreateiotItem += `('${itemUUID}', ${dataValues}, '${randomUUID}'),`;
                    });
                    //worksheet
                    d.worksheet_list.forEach((worksheet: any) => {
                        const worksheetUUID = uuidv4();
                        const dataValues = getObjectValues(worksheet).join(', ');
                        sqlQueryCreateiotWorksheet += `('${worksheetUUID}', ${dataValues}, '${randomUUID}'),`;
                    });
                    //prod quantity
                    d.prod_quantity_list.forEach((prodQuantity: any) => {
                        const prodQuantityUUID = uuidv4();
                        const dataValues = getObjectValues(prodQuantity).join(', ');
                        sqlQueryCreateProdQuantity += `('${prodQuantityUUID}', ${dataValues}, '${randomUUID}'),`;
                    });
                }
            });
            const dataValues = getObjectValues(data).join(', ');
            sqlQueryCreateTask += `('${randomUUID}', ${added_in_diary}, ${dataValues}),`;
        });

        // Removing the trailing comma and space
        sqlQueryCreateTask = sqlQueryCreateTask.slice(0, -1);
        sqlQueryCreateTask += `RETURNING *`;

        sqlQueryCreateAssignUser = sqlQueryCreateAssignUser.slice(0, -1);
        sqlQueryCreateAssignUser += `RETURNING *`;

        sqlQueryCreateTodo = sqlQueryCreateTodo.slice(0, -1);
        sqlQueryCreateTodo += `RETURNING *`;

        sqlQueryCreateiotItem = sqlQueryCreateiotItem.slice(0, -1);
        sqlQueryCreateiotItem += `RETURNING *`;

        sqlQueryCreateiotWorksheet = sqlQueryCreateiotWorksheet.slice(0, -1);
        sqlQueryCreateiotWorksheet += `RETURNING *`;

        sqlQueryCreateProdQuantity = sqlQueryCreateProdQuantity.slice(0, -1);
        sqlQueryCreateProdQuantity += `RETURNING *`;

        let returnArr: any[] = [];
        returnArr.push(sqlQueryCreateTask);
        if (checkAssignUser) {
            returnArr.push(sqlQueryCreateAssignUser);
        }
        if (todoFieldNames) {
            returnArr.push(sqlQueryCreateTodo);
        }
        if (itemFieldNames) {
            returnArr.push(sqlQueryCreateiotItem);
        }
        if (workSheetFieldNames) {
            returnArr.push(sqlQueryCreateiotWorksheet);
        }
        if (prodQuantityFieldNames) {
            returnArr.push(sqlQueryCreateProdQuantity);
        }
        return returnArr;
        // return [sqlQueryCreateTask, sqlQueryCreateAssignUser, sqlQueryCreateTodo, sqlQueryCreateiotItem, sqlQueryCreateiotWorksheet];
    } catch (error) {
        throw error;
    }
}

////////////////////////////FOR UPDATE task array///////////////////////////////

export function generateUpdateSQLTaskArray(dataArray: any[], originalArray: any[]) {
    try {
        if (dataArray.length === 0) {
            throw new Error('Data array is empty');
        }

        const involveInArray: any[] = [];
        const iot_farming_plan_task_worksheetArray: any[] = [];
        const iot_warehouse_item_task_usedArray: any[] = [];
        const todo_listArray: any[] = [];
        const prod_quantity_listArray: any[] = [];

        originalArray.forEach((data: any) => {
            data.involve_in_users.forEach((invole_in: any) => {
                invole_in.task = data.name;
                involveInArray.push(invole_in);
            });

            data.worksheet_list.forEach((worksheet: any) => {
                worksheet.task_id = data.name;
                iot_farming_plan_task_worksheetArray.push(worksheet);
            });

            data.item_list.forEach((item: any) => {
                item.task_id = data.name;
                iot_warehouse_item_task_usedArray.push(item);
            });

            data.todo_list.forEach((todo: any) => {
                todo.farming_plan_task = data.name;
                todo_listArray.push(todo);
            });

            data.prod_quantity_list.forEach((prod_quantity: any) => {
                prod_quantity.task_id = data.name;
                prod_quantity_listArray.push(prod_quantity);
            });
        });

        const queries = [
            generateUpdateOrInsertQueries('tabiot_farming_plan_task', dataArray),
            generateUpdateOrInsertQueries('tabiot_assign_user', involveInArray),
            generateUpdateOrInsertQueries('tabiot_farming_plan_task_worksheet', iot_farming_plan_task_worksheetArray),
            generateUpdateOrInsertQueries('tabiot_warehouse_item_task_used', iot_warehouse_item_task_usedArray),
            generateUpdateOrInsertQueries('tabiot_todo', todo_listArray),
            generateUpdateOrInsertQueries('tabiot_production_quantity', prod_quantity_listArray),
        ];

        // console.log(queries);
        return queries;
    } catch (error) {
        throw error;
    }
}

export function generateUpdateOrInsertQueries(tableName: string, dataArray: any[]) {
    const queries: any[] = [];

    dataArray.forEach(item => {
        if ('name' in item) {
            const updateFields = Object.keys(item).filter(field => field !== 'name');

            let paramCounter = 1;
            const setStatements = updateFields.map(field => `"${field}" = $${paramCounter++}`).join(', ');
            const queryParamsForItem = updateFields.map(field => item[field]);

            queries.push({
                query: `UPDATE "${tableName}" SET ${setStatements} WHERE "name" = $${paramCounter}`,
                params: [...queryParamsForItem, item.name],
            });
        } else {
            const insertFields = Object.keys(item);
            const paramPlaceholders = insertFields.map((_, index) => `$${index + 1}`).join(', ');
            const queryParamsForItem = insertFields.map(field => item[field]);
            const randomNameUUID = uuidv4();
            if (tableName === `tabiot_assign_user`) {
                const name = `${item.customer_user}-${item.task}`;
                queries.push({
                    query: `INSERT INTO "${tableName}" (name, ${insertFields
                        .map(field => `"${field}"`)
                        .join(', ')}) VALUES('${name}', ${paramPlaceholders})`,
                    params: queryParamsForItem,
                });
            } else {
                queries.push({
                    query: `INSERT INTO "${tableName}" (name, ${insertFields
                        .map(field => `"${field}"`)
                        .join(', ')}) VALUES('${randomNameUUID}', ${paramPlaceholders})`,
                    params: queryParamsForItem,
                });
            }
        }
    });
    return queries;
}

function generateDeleteQueries(tableName: string, dataArray: any[]): { query: string; params: [] }[] {
    const queries: any[] = [];

    dataArray.forEach((data: any) => {
        if (data.is_deleted) {
            delete data.is_deleted; // Xóa trường is_deleted khỏi đối tượng
            const params: string[] = [];
            const conditions: string[] = [];

            Object.keys(data).forEach((key: string) => {
                if (key !== 'is_deleted') {
                    conditions.push(`${key} = $${params.length + 1}`);
                    params.push(data[key]);
                }
            });

            const query = `DELETE FROM ${tableName} WHERE ${conditions.join(' AND ')}`;
            queries.push({ query, params });
        }
    });

    return queries;
}

export function generateDeleteSQLTaskArray(dataArray: any[]) {
    const deleteQueries = [
        generateDeleteQueries(
            'tabiot_assign_user',
            dataArray.flatMap(data => data.involve_in_users),
        ),
        generateDeleteQueries(
            'tabiot_farming_plan_task_worksheet',
            dataArray.flatMap(data => data.worksheet_list),
        ),
        generateDeleteQueries(
            'tabiot_warehouse_item_task_used',
            dataArray.flatMap(data => data.item_list),
        ),
        generateDeleteQueries(
            'tabiot_todo',
            dataArray.flatMap(data => data.todo_list),
        ),
        generateDeleteQueries(
            'tabiot_production_quantity',
            dataArray.flatMap(data => data.prod_quantity_list),
        ),
    ];

    return deleteQueries;
}

function generateUpdateQueries(tableName: any, dataArray: any) {
    const updateQueries: any = [];

    dataArray.forEach((item: any) => {
        const updateFields = Object.keys(item).filter(field => field !== 'name'); // Exclude 'name' field from update

        let paramCounter = 1;
        const setStatements = updateFields.map(field => `"${field}" = $${paramCounter++}`).join(', ');
        const queryParamsForItem = updateFields.map(field => item[field]);

        updateQueries.push({
            query: `UPDATE "${tableName}" SET ${setStatements} WHERE "name" = $${paramCounter}`,
            params: [...queryParamsForItem, item.name],
        });
    });

    return updateQueries;
}



/**
 * This function parses filter parameters and returns a SQL condition string.
 * The input is an array of filter parameters, each of which is an array itself.
 * Each filter parameter array can have either 3 or 4 elements.
 * If it has 4 elements, they represent ["doctype_name","field_name","operator","value"].
 * If it has 3 elements, they represent ["field_name","operator","value"] and doctype_name is assumed to be null.
 * The function returns a string SQL condition starting with AND, concatenated with AND for each condition.
 * If the operator is "like", the value will be wrapped in percentage signs.
 *
 * @param filterParams - An array of filter parameters.
 * @returns A string representing a SQL condition.
 * @throws Will throw an error if a filter parameter array does not have 3 or 4 elements.
 */
export function parseFilterParams(filterParams: any[]): string {
    let sqlCondition = '';

    filterParams.forEach((filter: any) => {
        let doctypeName: string | null = null;
        let fieldName: string;
        let operator: string;
        let value: any;

        // Kiểm tra độ dài của mảng filter và gán giá trị tương ứng
        if (filter.length === 4) {
            [doctypeName, fieldName, operator, value] = filter;
        } else if (filter.length === 3) {
            [fieldName, operator, value] = filter;
        } else {
            throw new Error('Định dạng bộ lọc không hợp lệ');
        }

        // Nếu là toán tử IN, xử lý danh sách giá trị
        if (operator.toUpperCase() === 'IN' && Array.isArray(value)) {
            // Chuyển mảng giá trị thành một chuỗi SQL IN ('value1', 'value2', ...)
            let formattedValues = value.map((v: any) => `'${v}'`).join(', ');
            value = `(${formattedValues})`;
        } else if (operator === 'like') {
            // Format giá trị nếu toán tử là "like"
            value = `'%${value}%'`;
        } else {
            // Các trường hợp còn lại, format giá trị bình thường
            value = `'${value}'`;
        }

        // Thêm prefix của bảng nếu có doctypeName
        let tablePrefix = doctypeName ? `"tab${doctypeName}".` : '';

        // Thêm điều kiện vào chuỗi SQL
        if (operator === 'like') {
            sqlCondition += ` AND LOWER(${tablePrefix}"${fieldName}") LIKE LOWER(${value})`;
        } else {
            sqlCondition += ` AND ${tablePrefix}"${fieldName}" ${operator} ${value}`;
        }
    });

    return sqlCondition;
}


export const generateHashKey = (...args: (string | number)[]): string => {
    // Generate a random string if no arguments are provided
    const inputString = args.length > 0 ? args.join('') : crypto.randomBytes(16).toString('hex');

    // Tạo hash sử dụng MD5 và chuyển đổi sang mã hex
    const hash = crypto.createHash('md5').update(inputString).digest('hex');

    // Cắt bớt hash nếu cần thiết, ví dụ: 12 ký tự đầu tiên
    return hash.substring(0, 16);
};