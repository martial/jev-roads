// The contract between the ride (browser) and the driver's mouth (Node). Facts about the ride go in;
// one spoken line comes out, with how he feels about it and what his hands are doing.

export type Lang = 'en' | 'fr';

export const MOODS = ['grumble', 'rant', 'shout', 'sigh', 'smug', 'tender'] as const;
export type Mood = (typeof MOODS)[number];

export const GESTURES = ['none', 'hand', 'point', 'shrug', 'both_hands', 'look_at_passenger'] as const;
export type Gesture = (typeof GESTURES)[number];

/**
 * The taxi driver of one town, invented once by Gemini from what it knows of the place and then kept: the same
 * town always has the same driver. Marseille gets a Marseillais, Lille a ch'ti, Rome a Roman.
 */
export type Sex = 'm' | 'f';

export interface Persona {
  name: string;
  age: number;
  /** A man or a woman at the wheel: the passenger chose on the title page. */
  sex: Sex;
  /** "born in the Panier, thirty-one years a taxi in Marseille". */
  from: string;
  /** Who he is, who he keeps mentioning (a brother-in-law, an ex-wife), what he secretly loves about the town. */
  portrait: string;
  /** How he speaks English to a visitor, and how he speaks his own language: turns of phrase, local words. */
  speech_en: string;
  speech_fr: string;
  /** The everyday swear words of the place. Nothing stronger is ever used. */
  swearing: string[];
  /** Local pet hates: real streets, works, rival towns, the club, the dish outsiders ruin. */
  grievances: string[];
  /** What else he talks about. */
  topics: string[];
  /** What bursts out of him before he has had time to think, in his own language. */
  interjections: { shock: string[]; outrage: string[]; weary: string[] };
  /** For the voice actor: "a thick Marseille accent". */
  accent: string;
  /** The voice's language, as Google names it: "fr-FR", "it-IT". */
  locale: string;
}

/** How the ride is going, as far as the driver is concerned. */
export interface RideFacts {
  /** Where the passenger asked to go, or '' before they said. */
  destination: string;
  /** How he feels about this passenger, never shown as a number: hostile (0-20), wary (21-50), warm (51-80), friend (81-100), done (0). */
  level: 'hostile' | 'wary' | 'warm' | 'friend' | 'done';
  eta_min: number;
  /** What the meter will come to at this rate by this route, in euros: he announces it at the start as if it were normal. */
  estimated_fare: number;
  /** The route was just recomputed (his mood changed): say so, theatrically, and why it is the passenger's fault or their luck. */
  recalculated: '' | 'longer' | 'shorter';
  /** The friend's gesture: the meter has been cut for the rest of the ride. */
  meter_cut: boolean;
  /** Detours taken so far on this ride, and what the last one was, if it was just now. */
  detours: number;
  just_detoured: string;
  /** What the passenger just did, if anything: interrupted, changed the radio, opened the window, kept quiet for a long while. */
  passenger_action: string;
  radio: { on: boolean; station: string; his_station: string; song: string };
  window: 'up' | 'down';
  /** The weather this town has, for the window: "hot, mistral", "cold drizzle". */
  climate: string;
  /** Places within a couple of hundred metres of the taxi right now: he must mention one. */
  nearby: string[];
  /** The twist this ride has, if any, and whether it has started: the driver plays it. */
  twist: string;
  /** What he remembers of this passenger: rides before, and how they tipped last time. */
  memory: { rides: number; last_tip: string };
  /** The end of the ride, when it has come: arrived, thrown out, refusing to end. */
  ending: '' | 'arrived' | 'ejected' | 'refusing';
  /** The ride has just begun: repeat the address and announce the fare and the time. */
  quote: boolean;
}

