import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rows from before the messenger's groups and files, given what a row made now is given, so a start
 * can add the columns and the checks that hold them: a group the switches and the approval it is made
 * with (`SWITCH_DEFAULTS` when this was written), an owner and an admin a role that began when they
 * joined, an admin every right, and a file sent before a message kept what it was sent as `file`,
 * since only its seal says more. A row that holds a value keeps it, so a database built since is left
 * as it is.
 */
export class FillMessengerColumns1793682422851 implements MigrationInterface
{
    name = 'FillMessengerColumns1793682422851';

    async up(runner: QueryRunner)
    {
        await runner.query(`
            alter table groups
                add column if not exists members_send boolean,
                add column if not exists members_media boolean,
                add column if not exists members_add boolean,
                add column if not exists members_pin boolean,
                add column if not exists members_info boolean,
                add column if not exists members_call boolean,
                add column if not exists members_join_call boolean,
                add column if not exists members_speak boolean,
                add column if not exists approval boolean`);

        await runner.query(`
            update groups
               set members_send = coalesce(members_send, true),
                   members_media = coalesce(members_media, true),
                   members_add = coalesce(members_add, true),
                   members_pin = coalesce(members_pin, false),
                   members_info = coalesce(members_info, false),
                   members_call = coalesce(members_call, true),
                   members_join_call = coalesce(members_join_call, true),
                   members_speak = coalesce(members_speak, true),
                   approval = coalesce(approval, false)
             where members_send is null or members_media is null or members_add is null or members_pin is null
                or members_info is null or members_call is null or members_join_call is null or members_speak is null
                or approval is null`);

        await runner.query(`
            alter table groups
                alter column members_send set not null,
                alter column members_media set not null,
                alter column members_add set not null,
                alter column members_pin set not null,
                alter column members_info set not null,
                alter column members_call set not null,
                alter column members_join_call set not null,
                alter column members_speak set not null,
                alter column approval set not null`);

        await runner.query(`
            alter table group_members
                add column if not exists rights text array,
                add column if not exists role_since timestamptz`);

        await runner.query(`update group_members set role_since = joined_at where role <> 'member' and role_since is null`);

        await runner.query(`
            update group_members
               set rights = array['info', 'invite', 'approve', 'remove', 'ban', 'delete', 'pin', 'members', 'calls']::text[]
             where role = 'admin' and rights is null`);

        await runner.query(`alter table messages add column if not exists file_as character varying(8)`);
        await runner.query(`update messages set file_as = 'file' where kind = 'file' and file_as is null`);
    }

    async down()
    {
        // The columns are the entities' and stay, and so do the values the rows were given.
    }
}
