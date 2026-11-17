import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The signed bytes needed to safely rebroadcast a payout.
 *
 * This once also multiplied every reward amount by 10^18. The amounts were wei in numeric(40,0)
 * from the first reward schema on every path a database can take, so that would have inflated
 * them, or overflowed and stopped the start. The file keeps its name for databases that recorded it.
 */
export class RewardPayoutRecovery1794600001000 implements MigrationInterface
{
    name = 'RewardPayoutRecovery1794600001000';

    async up(runner: QueryRunner)
    {
        await runner.query(`alter table reward_payouts add column if not exists raw_transaction text`);
        await runner.query(`alter table reward_payouts add column if not exists tx_nonce bigint`);
    }

    async down()
    {
        // The columns stay: a payout already sent needs its bytes to be sent again safely.
    }
}