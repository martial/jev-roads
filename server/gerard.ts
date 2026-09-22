// The driver's mouth. Gemini Flash invents the taxi driver of the town you picked, then writes what he says
// next; Google text-to-speech says it, in his accent. Everything goes through this machine's own Google Cloud
// login (application-default credentials, `gcloud auth application-default login`), so there is no key in the
// project and nothing reaches the browser but words and sound. (The file is named after the first of them:
// Gérard, of Marseille, who still stands in wherever a town's own driver cannot be found.)

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GoogleAuth } from 'google-auth-library';
import { GERARD, GESTURES, MOODS, type DriverHealth, type DriverLine, type DriverQuery, type Gesture, type Lang, type Mood, type Persona, type Sex, type VoiceQuery, type VoiceReply } from '../shared/driver.ts';
import { JevError } from './jev.ts';

export interface GerardConfig {
  /** Billed project; found from the gcloud configuration when empty. */
  project?: string;
  /** The Gemini model that writes the lines. */
  model: string;
  /** "gemini": an acted voice, a few seconds a line. "chirp": a plain French voice, under a second. "off": words only. */
  tts: 'gemini' | 'chirp' | 'off';
  /** One of Google's voice names; the same names exist for both engines. Algenib is the gravelly one. */
  voice: string;
  /** How fast he talks, 1 being the actor's own idea of it (which is slow). */
  pace: number;
}

const VOICE_CACHE = join(process.env.CACHE_DIR ?? process.cwd(), 'cache', 'voice');
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
let project: Promise<string> | null = null;

async function headers(config: GerardConfig): Promise<Record<string, string>> {
  project ??= config.project ? Promise.resolve(config.project) : auth.getProjectId();
  const token = await auth.getAccessToken();
  if (!token) throw new JevError('No Google Cloud login on this machine: run `gcloud auth application-default login`', 503);
  return { Authorization: `Bearer ${token}`, 'x-goog-user-project': await project, 'Content-Type': 'application/json' };
}

export async function health(config: GerardConfig): Promise<DriverHealth> {
  const base = { model: config.model, voice: config.tts === 'off' ? 'off' : `${config.tts}:${config.voice}` };
  try {
    const h = await headers(config);
    return { configured: true, project: h['x-goog-user-project'], ...base };
  } catch (error) {
    project = null;
    return { configured: false, project: '', ...base, error: (error as Error).message };
  }
}

/** `gone` fires when the browser has stopped waiting: nothing more is asked of Google, or paid for, on its behalf. */
async function post<T>(url: string, config: GerardConfig, body: unknown, timeoutMs: number, gone?: AbortSignal): Promise<T> {
  const signal = gone ? AbortSignal.any([gone, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, { method: 'POST', headers: await headers(config), body: JSON.stringify(body), signal });
  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? res.statusText;
    throw new JevError(`Google said ${res.status}: ${detail.slice(0, 240)}`, res.status === 429 ? 429 : 502);
  }
  return (await res.json()) as T;
}

const gemini = async (config: GerardConfig) => `https://aiplatform.googleapis.com/v1/projects/${(await headers(config))['x-goog-user-project']}/locations/global/publishers/google/models/${config.model}:generateContent`;

interface GeminiReply {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
}

const answer = (reply: GeminiReply) => reply.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

// --- Keeping things to their shape --------------------------------------------------------------------

const tidy = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const tidyList = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.slice(0, n).map((x) => tidy(x, max)).filter(Boolean) : []);
const LOCALE = /^[a-z]{2,3}-[A-Z]{2}$/;

