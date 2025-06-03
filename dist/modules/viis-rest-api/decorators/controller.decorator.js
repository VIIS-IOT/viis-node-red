"use strict";
/**
 * @fileoverview Controller decorator for VIIS REST API
 * Provides a consistent way to mark controller classes for dependency injection
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Controller = Controller;
exports.isController = isController;
exports.getControllerPrefix = getControllerPrefix;
const typedi_1 = require("typedi");
/**
 * Controller decorator that combines @Service with controller-specific metadata
 * This decorator should be used on all controller classes to:
 * 1. Register them in the TypeDI container
 * 2. Mark them as controllers for future framework enhancements
 * 3. Provide consistent patterns for other API modules
 *
 * @example
 * ```typescript
 * @Controller()
 * export class AuthController extends BaseController {
 *   constructor(
 *     @Inject() private authService: AuthService,
 *     @Inject("node") private node: Node
 *   ) {
 *     super(node);
 *   }
 * }
 * ```
 */
function Controller(prefix) {
    return function (target) {
        // Apply @Service decorator for dependency injection
        (0, typedi_1.Service)()(target);
        // Store controller metadata for future use
        Reflect.defineMetadata('controller:prefix', prefix || '', target);
        Reflect.defineMetadata('controller:isController', true, target);
        return target;
    };
}
/**
 * Check if a class is marked as a controller
 */
function isController(target) {
    return Reflect.getMetadata('controller:isController', target) === true;
}
/**
 * Get controller prefix
 */
function getControllerPrefix(target) {
    return Reflect.getMetadata('controller:prefix', target) || '';
}
