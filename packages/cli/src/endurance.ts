import {
  driverById,
  enduranceGrid,
  ENDURANCE_CLASSES,
  enduranceOverHours,
  simulate,
  teamById,
  trackById,
  TRACKS,
} from '@undercut/engine';
import { lapTime, pad } from './format.ts';

const [, , trackArg, seedArg, hoursArg] = process.argv;
const track = trackById(trackArg ?? 'vantor-ring');
const seed = seedArg ?? 'endurance';
const hours = Number(hoursArg ?? 6);

const result = simulate(
  {
    track,
    regulations: enduranceOverHours(hours),
    entries: enduranceGrid(),
    startingWeather: 'dry',
  },
  seed,
);

const clock = (ms: number) => {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

console.log(`\n  ${track.name} — ${hours} hours — seed "${seed}"`);
console.log(`  ${TRACKS.length} circuits available · ${result.classification.length} cars\n`);
console.log(
  `  ${pad('POS', 5)}${pad('CLS', 10)}${pad('#', 4)}${pad('DRIVER', 15)}${pad('TEAM', 22)}${pad('LAPS', 6)}${pad('RACE TIME', 17)}STOPS`,
);
console.log(`  ${'─'.repeat(86)}`);

for (const car of result.classification) {
  const team = teamById(car.teamId);
  const driver = driverById(car.driverId);
  const status = car.retired ? `DNF ${car.retiredCause}` : clock(car.raceTimeMs);
  console.log(
    `  ${pad(String(car.position), 5)}${pad(car.classId.toUpperCase(), 10)}${pad(String(car.classPosition), 4)}${pad(driver.name, 15)}${pad(team.name, 22)}${pad(String(car.lapsCompleted), 6)}${pad(status, 17)}${car.pitStops}`,
  );
}

console.log(`\n  Class winners`);
for (const carClass of ENDURANCE_CLASSES) {
  const winner = result.classification.find((c) => c.classId === carClass.id && c.classPosition === 1);
  if (winner) {
    console.log(
      `   ${pad(carClass.name, 12)} ${teamById(winner.teamId).name} — ${winner.lapsCompleted} laps, best ${lapTime(winner.bestLapMs)}`,
    );
  }
}

const changes = result.events.filter((e) => e.type === 'driverChange').length;
const stops = result.events.filter((e) => e.type === 'pitStop').length;
const cautions = result.events.filter((e) => e.type === 'caution' && e.phase === 'deployed').length;
console.log(`\n  ${stops} pit stops · ${changes} driver changes · ${cautions} full-course yellows\n`);