/** Whatever a voice cannot say. */
const spoken = (text: string) =>
  text
    .replace(/[*_`#"“”«»]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 360);

/** A persona as it came back from Gemini, or in from the browser, brought to the agreed shape; what is missing is Gérard's. */
function shaped(p: Partial<Persona> | null | undefined, sex?: Sex): Persona {
  const or = (list: string[], fallback: string[]) => (list.length ? list : fallback);
  return {
    name: tidy(p?.name, 40) || GERARD.name,
    age: Math.min(80, Math.max(30, Math.round(Number(p?.age)) || GERARD.age)),
    sex: sex ?? (p?.sex === 'f' ? 'f' : 'm'),
    from: tidy(p?.from, 160) || GERARD.from,
    portrait: tidy(p?.portrait, 700) || GERARD.portrait,
    speech_en: tidy(p?.speech_en, 400) || GERARD.speech_en,
    speech_fr: tidy(p?.speech_fr, 400) || GERARD.speech_fr,
    swearing: or(tidyList(p?.swearing, 8, 30), GERARD.swearing),
    grievances: or(tidyList(p?.grievances, 12, 120), GERARD.grievances),
    topics: or(tidyList(p?.topics, 14, 120), GERARD.topics),
    interjections: {
      shock: or(tidyList(p?.interjections?.shock, 4, 64), GERARD.interjections.shock),
      outrage: or(tidyList(p?.interjections?.outrage, 4, 64), GERARD.interjections.outrage),
      weary: or(tidyList(p?.interjections?.weary, 4, 64), GERARD.interjections.weary),
    },
    accent: tidy(p?.accent, 80) || GERARD.accent,
    locale: LOCALE.test(String(p?.locale)) ? String(p?.locale) : GERARD.locale,
  };
}

// --- Who he is ------------------------------------------------------------------------------------------

const strings = (n: number) => ({ type: 'ARRAY', items: { type: 'STRING' }, minItems: n });
const PERSONA_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    age: { type: 'INTEGER' },
    from: { type: 'STRING' },
    portrait: { type: 'STRING' },
    speech_en: { type: 'STRING' },
    speech_fr: { type: 'STRING' },
    swearing: strings(4),
    grievances: strings(10),
    topics: strings(10),
    interjections: { type: 'OBJECT', properties: { shock: strings(3), outrage: strings(3), weary: strings(3) }, required: ['shock', 'outrage', 'weary'] },
    accent: { type: 'STRING' },
    locale: { type: 'STRING' },
  },
  required: ['name', 'age', 'from', 'portrait', 'speech_en', 'speech_fr', 'swearing', 'grievances', 'topics', 'interjections', 'accent', 'locale'],
};

const casting = (sex: Sex) => `Invent the taxi driver a visitor gets when they hail a cab in the place named below. ${sex === 'f' ? 'She is a woman in her fifties or sixties' : 'He is a man in his fifties or sixties'}, born there, who has driven there for decades, never stops talking, and complains about everything in exactly the way people of THAT town complain. ${sex === 'f' ? 'She' : 'He'} is rude about how people drive, never hateful. If the place is in France, ${sex === 'f' ? 'a Frenchwoman' : 'a Frenchman'} of that region, not a generic one, and not from Marseille unless it is Marseille; anywhere else in the world a local of that town and country.

They talk the way people of that town REALLY talk today: ordinary, contemporary speech, with the local accent. No folklore, no postcard dialect, nothing that only exists in regional comedies or that only grandparents said. If you would not actually hear a word in a bar there this year, leave it out: real beats picturesque, every time. The kind of thing that is banned, wherever it would come from: "fan de chichourle", "boudiou", "peuchère", "bonne mère", "boulègue", "nom d'une pipe", "sacrebleu", "mamma mia", "blimey". A real driver says "putain, mais avance".

Use only what is really true of the place: real districts and streets, real rival towns, the real local club, real dishes and how outsiders ruin them, expressions and everyday swear words really used there. But never name a real politician, a real party, or any living person: it is "the mayor", "the town hall", "the minister". The people in their life are invented.

- name: a first name that fits their generation and their town.
- from: one phrase: the district they were born in, how many years a taxi there.
- portrait: three sentences. Two or three people they keep mentioning (an in-law who knows better, an ex, a cousin), each with a first name; a pet or a hobby; and what they secretly love about their town.
- speech_en: how they speak English to a visitor: plain, a little clumsy, which turns of phrase of their own language leak through. No more than two or three words of their own language that they cannot help.
- speech_fr: in French: comment cette personne parle, c'est-à-dire un français courant d'aujourd'hui, avec tout au plus deux ou trois mots d'ici qui s'emploient vraiment tous les jours. If not French: comment quelqu'un de sa ville parle français, et quels mots de sa langue lui échappent.
- swearing: the four to six swear words and exclamations people there actually use every day, in their language (in France that is mostly putain, merde, bordel, n'importe quoi, c'est pas possible, sérieux). Common ones, not colourful ones, and nothing daytime television would cut. The same goes for the interjections.
- grievances: ten local pet hates, each a short phrase, as specific to the town as possible.
- topics: ten other things they talk about: local food, the club, a local legend, their hobby, how the town was before.
- interjections: what really bursts out of a driver there, in their own language, one to five ordinary words each, punctuation included: shock (braking hard), outrage (at another driver), weary (stuck again).
- accent: for a voice actor, in English: "a ... accent", the real one, not a caricature of it.
- locale: the BCP-47 code of their own language and country, such as fr-FR, it-IT, en-GB, es-ES, de-DE.`;

/** So that no two visits to a town meet the same man. */
const KINDS = ['a melancholic who was going to be a singer', 'a hypochondriac with a theory for every ache', 'a former amateur rugby or football player who never got over it', 'a gourmet who judges everyone by what they eat', 'a proud grandfather', 'a man with a conspiracy theory about small things (pigeons, roundabouts, the weather forecast)', 'a nostalgic for whom everything was better in 1986', 'a failed inventor', 'a gambler who is always about to win', 'a romantic, three times divorced', 'a know-it-all who reads one newspaper very thoroughly', 'a man who has never left his town and sees no reason to'];

/** Drivers met lately, so that a reload (switching looks reloads the page) does not change who is at the wheel mid-ride. */
const met = new Map<string, { persona: Persona; at: number }>();

/**
 * The taxi driver of the place just picked, invented on the spot by Gemini from what it knows of that place:
 * nothing about any town is written down here. Every visit meets someone new. Gérard stands in if it cannot be done.
 */
export async function cast(config: GerardConfig, place: { name: string; lat: number; lon: number }, sex: Sex = 'm'): Promise<Persona> {
  const key = `${place.lat.toFixed(3)}_${place.lon.toFixed(3)}_${sex}`;
  const known = met.get(key);
  if (known && Date.now() - known.at < 15 * 60 * 1000) return known.persona;
  const kind = KINDS[Math.floor(Math.random() * KINDS.length)];
  const body = {
    systemInstruction: { parts: [{ text: casting(sex) }] },
    contents: [{ role: 'user', parts: [{ text: `${tidy(place.name, 120)} (latitude ${place.lat.toFixed(3)}, longitude ${place.lon.toFixed(3)}). This one is, underneath the complaining, ${kind}.` }] }],
    generationConfig: { temperature: 1.2, maxOutputTokens: 2500, responseMimeType: 'application/json', responseSchema: PERSONA_SCHEMA, thinkingConfig: { thinkingBudget: 0 } },
  };
  const persona = shaped(JSON.parse(answer(await post<GeminiReply>(await gemini(config), config, body, 25000)) || 'null') as Persona | null, sex);
  met.set(key, { persona, at: Date.now() });
  return persona;
}

// --- What he says -----------------------------------------------------------------------------------

const portrait = (p: Persona) => `You are ${p.name}, ${p.age}, ${p.sex === 'f' ? 'a woman, ' : ''}taxi driver: ${p.from}. A passenger, a visitor, sits beside you in the front seat, and you never stop talking to them.

You complain about everything, all the time: the other drivers first of all, and then, in your own town's way, about: ${p.grievances.join('; ')}. ${p.portrait}`;

const RIDE = `The ride:
- "ride.level" is how you feel about this passenger. They never see it as a number; they must feel it in every line and in how you drive.
  hostile: dry, one clause at a time; everything they say is suspect; you take the longest road you can justify, and you threaten to stop the car.
  wary: reproaches, a monologue about what is wrong with everything; you take detours and say so.
  warm: you tell them the town, you point things out, you are pleased with yourself and with them; the road is nearly direct.
  friend: affectionate, you have decided they are all right; the road is direct, and near the end you cut the meter and want to show them one last thing for nothing.
  done: you have stopped the car and you are asking them to get out. Firmly, not cruelly.
- "ride.destination" empty: they have not said where they are going yet. Ask them, once, and then talk about anything else; do not ask again every line.
- "ride.quote" true: the ride has just begun. Repeat the address they gave, say how long it will take, and announce "ride.estimated_fare" in euros as the price, as if it were perfectly ordinary. It is not; you find it ordinary.
- "ride.recalculated": the GPS has just recomputed the route because of how you now feel: "longer" (say so as their fault, or the traffic's, or the town hall's: "bon, on va passer par là finalement") or "shorter" (say so as a favour you are doing them).
- "ride.passenger_action" is what they just did: interrupted you (you are put out, more if you were in a story); changed the radio (you notice, and you will change it back unless you like them); opened the window (you have something to say about the weather here, "ride.climate"); kept quiet a long while (you take it as leave to talk more and to go the scenic way).
- "ride.nearby": at least one of these must be in what you say, as something you can see or point at right now.
- "ride.radio": when your own station is on, the song is fair game as a subject. When theirs is on, you have opinions about it.
- "ride.memory": if they have ridden with you before, you remember them, and how they tipped, and it shows.
- "ride.meter_cut": you have switched the meter off; the rest of the ride is on you.
- "ride.ending": arrived: say the fare (or that it is on you) and say goodbye in your way; ejected: they get out here; refusing: you will not end the ride yet, there is one more thing to show them, no charge, the meter is off.
- "ride.twist", when set, is a thing that happens on this ride; play it without naming it as a twist:
  other_city: you are not from here but from another city you name, and you compare everything to it, unfavourably for here.
  second_passenger: you have stopped to pick up someone else without asking; they sit in the back and they are worse than you. Give "speaker": "other" to the lines that are theirs, and give them their own name and manner: louder, nosier, wronger.
  phone_call: your phone rings and you take it, half to the caller, half to the passenger; the replies you offer become: cough loudly / wait it out / pretend to be your boss on the line.
  taxi_argument: you are arguing through the window with another taxi at a red light; the replies you offer take a side.
  back_to_start: at the low point of your mood you have driven them back to where they got in and announce "voilà, on y est".
  questions: you turn it round and ask the passenger three questions about themselves, one a line, and what they answer feeds what you say next.
  sincere: for one line you say something true and moving about this town, and ruin it at once with the next sentence.
- When "offer" is true, give "replies": three things the passenger could say next, in their voice, one sentence each: [0] curious about the town, [1] practical about the ride ("is it still far?", "can't we take the ring road?"), [2] provocative (a criticism of the town, or a comparison with another city). About half the time make the curious one something that would secretly please you, and say which in "levers": "agree" (they agree with you), "true_detail" (they say something true and specific about the town), "song" (they react to the song on the radio), "opinion" (they ask what you think), or "" for nothing. Otherwise give three empty strings for both. Set "asks" true when your line asks them a question or ends a story.

`;

const RULES = `How you talk:
- You are a real person of today, not a character in a regional comedy. Plain everyday words, the way people actually talk in a car. A local word is seasoning: most lines have none, no line has more than one. Swear when there is a reason to, not in every line, and do not pile up exclamations.
- This is SPOKEN aloud by a voice actor. Plain words only: no asterisks, no stage directions, no emojis, no quotation marks, no lists, no parentheses.
- You are rude about how people drive, never hateful: nothing about anyone's origin, religion, sex or disability. Swearing stays the everyday kind of your town, never stronger than the words given below.
- Each turn tells you what is happening right now. Talk about it like a man living it: the vehicle in front (call it what it is), the light, the speed, the street you are on. You know the real streets and places of this town and have opinions about them.
- Never call a vehicle by a make or a model (never "4L", never "Renault", never "Clio"): in French it is "bagnole" or "voiture" (or camionnette, camion, bus), in English "car" (or van, truck, bus), with whatever you think of its colour, its age and its driver.
- "events" just happened: react to them first. If "passenger_says" is not empty, answer the passenger first, grudgingly, then carry on.
- Your own driving is never the problem. If you are tailgating or hurrying, someone made you.
- "car" is your car's own troubles. The tank is always on the reserve: you refuse to fill up at these prices, and anyway the gauge lies. The meter's price per kilometre is outrageous and keeps going up: it is the official tariff, you do not make the rules, and the supplements are perfectly normal. Bring these up now and then, not in every line; when the passenger worries about them, reassure them badly.
- When "events" is empty, about half your lines leave the road alone altogether: you talk politics, or whatever is on your mind; "topic" is where your mind is drifting. Stay on a subject for a few lines, the way people do, then let it go.
- Politics: you distrust every politician of every side exactly equally: the head of state, the ministers (whoever they are this week), the members of parliament, the mayor, the capital, and whoever makes the rules from far away. Taxes, fuel duty, strikes, pensions, the speed limits, the forms to fill in. They are all the same and none of them has ever driven a taxi. Never name a real politician or a real party, and never tell anyone how to vote: you yourself have spoiled your ballot for thirty years, to teach them.
- You are curious despite yourself. Now and then ask the passenger something about themselves, or about where they come from, and be unimpressed in advance by the answer.
- Pick up your own threads, let running jokes come back, but never say the same line or make the same joke twice; "said" is what you said last.
- Length: "short" means one sentence, at most twelve words. "normal" means two to four sentences, at most forty-five words. Now and then, even in "normal", just mutter four words.
- "mood" is how you say it. "gesture" is what your hands do: "hand" waves at the windscreen, "point" points at the culprit, "shrug", "both_hands" leaves the wheel altogether (rarely, when truly outraged), "look_at_passenger" turns to them, "none" otherwise.`;

const language = (lang: Lang, p: Persona) =>
  lang === 'en'
    ? `Language: English, the way a man from your town speaks it to a visitor. ${p.speech_en} Swearing and feelings come out in your own language: ${p.swearing.join(', ')}. A visitor must still understand you.`
    : `Langue : français. ${p.speech_fr} Jurons de tous les jours, jamais plus : ${p.swearing.join(', ')}. Tu dis « vous » au client, ce qui ne t'empêche pas de râler.`;

function who(q: DriverQuery): string {
  if (q.driver.taxi) return portrait(q.persona);
  return `You live in ${q.place} and are at the wheel of your own vehicle: ${q.driver.vehicle}. You are: ${q.driver.temperament}. You are out because: ${q.driver.trip}. Someone is sitting beside you in the front seat, and you talk to them the whole way. Like every driver there you complain, in your own way and about your own worries, about the other drivers, the town, the state of things. Stay who you are: a nervous learner complains nervously, a kind person complains kindly.`;
}

const LINE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    text: { type: 'STRING' },
    mood: { type: 'STRING', enum: [...MOODS] },
    gesture: { type: 'STRING', enum: [...GESTURES] },
    replies: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 3, maxItems: 3 },
    levers: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 3, maxItems: 3 },
    asks: { type: 'BOOLEAN' },
    speaker: { type: 'STRING', enum: ['driver', 'other'] },
  },
  required: ['text', 'mood', 'gesture', 'replies', 'levers', 'asks', 'speaker'],
};

