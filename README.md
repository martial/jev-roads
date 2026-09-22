# Jev Roads

*Enjoy the French driving experience.* A real city, full of cars whose
drivers each decide how to behave with [Jev](https://typesafe.ai), and you in the front passenger seat of a
taxi, beside a driver who was born there, never stops talking, and complains about all of it.

    npm install
    cp .env.example .env                      # put your TYPESAFE_API_KEY in it (or type one on the title page: kept in memory only)
    gcloud auth application-default login     # optional: gives the driver his words and his voice
    npm run dev                               # http://localhost:5185

## Three world modes

**The default is Google Maps + Reconstructed.** Provider and scenery are separate settings, found only in
**Settings → Your world**. Google supplies the picker, search and GPS; the default reconstructed city uses
the existing OSM building footprints, roads and terrain, with Blocks, Real and Toon looks. **3D tiles** switches
to Google's photorealistic landscape, and **Street View** rides between street photos. **OpenStreetMap** remains
an alternative map provider with the reconstructed renderer, requiring no Maps key.

Switching tiles and Street View keeps the current ride; switching to or from Reconstructed reloads the same town
without changing the map provider. Choices are remembered. `?maps=google&scene=reconstructed` selects the default
combination; `?maps=google&scene=tiles`, `?maps=google&scene=street` and `?maps=osm` select the alternatives.

Put `GOOGLE_MAPS_BROWSER_KEY=…` in **`.env.local`** for local development. This file is git-ignored. The key must
belong to a billed Google Cloud project with **Maps JavaScript API** and **Geocoding API** enabled. Restrict it
to these APIs and to your site's HTTP referrers (for development, `http://localhost:5185/*` and
`http://127.0.0.1:5185/*`). Alternatively paste a key in Settings; that override lasts for the browser tab.
Reload after changing a key. The browser key is intentionally public at `/api/maps/config`; the TypeSafe key
and service-account credentials are never returned there. A service account or a signed-in `gcloud` account
can create a browser key, but cannot replace it in the Maps JavaScript loader.

- **Explore:** a native photorealistic 3D picker, Google address search, animated flights, orbit, satellite,
  Street View scouting and a yellow outline showing the playable kilometre.
- **Drive:** Google's streamed landscape and ground-clamped vehicle models, with the existing interactive
  Three.js taxi cabin in front. The native map supplies its own attribution. Camera controls offer Passenger,
  Chase, Orbit and Overhead; dragging stops automatic orbiting. Reduced-motion preferences disable automatic orbiting.
  Each native vehicle keeps its driver's paint via a local GLB variant; the original trim and geometry stay intact.
- **Street View:** an optional passenger mode with actual street imagery. Heading follows the driver's car and
  your head movement, while position advances between nearby panoramas. It is not continuous 3D motion, and the
  cars in the photographs are not simulated traffic. Roads without coverage show an explicit message.
- **Navigate:** Google's road/satellite GPS, optional live traffic, the game's route, numbered detours, a moving
  taxi and destination. The same route is drawn into the 3D world. Live traffic is a visual layer; it does not
  control the simulated cars. The driver's ETA and detours are game logic, not Google directions.

