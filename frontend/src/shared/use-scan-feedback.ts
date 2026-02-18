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

function createDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const samples = 2048;
  const curve = new Float32Array(
    new ArrayBuffer(samples * Float32Array.BYTES_PER_ELEMENT)
  );
  const k = amount;
  const deg = Math.PI / 180;
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

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
    const comp = ctx.createDynamicsCompressor();

    master.gain.setValueAtTime(1, baseTime);
    comp.threshold.setValueAtTime(-28, baseTime);
    comp.knee.setValueAtTime(6, baseTime);
    comp.ratio.setValueAtTime(12, baseTime);
    comp.attack.setValueAtTime(0.002, baseTime);
    comp.release.setValueAtTime(0.14, baseTime);
    master.connect(comp);
    comp.connect(ctx.destination);

    const playTone = (
      start: number,
      freqStart: number,
      freqEnd: number,
      duration: number
    ) => {
      const primary = ctx.createOscillator();
      const harmonic = ctx.createOscillator();
      const gain = ctx.createGain();
      const shaper = ctx.createWaveShaper();
      const highPass = ctx.createBiquadFilter();

      primary.type = "square";
      harmonic.type = "sawtooth";
      shaper.curve = createDistortionCurve(420);
      shaper.oversample = "4x";
      highPass.type = "highpass";
      highPass.frequency.setValueAtTime(1450, start);
      highPass.Q.setValueAtTime(1.4, start);

      primary.frequency.setValueAtTime(freqStart, start);
      primary.frequency.exponentialRampToValueAtTime(Math.max(220, freqEnd), start + duration);
      harmonic.frequency.setValueAtTime(freqStart * 1.85, start);
      harmonic.frequency.exponentialRampToValueAtTime(Math.max(320, freqEnd * 1.85), start + duration);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(1, start + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      primary.connect(gain);
      harmonic.connect(gain);
      gain.connect(shaper);
      shaper.connect(highPass);
      highPass.connect(master);

      primary.start(start);
      harmonic.start(start);
      primary.stop(start + duration + 0.02);
      harmonic.stop(start + duration + 0.02);
    };

    playTone(baseTime, 3600, 1900, 0.12);
    playTone(baseTime + 0.14, 3300, 1700, 0.12);
    playTone(baseTime + 0.3, 2900, 1450, 0.14);
    playTone(baseTime + 0.5, 2600, 1200, 0.18);

    window.setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, 1200);
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

  const triggerScanErrorAlert = useCallback((detail: string | null = null) => {
    showScanFeedback("error", "Erro", detail);
    triggerDeviceVibration();
    playScanErrorSound();
  }, [showScanFeedback]);

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