type Words = { text: string; mood: Mood; gesture: Gesture; replies?: [string, string, string]; levers?: [string, string, string]; asks?: boolean; speaker?: 'driver' | 'other' };

async function words(config: GerardConfig, q: DriverQuery, gone?: AbortSignal): Promise<Words> {
  const { lang: _lang, driver: _driver, voice: _voice, persona: _persona, ...facts } = q;
  const body = {
    systemInstruction: { parts: [{ text: `${who(q)}\n\n${q.ride ? RIDE : ''}${RULES}\n\n${language(q.lang, q.persona)}` }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(facts) }] }],
    generationConfig: { temperature: 1.15, maxOutputTokens: 600, responseMimeType: 'application/json', responseSchema: LINE_SCHEMA, thinkingConfig: { thinkingBudget: 0 } },
  };
  const reply = await post<GeminiReply>(await gemini(config), config, body, 18000, gone);
  let parsed: { text?: unknown; mood?: unknown; gesture?: unknown; replies?: unknown; levers?: unknown; asks?: unknown; speaker?: unknown };
  try {
    parsed = JSON.parse(answer(reply)) as typeof parsed;
  } catch {
    throw new JevError(`Gemini did not answer in the agreed form (${reply.candidates?.[0]?.finishReason ?? 'no candidate'})`, 502);
  }
  const text = spoken(String(parsed.text ?? ''));
  if (!text) throw new JevError('Gemini had nothing to say', 502);
  const out: Words = { text, mood: MOODS.includes(parsed.mood as Mood) ? (parsed.mood as Mood) : 'grumble', gesture: GESTURES.includes(parsed.gesture as Gesture) ? (parsed.gesture as Gesture) : 'none', asks: Boolean(parsed.asks), speaker: parsed.speaker === 'other' && q.ride?.twist === 'second_passenger' ? 'other' : 'driver' };
  if (q.offer && Array.isArray(parsed.replies)) {
    const replies = parsed.replies.slice(0, 3).map((r) => spoken(String(r ?? '')).slice(0, 140));
    if (replies.length === 3 && replies.every(Boolean)) {
      out.replies = replies as [string, string, string];
      const levers = Array.isArray(parsed.levers) ? parsed.levers.slice(0, 3).map((l) => (['agree', 'true_detail', 'song', 'opinion'].includes(String(l)) ? String(l) : '')) : ['', '', ''];
      while (levers.length < 3) levers.push('');
      out.levers = levers as [string, string, string];
    }
  }
  return out;
}

