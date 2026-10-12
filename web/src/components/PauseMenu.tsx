import { IonButton } from '@ionic/react';
import type { GameStats } from '../game/Game';

interface Props {
  stats: GameStats | null;
  onResume: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onQuit: () => void;
}

const fmtTime = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

export default function PauseMenu({ stats, onResume, onSettings, onHelp, onQuit }: Props) {
  return (
    <div className="pause-menu">
      <div className="pause-panel">
        <h2>PAUSED</h2>
        {stats && (
          <div className="pause-stats">
            <div><span>Money</span><b>${Math.floor(stats.money).toLocaleString()}</b></div>
            <div><span>Story</span><b>{stats.story}/{stats.storyTotal}</b></div>
            <div><span>Next</span><b>{stats.nextMission}</b></div>
            <div><span>Side jobs</span><b>{stats.sideJobs}</b></div>
            <div><span>Cars stolen</span><b>{stats.carsStolen}</b></div>
            <div><span>Takedowns</span><b>{stats.kills}</b></div>
            <div><span>Wasted / Busted</span><b>{stats.wasted} / {stats.busted}</b></div>
            <div><span>Play time</span><b>{fmtTime(stats.playTime)}</b></div>
          </div>
        )}
        <div className="pause-buttons">
          <IonButton expand="block" className="menu-btn primary" onClick={onResume}>Resume</IonButton>
          <IonButton expand="block" fill="outline" className="menu-btn" onClick={onHelp}>Controls</IonButton>
          <IonButton expand="block" fill="outline" className="menu-btn" onClick={onSettings}>Settings</IonButton>
          <IonButton expand="block" fill="clear" color="danger" className="menu-btn" onClick={onQuit}>Quit to Menu</IonButton>
        </div>
        <p className="pause-note">Save at the pink marker outside your safehouse. Passing a mission auto-saves.</p>
      </div>
    </div>
  );
}