This uses the **native `maps3d` JavaScript library**, not the raw Map Tiles API. Google's EEA guidance identifies
the native library as an alternative where raw Photorealistic 3D Tiles are unavailable.
See [Google's 3D guide](https://developers.google.com/maps/documentation/javascript/3d/get-started),
[API key setup](https://developers.google.com/maps/documentation/javascript/get-api-key), and
[EEA integration guidance](https://developers.google.com/maps/comms/eea/map-tiles).

**Data boundary:** the traffic simulation still gets its lane graph, junctions and road names from OSM,
and cabin geometry from the existing terrain service. Google supplies the displayed maps, search and 3D scenery;
the nine OSM scenery downloads are skipped only in Tiles and Street View modes.
The Google camera and native vehicles are anchored to Google's ground. Photogrammetry still has distorted trees,
cars and facades at street level; there is no native tile-detail setting that reconstructs missing geometry.
The independent OSM lanes can also differ from the captured road, especially on bridges and in tunnels.
Google's photographed scenery keeps its captured lighting, so synthetic rain/night controls are available in Reconstructed mode.

For deployment, set `GOOGLE_MAPS_BROWSER_KEY` in the deployment environment with the deployed site's referrer
restriction. `scripts/deploy.sh` reads `.env`, not your `.env.local` development key. No Google imagery is saved
in the local `maps/` cache.

Validation: `npm run build` checks types and production bundling; `node --import tsx --test scripts/googlemaps.test.ts`
checks coordinate transforms and all nine GLB paint variants. With the dev server and a configured browser
key, `node scripts/check-googlemaps.mjs` exercises the live 3D picker, Google geocoding, satellite, Street View,
camera modes, Google GPS and provider switching in Chrome. It suppresses AI driver requests and writes screenshots
to the git-ignored `shots-out/googlemaps/` directory.

## The original OpenStreetMap world

It opens on a title page with a taximeter that is already running. Pick one of the town signs, or "anywhere else
in the world" for the map: pan, zoom, click a spot (or fly there by name): the yellow square, a
kilometre across, is what gets built. The streets of the whole square come first, so traffic runs
within seconds; then the town rises around them in nine parts, the middle first, while you already
drive. Everything fetched is kept in `maps/<lat>_<lon>/`, so a place is only ever fetched once.
`sh scripts/prefetch.sh` fetches the three places the picker offers.

## The ride, as a game

Pick a town and you are in the front seat. The driver says hello and asks where to; the taxi's screen comes up
with the real map of the kilometre that was built. Touch a street (or a named place) and his GPS draws the road
it has in mind: a tour of the town's far corners, numbered on the map, and only then the address. **It says
thirty minutes whatever the address**, and the price of that as if it were nothing. The game is written on the
screen: *would you arrive before?*

Between you and the driver there is **sympathie**, 0 to 100, shown on the sympathy-o-meter at the top of the
windscreen. It starts at 20 (a stranger in the cab), or where the last ride in this town left it. Every action
comes to a **verdict**, WIN or LOSE, floating up from the GPS with what it did to the road (metres, minutes,
euros) and what is still to go; the world slows a moment; the GPS blinks RECALCUL and redraws, the old route
greyed under the new. A win drops a fifth of the stops left, a loss adds a sixth back; crossing into a warmer
level keeps only that level's share of the tour (wary 55 %, warm 22 %, a friend none: straight there, and the
meter cut for the last stretch). While he is hostile you never arrive at all: get close and the GPS finds
roadworks, a market, a lost satellite, and round you go. At 0 he stops the car and you walk.

The cabin is the controls: click **him** (or the road) to cut him off, click his **radio** (a real station's
live stream: France Inter, FIP, Skyrock, France Musique, NRJ, Radio Classique, Mouv', franceinfo; he switches
it back unless in a good mood), the crank of **your window**, or his **screen** for the big map. Glowing
points mark them. When he has finished a line that asks something, three unlabelled lines to say come up in
slow motion with a seven-second ring: one curious about the town (helps: more if it agrees with him once, says
something true about the place, likes his song, or asks his opinion), one practical about the ride (hurts),
one provocative (hurts more, buys his best rant). Say nothing and it passes as silence, which warms him slowly.
The lines are offered every other speech and never more than half a minute apart.

At the end: the minutes it took against the thirty he promised, and the best time in this town (localStorage);
then a tip (0 € / 1 € / 5 € / 20 %) that sets where the next ride here starts. At most one twist a ride: a
driver from another city, a second passenger (another voice), a phone call, an argument with another taxi at a
red light, a drive back to the start, three questions to you, or a sincere moment ruined at once.
`node scripts/check-ride.mjs` plays a ride through and prints the hidden number after every move.

## The driver

A man or a woman, as chosen on the title page, invented on the spot for the place you picked by Gemini Flash
(`server/gerard.ts`, `/api/driver/cast`; the woman is `driver_f.glb`, built by the same Blender script from the
women's pack, and gets a woman's voice):
a first name, the district he was born in, the brother-in-law he keeps quoting, his town's real pet hates, how
people there actually talk today (the prompt forbids postcard dialect), what bursts out of him when someone
brakes. Cassis gets a man from Cassis, Lille a man from Wazemmes, Rome a Roman. Nothing about any town is written
down in the code, and every visit meets someone new (the same man for a quarter of an hour, so that switching
looks does not change who is at the wheel). Click another car and it is that driver who talks, in character.

- **What he says** (`src/sim/chatter.ts`). The ride is watched for things worth a remark: braking hard, being
  honked at, a light going red under his nose, the car in front not moving on green, a new street, rain, an
  ambulance, what you typed to him. Those facts, his last lines and a drifting subject (his town's, politics,
  the rest of life) go to `/api/driver/line`; one line comes back with a mood and a gesture. He distrusts every
  politician equally and names none; he never calls a car by its make, it is a "bagnole".
- **How he says it.** `/api/driver/voice` has Google speak it, in his accent, fast (`DRIVER_PACE`). Words are
  written one line after another, so that each knows the last; voices are recorded side by side, because that is
  the slow half; lines are said in the order they were written. When something sudden happens he cuts himself off
  with one of his own exclamations, recorded at the start of the ride, and the considered complaint follows a few
  seconds later. If the browser stops waiting for a line, the server stops asking Google for it.
- **The car's own troubles.** The tank is on the reserve and stays a worry (it can run dry: there is a jerrycan
  in the boot). The meter's price per kilometre is absurd and goes up for reasons like "the mistral"; supplements
  appear ("SUPPLÉMENT VUE MER +4,00 €"). All of it shows on the dash screen and the taximeter, and is told to him,
  so he defends it.
- G makes him sulk. EN / FR chooses his language. With the sound off (M) only the words are asked for.
  `DRIVER_TTS=chirp` swaps the acted voice for a plain one that answers in under a second; `off` is subtitles only.
  Without a Google Cloud login the ride is simply silent.

It uses this machine's own Google login (application-default credentials, Vertex AI and Cloud Text-to-Speech
enabled on the project): no key in the project, nothing in the browser. It costs a few cents a minute while
you sit beside him with the page in front of you, and nothing otherwise.

