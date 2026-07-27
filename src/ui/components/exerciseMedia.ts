import type { Exercise } from '@/types';
import { el } from '../dom';

/**
 * Illustration or demo clip for an exercise.
 *
 * Returns `null` when an exercise has no media, which is the case for all of
 * them today — this is the seam the roadmap's photos and video clips drop into.
 * Adding a `media` block in `data/exercises.ts` is the only change needed to
 * light this up for a given movement.
 *
 * Both branches are lazy and non-blocking: images are `loading="lazy"`, video
 * is muted, inline and `preload="none"`, so an exercise card never costs the
 * network anything until it is actually on screen.
 */
export function renderExerciseMedia(exercise: Exercise): HTMLElement | null {
  const media = exercise.media;
  if (!media) return null;

  const figure = el('figure', { class: 'exercise-media' });

  if (media.video) {
    const video = el('video', {
      class: 'exercise-media__asset',
      attrs: {
        src: media.video,
        poster: media.poster ?? false,
        muted: true,
        loop: true,
        playsinline: true,
        controls: true,
        preload: 'none',
        'aria-label': media.alt ?? `${exercise.name} demonstration`,
      },
    });
    // Muting via the property as well as the attribute; some browsers ignore
    // the attribute when the element is created detached.
    video.muted = true;
    figure.appendChild(video);
  } else if (media.image) {
    figure.appendChild(
      el('img', {
        class: 'exercise-media__asset',
        attrs: {
          src: media.image,
          alt: media.alt ?? `${exercise.name} demonstration`,
          loading: 'lazy',
          decoding: 'async',
        },
      }),
    );
  } else {
    return null;
  }

  if (media.credit) {
    figure.appendChild(el('figcaption', { class: 'exercise-media__credit', text: media.credit }));
  }

  return figure;
}
