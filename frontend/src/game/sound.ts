import type { MatchView } from '../api.ts';
import type { GameId } from '../data/games.ts';
import type { Frame } from './looks/frames.ts';
import { CUES, PACKS, PLACE_OF, SAMPLED, TABLE_PACKS, unpack, VOICE_PACKS, voicesOf, type Moment, type Pack, type Place, type Sampled, type Voiced } from './sound-files.ts';

type Result = NonNullable<MatchView['players'][number]['result']>;

export type Tone =
    | 'turn'
    | 'chime'
    | 'lose'
    | 'draw'
    | 'tick'
    | 'tick-hi'
    | 'trump'
    | 'trick'
    | 'cube'
    | 'pass'
    | 'deny'
    | 'home'
    | 'die-land'
    | 'dice-wood'
    | 'pawn-step'
    | 'pawn-hit'
    | 'checker'
    | 'checker-hit'
    | 'piece-move'
    | 'piece-capture'
    | 'horse-step'
    | 'elephant-step'
    | 'check'
    | 'promote'
    | 'win';

export type Cue = Tone | Sampled | Voiced;

export interface PlayOptions
{
    pan?: number;
    rate?: number;
    gain?: number;
    urgent?: boolean;

    /** How many seconds from now the take starts, on the audio clock. */
    after?: number;
}

export interface SoundHandle
{
    play(cue: Cue, options?: PlayOptions): void;

    /** The collections whose voices this handle plays: each one's pack for the handle's place is fetched while any handle wears it. */
    wear(collections: readonly Frame[]): void;

    /**
     * Settles once the voices this handle wears can be heard on their moment: when their packs have
     * come or could not, at once where nothing of them can be heard (its sound off, or a page nobody has
     * pressed), and after `VOICE_WAIT` whatever happens. What waits for it plays in step with its voice.
     */
    ready(): Promise<void>;

    setEnabled(on: boolean): void;

    dispose(): void;
}

/** A pack the engine fetches: a table's, or a collection's voices for a place. */
type Source = Pack | `${ Frame }-${ Place }`;

interface Voice
{
    wave: OscillatorType;
    from: number;
    to: number;
    hold: number;
    gain: number;
    delay: number;
}

type Bus = 'foley' | 'ui' | 'jingle';

interface Take
{
    buffer: AudioBuffer;
    offset: number;
}

/** A cue asked for while there was no context to play it on, and when, on the page's clock: there is no audio clock yet. */
interface Kept
{
    cue: Cue;
    options: PlayOptions;
    at: number;
}

/** Whoever plays the background, told each time the page's context runs, with the bus it plays into. */
export type BedListener = (context: AudioContext, into: AudioNode) => void;

interface Engine
{
    context: AudioContext | null;
    buses: Record<Bus, GainNode> | null;
    bed: GainNode | null;
    beds: Set<BedListener>;
    takes: Map<Cue, Take[]>;
    fetched: Set<Source>;
    landed: Set<Source>;
    wanted: Map<Source, number>;
    waiting: { cue: Voiced; options: PlayOptions; asked: number; until: number }[];
    readying: { sources: readonly Source[]; settle: () => void }[];
    handles: number;
    listening: number;
    resuming: boolean;
    parked: boolean;
    armed: boolean;
    waking: boolean;
    warming: boolean;
    early: Kept[];
    turn: Map<Cue, number>;
    voices: Map<Cue, { active: number; last: number }>;
}

const LANDING: readonly Voice[] = [
    { wave: 'triangle', from: 220, to: 140, hold: 0.09, gain: 0.3, delay: 0 },
    { wave: 'triangle', from: 300, to: 190, hold: 0.07, gain: 0.22, delay: 0.05 },
    { wave: 'sine', from: 180, to: 120, hold: 0.12, gain: 0.26, delay: 0.11 }
];

const CALL: readonly Voice[] = [
    { wave: 'triangle', from: 392, to: 392, hold: 0.22, gain: 0.16, delay: 0 },
    { wave: 'triangle', from: 587, to: 587, hold: 0.22, gain: 0.12, delay: 0 }
];