## Three looks

The switch at the top right (or `?look=blocks`, `?look=real`, `?look=toon` in the address) changes how the same town is
drawn. **Blocks** is the voxel city. **Real** (`src/view/real/`) draws it smooth and physically lit: tarmac
ribbons with painted lanes and zebra crossings, raised pavements with kerbs, buildings extruded from their true
footprints with a facade shader (floors, bays, glass that reflects the sky and lights up at night, a zinc mansard in
the north) and, standing proud of every wall (`facade.ts`, instanced by kind and drawn out to the distance at which
it still shows): window surrounds and sills, louvred shutters folded back in the south, balconies with railings,
cornices, awnings over the shops, front doors, drainpipes; tiled hip roofs with overhanging eaves, a fascia, a ridge
and chimneys where the footprint allows, parapets with coping round the flat ones, a physical
sky that also lights the reflections, ambient occlusion, soft bloom, clear-coated car bodies with glass and
wheels, reflective water, rain-wet roads, and the inside of the taxi seen from the front passenger seat
(`cockpit.ts`): dashboard with vents, radio and glovebox, dials, velour seats, window cranks, wing mirrors, wipers
that work in the rain, a little tree swinging from the mirror, a nodding dog, a taximeter, a dash screen that
shows what the car has decided (and now and then what a kilometre costs), and the driver himself (`figure.ts`): a
Quaternius character (CC0) with a full skeleton down to the finger bones, posed bone by bone: seated, hands on the
rim through a two-bone reach with the fingers curled round it, a wave at the windscreen, a finger at the culprit,
both palms up; his jaw, brows and eyelids are shape keys that follow the loudness of his own voice and his mood; he
blinks, and when he turns to you, you turn to him. The car shades its own inside: when you ride, the shadow map is spent on the few
metres around the car, so the roof falls across the dash and his arms across his belly. A new visitor gets the Toon
look; Blocks keeps its own plain cockpit.
**Toon** is the Real renderer with a finishing pass (`src/view/real/toon.ts`): warm ink lines drawn from the
depth and normals the ambient occlusion already renders, light gathered into a few soft-edged washes, shadows
lifted towards plum and highlights towards cream, a breath of paper grain. Real and Toon switch without a reload.

