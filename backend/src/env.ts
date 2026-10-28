import { loadConfig, num, oneOf, str, type ConfigVar } from '@azerothjs/http';

/**
 * A feature's key: the name must be written, and written empty it turns the feature off. The
 * framework reads an empty value as an absent one, so the empty string here is what lets `NAME=`
 * through; that the name is written at all is asked by `unwritten`.
 */
const optional = (name: string, options: { secret?: boolean } = {}): ConfigVar<string> =>
    ({ name, parse: (raw) => raw, defaultValue: '', ...(options.secret === true ? { secret: true } : {}) });

const unwritten = (shape: Record<string, ConfigVar<unknown>>) =>
    Object.values(shape)
        .filter((variable) => variable.defaultValue === '' && process.env[variable.name] === undefined)
        .map((variable) => `  - ${ variable.name } is required and missing (write it empty to leave its feature off)`);

export const SECRET_LEAST = 32;

const MODES = ['development', 'production', 'test'] as const;

const THIS_MACHINE = new Set(['localhost', '127.0.0.1', '[::1]']);

const originOf = (text: string) =>
{
    try
    {
        return new URL(text);
    }
    catch
    {
        return null;
    }
};

const REGION = /^[A-Z]{2}$/;

const HEADER = /^[A-Za-z0-9-]+$/;

/** The countries markets are offered in, as written in `MARKET_REGIONS`: two-letter codes, in capitals. */
export const regionsIn = (text: string) => text.split(',').map((one) => one.trim().toUpperCase()).filter((one) => one !== '');

/**
 * What is wrong with how markets are configured, in any mode: the contract, the countries and the
 * header the country is read from go together, or none of them is written; a country is its ISO
 * 3166 two-letter code, and a header a name a request can carry.
 */
export function marketsRefused(address: string, regions: string, header: string)
{
    const written = [address, regions, header].filter((value) => value !== '').length;

    if (written === 0)
    {
        return [];
    }

    if (written < 3)
    {
        return ['NURA_MARKETS_ADDRESS, MARKET_REGIONS and MARKET_COUNTRY_HEADER go together: write all three, or all three empty to leave markets off.'];
    }

    const codes = regionsIn(regions);
    const odd = codes.filter((code) => !REGION.test(code));

    return [
        ...(codes.length === 0 || odd.length > 0 ? [`MARKET_REGIONS takes ISO 3166 two-letter codes separated by commas${ odd.length > 0 ? `, and ${ odd.join(', ') } is not one` : '' }.`] : []),
        ...(HEADER.test(header) ? [] : ['MARKET_COUNTRY_HEADER has to be the name of a header, such as CF-IPCountry.'])
    ];
}

/** What is wrong with the metrics token, in any mode: written, it is at least as long as a session secret, because it is one. */
export const metricsRefused = (token: string) =>
    (token === '' || token.length >= SECRET_LEAST
        ? []
        : [`METRICS_TOKEN is ${ token.length } characters long, and needs at least ${ SECRET_LEAST }, such as the output of 'openssl rand -hex 32', or written empty to leave /api/metrics off.`]);

export function unsafeForProduction(secret: string, origin: string)
{
    const refused: string[] = [];
    const parsed = originOf(origin);

    if (secret.length < SECRET_LEAST)
    {
        refused.push(`SESSION_SECRET is ${ secret.length } characters long, and production needs at least ${ SECRET_LEAST }, such as the output of 'openssl rand -hex 32'.`);
    }

    if (parsed === null || parsed.origin !== origin)
    {
        refused.push('PUBLIC_ORIGIN has to be an origin and nothing more, such as https://play.example.com, with no path and no slash at the end.');
    }
    else if (parsed.protocol !== 'https:' && !THIS_MACHINE.has(parsed.hostname))
    {
        refused.push('PUBLIC_ORIGIN has to be https in production: over http the session cookie cannot be marked Secure.');
    }

    return refused;
}

/**
 * What this process is configured with: every name in `.env.example`, each written, none with a
 * value in the code. A feature's keys may be written empty, which turns the feature off. The mode
 * is the command's: `azeroth dev` says development, vitest says test, and anything else is
 * production. What differs between development and production follows from it.
 */
