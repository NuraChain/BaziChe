import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add the reward tables and the new settings keys these tables depend on. The migration is idempotent
 * so a fresh database can start from the schema in the entities and an older one can be upgraded safely.
 */
export class RewardSchema1760000000000 implements MigrationInterface
{
    name = 'RewardSchema1760000000000';

    async up(runner: QueryRunner)
    {
        await runner.query(`
            alter table settings
                drop constraint if exists settings_key_known;

            alter table settings
                add constraint settings_key_known check (key in ('usd-rate', 'push-keys', 'reward-config', 'reward-budget'));
        `);

        await runner.query(`
            create table if not exists reward_streaks (
                user_id uuid primary key references users(id) on delete cascade,
                streak smallint not null default 0 check (streak between 0 and 30),
                last_day smallint not null default 0 check (last_day between 0 and 30),
                best smallint not null default 0 check (best between 0 and 30),
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now()
            );
        `);

        await runner.query(`
            create table if not exists reward_checkins (
                user_id uuid not null references users(id) on delete cascade,
                day integer not null check (day between 1 and 30),
                position smallint not null check (position between 1 and 30),
                created_at timestamptz not null default now(),
                primary key (user_id, day)
            );
        `);

        await runner.query(`
            create index if not exists reward_checkins_day_idx on reward_checkins(day);
        `);

        await runner.query(`
            create table if not exists reward_quest_progress (
                user_id uuid not null references users(id) on delete cascade,
                period varchar(16) not null check (period in ('daily', 'weekly')),
                period_key varchar(32) not null,
                quest_id varchar(64) not null,
                progress integer not null default 0 check (progress >= 0),
                target integer not null default 0 check (target >= 0),
                done_at timestamptz,
                claimed_at timestamptz,
                created_at timestamptz not null default now(),
                primary key (user_id, period, period_key, quest_id)
            );
        `);

        await runner.query(`
            create index if not exists reward_quest_progress_user_period_idx on reward_quest_progress(user_id, period);
        `);

        await runner.query(`
            create table if not exists reward_quest_opponents (
                user_id uuid not null references users(id) on delete cascade,
                day integer not null,
                opponent_id uuid not null references users(id) on delete cascade,
                count smallint not null default 0 check (count > 0),
                primary key (user_id, day, opponent_id)
            );
        `);

        await runner.query(`
            create table if not exists reward_grants (
                id uuid primary key default gen_random_uuid(),
                user_id uuid not null references users(id) on delete cascade,
                cycle integer not null,
                source varchar(16) not null check (source in ('checkin', 'bonus', 'daily', 'weekly', 'chest')),
                source_key varchar(128) not null,
                amount numeric(40,0) not null check (amount >= 0),
                wanted numeric(40,0) not null check (wanted >= 0),
                item_id varchar(64),
                delivered boolean,
                created_at timestamptz not null default now(),
                unique (user_id, source, source_key)
            );
        `);

        await runner.query(`
            create index if not exists reward_grants_user_cycle_idx on reward_grants(user_id, cycle);
        `);

        await runner.query(`
            create table if not exists reward_payouts (
                id uuid primary key default gen_random_uuid(),
                user_id uuid not null references users(id) on delete cascade,
                wallet_address varchar(42) not null check (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
                amount numeric(40,0) not null check (amount >= 0),
                state varchar(16) not null check (state in ('queued', 'sent', 'mined', 'failed')),
                tx_hash varchar(132),
                raw_transaction text,
                tx_nonce bigint,
                attempts smallint not null default 0,
                created_at timestamptz not null default now(),
                queued_at timestamptz,
                sent_at timestamptz,
                mined_at timestamptz,
                failed_at timestamptz,
                updated_at timestamptz not null default now()
            );
        `);

        await runner.query(`
            create unique index if not exists reward_payouts_user_open_once
                on reward_payouts(user_id)
             where state in ('queued', 'sent');
        `);

        await runner.query(`
            create table if not exists reward_cycle_totals (
                cycle integer primary key,
                granted numeric(40,0) not null default 0 check (granted >= 0)
            );
        `);
    }

    async down(runner: QueryRunner)
    {
        await runner.query(`drop table if exists reward_cycle_totals`);
        await runner.query(`drop table if exists reward_payouts`);
        await runner.query(`drop table if exists reward_grants`);
        await runner.query(`drop table if exists reward_quest_opponents`);
        await runner.query(`drop table if exists reward_quest_progress`);
        await runner.query(`drop table if exists reward_checkins`);
        await runner.query(`drop table if exists reward_streaks`);

        await runner.query(`
            alter table settings
                drop constraint if exists settings_key_known;

            alter table settings
                add constraint settings_key_known check (key in ('usd-rate', 'push-keys'));
        `);
    }
}
