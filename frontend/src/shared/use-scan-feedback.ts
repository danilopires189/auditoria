import { useCallback, useEffect, useRef, useState } from "react";

const SCAN_FEEDBACK_SUCCESS_MS = 1500;
const SCAN_FEEDBACK_ERROR_MS = 2200;

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
    const baseTime = ctx.currentTime + 0.01;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.85, baseTime);
    master.connect(ctx.destination);

    const playBeep = (
      start: number,
      frequency: number,
      duration: number
    ) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(frequency, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.4, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      oscillator.connect(gain);
      gain.connect(master);

      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    };

    // Bip de erro curto (duplo), menos agressivo que o som anterior.
    playBeep(baseTime, 880, 0.1);
    playBeep(baseTime + 0.15, 620, 0.14);

    window.setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, 700);
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
