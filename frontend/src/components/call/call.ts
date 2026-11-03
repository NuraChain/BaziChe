import { render } from 'azerothjs';

import { offerCallBar } from '../../stores/call-bar.ts';
import { useCalls } from '../../stores/calls.store.ts';
import CallBar from './call-bar.component.azeroth';
import CallCard from './call-card.component.azeroth';
import { startRinger } from './ringer.ts';

export function begin()
{
    const stop = useCalls().start();
    const host = document.createElement('div');
    const unbar = offerCallBar(() => CallBar({}));
    const unring = startRinger();

    document.body.append(host);
    render(() => CallCard({}), host);

    return () =>
    {
        unring();
        unbar();
        stop();
        render(() => [], host);
        host.remove();
    };
}
