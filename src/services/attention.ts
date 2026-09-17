/**
 * Getting your attention when it is elsewhere.
 *
 * Rest was correct and invisible: a strip behind the tab bar, a 120-60-120
 * vibration and a toast that fades. `navigator.vibrate` does not exist on iOS
 * at all, which is the platform this is built for — so on the target device
 * rest ended with no signal whatsoever, and the only way to know was to keep
 * looking. Most of what felt like a missing alert was really the phone having
 * gone dark.
 *
 * Three things fix that, in order of effect:
 *
 * 1. Hold a screen wake lock for the life of an open session, so the moment
 *    never arrives. Safari 16.4+ and Chrome both support it. When the lock is
 *    refused, the rest screen says so once rather than pretending.
 * 2. Synthesise a chime with an oscillator — no asset, nothing to cache. The
 *    AudioContext is created inside the Start tap, and that one gesture buys
 *    audio for every rest in the session.
 * 3. Say the next movement out loud, on-device, off by default.
 *
 * What is deliberately not here: anything that has to fire while backgrounded.
 * An installed iOS PWA gets no reliable timer, audio or notification once it is
 * suspended, and push needs a server in the path. A background alarm that works
 * on Android and silently fails on iPhone is worse than none.
 */

interface WakeLockLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockNavigator {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockLike> };
}

/** Where a tone sits and how long it lasts. */
interface Tone {
  readonly hz: number;
  readonly startsAt: number;
  readonly seconds: number;
}

const WARNING: readonly Tone[] = [
  { hz: 880, startsAt: 0, seconds: 0.09 },
  { hz: 880, startsAt: 0.18, seconds: 0.09 },
];

const COMPLETE: readonly Tone[] = [{ hz: 660, startsAt: 0, seconds: 0.55 }];

export class Attention {
  #audio: AudioContext | null = null;
  #lock: WakeLockLike | null = null;
  #wanted = false;
  #refused = false;

  constructor() {
    // A wake lock is dropped whenever the tab is hidden and is not restored on
    // return, so a session that survives a lock-screen has to re-take it.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.#wanted) void this.hold();
    });
  }

  /** True when the browser turned the wake lock down, so the UI can say so. */
  get wakeLockRefused(): boolean {
    return this.#refused;
  }

  /**
   * Create the AudioContext inside a user gesture.
   *
   * Called from the Start tap. Browsers only let audio start from a gesture,
   * and a context created in one stays usable for the rest of the page's life —
   * so this single call is what makes every later rest audible.
   */
  unlock(): void {
    if (this.#audio) {
      if (this.#audio.state === 'suspended') void this.#audio.resume();
      return;
    }

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    try {
      this.#audio = new Ctor();
    } catch {
      // No audio on this device. Everything else still works.
      this.#audio = null;
    }
  }

  /** Two short beeps: rest is nearly over. */
  warn(): void {
    this.#play(WARNING);
  }

  /** One long beep: rest is over. */
  complete(): void {
    this.#play(COMPLETE);
  }

  /**
   * Say one line out loud, on-device.
   *
   * Replaces the glance, not the screen — "Chest press. Ninety-five, ten reps"
   * is the whole feature. Off by default, because it is also the thing most
   * likely to embarrass someone in a quiet gym.
   */
  speak(line: string): void {
    if (typeof speechSynthesis === 'undefined') return;
    try {
      speechSynthesis.cancel();
      speechSynthesis.speak(new SpeechSynthesisUtterance(line));
    } catch {
      // Refused or unsupported. The screen still says it.
    }
  }

  /** Keep the screen on for the life of an open session. */
  async hold(): Promise<void> {
    this.#wanted = true;
    if (this.#lock) return;

    const api = (navigator as WakeLockNavigator).wakeLock;
    if (!api) {
      this.#refused = true;
      return;
    }

    try {
      const lock = await api.request('screen');
      lock.addEventListener('release', () => {
        this.#lock = null;
      });
      this.#lock = lock;
      this.#refused = false;
    } catch {
      // Refused — low battery, a policy, or an unsupported context. Said once
      // on the rest screen rather than papered over.
      this.#refused = true;
    }
  }

  /** Let the screen sleep again. Called when the session ends. */
  release(): void {
    this.#wanted = false;
    const lock = this.#lock;
    this.#lock = null;
    if (lock) void lock.release();
  }

  #play(tones: readonly Tone[]): void {
    const audio = this.#audio;
    if (!audio) return;
    if (audio.state === 'suspended') void audio.resume();

    for (const tone of tones) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const start = audio.currentTime + tone.startsAt;

      oscillator.type = 'sine';
      oscillator.frequency.value = tone.hz;

      // Ramped rather than switched: a square-edged gate on a sine wave clicks.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.35, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.seconds);

      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(start);
      oscillator.stop(start + tone.seconds + 0.05);
    }
  }
}
