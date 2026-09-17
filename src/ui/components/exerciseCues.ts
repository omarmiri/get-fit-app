import type { Exercise } from '@/types';
import { div, el, text } from '../dom';
import { renderExerciseMedia } from './exerciseMedia';

/**
 * How to do the movement: the plain-language description, the illustration slot
 * and the setup / do / avoid cues.
 *
 * This is reference material. It was permanently on the logging card, below the
 * controls, which is both the wrong place — you read it before you touch the
 * machine, not while you are on it — and part of why the log button ended up
 * two screens down. It lives behind "Setup and cues" in the session menu now,
 * and on the pre-session screen where it is actually read.
 */
export function renderExerciseCues(exercise: Exercise): HTMLElement {
  const rows: [string, string, string][] = [
    ['Setup', exercise.cues.setup, ''],
    ['Do', exercise.cues.execute, ''],
    ['Avoid', exercise.cues.avoid, 'cue--warn'],
  ];

  return el('details', { class: 'cues' }, [
    el('summary', {}, [
      el('span', { text: `Setup and cues — ${exercise.name}` }),
      el('span', { class: 'cues__chevron', attrs: { 'aria-hidden': 'true' }, text: '▾' }),
    ]),
    exercise.summary ? text('exercise__summary', exercise.summary) : null,
    renderExerciseMedia(exercise),
    ...rows.map(([key, body, modifier]) =>
      div(`cue ${modifier}`.trim(), [text('cue__key', key), text('cue__body', body)]),
    ),
    ...renderTips(exercise),
  ]);
}

/** Extra coaching notes. Empty for most exercises; a roadmap growth point. */
function renderTips(exercise: Exercise): HTMLElement[] {
  if (!exercise.tips || exercise.tips.length === 0) return [];

  return [
    div('cue', [
      text('cue__key', 'Notes'),
      el(
        'ul',
        { class: 'cue__body cue__list' },
        exercise.tips.map((tip) => el('li', { text: tip })),
      ),
    ]),
  ];
}
