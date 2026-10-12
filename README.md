# Sunvale Streets

An open-world 3D action game set in a sunny coastal city. Steal cars, outrun the cops, take on gang turf and work your way up through a seven-mission story. It runs in the browser (Ionic + three.js) and on Android (native Kotlin app).

> Original game with its own city, characters and story. Every model, texture and sound is generated in code, so there are no third-party assets.

## Download / Play

| Platform | How |
|---|---|
| **Android** | Open **[Releases → Latest build](../../releases/tag/latest)** on your phone, download `SunvaleStreets-*.apk`, and open it to install. If Android asks, allow your browser to install unknown apps. |
| **Web** | Play in the browser on **GitHub Pages**: `https://<your-user>.github.io/sunvale-streets/`. Works on desktop and mobile. |

Every push to `main` rebuilds the APK and the website automatically (see **Actions**). Pushing a tag like `v1.0.0` makes a versioned release.

## Features

- **Procedural open world**: an island city with Downtown towers, Vista Heights, Eastside, Old Town, the Marina, parks, parking lots, beaches and docks
- **Vehicles**: 8 car types (sedan, sports, muscle, van, taxi, pickup, police, armored van) with arcade drifting physics, damage, smoke, fire and explosions
- **Traffic & pedestrians**: AI cars follow lanes and stop for obstacles, people walk the sidewalks and panic when things go wrong
- **Combat**: fists, pistol, SMG and shotgun, with headshots and auto-aim on touch screens
- **Wanted system**: 1 to 5 stars, police cars chase you with sirens, cops bail out to arrest or shoot, break line of sight to escape
- **Story**: 7 missions (stealing, deliveries, a gang war, losing the cops, a street race, a heist) plus endless random side jobs
- **Day/night cycle** with lit windows, street lamps and headlights
- **HUD** with a rotating radar, health/armor, money, wanted stars, clock and area names
- **Fresh Coat** respray shop (clears your wanted level), a safehouse save point, hospital and police respawns, pickups
- **Synthesized audio**: engine, guns, sirens, crashes and 3 in-car radio stations
- **Controls**: keyboard and mouse, or touch joystick and buttons with haptics on Android

## Controls

| Action | Keyboard / Mouse | Touch |
|---|---|---|
| Move / drive | WASD / arrows | Left-side joystick |
| Look | Mouse (click to lock) | Drag on the right side |
| Run | Shift | RUN (or push the stick all the way) |
| Jump / handbrake | Space | JUMP / BRAKE |
| Enter / exit car | F or Enter | CAR |
| Attack | Left click | PUNCH / FIRE |
| Switch weapon | Q / Tab / wheel | WPN |
| Radio | R | RADIO |
| Horn | H | HORN (RUN while driving) |
| Pause | Esc / P | II / Back button |

## Project structure

```
web/        Ionic React + Vite + three.js (game engine and UI)
  src/game/   engine: World, Vehicle, Ped, Character, Missions, Hud, Input, Audio...
  src/components/  Ionic menus: main menu, pause, settings, help
android/    Native Kotlin app (Gradle, AGP 8.7, Kotlin 2.0, minSdk 26)
  app/src/main/java/com/sunvale/streets/
    MainActivity.kt  immersive fullscreen, landscape, back button, lifecycle
    GameBridge.kt    JS <-> Kotlin bridge: saves, vibration, exit
.github/workflows/build.yml   CI: web build -> APK -> GitHub Release + Pages
```

The Android app bundles the web build in `assets/www` and serves it through `WebViewAssetLoader` from a secure local origin. Kotlin handles everything native: saves in SharedPreferences, haptics, immersive mode and the back button.

## Develop locally

```bash
cd web
npm install
npm run dev        # http://localhost:5173  (add ?debug to expose window.__svGame)
npm run build      # production build into web/dist
```

Build the APK yourself (needs the Android SDK and JDK 17):

```bash
cd web && npm run build && cd ../android
gradle assembleRelease      # the web build is copied into the APK automatically
# -> android/app/build/outputs/apk/release/app-release.apk
```

## Signing

CI signs the APK with the release keystore stored in these repository secrets:
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Without them it falls back to a debug key, so the APK still installs. Because the key stays the same, each new build installs as an update over the previous one.
