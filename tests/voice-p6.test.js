// P6 voice, client side: the microphone state machine with a mocked MediaRecorder / getUserMedia, the
// recording-type choice, the /api/transcribe outcome mapping, and text to speech (voice choice, one
// utterance at a time, Stop) with a mocked speechSynthesis. No browser, no network.
import { describe, expect, it, vi } from 'vitest';
import { createRecorder, createSpeaker, loadVoices, pickMime, pickVoice, speechLang, speechSupported, speechText, transcribeOutcome, VOICE_MESSAGES, voiceInputSupported } from '../src/ui/voice.js';

// ── mocks ──
function makeMR({ types = ['audio/webm;codecs=opus', 'audio/webm'], bytes = 2000, chunkType = null } = {}) {
  const instances = [];
  class FakeMR {
    static isTypeSupported(t) {
      return types.includes(t);
    }
    constructor(stream, options = {}) {
      this.stream = stream;
      this.options = options;
      this.mimeType = options.mimeType ?? '';
      this.state = 'inactive';
      instances.push(this);
    }
    start(timeslice) {
      this.state = 'recording';
      this.timeslice = timeslice;
    }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      if (bytes) this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)], { type: chunkType ?? this.mimeType }) });
      this.onstop?.();
    }
  }
  return { FakeMR, instances };
}
function makeStream() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return { getTracks: () => tracks, tracks };
}
/** A recorder wired to mocks; `ticks` runs the countdown by hand. */
function setup({ mr = makeMR(), getUserMedia, transcribe, maxBytes } = {}) {
  const stream = makeStream();
  const events = [];
  let tick = null;
  const cleared = vi.fn();
  const mediaDevices = { getUserMedia: getUserMedia ?? vi.fn(async () => stream) };
  const recorder = createRecorder({
    mediaDevices,
    MediaRecorder: mr.FakeMR,
    transcribe: transcribe ?? vi.fn(async () => ({ kind: 'text', text: 'hello there' })),
    onState: (e) => events.push(e),
    setTimer: (fn) => {
      tick = fn;
      return 7;
    },
    clearTimer: cleared,
    ...(maxBytes ? { maxBytes } : {}),
  });
  return { recorder, events, stream, mr, mediaDevices, cleared, tick: (n = 1) => Array.from({ length: n }, () => tick?.()), states: () => events.map((e) => e.state) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('P6 recorder state machine (mocked MediaRecorder)', () => {
  it('press → permission → recording with a 30 s countdown → press again → transcribing → text → idle; the microphone is released', async () => {
    const t = setup();
    expect(t.recorder.state).toBe('idle');
    await t.recorder.start();
    expect(t.states()).toEqual(['requesting', 'recording']);
    expect(t.events[1].secondsLeft).toBe(30);
    expect(t.mr.instances[0]).toMatchObject({ state: 'recording', timeslice: 1000 });
    expect(t.mr.instances[0].options).toMatchObject({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 });
    t.tick(3);
    expect(t.events.at(-1)).toMatchObject({ state: 'recording', secondsLeft: 27 });
    t.recorder.stop();
    await flush();
    expect(t.states()).toEqual(['requesting', 'recording', 'recording', 'recording', 'recording', 'transcribing', 'text', 'idle']);
    expect(t.events.find((e) => e.state === 'text').text).toBe('hello there');
    for (const track of t.stream.tracks) expect(track.stop).toHaveBeenCalled();
    expect(t.cleared).toHaveBeenCalled();
    expect(t.recorder.state).toBe('idle');
  });

  it('hands the recording to transcribe() as one Blob of the recorded type, and sends nothing else anywhere', async () => {
    const transcribe = vi.fn(async () => ({ kind: 'text', text: 'x' }));
    const t = setup({ transcribe });
    await t.recorder.start();
    t.recorder.stop();
    await flush();
    expect(transcribe).toHaveBeenCalledTimes(1);
    const blob = transcribe.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('audio/webm;codecs=opus');
    expect(blob.size).toBe(2000);
  });

  it('stops by itself after 30 seconds (the countdown reaches zero)', async () => {
    const transcribe = vi.fn(async () => ({ kind: 'text', text: 'long one' }));
    const t = setup({ transcribe });
    await t.recorder.start();
    t.tick(29);
    expect(t.recorder.state).toBe('recording');
    expect(t.events.at(-1).secondsLeft).toBe(1);
    t.tick(1);
    await flush();
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(t.recorder.state).toBe('idle');
  });

  it('pressing start twice, or stop while idle, does nothing', async () => {
    const t = setup();
    t.recorder.stop();
    await t.recorder.start();
    await t.recorder.start();
    expect(t.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(t.mr.instances).toHaveLength(1);
    t.recorder.stop();
    await flush();
  });

  it('permission denied → "denied" error, back to idle, nothing recorded; typing is untouched', async () => {
    const t = setup({ getUserMedia: vi.fn(async () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }))) });
    await t.recorder.start();
    expect(t.events.filter((e) => e.state === 'error')).toEqual([{ state: 'error', key: 'denied' }]);
    expect(t.states().at(-1)).toBe('idle');
    expect(t.mr.instances).toHaveLength(0);
    expect(VOICE_MESSAGES.denied).toMatch(/type your question/);
  });

  it.each([
    ['NotFoundError', 'nomic'],
    ['NotReadableError', 'busyMic'],
    ['SecurityError', 'denied'],
    ['SomethingElse', 'nomic'],
  ])('getUserMedia %s → %s', async (name, key) => {
    const t = setup({ getUserMedia: vi.fn(async () => Promise.reject(Object.assign(new Error('x'), { name }))) });
    await t.recorder.start();
    expect(t.events.find((e) => e.state === 'error').key).toBe(key);
  });

  it('no MediaRecorder or no getUserMedia → "unsupported" (a clear message, never a crash)', async () => {
    const none = createRecorder({ mediaDevices: undefined, MediaRecorder: undefined, transcribe: vi.fn(), onState: (e) => none.events.push(e) });
    none.events = [];
    await none.start();
    expect(none.events.map((e) => e.state)).toEqual(['error', 'idle']);
    expect(none.events[0].key).toBe('unsupported');
    expect(voiceInputSupported({ mediaDevices: { getUserMedia() {} } }, class {})).toBe(true);
    expect(voiceInputSupported({}, class {})).toBe(false);
    expect(voiceInputSupported({ mediaDevices: { getUserMedia() {} } }, undefined)).toBe(false);
  });

  it('an empty, oversized or wrongly typed recording is refused before anything is sent', async () => {
    for (const [mrOptions, key] of [[{ bytes: 0 }, 'empty'], [{ bytes: 5000 }, 'tooBig'], [{ chunkType: 'audio/x-matroska', types: [] }, 'unsupported']]) {
      const transcribe = vi.fn();
      const t = setup({ mr: makeMR(mrOptions), transcribe, maxBytes: key === 'tooBig' ? 4000 : undefined });
      await t.recorder.start();
      t.recorder.stop();
      await flush();
      expect(t.events.find((e) => e.state === 'error')?.key, key).toBe(key);
      expect(transcribe).not.toHaveBeenCalled();
      for (const track of t.stream.tracks) expect(track.stop).toHaveBeenCalled();
    }
  });

  it('cancel while recording drops the audio, releases the microphone and sends nothing', async () => {
    const transcribe = vi.fn(async () => ({ kind: 'text', text: 'second take' }));
    const t = setup({ transcribe });
    await t.recorder.start();
    t.recorder.cancel();
    await flush();
    expect(transcribe).not.toHaveBeenCalled();
    expect(t.states()).toEqual(['requesting', 'recording', 'idle']);
    for (const track of t.stream.tracks) expect(track.stop).toHaveBeenCalled();
    // and it can record again afterwards
    await t.recorder.start();
    expect(t.recorder.state).toBe('recording');
    t.recorder.stop();
    await flush();
  });

  it('cancel while the permission prompt is open releases the stream as soon as it is granted', async () => {
    let grant;
    const stream = makeStream();
    const t = setup({ getUserMedia: vi.fn(() => new Promise((r) => (grant = () => r(stream)))) });
    const starting = t.recorder.start();
    expect(t.recorder.state).toBe('requesting');
    t.recorder.cancel();
    grant();
    await starting;
    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalled();
    expect(t.mr.instances).toHaveLength(0);
    expect(t.recorder.state).toBe('idle');
  });

  it('cancel while transcribing ignores the response (no text appears)', async () => {
    let resolve;
    const transcribe = vi.fn(() => new Promise((r) => (resolve = r)));
    const t = setup({ transcribe });
    await t.recorder.start();
    t.recorder.stop();
    await flush();
    expect(t.recorder.state).toBe('transcribing');
    t.recorder.cancel();
    resolve({ kind: 'text', text: 'late text' });
    await flush();
    expect(t.states()).not.toContain('text');
    expect(t.recorder.state).toBe('idle');
  });

  it.each([
    [{ kind: 'refused', reply: 'fixed reply' }, 'refused'],
    [{ kind: 'empty' }, 'empty'],
    [{ kind: 'rate', seconds: 300 }, 'rate'],
    [{ kind: 'session' }, 'session'],
    [{ kind: 'error', key: 'tooLong' }, 'error'],
  ])('transcribe outcome %j → state "%s", then idle', async (outcome, state) => {
    const t = setup({ transcribe: vi.fn(async () => outcome) });
    await t.recorder.start();
    t.recorder.stop();
    await flush();
    expect(t.states().slice(-2)).toEqual([state, 'idle']);
  });

  it('a network failure while transcribing → "network" error, then idle', async () => {
    const t = setup({ transcribe: vi.fn(async () => Promise.reject(new Error('offline'))) });
    await t.recorder.start();
    t.recorder.stop();
    await flush();
    expect(t.events.find((e) => e.state === 'error').key).toBe('network');
    expect(t.recorder.state).toBe('idle');
  });

  it('falls back to a plain MediaRecorder when the browser rejects the options', async () => {
    const stream = makeStream();
    const { FakeMR: Base } = makeMR();
    let calls = 0;
    class PickyMR extends Base {
      constructor(s, options) {
        calls += 1;
        if (options) throw new Error('options not supported');
        super(s);
        this.mimeType = 'audio/mp4';
      }
    }
    const t = setup({ mr: { FakeMR: PickyMR, instances: [] }, getUserMedia: vi.fn(async () => stream) });
    await t.recorder.start();
    expect(calls).toBe(2);
    expect(t.recorder.state).toBe('recording');
    t.recorder.stop();
    await flush();
  });
});

