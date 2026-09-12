import { driverById, teamById, trackById, TRACKS } from '@undercut/engine';
import {
  applyGarageOption,
  autoPick,
  createSeason,
  driverStandings,
  isSeasonComplete,
  nextRound,
  openMarket,
  pickDriver,
  saveSeason,
  startNextSeason,
  garageOptions,
  PART_LABEL,
  PART_IDS,
  teamStandings,
  type MarketState,
  type SeasonConfig,
  type SeasonState,
} from '@undercut/season';
import { el } from './dom.ts';
import { driverCard, driversFor } from './driverCard.ts';
import { CHAMPIONSHIPS, CLASS_COLOUR, CLASS_TAG, type Championship } from './championship.ts';

/**
 * Everything the season screens need from the rest of the app.
 *
 * Passing these in rather than importing them keeps the season UI free of a
 * cycle with the race view, which owns the opposite direction of the flow.
 */
export interface SeasonDeps {
  app: HTMLElement;
  goHome: () => void;
  raceRound: (season: SeasonState) => void;
}

function seriesFor(season: SeasonState): Championship {
  return CHAMPIONSHIPS.find((c) => c.id === season.config.championshipId) ?? CHAMPIONSHIPS[0]!;
}

/* ------------------------------------------------------------ season setup */

export function renderSeasonSetup(deps: SeasonDeps, onStart: (season: SeasonState) => void): void {
  deps.app.replaceChildren();
  const page = el('div', 'setup');

  const draft: SeasonConfig = {
    championshipId: 'open-wheel',
    playerTeamId: 'kestros',
    trackIds: TRACKS.map((t) => t.id),
    raceLength: 24,
    seed: 'championship',
  };

  const rerender = () => renderSeasonSetupInto(page, deps, draft, onStart, rerender);
  renderSeasonSetupInto(page, deps, draft, onStart, rerender);
  deps.app.append(page);
}

function renderSeasonSetupInto(
  page: HTMLElement,
  deps: SeasonDeps,
  draft: SeasonConfig,
  onStart: (season: SeasonState) => void,
  rerender: () => void,
): void {
  page.replaceChildren();
  const series = CHAMPIONSHIPS.find((c) => c.id === draft.championshipId)!;

  const mark = el('h1', 'setup__mark');
  mark.innerHTML = 'The <em>season</em>';
  const lede = el(
    'p',
    'setup__lede',
    'A full calendar. You develop the car between rounds, your rivals develop theirs, and at the end of the year the drivers change seats.',
  );

  const grid = el('div', 'setup__grid');

  const seriesField = el('div', 'field');
  seriesField.append(el('span', 'eyebrow', 'Championship'));
  const seriesChoices = el('div', 'choices');
  for (const option of CHAMPIONSHIPS) {
    const button = el('button', 'choice');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(option.id === draft.championshipId));
    button.innerHTML = `<span class="choice__flag" style="background:${option.id === 'endurance' ? '#4d9dff' : '#35d07f'}"></span><span class="choice__name">${option.name}</span>`;
    button.addEventListener('click', () => {
      draft.championshipId = option.id as SeasonConfig['championshipId'];
      draft.playerTeamId = option.teams[2]?.id ?? option.teams[0]!.id;
      draft.raceLength = option.id === 'endurance' ? 4 : 24;
      rerender();
    });
    seriesChoices.append(button);
  }
  seriesField.append(seriesChoices);

  const teamField = el('div', 'field');
  teamField.append(el('span', 'eyebrow', 'Your team'));
  const teamChoices = el('div', 'choices');
  if (!series.teams.some((t) => t.id === draft.playerTeamId)) {
    draft.playerTeamId = series.teams[2]?.id ?? series.teams[0]!.id;
  }
  for (const team of series.teams) {
    const button = el('button', 'choice');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(team.id === draft.playerTeamId));
    const filled = Math.max(1, Math.round(((team.carPerformance - 0.64) / 0.36) * 5));
    button.innerHTML = `
      <span class="choice__flag" style="background:${team.colour}"></span>
      <span class="choice__name">${team.name}</span>
      <span class="choice__meta">${'●'.repeat(filled).padEnd(5, '○')}</span>`;
    button.addEventListener('click', () => {
      draft.playerTeamId = team.id;
      rerender();
    });
    teamChoices.append(button);
  }
  teamField.append(teamChoices);

  const calendarField = el('div', 'field');
  calendarField.append(el('span', 'eyebrow', 'Calendar'));
  const roundsInput = el('input');
  roundsInput.type = 'number';
  roundsInput.min = '2';
  roundsInput.max = String(TRACKS.length * 3);
  roundsInput.value = String(draft.trackIds.length);
  roundsInput.addEventListener('change', () => {
    const rounds = Math.max(2, Math.min(TRACKS.length * 3, Number(roundsInput.value) || TRACKS.length));
    // The calendar repeats circuits once it is longer than the list of them.
    draft.trackIds = Array.from({ length: rounds }, (_, i) => TRACKS[i % TRACKS.length]!.id);
    roundsInput.value = String(rounds);
  });
  const lengthInput = el('input');
  lengthInput.type = 'number';
  lengthInput.min = String(series.lengthMin);
  lengthInput.max = String(series.lengthMax);
  lengthInput.value = String(draft.raceLength);
  lengthInput.addEventListener('change', () => {
    draft.raceLength = Math.max(
      series.lengthMin,
      Math.min(series.lengthMax, Number(lengthInput.value) || draft.raceLength),
    );
    lengthInput.value = String(draft.raceLength);
  });
  const seedInput = el('input');
  seedInput.type = 'text';
  seedInput.value = draft.seed;
  seedInput.addEventListener('input', () => {
    draft.seed = seedInput.value || 'championship';
  });
  calendarField.append(
    el('span', 'choice__meta', 'Rounds'),
    roundsInput,
    el('span', 'choice__meta', series.lengthLabel + ' per round'),
    lengthInput,
    el('span', 'choice__meta', 'Seed'),
    seedInput,
  );

  grid.append(seriesField, teamField, calendarField);

  const start = el('button', 'start', 'Start the season');
  start.type = 'button';
  start.addEventListener('click', () => {
    const season = createSeason({ ...draft });
    saveSeason(season);
    onStart(season);
  });

  const back = el('button', 'ghost', 'Back');
  back.type = 'button';
  back.addEventListener('click', deps.goHome);

  const actions = el('div', 'actions');
  actions.append(start, back);
  page.append(mark, lede, grid, actions);
}