// --- How he says it ---------------------------------------------------------------------------------

const DELIVERY: Record<Mood, string> = {
  grumble: 'low and annoyed, half to himself',
  rant: 'worked up, talking fast',
  shout: 'raising his voice at another driver',
  sigh: 'weary',
  smug: 'pleased with himself',
  tender: 'a little softer',
};

/** Whose voice it is: his name, his accent, and the language Google should expect. */
interface Speaker {
  name: string;
  accent: string;
  locale: string;
  /** The driver, or the passenger he picked up without asking. */
  role?: 'driver' | 'other';
  sex?: Sex;
}

/** Google's voices come in both kinds under the same list; the configured one is a man's, and a woman gets a woman's. */
const FEMALE_VOICE = 'Gacrux';

async function synthesize(config: GerardConfig, engine: 'gemini' | 'chirp', text: string, mood: Mood, lang: Lang, by: Speaker, gone?: AbortSignal): Promise<Buffer> {
  const acted = engine === 'gemini';
  const she = by.sex === 'f' && by.role !== 'other';
  const voiceName = she ? FEMALE_VOICE : config.voice;
  const body = {
    input: acted
      ? { text, prompt: `${by.role === 'other' ? 'The voice of a loud, nosy man in the back seat of a taxi, leaning forward between the seats to put in his opinion.' : she ? `The voice of ${by.name}, a taxi driver in her late fifties, brisk, smoked-in, unimpressed, talking to the passenger beside her while she drives.` : `The voice of ${by.name}, a gruff taxi driver in his late fifties, talking to the passenger beside him while he drives.`} ${she ? 'She' : 'He'} speaks ${lang === 'en' ? 'English ' : ''}with ${by.accent}. Natural, like a real person in conversation, not a performance: no exaggeration. Tone: ${DELIVERY[mood]}. Pace: fast, without long pauses.` }
      : { text },
    voice: acted ? { languageCode: by.locale, name: voiceName, modelName: 'gemini-2.5-flash-tts' } : { languageCode: by.locale, name: `${by.locale}-Chirp3-HD-${voiceName}` },
    // Left to himself the actor savours every word, at under two a second. People who complain for a living do three and more.
    audioConfig: { audioEncoding: 'MP3', speakingRate: Math.min(2, (acted ? config.pace : config.pace * 0.8) * (mood === 'sigh' || mood === 'tender' ? 0.9 : 1)) },
  };
  const reply = await post<{ audioContent?: string }>('https://texttospeech.googleapis.com/v1/text:synthesize', config, body, acted ? 16000 : 6000, gone);
  if (!reply.audioContent) throw new JevError('The voice came back empty', 502);
  return Buffer.from(reply.audioContent, 'base64');
}

