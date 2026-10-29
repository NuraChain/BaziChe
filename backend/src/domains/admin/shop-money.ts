import type { HttpError } from '@azerothjs/http';
import type { DataSource } from 'typeorm';
import { getAddress, isAddress, type Address } from 'viem';

import { orderIdOf, type ShopAsked, type ShopChain } from '../../chain/shop.ts';
import { ShopOrder, User } from '../../entities/index.ts';
import type { AdminShopMoney } from '../../schemas.ts';
import { refundAsked } from '../shop/orders.ts';
import { weiOf } from '../stake/policy.ts';
import { wireCall } from '../stake/service.ts';
import { record, staffRefusal, type Actor } from './staff.ts';

/** The most of a sale an inviter may be credited, in basis points: the contract's own ceiling. */
export const MAX_SHARE_BPS = 3_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const off = () => staffRefusal('staff-shop-off', 'The shop is not open here.');

const unpaid = () => staffRefusal('staff-order-unpaid', 'Only a paid order can be refunded.');

const noShare = () => staffRefusal('staff-shop-share', 'The inviters’ share is from 0% to 30%.');

const noAddress = () => staffRefusal('staff-shop-address', 'That is not an address the shop can name.');

const noAmount = () => staffRefusal('staff-shop-amount', 'That is not an amount of NURA.');

const REFUSED: Partial<Record<string, () => HttpError>> = {
    AccessControlUnauthorizedAccount: () => staffRefusal('staff-shop-role', 'This wallet does not hold that role on the shop.'),
    EnforcedPause: () => staffRefusal('staff-shop-paused', 'The shop is already paused.'),
    ExpectedPause: () => staffRefusal('staff-shop-running', 'The shop is not paused.'),
    InsufficientRevenue: () => staffRefusal('staff-shop-revenue', 'The shop does not hold that much revenue.'),
    AlreadyRefunded: () => staffRefusal('staff-shop-refunded', 'NuraChain has refunded that order already.'),
    NotSold: unpaid,
    ReferralBpsOutOfRange: noShare,
    ZeroAddress: noAddress,
    ZeroAmount: noAmount
};

const refusedBy = (error: string) => (REFUSED[error] ?? (() => staffRefusal('staff-shop-refused', 'The shop would refuse that.')))();

/** What the staff see of the shop's money, and the calls only the owner's wallet sends, each asked of the contract first. */
export function createShopMoney(db: DataSource, shop: ShopChain)
{
    const answered = (owner: Address, asked: ShopAsked) =>
    {
        if (!asked.ok)
        {
            throw refusedBy(asked.refusal.error);
        }

        return wireCall(owner, asked.call);
    };

    const open = () =>
    {
        if (!shop.configured)
        {
            throw off();
        }
    };

    const paidOrders = () => db.getRepository(ShopOrder).createQueryBuilder('o').where(`o.state = 'paid'`);

    return {
        /** The shop's sales from the database: what paid orders not refunded came to over the last day, the week and in all, and how many delivered nothing. */
        async sales()
        {
            const row = await paidOrders()
                .select(`coalesce(sum(o.price) filter (where o.paid_at > now() - interval '1 day'), 0)::text`, 'day')
                .addSelect(`coalesce(sum(o.price) filter (where o.paid_at > now() - interval '7 days'), 0)::text`, 'week')
                .addSelect('coalesce(sum(o.price), 0)::text', 'all')
                .addSelect('(count(*) filter (where o.delivered = false))::int', 'undelivered')
                .getRawOne<{ day: string; week: string; all: string; undelivered: number }>();

            return { day: row?.day ?? '0', week: row?.week ?? '0', all: row?.all ?? '0', undelivered: row?.undelivered ?? 0 };
        },

        /** The contract's books and roles as the reader's wallet holds them, beside what the database says waits for a person. */
        async standing(reader: Address): Promise<AdminShopMoney>
        {
            if (!shop.configured || shop.address === null || shop.seller === null)
            {
                return { configured: false };
            }

            const [ledger, waiting] = await Promise.all([
                shop.ledger(reader),
                paidOrders()
                    .select('(count(*) filter (where o.delivered = false))::int', 'undelivered')
                    .addSelect(
                        `(count(*) filter (where ${ refundAsked('o.id') }))::int`,
                        'refunding'
                    )
                    .getRawOne<{ undelivered: number; refunding: number }>()
            ]);

            return {
                configured: true,
                shop: shop.address,
                chainId: shop.chainId,
                revenue: ledger.revenue.toString(),
                owed: ledger.owed.toString(),
                held: ledger.held.toString(),
                solvent: ledger.solvent,
                share: ledger.referralBps,
                maxShare: MAX_SHARE_BPS,
                paused: ledger.paused,
                seller: { address: shop.seller, allowed: ledger.sellerAllowed, named: ledger.chainSeller },
                roles: { owner: ledger.ownerAllowed, pauser: ledger.pauserAllowed },
                undelivered: waiting?.undelivered ?? 0,
                refunding: waiting?.refunding ?? 0
            };
        },

        /** Revenue taken out to the owner's own wallet. */
        async withdraw(owner: Address, amount: string)
        {
            open();

            const wei = weiOf(amount);

            if (wei === null)
            {
                throw noAmount();
            }

            return answered(owner, await shop.withdrawCall(owner, owner, wei));
        },

        async share(owner: Address, bps: number)
        {
            open();

            if (!Number.isInteger(bps) || bps < 0 || bps > MAX_SHARE_BPS)
            {
                throw noShare();
            }

            return answered(owner, await shop.shareCall(owner, bps));
        },

        async seller(owner: Address, address: string)
        {
            open();

            if (!isAddress(address) || BigInt(address) === 0n)
            {
                throw noAddress();
            }

            return answered(owner, await shop.sellerCall(owner, getAddress(address)));
        },

        async pause(owner: Address, paused: boolean)
        {
            open();

            return answered(owner, await shop.pauseCall(owner, paused));
        },

        /**
         * A paid order's price asked back of NuraChain for its payer, written as `shop-refund` once the
         * contract has said it would: the request it is. `null` for an order that is not there.
         */
        async refund(actor: Actor, owner: Address, order: string, reason: string)
        {
            open();

            if (!UUID.test(order))
            {
                return null;
            }

            const held = await db.getRepository(ShopOrder).findOneBy({ id: order });

            if (held === null)
            {
                return null;
            }

            if (held.state !== 'paid')
            {
                throw unpaid();
            }

            const call = answered(owner, await shop.refundCall(owner, orderIdOf(held.id)));

            await db.transaction(async (tx) =>
            {
                const now = await tx.getRepository(ShopOrder).findOne({ where: { id: order }, lock: { mode: 'pessimistic_write' } });

                if (now?.state !== 'paid')
                {
                    throw unpaid();
                }

                const buyer = await tx.getRepository(User).findOneByOrFail({ id: now.buyerId });

                await record(tx, actor, { kind: 'shop-refund', person: { id: buyer.id, handle: buyer.handle }, reason, details: { order: now.id, item: now.itemId, price: now.price } });
            });

            return call;
        }
    };
}