/* -------------------------------------------------------------- season hub */

export function renderSeasonHub(season: SeasonState, deps: SeasonDeps): void {
  deps.app.replaceChildren();
  const series = seriesFor(season);
  const playerTeam = teamById(season.config.playerTeamId);
  const development = season.teams.find((t) => t.teamId === season.config.playerTeamId)!;
  const page = el('div', 'hub');

  /* header */
  const strip = el('div', 'strip');
  strip.append(
    el('span', 'strip__mark', 'Undercut'),
    el('span', 'strip__track', `${playerTeam.name} · ${series.name}`),
  );
  const round = nextRound(season);
  strip.append(
    el(
      'span',
      'badge',
      round ? `ROUND ${round.round + 1} / ${season.config.trackIds.length}` : 'SEASON COMPLETE',
    ),
  );
  const spacer = el('div', 'strip__progress');
  const fill = el('span');
  fill.style.width = `${(season.round / season.config.trackIds.length) * 100}%`;
  spacer.append(fill);
  const home = el('button', 'speed', 'HOME');
  home.type = 'button';
  home.addEventListener('click', deps.goHome);
  strip.append(spacer, home);

  /* next round + development */
  const left = el('div', 'hub__col');

  if (round) {
    const track = trackById(round.trackId);
    const nextPanel = el('div', 'panel hub__panel');
    nextPanel.append(el('span', 'eyebrow', 'Next round'));
    nextPanel.append(el('h2', 'hub__title', track.name));
    const unit = series.lengthLabel.toLowerCase().replace(/s$/, '');
    nextPanel.append(
      el(
        'p',
        'hub__note',
        `${season.config.raceLength} ${unit}${season.config.raceLength === 1 ? '' : 's'} · ${track.country}`,
      ),
    );
    const race = el('button', 'start', 'Race this round');
    race.type = 'button';
    race.addEventListener('click', () => deps.raceRound(season));
    nextPanel.append(race);
    left.append(nextPanel);
  } else {
    const endPanel = el('div', 'panel hub__panel');
    const champion = driverStandings(season)[0];
    endPanel.append(el('span', 'eyebrow', 'Champion'));
    endPanel.append(
      el('h2', 'hub__title', champion ? driverById(champion.driverId).name : 'Nobody'),
    );
    endPanel.append(
      el(
        'p',
        'hub__note',
        champion
          ? `${teamById(champion.teamId).name} · ${champion.points} points · ${champion.wins} wins`
          : '',
      ),
    );
    const toMarket = el('button', 'start', 'Sign drivers for next season');
    toMarket.type = 'button';
    toMarket.addEventListener('click', () => renderMarket(season, autoPick(openMarket(season)), deps));
    endPanel.append(toMarket);
    left.append(endPanel);
  }

  const devPanel = el('div', 'panel hub__panel');
  const devHead = el('div', 'hub__head');
  devHead.append(
    el('span', 'eyebrow', 'The garage'),
    el('span', 'hub__budget mono', `${development.budget} left`),
  );
  devPanel.append(devHead);

  // The car, component by component: how good each part is, and how much life
  // is left in it.
  const partsTable = el('div', 'parts');
  for (const id of PART_IDS) {
    const part = development.parts[id];
    const row = el('div', 'part');
    const conditionColour =
      part.condition > 0.6 ? 'var(--green)' : part.condition > 0.3 ? 'var(--amber)' : 'var(--red)';
    row.innerHTML = `
      <span class="part__name">${PART_LABEL[id]}</span>
      <span class="part__meter" title="Quality ${Math.round(part.level * 100)}">
        <span style="width:${Math.round(part.level * 100)}%;background:var(--text)"></span>
      </span>
      <span class="part__value mono">${Math.round(part.level * 100)}</span>
      <span class="part__meter" title="Condition ${Math.round(part.condition * 100)}%">
        <span style="width:${Math.round(part.condition * 100)}%;background:${conditionColour}"></span>
      </span>
      <span class="part__value mono" style="color:${conditionColour}">${Math.round(part.condition * 100)}%</span>`;
    partsTable.append(row);
  }
  devPanel.append(partsTable);
  devPanel.append(
    el(
      'p',
      'hub__note hub__note--dim',
      'Quality on the left, condition on the right. Racing wears a car out, and a tired part is not the part you bought.',
    ),
  );

  const options = el('div', 'upgrades');
  for (const option of garageOptions(development).filter((o) => o.worthwhile)) {
    const button = el('button', 'upgrade');
    button.type = 'button';
    button.disabled = !option.affordable;
    button.title = option.description;
    const gainText =
      option.action === 'upgrade'
        ? `+${(option.gain * 100).toFixed(1)}`
        : `+${Math.round(option.gain * 100)}%`;
    button.innerHTML = `
      <span class="upgrade__label">${option.label}</span>
      <span class="upgrade__gain mono">${gainText}</span>
      <span class="upgrade__cost mono">${option.cost}</span>`;
    button.addEventListener('click', () => {
      const updated: SeasonState = {
        ...season,
        teams: season.teams.map((t) =>
          t.teamId === development.teamId ? applyGarageOption(t, option) : t,
        ),
      };
      saveSeason(updated);
      renderSeasonHub(updated, deps);
    });
    options.append(button);
  }
  devPanel.append(options);
  left.append(devPanel);

  /* standings */
  const lineupPanel = el('div', 'panel hub__panel');
  lineupPanel.append(el('span', 'eyebrow', 'Your drivers'));
  const lineup = el('div', 'lineup');
  for (const driverId of driversFor(season.entries, season.config.playerTeamId)) {
    lineup.append(driverCard(driverId, { compact: true }));
  }
  lineupPanel.append(lineup);
  left.append(lineupPanel);

  const right = el('div', 'hub__col');
  right.append(standingsPanel(season, series));
  right.append(calendarPanel(season));

  const body = el('div', 'hub__body');
  body.append(left, right);
  page.append(strip, body);
  deps.app.append(page);
}

