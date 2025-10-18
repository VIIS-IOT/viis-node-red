/**
 * @fileoverview Default User Seed Service
 * Creates a default admin user for initial system access
 */

import bcrypt from 'bcrypt';
import { Node } from 'node-red';
import { Service } from 'typedi';
import { logger } from '../utils/logger';
import { DatabaseService } from './database.service';
import { v4 as uuidv4 } from 'uuid';
import { UserRoleTypeEnum } from '../../../constants/user_role';

/**
 * Service to seed default admin user
 */
@Service()
export class DefaultUserSeedService {
    // Default user configuration
    private readonly DEFAULT_USER = {
        email: 'fueliot@gmail.com',
        password: 'admin123',
        firstName: 'FuelIoT',
        lastName: 'Admin',
        userName: 'fueliot_admin'
    };

    constructor(
        private databaseService: DatabaseService,
        private node: Node
    ) {}

    /**
     * Seed default admin user if not exists
     */
    async seedDefaultUser(): Promise<void> {
        try {
            logger.info(this.node, '🌱 Checking for default admin user...');

            const userRepo = this.databaseService.getCustomerUserRepository();
            const credRepo = this.databaseService.getCustomerUserCredentialRepository();

            // Check if user already exists
            const existingUser = await userRepo.findOne({
                where: { email: this.DEFAULT_USER.email }
            });

            if (existingUser) {
                logger.info(this.node, `✅ Default admin user already exists: ${this.DEFAULT_USER.email}`);
                return;
            }

            logger.info(this.node, `🔧 Creating default admin user: ${this.DEFAULT_USER.email}`);

            // Generate unique IDs
            const userId = `user-${uuidv4()}`;
            const credentialId = `cred-${uuidv4()}`;

            // Hash password with bcrypt (salt rounds: 10)
            const hashedPassword = await bcrypt.hash(this.DEFAULT_USER.password, 10);

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
                user_type: UserRoleTypeEnum.CUSTOMER_USER,
                created_time: new Date(),
                date_join: new Date(),
                date_active: new Date()
            });

            await userRepo.save(newUser);
            logger.info(this.node, `✅ Created customer user: ${userId}`);

            // Create user credentials
            const newCredential = credRepo.create({
                name: credentialId,
                id: credentialId,
                user_id: userId,
                password: hashedPassword,
                enable: 1 // Enabled
            });

            await credRepo.save(newCredential);
            logger.info(this.node, `✅ Created user credentials for: ${userId}`);

            logger.info(this.node, `🎉 Default admin user created successfully!`);
            logger.info(this.node, `   📧 Email: ${this.DEFAULT_USER.email}`);
            logger.info(this.node, `   🔑 Password: ${this.DEFAULT_USER.password}`);
            logger.info(this.node, `   👤 User ID: ${userId}`);
            logger.warn(this.node, `⚠️  Please change the default password after first login!`);

        } catch (error) {
            logger.error(this.node, `Failed to seed default user: ${(error as Error).message}`, {
                stack: (error as Error).stack
            });
            // Don't throw error - allow system to continue even if seed fails
        }
    }
}