export interface DriverQuery {
  lang: Lang;
  /** The town's own taxi driver; ignored when someone else is at the wheel. */
  persona: Persona;
  /** Who is at the wheel: the taxi's own driver, or whoever drives the car the rider clicked. */
  driver: { vehicle: string; temperament: string; trip: string; taxi: boolean };
  /** The town, as the map names it. He has opinions about real places. */
  place: string;
  now: {
    speed_kmh: number;
    speed_limit_kmh: number;
    street: string;
    coming_up: string;
    vehicle_ahead: { what: string; metres: number; speed_kmh: number } | null;
    seconds_stopped: number;
    being_tailgated: boolean;
    being_honked_at: boolean;
    ambulance_behind_with_siren: boolean;
    /** How he is driving right now: "cruising", "tailgating", "crawling". Never his fault. */
    my_driving: string;
    heading_for: string;
    raining: boolean;
    night: boolean;
    rush_hour: boolean;
    cars_in_town: number;
  };
  /** The car's own troubles, which he brings up now and then. */
  car: {
    fuel_percent_left: number;
    low_fuel_light_on: boolean;
    /** What the meter charges per kilometre just now, in euros: far too much. null when this is not a taxi. */
    meter_price_per_km_euros: number | null;
  };
  /** What happened since he last spoke, oldest first: "braked hard behind the white delivery van". */
  events: string[];
  /** What the passenger just typed, or '' when they said nothing new. */
  passenger_says: string;
  /** His last lines, oldest first, so that he carries on instead of starting over. */
  said: string[];
  /** A subject to drift towards when nothing is happening. */
  topic: string;
  minutes_in_the_car: number;
  /** What the meter shows, in euros; null when this is not a taxi. */
  fare: number | null;
  /** A reaction wants to be quick and short; a rant may take its time. */
  length: 'short' | 'normal';
  /** The ride, when there is one (there is none while he only drives about). */
  ride?: RideFacts;
  /** Three things the passenger could say next are wanted with this line. */
  offer: boolean;
  /** false: the sound is off, so only the words are wanted. */
  voice: boolean;
}

export interface DriverLine {
  text: string;
  mood: Mood;
  gesture: Gesture;
  /** What the passenger could say next, when they were asked for: curious, practical, provocative, in that order. */
  replies?: [string, string, string];
  /** What each reply secretly does for him: agree, true_detail, song, opinion, or nothing. */
  levers?: [string, string, string];
  /** He asked something, or finished a story: a good moment for the passenger to speak. */
  asks?: boolean;
  /** Who says it: the driver, or the other passenger he picked up. */
  speaker?: 'driver' | 'other';
  /** MP3, base64; null when no voice was wanted or none could be made. */
  audio: string | null;
  /** Which model wrote it, which voice said it, and how long each took. */
  model: string;
  engine: string;
  wordsMs: number;
  voiceMs: number;
}

/** Words already written, to be said: the slow half of a line, asked for separately so that several can be recorded at once. */
export interface VoiceQuery {
  text: string;
  mood: Mood;
  lang: Lang;
  /** Whose voice: the accent and the language it is spoken in. */
  accent: string;
  locale: string;
  name: string;
  /** The other passenger speaks with another voice. */
  speaker?: 'driver' | 'other';
  /** Whose voice, a man's or a woman's. */
  sex?: Sex;
  /** A few words that will be wanted again and again: kept on disk once recorded. */
  keep?: boolean;
}

export interface VoiceReply {
  audio: string | null;
  engine: string;
  voiceMs: number;
}

export interface DriverHealth {
  /** A Google Cloud login was found on this machine. */
  configured: boolean;
  project: string;
  model: string;
  voice: string;
  error?: string;
}

/** Until the town's own driver has been invented, and whenever he cannot be: Gérard, of Marseille. */
export const GERARD: Persona = {
  name: 'Gérard',
  age: 58,
  sex: 'm',
  from: 'born in the Panier, a taxi in and around Marseille for thirty-one years',
  portrait: 'He keeps coming back to his brother-in-law Didier who knows better, his ex-wife Josiane, his back, and his dog Pastaga. Under it all he loves this coast and this job, and now and then, for one sentence, it shows.',
  speech_en: 'Plain, slightly clumsy English with French turns of phrase leaking through ("it is not possible, this"), and French when he swears.',
  speech_fr: "Un français de tous les jours, avec l'accent. De temps en temps un « fada » ou un « dégun », pas plus.",
  swearing: ['putain', 'merde', 'bordel', "n'importe quoi", "c'est pas possible", 'sérieux'],
  grievances: ['the roadworks that never end', 'Parisians who buy everything here', 'tourists who stop in the middle of the road', 'electric scooters', 'roundabouts', 'speed cameras', 'the ride-hailing apps', 'SUVs in streets made for donkeys', 'the mistral', 'the bouillabaisse that tourists are sold'],
  topics: ['the correct way to make aïoli', "your cousin's boat that never leaves the harbour", 'the football last weekend', 'the petanque final you are missing for this ride', 'pastis, and people who put too much water', 'how this coast was thirty years ago'],
  interjections: {
    shock: ['Oh putain !', 'Oh ! Oh ! Oh !', 'Eh oh, doucement !'],
    outrage: ['Non mais oh !', "Mais c'est pas vrai !", 'Non mais je rêve !', "Mais qu'est-ce qu'il fait, lui ?"],
    weary: ['Pfff...', 'Oh là là...', 'Et voilà.'],
  },
  accent: 'a Marseille accent',
  locale: 'fr-FR',
};
