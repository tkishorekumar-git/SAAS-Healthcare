/// Build-time configuration, supplied with `--dart-define`.
///
/// Only non-secret values belong here: anything compiled into the APK can be
/// extracted. The app talks to the Kenisha API only — never to the database.
class AppConfig {
  const AppConfig._();

  /// 10.0.2.2 is the host machine as seen from the Android emulator.
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:4000/api/v1',
  );

  static const String environment = String.fromEnvironment(
    'APP_ENV',
    defaultValue: 'development',
  );
}
