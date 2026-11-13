import type { MigrationInterface, QueryRunner } from 'typeorm';

/** More than one daily or weekly quest grant belongs to the same source category. */
export class RewardGrantSourceKey1794600000000 implements MigrationInterface
{
    name = 'RewardGrantSourceKey1794600000000';

    async up(runner: QueryRunner)
    {
        await runner.query(`alter table reward_grants drop constraint if exists reward_grants_user_id_source_key`);
        await runner.query(`drop index if exists reward_grants_user_source_once`);
        await runner.query(`create unique index if not exists reward_grants_user_source_key_once on reward_grants(user_id, source, source_key)`);
    }

    async down()
    {
        // The old constraint cannot be restored once multiple quests share a source category.
    }
}