import { useCallback, useEffect, useRef, useState } from "react";
import { theme, Button } from "@hims/ui";

interface VoiceRecorderProps {
  onRecord: (blob: Blob, duration: number) => void;
  onCancel: () => void;
}

/**
 * Inline voice recorder shown in the chat input area.
 * Records audio via MediaRecorder, shows live wave animation + timer,
 * and calls onRecord(blob, seconds) when the user stops.
 *
 * FIX: durationRef ensures onstop always captures the real elapsed
 * seconds even though React state updates are async.
 */
export default function VoiceRecorder({ onRecord, onCancel }: VoiceRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [analyserData, setAnalyserData] = useState<number[]>(new Array(32).fill(0));
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // FIX: track elapsed seconds in a ref so onstop can read the real value
  const durationRef = useRef(0);

  const stopRecording = useCallback(() => {
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      mediaRef.current.stop();
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = 0; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRef.current = recorder;
      chunksRef.current = [];
      durationRef.current = 0;

      // Set up analyser for wave animation
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        // FIX: read from ref, not from the stale closure
        const elapsed = durationRef.current;
        onRecord(blob, elapsed);
        if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
          audioCtxRef.current.close().catch(() => {});
          audioCtxRef.current = null;
        }
      };

      recorder.start(100); // collect data every 100ms
      setRecording(true);
      setDuration(0);

      timerRef.current = setInterval(() => {
        durationRef.current += 1;
        setDuration(durationRef.current);
      }, 1000);

      // Wave animation loop
      const updateWave = () => {
        if (!analyserRef.current) return;
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        setAnalyserData(Array.from(data));
        animRef.current = requestAnimationFrame(updateWave);
      };
      animRef.current = requestAnimationFrame(updateWave);
    } catch {
      onCancel();
    }
  }, [onRecord, onCancel]);

  useEffect(() => {
    void startRecording();
    return () => stopRecording();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function formatDuration(secs: number) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: theme.spacing["3"], padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`, background: theme.surface.subtle, borderRadius: theme.radius.md }}>
      {/* Wave animation */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, height: 32 }}>
        {analyserData.slice(0, 24).map((v, i) => (
          <div
            key={i}
            style={{
              width: 3,
              height: Math.max(4, (v / 255) * 28),
              background: recording ? "#ef4444" : theme.text.muted,
              borderRadius: 2,
              transition: "height 0.05s",
            }}
          />
        ))}
      </div>

      {/* Timer */}
      <span style={{ fontSize: theme.fontSize.sm, color: theme.text.primary, fontWeight: theme.fontWeight.bold, minWidth: 40, fontVariantNumeric: "tabular-nums" }}>
        {formatDuration(duration)}
      </span>

      {/* Recording indicator */}
      {recording && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: 999, background: "#ef4444", animation: "pulse 1s infinite" }} />
          <span style={{ fontSize: theme.fontSize.xs, color: "#ef4444" }}>Recording</span>
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* Cancel */}
      <Button
        size="sm"
        onClick={() => { stopRecording(); onCancel(); }}
        style={{ background: theme.surface.border, color: theme.text.primary }}
      >
        Cancel
      </Button>

      {/* Stop & Send */}
      <Button
        size="sm"
        onClick={() => stopRecording()}
        style={{ background: "#2563eb", color: "#fff" }}
      >
        Send Voice Note
      </Button>
    </div>
  );
}
