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

/** Legend copy for the Plan tab, ordered heaviest to lightest. */
export const PLATE_LEGEND: readonly { color: string; label: string }[] = [
  { color: PLATE.red, label: '25 kg · Strength' },
  { color: PLATE.blue, label: '20 kg · Long cardio' },
  { color: PLATE.yellow, label: '15 kg · Cardio & intervals' },
  { color: PLATE.green, label: '10 kg · Pool' },
  { color: PLATE.white, label: '5 kg · Recovery' },
];
