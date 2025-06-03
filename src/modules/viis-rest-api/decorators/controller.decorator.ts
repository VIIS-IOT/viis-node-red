/**
 * @fileoverview Controller decorator for VIIS REST API
 * Provides a consistent way to mark controller classes for dependency injection
 */

import { Service } from 'typedi';

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
export function Controller(prefix?: string): ClassDecorator {
    return function <T extends Function>(target: T): T {
        // Apply @Service decorator for dependency injection
        Service()(target);
        
        // Store controller metadata for future use
        Reflect.defineMetadata('controller:prefix', prefix || '', target);
        Reflect.defineMetadata('controller:isController', true, target);
        
        return target;
    };
}

/**
 * Check if a class is marked as a controller
 */
export function isController(target: any): boolean {
    return Reflect.getMetadata('controller:isController', target) === true;
}

/**
 * Get controller prefix
 */
export function getControllerPrefix(target: any): string {
    return Reflect.getMetadata('controller:prefix', target) || '';
}
