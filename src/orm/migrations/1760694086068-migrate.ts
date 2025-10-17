import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrate1760694086068 implements MigrationInterface {
    name = 'Migrate1760694086068'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_notification\` CHANGE \`metadata\` \`metadata\` text NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`tabiot_notification\` CHANGE \`metadata\` \`metadata\` text NULL COMMENT 'JSON metadata for error tracking (occurrence_count, etc.)'`);
    }

}