function standingsPanel(season: SeasonState, series: Championship): HTMLElement {
  const panel = el('div', 'panel hub__panel');
  panel.append(el('span', 'eyebrow', 'Drivers'));

  const table = el('table', 'standings');
  const body = el('tbody');
  for (const [index, standing] of driverStandings(season).slice(0, 12).entries()) {
    const team = teamById(standing.teamId);
    const entry = season.entries.find((e) => e.carId === standing.carId);
    const tag =
      series.multiClass && entry && CLASS_TAG[entry.classId]
        ? `<span class="class-tag" style="color:${CLASS_COLOUR[entry.classId]}">${CLASS_TAG[entry.classId]}</span>`
        : '';
    const row = el('tr');
    if (standing.teamId === season.config.playerTeamId) row.className = 'you';
    row.innerHTML = `
      <td class="mono">${index + 1}</td>
      <td><span class="row__colour" style="background:${team.colour}"></span></td>
      <td class="name">${driverById(standing.driverId).name}${tag}</td>
      <td class="mono dim">${team.name}</td>
      <td class="mono">${standing.wins}</td>
      <td class="mono strong">${standing.points}</td>`;
    body.append(row);
  }
  table.append(body);
  panel.append(table);

  panel.append(el('span', 'eyebrow', 'Constructors'));
  const teamTable = el('table', 'standings');
  const teamBody = el('tbody');
  for (const [index, standing] of teamStandings(season).slice(0, 8).entries()) {
    const team = teamById(standing.teamId);
    const row = el('tr');
    if (standing.teamId === season.config.playerTeamId) row.className = 'you';
    row.innerHTML = `
      <td class="mono">${index + 1}</td>
      <td><span class="row__colour" style="background:${team.colour}"></span></td>
      <td class="name">${team.name}</td>
      <td class="mono strong">${standing.points}</td>`;
    teamBody.append(row);
  }
  teamTable.append(teamBody);
  panel.append(teamTable);
  return panel;
}

