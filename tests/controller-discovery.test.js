/**
 * @fileoverview Test for controller auto-discovery functionality
 * Verifies that routing-controllers glob patterns work correctly
 */

const path = require('path');
const fs = require('fs');

describe('Controller Auto-Discovery', () => {
    const controllersDir = path.join(__dirname, '../src/modules/viis-rest-api/controllers');

    test('controllers directory exists', () => {
        expect(fs.existsSync(controllersDir)).toBe(true);
    });

    test('controller files follow naming convention', () => {
        const files = fs.readdirSync(controllersDir);
        const controllerFiles = files.filter(file => file.endsWith('.controller.ts'));

        expect(controllerFiles.length).toBeGreaterThan(0);

        // Verify expected controllers exist
        const expectedControllers = [
            'health.controller.ts',
            'auth.controller.ts',
            'user.controller.ts',
            'device.controller.ts',
            'thingsboard.controller.ts'
        ];

        expectedControllers.forEach(expectedFile => {
            expect(controllerFiles).toContain(expectedFile);
        });
    });

    test('glob patterns match controller files', () => {
        const glob = require('glob');

        // Test the same patterns used in routing-controllers setup
        const patterns = [
            path.join(controllersDir, '*.controller.ts'),
            path.join(controllersDir, '*.controller.js')
        ];

        patterns.forEach(pattern => {
            const matches = glob.sync(pattern);

            if (pattern.endsWith('.ts')) {
                // TypeScript files should be found
                expect(matches.length).toBeGreaterThan(0);

                // Verify specific controllers are matched
                const matchedFiles = matches.map(match => path.basename(match));
                expect(matchedFiles).toContain('health.controller.ts');
                expect(matchedFiles).toContain('thingsboard.controller.ts');
            }
        });
    });

    test('controller files contain valid routing-controllers decorators', () => {
        const files = fs.readdirSync(controllersDir);
        const controllerFiles = files.filter(file =>
            file.endsWith('.controller.ts') &&
            file !== 'base.controller.ts' // Exclude base controller as it's an abstract class
        );

        controllerFiles.forEach(file => {
            const filePath = path.join(controllersDir, file);
            const content = fs.readFileSync(filePath, 'utf8');

            // Check for routing-controllers decorators
            const hasControllerDecorator =
                content.includes('@Controller') ||
                content.includes('@JsonController');
            expect(hasControllerDecorator).toBe(true);

            // Check for at least one route decorator
            const hasRouteDecorator =
                content.includes('@Get') ||
                content.includes('@Post') ||
                content.includes('@Put') ||
                content.includes('@Delete') ||
                content.includes('@Patch');

            expect(hasRouteDecorator).toBe(true);
        });
    });

    test('fallback controllers are properly imported', () => {
        const routingFile = path.join(__dirname, '../src/modules/viis-rest-api/routes/routing-controllers.routes.ts');
        const content = fs.readFileSync(routingFile, 'utf8');

        // Verify fallback imports exist
        expect(content).toContain("import { HealthController }");
        expect(content).toContain("import { AuthController }");
        expect(content).toContain("import { UserController }");
        expect(content).toContain("import { DeviceController }");
        expect(content).toContain("import { ThingsBoardController }");

        // Verify getFallbackControllers method exists
        expect(content).toContain("getFallbackControllers");
    });

    test('routing-controllers setup uses glob patterns', () => {
        const routingFile = path.join(__dirname, '../src/modules/viis-rest-api/routes/routing-controllers.routes.ts');
        const content = fs.readFileSync(routingFile, 'utf8');

        // Verify glob pattern usage
        expect(content).toContain("getControllers");
        expect(content).toContain("*.controller.ts");
        expect(content).toContain("*.controller.js");
        expect(content).toContain("path.join");
    });
});

describe('Controller Discovery Integration', () => {
    test('routing-controllers can handle glob patterns', () => {
        // This is a basic test to ensure the glob pattern format is correct
        const controllersDir = path.join(__dirname, '../src/modules/viis-rest-api/controllers');
        const globPatterns = [
            path.join(controllersDir, '*.controller.ts'),
            path.join(controllersDir, '*.controller.js')
        ];

        globPatterns.forEach(pattern => {
            // Verify pattern format is valid
            expect(pattern).toMatch(/\*\.controller\.(ts|js)$/);
            expect(path.isAbsolute(pattern)).toBe(true);
        });
    });

    test('controller discovery logging is configured', () => {
        const routingFile = path.join(__dirname, '../src/modules/viis-rest-api/routes/routing-controllers.routes.ts');
        const content = fs.readFileSync(routingFile, 'utf8');

        // Verify logging for auto-discovery
        expect(content).toContain("Using routing-controllers glob pattern");
        expect(content).toContain("Controller glob patterns configured");
        expect(content).toContain("Using fallback manual controller registration");
    });
});
