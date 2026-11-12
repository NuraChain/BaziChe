/** What a file that may go is. */
export type FileKind = 'document' | 'text' | 'picture' | 'audio' | 'video';

/** Why a file may not go: a box nobody here can look inside, something that runs, something that renders a page, an Office file that carries code, or bytes that are none of what may go. */
export type FileRefusal = 'archive' | 'program' | 'page' | 'macro' | 'other';

export type FileVerdict = { goes: true; kind: FileKind } | { goes: false; why: FileRefusal };

/** Names a computer runs, installs, mounts or opens as a page whatever is in them: the extension decides, on the disk it is saved to. */
const NAMED: Readonly<Record<string, FileRefusal>> = Object.fromEntries([
    ...[
        'exe', 'com', 'scr', 'pif', 'cpl', 'msi', 'msp', 'mst', 'msix', 'msixbundle', 'appx', 'appxbundle', 'appinstaller',
        'application', 'appref-ms', 'gadget', 'dll', 'sys', 'drv', 'ocx', 'efi', 'bat', 'cmd', 'ps1', 'ps1xml', 'ps2',
        'ps2xml', 'psc1', 'psc2', 'psm1', 'psd1', 'vbs', 'vbe', 'vb', 'js', 'jse', 'mjs', 'cjs', 'wsf', 'wsh', 'wsc', 'ws',
        'sct', 'lnk', 'url', 'website', 'scf', 'reg', 'inf', 'ins', 'isp', 'msc', 'jar', 'jnlp', 'class', 'apk', 'xapk',
        'apks', 'aab', 'ipa', 'app', 'pkg', 'mpkg', 'deb', 'rpm', 'run', 'bin', 'sh', 'bash', 'zsh', 'csh', 'ksh', 'fish',
        'command', 'tool', 'workflow', 'action', 'scpt', 'applescript', 'osax', 'desktop', 'appimage', 'snap', 'flatpak',
        'py', 'pyw', 'pyc', 'pyo', 'pyz', 'pl', 'rb', 'php', 'lua', 'tcl', 'ps', 'xll', 'wll', 'slk', 'iqy', 'dqy', 'oqy',
        'rqy', 'library-ms', 'searchconnector-ms', 'settingcontent-ms', 'diagcab', 'chm', 'hlp', 'xpi', 'crx', 'vsix',
        'iso', 'img', 'dmg', 'vhd', 'vhdx', 'vmdk', 'ova'
    ].map((extension) => [ extension, 'program' ] as const),
    ...[ 'htm', 'html', 'xhtml', 'xht', 'shtml', 'mht', 'mhtml', 'hta', 'svg', 'svgz', 'xml', 'xsl', 'xslt', 'eml', 'swf' ].map((extension) => [ extension, 'page' ] as const),
    ...[ 'docm', 'dotm', 'xlsm', 'xltm', 'xlsb', 'xlam', 'xla', 'pptm', 'potm', 'ppam', 'ppsm', 'sldm' ].map((extension) => [ extension, 'macro' ] as const),
    ...[
        'zip', 'zipx', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'tbz', 'tbz2', 'xz', 'txz', 'zst', 'lz', 'lzma', 'lz4', 'z',
        'cab', 'arj', 'lzh', 'lha', 'ace', 'cpio', 'xar', 'wim', 'swm', 'epub'
    ].map((extension) => [ extension, 'archive' ] as const)
]);

const at = (bytes: Uint8Array, offset: number, ...values: readonly number[]) => values.every((value, index) => bytes[offset + index] === value);

const text = (bytes: Uint8Array, offset: number, words: string) => at(bytes, offset, ...[...words].map((letter) => letter.charCodeAt(0)));

const u16 = (bytes: Uint8Array, offset: number) => bytes[offset] | (bytes[offset + 1] << 8);

const u32 = (bytes: Uint8Array, offset: number) => (u16(bytes, offset) | (u16(bytes, offset + 2) << 16)) >>> 0;

/** The names of a ZIP's entries from its central directory, or null where it cannot be read. */
function entriesOf(bytes: Uint8Array): string[] | null
{
    const latest = Math.max(0, bytes.length - 65_557);

    for (let end = bytes.length - 22; end >= latest; end -= 1)
    {
        if (!at(bytes, end, 0x50, 0x4b, 0x05, 0x06))
        {
            continue;
        }

        const count = u16(bytes, end + 10);
        const names: string[] = [];
        let place = u32(bytes, end + 16);

        for (let entry = 0; entry < count; entry += 1)
        {
            if (place + 46 > bytes.length || !at(bytes, place, 0x50, 0x4b, 0x01, 0x02))
            {
                return null;
            }

            const length = u16(bytes, place + 28);

            names.push(new TextDecoder().decode(bytes.subarray(place + 46, place + 46 + length)));
            place += 46 + length + u16(bytes, place + 30) + u16(bytes, place + 32);
        }

        return names;
    }

    return null;
}

