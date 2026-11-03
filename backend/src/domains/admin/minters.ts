import { HttpError } from '@azerothjs/http';
import { In, type DataSource } from 'typeorm';
import { encodeFunctionData, getAddress, isAddressEqual, type Address, type Hex } from 'viem';

import { NFT_ABI, type NftChain, type NftContract, type NftStanding, type NftTransaction } from '../../chain/minting.ts';
import { MinterChange } from '../../entities/index.ts';
import type { AdminMinters, AdminMinterAsked } from '../../schemas.ts';
import { wireCall } from '../stake/service.ts';
import { MINTER_CHANGES_PAGE, type MinterContractState, type MinterOperation } from './roles.ts';
import { record, staffRefusal, type Actor } from './staff.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UNIQUE_VIOLATION = '23505';

const off = () => staffRefusal('staff-minter-off', 'NFT minting is not set up on this server.');

const wrongChain = () => staffRefusal('staff-minter-chain', 'The node answers on another chain than this server is set to.');

const noCode = () => staffRefusal('staff-minter-code', 'There is no contract at that address.');

const noRoles = () => staffRefusal('staff-minter-roles', 'That contract does not answer to roles.');

const notAdmin = () => staffRefusal('staff-minter-admin', 'This wallet does not hold DEFAULT_ADMIN_ROLE on that contract.');

const alreadyHeld = () => staffRefusal('staff-minter-held', 'The minter already holds that role.');

const notHeld = () => staffRefusal('staff-minter-lacks', 'The minter does not hold that role.');

const busy = () => staffRefusal('staff-minter-busy', 'A change to that contract is already waiting for NuraChain.');

const notWaiting = () => staffRefusal('staff-minter-change', 'That change is not waiting for a transaction.');

const refusedBy = (word: string) => (word === 'AccessControlUnauthorizedAccount' ? notAdmin() : staffRefusal('staff-minter-refused', 'The contract would refuse that.'));

const clashed = (error: unknown) => (error as { driverError?: { code?: string } }).driverError?.code === UNIQUE_VIOLATION;

const unreachable = (error: unknown) => error instanceof HttpError && error.code === 'chain-unreachable';

/** What a courtesy is called with: a failure in it is logged and never reaches the page it was a courtesy to. */
type Courtesy = (what: string, run: () => Promise<void>) => Promise<void>;

/** Whoever asks, with the wallet the call is composed for and signed by. */
export type Signer = Actor & { address: Address | null };

interface Waiting
{
    id: string;
    contract: string;
    operation: MinterOperation;
    minter: string;
    signer: string;
    hash: string;

    /** Whether it was sent so long ago that no receipt means it was dropped, by the database's own clock. */
    lost: boolean;
}

type Verdict = { state: 'confirmed' | 'failed'; failure: string };

const stateOf = (standing: NftStanding, chainId: number): MinterContractState =>
{
    if (standing.node !== chainId)
    {
        return 'wrong-chain';
    }

    if (!standing.deployed)
    {
        return 'no-contract';
    }

    return standing.role === null ? 'no-roles' : 'ready';
};

/** Whether a transaction is the call a change asked of the signer's wallet, to the letter. */
const sameCall = (known: NftTransaction, row: Waiting, contract: NftContract, role: Hex) =>
    isAddressEqual(known.from, row.signer as Address)
    && known.to !== null
    && isAddressEqual(known.to, contract.address)
    && known.input.toLowerCase() === encodeFunctionData({
        abi: NFT_ABI,
        functionName: row.operation === 'grant' ? 'grantRole' : 'revokeRole',
        args: [role, getAddress(row.minter)]
    }).toLowerCase();

/**
 * Who may mint the NFTs, and the grant or revoke of that role the owner's wallet sends.
 *
 * The minter is the address of the key the NFT worker mints with, read off the worker's own chain, and
 * a contract is one the worker mints on and the staff name by its key: nothing a client sends is ever
 * a contract or a minter. The server composes the call and asks the contract whether it would take it
 * from the owner's wallet; the wallet signs it, and the page says which transaction it sent. A change
 * is settled when the receipt says it was mined and the role then reads as asked, and only then is it
 * written to the staff log, with its result.
 */
