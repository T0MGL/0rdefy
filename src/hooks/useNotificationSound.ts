/**
 * useNotificationSound
 *
 * Generates a short two-tone "ding" via Web Audio API on demand. We synthesize
 * the sound in code instead of streaming an audio file so there is no embedded
 * creator attribution / speech, the duration is exactly what we want, and the
 * peak loudness is fully under our control. System volume still applies on top
 * because the OS mixer scales the AudioContext output.
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

const STORAGE_KEY = 'notification_sound';

type AudioCtor = typeof AudioContext;

function getAudioContextCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function useNotificationSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      const ctx = ctxRef.current;
      if (ctx && ctx.state !== 'closed') {
        ctx.close().catch(() => { /* best-effort */ });
      }
      ctxRef.current = null;
    };
  }, []);

  return useCallback(() => {
    if (typeof window === 'undefined') return;
    if (window.localStorage?.getItem(STORAGE_KEY) === 'off') return;

    const Ctor = getAudioContextCtor();
    if (!Ctor) return;

    let ctx = ctxRef.current;
    if (!ctx) {
      try {
        ctx = new Ctor();
        ctxRef.current = ctx;
      } catch {
        return;
      }
    }

    // Autoplay policy can leave the context suspended until a user gesture.
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => { /* ignored */ });
    }

    // Peak gain kept low; OS volume scales this further so users on a loud
    // device still hear something restrained rather than a blast.
    const peak = 0.12;
    const now = ctx.currentTime;

    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      // Short attack + exponential decay avoids the click you'd get from a
      // hard on/off envelope.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    };

    // Two-note rising chime (A5 -> E6).
    playTone(880, now, 0.14);
    playTone(1318.51, now + 0.11, 0.18);
  }, []);
}

export default useNotificationSound;
