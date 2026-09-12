import {
  COMPOUNDS,
  createRace,
  defaultGrid,
  driverById,
  openWheelOverLaps,
  teamById,
  trackById,
  TEAMS,
  TRACKS,
  type CompoundId,
  type Race,
  type RaceEvent,
} from '@undercut/engine';
import { createTrackMap, type MapCar } from './trackMap.ts';
import { COMPOUND_LOOK, gap, lapTime, WEATHER_LABEL } from './format.ts';

const app = document.getElementById('app')!;

interface Setup {
  trackId: string;
  teamId: string;
  laps: number;
  seed: string;
}

const setup: Setup = {
  trackId: TRACKS[0]!.id,
  teamId: 'kestros',
  laps: TRACKS[0]!.defaultLaps,
  seed: 'undercut',
};

/** Wall-clock duration of one simulated lap at 1×. */
const LAP_WALL_MS = 1600;
const SPEEDS = [1, 2, 4, 8];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/* ------------------------------------------------------------------ setup */

function renderSetup(): void {
  app.replaceChildren();
  const page = el('div', 'setup');

  const mark = el('h1', 'setup__mark');
  mark.innerHTML = 'Under<em>cut</em>';
  const lede = el(
    'p',
    'setup__lede',
    'You are not driving. You are on the pit wall, watching the gaps and deciding when to box. Tyres fall off a cliff, weather turns, and the safety car ruins everything. Call it right.',
  );

  const grid = el('div', 'setup__grid');

  const trackField = el('div', 'field');
  trackField.append(el('span', 'eyebrow', 'Circuit'));
  const trackChoices = el('div', 'choices');
  for (const track of TRACKS) {
    const button = el('button', 'choice');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(track.id === setup.trackId));
    button.innerHTML = `
      <span class="choice__flag"></span>
      <span class="choice__name">${track.name}</span>
      <span class="choice__meta">${track.defaultLaps} laps</span>`;
    button.addEventListener('click', () => {
      setup.trackId = track.id;
      setup.laps = track.defaultLaps;
      renderSetup();
    });
    trackChoices.append(button);
  }
  trackField.append(trackChoices);

  const teamField = el('div', 'field');
  teamField.append(el('span', 'eyebrow', 'Your team'));
  const teamChoices = el('div', 'choices');
  for (const team of TEAMS) {
    const button = el('button', 'choice');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(team.id === setup.teamId));
    // Spread the five dots across the range the grid actually occupies, so the
    // front-runners are distinguishable instead of all showing full marks.
    const filled = Math.max(1, Math.round(((team.carPerformance - 0.64) / 0.36) * 5));
    const rating = '●'.repeat(filled).padEnd(5, '○');
    button.innerHTML = `
      <span class="choice__flag" style="background:${team.colour}"></span>
      <span class="choice__name">${team.name}</span>
      <span class="choice__meta">${rating}</span>`;
    button.addEventListener('click', () => {
      setup.teamId = team.id;
      renderSetup();
    });
    teamChoices.append(button);
  }
  teamField.append(teamChoices);

  const raceField = el('div', 'field');
  raceField.append(el('span', 'eyebrow', 'Race'));
  const lapsInput = el('input');
  lapsInput.type = 'number';
  lapsInput.min = '5';
  lapsInput.max = '90';
  lapsInput.value = String(setup.laps);
  lapsInput.addEventListener('change', () => {
    setup.laps = Math.max(5, Math.min(90, Number(lapsInput.value) || 30));
    lapsInput.value = String(setup.laps);
  });
  const seedInput = el('input');
  seedInput.type = 'text';
  seedInput.value = setup.seed;
  seedInput.addEventListener('input', () => {
    setup.seed = seedInput.value || 'undercut';
  });
  const seedRow = el('div', 'seed-row');
  seedRow.append(seedInput);
  raceField.append(
    el('span', 'choice__meta', 'Laps'),
    lapsInput,
    el('span', 'choice__meta', 'Seed — the same seed always runs the same race'),
    seedRow,
  );

  grid.append(trackField, teamField, raceField);

  const start = el('button', 'start', 'Go racing');
  start.type = 'button';
  start.addEventListener('click', () => renderRace());

  page.append(mark, lede, grid, start);
  app.append(page);
}

/* ------------------------------------------------------------------- race */