The Real look also has the lie of the land: elevation from the public Terrarium tiles (`server/terrain.ts`,
global, no key), smoothed into a height field (`src/city/terrain.ts`) into which the streets are graded the way
road builders do it — level across, eased along, banks blended back into the slope. The ground, streets,
buildings (dug in uphill, tall downhill), trees, lamps and cars all stand on it, the car pitches on climbs, and
ground away from the streets turns to scrub and bare rock with the slope. The Blocks look stays flat.
Every texture is made in code. The only asset files are models made in Blender by the scripts in
`scripts/blender/`, each of which runs either in an open Blender through the Blender MCP (`make_x.live(out)`, which
builds into a collection of its own) or headless: the driver (`make_driver.py`: assembled from Quaternius's Ultimate
Modular Men, CC0, in `scripts/blender/quaternius/`: the moustached Worker's head without its hard hat, given three
shape keys, the Casual man's body, and a flat cap of our own hung on the head bone; `clay_driver.py` is the
hand-modelled puppet it replaced, kept for the cap's clay tools), eight species of tree (`make_trees.py`: plane, umbrella pine,
cypress, palm, olive, lime, poplar, fir, a few hundred triangles each; which ones grow depends on the latitude,
and a street is planted with one kind, the way streets are), and the nine vehicle bodies in `public/models/` (hatch,
saloon, estate, SUV, coupé, pickup, van, bus, truck; about 1500 triangles and 50 KB each), modelled by
`make_cars.py`, a lower body with a crisp shoulder line, a bevelled glasshouse with inset
windows, wheel wells, lathe-turned wheels, either in an open Blender through the Blender MCP
(`make_cars.live("public/models")`, which builds into a collection of its own) or headless. Each driver's body names
its model (`src/sim/drivers.ts`); the model is stretched to that driver's length, width and height, "paint" takes the
driver's colour, and the file says where its lamps sit. Until a model has arrived, or if it never does, the old
extruded side profile stands in. If the machine cannot hold 24 fps it drops the ambient occlusion, then some resolution.

| key | |
| --- | --- |
| V | ride in the taxi / look from above (from above, click any car to ride in it) |
| drag | look around the car: at him, at the dash, out of your window, at the back seat |
| G | the driver talks / sulks |
| T or Enter | tell your driver something: "go to the sea", "follow the red car", "take me to avenue Foch", "I'm late", "slow down, I feel sick" |
| J | Jev on / off — off, every driver falls back on one fixed habit |
| D | Jev activity: requests, latency, cost, and what each driver just decided |
| M | sound |

Bottom left makes things happen: more cars, fewer cars, rush hour, rain, night, a breakdown, an
ambulance. Horns are silent on purpose (a small "honks" label shows instead).

## Who decides what

Code owns everything that has to be exact or safe. Jev owns judgment.

- **Code** (`src/city`, `src/sim/cars.ts`): the lane graph from OSM — as many lanes side by side as
  the map says (the Étoile ring is tagged 12), turn lanes, one-lane drifts across junctions,
  junction joining, give-way rules including priorité à droite, signals whose green is shared out by
  lanes served — then car following (Intelligent Driver Model), who may enter a junction, braking
  for whoever is already across your path, routing, and a tow truck for the rare jam that cannot clear.
