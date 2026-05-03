/**
 * useNotificationSound
 *
 * Lightweight audio playback for in-app notifications. Lazily creates an
 * HTMLAudioElement on first mount, respects the user mute preference stored
 * in localStorage, and silently swallows browser autoplay-policy errors.
 *
 * Usage:
 *   const playSound = useNotificationSound();
 *   playSound(); // call on the event you want to announce
 *
 * Mute is controlled by `localStorage.notification_sound`:
 *   - 'on' (default) or any value other than 'off' plays the sound
 *   - 'off' silences playback without disabling the rest of the flow
 */

import { useCallback, useEffect, useRef } from 'react';

const DEFAULT_SOUND_SRC = '/sounds/new-order.mp3';
const STORAGE_KEY = 'notification_sound';

export function useNotificationSound(src: string = DEFAULT_SOUND_SRC) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(src);
    audio.volume = 0.5;
    audio.preload = 'auto';
    audioRef.current = audio;

    return () => {
      // Stop any in-flight playback before dropping the reference.
      try {
        audio.pause();
        audio.src = '';
      } catch {
        // ignore: best-effort cleanup
      }
      audioRef.current = null;
    };
  }, [src]);

  return useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Respect user mute preference. Anything other than 'off' is treated as on.
    const muted = typeof window !== 'undefined'
      && window.localStorage?.getItem(STORAGE_KEY) === 'off';
    if (muted) return;

    try {
      audio.currentTime = 0;
    } catch {
      // Some browsers throw if the element is not ready yet; safe to ignore.
    }

    // Browsers block autoplay until the user interacts with the page.
    // Swallow the rejection so it does not surface as an unhandled promise.
    audio.play().catch(() => {
      // Intentional no-op: autoplay blocked or audio not yet ready.
    });
  }, []);
}

export default useNotificationSound;
