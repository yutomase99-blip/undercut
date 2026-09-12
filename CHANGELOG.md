# Changelog

## 2.0.0

A weekend, rather than a race.

Version 1 could simulate a race honestly and let you call strategy during it.
Version 2 makes the hours either side of the race matter: what you bolt to the
car before it runs, what you spend in qualifying, what the sky is doing, and
what the stewards make of how hard you pushed.

### The weekend

- **Setup.** Every weekend opens in the garage with one number: how much wing.
  Each circuit wants a certain amount, and being wrong costs lap time in either
  direction. Less wing is kinder on tyres, lighter on fuel and quicker where
  passes happen — a real option, and not a free one. Your engineers offer a
  reading as accurate as your team is well run.
- **Qualifying** is a session, not a formula. A knockout for the sprint
  championship, a single session for endurance. You choose when to run and on
  what; the track rubbers in as it goes, the late windows get crowded, and a
  yellow flag deletes every lap set in them.
- **Tyres are allocated for the weekend.** Qualifying and the race draw from the
  same pot, so a lap on softs for grid position is a set you will not have on
  Sunday.
- **The tyre you set your best final-segment time on starts the race.**

### Conditions

- **A weekend decides its own weather** from its seed and its circuit. Sable
  Dunes starts dry in 97 weekends out of 100; Monte Cielo is damp or wet in one
  in five.
- **The track dries by degrees.** Rain soaks a surface in three laps and the sun
  takes nine. Around 54% wet, slicks and intermediates are worth the same lap
  time, which is a window several laps long rather than a moment.
- **A forecast on the pit wall**, six laps out, each call carrying its own
  confidence. It converges as a lap approaches and it is wrong sometimes, which
  is what makes it a decision rather than an instruction.
- **Every team forecasts for itself**, yours included. A well-drilled team reads
  the weather better and commits sooner; a badly run one is still waiting when
  the rain arrives.

### The stewards

- Run wide and you get a warning; the fourth is five seconds. A scruffy stop can
  earn an unsafe release. Pushing now costs rubber, fuel, and occasionally the
  race.

### Underneath

- **Balance is measured across the whole calendar**, with bars set close enough
  to where the game is that a regression fails the build. The previous suite
  measured one circuit with bars loose enough that a regression taking the
  slowest teams from 0.3% of wins to 11.7% went unnoticed for three features.
- 246 tests, from unit checks to statistical assertions about who wins.

## 1.0.0

- A deterministic race engine: additive lap times, a tyre cliff, dirty air,
  emergent undercuts, weather, safety cars.
- Two rulesets sharing one engine: open-wheel and multi-class endurance.
- A championship: standings, development between rounds, a driver market, and
  saves.
- A browser pit wall: track map, live timing tower, strategy controls.
