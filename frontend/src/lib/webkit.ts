/**
 * Whether this browser is WebKit's own: Safari, and every browser on an iPhone or an iPad, which all
 * are. WebKit grants the microphone and starts audio only inside a press, and sends a call the
 * page's prepared voice as silence, so voice is handled for it apart (`voice.store.ts`,
 * `primed-voice.ts`).
 */
export function isWebKit()
{
    const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    const touchMac = agent.includes('Macintosh') && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;

    return /iPhone|iPad|iPod/.test(agent) || touchMac || (/AppleWebKit.*Safari\//.test(agent) && !/Chrome|Chromium|Edg|OPR|Android/.test(agent));
}

/**
 * Whether this is an iPhone or an iPad, where a site may notify only once it is added to the Home
 * Screen and opened from there (iOS 16.4 and later): in a Safari tab there is no `Notification` at all.
 */
export function isAppleMobile()
{
    const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;

    return /iPhone|iPad|iPod/.test(agent) || (agent.includes('Macintosh') && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
}
