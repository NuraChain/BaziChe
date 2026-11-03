import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { MinterOperation, MinterState, StaffRole } from '../domains/admin/roles.ts';
import { User } from './user.entity.ts';

/**
 * One grant or revoke of the NFT minter's `MINTER_ROLE` on a contract, from the moment the owner
 * asks for it to the moment NuraChain has settled it.
 *
 * The owner's wallet signs it, so this server only ever composes the call and then hears of the hash:
 * the row is what says it was asked, what the wallet reported, and how it ended. `asked` has no hash
 * and `pending` has one; `lapsed` is a call asked for and never sent. One change may be open (asked
 * or pending) for a contract at a time, by the partial unique index, which is what keeps two grants
 * from racing and a revoke from crossing a grant.
 *
 * Whoever asked is kept as they were (handle and role), because the staff log's row for a settled
 * change names them, and it is written by whoever's page happens to settle it.
 */
@Check('minter_changes_operation_known', `operation in ('grant', 'revoke')`)
@Check('minter_changes_state_known', `state in ('asked', 'pending', 'confirmed', 'failed', 'lapsed')`)
@Check('minter_changes_role_known', `staff_role in ('moderator', 'admin', 'co-owner', 'owner')`)
@Check('minter_changes_minter_shape', `minter ~ '^0x[0-9a-f]{40}$'`)
@Check('minter_changes_signer_shape', `signer ~ '^0x[0-9a-f]{40}$'`)
@Check('minter_changes_hash_shape', `hash is null or hash ~ '^0x[0-9a-f]{64}$'`)
@Check('minter_changes_hash_stated', `(state in ('asked', 'lapsed')) = (hash is null)`)
@Check('minter_changes_settled_stated', `(state in ('confirmed', 'failed', 'lapsed')) = (settled_at is not null)`)
@Check('minter_changes_reason_length', `char_length(reason) between 3 and 500`)
@Index('minter_changes_open', ['contract'], { unique: true, where: `state in ('asked', 'pending')` })
@Index('minter_changes_hash', ['hash'], { unique: true, where: 'hash is not null' })
@Index('minter_changes_when', ['createdAt', 'id'])
@Entity('minter_changes')
export class MinterChange
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    /** The key the staff name the contract by (`looks`, `achievements`), never an address a client sent. */
    @Column({ type: 'varchar', length: 32 })
    contract!: string;

    @Column({ type: 'varchar', length: 8 })
    operation!: MinterOperation;

    /** The address of the key the NFT worker mints with, when the change was asked: lower case. */
    @Column({ type: 'varchar', length: 42 })
    minter!: string;

    /** The wallet that was to sign it: the owner's, lower case. */
    @Column({ type: 'varchar', length: 42 })
    signer!: string;

    @Column({ name: 'staff_id', type: 'uuid', nullable: true })
    staffId!: string | null;

    @Column({ name: 'staff_handle', type: 'text' })
    staffHandle!: string;

    @Column({ name: 'staff_role', type: 'varchar', length: 16 })
    staffRole!: StaffRole;

    @Column({ type: 'text' })
    reason!: string;

    /** The transaction the wallet reported, lower case, once it has. */
    @Column({ type: 'varchar', length: 66, nullable: true })
    hash!: string | null;

    @Column({ type: 'varchar', length: 16, default: 'asked' })
    state!: MinterState;

    /** Why a change failed: the contract's word for a refusal, `reverted`, `unchanged` or `dropped`. */
    @Column({ type: 'text', default: '' })
    failure!: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    /** When the hash was reported: a send with no receipt for too long is taken for lost from here. */
    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt!: Date;

    @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
    settledAt!: Date | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'staff_id', referencedColumnName: 'id' })
    staff!: User | null;
}
