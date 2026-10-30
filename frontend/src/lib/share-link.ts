/** A link to hand on, with the words that go with it in the reader's language. */
export interface Shared
{
    subject: string;
    text: string;
    url: string;
}

/** The apps a link is most often sent through, each opened with the words already written. */
export const shareTargets = ({ subject, text, url }: Shared) => ({
    whatsapp: `https://wa.me/?text=${ encodeURIComponent(`${ text } ${ url }`) }`,
    telegram: `https://t.me/share/url?url=${ encodeURIComponent(url) }&text=${ encodeURIComponent(text) }`,
    email: `mailto:?subject=${ encodeURIComponent(subject) }&body=${ encodeURIComponent(`${ text }\n\n${ url }`) }`
});

const dataOf = ({ subject, text, url }: Shared) => ({ title: subject, text, url });

/** Whether this browser has the system's own way to share, the sheet a phone draws. */
export const canShare = (shared: Shared) =>
    typeof navigator.share === 'function' && (typeof navigator.canShare !== 'function' || navigator.canShare(dataOf(shared)));

/** Hands the link to the system's own sheet: true once it went, or once the reader closed the sheet, which is no failure. */
export async function shareNatively(shared: Shared)
{
    try
    {
        await navigator.share(dataOf(shared));
        return true;
    }
    catch (error)
    {
        return error instanceof DOMException && error.name === 'AbortError';
    }
}
