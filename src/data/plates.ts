/**
 * Olympic bumper-plate colours, used as the app's accent system.
 *
 * Each plan day carries the colour of the plate matching its relative load, so
 * the interface tints itself by how hard the day is: red 25 kg is heaviest,
 * white 5 kg lightest. These values are mirrored by `--p-*` custom properties in
 * `styles/tokens.css`; change both together.
 */
export const PLATE = {
  red: '#C8102E',
  blue: '#1B62A8',
  yellow: '#E8B21C',
  green: '#1E7A4C',
  white: '#E4E1D8',
} as const;

export type PlateColor = (typeof PLATE)[keyof typeof PLATE];

/**
 * The text colour that clears WCAG AA on each plate.
 *
 * A single near-black foreground was documented as clearing AA on every plate
 * and does not: it measures 3.2:1 on red, 3.1:1 on blue and 3.6:1 on green, and
 * red sits under the primary button label on every strength day. Chalk clears
 * AA on those three and fails on yellow and white, so the pairing is per plate.
 * Mirrors the `--on-p-*` custom properties in `styles/tokens.css`.
 */
const CHALK = '#EDEDE7';
const NEAR_BLACK = '#0E1114';

export const ON_PLATE: Readonly<Record<string, string>> = {
  [PLATE.red]: CHALK,
  [PLATE.blue]: CHALK,
  [PLATE.green]: CHALK,
  [PLATE.yellow]: NEAR_BLACK,
  [PLATE.white]: NEAR_BLACK,
};

/** The foreground for an arbitrary accent, falling back to chalk. */
export function onPlate(color: string): string {
  return ON_PLATE[color] ?? ON_PLATE[color.toUpperCase()] ?? CHALK;
}

/** Legend copy for the Plan tab, ordered heaviest to lightest. */
export const PLATE_LEGEND: readonly { color: string; label: string }[] = [
  { color: PLATE.red, label: '25 kg · Strength' },
  { color: PLATE.blue, label: '20 kg · Long cardio' },
  { color: PLATE.yellow, label: '15 kg · Cardio & intervals' },
  { color: PLATE.green, label: '10 kg · Pool' },
  { color: PLATE.white, label: '5 kg · Recovery' },
];
