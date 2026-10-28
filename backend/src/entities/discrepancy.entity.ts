import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity.ts';

import type { CheckFamily, CheckKind, CheckResolution } from '../domains/reconcile/kinds.ts';

/**
 * One disagreement between a money record here and what NuraChain holds for it, or a contract that
 * does not hold what it owes: found by the reconciliation pass, and kept for good once it ends.
 * `db` and `chain` are what each side said when it was last seen, in words the admin translates.
 */
@Check('discrepancies_family_known', `family in ('escrow', 'order', 'donation', 'market', 'position', 'contract')`)
@Check('discrepancies_kind_known', `kind in ('escrow-state', 'escrow-stakes', 'escrow-winners', 'order-state', 'order-sale', 'donation-state', 'donation-gift', 'market-state', 'market-winner', 'market-claimable', 'position-state', 'position-ticket', 'position-claim', 'solvency')`)
@Check('discrepancies_resolution_known', `resolution is null or resolution in ('agreed', 'put-right', 'staff')`)
@Check('discrepancies_resolved_whole', `(resolved_at is null) = (resolution is null)`)
@Check('discrepancies_staff_named', `coalesce(resolution = 'staff', false) = (staff_handle is not null)`)
@Check('discrepancies_staff_reason', `(staff_handle is null) = (reason is null)`)
@Check('discrepancies_reason_length', `reason is null or char_length(reason) between 3 and 500`)
@Check('discrepancies_seen_order', `last_seen >= first_seen and (resolved_at is null or resolved_at >= first_seen)`)
@Check('discrepancies_sides_objects', `jsonb_typeof(db) = 'object' and jsonb_typeof(chain) = 'object' and jsonb_typeof(about) = 'object'`)
@Index('discrepancies_open', ['family', 'record', 'kind'], { unique: true, where: 'resolved_at is null' })
@Index('discrepancies_of', ['family', 'record', 'kind', 'resolvedAt'])
@Index('discrepancies_when', ['firstSeen', 'id'])
@Entity('discrepancies')
export class Discrepancy
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'varchar', length: 16 })
    family!: CheckFamily;

    /** The record's id, or the contract's name for its books. */
    @Column({ type: 'varchar', length: 36 })
    record!: string;

    @Column({ type: 'varchar', length: 24 })
    kind!: CheckKind;

    @Column({ type: 'jsonb' })
    db!: Record<string, string>;

    @Column({ type: 'jsonb' })
    chain!: Record<string, string>;

    /** What the page says about the record: its game, its amount, the people in it, a transaction. */
    @Column({ type: 'jsonb' })
    about!: Record<string, string>;

    @Column({ name: 'first_seen', type: 'timestamptz', default: () => 'now()' })
    firstSeen!: Date;

    @Column({ name: 'last_seen', type: 'timestamptz', default: () => 'now()' })
    lastSeen!: Date;

    @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
    resolvedAt!: Date | null;

    @Column({ type: 'varchar', length: 16, nullable: true })
    resolution!: CheckResolution | null;

    @Column({ name: 'staff_id', type: 'uuid', nullable: true })
    staffId!: string | null;

    @Column({ name: 'staff_handle', type: 'text', nullable: true })
    staffHandle!: string | null;

    @Column({ type: 'text', nullable: true })
    reason!: string | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'staff_id', referencedColumnName: 'id' })
    staff!: User | null;
}