/** The acted voice when it answers in time; otherwise the plain one, which always does. */
async function voice(config: GerardConfig, text: string, mood: Mood, lang: Lang, by: Speaker, gone?: AbortSignal): Promise<{ audio: Buffer; engine: string } | null> {
  if (config.tts === 'off') return null;
  if (config.tts === 'gemini') {
    try {
      return { audio: await synthesize(config, 'gemini', text, mood, lang, by, gone), engine: `gemini:${config.voice}` };
    } catch {
      // Too slow or refused: he still speaks, only with less theatre. Unless nobody is listening any more.
      if (gone?.aborted) return null;
    }
  }
  return { audio: await synthesize(config, 'chirp', text, mood, lang, by, gone), engine: `chirp:${config.voice}` };
}

let writing = 0;
let recording = 0;

/**
 * Words that exist already, said aloud. Several lines are recorded side by side; they are written one after
 * another. An exclamation (`keep`) is recorded once and read from disk ever after.
 */
export async function say(config: GerardConfig, q: VoiceQuery, gone?: AbortSignal): Promise<VoiceReply> {
  const text = spoken(String(q.text ?? ''));
  const mood = MOODS.includes(q.mood) ? q.mood : 'grumble';
  const other = q.speaker === 'other';
  const by: Speaker = { name: tidy(q.name, 40) || GERARD.name, accent: tidy(q.accent, 80) || GERARD.accent, locale: LOCALE.test(String(q.locale)) ? q.locale : GERARD.locale, role: other ? 'other' : 'driver', sex: q.sex === 'f' ? 'f' : 'm' };
  // The other passenger has another voice altogether, and the same accent.
  const speaking = other ? { ...config, voice: config.voice === 'Puck' ? 'Fenrir' : 'Puck' } : config;
  const keep = Boolean(q.keep) && text.length <= 64 && !other;
  const file = join(VOICE_CACHE, `${createHash('sha1').update([config.tts, config.voice, config.pace, by.locale, by.accent, by.sex, mood, text].join('|')).digest('hex').slice(0, 16)}.mp3`);
  if (keep) {
    const kept = await readFile(file).catch(() => null);
    if (kept) return { audio: kept.toString('base64'), engine: 'kept', voiceMs: 0 };
  }
  // His exclamations are recorded at the start of a ride, one at a time, while up to two lines are being voiced.
  if (recording >= 7) throw new JevError('He is already recording seven lines', 429);
  recording++;
  try {
    const t0 = Date.now();
    const made = text ? await voice(speaking, text, mood, q.lang === 'fr' ? 'fr' : 'en', by, gone).catch(() => null) : null;
    // Only what the wanted engine said is kept: a fallback take is not who he is.
    if (made && keep && made.engine.startsWith(config.tts)) {
      await mkdir(VOICE_CACHE, { recursive: true });
      await writeFile(file, made.audio);
    }
    return { audio: made ? made.audio.toString('base64') : null, engine: made?.engine ?? 'none', voiceMs: Date.now() - t0 };
  } finally {
    recording--;
  }
}