- **Building in parallel** (`src/engine/meshPool.ts`, `mesh.worker.ts`): chunks of the city are meshed
  in a pool of web workers, several at once, each handed a copy of its blocks; new parts of town grow
  up through the old ground. Fetching is parallel too: `overpass.openstreetmap.fr` answers in a second or
  two and takes three queries at once (a new square kilometre arrives in about ten seconds); the German
  `overpass-api.de`, which allows one query at a time with an announced cool-down, is only the fallback.
- **Jev** (`server/jev.ts`, `src/sim/brain.ts`): each driver is a small card — vehicle,
  temperament, reason for the trip — plus the facts of their situation. Up to ten drivers share
  one request; each gets only the questions that matter right now:
  - *style* (Choice): cruise, hurry, tailgate, ease off, crawl, pull over
  - *gap* (Choice): go, wait or nose out, when giving way
  - *amber* (Noul): stop or run it, in the dilemma zone
  - *horn* (Noul), *courtesy* (Noul): honk at the car ahead? let someone in?
  - *turn* (Choice): leave a jammed route — or do what the passenger asked
  - *place* and *vehicle* (Choice, `/api/intent`): what the passenger's words point at. Jev cannot know
    where the sea is or which car is red, so the code lists what exists (`src/sim/places.ts`: street names,
    the sea, water, parks, named landmarks, the four ways out of town; and the vehicles around, described
    as "red small hatchback, 34 m ahead") and Jev picks — or says nothing fits. Code then routes or tails.
- Every threshold stays in code. Jev can make a driver bold; it cannot make them accept a gap under
  1.6 s, enter an occupied junction, or run a red light.

The API key stays in the Vite dev server (`vite.config.ts` → `/api/drive`); the browser never sees
it. Because the API lives in the dev/preview server, `vite build` alone is not a deployable app.

## Checks

    npm run typecheck
    npx tsx scripts/rate-cached.ts 10 0.6 # ten simulated minutes on every place on disk, at 0.6 of street capacity (the default)
    npx tsx scripts/gridlock.ts maps/<place>/streets.json 6 0.6   # who is waiting for whom in the first jam
    npx tsx scripts/probe-style.mts       # live: does Jev read dull and dramatic situations sensibly?
    npx tsx scripts/probe-drive.ts        # live: eight contrasting drivers, all question kinds
    npx tsx scripts/probe-intent.mts      # live: "go to the sea", "follow the red card", French, and sentences that name nothing
    npm run shots                         # headless screenshots of the running dev server
    node scripts/check-models.mjs         # are all nine vehicle models loaded, and is every vehicle drawn from one?
    node scripts/check-driver.mjs 60 en   # sit beside the driver for a minute: every line, its mood, and what it took to make
    node scripts/check-trees.mjs          # which species were planted, with a picture of the thickest avenue

If the TypeSafe account runs out of credits (HTTP 402) the app says so on screen, puts every driver on a
fixed habit and quietly retries once a minute. Cost is capped, not proportional to traffic: at most 2.2 requests a second (about $1.50 an hour). Drivers
near you are asked every few seconds, the far side of town seldom, and beyond 420 m code decides alone.

Map data and picker tiles © OpenStreetMap contributors (ODbL), through the Overpass API, Nominatim and
tile.openstreetmap.org. Elevation: Terrarium tiles (Mapzen/AWS Open Data; SRTM and other public sources).
The reconstructed world needs no map API key. Google modes require the browser key described above.

## Deploying (Google App Engine)

`server/index.ts` serves the build and the same API the dev server uses (`server/api.ts`, shared with
`vite.config.ts`), with a per-address ration on everything that costs money. `app.yaml` runs it on the Node 22
standard runtime; `npm run deploy` writes `env.yaml` from `.env` (the TypeSafe key and the driver settings;
both files are ignored by git), typechecks, and calls `gcloud app deploy`. On App Engine the driver signs in as
the app's own service account, so on the project: enable Vertex AI and Cloud Text-to-Speech, and give
`<project>@appspot.gserviceaccount.com` the Vertex AI User role. Fetched streets, terrain and voices are kept in
`/tmp` while an instance lives (`CACHE_DIR`). `npm run build && npm start` runs the same server at home on
port 8080.
