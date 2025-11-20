"use strict";
/**
 * @fileoverview Default User Seed Service
 * Creates a default admin user for initial system access
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultUserSeedService = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const typedi_1 = require("typedi");
const logger_1 = require("../utils/logger");
const database_service_1 = require("./database.service");
const uuid_1 = require("uuid");
const user_role_1 = require("../../../constants/user_role");
/**
 * Service to seed default admin user
 */
let DefaultUserSeedService = class DefaultUserSeedService {
    constructor(databaseService, node) {
        this.databaseService = databaseService;
        this.node = node;
        // Default user configuration
        this.DEFAULT_USER = {
            email: 'fueliot@gmail.com',
            password: 'admin123',
            firstName: 'FuelIoT',
            lastName: 'Admin',
            userName: 'fueliot_admin'
        };
    }
    /**
     * Seed default admin user if not exists
     */
    async seedDefaultUser() {
        try {
            logger_1.logger.info(this.node, '🌱 Checking for default admin user...');
            const userRepo = this.databaseService.getCustomerUserRepository();
            const credRepo = this.databaseService.getCustomerUserCredentialRepository();
            // Check if user already exists
            const existingUser = await userRepo.findOne({
                where: { email: this.DEFAULT_USER.email }
            });
            if (existingUser) {
                logger_1.logger.info(this.node, `✅ Default admin user already exists: ${this.DEFAULT_USER.email}`);
                return;
            }
            logger_1.logger.info(this.node, `🔧 Creating default admin user: ${this.DEFAULT_USER.email}`);
            // Generate unique IDs
            const userId = `user-${(0, uuid_1.v4)()}`;
            const credentialId = `cred-${(0, uuid_1.v4)()}`;
            // Hash password with bcrypt (salt rounds: 10)
            const hashedPassword = await bcrypt_1.default.hash(this.DEFAULT_USER.password, 10);
            // Create customer user
            const newUser = userRepo.create({
                name: userId,
                user_id: userId,
                user_name: this.DEFAULT_USER.userName,
                email: this.DEFAULT_USER.email,
                first_name: this.DEFAULT_USER.firstName,
                last_name: this.DEFAULT_USER.lastName,
                full_name: `${this.DEFAULT_USER.firstName} ${this.DEFAULT_USER.lastName}`,
                is_admin: 1, // Set as admin
                is_deactivated: 0, // Active
                user_type: user_role_1.UserRoleTypeEnum.CUSTOMER_USER,
                created_time: new Date(),
                date_join: new Date(),
                date_active: new Date()
            });
            await userRepo.save(newUser);
            logger_1.logger.info(this.node, `✅ Created customer user: ${userId}`);
            // Create user credentials
            const newCredential = credRepo.create({
                name: credentialId,
                id: credentialId,
                user_id: userId,
                password: hashedPassword,
                enable: 1 // Enabled
            });
            await credRepo.save(newCredential);
            logger_1.logger.info(this.node, `✅ Created user credentials for: ${userId}`);
            logger_1.logger.info(this.node, `🎉 Default admin user created successfully!`);
            logger_1.logger.info(this.node, `   📧 Email: ${this.DEFAULT_USER.email}`);
            logger_1.logger.info(this.node, `   🔑 Password: ${this.DEFAULT_USER.password}`);
            logger_1.logger.info(this.node, `   👤 User ID: ${userId}`);
            logger_1.logger.warn(this.node, `⚠️  Please change the default password after first login!`);
        }
        catch (error) {
            logger_1.logger.error(this.node, `Failed to seed default user: ${error.message}`, {
                stack: error.stack
            });
            // Don't throw error - allow system to continue even if seed fails
        }
    }
};
exports.DefaultUserSeedService = DefaultUserSeedService;
exports.DefaultUserSeedService = DefaultUserSeedService = __decorate([
    (0, typedi_1.Service)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService, Object])
], DefaultUserSeedService);