function calendarPanel(season: SeasonState): HTMLElement {
  const panel = el('div', 'panel hub__panel');
  panel.append(el('span', 'eyebrow', 'Calendar'));
  const list = el('div', 'calendar');
  season.config.trackIds.forEach((trackId, index) => {
    const result = season.results.find((r) => r.round === index);
    // Your car, not merely your team's: the sister car finishing ninth says
    // nothing about the race you actually drove.
    const playerCarId = `${season.config.playerTeamId}-1`;
    const player = result?.classification.find((c) => c.carId === playerCarId);
    const item = el('div', 'calendar__row');
    const status = result
      ? player
        ? player.retired
          ? 'DNF'
          : `P${player.classPosition}`
        : '—'
      : index === season.round
        ? 'NEXT'
        : '';
    item.innerHTML = `
      <span class="calendar__num mono">${index + 1}</span>
      <span class="calendar__name">${trackById(trackId).name}</span>
      <span class="calendar__status mono ${result ? '' : 'dim'}">${status}</span>`;
    list.append(item);
  });
  panel.append(list);
  return panel;
}

/* ------------------------------------------------------------- the market */

export function renderMarket(season: SeasonState, market: MarketState, deps: SeasonDeps): void {
  deps.app.replaceChildren();
  const page = el('div', 'setup');

  const mark = el('h1', 'setup__mark');
  mark.innerHTML = 'Driver <em>market</em>';
  page.append(mark);

  if (market.complete) {
    page.append(
      el('p', 'setup__lede', 'Every seat is filled. The cars keep everything you developed.'),
    );
    const signed = el('div', 'choices');
    for (const signing of market.signings.filter((s) => s.teamId === season.config.playerTeamId)) {
      const row = el('div', 'choice');
      row.innerHTML = `
        <span class="choice__flag" style="background:${teamById(signing.teamId).colour}"></span>
        <span class="choice__name">${driverById(signing.driverId).name}</span>
        <span class="choice__meta">${signing.carId}</span>`;
      signed.append(row);
    }
    page.append(signed);

    const next = el('button', 'start', 'Start next season');
    next.type = 'button';
    next.addEventListener('click', () => {
      const fresh = startNextSeason(season, market);
      saveSeason(fresh);
      renderSeasonHub(fresh, deps);
    });
    page.append(next);
    deps.app.append(page);
    return;
  }

  page.append(
    el(
      'p',
      'setup__lede',
      'Teams choose in championship order, best first. Your turn — pick who drives for you next year.',
    ),
  );

  const pool = el('div', 'choices');
  const ranked = [...market.pool].sort((a, b) => driverById(b).skill - driverById(a).skill);
  for (const driverId of ranked.slice(0, 12)) {
    const driver = driverById(driverId);
    const button = el('button', 'choice');
    button.type = 'button';
    button.innerHTML = `
      <span class="choice__flag" style="background:#35d07f"></span>
      <span class="choice__name">${driver.name}</span>
      <span class="choice__meta">pace ${(driver.skill * 100).toFixed(0)} · consistency ${(driver.consistency * 100).toFixed(0)}</span>`;
    button.addEventListener('click', () => {
      renderMarket(season, autoPick(pickDriver(market, driverId)), deps);
    });
    pool.append(button);
  }
  page.append(pool);
  deps.app.append(page);
}

export { isSeasonComplete };