export function createMintersAdmin(db: DataSource, nft: NftChain, courtesy: Courtesy)
{
    const changes = () => db.getRepository(MinterChange);

    const wire = (row: MinterChange) => ({
        id: row.id,
        contract: row.contract,
        operation: row.operation,
        state: row.state,
        by: row.staffHandle,
        reason: row.reason,
        ...(row.hash === null ? {} : { hash: row.hash }),
        ...(row.failure === '' ? {} : { failure: row.failure }),
        at: row.createdAt.toISOString(),
        ...(row.settledAt === null ? {} : { settledAt: row.settledAt.toISOString() })
    });

    /** A call asked for and never sent is let go of after ten minutes, by the database's own clock. */
    const lapse = () => changes().createQueryBuilder().update()
        .set({ state: 'lapsed', settledAt: () => 'now()' })
        .where(`state = 'asked' and created_at < now() - interval '10 minutes'`)
        .execute();

    const waiting = () => changes().createQueryBuilder('m')
        .select('m.id', 'id')
        .addSelect('m.contract', 'contract')
        .addSelect('m.operation', 'operation')
        .addSelect('m.minter', 'minter')
        .addSelect('m.signer', 'signer')
        .addSelect('m.hash', 'hash')
        .addSelect(`m.updated_at < now() - interval '30 minutes'`, 'lost')
        .where(`m.state = 'pending'`)
        .orderBy('m.created_at', 'ASC')
        .limit(10)
        .getRawMany<Waiting>();

    const judged = async (row: Waiting): Promise<Verdict | null> =>
    {
        const mined = await nft.mined(row.hash as Hex);

        if (mined === 'pending')
        {
            return row.lost ? { state: 'failed', failure: 'dropped' } : null;
        }

        if (mined === 'reverted')
        {
            return { state: 'failed', failure: 'reverted' };
        }

        const contract = nft.contracts.find((one) => one.key === row.contract);

        if (contract === undefined || nft.minter === null || !isAddressEqual(nft.minter, row.minter as Address))
        {
            return { state: 'failed', failure: 'unknown' };
        }

        const [standing, known] = await Promise.all([nft.standing(contract, null), nft.transactionOf(row.hash as Hex)]);

        if (standing.role === null)
        {
            return { state: 'failed', failure: 'unknown' };
        }

        if (known === null || !sameCall(known, row, contract, standing.role))
        {
            return { state: 'failed', failure: 'foreign' };
        }

        return standing.minter === (row.operation === 'grant') ? { state: 'confirmed', failure: '' } : { state: 'failed', failure: 'unchanged' };
    };

    /** One change settled once: under its row's lock, so two pages reading at once write one row of the log. */
    const settle = async (row: Waiting) =>
    {
        const verdict = await judged(row);

        if (verdict === null)
        {
            return;
        }

        await db.transaction(async (tx) =>
        {
            const held = await tx.getRepository(MinterChange).findOne({ where: { id: row.id }, lock: { mode: 'pessimistic_write' } });

            if (held?.state !== 'pending')
            {
                return;
            }

            await tx.getRepository(MinterChange).update({ id: held.id }, { state: verdict.state, failure: verdict.failure, settledAt: () => 'now()' });
            await record(tx, { id: held.staffId, handle: held.staffHandle, role: held.staffRole }, {
                kind: held.operation === 'grant' ? 'minter-grant' : 'minter-revoke',
                reason: held.reason,
                details: {
                    contract: held.contract,
                    minter: held.minter,
                    signer: held.signer,
                    hash: held.hash ?? '',
                    result: verdict.state,
                    ...(verdict.failure === '' ? {} : { failure: verdict.failure })
                }
            });
        });
    };

    const settleAll = async () =>
    {
        for (const row of await waiting())
        {
            try
            {
                await settle(row);
            }
            catch (error)
            {
                if (!unreachable(error))
                {
                    throw error;
                }
            }
        }
    };

    const cardOf = async (contract: NftContract, wallet: Address | null, open: MinterChange | undefined) =>
    {
        let standing: NftStanding | null = null;

        try
        {
            standing = await nft.standing(contract, wallet);
        }
        catch (error)
        {
            if (!unreachable(error))
            {
                throw error;
            }
        }

        const state: MinterContractState = standing === null ? 'unreachable' : stateOf(standing, nft.chainId);

        return {
            key: contract.key,
            name: contract.name,
            address: contract.address,
            state,
            ...(state === 'wrong-chain' && standing !== null ? { node: standing.node } : {}),
            ...(standing?.role == null ? {} : { role: standing.role }),
            ...(state === 'ready' && standing !== null
                ? { minter: standing.minter, ...(standing.admin === null ? {} : { admin: standing.admin }) }
                : {}),
            ...(open === undefined ? {} : { open: wire(open) })
        };
    };

    /** The minter's role on every contract as NuraChain holds it, with the changes asked of it; pending ones are settled first. */
    const read = async (who: Pick<Signer, 'address'>): Promise<AdminMinters> =>
    {
        if (!nft.configured || nft.minter === null)
        {
            return { configured: false };
        }

        await lapse();
        await courtesy('minter settlement', settleAll);

        const [open, recent, latest] = await Promise.all([
            changes().find({ where: { state: In(['asked', 'pending']) } }),
            changes().find({ order: { createdAt: 'DESC', id: 'DESC' }, take: MINTER_CHANGES_PAGE }),
            changes().findOne({ where: { state: 'confirmed' }, order: { settledAt: 'DESC' } })
        ]);
        const contracts = await Promise.all(nft.contracts.map((contract) => cardOf(contract, who.address, open.find((one) => one.contract === contract.key))));

        return {
            configured: true,
            chainId: nft.chainId,
            minter: nft.minter,
            ...(who.address === null ? {} : { admin: who.address }),
            contracts,
            changes: recent.map(wire),
            ...(latest?.settledAt == null ? {} : { updatedAt: latest.settledAt.toISOString() })
        };
    };

    return {
        read,

        /**
         * A grant or a revoke asked of the owner's wallet, after everything that could make it pointless
         * has been read: the node is on the chain this server is set to, the contract is there and has
         * roles, the wallet holds `DEFAULT_ADMIN_ROLE`, and the minter does not already hold (or lack)
         * the role. `null` for a contract the worker does not mint on.
         */
        async ask(who: Signer, key: string, grant: boolean, reason: string): Promise<AdminMinterAsked | null>
        {
            if (!nft.configured || nft.minter === null)
            {
                throw off();
            }

            const contract = nft.contracts.find((one) => one.key === key);

            if (contract === undefined || who.address === null)
            {
                return null;
            }

            const standing = await nft.standing(contract, who.address);

            if (standing.node !== nft.chainId)
            {
                throw wrongChain();
            }

            if (!standing.deployed)
            {
                throw noCode();
            }

            if (standing.role === null)
            {
                throw noRoles();
            }

            if (standing.admin !== true)
            {
                throw notAdmin();
            }

            if (standing.minter === grant)
            {
                throw grant ? alreadyHeld() : notHeld();
            }

            const asked = await nft.roleCall(contract, who.address, grant);

            if (!asked.ok)
            {
                throw refusedBy(asked.refusal);
            }

            const minter = nft.minter;
            const address = who.address;

            const change = await db.transaction(async (tx) =>
            {
                const repo = tx.getRepository(MinterChange);

                await repo.createQueryBuilder().update().set({ state: 'lapsed', settledAt: () => 'now()' }).where(`contract = :key and state = 'asked'`, { key }).execute();

                if (await repo.existsBy({ contract: key, state: 'pending' }))
                {
                    throw busy();
                }

                try
                {
                    const made = await repo.insert({
                        contract: key,
                        operation: grant ? 'grant' : 'revoke',
                        minter: minter.toLowerCase(),
                        signer: address.toLowerCase(),
                        staffId: who.id,
                        staffHandle: who.handle,
                        staffRole: who.role,
                        reason
                    });

                    return made.identifiers[0].id as string;
                }
                catch (error)
                {
                    throw clashed(error) ? busy() : error;
                }
            });

            return { change, call: wireCall(address, asked.call) };
        },

        /**
         * The transaction the owner's wallet sent for a change it asked for, recorded and settled at once if
         * it is already mined. `null` for a change that is not there or not the asker's.
         */
        async sent(who: Signer, id: string, hash: string): Promise<AdminMinters | null>
        {
            if (!nft.configured)
            {
                throw off();
            }

            if (!UUID.test(id))
            {
                return null;
            }

            const row = await changes().findOneBy({ id });

            if (row === null || row.staffId !== who.id)
            {
                return null;
            }

            const lowered = hash.toLowerCase();

            if (!(row.state === 'pending' && row.hash === lowered))
            {
                if (row.state !== 'asked')
                {
                    throw notWaiting();
                }

                try
                {
                    const moved = await changes().createQueryBuilder().update().set({ state: 'pending', hash: lowered }).where(`id = :id and state = 'asked'`, { id }).execute();

                    if (moved.affected !== 1)
                    {
                        throw notWaiting();
                    }
                }
                catch (error)
                {
                    throw clashed(error) ? notWaiting() : error;
                }
            }

            return await read(who);
        }
    };
}