/** An Office document, an OpenDocument or anything else inside a ZIP, which is a box. */
function zipped(bytes: Uint8Array): FileVerdict
{
    const names = entriesOf(bytes);

    if (names === null)
    {
        return { goes: false, why: 'archive' };
    }

    const office = names.includes('[Content_Types].xml') && names.some((name) => /^(word|xl|ppt)\//.test(name));
    const open = text(bytes, 30, 'mimetype') && text(bytes, 30 + 8 + u16(bytes, 28), 'application/vnd.oasis.opendocument.');

    if (office)
    {
        return names.some((name) => /vbaProject|^xl\/macrosheets\/|activeX\//i.test(name)) ? { goes: false, why: 'macro' } : { goes: true, kind: 'document' };
    }

    if (open)
    {
        return names.some((name) => /^(Basic|Scripts)\//.test(name)) ? { goes: false, why: 'macro' } : { goes: true, kind: 'document' };
    }

    return { goes: false, why: 'archive' };
}

/** Whether these bytes hold a name in UTF-16, as the directory of a compound file keeps its streams' names. */
const holdsWide = (bytes: Uint8Array, name: string) =>
{
    const wide = [...name].flatMap((letter) => [ letter.charCodeAt(0), 0 ]);

    for (let place = 0; place + wide.length <= bytes.length; place += 1)
    {
        if (at(bytes, place, ...wide))
        {
            return true;
        }
    }

    return false;
};

/** A compound file: an older Word, Excel or PowerPoint file under its own name and with no macros, and anything else (an installer, a mail) a box. */
const compound = (bytes: Uint8Array, extension: string): FileVerdict =>
{
    if (holdsWide(bytes, '_VBA_PROJECT') || holdsWide(bytes, 'Macros'))
    {
        return { goes: false, why: 'macro' };
    }

    return [ 'doc', 'xls', 'ppt' ].includes(extension) ? { goes: true, kind: 'document' } : { goes: false, why: 'other' };
};

/** The words of a file that is text, or null for one that is not: the first 64 KiB as UTF-8, or UTF-16 after its mark, with no control letter a text has no use for. */
function wordsOf(bytes: Uint8Array): string | null
{
    const start = bytes.subarray(0, 65_536);
    const encoding = at(start, 0, 0xff, 0xfe) ? 'utf-16le' : (at(start, 0, 0xfe, 0xff) ? 'utf-16be' : 'utf-8');

    try
    {
        const words = new TextDecoder(encoding, { fatal: true }).decode(start, { stream: true });

        return /[\u0000-\u0008\u000e-\u001a\u001c-\u001f\u007f]/.test(words) ? null : words;
    }
    catch
    {
        return null;
    }
}

/** What a picture, a sound or a video is from its first bytes, or null for none of them. */
function mediaOf(bytes: Uint8Array): FileKind | null
{
    if (at(bytes, 0, 0xff, 0xd8, 0xff) || at(bytes, 0, 0x89, 0x50, 0x4e, 0x47) || text(bytes, 0, 'GIF8') || text(bytes, 0, 'BM')
        || at(bytes, 0, 0x49, 0x49, 0x2a, 0x00) || at(bytes, 0, 0x4d, 0x4d, 0x00, 0x2a) || text(bytes, 0, '8BPS') || at(bytes, 0, 0x00, 0x00, 0x01, 0x00)
        || (text(bytes, 0, 'RIFF') && text(bytes, 8, 'WEBP')))
    {
        return 'picture';
    }

    if (text(bytes, 4, 'ftyp'))
    {
        const brand = String.fromCharCode(...bytes.subarray(8, 12));

        if (/^(hei|hev|mif|msf|avi[fs])/.test(brand))
        {
            return 'picture';
        }

        return /^M4[AB]/.test(brand) ? 'audio' : 'video';
    }

    // A frame of MPEG audio, Layer II or III or AAC's: Layer I is left out, because its first two bytes are UTF-16's mark.
    if (text(bytes, 0, 'ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0x06) || text(bytes, 0, 'OggS') || text(bytes, 0, 'fLaC')
        || (text(bytes, 0, 'RIFF') && text(bytes, 8, 'WAVE')) || (text(bytes, 0, 'FORM') && text(bytes, 8, 'AIF')) || text(bytes, 0, '#!AMR')
        || text(bytes, 0, 'MThd'))
    {
        return 'audio';
    }

    if (at(bytes, 0, 0x1a, 0x45, 0xdf, 0xa3) || (text(bytes, 0, 'RIFF') && text(bytes, 8, 'AVI ')) || text(bytes, 0, 'FLV')
        || at(bytes, 0, 0x00, 0x00, 0x01, 0xba) || at(bytes, 0, 0x30, 0x26, 0xb2, 0x75) || (bytes[0] === 0x47 && bytes[188] === 0x47))
    {
        return 'video';
    }

    return null;
}

/** Something that runs, read from its first bytes: a program for Windows, Linux or a Mac, Java or Android code, WebAssembly or a shortcut. */
const runs = (bytes: Uint8Array) => text(bytes, 0, 'MZ') || at(bytes, 0, 0x7f, 0x45, 0x4c, 0x46) || at(bytes, 0, 0xfe, 0xed, 0xfa) || at(bytes, 1, 0xfa, 0xed, 0xfe)
    || at(bytes, 0, 0xca, 0xfe, 0xba, 0xbe) || text(bytes, 0, 'dex\n') || at(bytes, 0, 0x00, 0x61, 0x73, 0x6d) || at(bytes, 0, 0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00);

/** A box other than a ZIP, read from its bytes: RAR, 7-Zip, the compressions, tar, a cabinet, an ar package, a disk image. */
const boxed = (bytes: Uint8Array) => text(bytes, 0, 'Rar!') || at(bytes, 0, 0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c) || at(bytes, 0, 0x1f, 0x8b)
    || text(bytes, 0, 'BZh') || at(bytes, 0, 0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00) || at(bytes, 0, 0x28, 0xb5, 0x2f, 0xfd) || text(bytes, 0, 'LZIP')
    || at(bytes, 0, 0x04, 0x22, 0x4d, 0x18) || text(bytes, 257, 'ustar') || text(bytes, 0, 'MSCF') || text(bytes, 0, '!<arch>') || text(bytes, 0, 'xar!')
    || at(bytes, 0, 0xed, 0xab, 0xee, 0xdb) || [ 0x8001, 0x8801, 0x9001 ].some((place) => text(bytes, place, 'CD001')) || text(bytes, bytes.length - 512, 'koly');

/**
 * What a file is, from its bytes and never from the type it came with (MS-D22): documents, text,
 * pictures, sounds and videos go; a box nobody here can look inside, anything that runs, anything
 * that renders a page and an Office file carrying macros never do, whatever they are called, and
 * neither does anything under a name a computer would run or open as a page, whatever is in it.
 * The sender asks before anything is sealed, and every reader before anything is saved.
 */
export function judgeFile(bytes: Uint8Array, name: string): FileVerdict
{
    const extension = /\.([^.]+)$/.exec(name.replace(/[.\s]+$/, '').toLowerCase())?.[1] ?? '';
    const named = NAMED[extension];

    if (named !== undefined)
    {
        return { goes: false, why: named };
    }

    if (runs(bytes))
    {
        return { goes: false, why: 'program' };
    }

    if (at(bytes, 0, 0x50, 0x4b, 0x03, 0x04) || at(bytes, 0, 0x50, 0x4b, 0x05, 0x06) || at(bytes, 0, 0x50, 0x4b, 0x07, 0x08))
    {
        return zipped(bytes);
    }

    if (boxed(bytes))
    {
        return { goes: false, why: 'archive' };
    }

    if (at(bytes, 0, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))
    {
        return compound(bytes, extension);
    }

    if (text(bytes, 0, '%PDF-') || text(bytes, 0, '{\\rtf'))
    {
        return { goes: true, kind: 'document' };
    }

    const media = mediaOf(bytes);

    if (media !== null)
    {
        return { goes: true, kind: media };
    }

    const words = wordsOf(bytes);

    if (words === null)
    {
        return { goes: false, why: 'other' };
    }

    const opening = words.trimStart();

    if (opening.startsWith('<'))
    {
        return { goes: false, why: 'page' };
    }

    return opening.startsWith('#!') ? { goes: false, why: 'program' } : { goes: true, kind: 'text' };
}
