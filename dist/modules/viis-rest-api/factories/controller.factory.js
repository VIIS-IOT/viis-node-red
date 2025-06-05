"use strict";
/**
 * @fileoverview Controller factory for creating standardized API controllers
 * Provides templates and utilities for rapid controller development
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControllerFactory = void 0;
/**
 * Route builder implementation
 */
class RouteBuilderImpl {
    constructor() {
        this.route = {};
    }
    method(method) {
        this.route.method = method;
        return this;
    }
    path(path) {
        this.route.path = path;
        return this;
    }
    handler(handlerName) {
        this.route.handler = handlerName;
        return this;
    }
    middleware(...middlewareNames) {
        this.route.middleware = middlewareNames;
        return this;
    }
    validation(validation) {
        this.route.validation = validation;
        return this;
    }
    build() {
        if (!this.route.method || !this.route.path || !this.route.handler) {
            throw new Error('Route must have method, path, and handler');
        }
        return this.route;
    }
}
/**
 * Controller factory class
 */
class ControllerFactory {
    constructor(node, configManager) {
        this.node = node;
        this.configManager = configManager;
    }
    /**
     * Create a new route builder
     */
    createRoute() {
        return new RouteBuilderImpl();
    }
    /**
     * Create routes from template
     */
    createRoutesFromTemplate(template) {
        return template.routes.map(route => (Object.assign(Object.assign({}, route), { path: `${template.basePath}${route.path}`, middleware: [
                ...(template.middlewares || []),
                ...(route.middleware || [])
            ] })));
    }
    /**
     * Create CRUD routes from template
     */
    createCrudRoutes(template) {
        const routes = [];
        const { entityName, basePath, enabledOperations, middleware = {} } = template;
        // List operation - GET /entities
        if (enabledOperations.list) {
            routes.push(this.createRoute()
                .method('GET')
                .path(basePath)
                .handler(`list${entityName}s`)
                .middleware(...(middleware.list || []))
                .build());
        }
        // Create operation - POST /entities
        if (enabledOperations.create) {
            routes.push(this.createRoute()
                .method('POST')
                .path(basePath)
                .handler(`create${entityName}`)
                .middleware(...(middleware.create || []))
                .build());
        }
        // Read operation - GET /entities/:id
        if (enabledOperations.read) {
            routes.push(this.createRoute()
                .method('GET')
                .path(`${basePath}/:id`)
                .handler(`get${entityName}`)
                .middleware(...(middleware.read || []))
                .build());
        }
        // Update operation - PUT /entities/:id
        if (enabledOperations.update) {
            routes.push(this.createRoute()
                .method('PUT')
                .path(`${basePath}/:id`)
                .handler(`update${entityName}`)
                .middleware(...(middleware.update || []))
                .build());
        }
        // Delete operation - DELETE /entities/:id
        if (enabledOperations.delete) {
            routes.push(this.createRoute()
                .method('DELETE')
                .path(`${basePath}/:id`)
                .handler(`delete${entityName}`)
                .middleware(...(middleware.delete || []))
                .build());
        }
        return routes;
    }
    /**
     * Create a basic controller class template
     */
    createControllerTemplate(className, basePath, serviceName) {
        return `/**
 * @fileoverview ${className} - Generated controller
 */

import { Request, Response } from 'express';
import { Inject } from 'typedi';
import { BaseController } from './base.controller';
import { Controller } from '../decorators/controller.decorator';
import { RouteDefinition } from '../types/common.types';
import { Node } from 'node-red';

@Controller('${basePath}')
export class ${className} extends BaseController {
    constructor(
        @Inject() private ${serviceName.toLowerCase()}: ${serviceName},
        @Inject('node') node: Node
    ) {
        super(node);
    }

    getRoutes(): RouteDefinition[] {
        return [
            // Add your routes here using the factory
            // Example:
            // {
            //     method: 'GET',
            //     path: '${basePath}',
            //     handler: 'list',
            //     middleware: ['auth']
            // }
        ];
    }

    // Add your handler methods here
    // Example:
    // list = this.asyncHandler(async (req: Request, res: Response): Promise<void> => {
    //     const result = await this.${serviceName.toLowerCase()}.list();
    //     this.success(res, result);
    // });
}`;
    }
    /**
     * Create a service template
     */
    createServiceTemplate(className, entityName) {
        return `/**
 * @fileoverview ${className} - Generated service
 */

import { Service } from 'typedi';
import { BaseService, ServiceContext } from './base.service';

@Service()
export class ${className} extends BaseService {
    constructor(context: ServiceContext) {
        super(context, '${className}');
    }

    protected async onInitialize(): Promise<void> {
        // Add initialization logic here
        this.logInfo('${className} initialized');
    }

    protected async onCleanup(): Promise<void> {
        // Add cleanup logic here
        this.logInfo('${className} cleanup completed');
    }

    // Add your business logic methods here
    // Example CRUD operations:

    async list(): Promise<any[]> {
        return this.executeOperation('list${entityName}s', async () => {
            this.ensureDatabaseService();
            // Add your list logic here
            return [];
        });
    }

    async getById(id: string): Promise<any> {
        this.validateStringInput(id, 'id');
        
        return this.executeOperation('get${entityName}ById', async () => {
            this.ensureDatabaseService();
            // Add your get by ID logic here
            return null;
        });
    }

    async create(data: any): Promise<any> {
        this.validateInput(data, 'data');
        
        return this.executeOperation('create${entityName}', async () => {
            this.ensureDatabaseService();
            // Add your create logic here
            return data;
        });
    }

    async update(id: string, data: any): Promise<any> {
        this.validateStringInput(id, 'id');
        this.validateInput(data, 'data');
        
        return this.executeOperation('update${entityName}', async () => {
            this.ensureDatabaseService();
            // Add your update logic here
            return data;
        });
    }

    async delete(id: string): Promise<void> {
        this.validateStringInput(id, 'id');
        
        return this.executeOperation('delete${entityName}', async () => {
            this.ensureDatabaseService();
            // Add your delete logic here
        });
    }
}`;
    }
    /**
     * Generate complete CRUD controller and service files
     */
    generateCrudModule(entityName, basePath, options = {}) {
        const controllerName = `${entityName}Controller`;
        const serviceName = `${entityName}Service`;
        // Generate routes
        const crudTemplate = {
            entityName,
            basePath,
            enabledOperations: Object.assign({ create: true, read: true, update: true, delete: true, list: true }, options.enabledOperations),
            middleware: options.middleware
        };
        const routes = this.createCrudRoutes(crudTemplate);
        // Generate controller code
        const controllerCode = this.createControllerTemplate(controllerName, basePath, serviceName);
        // Generate service code
        const serviceCode = this.createServiceTemplate(serviceName, entityName);
        return {
            controllerCode,
            serviceCode,
            routes
        };
    }
}
exports.ControllerFactory = ControllerFactory;
