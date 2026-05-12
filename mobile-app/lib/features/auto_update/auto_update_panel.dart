// auto_update_panel · UI-wiring für mobile-auto-update über desktop-server.
// Nutzt features/auto_update/auto_update_checker.dart (pure-dart) für
// version-vergleich + sha256-verifikation. Dieses widget macht nur IO:
// http-fetch, datei in temp speichern, install-intent via open_filex.
//
// Respektiert MediaQuery.disableAnimations (kein indeterminate-spin, wenn
// os-reduce gesetzt). Auto-update geschieht ausschließlich über den
// gepairten desktop-server — kein direkter store/CDN-pfad.

import 'dart:io' show File;
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:open_filex/open_filex.dart';
import '../../theme.dart';
import '../../sync_client.dart';
import 'auto_update_checker.dart';

/// Lokale app-version. MUSS synchron zu pubspec.yaml `version:` gehalten
/// werden — wird beim release-build geprüft.
const String kLocalAppVersion = '1.0.0+1';

enum _Step { idle, checking, available, upToDate, downloading, verifying, ready, error }

class AutoUpdatePanel extends StatefulWidget {
  const AutoUpdatePanel({super.key});
  @override
  State<AutoUpdatePanel> createState() => _AutoUpdatePanelState();
}

class _AutoUpdatePanelState extends State<AutoUpdatePanel> {
  _Step _step = _Step.idle;
  ReleaseInfo? _info;
  String? _err;
  double _progress = 0;

  Future<Map<String, dynamic>> _fetchJson(String url, {Map<String, String>? headers}) async {
    final r = await http.get(Uri.parse(url), headers: headers);
    if (r.statusCode != 200) throw Exception('http ${r.statusCode}');
    return decodeJsonBytes(r.bodyBytes);
  }

  Future<void> _check() async {
    final c = SyncClientScope.of(context, listen: false);
    final p = c.activeProject;
    if (p == null || c.serverUrl == null || c.authToken == null) return;
    setState(() { _step = _Step.checking; _err = null; });
    final info = await fetchReleaseInfo(
      apiBase: c.serverUrl!,
      token: c.authToken!,
      projectId: p['id'].toString(),
      fetchJson: _fetchJson,
    );
    if (!mounted) return;
    if (info == null) {
      setState(() { _step = _Step.error; _err = 'kein release auf server'; });
      return;
    }
    setState(() {
      _info = info;
      _step = isUpdateAvailable(kLocalAppVersion, info) ? _Step.available : _Step.upToDate;
    });
  }

  Future<void> _downloadAndInstall() async {
    final c = SyncClientScope.of(context, listen: false);
    final p = c.activeProject;
    final info = _info;
    if (info == null || p == null || c.serverUrl == null || c.authToken == null) return;
    setState(() { _step = _Step.downloading; _progress = 0; _err = null; });
    final req = buildDownloadRequest(
      apiBase: c.serverUrl!,
      token: c.authToken!,
      projectId: p['id'].toString(),
    );
    try {
      final bytes = await _streamDownload(
        req['url'] as String,
        Map<String, String>.from(req['headers'] as Map),
        info.size,
      );
      if (!mounted) return;
      setState(() => _step = _Step.verifying);
      if (!verifyApkSha256(bytes, info.sha256)) {
        setState(() { _step = _Step.error; _err = 'sha256 mismatch — apk verworfen'; });
        return;
      }
      final dir = await getTemporaryDirectory();
      final f = File('${dir.path}/pg-${info.version}.apk');
      await f.writeAsBytes(bytes, flush: true);
      if (!mounted) return;
      setState(() => _step = _Step.ready);
      await OpenFilex.open(f.path);
    } catch (e) {
      if (!mounted) return;
      setState(() { _step = _Step.error; _err = e.toString(); });
    }
  }

  Future<Uint8List> _streamDownload(
      String url, Map<String, String> headers, int expectedSize) async {
    final req = http.Request('GET', Uri.parse(url));
    req.headers.addAll(headers);
    final resp = await http.Client().send(req);
    if (resp.statusCode != 200) throw Exception('download http ${resp.statusCode}');
    final total = expectedSize > 0 ? expectedSize : (resp.contentLength ?? 0);
    final buf = BytesBuilder(copy: false);
    int got = 0;
    await for (final chunk in resp.stream) {
      buf.add(chunk);
      got += chunk.length;
      if (total > 0 && mounted) setState(() => _progress = got / total);
    }
    return buf.toBytes();
  }

  @override
  Widget build(BuildContext context) {
    final reduced = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    return Scaffold(
      backgroundColor: pgPaper,
      appBar: AppBar(
        backgroundColor: pgPaper,
        elevation: 0,
        iconTheme: const IconThemeData(color: pgInk),
        title: const Text('auto-update', style: TextStyle(color: pgInk, fontWeight: FontWeight.w700)),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('lokal: $kLocalAppVersion', style: const TextStyle(color: pgInkSoft, fontSize: 13)),
              if (_info != null) ...[
                const SizedBox(height: 4),
                Text('server: ${_info!.version}', style: const TextStyle(color: pgInk, fontSize: 13, fontWeight: FontWeight.w600)),
                Text('${(_info!.size / 1024 / 1024).toStringAsFixed(2)} MB', style: const TextStyle(color: pgInkSoft, fontSize: 11)),
              ],
              if (_step == _Step.upToDate) const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('aktuell — kein update nötig.', style: TextStyle(color: pgInk, fontSize: 12)),
              ),
              const SizedBox(height: 24),
              if (_step == _Step.downloading)
                LinearProgressIndicator(
                  value: reduced ? null : _progress.clamp(0, 1),
                  color: pgInk,
                  backgroundColor: pgInk.withOpacity(0.15),
                ),
              if (_step == _Step.verifying) const Text('verifiziere sha256…', style: TextStyle(color: pgInkSoft, fontSize: 12)),
              if (_err != null) Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(_err!, style: const TextStyle(color: pgDanger, fontSize: 12)),
              ),
              const Spacer(),
              _ActionButton(step: _step, info: _info, onCheck: _check, onInstall: _downloadAndInstall),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final _Step step;
  final ReleaseInfo? info;
  final VoidCallback onCheck;
  final VoidCallback onInstall;
  const _ActionButton({required this.step, required this.info, required this.onCheck, required this.onInstall});
  @override
  Widget build(BuildContext context) {
    String label;
    VoidCallback? action;
    switch (step) {
      case _Step.idle:        label = 'auf updates prüfen'; action = onCheck; break;
      case _Step.checking:    label = 'prüfe…'; action = null; break;
      case _Step.available:   label = 'herunterladen & installieren'; action = onInstall; break;
      case _Step.upToDate:    label = 'erneut prüfen'; action = onCheck; break;
      case _Step.downloading: label = 'lade…'; action = null; break;
      case _Step.verifying:   label = 'verifiziere…'; action = null; break;
      case _Step.ready:       label = 'installation gestartet'; action = onCheck; break;
      case _Step.error:       label = 'erneut versuchen'; action = onCheck; break;
    }
    return ElevatedButton(
      style: ElevatedButton.styleFrom(
        backgroundColor: pgInk,
        foregroundColor: pgPaper,
        padding: const EdgeInsets.symmetric(vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
      ),
      onPressed: action,
      child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
    );
  }
}
