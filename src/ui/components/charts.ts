import type { WeightUnit } from '@/types';
import { PLATE } from '@/data/plates';
import { formatShortDate } from '@/domain/dates';
import { percentChange } from '@/domain/metrics';
import { formatWeight } from '@/domain/units';
import type { TrendPoint, WeekBucket } from '@/state/selectors';
import { div, el, svg, text } from '../dom';

/**
 * SVG charts.
 *
 * Hand-built rather than pulled from a charting library: two chart types with
 * fixed shapes do not justify the bundle size, and drawing them directly keeps
 * full control of the accessible description.
 *
 * Each chart carries `role="img"` and a summary `aria-label`, plus a caption in
 * real text below it — the numbers must be readable without seeing the picture.
 */

const AXIS_COLOR = '#333B44';
const INK = '#EDEDE7';

/* ------------------------------------------------------- aerobic minutes */

export function renderMinutesChart(buckets: readonly WeekBucket[], goal: number): HTMLElement {
  const width = 320;
  const height = 130;
  const gap = 4;
  const barWidth = buckets.length > 0 ? (width - gap * (buckets.length - 1)) / buckets.length : width;

  const peak = Math.max(goal * 1.15, ...buckets.map((b) => b.minutes * 1.1), 60);
  const goalY = height - (goal / peak) * height;

  const chart = svg(
    'svg',
    {
      viewBox: `0 0 ${width} ${height}`,
      class: 'chart',
      role: 'img',
      'aria-label': describeBuckets(buckets, goal),
    },
    [
      svg('line', {
        x1: 0,
        x2: width,
        y1: goalY,
        y2: goalY,
        stroke: PLATE.yellow,
        'stroke-width': 1,
        'stroke-dasharray': '4 4',
        opacity: 0.7,
      }),
      ...buckets.map((bucket, index) => {
        const barHeight = (bucket.minutes / peak) * height;
        return svg('rect', {
          x: index * (barWidth + gap),
          y: height - Math.max(barHeight, 1),
          width: barWidth,
          height: Math.max(barHeight, 1),
          fill: bucket.metGoal ? PLATE.green : AXIS_COLOR,
          rx: 2,
        });
      }),
    ],
  );

  const latest = buckets.at(-1);

  return div('chart-block', [
    chart,
    renderLegend([
      [PLATE.green, `Hit ${goal} min`],
      [AXIS_COLOR, 'Under'],
      [PLATE.yellow, `${goal} min target`],
    ]),
    text('chart-block__caption', `This week: ${latest?.minutes ?? 0} min`),
  ]);
}

function describeBuckets(buckets: readonly WeekBucket[], goal: number): string {
  if (buckets.length === 0) return 'No aerobic minutes recorded.';
  const met = buckets.filter((b) => b.metGoal).length;
  const latest = buckets.at(-1)?.minutes ?? 0;
  return `Aerobic minutes over the last ${buckets.length} weeks. ${met} of ${buckets.length} weeks reached the ${goal} minute target. This week: ${latest} minutes.`;
}

/* ---------------------------------------------------------- strength trend */

export function renderTrendChart(points: readonly TrendPoint[], unit: WeightUnit): HTMLElement {
  if (points.length < 2) {
    return text(
      'chart-block__empty',
      points.length === 1
        ? 'One session logged. The trend line appears after the second.'
        : 'No weight logged for this movement yet.',
    );
  }

  const width = 320;
  const height = 140;
  const margin = 14;

  const values = points.map((point) => point.value);
  const low = Math.min(...values) * 0.94;
  const high = Math.max(...values) * 1.06;
  // A dead-flat series would divide by zero; fall back to a nominal band.
  const span = high - low || 1;

  const x = (index: number): number => margin + (index * (width - margin * 2)) / (points.length - 1);
  const y = (value: number): number => height - margin - ((value - low) / span) * (height - margin * 2);

  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`)
    .join(' ');

  const area = `${line} L${x(points.length - 1).toFixed(1)} ${height - margin} L${x(0).toFixed(1)} ${height - margin} Z`;

  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return text('chart-block__empty', 'No weight logged for this movement yet.');

  const change = percentChange(first.value, last.value);

  const chart = svg(
    'svg',
    {
      viewBox: `0 0 ${width} ${height}`,
      class: 'chart',
      role: 'img',
      'aria-label': `Estimated one-rep max over ${points.length} sessions, from ${formatWeight(first.value, unit)} on ${formatShortDate(first.date)} to ${formatWeight(last.value, unit)}.`,
    },
    [
      svg('path', { d: area, fill: PLATE.red, opacity: 0.12 }),
      svg('path', {
        d: line,
        fill: 'none',
        stroke: PLATE.red,
        'stroke-width': 2,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      }),
      ...points.map((point, index) => svg('circle', { cx: x(index), cy: y(point.value), r: 3, fill: INK })),
    ],
  );

  const caption =
    `Estimated 1-rep max: ${formatWeight(last.value, unit)}` +
    (change === null
      ? ''
      : `  ·  ${change >= 0 ? '+' : ''}${change.toFixed(1)}% since ${formatShortDate(first.date)}`);

  return div('chart-block', [chart, text('chart-block__caption', caption)]);
}

/* ------------------------------------------------------------------ legend */

export function renderLegend(entries: readonly (readonly [string, string])[]): HTMLElement {
  return el(
    'div',
    { class: 'legend' },
    entries.map(([color, label]) =>
      div('legend__item', [
        el('i', { class: 'legend__swatch', style: { background: color }, attrs: { 'aria-hidden': 'true' } }),
        el('span', { text: label }),
      ]),
    ),
  );
}