function renderRace(): void {
  const track = trackById(setup.trackId);
  const playerCarId = `${setup.teamId}-1`;
  const race: Race = createRace(
    {
      track,
      regulations: openWheelOverLaps(setup.laps),
      entries: defaultGrid(),
      startingWeather: 'dry',
      playerCarId,
    },
    setup.seed,
  );

  app.replaceChildren();
  const page = el('div', 'race');

  /* header strip */
  const strip = el('div', 'strip');
  const stripMark = el('span', 'strip__mark', 'Undercut');
  const stripTrack = el('span', 'strip__track', track.name);
  const lapCount = el('span', 'badge');
  const progressBar = el('div', 'strip__progress');
  const progressFill = el('span');
  progressBar.append(progressFill);
  const weatherBadge = el('span', 'badge');
  const cautionBadge = el('span', 'badge');
  const transport = el('div', 'transport');
  const pauseButton = el('button', 'speed', 'PAUSE');
  pauseButton.type = 'button';
  transport.append(pauseButton);
  const speedButtons = SPEEDS.map((value) => {
    const button = el('button', 'speed', `${value}×`);
    button.type = 'button';
    button.addEventListener('click', () => {
      speed = value;
      syncTransport();
    });
    transport.append(button);
    return button;
  });
  strip.append(stripMark, stripTrack, lapCount, progressBar, weatherBadge, cautionBadge, transport);

  /* body */
  const body = el('div', 'race__body');
  const left = el('div', 'left');
  const mapPanel = el('div', 'panel map');
  const canvas = el('canvas');
  const mapLabel = el('span', 'eyebrow map__label', track.country);
  mapPanel.append(canvas, mapLabel);

  const wall = el('div', 'panel wall');
  left.append(mapPanel, wall);

  const tower = el('div', 'panel tower');
  const towerHead = el('div', 'tower__head');
  towerHead.innerHTML = `
    <span class="eyebrow" style="text-align:right">P</span>
    <span class="eyebrow">Driver</span>
    <span class="eyebrow" style="text-align:right">Gap</span>
    <span class="eyebrow" style="text-align:right">Last</span>
    <span class="eyebrow">Tyre</span>`;
  const towerRows = el('div', 'tower__rows');
  tower.append(towerHead, towerRows);

  body.append(left, tower);

  const radio = el('div', 'panel radio');

  page.append(strip, body, radio);
  app.append(page);

  const map = createTrackMap(canvas, track.layout);
  map.fit();

  /* ---- live state ---- */
  let speed = 2;
  let paused = false;
  let lapProgress = 0;
  let lastTickAt = performance.now();
  let bestLapOverall = Number.POSITIVE_INFINITY;
  let armedCompound: CompoundId | null = null;
  /** Tyre level the last warning was issued at, so the engineer nags once per set. */
  let lastTyreWarning = 100;
  const radioLines: { lap: number; html: string }[] = [];

  /**
   * The race advances on a timer, not on the animation frame.
   *
   * Tying laps to requestAnimationFrame means the race runs in slow motion on
   * a slow machine, and stops outright in a background tab — the clock would
   * belong to the renderer instead of to the race.
   */
  let tickTimer: number | undefined;

  function restartClock(): void {
    if (tickTimer !== undefined) window.clearInterval(tickTimer);
    tickTimer = undefined;
    if (paused || race.isFinished()) return;
    lastTickAt = performance.now();
    tickTimer = window.setInterval(() => {
      lastTickAt = performance.now();
      doTick();
      if (race.isFinished() && tickTimer !== undefined) {
        window.clearInterval(tickTimer);
        tickTimer = undefined;
      }
    }, LAP_WALL_MS / speed);
  }

  function syncTransport(): void {
    pauseButton.textContent = paused ? 'RESUME' : 'PAUSE';
    speedButtons.forEach((button, index) => {
      button.setAttribute('aria-pressed', String(SPEEDS[index] === speed));
    });
    restartClock();
  }

  pauseButton.addEventListener('click', () => {
    paused = !paused;
    syncTransport();
  });

  function pushRadio(lap: number, html: string): void {
    radioLines.unshift({ lap, html });
    if (radioLines.length > 40) radioLines.pop();
  }

  function nameOf(carId: string): string {
    const car = race.state().cars.find((c) => c.id === carId);
    return car ? driverById(car.driverId).name : carId;
  }

  function absorb(events: RaceEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'radio':
          pushRadio(event.lap, `<strong>${nameOf(event.car)}</strong> ${event.message.replace(/^[^:]*:\s*/, '')}`);
          break;
        case 'caution':
          pushRadio(
            event.lap,
            event.phase === 'deployed'
              ? '<strong>Safety car deployed.</strong> The field is bunching up.'
              : 'Safety car in this lap. Racing resumes.',
          );
          break;
        case 'weather':
          pushRadio(event.lap, `Conditions turning <strong>${WEATHER_LABEL[event.to]}</strong>.`);
          break;
        case 'retirement':
          pushRadio(event.lap, `<strong>${nameOf(event.car)}</strong> is out — ${event.cause === 'mechanical' ? 'mechanical' : 'off the road'}.`);
          break;
        case 'overtake':
          if (event.success && (event.car === playerCarId || event.victim === playerCarId)) {
            pushRadio(
              event.lap,
              event.car === playerCarId
                ? `<strong>Through!</strong> Past ${nameOf(event.victim)}.`
                : `${nameOf(event.car)} has <strong>gone through</strong> on us.`,
            );
          }
          break;
        case 'chequeredFlag':
          pushRadio(event.lap, `<strong>Chequered flag.</strong> ${nameOf(event.winner)} takes it.`);
          break;
        default:
          break;
      }
    }
  }

  function renderRadio(): void {
    radio.replaceChildren();
    for (const line of radioLines.slice(0, 14)) {
      const row = el('div', 'radio__line');
      row.append(el('span', 'radio__lap', `L${line.lap}`), el('span', 'radio__text', line.html));
      radio.append(row);
    }
  }

  function renderTower(state: ReturnType<Race['state']>): void {
    towerRows.replaceChildren();
    for (const car of state.cars) {
      const team = teamById(car.teamId);
      const driver = driverById(car.driverId);
      const row = el('div', 'row');
      if (car.id === playerCarId) row.classList.add('row--player');
      if (car.retired) row.classList.add('row--out');

      const look = COMPOUND_LOOK[car.compound];
      const isFastest = car.bestLapMs === bestLapOverall && Number.isFinite(car.bestLapMs);
      const lapClass = isFastest
        ? 'row__lap row__lap--best'
        : car.lastLapMs === car.bestLapMs
          ? 'row__lap row__lap--personal'
          : 'row__lap';

      row.innerHTML = `
        <span class="row__pos">${car.retired ? '—' : car.position}</span>
        <span class="row__who">
          <span class="row__colour" style="background:${team.colour}"></span>
          <span class="row__name">${driver.name}</span>
        </span>
        <span class="row__gap">${car.retired ? 'OUT' : car.position === 1 ? '—' : gap(car.gapToLeaderMs)}</span>
        <span class="${lapClass}">${car.retired ? '' : lapTime(car.lastLapMs)}</span>
        <span class="row__tyre">
          <span class="tyre-dot" style="background:${look.colour}">${look.letter}</span>
          <span class="tyre-age">${Math.floor(car.tyreAgeLaps)}L</span>
        </span>`;

      if (!car.retired && car.position > 1) {
        const threat = el('span', 'row__threat');
        const closeness = Math.max(0, 1 - Math.min(car.gapAheadMs, 3000) / 3000);
        threat.style.color = team.colour;
        threat.style.width = `${Math.round(closeness * 100)}%`;
        threat.style.opacity = String(0.15 + closeness * 0.6);
        row.append(threat);
      }

      towerRows.append(row);
    }
  }

  /**
   * The pit wall is built once and updated in place.
   *
   * Rebuilding it every lap destroyed keyboard focus and hover state on the
   * controls — the player would be reaching for "Soft" at the exact moment the
   * button underneath them was replaced.
   */
  const wallHead = el('div', 'wall__head');
  const wallDriver = el('span', 'wall__driver');
  const wallPos = el('span', 'wall__pos mono');
  wallHead.append(wallDriver, wallPos);

  const readouts = el('div', 'readouts');
  const tyreLabel = el('span', 'eyebrow');
  const tyreValue = el('span', 'readout__value');
  const tyreMeter = el('span');
  const fuelValue = el('span', 'readout__value');
  const fuelMeter = el('span');
  const gapValue = el('span', 'readout__value');
  const tyreBlock = el('div', 'readout');
  const tyreBar = el('span', 'meter');
  tyreBar.append(tyreMeter);
  tyreBlock.append(tyreLabel, tyreValue, tyreBar);
  const fuelBlock = el('div', 'readout');
  const fuelBar = el('span', 'meter');
  fuelBar.append(fuelMeter);
  fuelBlock.append(el('span', 'eyebrow', 'Fuel'), fuelValue, fuelBar);
  const gapBlock = el('div', 'readout');
  gapBlock.append(el('span', 'eyebrow', 'Gap ahead'), gapValue);
  readouts.append(tyreBlock, fuelBlock, gapBlock);

  const controls = el('div', 'controls');
  const pitRow = el('div', 'control-row');
  pitRow.append(el('span', 'eyebrow', 'Box'));
  const paceRow = el('div', 'control-row');
  paceRow.append(el('span', 'eyebrow', 'Pace'));
  controls.append(pitRow, paceRow);

  const paceChips = (['push', 'hold', 'save'] as const).map((mode) => {
    const chip = el('button', 'chip', mode);
    chip.type = 'button';
    chip.addEventListener('click', () => {
      race.issue({ type: 'pace', car: playerCarId, mode });
      renderWall(race.state());
    });
    paceRow.append(chip);
    return { mode, chip };
  });

  let pitChips: { compound: CompoundId; chip: HTMLButtonElement }[] = [];
  let pitChipSet = '';

  function buildPitChips(available: CompoundId[]): void {
    const signature = available.join(',');
    if (signature === pitChipSet) return;
    pitChipSet = signature;
    for (const { chip } of pitChips) chip.remove();
    pitChips = available.map((compound) => {
      const chip = el('button', 'chip', COMPOUNDS[compound].label);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        race.issue({ type: 'pit', car: playerCarId, compound });
        armedCompound = compound;
        renderWall(race.state());
      });
      pitRow.append(chip);
      return { compound, chip };
    });
  }

  wall.append(wallHead, readouts, controls);

  function renderWall(state: ReturnType<Race['state']>): void {
    const car = state.cars.find((c) => c.id === playerCarId);
    if (!car) return;
    const driver = driverById(car.driverId);
    const compound = COMPOUNDS[car.compound];
    const locked = car.retired || state.finished;

    wallDriver.textContent = car.retired ? `${driver.name} — out` : driver.name;
    wallPos.textContent = car.retired
      ? ''
      : `P${car.position} · ${car.pitStops} stop${car.pitStops === 1 ? '' : 's'}`;

    tyreLabel.textContent = `Tyre · ${compound.label}`;
    tyreValue.textContent = `${car.tyreConditionPct}%`;
    tyreMeter.style.width = `${car.tyreConditionPct}%`;
    tyreMeter.style.background =
      car.tyreConditionPct > 45 ? 'var(--green)' : car.tyreConditionPct > 20 ? 'var(--amber)' : 'var(--red)';

    const tankKg = track.fuelPerLapKg * setup.laps * 1.03;
    fuelValue.textContent = `${car.fuelKg.toFixed(1)} kg`;
    fuelMeter.style.width = `${Math.max(0, Math.min(100, (car.fuelKg / tankKg) * 100))}%`;
    fuelMeter.style.background = 'var(--blue)';

    gapValue.textContent =
      car.position === 1 ? 'Leading' : `+${(car.gapAheadMs / 1000).toFixed(1)}s`;

    buildPitChips(state.weather === 'dry' ? ['soft', 'medium', 'hard'] : ['intermediate', 'wet']);
    for (const { compound: id, chip } of pitChips) {
      chip.disabled = locked;
      chip.classList.toggle('chip--armed', armedCompound === id);
    }
    for (const { mode, chip } of paceChips) {
      chip.disabled = locked;
      chip.setAttribute('aria-pressed', String(car.paceMode === mode));
    }
  }

  function renderStrip(state: ReturnType<Race['state']>): void {
    lapCount.textContent = `LAP ${state.lap} / ${state.totalLaps}`;
    progressFill.style.width = `${(state.lap / state.totalLaps) * 100}%`;
    weatherBadge.textContent = WEATHER_LABEL[state.weather];
    weatherBadge.className = `badge${state.weather === 'dry' ? '' : state.weather === 'wet' ? ' badge--wet' : ' badge--damp'}`;
    cautionBadge.textContent = state.caution === 'deployed' ? 'SAFETY CAR' : 'GREEN';
    cautionBadge.className = `badge${state.caution === 'deployed' ? ' badge--caution' : ''}`;
  }

  function doTick(): void {
    const events = race.tick();
    absorb(events);
    const state = race.state();
    for (const car of state.cars) {
      if (Number.isFinite(car.bestLapMs)) bestLapOverall = Math.min(bestLapOverall, car.bestLapMs);
    }
    const player = state.cars.find((c) => c.id === playerCarId);
    if (player && player.pitStops > 0 && armedCompound && player.compound === armedCompound) {
      armedCompound = null;
    }

    // A real race engineer tells you the tyres are gone. Without this the first
    // sign of trouble is simply losing places, with no idea why.
    if (player && !player.retired) {
      if (player.tyreConditionPct > lastTyreWarning) lastTyreWarning = 100;
      const crossed = (level: number) =>
        player.tyreConditionPct <= level && lastTyreWarning > level && armedCompound === null;
      if (crossed(10)) {
        pushRadio(state.lap, '<strong>These tyres are done.</strong> We are losing over a second a lap.');
        lastTyreWarning = 10;
      } else if (crossed(25)) {
        pushRadio(state.lap, 'Tyres are past their best. <strong>Start thinking about the stop.</strong>');
        lastTyreWarning = 25;
      }
    }
    renderStrip(state);
    renderTower(state);
    renderWall(state);
    renderRadio();

    if (race.isFinished()) {
      if (tickTimer !== undefined) window.clearInterval(tickTimer);
      window.setTimeout(() => renderResults(race, playerCarId), 1400);
    }
  }

  /** Closest two chips are allowed to sit, as a share of the lap. */
  const MIN_CHIP_SEPARATION = 0.011;

  function mapCars(state: ReturnType<Race['state']>): MapCar[] {
    const leader = state.cars.find((c) => !c.retired);
    const referenceLapMs = leader?.lastLapMs && leader.lastLapMs > 0 ? leader.lastLapMs : track.baseLapMs;
    const running = state.cars.filter((car) => !car.retired);

    // Cars are placed around the lap by their gap to the leader, so the map
    // tells the same story as the timing tower. On the opening laps the whole
    // field is genuinely within a few seconds, which draws as one unreadable
    // blob — so consecutive chips are pushed apart to a legible minimum. The
    // running order is never altered, only the spacing.
    let previous = Number.POSITIVE_INFINITY;
    return running.map((car) => {
      const trueFraction = lapProgress - car.gapToLeaderMs / referenceLapMs;
      const spaced = Math.min(trueFraction, previous - MIN_CHIP_SEPARATION);
      previous = spaced;
      return {
        id: car.id,
        colour: teamById(car.teamId).colour,
        position: car.position,
        fraction: spaced,
        isPlayer: car.id === playerCarId,
      };
    });
  }

  function frame(now: number): void {
    if (!paused && !race.isFinished()) {
      // Frames only interpolate between laps; they never advance the race.
      lapProgress = Math.min(1, (now - lastTickAt) / (LAP_WALL_MS / speed));
    }
    map.render(mapCars(race.state()));
    requestAnimationFrame(frame);
  }

  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      paused = !paused;
      syncTransport();
    }
  });

  syncTransport();
  renderStrip(race.state());
  renderTower(race.state());
  renderWall(race.state());
  pushRadio(0, `<strong>Lights out.</strong> ${setup.laps} laps at ${track.name}.`);
  renderRadio();
  requestAnimationFrame(frame);
}

