const SENT_AS = ['photo', 'video', 'file'] as const;

type SentAs = (typeof SENT_AS)[number];

const isSentAs = (value: unknown): value is SentAs => SENT_AS.some((one) => one === value);

const fieldsOf = (value: unknown) =>
    (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null);

const documentOf = (document: string | null) =>
{
    try
    {
        return document === null ? null : fieldsOf(JSON.parse(document));
    }
    catch
    {
        return null;
    }
};

/**
 * A line as a group's staff are shown it in a report (MS-D45): its words, or what a voice message or a
 * file is, read from the document the reporter disclosed, which franking checked when it was filed.
 * Never the key a voice message or a file is opened with, nor a thumb: the group is shown what it is,
 * and nothing that opens it. A document this does not know is said as nothing.
 */
export function saidOf(document: string | null): { text?: string; voice?: number; file?: { name: string; as: SentAs } }
{
    const said = documentOf(document);

    if (said === null)
    {
        return {};
    }

    const words = typeof said.text === 'string' ? said.text : said.edit;

    if (typeof words === 'string')
    {
        return { text: words };
    }

    const voice = fieldsOf(said.voice);

    if (voice !== null && typeof voice.ms === 'number')
    {
        return { voice: Math.max(0, Math.round(voice.ms)) };
    }

    const file = fieldsOf(said.file);

    if (file !== null && typeof file.name === 'string' && isSentAs(file.as))
    {
        const caption = typeof said.caption === 'string' && said.caption.trim() !== '' ? { text: said.caption } : {};

        return { file: { name: file.name, as: file.as }, ...caption };
    }

    return {};
}