const STEP: readonly Voice[] = [{ wave: 'sine', from: 760, to: 700, hold: 0.05, gain: 0.14, delay: 0 }];

const KNOCK: readonly Voice[] = [
    { wave: 'sawtooth', from: 420, to: 90, hold: 0.24, gain: 0.26, delay: 0 },
    { wave: 'square', from: 210, to: 70, hold: 0.18, gain: 0.12, delay: 0.02 }
];

const TONES: Record<Tone, readonly Voice[]> = {
    'turn': [
        { wave: 'sine', from: 784, to: 784, hold: 0.09, gain: 0.14, delay: 0 },
        { wave: 'sine', from: 1175, to: 1175, hold: 0.16, gain: 0.12, delay: 0.08 }
    ],
    'tick': [{ wave: 'sine', from: 1000, to: 1000, hold: 0.025, gain: 0.06, delay: 0 }],
    'tick-hi': [{ wave: 'sine', from: 1250, to: 1250, hold: 0.025, gain: 0.06, delay: 0 }],
    'trump': CALL,
    'cube': CALL,
    'trick': [
        { wave: 'triangle', from: 659, to: 659, hold: 0.08, gain: 0.12, delay: 0 },
        { wave: 'triangle', from: 988, to: 988, hold: 0.14, gain: 0.12, delay: 0.07 }
    ],
    'chime': [{ wave: 'triangle', from: 880, to: 1320, hold: 0.1, gain: 0.12, delay: 0 }],
    'lose': [
        { wave: 'triangle', from: 523, to: 523, hold: 0.16, gain: 0.22, delay: 0 },
        { wave: 'triangle', from: 440, to: 440, hold: 0.16, gain: 0.22, delay: 0.14 },
        { wave: 'triangle', from: 349, to: 349, hold: 0.32, gain: 0.22, delay: 0.28 }
    ],
    'draw': [
        { wave: 'triangle', from: 440, to: 440, hold: 0.18, gain: 0.2, delay: 0 },
        { wave: 'triangle', from: 440, to: 440, hold: 0.3, gain: 0.2, delay: 0.16 }
    ],
    'pass': [{ wave: 'sine', from: 330, to: 220, hold: 0.16, gain: 0.1, delay: 0 }],
    'deny': [
        { wave: 'square', from: 180, to: 150, hold: 0.08, gain: 0.06, delay: 0 },
        { wave: 'square', from: 180, to: 150, hold: 0.08, gain: 0.06, delay: 0.1 }
    ],
    'home': [
        { wave: 'sine', from: 520, to: 780, hold: 0.14, gain: 0.24, delay: 0 },
        { wave: 'sine', from: 780, to: 1040, hold: 0.2, gain: 0.18, delay: 0.1 }
    ],
    'die-land': LANDING,
    'dice-wood': LANDING,
    'pawn-step': STEP,
    'pawn-hit': KNOCK,
    'checker': STEP,
    'checker-hit': KNOCK,
    'piece-move': [{ wave: 'triangle', from: 1180, to: 900, hold: 0.04, gain: 0.12, delay: 0 }],
    'piece-capture': [
        { wave: 'triangle', from: 520, to: 240, hold: 0.09, gain: 0.2, delay: 0 },
        { wave: 'sine', from: 1100, to: 800, hold: 0.04, gain: 0.08, delay: 0 }
    ],
    'horse-step': [
        { wave: 'triangle', from: 900, to: 720, hold: 0.03, gain: 0.12, delay: 0 },
        { wave: 'triangle', from: 780, to: 620, hold: 0.035, gain: 0.1, delay: 0.11 }
    ],
    'elephant-step': [
        { wave: 'sine', from: 150, to: 60, hold: 0.18, gain: 0.32, delay: 0 },
        { wave: 'triangle', from: 340, to: 180, hold: 0.06, gain: 0.08, delay: 0 }
    ],
    'check': [
        { wave: 'triangle', from: 988, to: 988, hold: 0.07, gain: 0.13, delay: 0 },
        { wave: 'triangle', from: 1319, to: 1319, hold: 0.13, gain: 0.11, delay: 0.07 }
    ],
    'promote': [
        { wave: 'sine', from: 660, to: 1320, hold: 0.18, gain: 0.14, delay: 0 },
        { wave: 'triangle', from: 1760, to: 1760, hold: 0.12, gain: 0.08, delay: 0.12 },
        { wave: 'sine', from: 2093, to: 2093, hold: 0.16, gain: 0.06, delay: 0.2 }
    ],
    'win': [
        { wave: 'triangle', from: 392, to: 392, hold: 0.16, gain: 0.26, delay: 0 },
        { wave: 'triangle', from: 523, to: 523, hold: 0.16, gain: 0.26, delay: 0.13 },
        { wave: 'triangle', from: 659, to: 659, hold: 0.18, gain: 0.26, delay: 0.26 },
        { wave: 'triangle', from: 784, to: 784, hold: 0.42, gain: 0.3, delay: 0.39 }
    ]
};

