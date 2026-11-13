import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Preserve every reward amount in wei and the signed bytes needed to safely rebroadcast a payout. */
export class RewardPayoutRecovery1794600001000 implements MigrationInterface
{
    name = 'RewardPayoutRecovery1794600001000';

    async up(runner: QueryRunner)
    {
        await runner.query(`alter table reward_grants alter column amount type numeric(40,0) using amount * 1000000000000000000`);
        await runner.query(`alter table reward_grants alter column wanted type numeric(40,0) using wanted * 1000000000000000000`);
        await runner.query(`alter table reward_cycle_totals alter column granted type numeric(40,0) using granted * 1000000000000000000`);
        await runner.query(`alter table reward_payouts add column if not exists raw_transaction text`);
        await runner.query(`alter table reward_payouts add column if not exists tx_nonce bigint`);
    }

    async down()
    {
        // Wei balances cannot be safely converted back once payouts may have been queued.
    }
}