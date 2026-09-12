# Undercut — Design Spec

**Date:** 2026-09-12
**Status:** all four stages implemented, plus a qualifying session and a weather
forecast (both added after the original scope).

## 1. What this is

A motorsport management game where the player sits on the pit wall, not in the
car. The fantasy is the strategy call: box now or stay out, push or save, cover
the rival or run your own race.

Two racing worlds are in scope — modern open-wheel and multi-class endurance —
so the engine is not an "F1 sim". It is a race simulation that rulesets plug
into.

## 2. Goals

- A race that is fun to watch and to call, before any economy layer exists.
- Outcomes explainable to the player term by term.
- Determinism: the same seed always produces the same race.
- Two rulesets sharing one engine, proving the abstraction rather than assuming it.

## 3. Non-goals for v1

No real-world teams, drivers or circuits. No driving. No multiplayer, accounts or
backend. No 3D.

## 4. Staging

| Stage | Deliverable | Status |
|-------|-------------|--------|
| 1 | Engine + open-wheel ruleset, headless | done |
| 2 | Web UI, live race | done |
| 3 | Endurance ruleset | done |
| 4 | Season layer | done |

Stage 3 lands before stage 4 deliberately: a `Regulations` interface with one
implementation is always subtly wrong, and the second implementation is what
finds the seam.

**Constraint carried into stage 2:** the UI renders race *progress*, never
"lap 12 of 58" as a hardcoded concept, because endurance races are limited by
duration.

## 5. Architecture

```
packages/
  engine/      pure TS · zero runtime deps · no DOM · no clock · no global RNG
    core/      tick loop, lap-time model, traffic, overtaking, pit, weather
    rules/     Regulations interface + openwheel
    rng/       seeded PRNG split into named streams
    replay/    event log hashing
  web/         Vite app: canvas track map, timing tower, strategy controls
  cli/         headless runner and balance reports
```

`engine` knows nothing about seasons, budgets, UI or storage. It takes
`(config, seed)` and returns a result plus an event log.

Two entry points, one engine: `simulate()` runs a whole race at once;
`createRace().tick()` steps lap by lap for the UI.

**The player is not special.** The UI never mutates race state; it submits the
same `Command` objects an AI strategist emits.

## 6. Race model

```
lapTime = trackBase + carPerf + driverPace + tyreDelta + fuelLoad
        + traffic + paceMode + error
```

Additive, so every term is inspectable and tunable in isolation.

Tyres degrade gently, then fall off a cliff. Dirty air costs time and tyre life
inside 1.3 s of the car ahead. Overtaking is gated on *sustained* pace, not a
single lap. A failed move costs momentum. Weather walks a state machine, and
incidents bring out cautions that bunch the field.

The undercut is never coded; it emerges.

## 7. Determinism

Randomness comes from named independent streams: `grid`, `driverError`,
`mechanical`, `weather`, `pitCrew`, `overtake`, `incident`, `strategy`. A new
draw in one system cannot shift the others, so old seeds stay meaningful.

Enforced two ways: an ESLint rule banning the clock and `Math.random` inside
`engine/`, and a test that scans the engine sources.

## 8. Testing

- **Unit** — tyre curves, fuel effect, pit arithmetic, rule edges.
- **Property** — identical seed gives an identical event-log hash; no impossible
  states; stepped and one-shot runs agree.
- **Statistical** — across hundreds of races, the quick cars win most often, the
  slow cars almost never, and nobody owns the championship.

## 9. What implementation changed

Recorded because each was found by the tests rather than by eye.

1. **Grid fixture, not physics, caused 86% dominance.** Drivers were seated in
   strict rank order, so car quality and driver quality were perfectly
   correlated and no upset was possible. Each team now gets one senior and one
   junior driver, and the fastest driver is deliberately not in the fastest car.
2. **Lap scatter was unrealistically small.** A 0.95-consistency driver varied
   only 21 ms per lap, making a three-second car advantage insurmountable. A
   floor was added to the error sigma.
3. **The qualifying sort drew randomness inside its comparator**, making the
   comparison inconsistent. Times are now drawn once, then sorted.
4. **`refreshOrder()` discarded the grid.** It sorted by race time, which is zero
   for every car before the start, and a stable sort then fell back to entry
   order — so the same car started on pole every race. Grid position is now the
   tiebreak.
5. **Overtaking triggered on single-lap noise**, producing ~320 attempts per
   race. Attacks are now gated on a rolling pace average, with dirty air and a
   failed-move cost. Passes per race fell to a realistic 40–67.
6. **The race clock was tied to `requestAnimationFrame`**, so laps ran in slow
   motion on a slow renderer. The simulation now advances on a timer; frames
   only interpolate.
7. **The pit wall rebuilt its DOM every lap**, destroying focus and hover on the
   controls. It is built once and updated in place.

## 10. What the second ruleset found

