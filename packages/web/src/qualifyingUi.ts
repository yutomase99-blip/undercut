import {
  COMPOUNDS,
  createQualifying,
  driverById,
  teamById,
  type CompoundId,
  type Qualifying,
  type QualifyingLap,
  type QualifyingResult,
  type RaceConfig,
  type WeatherState,
} from '@undercut/engine';
import { el } from './dom.ts';
import { COMPOUND_LOOK, lapTime, WEATHER_LABEL } from './format.ts';

export interface QualifyingOptions {
  app: HTMLElement;
  config: RaceConfig;
  seed: string;
  playerCarId: string;
  subtitle?: string;
  onComplete: (result: QualifyingResult) => void;
}

/**
 * The qualifying session.
 *
 * One run per segment, and the two things that decide it are when you go and
 * what you go on. The track rubbers in as the session runs, so later is
 * quicker — but everybody knows that, so later is also busier, and a yellow
 * flag in your window deletes the lap entirely.
 */
export function renderQualifying(options: QualifyingOptions): void {
  const session = createQualifying(options.config, options.seed);
  const conditions = session.conditions();
  const allowed = allowedCompounds(options.config, conditions);

  let chosenSlot = Math.floor(session.state().slots * 0.6);
  let chosenCompound: CompoundId = allowed[0] ?? 'medium';

  renderSegment();

  function renderSegment(): void {
    const state = session.state();
    const stillIn = state.runners.includes(options.playerCarId);

    options.app.replaceChildren();
    const page = el('div', 'setup quali');

    const mark = el('h1', 'setup__mark');
    // A knockout segment is named ("Q2"); a single session is just called
    // qualifying, and "Qualifying Qualifying" reads like a stutter.
    mark.innerHTML =
      state.segmentName.toLowerCase() === 'qualifying'
        ? 'Qualifying'
        : `Qualifying <em>${state.segmentName}</em>`;
    page.append(mark);

    const conditionsLine = el('p', 'quali__conditions');
    conditionsLine.innerHTML =
      conditions === 'dry'
        ? `<span class="badge">DRY</span> Track is dry.`
        : `<span class="badge badge--${conditions === 'wet' ? 'wet' : 'damp'}">${WEATHER_LABEL[conditions]}</span> ${conditions === 'wet' ? 'It is raining. Dry tyres are not an option.' : 'The track is damp. Intermediates only.'}`;
    page.append(conditionsLine);
    page.append(
      el(
        'p',
        'setup__lede',
        stillIn
          ? 'The track gets quicker as rubber goes down, so a late run is worth real time. Everyone knows it, which is what makes the late windows busy — and a yellow flag in your window deletes the lap.'
          : 'You are out of this one. The session runs on without you.',
      ),
    );

    if (stillIn) {
      page.append(runPlanner(session, state.slots));
    }

    const run = el('button', 'start', stillIn ? `Run ${state.segmentName}` : `Watch ${state.segmentName}`);
    run.type = 'button';
    run.addEventListener('click', () => {
      if (stillIn) {
        session.planRun({ carId: options.playerCarId, slot: chosenSlot, compound: chosenCompound });
      }
      const laps = session.runSegment();
      renderSegmentResult(laps);
    });
    page.append(run);
    options.app.append(page);
  }

  function runPlanner(active: Qualifying, slots: number): HTMLElement {
    const panel = el('div', 'panel quali__panel');
    panel.append(el('span', 'eyebrow', 'Your run'));

    const allocation = active.allocationOf(options.playerCarId);
    const tyreRow = el('div', 'control-row');
    tyreRow.append(el('span', 'eyebrow', 'Tyre'));
    for (const compound of allowed) {
      const sets = allocation[compound] ?? 0;
      const chip = el('button', 'chip', `${COMPOUNDS[compound].label} <span class="chip__sets mono">${sets}</span>`);
      chip.type = 'button';
      chip.disabled = sets === 0;
      chip.setAttribute('aria-pressed', String(compound === chosenCompound));
      chip.title = `${sets} set${sets === 1 ? '' : 's'} left for the weekend`;
      chip.addEventListener('click', () => {
        chosenCompound = compound;
        renderSegment();
      });
      tyreRow.append(chip);
    }
    panel.append(tyreRow);
    panel.append(
      el(
        'p',
        'hub__note hub__note--dim',
        'Sets are for the whole weekend. A lap on softs here is a set you will not have on Sunday.',
      ),
    );

    // A car cannot run a compound it has none of.
    if ((allocation[chosenCompound] ?? 0) === 0) {
      const fallback = allowed.find((c) => (allocation[c] ?? 0) > 0);
      if (fallback) chosenCompound = fallback;
    }

    panel.append(el('span', 'eyebrow', 'When you go'));
    // Booking the player's run before reading the forecast means the crowding
    // shown includes their own car, which is what they will actually face.
    active.planRun({ carId: options.playerCarId, slot: chosenSlot, compound: chosenCompound });
    const forecast = active.forecast();

    const slotRow = el('div', 'slots');
    for (let slot = 0; slot < slots; slot += 1) {
      const cars = forecast[slot] ?? 0;
      const evolution = active.surfaceMsAt(slot);
      const traffic = active.trafficMsFor(cars);
      const net = evolution + traffic;
      const risk = active.yellowChanceAt(slot);
      const button = el('button', 'slot');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(slot === chosenSlot));
      button.innerHTML = `
        <span class="slot__index mono">${slot + 1}</span>
        <span class="slot__net mono" style="color:${net < 0 ? 'var(--green)' : 'var(--amber)'}">${net > 0 ? '+' : ''}${(net / 1000).toFixed(2)}</span>
        <span class="slot__cars mono">${cars} · ${(risk * 100).toFixed(0)}%</span>`;
      button.title = `Track ${(evolution / 1000).toFixed(2)}s · traffic +${(traffic / 1000).toFixed(2)}s · ${cars} car${cars === 1 ? '' : 's'} · ${(risk * 100).toFixed(0)}% chance of flags`;
      button.addEventListener('click', () => {
        chosenSlot = slot;
        renderSegment();
      });
      slotRow.append(button);
    }
    panel.append(slotRow);
    panel.append(
      el(
        'p',
        'hub__note hub__note--dim',
        'Net time against a green track, then how many cars are booked in and the odds of the flags ending every lap in that window.',
      ),
    );
    return panel;
  }

  function renderSegmentResult(laps: QualifyingLap[]): void {
    const state = session.state();
    const result = session.result();

    options.app.replaceChildren();
    const page = el('div', 'setup');
    const mark = el('h1', 'setup__mark');
    const playerLap = laps.find((l) => l.carId === options.playerCarId);
    const eliminated = result.eliminatedAt.has(options.playerCarId);

    mark.innerHTML = playerLap?.deleted
      ? 'Lap <em>deleted</em>'
      : eliminated
        ? 'Knocked <em>out</em>'
        : session.isComplete()
          ? 'The <em>grid</em>'
          : 'Through';
    page.append(mark);

    const ranked = [...laps].sort((a, b) => {
      if (a.timeMs === null && b.timeMs === null) return 0;
      if (a.timeMs === null) return 1;
      if (b.timeMs === null) return -1;
      return a.timeMs - b.timeMs;
    });

    const table = el('table', 'results__table');
    table.innerHTML = `
      <thead><tr>
        <th class="eyebrow">Pos</th>
        <th class="eyebrow">Driver</th>
        <th class="eyebrow">Team</th>
        <th class="eyebrow">Time</th>
        <th class="eyebrow">Tyre</th>
        <th class="eyebrow">Window</th>
      </tr></thead>`;
    const body = el('tbody');
    const survivors = state.runners;
    ranked.forEach((lap, index) => {
      const entry = options.config.entries.find((e) => e.carId === lap.carId)!;
      const look = COMPOUND_LOOK[lap.compound];
      const row = el('tr');
      if (lap.carId === options.playerCarId) row.className = 'you';
      if (!survivors.includes(lap.carId) && !session.isComplete()) row.classList.add('row--out');
      row.innerHTML = `
        <td>${index + 1}</td>
        <td class="name">${driverById(entry.driverId).name}</td>
        <td>${teamById(entry.teamId).name}</td>
        <td>${lap.deleted ? 'DELETED' : lap.timeMs === null ? 'NO TIME' : lapTime(lap.timeMs)}</td>
        <td><span class="tyre-dot" style="background:${look.colour}">${look.letter}</span></td>
        <td>${lap.slot + 1}</td>`;
      body.append(row);
    });
    table.append(body);
    page.append(table);

    const next = el('button', 'start', session.isComplete() ? 'To the race' : `On to ${state.segmentName}`);
    next.type = 'button';
    next.addEventListener('click', () => {
      if (session.isComplete()) options.onComplete(session.result());
      else renderSegment();
    });
    page.append(next);
    options.app.append(page);
  }
}

function allowedCompounds(config: RaceConfig, conditions: WeatherState): CompoundId[] {
  const dry: CompoundId[] = ['soft', 'medium', 'hard'];
  const wet: CompoundId[] = ['intermediate', 'wet'];
  const pool = conditions === 'dry' ? dry : wet;
  return pool.filter((c) => config.regulations.tyreRules.allowedCompounds.includes(c));
}
