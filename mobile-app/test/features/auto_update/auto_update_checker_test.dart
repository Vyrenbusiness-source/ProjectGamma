// flutter_test-suite für auto_update_checker (pure-dart, keine widget-deps).
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:projectgamma_mobile/features/auto_update/auto_update_checker.dart';
import 'package:crypto/crypto.dart' show sha256;

void main() {
  test('compareVersions: remote-neuer → positiv', () {
    expect(compareVersions('1.0.0+1', '1.0.0+2'), greaterThan(0));
    expect(compareVersions('1.0.0+5', '1.1.0+1'), greaterThan(0));
  });

  test('compareVersions: gleich → 0', () {
    expect(compareVersions('1.2.3+4', '1.2.3+4'), 0);
  });

  test('compareVersions: remote-älter → negativ', () {
    expect(compareVersions('1.2.0+1', '1.1.99+99'), lessThan(0));
  });

  test('compareVersions: unparsbar → 0', () {
    expect(compareVersions('foo', '1.0.0+1'), 0);
  });

  test('isUpdateAvailable: nur bei neuerer remote-version', () {
    final remote = ReleaseInfo.fromJson({
      'projectId': 'p', 'version': '1.0.0+2', 'semver': '1.0.0',
      'build': 2, 'sha256': 'x', 'size': 0, 'builtAt': 0,
    });
    expect(isUpdateAvailable('1.0.0+1', remote), isTrue);
    expect(isUpdateAvailable('1.0.0+2', remote), isFalse);
    expect(isUpdateAvailable('1.0.0+3', remote), isFalse);
  });

  test('verifyApkSha256: matched + mismatch', () {
    final bytes = Uint8List.fromList([1, 2, 3, 4]);
    final hex = sha256.convert(bytes).toString();
    expect(verifyApkSha256(bytes, hex), isTrue);
    expect(verifyApkSha256(bytes, hex.toUpperCase()), isTrue);
    expect(verifyApkSha256(bytes, 'deadbeef'), isFalse);
    expect(verifyApkSha256(bytes, ''), isFalse);
  });

  test('fetchReleaseInfo: parst json korrekt', () async {
    final info = await fetchReleaseInfo(
      apiBase: 'http://x:7892', token: 't', projectId: 'projectgamma',
      fetchJson: (url, {headers}) async {
        expect(url, contains('/api/updates/apk/info?projectId=projectgamma'));
        expect(headers!['Authorization'], 'Bearer t');
        return {
          'projectId': 'projectgamma', 'version': '2.0.0+1',
          'semver': '2.0.0', 'build': 1, 'sha256': 'abc',
          'size': 42, 'builtAt': 1,
        };
      },
    );
    expect(info, isNotNull);
    expect(info!.version, '2.0.0+1');
    expect(info.sha256, 'abc');
  });

  test('fetchReleaseInfo: liefert null bei error-payload', () async {
    final info = await fetchReleaseInfo(
      apiBase: 'http://x', token: 't', projectId: 'p',
      fetchJson: (url, {headers}) async => {'error': 'keine apk'},
    );
    expect(info, isNull);
  });

  test('buildDownloadRequest: enthält auth+projectId', () {
    final r = buildDownloadRequest(
      apiBase: 'http://x:7892', token: 'tk', projectId: 'projectgamma');
    expect(r['url'], contains('/api/updates/apk/download?projectId=projectgamma'));
    expect((r['headers'] as Map)['Authorization'], 'Bearer tk');
  });

  test('decodeJsonBytes: utf8 → map', () {
    final bytes = utf8.encode('{"a":1}');
    expect(decodeJsonBytes(bytes), {'a': 1});
  });
}