Endurance was built before the season layer precisely so the `Regulations`
abstraction would be exercised by a second implementation. It found four bugs
that a single-ruleset engine could never have surfaced:

8. **Qualifying ignored class performance**, so an LMP2 could line up ahead of a
   Hypercar. The class offset is now part of the qualifying lap.
9. **The safety car rewrote the race time of cars that had already finished**,
   retroactively changing a classified result.
10. **The safety car un-lapped the entire field.** Bunching set every car to the
    leader's time plus a fixed gap, so a GT ten minutes down rejoined on the
    leader's gearbox. Whole laps of a deficit are now preserved and only the
    remainder is closed.
11. **An empty fuel tank had no consequence.** A pit wall that never called a
    stop circulated on nothing and won. Running dry now ends that car's race.

Two things also needed to become properties of the ruleset rather than
constants: attrition (a per-lap retirement roll gives a 200-lap race three times
a sprint's failures) and refuelling.

## 11. The season layer

Lives in `packages/season`, and consumes the engine rather than extending it.
The engine gained exactly one thing to support it: an optional per-race roster
override, so a developed car races at today's stats without anything being
written back to the shared catalogue.

Design decisions worth recording:

- **Standings are derived, never stored.** The state holds results; points and
  order are computed. A points-table change cannot desynchronise a save.
- **Development slides against performance, twice over.** Budget is larger for
  slower teams, and an upgrade's gain scales with the headroom a rating has
  left. Both are needed, or the quickest car compounds its advantage until the
  championship is decided in the first month of the second year.
- **The market drafts seat by seat**, in championship order, rather than team by
  team — otherwise the champion signs the two best drivers on the grid before
  anyone else has spoken.
- **Saves are versioned and fail closed.** A save from another schema version,
  or any unreadable value, returns null rather than throwing: a corrupt save
  should cost a season, not the ability to open the game.
- **Storage access is injected**, so persistence is tested without a DOM, and a
  storage that throws on every call (private browsing, blocked site data) is a
  supported case rather than a crash.

## 12. Qualifying

Added after the four staged deliverables. The grid had been decided by a single
abstracted lap per car; it is now a session.

- **The format comes from the ruleset**, like race length and classes before it:
  `Regulations.qualifying` declares a knockout with its segments, or a single
  session. Nothing in `core/` branches on a series name.
- **One run per segment**, and the player chooses two things: which tyre, and
  which window. Track evolution makes late runs quicker, traffic and yellow-flag
  risk make them dangerous, and the board shows all three so the gamble is
  informed.
- **The final-segment tyre starts the race.** This is the rule that makes
  qualifying part of the strategy game: grid position is bought with rubber that
  will not last.
- **The race takes a grid, not a result.** `RaceConfig.startingGrid` is optional
  and the engine falls back to its abstracted lap without it, so every existing
  caller kept working unchanged.
- Adding a `qualifying` randomness stream disturbed no existing seed, which is
  the split-stream design in section 7 paying for itself.

## 13. The weather forecast

The pit wall is given the next six laps of weather with a confidence against
each.

- **The race's weather is rolled up front**, from the seed, at race creation.
  That is what makes a forecast possible: there is a real future to be more or
  less right about rather than a coin waiting to be flipped.
- **Doubt is addressed, not drawn.** `sampleAt(seed, ...keys)` returns *the*
  value for a key rather than the next value in a sequence, so the doubt
  attached to lap 32 is identical every time it is consulted. A stream could not
  do this: the forecast is redrawn every lap, and a sequential draw would give a
  different answer each time.
- **It converges.** Confidence rises as a lap approaches; once it overtakes that
  lap's fixed doubt, the call settles on the truth and stays there. A forecast
  that flickered would be noise rather than information.
- **It is fallible at range**, by design. An infallible forecast is an
  instruction, not a decision.
- **Every team forecasts for itself**, the player included. Three team traits,
  all derived from pit-crew skill (which already stands for how well a team is
  run on a Sunday): how accurate its forecast is, how many laps ahead it will
  commit, and how sure it insists on being first.
- **Sharing one forecast does not work.** With a single forecast the whole field
  reaches the same conclusion on the same lap and eighteen of twenty cars arrive
  in the pit lane together — the failure the reaction delay was added to stop.
  Seeding each team's doubt separately was not enough on its own, because
  confidence only takes a handful of distinct values as a change approaches; the
  commitment threshold had to become personal too, with a per-car bias on top of
  the team's.
- **Anticipation and reaction must play for the same conditions.** When they did
  not, a car that had just fitted wets for expected rain was immediately sent
  back out for dries, because the track was still dry — twenty cars produced
  forty-three stops in three laps. The strategist now decides against the
  conditions it is *playing for* rather than the ones outside the window.

## 14. Delivery

TypeScript, Node 22+, Vitest, ESLint. `engine` has zero runtime dependencies.
The web app builds with Vite and deploys to GitHub Pages from CI. MIT licensed.
