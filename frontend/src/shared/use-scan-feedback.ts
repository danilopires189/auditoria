import { useCallback, useEffect, useRef, useState } from "react";

const SCAN_FEEDBACK_SUCCESS_MS = 1500;
const SCAN_FEEDBACK_ERROR_MS = 2200;
const SCAN_ERROR_SOUND_DURATION_SECONDS = 1;
const SCAN_ERROR_SOUND_CLOSE_DELAY_MS = 1400;

export type ScanFeedbackTone = "success" | "error";

export interface ScanFeedbackToast {
  id: number;
  tone: ScanFeedbackTone;
  title: string;
  detail: string | null;
}

type AnchorResolver = () => HTMLElement | null;

function playScanErrorSound(): void {
  if (typeof window === "undefined") return;
  const audioCtor = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!audioCtor) return;

  try {
    const ctx = new audioCtor();
    void ctx.resume().catch(() => undefined);
    const start = ctx.currentTime + 0.01;
    const end = start + SCAN_ERROR_SOUND_DURATION_SECONDS;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, start);
    master.gain.exponentialRampToValueAtTime(1, start + 0.02);
    master.gain.setValueAtTime(1, end - 0.05);
    master.gain.exponentialRampToValueAtTime(0.0001, end);

    const highPass = ctx.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.setValueAtTime(950, start);
    highPass.Q.setValueAtTime(1.1, start);

    highPass.connect(master);
    master.connect(ctx.destination);

    const playLayer = (type: OscillatorType, frequency: number, gainValue: number) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(gainValue, start);

      oscillator.connect(gain);
      gain.connect(highPass);

      oscillator.start(start);
      oscillator.stop(end + 0.02);
    };

    // Tom de erro continuo e estridente por 1,5s.
    playLayer("square", 1260, 0.62);
    playLayer("sawtooth", 1740, 0.38);

    window.setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, SCAN_ERROR_SOUND_CLOSE_DELAY_MS);
  } catch {
    // Browser pode bloquear audio programatico.
  }
}

function triggerDeviceVibration(): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(0);
    navigator.vibrate([280, 100, 360, 120, 520]);
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        navigator.vibrate([180, 60, 260]);
      }, 360);
    }
  } catch {
    // Alguns webviews bloqueiam vibracao.
  }
}

export function useScanFeedback(resolveAnchor: AnchorResolver) {
  const scanFeedbackTimerRef = useRef<number | null>(null);
  const [scanFeedback, setScanFeedback] = useState<ScanFeedbackToast | null>(null);
  const [scanFeedbackTop, setScanFeedbackTop] = useState<number | null>(null);

  const resolveScanFeedbackTop = useCallback((): number | null => {
    if (typeof window === "undefined") return null;
    const anchor = resolveAnchor();
    if (!anchor) return null;
    const rect = anchor.getBoundingClientRect();
    const minTop = 72;
    const maxTop = Math.max(minTop, window.innerHeight - 96);
    return Math.max(minTop, Math.min(maxTop, Math.round(rect.top)));
  }, [resolveAnchor]);

  const clearScanFeedbackTimer = useCallback(() => {
    if (typeof window === "undefined") return;
    if (scanFeedbackTimerRef.current != null) {
      window.clearTimeout(scanFeedbackTimerRef.current);
      scanFeedbackTimerRef.current = null;
    }
  }, []);

  const showScanFeedback = useCallback((tone: ScanFeedbackTone, title: string, detail: string | null = null) => {
    const id = Math.trunc(Date.now() + Math.random() * 1000);
    clearScanFeedbackTimer();
    setScanFeedbackTop(resolveScanFeedbackTop());
    setScanFeedback({
      id,
      tone,
      title,
      detail
    });
    if (typeof window === "undefined") return;
    const duration = tone === "error" ? SCAN_FEEDBACK_ERROR_MS : SCAN_FEEDBACK_SUCCESS_MS;
    scanFeedbackTimerRef.current = window.setTimeout(() => {
      setScanFeedback((current) => (current?.id === id ? null : current));
      scanFeedbackTimerRef.current = null;
    }, duration);
  }, [clearScanFeedbackTimer, resolveScanFeedbackTop]);

  const triggerScanErrorAlert = useCallback((_detail: string | null = null) => {
    triggerDeviceVibration();
    playScanErrorSound();
  }, []);

  useEffect(() => {
    return () => {
      clearScanFeedbackTimer();
    };
  }, [clearScanFeedbackTimer]);

  useEffect(() => {
    if (!scanFeedback || typeof window === "undefined") return;
    const updatePosition = () => {
      setScanFeedbackTop(resolveScanFeedbackTop());
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [resolveScanFeedbackTop, scanFeedback]);

  return {
    scanFeedback,
    scanFeedbackTop,
    showScanFeedback,
    triggerScanErrorAlert
  };
}
