import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrate1749196519625 implements MigrationInterface {
    name = 'Migrate1749196519625'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD \`customer_user\` varchar(255) NULL`);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` ADD CONSTRAINT \`FK_615b2e7ef1d8e04d0a8f30be73a\` FOREIGN KEY (\`customer_user\`) REFERENCES \`tabiot_customer_user\`(\`name\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP FOREIGN KEY \`FK_615b2e7ef1d8e04d0a8f30be73a\``);
        await queryRunner.query(`ALTER TABLE \`tabiot_schedule_log\` DROP COLUMN \`customer_user\``);
    }

}
