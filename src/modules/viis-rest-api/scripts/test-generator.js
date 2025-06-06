#!/usr/bin/env node

/**
 * Test script for the updated endpoint generator
 * Validates that generated code follows routing-controllers patterns
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Test configuration
const TEST_ENTITY = 'TestGeneratedEntity';
const TEST_PATH = '/test-generated-entities';
const BASE_DIR = path.join(__dirname, '..');

// Colors for console output
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m'
};

function log(color, message) {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Test the endpoint generator
 */
async function testGenerator() {
    log('blue', '\n🧪 Testing Updated Endpoint Generator');
    log('blue', '=====================================\n');

    try {
        // Step 1: Generate test endpoint
        log('cyan', '📝 Step 1: Generating test endpoint...');
        execSync(`node generate-endpoint.js ${TEST_ENTITY} --path ${TEST_PATH}`, {
            cwd: __dirname,
            stdio: 'inherit'
        });

        // Step 2: Validate generated files exist
        log('cyan', '\n🔍 Step 2: Validating generated files...');
        const expectedFiles = [
            `controllers/${TEST_ENTITY.toLowerCase()}.controller.ts`,
            `services/${TEST_ENTITY.toLowerCase()}.service.ts`,
            `dto/${TEST_ENTITY.toLowerCase()}.dto.ts`,
            `types/${TEST_ENTITY.toLowerCase()}.types.ts`,
            `validators/${TEST_ENTITY.toLowerCase()}.validator.ts`
        ];

        let allFilesExist = true;
        expectedFiles.forEach(file => {
            const filePath = path.join(BASE_DIR, file);
            if (fs.existsSync(filePath)) {
                log('green', `  ✅ ${file} exists`);
            } else {
                log('red', `  ❌ ${file} missing`);
                allFilesExist = false;
            }
        });

        if (!allFilesExist) {
            throw new Error('Some expected files were not generated');
        }

        // Step 3: Validate controller patterns
        log('cyan', '\n🎯 Step 3: Validating routing-controllers patterns...');
        await validateControllerPatterns();

        // Step 4: Validate service patterns
        log('cyan', '\n🔧 Step 4: Validating service dependency injection...');
        await validateServicePatterns();

        // Step 5: Validate DTO patterns
        log('cyan', '\n📋 Step 5: Validating DTO validation patterns...');
        await validateDtoPatterns();

        // Step 6: Validate validator patterns
        log('cyan', '\n✅ Step 6: Validating validator patterns...');
        await validateValidatorPatterns();

        // Step 7: Clean up test files
        log('cyan', '\n🧹 Step 7: Cleaning up test files...');
        expectedFiles.forEach(file => {
            const filePath = path.join(BASE_DIR, file);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                log('green', `  🗑️ Removed ${file}`);
            }
        });

        log('green', '\n🎉 All tests passed! Generator is working correctly.');
        log('green', '✨ Generated code follows routing-controllers architecture patterns.');

    } catch (error) {
        log('red', `\n❌ Test failed: ${error.message}`);
        process.exit(1);
    }
}

/**
 * Validate controller follows routing-controllers patterns
 */
