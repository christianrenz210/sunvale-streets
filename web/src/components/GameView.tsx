import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Game, GameStats } from '../game/Game';
import { SaveData, Settings } from '../game/Save';

export interface GameHandle {
  pause(): void;
  resume(): void;
  applySettings(s: Settings): void;
  stats(): GameStats | null;
}

interface Props {
  settings: Settings;
  save: SaveData | null;
  onPause: () => void;
}

/** Hosts the three.js game inside the Ionic app and exposes a small imperative API. */
const GameView = forwardRef<GameHandle, Props>(function GameView({ settings, save, onPause }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const onPauseRef = useRef(onPause);
  onPauseRef.current = onPause;

  useImperativeHandle(ref, () => ({
    pause: () => game.current?.pause(),
    resume: () => game.current?.resume(),
    applySettings: (s) => game.current?.applySettings(s),
    stats: () => game.current?.getStats() ?? null,
  }), []);

  useEffect(() => {
    // let the loading screen paint before the (synchronous) city generation
    const t = setTimeout(() => {
      if (!host.current) return;
      try {
        const g = new Game(host.current, settings, save, { onPause: () => onPauseRef.current() });
        game.current = g;
        g.start();
        setLoading(false);
      } catch (e) {
        console.error(e);
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 60);
    return () => {
      clearTimeout(t);
      game.current?.dispose();
      game.current = null;
    };
    // the game is created once per mount; settings changes go through applySettings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="game-host" ref={host}>
      {loading && (
        <div className="loading-screen">
          <div className="loading-title">SUNVALE STREETS</div>
          <div className="loading-bar"><i /></div>
          <div className="loading-tip">{error ? `Could not start the game: ${error}` : TIPS[Math.floor(Math.random() * TIPS.length)]}</div>
        </div>
      )}
    </div>
  );
});

const TIPS = [
  'Tip: The Fresh Coat garage in the Marina repaints your car and clears your wanted level for $100.',
  'Tip: Walk into the pink marker at your safehouse to save the game.',
  'Tip: Cops lose track of you if you break line of sight long enough.',
  'Tip: Hold the handbrake while turning to drift around corners.',
  'Tip: Headshots deal much more damage.',
  'Tip: Press R in a car to change the radio station.',
];

export default GameView;