export function loadServerConfig()
{
    const env = loadConfig({ env: oneOf('NODE_ENV', MODES, { default: 'production' }) }).env;

    const shape = {
            /**
             * The address the server binds. A server on the machine nginx runs on listens on
             * 127.0.0.1, so nothing reaches it past the proxy; a container's 127.0.0.1 is its own,
             * so the image binds 0.0.0.0 and the port is published to the proxy alone.
             */
            host: str('HOST'),
            port: num('PORT'),

            databaseUrl: str('DATABASE_URL', { secret: true }),
            databasePoolMax: num('DATABASE_POOL_MAX'),

            /**
             * Signs session cookies and realtime tickets. `serializeCookie` has no `signed` option
             * and the framework ships no keyring, so this is ours to hold. A deployment that does
             * not set it must fail to boot: a default would be a published secret.
             */
            secret: str('SESSION_SECRET', { secret: true }),

            /**
             * The origin the browser actually uses. It is the SIWE `domain`/`URI`, the WebSocket
             * origin check and the cookie's site. It is NOT derived from a request header - a
             * header is attacker-controlled and this value decides what a signature means.
             */
            origin: str('PUBLIC_ORIGIN'),

            /** The chain, DECIMAL EIP-155: what a wallet row records and what a contract wallet is checked on. */
            chainId: optional('NURA_CHAIN_ID'),

            /**
             * A JSON-RPC url, for the ERC-1271 call that verifies a smart-contract wallet. Without
             * one, only key-holding wallets can sign in - which is most of them, but not a Safe.
             */
            rpcUrl: optional('NURA_RPC_URL'),

            profileRegistry: optional('NURA_PROFILE_ADDRESS'),
            profileLens: optional('NURA_PROFILE_LENS_ADDRESS'),

            vaultAddress: optional('NURA_VAULT_ADDRESS'),
            refereeKey: optional('NURA_REFEREE_KEY', { secret: true }),

            /** `ArcadeShop`, where looks are paid for; its seller is the key above. */
            shopAddress: optional('NURA_SHOP_ADDRESS'),

            /** `ArcadeTips`, through which a watcher gives NURA to a player; no key of this server's is needed. */
            tipsAddress: optional('NURA_TIPS_ADDRESS'),

            /** `ArcadeMarkets`, where positions on games are held; its operator is the key above. */
            marketsAddress: optional('NURA_MARKETS_ADDRESS'),

            /**
             * Where markets may be offered, from legal advice and nowhere else, and the header the
             * proxy writes a reader's country into. Markets are never on for a country nobody named.
             */
            marketRegions: optional('MARKET_REGIONS'),
            marketCountryHeader: optional('MARKET_COUNTRY_HEADER'),

            /** The explorer's Etherscan-compatible api, where a wallet's NFT transfers are read. */
            explorerApi: optional('NURA_EXPLORER_API'),

            adminWallet: optional('ADMIN_WALLET_ADDRESS'),

            /**
             * Requests per minute per address, for `/api` and `/ws`.
             *
             * A number rather than a constant because the responsive matrix pulls six hundred pages
             * as fast as it can from ONE address - that is abusive traffic by any honest measure, and
             * the limiter is right to refuse it. A load run raises this deliberately instead of the
             * product shipping a limit shaped around a test.
             */
            apiRateMax: num('API_RATE_MAX'),

            /**
             * Web Push, all three optional and all three needed together.
             *
             * With none set the product has no push and says so: `GET /notifications/push` answers
             * with no key, the client subscribes to nothing and tells the reader that this device
             * hears only while a tab is open, and nothing is silently dropped. A push from here
             * carries NO payload, so there is no content key to hold.
             */
            vapidPublicKey: optional('VAPID_PUBLIC_KEY'),
            vapidPrivateKey: optional('VAPID_PRIVATE_KEY', { secret: true }),
            vapidSubject: optional('VAPID_SUBJECT'),

            /**
             * The bearer token a monitor outside sends for `GET /api/metrics`. Written empty, the
             * endpoint is off, and nobody can tell it from an address nothing is served at.
             */
            metricsToken: optional('METRICS_TOKEN', { secret: true })
    };

    const missing = unwritten(shape);
    let config;

    try
    {
        config = loadConfig(shape);
    }
    catch (error)
    {
        const said = [error instanceof Error ? error.message : String(error), ...missing].join('\n');

        throw new Error(`${ said }\nSet them in the root .env: .env.example says what each one is.`, { cause: error });
    }

    if (missing.length > 0)
    {
        throw new Error(`Configuration is invalid:\n${ missing.join('\n') }\nSet them in the root .env: .env.example says what each one is.`);
    }

    const invalid = [...marketsRefused(config.marketsAddress, config.marketRegions, config.marketCountryHeader), ...metricsRefused(config.metricsToken)];

    if (invalid.length > 0)
    {
        throw new Error(`Configuration is invalid: ${ invalid.join(' ') }`);
    }

    if (env === 'production')
    {
        const refused = unsafeForProduction(config.secret, config.origin);

        if (refused.length > 0)
        {
            throw new Error(`The root .env is not safe to run in production. ${ refused.join(' ') }`);
        }
    }

    return Object.assign(config, { env, servePages: env === 'production', databaseSync: env === 'development', marketCountries: regionsIn(config.marketRegions) });
}

export type ServerConfig = ReturnType<typeof loadServerConfig>;
