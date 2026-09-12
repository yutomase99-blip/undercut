import { driverById, type Driver, type Entry } from '@undercut/engine';
import { el } from './dom.ts';

/**
 * A driver, with the three numbers that actually decide their races.
 *
 * These have driven every result since the first version and were never once
 * shown: you picked a team on the strength of its car and found out who was
 * driving it by reading the timing tower.
 */
export const DRIVER_TRAITS: { key: keyof Pick<Driver, 'skill' | 'consistency' | 'aggression'>; label: string; note: string }[] = [
  { key: 'skill', label: 'Pace', note: 'Raw lap time.' },
  { key: 'consistency', label: 'Consistency', note: 'Resistance to mistakes, and to losing the car.' },
  { key: 'aggression', label: 'Aggression', note: 'Willingness to commit to a move.' },
];

export function driverCard(driverId: string, options: { compact?: boolean } = {}): HTMLElement {
  const driver = driverById(driverId);
  const card = el('div', options.compact ? 'driver driver--compact' : 'driver');

  const head = el('div', 'driver__head');
  head.append(el('span', 'driver__name', driver.name));
  card.append(head);

  const traits = el('div', 'driver__traits');
  for (const trait of DRIVER_TRAITS) {
    const value = driver[trait.key];
    const row = el('div', 'driver__trait');
    row.title = trait.note;
    row.innerHTML = `
      <span class="driver__label">${trait.label}</span>
      <span class="driver__bar"><span style="width:${Math.round(value * 100)}%"></span></span>
      <span class="driver__value mono">${Math.round(value * 100)}</span>`;
    traits.append(row);
  }
  card.append(traits);
  return card;
}

/** The line-up for one team, in seat order. */
export function driversFor(entries: Entry[], teamId: string): string[] {
  return entries
    .filter((entry) => entry.teamId === teamId)
    .flatMap((entry) => entry.driverIds ?? [entry.driverId]);
}

/** A one-line summary, for places where a full card is too much. */
export function driverSummary(driverId: string): string {
  const driver = driverById(driverId);
  return `${driver.name} · pace ${Math.round(driver.skill * 100)} · consistency ${Math.round(
    driver.consistency * 100,
  )}`;
}
