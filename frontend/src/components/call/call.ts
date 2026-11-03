import { render } from 'azerothjs';

import { useCalls } from '../../stores/calls.store.ts';
import CallCard from './call-card.component.azeroth';

export function begin()
{
    const stop = useCalls().start();
    const host = document.createElement('div');

    document.body.append(host);
    render(() => CallCard({}), host);

    return () =>
    {
        stop();
        render(() => [], host);
        host.remove();
    };
}