describe('P6 recording type and the server answer', () => {
  it('pickMime prefers webm/opus, then webm, ogg, mp4 (Safari) and wav; "" lets the browser choose', () => {
    expect(pickMime(makeMR().FakeMR)).toBe('audio/webm;codecs=opus');
    expect(pickMime(makeMR({ types: ['audio/webm'] }).FakeMR)).toBe('audio/webm');
    expect(pickMime(makeMR({ types: ['audio/mp4'] }).FakeMR)).toBe('audio/mp4');
    expect(pickMime(makeMR({ types: [] }).FakeMR)).toBe('');
    expect(pickMime({})).toBe('');
    expect(pickMime(undefined)).toBe('');
  });

  it('transcribeOutcome maps every response', () => {
    expect(transcribeOutcome(200, { ok: true, text: ' hello ' })).toEqual({ kind: 'text', text: 'hello' });
    expect(transcribeOutcome(200, { ok: true, text: '' })).toEqual({ kind: 'empty' });
    expect(transcribeOutcome(200, { ok: true, text: '', refused: true, reply: 'No.' })).toEqual({ kind: 'refused', reply: 'No.' });
    expect(transcribeOutcome(401, {})).toEqual({ kind: 'session' });
    expect(transcribeOutcome(413, { error: 'too_long' })).toEqual({ kind: 'error', key: 'tooLong' });
    expect(transcribeOutcome(413, { error: 'payload_too_large' })).toEqual({ kind: 'error', key: 'tooBig' });
    expect(transcribeOutcome(415, {})).toEqual({ kind: 'error', key: 'unsupported' });
    expect(transcribeOutcome(429, { retryAfter: 90 }, '125')).toEqual({ kind: 'rate', seconds: 125 });
    expect(transcribeOutcome(429, { retryAfter: 90 })).toEqual({ kind: 'rate', seconds: 90 });
    expect(transcribeOutcome(503, { error: 'resting' })).toEqual({ kind: 'error', key: 'resting' });
    expect(transcribeOutcome(503, { error: 'not_configured' })).toEqual({ kind: 'error', key: 'unavailable' });
    expect(transcribeOutcome(502, {})).toEqual({ kind: 'error', key: 'server' });
    expect(transcribeOutcome(500, {})).toEqual({ kind: 'error', key: 'server' });
    expect(VOICE_MESSAGES.rateLimited(125)).toMatch(/3 minutes/);
    expect(VOICE_MESSAGES.rateLimited(30)).toMatch(/1 minute\b/);
  });
});