const JINGLES: ReadonlySet<Cue> = new Set<Cue>(['win', 'lose', 'draw', 'hand-won', 'six', 'home', 'promote']);

/** The end of a game, which the background sits 6 dB under for as long as it sounds. */
const STINGS: ReadonlySet<Cue> = new Set<Cue>(['win', 'lose', 'draw']);

const UNDER_STING = 0.5;

/** What the table says rather than what is on it: as quiet as these were while they were synthesised. */
const INTERFACE: ReadonlySet<Cue> = new Set<Cue>(['turn', 'tick', 'tick-hi', 'deny', 'pass', 'chime', 'check']);

const LEVELS: Record<Bus, number> = { foley: 0.9, ui: 0.45, jingle: 0.6 };

const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'] as const;

const MASTER = 0.7;

const MOST_AT_ONCE = 3;

const APART = 0.035;

const STALL_MS = 300;

const WARM_MS = 1500;

const EARLY_MOST = 4;

/** How long a cue asked for before the context was made waits for its recording before it is played as its tone. */
const EARLY_WAIT_MS = 400;

/** How long a look's voice asked for while its pack is on its way waits for it, in seconds; it has no tone to stand in for it. */
const VOICE_WAIT = 0.4;

const LOUD = 0.004;

type ContextMaker = typeof AudioContext;

const fresh = (): Engine => ({
    context: null,
    buses: null,
    bed: null,
    beds: new Set(),
    takes: new Map(),
    fetched: new Set(),
    landed: new Set(),
    wanted: new Map(),
    waiting: [],
    readying: [],
    handles: 0,
    listening: 0,
    resuming: false,
    parked: false,
    armed: false,
    waking: false,
    warming: false,
    early: [],
    turn: new Map(),
    voices: new Map()
});

let engine = fresh();