async function validateControllerPatterns() {
    const controllerPath = path.join(BASE_DIR, `controllers/${TEST_ENTITY.toLowerCase()}.controller.ts`);
    const content = fs.readFileSync(controllerPath, 'utf8');

    const patterns = [
        { pattern: /@JsonController\(/, description: '@JsonController decorator' },
        { pattern: /@Service\(\)/, description: '@Service decorator' },
        { pattern: /@Get\(/, description: '@Get decorator' },
        { pattern: /@Post\(/, description: '@Post decorator' },
        { pattern: /@Put\(/, description: '@Put decorator' },
        { pattern: /@Delete\(/, description: '@Delete decorator' },
        { pattern: /@Authorized\(\)/, description: '@Authorized decorator' },
        { pattern: /@Body\(\)/, description: '@Body decorator' },
        { pattern: /@Param\(/, description: '@Param decorator' },
        { pattern: /@QueryParams\(\)/, description: '@QueryParams decorator' },
        { pattern: /@CurrentUser\(\)/, description: '@CurrentUser decorator' },
        { pattern: /@Inject\(NODE_TOKEN\)/, description: 'NODE_TOKEN injection' },
        { pattern: /from 'routing-controllers'/, description: 'routing-controllers import' },
        { pattern: /private readonly.*Service/, description: 'Service injection' }
    ];

    const antiPatterns = [
        { pattern: /extends BaseController/, description: 'BaseController inheritance (should not exist)' },
        { pattern: /getRoutes\(\)/, description: 'getRoutes method (should not exist)' },
        { pattern: /Container\.get\(/, description: 'Manual Container.get calls (should not exist)' },
        { pattern: /this\.asyncHandler/, description: 'asyncHandler usage (should not exist)' }
    ];

    patterns.forEach(({ pattern, description }) => {
        if (pattern.test(content)) {
            log('green', `  ✅ ${description} found`);
        } else {
            throw new Error(`Missing required pattern: ${description}`);
        }
    });

    antiPatterns.forEach(({ pattern, description }) => {
        if (!pattern.test(content)) {
            log('green', `  ✅ ${description} correctly absent`);
        } else {
            throw new Error(`Found deprecated pattern: ${description}`);
        }
    });
}

/**
 * Validate service follows proper DI patterns
 */
async function validateServicePatterns() {
    const servicePath = path.join(BASE_DIR, `services/${TEST_ENTITY.toLowerCase()}.service.ts`);
    const content = fs.readFileSync(servicePath, 'utf8');

    const patterns = [
        { pattern: /@Service\(\)/, description: '@Service decorator' },
        { pattern: /@Inject\(NODE_TOKEN\)/, description: 'NODE_TOKEN injection' },
        { pattern: /private readonly databaseService: DatabaseService/, description: 'DatabaseService injection' },
        { pattern: /ensureDatabaseService\(\)/, description: 'Database service validation' },
        { pattern: /executeOperation/, description: 'Operation execution wrapper' },
        { pattern: /ApiError/, description: 'ApiError usage' },
        { pattern: /logger\.info/, description: 'Logging implementation' }
    ];

    const antiPatterns = [
        { pattern: /extends BaseService/, description: 'BaseService inheritance (should not exist)' },
        { pattern: /Container\.get\(/, description: 'Manual Container.get calls (should not exist)' }
    ];

    patterns.forEach(({ pattern, description }) => {
        if (pattern.test(content)) {
            log('green', `  ✅ ${description} found`);
        } else {
            throw new Error(`Missing required pattern: ${description}`);
        }
    });

    antiPatterns.forEach(({ pattern, description }) => {
        if (!pattern.test(content)) {
            log('green', `  ✅ ${description} correctly absent`);
        } else {
            throw new Error(`Found deprecated pattern: ${description}`);
        }
    });
}

/**
 * Validate DTO follows class-validator patterns
 */
async function validateDtoPatterns() {
    const dtoPath = path.join(BASE_DIR, `dto/${TEST_ENTITY.toLowerCase()}.dto.ts`);
    const content = fs.readFileSync(dtoPath, 'utf8');

    const patterns = [
        { pattern: /from 'class-validator'/, description: 'class-validator import' },
        { pattern: /@IsString\(\)/, description: '@IsString decorator' },
        { pattern: /@IsNotEmpty\(/, description: '@IsNotEmpty decorator' },
        { pattern: /@IsOptional\(\)/, description: '@IsOptional decorator' },
        { pattern: /@Length\(/, description: '@Length decorator' },
        { pattern: /@IsEnum\(/, description: '@IsEnum decorator' },
        { pattern: /@Type\(\(\) => Number\)/, description: '@Type decorator for numbers' },
        { pattern: /@Min\(/, description: '@Min decorator' },
        { pattern: /@Max\(/, description: '@Max decorator' },
        { pattern: /ParamsDto/, description: 'ParamsDto class' },
        { pattern: /QueryDto/, description: 'QueryDto class' },
        { pattern: /@IsUUID\(/, description: '@IsUUID decorator for ID validation' }
    ];

    patterns.forEach(({ pattern, description }) => {
        if (pattern.test(content)) {
            log('green', `  ✅ ${description} found`);
        } else {
            throw new Error(`Missing required pattern: ${description}`);
        }
    });
}

/**
 * Validate validator follows proper patterns
 */
async function validateValidatorPatterns() {
    const validatorPath = path.join(BASE_DIR, `validators/${TEST_ENTITY.toLowerCase()}.validator.ts`);
    const content = fs.readFileSync(validatorPath, 'utf8');

    const patterns = [
        { pattern: /@Service\(\)/, description: '@Service decorator' },
        { pattern: /@Inject\(NODE_TOKEN\)/, description: 'NODE_TOKEN injection' },
        { pattern: /from 'class-validator'/, description: 'class-validator import' },
        { pattern: /from 'class-transformer'/, description: 'class-transformer import' },
        { pattern: /validateDto/, description: 'Generic validation method' },
        { pattern: /formatValidationErrors/, description: 'Error formatting method' },
        { pattern: /ApiError/, description: 'ApiError usage' }
    ];

    const antiPatterns = [
        { pattern: /extends BaseValidator/, description: 'BaseValidator inheritance (should not exist)' }
    ];

    patterns.forEach(({ pattern, description }) => {
        if (pattern.test(content)) {
            log('green', `  ✅ ${description} found`);
        } else {
            throw new Error(`Missing required pattern: ${description}`);
        }
    });

    antiPatterns.forEach(({ pattern, description }) => {
        if (!pattern.test(content)) {
            log('green', `  ✅ ${description} correctly absent`);
        } else {
            throw new Error(`Found deprecated pattern: ${description}`);
        }
    });
}

// Run the test
if (require.main === module) {
    testGenerator().catch(error => {
        log('red', `\n💥 Test suite failed: ${error.message}`);
        process.exit(1);
    });
}

module.exports = { testGenerator };
