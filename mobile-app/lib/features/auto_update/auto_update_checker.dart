// auto_update_checker · pure-dart heuristik für mobile-auto-update.
// Holt /api/updates/apk/info vom desktop-server, vergleicht mit aktueller
// version, prüft sha256 nach download. Keine flutter-imports → ohne
// widget-tester testbar (regel "ki/heuristik-logik immer pure-dart").
//
// Install selbst geschieht plattform-spezifisch (z.b. open_filex / intent),
// dieses modul liefert nur die entscheidung + verifikation.

import 'dart:convert';
import 'dart:typed_data';
import 'package:crypto/crypto.dart' show sha256;

class ReleaseInfo {
  final String projectId;
  final String version;
  final String semver;
  final int build;
  final String sha256;
  final int size;
  final int builtAt;

  const ReleaseInfo({
    required this.projectId,
    required this.version,
    required this.semver,
    required this.build,
    required this.sha256,
    required this.size,
    required this.builtAt,
  });

  factory ReleaseInfo.fromJson(Map<String, dynamic> j) => ReleaseInfo(
        projectId: j['projectId'] as String? ?? '',
        version: j['version'] as String? ?? '',
        semver: j['semver'] as String? ?? '',
        build: (j['build'] as num?)?.toInt() ?? 0,
        sha256: j['sha256'] as String? ?? '',
        size: (j['size'] as num?)?.toInt() ?? 0,
        builtAt: (j['builtAt'] as num?)?.toInt() ?? 0,
      );
}

class _ParsedVersion {
  final List<int> semverParts;
  final int build;
  const _ParsedVersion(this.semverParts, this.build);
}

_ParsedVersion? _parseVersion(String v) {
  final m = RegExp(r'^(\d+(?:\.\d+){0,3})\+(\d+)$').firstMatch(v.trim());
  if (m == null) return null;
  final parts = m.group(1)!.split('.').map(int.parse).toList();
  return _ParsedVersion(parts, int.parse(m.group(2)!));
}

/// Liefert >0 wenn `remote` neuer als `local`, <0 wenn älter, 0 bei gleich
/// oder unparsbar. Format: "1.2.3+45".
int compareVersions(String local, String remote) {
  final a = _parseVersion(local);
  final b = _parseVersion(remote);
  if (a == null || b == null) return 0;
  final maxLen = a.semverParts.length > b.semverParts.length
      ? a.semverParts.length
      : b.semverParts.length;
  for (var i = 0; i < maxLen; i++) {
    final da = i < a.semverParts.length ? a.semverParts[i] : 0;
    final db = i < b.semverParts.length ? b.semverParts[i] : 0;
    if (da != db) return db - da > 0 ? 1 : -1;
  }
  if (a.build != b.build) return b.build - a.build > 0 ? 1 : -1;
  return 0;
}

bool isUpdateAvailable(String localVersion, ReleaseInfo remote) {
  return compareVersions(localVersion, remote.version) > 0;
}

bool verifyApkSha256(Uint8List bytes, String expectedHex) {
  if (expectedHex.isEmpty) return false;
  final actual = sha256.convert(bytes).toString();
  return actual.toLowerCase() == expectedHex.toLowerCase();
}

/// Abstraktion über http: ermöglicht test ohne netzwerk.
typedef JsonFetcher = Future<Map<String, dynamic>> Function(String url,
    {Map<String, String>? headers});

Future<ReleaseInfo?> fetchReleaseInfo({
  required String apiBase,
  required String token,
  required String projectId,
  required JsonFetcher fetchJson,
}) async {
  final url = '$apiBase/api/updates/apk/info?projectId='
      '${Uri.encodeQueryComponent(projectId)}';
  try {
    final j = await fetchJson(url, headers: {
      'Authorization': 'Bearer $token',
      'Accept': 'application/json',
    });
    if (j['error'] != null) return null;
    return ReleaseInfo.fromJson(j);
  } catch (_) {
    return null;
  }
}

/// Encodiert {url, headers} statt direktem byte-fetch — die UI-schicht
/// (mit http-paket + flutter) führt aus und reicht bytes zurück.
Map<String, dynamic> buildDownloadRequest({
  required String apiBase,
  required String token,
  required String projectId,
}) {
  return {
    'url': '$apiBase/api/updates/apk/download?projectId='
        '${Uri.encodeQueryComponent(projectId)}',
    'headers': {
      'Authorization': 'Bearer $token',
      'Accept': 'application/vnd.android.package-archive',
    },
  };
}

/// Hilfsfunktion für UI-tests: parst json aus utf8-bytes.
Map<String, dynamic> decodeJsonBytes(List<int> bytes) =>
    jsonDecode(utf8.decode(bytes)) as Map<String, dynamic>;