function maker()
{
    const scope = globalThis as unknown as { AudioContext?: ContextMaker; webkitAudioContext?: ContextMaker };

    return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** Whether a cue is a look's voice, which its collection's pack holds: `inferno.reveal`. */
const voiced = (cue: Cue): cue is Voiced => cue.includes('.');

function busOf(cue: Cue): Bus
{
    if (JINGLES.has(cue))
    {
        return 'jingle';
    }

    if (voiced(cue))
    {
        return 'foley';
    }

    return INTERFACE.has(cue) || !(SAMPLED as readonly Cue[]).includes(cue) ? 'ui' : 'foley';
}

/** The pack a look's voice is in: its collection's, for the place its moment is heard at. */
function sourceOf(cue: Voiced): Source
{
    const [collection, moment] = cue.split('.') as [Frame, Moment];

    return `${ collection }-${ PLACE_OF[moment] }`;
}

/** Where a source's pack is fetched from, and the cues it holds. */
function packOf(source: Source): { url: string; cues: readonly Cue[] }
{
    if (Object.hasOwn(PACKS, source))
    {
        return { url: PACKS[source as Pack], cues: CUES[source as Pack] };
    }

    const [collection, place] = source.split('-') as [Frame, Place];

    return { url: VOICE_PACKS[collection][place], cues: voicesOf(collection, place) };
}

/** What the end of a game sounds like to its reader: their own result, a neutral close to somebody watching, and nothing for no contest. */
export function endCue(result: Result | undefined): 'win' | 'lose' | 'draw' | null
{
    if (result === 'void')
    {
        return null;
    }

    if (result === 'won')
    {
        return 'win';
    }

    return result === 'lost' || result === 'abandoned' ? 'lose' : 'draw';
}

export function offsetOf(samples: Float32Array, rate: number)
{
    const limit = Math.min(samples.length, Math.round(rate * 0.3));

    for (let index = 0; index < limit; index += 1)
    {
        if (Math.abs(samples[index]) > LOUD)
        {
            return index / rate;
        }
    }

    return 0;
}

function arm()
{
    if (engine.armed || typeof window === 'undefined')
    {
        return;
    }

    engine.armed = true;

    for (const name of GESTURES)
    {
        window.addEventListener(name, wake, { capture: true, passive: true });
    }
}

function disarm()
{
    if (!engine.armed || typeof window === 'undefined')
    {
        return;
    }

    engine.armed = false;

    for (const name of GESTURES)
    {
        window.removeEventListener(name, wake, { capture: true });
    }
}

function build(): AudioContext | null
{
    const Maker = maker();

    if (Maker === null)
    {
        return null;
    }

    try
    {
        const context = new Maker();
        const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;

        if (session !== undefined)
        {
            session.type = 'ambient';
        }

        const limiter = context.createDynamicsCompressor();
        limiter.threshold.value = -10;
        limiter.knee.value = 6;
        limiter.ratio.value = 8;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.12;
        limiter.connect(context.destination);

        const master = context.createGain();
        master.gain.value = MASTER;
        master.connect(limiter);

        const bus = (level: number) =>
        {
            const node = context.createGain();
            node.gain.value = level;
            node.connect(master);
            return node;
        };

        engine.buses = { foley: bus(LEVELS.foley), ui: bus(LEVELS.ui), jingle: bus(LEVELS.jingle) };
        engine.bed = bus(1);
        context.addEventListener?.('statechange', () => settle(context));

        return context;
    }
    catch
    {
        engine.buses = null;
        engine.bed = null;
        return null;
    }
}

/** Hands whoever plays the background the page's context once it runs, and the bus that is theirs. */
function ran(context: AudioContext | null)
{
    const into = engine.bed;

    if (context === null || context !== engine.context || context.state !== 'running' || into === null)
    {
        return;
    }

    for (const listener of engine.beds)
    {
        listener(context, into);
    }
}

/** Tells `listener` each time the page's context runs, at once if it already does; answers how to stop. */
export function onBed(listener: BedListener)
{
    const at = engine;

    at.beds.add(listener);

    if (at.context !== null && at.context.state === 'running' && at.bed !== null)
    {
        listener(at.context, at.bed);
    }

    return () =>
    {
        at.beds.delete(listener);
    };
}

/** Sits the background 6 dB under the end of a game for as long as it sounds. */
function dip(context: AudioContext, seconds: number)
{
    const gain = engine.bed?.gain;

    if (gain === undefined || !Number.isFinite(seconds))
    {
        return;
    }

    const at = context.currentTime;
    const until = at + Math.max(0.15, seconds);

    gain.cancelScheduledValues(at);
    gain.setValueAtTime(gain.value, at);
    gain.linearRampToValueAtTime(UNDER_STING, at + 0.15);
    gain.setValueAtTime(UNDER_STING, until);
    gain.linearRampToValueAtTime(1, until + 0.6);
}

function settle(context: AudioContext)
{
    if (context !== engine.context)
    {
        return;
    }

    if (context.state === 'running')
    {
        engine.resuming = false;
        disarm();
        ran(context);
        return;
    }

    if (context.state !== 'closed' && !engine.parked && engine.handles > 0)
    {
        arm();
    }
}

function activated()
{
    const scope = globalThis as unknown as { navigator?: { userActivation?: { hasBeenActive?: boolean } } };

    return scope.navigator?.userActivation?.hasBeenActive === true;
}

function later(run: () => void, idle: boolean)
{
    const at = engine;
    const go = () =>
    {
        if (engine === at)
        {
            run();
        }
    };
    const scope = globalThis as unknown as { requestIdleCallback?: (callback: () => void, options: { timeout: number }) => number };

    if (idle && typeof scope.requestIdleCallback === 'function')
    {
        scope.requestIdleCallback(go, { timeout: WARM_MS });
        return;
    }

    setTimeout(go, 0);
}

function warm()
{
    engine.warming = false;

    if (engine.context !== null || engine.handles === 0 || engine.listening === 0 || !activated())
    {
        replay();
        return;
    }

    engine.context = build();

    if (engine.context?.state === 'running')
    {
        disarm();
        ran(engine.context);
    }

    const at = engine;
    const early = engine.early;

    engine.early = [];

    void Promise.race([load(), new Promise((resolve) => setTimeout(resolve, EARLY_WAIT_MS))]).then(() =>
    {
        for (const one of engine === at ? early : [])
        {
            playKept(one);
        }
    });
}

/** Plays, in order, what was asked for before there was a context to play it on. */
function replay()
{
    const early = engine.early;

    engine.early = [];

    for (const one of early)
    {
        playKept(one);
    }
}

/** Plays a cue that was kept as late as it was kept, so a voice meant to start later still starts on its moment; a look's voice kept longer than one may wait is let go. */
function playKept(one: Kept)
{
    const late = (performance.now() - one.at) / 1000;

    if (voiced(one.cue) && late > VOICE_WAIT)
    {
        return;
    }

    play(one.cue, one.options.after === undefined ? one.options : { ...one.options, after: Math.max(0, one.options.after - late) });
}

function woken()
{
    engine.waking = false;
    engine.warming = false;
    unlock();
    replay();
}

function wake()
{
    if (engine.context !== null && engine.context.state !== 'closed')
    {
        unlock();
        return;
    }

    if (!engine.waking)
    {
        engine.waking = true;
        later(woken, false);
    }
}

function unlock()
{
    if (engine.handles === 0)
    {
        disarm();
        return;
    }

    if (engine.context === null || engine.context.state === 'closed')
    {
        engine.context = build();
    }

    const context = engine.context;

    if (context === null)
    {
        disarm();
        return;
    }

    engine.parked = false;

    if (context.state === 'running')
    {
        disarm();
        ran(context);
    }
    else
    {
        engine.resuming = true;
        void context.resume?.().catch(() => undefined);

        setTimeout(() =>
        {
            if (engine.context !== context || context.state === 'running' || context.state === 'closed' || engine.parked || engine.handles === 0)
            {
                return;
            }

            void context.close?.().catch(() => undefined);
            engine.context = build();
            engine.resuming = false;
            arm();
        }, STALL_MS);
    }

    void load();
}

/** Fetches every pack a table that is listening plays from and nobody has fetched yet, and says when they are in. */
function load()
{
    const context = engine.context;

    if (context === null || typeof fetch !== 'function')
    {
        return Promise.resolve();
    }

    const fetching: Promise<void>[] = [];

    for (const [pack, wanting] of engine.wanted)
    {
        if (wanting > 0 && !engine.fetched.has(pack))
        {
            fetching.push(fetchPack(context, pack));
        }
    }

    return Promise.all(fetching);
}

function fetchPack(context: AudioContext, source: Source)
{
    const at = engine;
    const { url, cues } = packOf(source);

    at.fetched.add(source);

    return fetch(url)
        .then((response) => response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status))))
        .then((bytes) => Promise.all([...unpack(bytes, cues)].flatMap(([cue, takes]) => takes.map((take) =>
            context.decodeAudioData(take)
                .then((buffer) =>
                {
                    const held = at.takes.get(cue) ?? [];
                    held.push({ buffer, offset: offsetOf(buffer.getChannelData(0), buffer.sampleRate) });
                    at.takes.set(cue, held);
                })
                .catch(() => undefined)))))
        .then(() =>
        {
            at.landed.add(source);
            heard(at, cues);
            arrived(at);
        }, () =>
        {
            at.fetched.delete(source);
            at.waiting = at.waiting.filter((one) => !cues.includes(one.cue));
            arrived(at);
        });
}

