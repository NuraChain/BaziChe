import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { NftCollection, NftState } from '../domains/nft/rules.ts';
import { User } from './user.entity.ts';

/**
 * One token on NuraChain that mirrors something a person owns here, or is owed to: a look in
 * `ArcadeLooks`, a legendary achievement in `ArcadeAchievements`.
 *
 * A table of its own rather than a column on `owned_items`, because a refund deletes the owned row
 * and the token it was minted as still has to be burned: the record that a token exists must
 * outlive the thing it mirrored. So the account's key sets null rather than cascading, and the
 * wallet it was minted into is kept here, since a burn goes to that address whatever the owner has
 * linked since.
 *
 * The worker reconciles it (`domains/nft/service.ts`): owned with no live row, a row is written
 * `minting`; minted with nothing owned, it turns `burning`. One live row per owner and key, by the
 * partial unique index.
 */
@Check('nft_tokens_collection_known', `collection in ('look', 'achievement')`)
@Check('nft_tokens_state_known', `state in ('minting', 'minted', 'burning', 'burned', 'failed')`)
@Check('nft_tokens_token_id_shape', `token_id ~ '^0x[0-9a-f]{64}$'`)
@Check('nft_tokens_address_shape', `address ~ '^0x[0-9a-f]{40}$'`)
@Check('nft_tokens_hash_shape', `hash is null or hash ~ '^0x[0-9a-f]{64}$'`)
@Check('nft_tokens_attempts_counted', `attempts >= 0`)
@Check('nft_tokens_achievement_kept', `collection = 'look' or state not in ('burning', 'burned')`)
@Index('nft_tokens_live', ['collection', 'userId', 'key'], { unique: true, where: `state <> 'burned'` })
@Index('nft_tokens_owed', ['updatedAt'], { where: `state in ('minting', 'burning')` })
@Entity('nft_tokens')
export class NftToken
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'varchar', length: 16 })
    collection!: NftCollection;

    /** Whose it is, or null once their account is gone and a look's token is still owed a burn. */
    @Column({ name: 'user_id', type: 'uuid', nullable: true })
    userId!: string | null;

    /** A look's item id (`dice.shiraz`) or an achievement's id (`ludo-won-97`). */
    @Column({ type: 'varchar', length: 64 })
    key!: string;

    /** `keccak256(key)`, as both contracts derive the token's id. */
    @Column({ name: 'token_id', type: 'varchar', length: 66 })
    tokenId!: string;

    /** The wallet it was minted into, lower case. */
    @Column({ type: 'varchar', length: 42 })
    address!: string;

    @Column({ type: 'varchar', length: 16, default: 'minting' })
    state!: NftState;

    /** The last transaction sent for it, while one is waited on, and after for the explorer link. */
    @Column({ type: 'varchar', length: 66, nullable: true })
    hash!: string | null;

    @Column({ type: 'int', default: 0 })
    attempts!: number;

    /** What the chain said the last time it refused, for the staff. */
    @Column({ type: 'text', nullable: true })
    failure!: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt!: Date;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User | null;
}