/* ---------------------------------------------------------------- results */

function renderResults(race: Race, playerCarId: string): void {
  const result = race.result();
  const player = result.classification.find((c) => c.carId === playerCarId);
  app.replaceChildren();

  const page = el('div', 'results');
  const headline = player
    ? player.retired
      ? 'Out.'
      : player.position === 1
        ? 'Win.'
        : `P${player.position}.`
    : 'Race over.';
  page.append(el('h1', 'results__head', headline));
  page.append(
    el(
      'p',
      'results__sub',
      `${trackById(result.trackId).name} · ${result.totalLaps} laps · seed "${result.seed}"`,
    ),
  );

  const table = el('table', 'results__table');
  table.innerHTML = `
    <thead>
      <tr>
        <th class="eyebrow">Pos</th>
        <th class="eyebrow">Driver</th>
        <th class="eyebrow">Team</th>
        <th class="eyebrow">Gap</th>
        <th class="eyebrow">Best</th>
        <th class="eyebrow">Stops</th>
      </tr>
    </thead>`;
  const tbody = el('tbody');
  for (const car of result.classification) {
    const row = el('tr');
    if (car.carId === playerCarId) row.className = 'you';
    row.innerHTML = `
      <td>${car.retired ? '—' : car.position}</td>
      <td class="name">${driverById(car.driverId).name}</td>
      <td>${teamById(car.teamId).name}</td>
      <td>${car.retired ? `DNF · ${car.retiredCause}` : car.position === 1 ? 'WINNER' : gap(car.gapToWinnerMs)}</td>
      <td>${lapTime(car.bestLapMs)}</td>
      <td>${car.pitStops}</td>`;
    tbody.append(row);
  }
  table.append(tbody);
  page.append(table);

  const again = el('button', 'start', 'Another race');
  again.type = 'button';
  again.addEventListener('click', () => renderSetup());
  page.append(again);

  app.append(page);
}

renderSetup();