/** Tells whoever was waiting for packs that every one of them has come or could not. */
function arrived(at: Engine)
{
    const done = at.readying.filter(({ sources }) => sources.every((source) => at.landed.has(source) || !at.fetched.has(source)));

    at.readying = at.readying.filter((one) => !done.includes(one));

    for (const one of done)
    {
        one.settle();
    }
}

/** Plays the voices that waited for a pack that has come, each as late as it waited, and lets go of those that waited too long. */
function heard(at: Engine, cues: readonly Cue[])
{
    const context = at.context;

    if (at !== engine || context === null)
    {
        return;
    }

    const now = context.currentTime;
    const come = at.waiting.filter((one) => cues.includes(one.cue));

    at.waiting = at.waiting.filter((one) => !cues.includes(one.cue));

    for (const one of come.filter((waited) => now <= waited.until))
    {
        play(one.cue, { ...one.options, after: Math.max(0, (one.options.after ?? 0) - (now - one.asked)) });
    }
}

function route(context: AudioContext, into: AudioNode, pan: number | undefined): AudioNode
{
    if (pan === undefined || typeof context.createStereoPanner !== 'function')
    {
        return into;
    }

    const panner = context.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(into);

    return panner;
}

function sample(context: AudioContext, cue: Cue, takes: Take[], into: AudioNode, options: PlayOptions, done: () => void)
{
    const turn = engine.turn.get(cue) ?? 0;
    const take = takes[turn % takes.length];

    engine.turn.set(cue, turn + 1);

    const source = context.createBufferSource();
    const level = context.createGain();

    source.buffer = take.buffer;
    source.playbackRate.value = (options.rate ?? 1) * (0.96 + Math.random() * 0.1);
    level.gain.value = (options.gain ?? 1) * Math.pow(10, (Math.random() * 3 - 1.5) / 20);

    source.connect(level);
    level.connect(route(context, into, options.pan));
    source.onended = done;
    source.start(context.currentTime + (options.after ?? 0), take.offset);

    return (take.buffer.duration - take.offset) / source.playbackRate.value;
}

