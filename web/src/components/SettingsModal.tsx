import {
  IonButton, IonButtons, IonContent, IonHeader, IonItem, IonLabel, IonList, IonModal, IonNote,
  IonRange, IonSegment, IonSegmentButton, IonSelect, IonSelectOption, IonTitle, IonToggle, IonToolbar,
} from '@ionic/react';
import type { Settings } from '../game/Save';

interface Props {
  open: boolean;
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
}

export default function SettingsModal({ open, settings, onChange, onClose }: Props) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  return (
    <IonModal isOpen={open} onDidDismiss={onClose} className="sv-modal">
      <IonHeader>
        <IonToolbar>
          <IonTitle>Settings</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose}>Done</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonList>
          <IonItem>
            <IonLabel>
              Graphics
              <IonNote className="setting-note">High adds shadows and antialiasing</IonNote>
            </IonLabel>
            <IonSegment value={settings.quality} onIonChange={(e) => set('quality', e.detail.value as Settings['quality'])} style={{ maxWidth: 200 }}>
              <IonSegmentButton value="low"><IonLabel>Low</IonLabel></IonSegmentButton>
              <IonSegmentButton value="high"><IonLabel>High</IonLabel></IonSegmentButton>
            </IonSegment>
          </IonItem>
          <IonItem>
            <IonRange label="Sound" min={0} max={1} step={0.05} value={settings.volume}
              onIonInput={(e) => set('volume', e.detail.value as number)} />
          </IonItem>
          <IonItem>
            <IonRange label="Radio" min={0} max={1} step={0.05} value={settings.music}
              onIonInput={(e) => set('music', e.detail.value as number)} />
          </IonItem>
          <IonItem>
            <IonRange label="Look speed" min={0.3} max={2.5} step={0.1} value={settings.sensitivity}
              onIonInput={(e) => set('sensitivity', e.detail.value as number)} />
          </IonItem>
          <IonItem>
            <IonSelect label="Touch controls" value={settings.touch} interface="popover"
              onIonChange={(e) => set('touch', e.detail.value)}>
              <IonSelectOption value="auto">Auto</IonSelectOption>
              <IonSelectOption value="on">Always on</IonSelectOption>
              <IonSelectOption value="off">Off</IonSelectOption>
            </IonSelect>
          </IonItem>
          <IonItem>
            <IonToggle checked={settings.invertY} onIonChange={(e) => set('invertY', e.detail.checked)}>Invert look Y</IonToggle>
          </IonItem>
          <IonItem>
            <IonToggle checked={settings.showFps} onIonChange={(e) => set('showFps', e.detail.checked)}>Show FPS</IonToggle>
          </IonItem>
        </IonList>
        <p className="setting-foot">Touch control changes take effect the next time you load the game.</p>
      </IonContent>
    </IonModal>
  );
}
