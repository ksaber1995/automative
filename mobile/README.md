# Netrofit App

One Flutter app, two audiences of the [Netrofit](https://app.netrofit.com) academy platform:

1. **Parent** — scan the student's QR card once and the child stays on the home screen. The dashboard answers the three questions parents open the app for: attendance (animated ring + per-group breakdown + recent-sessions timeline), grades/homework, and payments (with an outstanding-balance banner). No account needed — the card's QR token is the credential, exactly like the public web page, but the app remembers the family.
2. **Student** — sign in (or claim a fresh card by scanning it), see open online exams, and sit them on the phone: one question per page, every answer saved to the server the moment it's tapped, a countdown driven by the server clock, auto-submit on timeout, and a full answer review when the teacher allows it.

## Backend

Talks to the production API through CloudFront (`https://app.netrofit.com/api`) — the same endpoints the web apps use:

- Parent: `GET /api/public/students/:qrToken` (public; token = credential)
- Student: `/api/student-auth/*` (login, claim-start/finish, me) and `/api/student/*` (exams, attempt, answer, submit, results), Bearer token with a 12-hour TTL — any 401 returns the student to login with all saved answers intact server-side.

Change `kApiBase` in `lib/core/api.dart` to point at a dev stack.

## Structure

```
lib/
  main.dart            app entry — providers, RTL, theme
  landing.dart         mode chooser (parent / student)
  core/                api client, theme, QR-payload parsing
  models/              parent profile + student exam models
  parent/              children store (device-local), scanner, dashboard
  student/             session, login/claim, exams, sitting screen, results
```

## Run

```bash
flutter pub get
flutter run
```

QR scanning uses `mobile_scanner` — Android needs `minSdkVersion 23`
(already set in `android/app/build.gradle.kts`), iOS needs the
`NSCameraUsageDescription` already present in `ios/Runner/Info.plist`.
