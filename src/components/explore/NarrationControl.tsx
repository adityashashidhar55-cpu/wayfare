/**
 * Listen control for the place detail dialog (r21-detail).
 *
 * Primary path: server-generated MP3 from GET /api/narration/:placeId
 * (open-source msedge-tts on the Edge Read Aloud endpoint, cached server
 * side). This gives every user real audio - browser SpeechSynthesis is
 * flaky on mobile (iOS voice-loading races, gesture requirements).
 *
 * Fallback path: the existing SpeechSynthesis narrator (src/lib/narrate.ts)
 * kicks in automatically when the endpoint errors, so the control never
 * dead-ends on older/self-hosted deployments.
 *
 * States: idle -> loading ("Preparing audio…") -> playing (pause/stop)
 * -> error (tap to retry).
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play, Square, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createNarrator, type Narrator } from '@/lib/narrate';
import { toast } from '@/components/explore/toast';

type Mode = 'idle' | 'loading' | 'server' | 'fallback' | 'error';

interface NarrationControlProps {
  placeId: number;
  placeName: string;
  /** story text used by the SpeechSynthesis fallback */
  description?: string | null;
}

export default function NarrationControl({ placeId, placeName, description }: NarrationControlProps) {
  const narratorRef = useRef<Narrator | null>(null);
  if (narratorRef.current === null) narratorRef.current = createNarrator();

  const [mode, setMode] = useState<Mode>('idle');
  const [paused, setPaused] = useState(false);
  const [narratorState, setNarratorState] = useState({ speaking: false, paused: false });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  /** bumped on stop/place change so stale fetch handlers can't revive audio */
  const requestRef = useRef(0);

  useEffect(() => {
    const n = narratorRef.current!;
    return n.onStateChange(() => setNarratorState({ speaking: n.speaking, paused: n.paused }));
  }, []);

  function releaseAudio() {
    requestRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }

  /* stop everything when the dialog shows another place or unmounts */
  useEffect(() => {
    setMode('idle');
    setPaused(false);
    const n = narratorRef.current!;
    return () => {
      releaseAudio();
      n.stop();
    };
  }, [placeId]);

  function startFallback(requestId: number) {
    const n = narratorRef.current!;
    if (n.supported && description?.trim()) {
      n.play(description);
      if (requestId === requestRef.current) {
        setMode('fallback');
        setPaused(false);
      }
      toast('Live audio unavailable, using the device voice instead', { kind: 'info' });
    } else {
      if (requestId === requestRef.current) setMode('error');
      toast('Audio narration is unavailable right now', { kind: 'warn' });
    }
  }

  async function startServerAudio() {
    const requestId = ++requestRef.current;
    setMode('loading');
    setPaused(false);
    try {
      const res = await fetch(`/api/narration/${placeId}`);
      if (!res.ok) throw new Error(`narration endpoint ${res.status}`);
      const blob = await res.blob();
      if (blob.size < 200) throw new Error('narration endpoint returned no audio');
      if (requestId !== requestRef.current) return;
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        releaseAudio();
        setMode('idle');
        setPaused(false);
      };
      audio.onerror = () => {
        releaseAudio();
        startFallback(requestId);
      };
      await audio.play();
      if (requestId !== requestRef.current) return;
      setMode('server');
    } catch {
      if (requestId !== requestRef.current) return;
      releaseAudio();
      startFallback(requestId);
    }
  }

  function handleMainClick() {
    if (mode === 'loading') return;
    if (mode === 'server') {
      const audio = audioRef.current;
      if (!audio) return;
      if (paused) {
        void audio.play();
        setPaused(false);
      } else {
        audio.pause();
        setPaused(true);
      }
      return;
    }
    if (mode === 'fallback') {
      const n = narratorRef.current!;
      if (narratorState.speaking && !narratorState.paused) n.pause();
      else if (narratorState.speaking && narratorState.paused) n.resume();
      return;
    }
    // idle | error
    if (!description?.trim()) return;
    void startServerAudio();
  }

  function handleStop() {
    releaseAudio();
    narratorRef.current!.stop();
    setMode('idle');
    setPaused(false);
  }

  const playing =
    (mode === 'server' && !paused) || (mode === 'fallback' && narratorState.speaking && !narratorState.paused);
  const active = mode === 'server' || mode === 'fallback';

  const mainLabel =
    mode === 'loading'
      ? 'Preparing audio…'
      : mode === 'server'
        ? paused
          ? 'Resume'
          : 'Pause'
        : mode === 'fallback'
          ? narratorState.speaking
            ? narratorState.paused
              ? 'Resume'
              : 'Pause'
            : 'Listen'
          : 'Listen';

  const ariaLabel =
    mode === 'loading'
      ? 'Preparing audio narration'
      : active
        ? playing
          ? 'Pause narration'
          : 'Resume narration'
        : `Listen to the story of ${placeName}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="primary"
        size="sm"
        pill
        onClick={handleMainClick}
        disabled={mode === 'loading' || !description?.trim()}
        aria-label={ariaLabel}
        title={!description?.trim() ? 'No story to narrate yet' : ariaLabel}
        className="shadow-md"
      >
        {mode === 'loading' ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
        ) : playing ? (
          <Pause className="h-4 w-4" strokeWidth={1.75} />
        ) : active ? (
          <Play className="h-4 w-4" strokeWidth={1.75} />
        ) : (
          <Volume2 className="h-4 w-4" strokeWidth={1.75} />
        )}
        {mainLabel}
      </Button>
      {active && (
        <Button
          variant="secondary"
          size="icon-sm"
          pill
          onClick={handleStop}
          aria-label="Stop narration"
          title="Stop narration"
        >
          <Square className="h-3 w-3" strokeWidth={1.75} />
        </Button>
      )}
      {mode === 'error' && (
        <span className="type-caption text-ink-3">Audio unavailable, tap to retry</span>
      )}
    </div>
  );
}
