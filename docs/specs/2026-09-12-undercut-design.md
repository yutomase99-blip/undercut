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

## 14. Tyre allocation

Sets are issued for the weekend and drawn down by qualifying and the race
alike — the change that gives a qualifying run a price. Before it, the softest
tyre was the right answer in every segment, and a choice with one right answer
is not a choice.

- **The allocation comes from the ruleset**, like everything else that differs
  between the two championships. Endurance gets far more of it, and hoards none
  of it for a qualifying lap.
- **A car can always stop.** A call for a compound the car has run out of is
  substituted for the nearest thing still in the garage rather than refused,
  because a pit stop that cannot happen strands a car for reasons the player
  never sees.
- **The strategist plans against its own garage**, not against the compound
  list. Planning around a set spent in qualifying is how a strategy falls apart
  in the pit lane.

## 15. Conditions at the start

Every caller used to hardcode a dry start, so the wet-weather model — wets,
intermediates, the crossover, wet qualifying — was only reachable if rain
happened to fall mid-race.

- **`startingWeather` is now optional**, and a weekend left to itself rolls the
  conditions from its seed and the circuit's volatility.
- **It is a pure function of seed and track**, not a value one session passes to
  the other, so qualifying and the race agree without being coupled.
- **Balance runs stay explicitly dry.** Rain is the loudest source of variance
  in a race, and a balance report should be about the cars.
- **Nobody starts a wet race on slicks.** Cars knocked out before the final
  qualifying segment are not tied to a tyre and fell back to the compound the
  entry list happened to name, which is mediums. A car is now fitted for the
  conditions unless its entry already suits them, and the set it starts on comes
  out of its weekend allocation like any other.

## 16. A drying track, and a balance regression it uncovered

The weather state machine still decides what the sky is doing, but the track
surface now lags behind it on a continuous 0..1 wetness, and a compound's three
weather figures became anchors interpolated across. Around 54% wet, slicks and
intermediates are worth the same lap time, which is the window the discrete
model had no way to represent.

Building it surfaced a balance regression already merged and already shipped.

**What had happened.** The commit that gave every team its own forecast took the
bottom four teams from 0.3% of wins to 11.7%, and the top three from 96.3% to
61.3%. The balance suite did not fail, because 11.7% sat a hair under its 12%
bar and 61.3% a hair over its 60% one.

**Why.** Teams were allowed to commit to a forecast up to three laps early. Wet
tyres on a dry track cost the better part of seven seconds a lap, so a team
fitting them three laps early threw away twenty seconds to save a handful. The
best-run teams were being punished for their foresight, and the cars that
ignored the forecast won. Anticipation is now one lap, for the teams good enough
to manage it, and nobody else.

**What it also exposed.** A gradient measured after that change — the best team
fitting wets 2.8 laps before the rain — was read as evidence the feature worked.
It was evidence of the bug. Measuring when teams acted said nothing about what
acting cost them.

Two further clustering faults came out of the same investigation:

- The compulsory compound change fired at an identical `lapsRemaining` for every
  car, so the whole field served it together. Each pit wall now leaves itself a
  different amount of room.
- A caution stop was judged against a fixed lap count, so a safety car seven
  laps from the flag sent nineteen of twenty cars down the pit lane for tyres
  that could never pay for themselves. The stop is now judged against the stint
  the car is actually on.

The clustering test was rescoped to green-flag running. A safety car genuinely
does send most of a field into the pits at once; counting those laps measured
the safety car rather than the forecast, which is what the test was written to
watch.

## 17. Setup and the stewards

Two additions that give the existing systems something to push against.

**Setup.** A weekend opens with one number: how much wing. Each circuit has an
amount it wants, derived from how hard it is to pass there, and being wrong
costs lap time quadratically in either direction. Less wing is kinder on tyres,
lighter on fuel, and quicker where passes happen — so stripping the car is a
real option, and not a free one. The player is never told the optimum; their
engineers offer a reading as accurate as the team is well run, exactly as the
forecast does.

The two constants had to be scaled against each other. A 900ms straight-line
advantage against a 1400ms penalty made "strip the car" the right answer
everywhere, because a stripped car passed whoever it liked and finished ahead of
the setup it should have run. It is now 350ms against 1800ms.

**The stewards.** Running wide earns a warning; the fourth is five seconds. The
chance depends on the driver, the pace mode they are on, and how walled-in the
circuit is. A scruffy stop can earn an unsafe release.

The first version was unreachable. At a base rate of 0.012 a car averaged a
quarter of a warning across a race and never came close to the four a penalty
takes: the mechanic existed and could not happen, which is worse than not having
it. That is the third time a feature has been built and left unreachable —
after the wet-weather model and the crossover — and it is worth naming as a
pattern rather than an accident.

Warnings and penalties are stated by the engine as facts, without radio calls.
Twenty cars running wide would drown the team radio in other people's business,
so the interface decides which of them its own driver hears about.

## 18. What playing it said

Four things came back from someone actually sitting down with it, none of which
any test had suggested.

**It went far too fast.** A lap lasted 1.6 seconds and the timing tower only
redrew once a lap, so a gap jumped from 1.8s to 0.9s with nothing in between: a
battle never happened on screen, it turned up already over. A lap now takes six
seconds, there is a 0.5x, and the tower is animated so gaps ease between laps.
Rows where somebody is closing are marked — being near the car ahead is not a
battle, and on the opening laps the whole field is within a second.

**Tyres had no end.** Forty-five minutes of endurance racing on one set of softs
was possible, because past the cliff a set cost time and nothing else. A set now
has a life, and past it a rising chance per lap of letting go. The cliffs are
steeper.

**Drivers were invisible.** Three numbers per driver decided every result and
none were ever shown.

**The car was one number.** "Car performance" went up when money was spent on
it, which is a spreadsheet rather than a car. It is now five parts with a
quality and a condition, and the budget has somewhere to go and something to
trade.

The parts model needed exactly one thing from the engine — a per-team tyre wear
multiplier — because the roster override added for the season layer already
carried everything else. That seam has now paid for itself twice.

## 19. Delivery

TypeScript, Node 22+, Vitest, ESLint. `engine` has zero runtime dependencies.
The web app builds with Vite and deploys to GitHub Pages from CI. MIT licensed.
