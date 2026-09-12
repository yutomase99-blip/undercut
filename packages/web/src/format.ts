import type { CompoundId, WeatherState } from '@undercut/engine';

export function lapTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const minutes = Math.floor(ms / 60000);
  const seconds = (ms % 60000) / 1000;
  return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
}

export function gap(ms: number): string {
  if (ms <= 0) return 'LEADER';
  return `+${(ms / 1000).toFixed(3)}`;
}

export function shortGap(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Compound identity, using the letter and colour a timing screen would show. */
export const COMPOUND_LOOK: Record<CompoundId, { letter: string; colour: string }> = {
  soft: { letter: 'S', colour: '#e8412e' },
  medium: { letter: 'M', colour: '#f2b705' },
  hard: { letter: 'H', colour: '#e6ebf2' },
  intermediate: { letter: 'I', colour: '#35d07f' },
  wet: { letter: 'W', colour: '#4d9dff' },
};

export const WEATHER_LABEL: Record<WeatherState, string> = {
  dry: 'DRY',
  damp: 'DAMP',
  wet: 'WET',
};