function synth(context: AudioContext, voices: readonly Voice[], into: AudioNode, options: PlayOptions, done: () => void)
{
    const at = context.currentTime;
    const out = route(context, into, options.pan);
    const rate = options.rate ?? 1;
    const scale = options.gain ?? 1;
    let last: OscillatorNode | null = null;
    let end = -1;

    for (const voice of voices)
    {
        const source = context.createOscillator();
        const level = context.createGain();
        const stop = at + voice.delay + voice.hold + 0.02;

        source.type = voice.wave;
        source.frequency.setValueAtTime(voice.from * rate, at + voice.delay);
        source.frequency.exponentialRampToValueAtTime(Math.max(1, voice.to * rate), at + voice.delay + voice.hold);

        level.gain.setValueAtTime(0.0001, at + voice.delay);
        level.gain.exponentialRampToValueAtTime(Math.max(0.0002, voice.gain * scale), at + voice.delay + 0.012);
        level.gain.exponentialRampToValueAtTime(0.0001, at + voice.delay + voice.hold);

        source.connect(level);
        level.connect(out);

        source.start(at + voice.delay);
        source.stop(stop);

        if (stop > end)
        {
            end = stop;
            last = source;
        }
    }

    if (last === null)
    {
        done();
        return 0;
    }

    last.onended = done;

    return end - at;
}

function play(cue: Cue, options: PlayOptions)
{
    const context = engine.context;
    const buses = engine.buses;

    if (engine.warming)
    {
        if (engine.early.length < EARLY_MOST)
        {
            engine.early.push({ cue, options, at: performance.now() });
        }

        return;
    }

    if (context === null || buses === null)
    {
        if (context === null && engine.waking && engine.early.length < EARLY_MOST)
        {
            engine.early.push({ cue, options, at: performance.now() });
        }

        return;
    }

    if (context.state !== 'running' && !engine.resuming)
    {
        return;
    }

    if (options.urgent !== true && typeof document !== 'undefined' && document.visibilityState === 'hidden')
    {
        return;
    }

    const now = context.currentTime;

    if (voiced(cue) && !engine.takes.has(cue))
    {
        const source = sourceOf(cue);

        if (engine.fetched.has(source) && !engine.landed.has(source) && engine.waiting.length < EARLY_MOST * 4)
        {
            engine.waiting.push({ cue, options, asked: now, until: now + VOICE_WAIT });
        }

        return;
    }

    const count = engine.voices.get(cue) ?? { active: 0, last: -1 };

    if (count.active >= MOST_AT_ONCE || (count.last >= 0 && now - count.last < APART))
    {
        return;
    }

    count.active += 1;
    count.last = now;
    engine.voices.set(cue, count);

    const done = () =>
    {
        count.active = Math.max(0, count.active - 1);
    };

    const into = buses[busOf(cue)];
    const takes = engine.takes.get(cue);

    try
    {
        const voices = TONES[cue as Tone];
        let seconds: number;

        if (takes !== undefined && takes.length > 0)
        {
            seconds = sample(context, cue, takes, into, options, done);
        }
        else if (voices !== undefined)
        {
            seconds = synth(context, voices, into, options, done);
        }
        else
        {
            done();
            return;
        }

        if (STINGS.has(cue))
        {
            dip(context, seconds);
        }
    }
    catch
    {
        done();
    }
}

