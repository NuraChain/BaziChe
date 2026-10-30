import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import ReportSheet from '../src/components/social/report-sheet.component.azeroth';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const DISCLOSE = { conversationId: 'c-reza', messageId: 'm-1', frankingKey: 'a-key' };

const shown = (text?: string) => renderTest(() => ReportSheet({
    overlayId: 'report',
    close: vi.fn(),
    personId: 'reza',
    ...(text === undefined ? {} : { disclose: { ...DISCLOSE, text } })
}) as HTMLElement).container;

const showing = (root: ParentNode) => root.querySelector('[data-showing]')?.textContent?.trim() ?? null;

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
});

describe('the sheet that files a report', () =>
{
    it('says the words of the line it will show, never the document they were sealed in', () =>
    {
        expect(showing(shown('{"text":"You **played** badly"}'))).toBe('You played badly');
        cleanup();

        expect(showing(shown('{"text":"The ending ||was a twist||"}')), 'a spoiler kept as one').toBe('The ending (spoiler)');
        cleanup();

        expect(showing(shown('{"edit":"Changed to this","on":"m-1"}')), 'an edit, in the words it gave the line').toBe('Changed to this');
    });

    it('shows no line when it was opened about the person alone', () =>
    {
        expect(shown().querySelector('[data-showing]')).toBeNull();
    });
});
