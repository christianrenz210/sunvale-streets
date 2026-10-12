import { IonButton, IonButtons, IonContent, IonHeader, IonModal, IonTitle, IonToolbar } from '@ionic/react';

interface Props {
  open: boolean;
  onClose: () => void;
}

const KEYS: [string, string][] = [
  ['W A S D / Arrows', 'Move / drive'],
  ['Mouse', 'Look around (click the game to lock the mouse)'],
  ['Shift', 'Run'],
  ['Space', 'Jump / handbrake'],
  ['F or Enter', 'Enter / exit vehicle (steal a car)'],
  ['Left click', 'Punch / shoot'],
  ['Q, Tab or wheel', 'Switch weapon'],
  ['R', 'Change radio station (in a car)'],
  ['H', 'Horn'],
  ['C / Right click', 'Look behind'],
  ['Esc / P', 'Pause'],
];

export default function HowToPlay({ open, onClose }: Props) {
  return (
    <IonModal isOpen={open} onDidDismiss={onClose} className="sv-modal">
      <IonHeader>
        <IonToolbar>
          <IonTitle>How to Play</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose}>Close</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding help-content">
        <h3>The story</h3>
        <p>
          Ray is back in <b>Sunvale</b> after five years away. His old friend Rico runs a garage on the Eastside and the
          Vipers gang has taken over half the city. Walk into the <b className="y">yellow markers</b> to start missions.
          Finish all seven story missions, then take on endless side jobs.
        </p>

        <h3>Touch controls (phones and tablets)</h3>
        <ul>
          <li>Drag on the <b>left side</b> of the screen to move or steer. Push the stick all the way to run.</li>
          <li>Drag on the <b>right side</b> to look around.</li>
          <li><b>PUNCH / FIRE</b> attacks, and auto-aims at the nearest target in front of you.</li>
          <li><b>CAR</b> enters or exits vehicles. <b>JUMP</b> becomes the handbrake while driving and <b>RUN</b> becomes the horn.</li>
          <li><b>WPN</b> switches weapons, <b>II</b> pauses.</li>
        </ul>

        <h3>Keyboard and mouse</h3>
        <table className="keys">
          <tbody>
            {KEYS.map(([k, v]) => (
              <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>
            ))}
          </tbody>
        </table>

        <h3>The city</h3>
        <ul>
          <li><b className="p">Pink marker</b> at your safehouse (Old Town): save your game.</li>
          <li><b className="c">Cyan marker</b> at Fresh Coat in the Marina: $100 respray that repairs your car and clears your wanted level.</li>
          <li>Crimes give you <b>wanted stars</b>. Cops show up as flashing blips on the radar. Break line of sight to lose them.</li>
          <li>Get <b>wasted</b> and you wake up at the hospital. Get <b>busted</b> and you lose your weapons.</li>
          <li>Look for health, armor, cash and weapon pickups on street corners. The day/night cycle runs one game minute per second.</li>
        </ul>
      </IonContent>
    </IonModal>
  );
}
