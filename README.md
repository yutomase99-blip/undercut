# Undercut

A motorsport strategy game. You sit on the pit wall, not in the car.

**[Play it →](https://yutomase99-blip.github.io/undercut/)**

Box now or stay out two more laps? Cover the rival or run your own race? Push and
burn the tyre, or save it and watch the car behind close? Every call costs
something, and the race tells you afterwards whether you were right.

```bash
npm install
npm run dev        # play it in the browser
npm test           # 277 tests, including a statistical balance suite
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

## The race runs on a clock

A lap used to be the smallest thing that happened. Positions, gaps, overtakes,
incidents and pit stops were all decided at once, and the interface smoothed the
result afterwards — so nothing could be watched, because nothing happened in
between.

Cars now carry a distance that grows continuously. Pace is still settled a lap
at a time, which is where tyres, fuel and strategy live, but where a car *is*
changes every step. Passes happen at the three places on each circuit where
passing happens, incidents happen at the moment they happen, and a pit stop is a
car standing still for exactly as long as the stop takes.

Every event carries the moment it occurred, so the race can be watched at real
time — 1× is genuinely one second per second — or wound forward to 30×.

## Qualifying

The grid is set by a session, not by a formula.

Open-wheel runs a knockout — twenty cars down to fifteen, then ten, then a
shootout for pole. Endurance runs one session and lets the classes sort
themselves out on pace.

You make one decision per segment, and it is a real one. The track rubbers in as
the session goes on, so a late run is worth up to nine tenths — but everybody
knows that, so the late windows are busy, and traffic gives the time back. Later
windows are also likelier to be ended by a yellow flag, which deletes every lap
set in them. The board shows the net time, how many cars are booked into each
window, and the odds of the flags, so the gamble is informed rather than blind.

**Whatever tyre you set your best time on in the final segment is the tyre you
start the race on.** A lap on softs buys grid position and commits you to
stopping early. That single rule is what makes qualifying part of the race
rather than a prelude to it.

**Tyres are allocated for the weekend, not per session.** Three sets of softs,
three mediums, two hards, and qualifying draws from the same pot the race does.
Run softs in all three segments and you will arrive at the grid with none left:

| | Soft | Medium | Hard |
|---|---|---|---|
| Q1 | 3 | 3 | 2 |
| Q2 | 2 | 3 | 2 |
| Q3 | 1 | 3 | 2 |
| Race | 0 | 3 | 2 |

Which is the point. Without a price, the quickest tyre is simply the right
answer every time, and a choice with one right answer is not a choice.

A car whose lap is deleted starts at the back, whatever class it is in.

## Conditions

A weekend decides its own weather from its seed and its circuit, so a wet
Saturday is something the game hands you rather than something only a test can
arrange. Sable Dunes starts dry in 97 of 100 weekends; Monte Cielo is damp or
wet in one weekend in five.

Qualifying and the race reach the same conclusion independently, because the
conditions are a pure function of the seed and the track rather than something
one session tells the other.

## The setup

Every weekend opens in the garage with one decision: how much wing to run.

Each circuit has an amount it wants — Aurora Bay, tight and walled in, asks for
77%; Nordsee Speedway, all long straights, asks for 38%. Run more or less than
that and you give up lap time, quadratically, in either direction.

But less wing is kinder on the tyres, lighter on fuel, and quicker where passes
actually happen. So stripping the car is a real option on a circuit where you
expect to spend the race in traffic — it just isn't a free one. Over 40 races at
Kestrel Park, a car on the circuit's optimum averages P3.7; the same car
stripped bare averages P10.7.

You are never told the optimum. Your engineers offer a reading, and it is
exactly as good as your team is — the same bargain the weather forecast makes.

## The stewards

Pushing already costs rubber and fuel. It should occasionally cost five seconds
too, or the only reason not to run flat out is arithmetic rather than nerve.

Run wide and you get a warning; the fourth is a five-second penalty. How often
depends on the driver, how hard they are being asked to go, and the circuit —
Aurora Bay, walled in on both sides, hands out around eight times as many
track-limit penalties as open, forgiving Vantor Ring. A scruffy pit stop can
also earn an unsafe release.

Penalties are added at the flag and shown against the car on the timing tower
and in the classification, so a race lost in the stewards' room is a race you
can see being lost.

## A drying track

The sky changes at once; the track takes its time catching up. Rain soaks a
surface in three laps and the sun takes nine to dry it, and a compound's three
weather figures are anchors that everything in between is interpolated across.

That lag is the point. Somewhere around 54% wet, intermediates and slicks are
worth the same lap time — so a drying track gives you several laps where nobody
is sure yet, the cars that gambled early are hanging on, and the ones that
waited are catching up. Snapping between three discrete states skipped that
entirely, which was the most interesting part of a wet race.

## The forecast

The pit wall gets the next six laps of weather, each call carrying its own
confidence.

The whole race's weather is rolled from the seed before the start, so there is a
real future to be more or less right about. The forecast reveals it with an
error that shrinks as a lap approaches — each future lap carries one fixed
measure of doubt, and confidence rises to overtake it. So the forecast
**converges**: once it has a lap right it stops changing its mind, rather than
flickering from lap to lap.

It is also **wrong sometimes**, and more often the further out it looks. A
forecast that is always right is not a decision — it is an instruction. Six laps
out you are being told something worth roughly half a guess; one lap out you can
bet the race on it.

**Every team forecasts for itself**, including yours. A well-drilled team reads
the weather better and commits to a call sooner; a badly run one needs to be
more certain before it moves, and is often still waiting when the rain arrives.
Pick a team at the back of the grid and you will see it in the confidence
figures.

Over 200 wet races, when the first drops fall:

| Team | Crew | Fits wets |
|------|------|-----------|
| Meridian Racing | 0.94 | 2.8 laps before the rain |
| Valdor Works | 0.86 | 2.0 laps before |
| Halvard Racing | 0.74 | 0.9 laps before |
| Corvid Racing | 0.68 | 0.6 laps *after* |

Nobody shares a forecast, which matters more than it sounds: one forecast for
the whole field would put eighteen of twenty cars in the pit lane on the same
lap.

## Drivers, and the car they drive

Every result since the first version has been decided by three numbers per
driver — pace, consistency, aggression — and none of them were ever on screen.
They are now: on the team picker, in the garage before you set the car up, and
in the season hub.

The car is a set of parts rather than a single rating. Engine, aerodynamics and
chassis make it quick; the gearbox decides whether it finishes; the suspension
decides how kindly it treats its tyres. Each has a quality you can improve and a
condition that racing wears away, and a tired part is not the part you bought.

That is the trade a single development number could not express: a quicker
engine, or a gearbox that will still be there in November.

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
