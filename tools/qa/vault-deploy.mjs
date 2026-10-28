import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';

export const VAULT_ADMIN_KEY = '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97';
export const VAULT_REFEREE_KEY = '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6';

export const VAULT_FEE = 500;
export const VAULT_REFERRAL_SHARE = 2000;
export const VAULT_MAX_STAKE = parseEther('1000');
export const VAULT_RECLAIM_AFTER = 3n * 24n * 3600n;

export const SHOP_REFERRAL_BPS = 1000;

export const vaultArtifact = (root = process.env.QA_CONTRACTS ?? '../SmartContract/artifacts/contracts/baziche') =>
    JSON.parse(readFileSync(`${ root }/ArcadeVault.sol/ArcadeVault.json`, 'utf8'));

export const shopArtifact = (root = process.env.QA_CONTRACTS ?? '../SmartContract/artifacts/contracts/baziche') =>
    JSON.parse(readFileSync(`${ root }/ArcadeShop.sol/ArcadeShop.json`, 'utf8'));

export const tipsArtifact = (root = process.env.QA_CONTRACTS ?? '../SmartContract/artifacts/contracts/baziche') =>
    JSON.parse(readFileSync(`${ root }/ArcadeTips.sol/ArcadeTips.json`, 'utf8'));

export async function deployVault(rpc = process.env.QA_RPC ?? 'http://127.0.0.1:8645', root = undefined)
{
    const { abi, bytecode } = vaultArtifact(root);
    const admin = privateKeyToAccount(VAULT_ADMIN_KEY);
    const referee = privateKeyToAccount(VAULT_REFEREE_KEY);
    const chain = { ...hardhat, rpcUrls: { default: { http: [rpc] } } };
    const wallet = createWalletClient({ account: admin, chain, transport: http(rpc) });
    const reader = createPublicClient({ chain, transport: http(rpc) });

    const hash = await wallet.deployContract({
        abi,
        bytecode,
        args: [admin.address, referee.address, VAULT_FEE, VAULT_REFERRAL_SHARE, VAULT_MAX_STAKE, VAULT_RECLAIM_AFTER]
    });
    const receipt = await reader.waitForTransactionReceipt({ hash });

    return {
        vault: receipt.contractAddress,
        admin: admin.address,
        referee: referee.address,
        refereeKey: VAULT_REFEREE_KEY,
        chainId: await reader.getChainId()
    };
}

/** `ArcadeShop`, its admin the vault's and its seller the vault's referee: the server signs both with one key. */
export async function deployShop(rpc = process.env.QA_RPC ?? 'http://127.0.0.1:8645', root = undefined)
{
    const { abi, bytecode } = shopArtifact(root);
    const admin = privateKeyToAccount(VAULT_ADMIN_KEY);
    const seller = privateKeyToAccount(VAULT_REFEREE_KEY);
    const chain = { ...hardhat, rpcUrls: { default: { http: [rpc] } } };
    const wallet = createWalletClient({ account: admin, chain, transport: http(rpc) });
    const reader = createPublicClient({ chain, transport: http(rpc) });
    const hash = await wallet.deployContract({ abi, bytecode, args: [admin.address, seller.address, SHOP_REFERRAL_BPS] });
    const receipt = await reader.waitForTransactionReceipt({ hash });

    return { shop: receipt.contractAddress, seller: seller.address };
}

/** `ArcadeTips`, its admin the vault's: a gift goes from whoever gives it to the player, so nothing signs for it. */
export async function deployTips(rpc = process.env.QA_RPC ?? 'http://127.0.0.1:8645', root = undefined)
{
    const { abi, bytecode } = tipsArtifact(root);
    const admin = privateKeyToAccount(VAULT_ADMIN_KEY);
    const chain = { ...hardhat, rpcUrls: { default: { http: [rpc] } } };
    const wallet = createWalletClient({ account: admin, chain, transport: http(rpc) });
    const reader = createPublicClient({ chain, transport: http(rpc) });
    const hash = await wallet.deployContract({ abi, bytecode, args: [admin.address] });
    const receipt = await reader.waitForTransactionReceipt({ hash });

    return { tips: receipt.contractAddress };
}

if (import.meta.url === `file:///${ process.argv[1].replaceAll('\\', '/') }` || import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/')))
{
    console.log(JSON.stringify({ ...await deployVault(), ...await deployShop(), ...await deployTips() }));
}
