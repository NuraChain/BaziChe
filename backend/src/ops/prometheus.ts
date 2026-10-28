export interface Series
{
    name: string;
    help: string;
    type: 'gauge' | 'counter';
    samples: readonly { labels?: Readonly<Record<string, string>>; value: number }[];
}

const escaped = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');

const labelled = (labels: Readonly<Record<string, string>> | undefined) =>
{
    const pairs = Object.entries(labels ?? {});

    return pairs.length === 0 ? '' : `{${ pairs.map(([key, value]) => `${ key }="${ escaped(value) }"`).join(',') }}`;
};

const number = (value: number) => (Number.isFinite(value) ? String(value) : 'NaN');

/** The Prometheus text exposition format, version 0.0.4. */
export const PROMETHEUS_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

export function rendered(series: readonly Series[])
{
    return series
        .map((one) => [
            `# HELP ${ one.name } ${ one.help.replaceAll('\\', '\\\\').replaceAll('\n', '\\n') }`,
            `# TYPE ${ one.name } ${ one.type }`,
            ...one.samples.map((sample) => `${ one.name }${ labelled(sample.labels) } ${ number(sample.value) }`)
        ].join('\n'))
        .join('\n')
        .concat('\n');
}
