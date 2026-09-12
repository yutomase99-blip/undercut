# Undercut

A motorsport strategy game. You sit on the pit wall, not in the car.

**[Play it →](https://yutomase99-blip.github.io/undercut/)**

Box now or stay out two more laps? Cover the rival or run your own race? Push and
burn the tyre, or save it and watch the car behind close? Every call costs
something, and the race tells you afterwards whether you were right.

```bash
npm install
npm run dev        # play it in the browser
npm test           # 110 tests, including a statistical balance suite
npm run race       # run an open-wheel race headlessly
npm run endurance  # run a six-hour, three-class race headlessly
npm run balance    # simulate the calendar and report who actually wins
```

Two championships share one engine:

- **Open-Wheel** — one class, one driver, a mandatory tyre change, sprint distance.
- **Endurance** — three classes on track together, three drivers to a car,
  refuelling, and a race against the clock rather than a lap count.

## What is in here

```
packages/
  engine/   the simulation: pure TypeScript, zero runtime dependencies
  season/   the championship: standings, development, contracts, saves
  web/      the pit wall: canvas track map, live timing tower, strategy controls
  cli/      headless tools: single races and balance reports
```

Play a single race, or take a team through a season.

## The engine

The engine knows nothing about the interface, and nothing about a championship.
It takes a race configuration and a seed, and returns a classification plus an
event log. Everything else is a consumer of that contract.

**Lap time is additive, never multiplicative.**

```
lapTime = trackBase
        + carPerf + driverPace + tyreDelta + fuelLoad
        + traffic + paceMode + error
```

Every term is a number you can print, so the game can tell you exactly where a
lap went instead of leaving you to guess. It also means balance can be tuned one
dial at a time.

**The undercut is never coded.** It falls out of tyre warmup, fuel burn and pit
loss interacting. No strategy in this game is scripted; if one had to be, the
model would be wrong.

**The same seed always runs the same race.** Randomness comes from named,
independent streams — driver errors, mechanical failures, weather, pit crew,
overtaking, incidents — so adding a new random draw in one system does not shift
every draw in the others and invalidate old seeds. The engine may not read the
clock or touch global randomness; both a lint rule and a test enforce it.

## Balance is a test, not a feeling

`npm test` runs ten thousand-odd simulated laps and asserts that the competitive
order holds: the quick cars win most often, the slow cars almost never do, and no
single team owns the championship. A tuning regression is a red build.

The current shape of the grid, over 480 races across six circuits:

| Team | Car | Wins |
|------|-----|------|
| Arcwright GP | 0.98 | 37.5% |
| Meridian Racing | 1.00 | 36.5% |
| Kestros Motorsport | 0.96 | 21.5% |
| Valdor Works | 0.90 | 4.0% |
| everyone else | — | under 1% |

The fastest driver is deliberately not in the fastest car. When they were paired,
one team won 86% of races and the season was over before it started.

## Rulesets

Racing worlds plug into the engine through a `Regulations` interface: race
length, classes, tyre rules, driver stints, overtaking aids, caution type,
refuelling, attrition. Nothing in `core/` branches on a series name.

Endurance was built second on purpose. An interface with one implementation has
never actually been tested, and the second one found four bugs the first could
not: qualifying ignored class performance, so a GT could out-qualify a Hypercar;
the safety car bunched cars that had already finished, and un-lapped everyone it
touched; and an empty fuel tank had no consequence at all.

A six-hour race at Vantor Ring, for reference:

| Class | Laps | Best lap |
|-------|------|----------|
| Hypercar | 208 | 1:33.850 |
| LMP2 | 199 | 1:38.577 |
| GT | 188 | 1:45.374 |

Around 6% of the field fails to finish, across ten or eleven stops and a driver
change at every one.

## The season

A championship runs a calendar, and between rounds you spend a development
budget on the car. So does everybody else.

Two things keep a season from being decided in March. The development budget
**slides against performance** — the team at the back gets appreciably more to
spend than the champion — and an upgrade's gain scales with the **headroom** a
rating has left, so the same work is worth more to a poor car than a good one.
Without both, the fastest car compounds its advantage and the title is settled
by round three of year two.

At the end of the year the drivers change seats. Teams choose in championship
order, one seat at a time, so the champion gets first pick of lead drivers but
cannot simply take the two best people on the grid before anyone else speaks.
Cars keep everything they were developed into; budgets are handed out afresh.

Seasons are saved to the browser, with a versioned schema — a save from an
older build is declined rather than loaded into a shape it no longer fits.

The season layer never touches the engine's content. A developed car is passed
into the race as a roster override, so the catalogue a season started from is
still there when the next one begins.

## Content

Every team, driver and circuit here is invented. No real-world motorsport
entities, liveries or layouts appear in this project.

MIT licensed.