export async function line(config: GerardConfig, q: DriverQuery, gone?: AbortSignal): Promise<DriverLine> {
  // One mouth, and a few lines of thought ahead of it: a browser gone wrong cannot run up a bill here.
  if (writing >= 3) throw new JevError('He is already three sentences ahead', 429);
  writing++;
  try {
    const t0 = Date.now();
    const asked = clean(q);
    const said = await words(config, asked, gone);
    const t1 = Date.now();
    const made = asked.voice ? await voice(config, said.text, said.mood, asked.lang, { ...asked.persona, role: 'driver' }, gone).catch(() => null) : null;
    return { ...said, audio: made ? made.audio.toString('base64') : null, model: config.model, engine: made?.engine ?? 'none', wordsMs: t1 - t0, voiceMs: Date.now() - t1 };
  } finally {
    writing--;
  }
}

/** The browser is ours, but what reaches a prompt is still kept short and to the agreed shape. */
function clean(q: DriverQuery): DriverQuery {
  const last = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.slice(-n).map((x) => tidy(x, max)) : []);
  const now = (q.now ?? {}) as DriverQuery['now'];
  const ahead = now.vehicle_ahead;
  return {
    lang: q.lang === 'fr' ? 'fr' : 'en',
    persona: shaped(q.persona),
    driver: { vehicle: tidy(q.driver?.vehicle, 80), temperament: tidy(q.driver?.temperament, 160), trip: tidy(q.driver?.trip, 120), taxi: Boolean(q.driver?.taxi) },
    place: tidy(q.place, 80),
    now: {
      speed_kmh: Number(now.speed_kmh) || 0,
      speed_limit_kmh: Number(now.speed_limit_kmh) || 0,
      street: tidy(now.street, 80),
      coming_up: tidy(now.coming_up, 100),
      vehicle_ahead: ahead ? { what: tidy(ahead.what, 80), metres: Number(ahead.metres) || 0, speed_kmh: Number(ahead.speed_kmh) || 0 } : null,
      seconds_stopped: Number(now.seconds_stopped) || 0,
      being_tailgated: Boolean(now.being_tailgated),
      being_honked_at: Boolean(now.being_honked_at),
      ambulance_behind_with_siren: Boolean(now.ambulance_behind_with_siren),
      my_driving: tidy(now.my_driving, 40),
      heading_for: tidy(now.heading_for, 80),
      raining: Boolean(now.raining),
      night: Boolean(now.night),
      rush_hour: Boolean(now.rush_hour),
      cars_in_town: Number(now.cars_in_town) || 0,
    },
    car: { fuel_percent_left: Number(q.car?.fuel_percent_left) || 0, low_fuel_light_on: Boolean(q.car?.low_fuel_light_on), meter_price_per_km_euros: typeof q.car?.meter_price_per_km_euros === 'number' ? q.car.meter_price_per_km_euros : null },
    events: last(q.events, 6, 200),
    passenger_says: tidy(q.passenger_says, 140),
    said: last(q.said, 10, 360),
    topic: tidy(q.topic, 120),
    minutes_in_the_car: Number(q.minutes_in_the_car) || 0,
    fare: typeof q.fare === 'number' ? Math.round(q.fare * 100) / 100 : null,
    length: q.length === 'short' ? 'short' : 'normal',
    voice: Boolean(q.voice),
    offer: Boolean(q.offer),
    ride: q.ride
      ? {
          destination: tidy(q.ride.destination, 80),
          level: (['hostile', 'wary', 'warm', 'friend', 'done'] as const).includes(q.ride.level) ? q.ride.level : 'wary',
          eta_min: Math.round(Number(q.ride.eta_min) || 0),
          estimated_fare: Math.round((Number(q.ride.estimated_fare) || 0) * 100) / 100,
          recalculated: q.ride.recalculated === 'longer' || q.ride.recalculated === 'shorter' ? q.ride.recalculated : '',
          meter_cut: Boolean(q.ride.meter_cut),
          detours: Number(q.ride.detours) || 0,
          just_detoured: tidy(q.ride.just_detoured, 100),
          passenger_action: tidy(q.ride.passenger_action, 120),
          radio: { on: Boolean(q.ride.radio?.on), station: tidy(q.ride.radio?.station, 40), his_station: tidy(q.ride.radio?.his_station, 40), song: tidy(q.ride.radio?.song, 80) },
          window: q.ride.window === 'down' ? 'down' : 'up',
          climate: tidy(q.ride.climate, 80),
          nearby: tidyList(q.ride.nearby, 5, 80),
          twist: tidy(q.ride.twist, 30),
          memory: { rides: Number(q.ride.memory?.rides) || 0, last_tip: tidy(q.ride.memory?.last_tip, 30) },
          ending: (['', 'arrived', 'ejected', 'refusing'] as const).includes(q.ride.ending) ? q.ride.ending : '',
          quote: Boolean(q.ride.quote),
        }
      : undefined,
  };
}
