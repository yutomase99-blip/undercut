import {
  defaultGrid,
  driverById,
  openWheelOverLaps,
  simulate,
  teamById,
  trackById,
  TRACKS,
} from '@undercut/engine';
import { gap, lapTime, pad } from './format.ts';

const [, , trackArg, seedArg, lapsArg] = process.argv;
const track = trackById(trackArg ?? TRACKS[0]!.id);
const seed = seedArg ?? 'cli';
const laps = Number(lapsArg ?? track.defaultLaps);

const result = simulate(
  {
    track,
    regulations: openWheelOverLaps(laps),
    entries: defaultGrid(),
  },
  seed,
);

console.log(`\n  ${track.name} — ${laps} laps — seed "${seed}"\n`);
console.log(`  ${pad('POS', 5)}${pad('DRIVER', 16)}${pad('TEAM', 22)}${pad('GAP', 18)}${pad('BEST', 10)}STOPS`);
console.log(`  ${'─'.repeat(70)}`);

for (const car of result.classification) {
  const driver = driverById(car.driverId);
  const team = teamById(car.teamId);
  const status = car.retired ? `DNF (${car.retiredCause})` : gap(car.gapToWinnerMs);
  console.log(
    `  ${pad(String(car.position), 5)}${pad(driver.name, 16)}${pad(team.name, 22)}${pad(status, 18)}${pad(lapTime(car.bestLapMs), 10)}${car.pitStops}`,
  );
}

const headlines = result.events.filter(
  (e) => e.type === 'caution' || e.type === 'weather' || e.type === 'retirement',
);
if (headlines.length > 0) {
  console.log(`\n  Race notes`);
  for (const event of headlines) {
    if (event.type === 'caution') console.log(`   L${event.lap}  safety car ${event.phase}`);
    if (event.type === 'weather') console.log(`   L${event.lap}  weather ${event.from} → ${event.to}`);
    if (event.type === 'retirement')
      console.log(`   L${event.lap}  ${driverById(result.classification.find((c) => c.carId === event.car)!.driverId).name} out (${event.cause})`);
  }
}

const passes = result.events.filter((e) => e.type === 'overtake' && e.success).length;
console.log(`\n  ${passes} passes completed, ${result.events.length} events logged\n`);
