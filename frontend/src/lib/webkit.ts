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
