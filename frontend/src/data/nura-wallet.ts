/**
 * Where to get Nura Wallet, platform by platform, exactly as nurachain.net lists them.
 *
 * Copied from the "Nura Wallet" part of https://nurachain.net rather than composed: a store link
 * guessed from a package name is a link that sends somebody to the wrong app. The APK and the
 * desktop installers are GitHub's `latest/download` links, so each points at the newest release
 * without this list changing. iOS and macOS are "coming soon" there, and are said so here.
 */
export interface NuraWalletLink
{
    id: string;

    /** A platform or store name, the same in every language. */
    platform: string;

    /** What the link fetches, when the platform alone does not say: an APK beside the store. */
    kind?: 'apk';

    url: string;
}

export const NURA_WALLET_LINKS: readonly NuraWalletLink[] = [
    { id: 'android', platform: 'Google Play', url: 'https://play.google.com/store/apps/details?id=wallet.nurachain.net' },
    { id: 'apk', platform: 'Android', kind: 'apk', url: 'https://github.com/NuraChain/Wallet/releases/latest/download/Nura-Wallet-Android-universal.apk' },
    { id: 'chrome', platform: 'Chrome', url: 'https://chromewebstore.google.com/detail/nura-wallet/bpcanahgbjafkgflkfbjejipmigakopg' },
    { id: 'windows', platform: 'Windows', url: 'https://github.com/NuraChain/Wallet/releases/latest/download/Nura-Wallet-Windows-x64-setup.exe' },
    { id: 'linux', platform: 'Linux', url: 'https://github.com/NuraChain/Wallet/releases/latest/download/Nura-Wallet-Linux-amd64.deb' }
];

/** Every build and architecture, for anybody whose platform is not one of the above. */
export const NURA_WALLET_RELEASES = 'https://github.com/NuraChain/Wallet/releases';

/** Listed on nurachain.net, without a link yet. */
export const NURA_WALLET_SOON: readonly string[] = ['iOS', 'macOS'];