// ── text to speech ──
const V = (name, lang) => ({ name, lang });
const VOICES = [V('Google US English', 'en-US'), V('Google UK English', 'en-GB'), V('Heera', 'hi-IN'), V('Uzma', 'ur-PK'), V('Ravi', 'en-IN')];

function makeSynth(voices = VOICES) {
  const listeners = {};
  const spoken = [];
  const synth = {
    spoken,
    getVoices: vi.fn(() => voices),
    cancel: vi.fn(() => {
      const u = spoken.at(-1);
      if (u && !u.done) {
        u.done = true;
        u.onerror?.({ error: 'interrupted' });
      }
    }),
    speak: vi.fn((u) => spoken.push(u)),
    addEventListener: (n, fn) => (listeners[n] = fn),
    removeEventListener: (n) => delete listeners[n],
    listeners,
    finish: () => {
      const u = spoken.at(-1);
      u.done = true;
      u.onend?.();
    },
  };
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  return { synth, Utterance };
}

describe('P6 Listen (speechSynthesis)', () => {
  it('speechText drops citation marks and markup', () => {
    expect(speechText('I built it [1] and  *this* [2][3].\n\nDone')).toBe('I built it and this . Done');
    expect(speechText('')).toBe('');
  });

  it('speechLang: Urdu script → ur; otherwise the selected language (roman or en)', () => {
    expect(speechLang('یہ بات', 'en')).toBe('ur');
    expect(speechLang('Main Axisero mein hoon', 'roman')).toBe('roman');
    expect(speechLang('I work at Axisero', 'roman')).toBe('roman');
    expect(speechLang('I work at Axisero', 'ur')).toBe('en');
  });

  it('pickVoice: English → en-US/en-GB; Urdu → an Urdu voice or none; Roman Urdu → Hindi/Urdu, then Indian English, then any English', () => {
    expect(pickVoice(VOICES, 'en').lang).toBe('en-US');
    expect(pickVoice([V('a', 'en_GB')], 'en').lang).toBe('en_GB');
    expect(pickVoice(VOICES, 'ur').lang).toBe('ur-PK');
    expect(pickVoice(VOICES.filter((v) => !v.lang.startsWith('ur')), 'ur')).toBeNull(); // never reads Urdu script with an English voice
    expect(pickVoice(VOICES, 'roman').lang).toBe('hi-IN');
    expect(pickVoice(VOICES.filter((v) => v.lang !== 'hi-IN'), 'roman').lang).toBe('ur-PK');
    expect(pickVoice([V('Ravi', 'en-IN'), V('Z', 'en-US')], 'roman').lang).toBe('en-IN');
    expect(pickVoice([V('Z', 'fr-FR')], 'roman')).toBeNull();
    expect(pickVoice([], 'en')).toBeNull();
    expect(pickVoice(undefined, 'en')).toBeNull();
  });

  it('loadVoices waits for voiceschanged when the list is empty at first, but not forever', async () => {
    const m = makeSynth([]);
    const waiting = loadVoices(m.synth, 50);
    m.synth.getVoices.mockReturnValue(VOICES);
    m.synth.listeners.voiceschanged();
    expect(await waiting).toHaveLength(VOICES.length);
    const none = makeSynth([]);
    expect(await loadVoices(none.synth, 10)).toEqual([]);
  });

  it('speak → "speaking" (with the length) → end → "ended"; the utterance uses the chosen voice and language', async () => {
    const m = makeSynth();
    const states = [];
    const speaker = createSpeaker({ ...m, onState: (e) => states.push(e) });
    const done = speaker.speak('I build things [1].', 'en');
    await flush();
    expect(speaker.speaking).toBe(true);
    expect(m.synth.speak).toHaveBeenCalledTimes(1);
    const u = m.synth.spoken[0];
    expect(u.text).toBe('I build things .');
    expect(u.voice.lang).toBe('en-US');
    expect(u.lang).toBe('en-US');
    expect(states[0]).toEqual({ state: 'speaking', chars: 'I build things .'.length });
    m.synth.finish();
    expect(await done).toEqual({ result: 'ended' });
    expect(states.at(-1)).toEqual({ state: 'ended' });
    expect(speaker.speaking).toBe(false);
  });

  it('Stop cancels the speech and reports "stopped"; starting another answer stops the first (one at a time)', async () => {
    const m = makeSynth();
    const states = [];
    const speaker = createSpeaker({ ...m, onState: (e) => states.push(e.state) });
    const first = speaker.speak('first answer', 'en');
    await flush();
    speaker.stop();
    expect(m.synth.cancel).toHaveBeenCalled();
    expect(await first).toEqual({ result: 'stopped' });
    expect(states).toEqual(['speaking', 'stopped']);
    states.length = 0;
    const second = speaker.speak('second answer', 'en');
    await flush();
    const third = speaker.speak('third answer', 'en');
    await flush();
    expect(await second).toEqual({ result: 'stopped' });
    expect(speaker.speaking).toBe(true);
    m.synth.finish();
    expect(await third).toEqual({ result: 'ended' });
  });

  it('no matching voice → { result: "novoice" } with a plain-language name, and nothing is spoken', async () => {
    const m = makeSynth(VOICES.filter((v) => !v.lang.startsWith('ur')));
    const speaker = createSpeaker({ ...m, onState: () => {} });
    expect(await speaker.speak('یہ بات میری کیس فائلوں میں نہیں ہے', 'ur')).toEqual({ result: 'novoice', name: 'Urdu' });
    expect(m.synth.speak).not.toHaveBeenCalled();
    expect(VOICE_MESSAGES.noVoice('Urdu')).toMatch(/No Urdu voice is installed/);
  });

  it('an empty text is not spoken; a speech error is reported', async () => {
    const m = makeSynth();
    const speaker = createSpeaker({ ...m, onState: () => {} });
    expect(await speaker.speak('[1][2]', 'en')).toEqual({ result: 'error' });
    const failing = speaker.speak('hello', 'en');
    await flush();
    m.synth.spoken[0].done = true;
    m.synth.spoken[0].onerror({ error: 'synthesis-failed' });
    expect(await failing).toEqual({ result: 'error' });
  });

  it('speechSupported is false without speechSynthesis (the Listen button is then never created)', () => {
    expect(speechSupported({})).toBe(false);
    expect(speechSupported({ speechSynthesis: {} })).toBe(false);
    expect(speechSupported({ speechSynthesis: {}, SpeechSynthesisUtterance: class {} })).toBe(true);
  });
});
