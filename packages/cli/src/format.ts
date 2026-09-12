/** Shared formatting for the headless tools. */
export function lapTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = (ms % 60000) / 1000;
  return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
}

export function gap(ms: number): string {
  if (ms === 0) return '     —';
  return `+${(ms / 1000).toFixed(3)}`.padStart(6);
}

export function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text.padEnd(width);
}
