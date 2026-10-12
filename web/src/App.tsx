import { useCallback, useEffect, useRef, useState } from 'react';
import { IonAlert, IonApp, setupIonicReact } from '@ionic/react';

import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/flex-utils.css';
import '@fontsource/bebas-neue';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/800.css';
import './theme.css';

import MainMenu from './components/MainMenu';
import GameView, { GameHandle } from './components/GameView';
import PauseMenu from './components/PauseMenu';
import SettingsModal from './components/SettingsModal';
import HowToPlay from './components/HowToPlay';
import { SaveData, Settings, clearSave, isAndroidApp, loadGame, loadSettings, saveSettings } from './game/Save';

setupIonicReact({ mode: 'md' });

type Screen = 'menu' | 'game';

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu');
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [save, setSave] = useState<SaveData | null>(() => loadGame());
  const [startSave, setStartSave] = useState<SaveData | null>(null);
  const [paused, setPaused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [gameKey, setGameKey] = useState(0);
  const game = useRef<GameHandle>(null);

  const startGame = (fromSave: SaveData | null) => {
    setStartSave(fromSave);
    setPaused(false);
    setGameKey((k) => k + 1);
    setScreen('game');
    tryFullscreen();
  };

  const pause = useCallback(() => {
    game.current?.pause();
    setPaused(true);
  }, []);

  const resume = () => {
    setPaused(false);
    game.current?.resume();
  };

  const quitToMenu = () => {
    setPaused(false);
    setScreen('menu');
    setSave(loadGame());
  };

  const updateSettings = (s: Settings) => {
    setSettings(s);
    saveSettings(s);
    game.current?.applySettings(s);
  };

  // Hardware back button on Android (called from Kotlin)
  useEffect(() => {
    window.__sunvaleBack = () => {
      if (showSettings) { setShowSettings(false); return true; }
      if (showHelp) { setShowHelp(false); return true; }
      if (confirmNew || confirmQuit) { setConfirmNew(false); setConfirmQuit(false); return true; }
      if (screen === 'game') {
        if (paused) resume();
        else pause();
        return true;
      }
      return false;
    };
    return () => { delete window.__sunvaleBack; };
  });

  return (
    <IonApp>
      {screen === 'menu' && (
        <MainMenu
          hasSave={!!save}
          save={save}
          onContinue={() => startGame(save)}
          onNew={() => (save ? setConfirmNew(true) : startGame(null))}
          onSettings={() => setShowSettings(true)}
          onHelp={() => setShowHelp(true)}
          onExit={isAndroidApp() ? () => window.SunvaleAndroid?.exitApp() : undefined}
        />
      )}
      {screen === 'game' && (
        <GameView key={gameKey} ref={game} settings={settings} save={startSave} onPause={pause} />
      )}
      {screen === 'game' && paused && (
        <PauseMenu
          stats={game.current?.stats() ?? null}
          onResume={resume}
          onSettings={() => setShowSettings(true)}
          onHelp={() => setShowHelp(true)}
          onQuit={() => setConfirmQuit(true)}
        />
      )}

      <SettingsModal open={showSettings} settings={settings} onChange={updateSettings} onClose={() => setShowSettings(false)} />
      <HowToPlay open={showHelp} onClose={() => setShowHelp(false)} />

      <IonAlert
        isOpen={confirmNew}
        header="Start a new game?"
        message="Your saved progress will be erased."
        buttons={[
          { text: 'Cancel', role: 'cancel' },
          { text: 'New Game', role: 'destructive', handler: () => { clearSave(); setSave(null); startGame(null); } },
        ]}
        onDidDismiss={() => setConfirmNew(false)}
      />
      <IonAlert
        isOpen={confirmQuit}
        header="Quit to main menu?"
        message="Anything since your last save (safehouse or mission passed) will be lost."
        buttons={[
          { text: 'Keep Playing', role: 'cancel' },
          { text: 'Quit', role: 'destructive', handler: quitToMenu },
        ]}
        onDidDismiss={() => setConfirmQuit(false)}
      />
    </IonApp>
  );
}

function tryFullscreen() {
  if (isAndroidApp()) return; // the Android host is already immersive
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (!/Android|iPhone|iPad/i.test(navigator.userAgent)) return;
  try {
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else el.webkitRequestFullscreen?.();
    (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {});
  } catch { /* not supported */ }
}
