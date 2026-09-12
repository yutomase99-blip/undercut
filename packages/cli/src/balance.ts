import { defaultGrid, openWheelOverLaps, simulate, TEAMS, TRACKS } from '@undercut/engine';
import { pad } from './format.ts';

/**
 * Balance is a property of the content, not a feeling. This runs the whole
 * calendar many times over and reports who actually wins.
 */
const races = Number(process.argv[2] ?? 200);
const wins = new Map<string, number>();
const podiums = new Map<string, number>();
let retirements = 0;
let starters = 0;
let cautions = 0;
let passes = 0;

for (const track of TRACKS) {
  for (let i = 0; i < races; i += 1) {
    const result = simulate(
      {
        track,
        regulations: openWheelOverLaps(track.defaultLaps),
        entries: defaultGrid(),
        // Balance is measured in the dry on purpose: rain is the loudest source
        // of variance in a race, and a balance report should be about the cars.
        startingWeather: 'dry',
      },
      `balance-${track.id}-${i}`,
    );
    const winner = result.classification[0]!;
    wins.set(winner.teamId, (wins.get(winner.teamId) ?? 0) + 1);
    for (const car of result.classification.slice(0, 3)) {
      podiums.set(car.teamId, (podiums.get(car.teamId) ?? 0) + 1);
    }
    retirements += result.classification.filter((c) => c.retired).length;
    starters += result.classification.length;
    cautions += result.events.filter((e) => e.type === 'caution' && e.phase === 'deployed').length;
    passes += result.events.filter((e) => e.type === 'overtake' && e.success).length;
  }
}

const total = races * TRACKS.length;
console.log(`\n  ${total} races across ${TRACKS.length} circuits\n`);
console.log(`  ${pad('TEAM', 24)}${pad('CAR', 6)}${pad('WINS', 8)}${pad('WIN %', 8)}PODIUM %`);
console.log(`  ${'─'.repeat(60)}`);
for (const team of TEAMS) {
  const w = wins.get(team.id) ?? 0;
  const p = podiums.get(team.id) ?? 0;
  console.log(
    `  ${pad(team.name, 24)}${pad(team.carPerformance.toFixed(2), 6)}${pad(String(w), 8)}${pad(((w / total) * 100).toFixed(1), 8)}${((p / (total * 3)) * 100).toFixed(1)}`,
  );
}
console.log(`\n  retirement rate  ${((retirements / starters) * 100).toFixed(1)}%`);
console.log(`  cautions/race    ${(cautions / total).toFixed(2)}`);
console.log(`  passes/race      ${(passes / total).toFixed(1)}\n`);
