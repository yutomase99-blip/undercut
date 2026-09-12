import {
  DOWNFORCE_RANGE,
  fuelFactorFor,
  suggestedDownforce,
  teamById,
  tyreLoadFor,
  type Track,
} from '@undercut/engine';
import { el } from './dom.ts';

export interface CarSetupOptions {
  app: HTMLElement;
  track: Track;
  teamId: string;
  seed: string;
  subtitle?: string;
  onConfirm: (downforce: number) => void;
}

const STEPS = 9;

/**
 * The one decision made before a wheel turns.
 *
 * Wing is a straight trade: the circuit has an amount it wants, and running
 * more or less than that costs lap time. Less wing wears the tyres more gently,
 * burns less fuel and is quicker where passes actually happen; more wing does
 * the opposite.
 *
 * The player is never told the circuit's optimum outright. Their engineers
 * offer a reading, and it is exactly as good as the team is — the same bargain
 * the weather forecast makes.
 */
export function renderCarSetup(options: CarSetupOptions): void {
  const team = teamById(options.teamId);
  const recommendation = suggestedDownforce(options.track, team, options.seed);
  let chosen = Math.round(recommendation * (STEPS - 1)) / (STEPS - 1);

  render();

  function render(): void {
    options.app.replaceChildren();
    const page = el('div', 'setup');

    const mark = el('h1', 'setup__mark');
    mark.innerHTML = 'The <em>setup</em>';
    page.append(mark);
    page.append(
      el(
        'p',
        'setup__lede',
        `${options.track.name} wants a certain amount of wing, and your engineers have a view on how much. Run more than the circuit wants and you give up lap time; run less and you give up lap time too — but you will be kinder on the tyres, lighter on fuel, and harder to pass.`,
      ),
    );

    const panel = el('div', 'panel quali__panel');
    panel.append(el('span', 'eyebrow', 'Wing level'));

    const scale = el('div', 'wing');
    for (let step = 0; step < STEPS; step += 1) {
      const value = step / (STEPS - 1);
      const button = el('button', 'wing__step');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(Math.abs(value - chosen) < 1e-6));
      button.title = `${Math.round(value * 100)}% wing`;
      if (Math.abs(value - recommendation) < 0.5 / (STEPS - 1)) {
        button.classList.add('wing__step--suggested');
        button.title += ' — your engineers suggest this';
      }
      button.innerHTML = `<span class="wing__bar" style="height:${18 + step * 5}px"></span>`;
      button.addEventListener('click', () => {
        chosen = value;
        render();
      });
      scale.append(button);
    }
    panel.append(scale);

    const ends = el('div', 'wing__ends');
    ends.append(el('span', 'choice__meta', 'Stripped'), el('span', 'choice__meta', 'Maximum'));
    panel.append(ends);

    const wear = tyreLoadFor(chosen);
    const fuel = fuelFactorFor(chosen);
    const readouts = el('div', 'readouts');
    readouts.innerHTML = `
      <div class="readout">
        <span class="eyebrow">Wing</span>
        <span class="readout__value">${Math.round(chosen * 100)}%</span>
      </div>
      <div class="readout">
        <span class="eyebrow">Tyre wear</span>
        <span class="readout__value" style="color:${wear > 1 ? 'var(--amber)' : 'var(--green)'}">${wear > 1 ? '+' : ''}${Math.round((wear - 1) * 100)}%</span>
      </div>
      <div class="readout">
        <span class="eyebrow">Fuel burn</span>
        <span class="readout__value" style="color:${fuel > 1 ? 'var(--amber)' : 'var(--green)'}">${fuel > 1 ? '+' : ''}${Math.round((fuel - 1) * 100)}%</span>
      </div>`;
    panel.append(readouts);

    panel.append(
      el(
        'p',
        'hub__note hub__note--dim',
        `Your engineers read this circuit at about ${Math.round(recommendation * 100)}% wing. How much you trust them is up to you — a better-run team reads it better.`,
      ),
    );
    page.append(panel);

    const confirm = el('button', 'start', 'Take it to qualifying');
    confirm.type = 'button';
    confirm.addEventListener('click', () => options.onConfirm(chosen));
    page.append(confirm);

    options.app.append(page);
  }
}

export { DOWNFORCE_RANGE };
