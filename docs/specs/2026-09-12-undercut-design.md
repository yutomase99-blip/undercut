# Undercut — Design Spec

**Date:** 2026-09-12
**Status:** stages 1–3 implemented. Stage 4 (season layer) outstanding.

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
| 4 | Season layer | next |

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

## 11. Delivery

TypeScript, Node 22+, Vitest, ESLint. `engine` has zero runtime dependencies.
The web app builds with Vite and deploys to GitHub Pages from CI. MIT licensed.