const ALONE: readonly Pack[] = ['common'];

/** A handle for one table (its game's packs) or for anything else (the shared pack alone). */
export function createSound(enabled: boolean, game?: GameId)
{
    return handle(enabled, game === undefined ? ALONE : TABLE_PACKS[game], 'table');
}

/** A handle for a page that plays nothing but the voices of the looks it shows: a profile's, or the collection's. */
export function createVoices(enabled: boolean)
{
    return handle(enabled, [], 'profile');
}

function handle(enabled: boolean, packs: readonly Pack[], place: Place): SoundHandle
{
    let on = enabled;
    let live = true;
    let worn: readonly Source[] = [];

    const count = (sources: readonly Source[], by: number) =>
    {
        for (const source of sources)
        {
            engine.wanted.set(source, Math.max(0, (engine.wanted.get(source) ?? 0) + by));
        }
    };

    const want = (by: number) => count([...packs, ...worn], by);

    engine.handles += 1;

    if (on)
    {
        engine.listening += 1;
        want(1);
    }

    const context = engine.context;

    if (context === null || context.state !== 'running')
    {
        arm();
    }

    if (context === null && on)
    {
        engine.warming = activated();
        later(warm, true);
    }

    if (context !== null && engine.parked)
    {
        engine.parked = false;
        void context.resume?.().catch(() => undefined);
    }

    if (context !== null && on)
    {
        void load();
    }

    return {
        play: (cue, options = {}) =>
        {
            if (live && on)
            {
                play(cue, options);
            }
        },

        wear: (collections) =>
        {
            const next = [...new Set(collections)].map((collection): Source => `${ collection }-${ place }`);

            if (!live)
            {
                return;
            }

            if (on)
            {
                count(worn.filter((source) => !next.includes(source)), -1);
                count(next.filter((source) => !worn.includes(source)), 1);
            }

            worn = next;

            if (on)
            {
                void load();
            }
        },

        ready: () =>
        {
            const coming = engine.context !== null || engine.warming || engine.waking;
            const due = worn.filter((source) => !engine.landed.has(source) && (engine.context === null || engine.fetched.has(source)));

            if (!live || !on || !coming || due.length === 0)
            {
                return Promise.resolve();
            }

            return new Promise<void>((resolve) =>
            {
                engine.readying.push({ sources: due, settle: resolve });
                setTimeout(resolve, VOICE_WAIT * 1000);
            });
        },

        setEnabled: (next) =>
        {
            if (!live || next === on)
            {
                return;
            }

            on = next;
            engine.listening += next ? 1 : -1;
            want(next ? 1 : -1);

            if (next)
            {
                void load();
            }
        },

        dispose: () =>
        {
            if (!live)
            {
                return;
            }

            live = false;
            engine.handles -= 1;

            if (on)
            {
                engine.listening -= 1;
                want(-1);
            }

            if (engine.handles > 0)
            {
                return;
            }

            disarm();
            engine.parked = true;
            engine.resuming = false;
            void engine.context?.suspend?.().catch(() => undefined);
        }
    };
}

export function resetSound()
{
    disarm();
    void engine.context?.close?.().catch(() => undefined);
    engine = fresh();
}
