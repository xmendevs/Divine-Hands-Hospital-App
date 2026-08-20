import { useCallback, useEffect, useRef, useState } from "react";
import { theme } from "@hims/ui";

interface VoiceNotePlayerProps {
  audioUrl: string;
  /** Stored duration from message metadata (seconds). Used as immediate fallback. */
  storedDuration?: number;
  isOutgoing: boolean;
}

/**
 * Renders a voice note as an interactive audio player bubble.
 * Shows play/pause button, waveform progress bar, and duration.
 *
 * The `storedDuration` prop comes from message metadata and is
 * displayed immediately so the user sees the real length even
 * before the HTMLAudioElement fires loadedmetadata.
 */
export default function VoiceNotePlayer({ audioUrl, storedDuration, isOutgoing }: VoiceNotePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(storedDuration || 0);
  const [error, setError] = useState(false);
  const [bars] = useState(() => Array.from({ length: 30 }, () => 4 + Math.random() * 24));

  useEffect(() => {
    if (!audioUrl) return;

    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;
    setError(false);

    // Use stored duration as baseline; refine when metadata loads
    if (storedDuration && storedDuration > 0) {
      setDuration(storedDuration);
    }

    const onLoaded = () => {
      const dur = audio.duration;
      if (Number.isFinite(dur) && dur > 0) {
        setDuration(Math.floor(dur));
      } else if (storedDuration && storedDuration > 0) {
        setDuration(storedDuration);
      }
    };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => { setPlaying(false); setCurrentTime(0); };
    const onError = () => setError(true);

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    // Set src AFTER listeners to avoid race on cached resources
    audio.src = audioUrl;
    audio.load();

    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.src = "";
    };
  }, [audioUrl, storedDuration]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.currentTime = 0;
      audio.play().then(() => setPlaying(true)).catch(() => setError(true));
    }
  }, [playing]);

  function formatTime(secs: number) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const displayDuration = duration > 0 ? duration : (storedDuration || 0);

  if (error) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
        borderRadius: 12, background: isOutgoing ? "rgba(255,255,255,0.15)" : theme.surface.subtle,
        fontSize: 12, color: isOutgoing ? "rgba(255,255,255,0.7)" : theme.text.muted,
      }}>
        🎵 Voice note ({displayDuration > 0 ? formatTime(displayDuration) : "audio"})
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
      borderRadius: 12, background: isOutgoing ? "rgba(255,255,255,0.15)" : theme.surface.subtle,
      minWidth: 220,
    }}>
      {/* Play/Pause button */}
      <button
        onClick={togglePlay}
        style={{
          width: 36, height: 36, borderRadius: 999, border: "none",
          background: isOutgoing ? "#ffffff" : "#2563eb",
          color: isOutgoing ? "#2563eb" : "#ffffff",
          cursor: "pointer", display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 14, flexShrink: 0,
        }}
      >
        {playing ? "\u23F8" : "\u25B6"}
      </button>

      {/* Waveform bars */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 1.5, height: 28 }}>
        {bars.map((h, i) => {
          const barProgress = (i / bars.length) * 100;
          const isActive = barProgress <= progress;
          return (
            <div
              key={i}
              style={{
                width: 3, height: h, borderRadius: 2,
                background: isActive
                  ? (isOutgoing ? "#ffffff" : "#2563eb")
                  : (isOutgoing ? "rgba(255,255,255,0.3)" : theme.surface.border),
                transition: "background 0.1s", cursor: "pointer",
              }}
              onClick={() => {
                const audio = audioRef.current;
                if (!audio || duration <= 0) return;
                audio.currentTime = (i / bars.length) * duration;
              }}
            />
          );
        })}
      </div>

      {/* Duration */}
      <span style={{
        fontSize: 11, color: isOutgoing ? "rgba(255,255,255,0.8)" : theme.text.muted,
        fontVariantNumeric: "tabular-nums", minWidth: 32, textAlign: "right",
      }}>
        {playing ? formatTime(currentTime) : formatTime(displayDuration)}
      </span>
    </div>
  );
}
