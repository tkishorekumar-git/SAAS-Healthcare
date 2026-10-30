# Kenisha Mobile (Flutter · Android)

Android app for patients, parents/guardians and clinical staff. It talks **only** to the
Kenisha REST API — it never connects to PostgreSQL or Redis directly.

**Status (Milestone 1):** Dart source, lint rules and a widget test are in place. The native
`android/` project is generated on your machine with `flutter create` (step 3 below) because it
depends on your local Flutter/Android SDK versions.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Flutter SDK | latest stable (Dart ≥ 3.5) | <https://docs.flutter.dev/get-started/install/windows/mobile> |
| Android Studio | latest stable | Installs the Android SDK, platform tools and emulator |
| Android SDK | API 35 platform + build tools | Via Android Studio → SDK Manager |
| JDK | 17 | Bundled with Android Studio |

Verify the toolchain:

```bash
flutter doctor -v
```

Accept Android licences if prompted: `flutter doctor --android-licenses`.

## First-time setup

Run from `apps/mobile`:

```bash
# 1. Fetch Dart dependencies
flutter pub get

# 2. Check lints and tests pass
flutter analyze
flutter test

# 3. Generate the Android project (one time). Keeps the existing lib/ and test/ files.
flutter create . --project-name kenisha_mobile --org com.kenishahealthcare --platforms android
```

Commit the generated `android/` folder, **except** files ignored by the root `.gitignore`
(`local.properties`, keystores, `key.properties`).

## Running against the local API

Start the API from the repo root (`pnpm dev:api`), then start an emulator and run:

```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000/api/v1 --dart-define=APP_ENV=development
```

- `10.0.2.2` is the host machine from inside the Android emulator.
- On a physical device use your computer's LAN IP and make sure the API accepts it.
- Android blocks cleartext HTTP by default on API 28+. For local development only, add a
  debug-only network security config (`android/app/src/debug/res/xml/network_security_config.xml`)
  permitting `10.0.2.2`. Release builds must use HTTPS.

## Build-time configuration

| `--dart-define` | Default | Description |
| --- | --- | --- |
| `API_BASE_URL` | `http://10.0.2.2:4000/api/v1` | Base URL of the Kenisha API |
| `APP_ENV` | `development` | `development`, `staging` or `production` |

Never pass secrets with `--dart-define`; anything compiled into an APK can be extracted.

## Structure

```
lib/
├── main.dart                 # Entry point
└── src/
    ├── app.dart              # MaterialApp, theme, routing (later)
    ├── config/app_config.dart
    └── features/<feature>/   # Feature-first folders (home, auth, appointments, …)
test/                         # Widget and unit tests
```

## Planned (later milestones)

- API client generated from the API's OpenAPI document (`/api/docs-json`)
- Secure token storage (`flutter_secure_storage`) and certificate pinning review
- State management and routing decisions — proposed in an ADR before adoption
- Release signing, Play Console setup, flavors (dev / staging / prod)
