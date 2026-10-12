import { IonButton } from '@ionic/react';
import type { SaveData } from '../game/Save';

interface Props {
  hasSave: boolean;
  save: SaveData | null;
  onContinue: () => void;
  onNew: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onExit?: () => void;
}

export default function MainMenu({ hasSave, save, onContinue, onNew, onSettings, onHelp, onExit }: Props) {
  return (
    <div className="main-menu">
      <div className="menu-sky">
        <div className="menu-sun" />
        <svg className="menu-skyline" viewBox="0 0 1200 300" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 300V190h40v-40h30v60h25V120h50v90h20v-50h35v70h30V90h60v120h20v-70h40v50h25V60h45v150h30v-90h50v80h20V140h40v70h30V100h55v110h25v-60h35v60h40V70h50v140h20v-80h45v90h30V150h40v60h35V110h45v100h30v-50h40v140z" />
        </svg>
        <svg className="menu-palm" viewBox="0 0 200 400" aria-hidden="true">
          <path d="M98 400c-4-90 2-170 14-240l8 2c-10 70-14 150-12 238z" />
          <path d="M112 160c-40-30-80-25-105-5 35-8 70-8 105 5zM112 160c35-40 75-40 95-20-35-5-65 2-95 20zM112 160c-15-45-50-65-85-65 35 12 62 35 85 65zM112 160c20-45 55-60 88-55-35 10-62 28-88 55zM112 160c-30-5-60 20-70 55 18-28 42-45 70-55z" />
        </svg>
      </div>

      <div className="menu-content">
        <h1 className="menu-title">
          <span>SUNVALE</span>
          <span className="menu-title-2">STREETS</span>
        </h1>
        <p className="menu-sub">An open-world crime story on the coast</p>

        <div className="menu-buttons">
          {hasSave && (
            <IonButton expand="block" className="menu-btn primary" onClick={onContinue}>
              Continue
              {save && <small className="menu-btn-sub">${save.money.toLocaleString()} · Story {save.story}/7</small>}
            </IonButton>
          )}
          <IonButton expand="block" className={`menu-btn ${hasSave ? '' : 'primary'}`} onClick={onNew}>New Game</IonButton>
          <IonButton expand="block" fill="outline" className="menu-btn" onClick={onHelp}>How to Play</IonButton>
          <IonButton expand="block" fill="outline" className="menu-btn" onClick={onSettings}>Settings</IonButton>
          {onExit && <IonButton expand="block" fill="clear" className="menu-btn" onClick={onExit}>Exit</IonButton>}
        </div>
      </div>
      <div className="menu-footer">v1.0 · Built with Ionic, three.js and Kotlin</div>
    </div>
  );
}
