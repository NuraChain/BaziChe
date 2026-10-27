import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { OwnedItem } from './owned-item.entity.ts';

/**
 * The look somebody chose for one slot. No row is Classic. The look must be theirs (a key to
 * `owned_items`, so taking it back takes it off), and of the kind the slot takes: every slot is
 * `<place>.<kind>` and every look `<kind>.<collection>`.
 */
@Check('equipped_items_slot_known', `slot in ('profile.decoration', 'profile.effect', 'profile.theme', 'profile.nameplate', 'ludo.dice', 'ludo.pawns', 'ludo.yard', 'hokm.back', 'hokm.face', 'hokm.felt', 'poker.back', 'poker.face', 'poker.felt', 'poker.chips', 'backgammon.dice', 'backgammon.checkers', 'backgammon.home', 'chess.pieces', 'table.celebration')`)
@Check('equipped_items_fits', `split_part(slot, '.', 2) = split_part(item_id, '.', 1)`)
@Entity('equipped_items')
export class EquippedItem
{
    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @PrimaryColumn({ type: 'varchar', length: 32 })
    slot!: string;

    @Column({ name: 'item_id', type: 'varchar', length: 40 })
    itemId!: string;

    @ManyToOne(() => OwnedItem, { onDelete: 'CASCADE' })
    @JoinColumn([
        { name: 'user_id', referencedColumnName: 'userId' },
        { name: 'item_id', referencedColumnName: 'itemId' }
    ])
    owned!: OwnedItem;
}
