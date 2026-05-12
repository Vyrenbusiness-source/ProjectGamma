// Cloud-Screen · vereint cloud-code, devices, sync-verlauf, vorschläge, bugs.
// Aufbau: [Status-Header] [Prompt-Box] [Activity-Feed] [Sections].
// Feature-Widgets unter ../features/cloud/.

import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import '../sync_client.dart';
import '../theme.dart';
import '../features/cloud/cloud_activity_feed.dart';
import '../features/cloud/cloud_limit_detector.dart';
import '../features/cloud/cloud_prompt_box.dart';
import '../features/cloud/cloud_sections_view.dart';
import '../features/cloud/cloud_status_header.dart';

/// Haupt-screen für claude-cloud-code interaktion + projekt-übersicht.
class CloudScreen extends StatefulWidget {
  const CloudScreen({super.key});
  @override
  State<CloudScreen> createState() => _CloudScreenState();
}

class _CloudScreenState extends State<CloudScreen> {
  final _prompt = TextEditingController();
  bool _busy = false;
  String? _err;
  bool _devicesOpen = false;
  bool _suggOpen = false;
  bool _bugsOpen = false;
  bool _historyOpen = false;
  List<Map<String, dynamic>> _sessions = [];
  // Bild-anhänge für cloud-code (vor prompt-send aufgesammelt)
  final List<Map<String, dynamic>> _attachments = [];
  bool _uploadingAttach = false;

  @override
  void initState() {
    super.initState();
    _loadSessions();
  }

  Future<void> _loadSessions() async {
    final c = SyncClientScope.of(context, listen: false);
    final s = await c.listSessions();
    if (mounted) setState(() => _sessions = s);
  }

  Future<void> _attachImage() async {
    if (_uploadingAttach) return;
    final c = SyncClientScope.of(context, listen: false);
    final p = c.activeProject;
    if (p == null) return;
    final picker = ImagePicker();
    final src = await showModalBottomSheet<ImageSource>(
      context: context, backgroundColor: pgPaper,
      builder: (sheet) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(leading: const Icon(Icons.camera_alt, color: pgInk),
          title: const Text('foto'),
          onTap: () => Navigator.pop(sheet, ImageSource.camera)),
        ListTile(leading: const Icon(Icons.photo_library, color: pgInk),
          title: const Text('aus galerie'),
          onTap: () => Navigator.pop(sheet, ImageSource.gallery)),
      ])),
    );
    if (src == null) return;
    try {
      final img = await picker.pickImage(source: src, imageQuality: 78, maxWidth: 1600);
      if (img == null) return;
      setState(() => _uploadingAttach = true);
      final bytes = await img.readAsBytes();
      final r = await http.post(
        Uri.parse('${c.serverUrl}/api/projects/${p['id']}/attachments'),
        headers: {...c.authHeader, 'content-type': 'application/json'},
        body: jsonEncode({
          'name': img.name, 'contentType': 'image/jpeg',
          'base64': base64Encode(bytes),
        }),
      ).timeout(const Duration(seconds: 30));
      if (r.statusCode != 201) throw Exception('upload ${r.statusCode}');
      final data = jsonDecode(r.body) as Map<String, dynamic>;
      if (mounted) setState(() => _attachments.add({
        'name': data['name'], 'url': data['url'], 'kind': data['kind'], 'size': data['size'],
      }));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _uploadingAttach = false);
    }
  }

  Future<void> _run() async {
    setState(() { _busy = true; _err = null; });
    final c = SyncClientScope.of(context, listen: false);
    final p = c.activeProject;
    if (p == null) { setState(() => _busy = false); return; }
    try {
      // Wenn anhänge vorhanden, prompt erweitern um pfade — claude liest sie
      // via filesystem-MCP (anhänge liegen in <project.path>/.pg-uploads/).
      var userPrompt = _prompt.text.trim();
      if (_attachments.isNotEmpty) {
        final paths = _attachments.map((a) {
          // url ist wie /api/projects/<id>/attachments/<file>
          final u = a['url']?.toString() ?? '';
          final fname = u.split('/').last;
          return '.pg-uploads/$fname (${a['name']})';
        }).join('\n  - ');
        userPrompt = 'ANHÄNGE (im projekt-root lesen via Read-tool):\n  - $paths\n\n${userPrompt.isEmpty ? "schau die anhänge an und antworte darauf." : userPrompt}';
      }
      await c.ccRun(projectId: p['id'],
        prompt: userPrompt.isEmpty ? null : userPrompt);
      _prompt.clear();
      setState(() => _attachments.clear());
    } on TimeoutException catch (_) {
      // Server hat lange für ACK gebraucht — der Run läuft idR. trotzdem.
      _prompt.clear();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          duration: Duration(milliseconds: 1800),
          content: Text('anfrage gesendet — status kommt über sync zurück'),
        ));
      }
    } catch (e) {
      setState(() => _err = e.toString().replaceFirst('Exception: ', ''));
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _stop() async {
    final c = SyncClientScope.of(context, listen: false);
    final p = c.activeProject;
    if (p != null) { try { await c.ccStop(p['id']); } catch (_) {} }
  }

  Future<void> _suggest() async {
    final c = SyncClientScope.of(context, listen: false);
    final p = c.activeProject;
    if (p != null) { try { await c.ccSuggest(p['id']); } catch (_) {} }
    setState(() => _suggOpen = true);
  }

  Future<void> _bughunt() async {
    final c = SyncClientScope.of(context, listen: false);
    final p = c.activeProject;
    if (p != null) { try { await c.ccBughunt(p['id']); } catch (_) {} }
    setState(() => _bugsOpen = true);
  }

  Future<void> _onRemoveDevice(Map<String, dynamic> s) async {
    final t = s['token']?.toString();
    if (t == null) return;
    final c = SyncClientScope.of(context, listen: false);
    await c.removeSession(t);
    _loadSessions();
  }

  Future<void> _onToggleCc(Map<String, dynamic> p, bool ccRunning) async {
    final c = SyncClientScope.of(context, listen: false);
    final next = !ccRunning;
    await c.mutate('TOGGLE_CC', {'running': next});
    // Beim "fortsetzen": sofort den nächsten Task triggern statt
    // bis zum nächsten auto-pump-Tick (25s) zu warten.
    if (next && p['id'] is String) {
      try { await c.ccRun(projectId: p['id'] as String); } catch (_) {}
    }
  }

  @override
  Widget build(BuildContext context) {
    final client = SyncClientScope.of(context);
    final p = client.activeProject;
    if (p == null) return const Center(child: Text('kein projekt'));
    final pid = p['id'] as String;
    final activity = ((p['activity'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final ccRunning = client.state?['ccRunning'] == true;
    final inProgress = ((p['tasks'] as List?) ?? const [])
      .cast<Map<String, dynamic>>()
      .where((t) => t['done'] != true && t['group'] == 'in_progress')
      .toList();
    final budget = client.state?['ccBudget'] as Map<String, dynamic>?;
    final suggestions = ((p['suggestions'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final bugs = ((p['bugs'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final syncEntries = client.syncLog
      .where((e) => e['projectId'] == pid || e['projectId'] == null).toList();
    final limit = detectClaudeLimit(activity);

    return RefreshIndicator(
      color: pgInk,
      onRefresh: _loadSessions,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          CloudStatusHeader(
            ccRunning: ccRunning, budget: budget, inProgress: inProgress,
            limitHit: limit.hit, limitResetText: limit.resetText,
            onToggle: () => _onToggleCc(p, ccRunning),
          ),
          const SizedBox(height: 14),
          if (p['pendingQuestion'] != null && (p['pendingQuestion'] as String).isNotEmpty)
            _CcQuestionCard(
              question: (p['pendingQuestion'] as String),
              autoAnswer: p['ccAutoAnswer'] == true,
              autoAnswerDelaySec: (p['ccAutoAnswerDelaySec'] is num ? (p['ccAutoAnswerDelaySec'] as num).toInt() : 30),
              pendingAt: (p['pendingQuestionAt'] is num ? (p['pendingQuestionAt'] as num).toInt() : null),
              onToggleAutoAnswer: (on) {
                client.mutate('TOGGLE_CC_AUTO_ANSWER', {'projectId': p['id'], 'on': on});
              },
              onAnswer: (answer) async {
                final q = (p['pendingQuestion'] as String);
                final replyPrompt = answer.trim().isEmpty
                  ? 'Frage von dir war: $q\nKeine antwort vom user. Mach autonom weiter mit deiner besten annahme.'
                  : 'Frage von dir: $q\nMeine antwort: $answer\n\nMach weiter.';
                client.mutate('CLEAR_PENDING_QUESTION', {'projectId': p['id']});
                try { await client.ccRun(projectId: p['id'], prompt: replyPrompt); }
                catch (_) {}
              },
            ),
          if (p['pendingQuestion'] != null && (p['pendingQuestion'] as String).isNotEmpty)
            const SizedBox(height: 12),
          CloudPromptBox(
            controller: _prompt, busy: _busy, error: _err,
            onRun: _run, onStop: _stop,
            onAttach: _attachImage,
            uploadingAttach: _uploadingAttach,
            attachments: _attachments,
            onRemoveAttach: (i) => setState(() => _attachments.removeAt(i)),
          ),
          const SizedBox(height: 14),
          CloudActivityFeed(activity: activity),
          const SizedBox(height: 18),
          CloudSectionsView(
            projectId: pid,
            sessions: _sessions,
            suggestions: suggestions,
            bugs: bugs,
            syncEntries: syncEntries,
            pendingSugg: suggestions.where((s) => s['status'] == 'pending').length,
            pendingBugs: bugs.where((b) => b['status'] == 'pending').length,
            devicesOpen: _devicesOpen,
            suggOpen: _suggOpen,
            bugsOpen: _bugsOpen,
            historyOpen: _historyOpen,
            onToggleDevices: () => setState(() => _devicesOpen = !_devicesOpen),
            onToggleSugg: () => setState(() => _suggOpen = !_suggOpen),
            onToggleBugs: () => setState(() => _bugsOpen = !_bugsOpen),
            onToggleHistory: () => setState(() => _historyOpen = !_historyOpen),
            onRefreshDevices: _loadSessions,
            onGenerateSugg: _suggest,
            onBughunt: _bughunt,
            onRemoveDevice: _onRemoveDevice,
          ),
        ],
      ),
    );
  }
}

class _CcQuestionCard extends StatefulWidget {
  final String question;
  final void Function(String answer) onAnswer;
  final bool autoAnswer;
  final int autoAnswerDelaySec;
  final int? pendingAt;
  final void Function(bool on) onToggleAutoAnswer;
  const _CcQuestionCard({
    required this.question,
    required this.onAnswer,
    required this.autoAnswer,
    required this.autoAnswerDelaySec,
    required this.pendingAt,
    required this.onToggleAutoAnswer,
  });
  @override
  State<_CcQuestionCard> createState() => _CcQuestionCardState();
}

class _CcQuestionCardState extends State<_CcQuestionCard> {
  final _ctrl = TextEditingController();
  Timer? _tick;
  @override
  void initState() {
    super.initState();
    if (widget.autoAnswer) {
      _tick = Timer.periodic(const Duration(seconds: 1), (_) { if (mounted) setState(() {}); });
    }
  }
  @override
  void didUpdateWidget(_CcQuestionCard old) {
    super.didUpdateWidget(old);
    if (widget.autoAnswer && _tick == null) {
      _tick = Timer.periodic(const Duration(seconds: 1), (_) { if (mounted) setState(() {}); });
    } else if (!widget.autoAnswer && _tick != null) {
      _tick?.cancel(); _tick = null;
    }
  }
  @override
  void dispose() { _tick?.cancel(); _ctrl.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    int? remainingSec;
    if (widget.autoAnswer && widget.pendingAt != null) {
      final elapsed = DateTime.now().millisecondsSinceEpoch - widget.pendingAt!;
      remainingSec = (widget.autoAnswerDelaySec * 1000 - elapsed) ~/ 1000;
      if (remainingSec < 0) remainingSec = 0;
    }
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7E0),
        border: Border.all(color: pgInk, width: 2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Expanded(child: PgEyebrow('claude hat eine rückfrage')),
          // Auto-answer toggle inline
          GestureDetector(
            onTap: () => widget.onToggleAutoAnswer(!widget.autoAnswer),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              SizedBox(
                width: 16, height: 16,
                child: Checkbox(
                  value: widget.autoAnswer,
                  onChanged: (v) => widget.onToggleAutoAnswer(v ?? false),
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
              ),
              const SizedBox(width: 4),
              const Text('auto-answer', style: TextStyle(fontSize: 11, color: pgInkSoft)),
            ]),
          ),
        ]),
        const SizedBox(height: 6),
        Text('❓ ${widget.question}',
          style: const TextStyle(fontSize: 14, height: 1.4, fontWeight: FontWeight.w500)),
        if (remainingSec != null) ...[
          const SizedBox(height: 6),
          Text('⏱ auto-antwort in ${remainingSec}s — jetzt antworten zum stoppen',
            style: TextStyle(
              fontSize: 12,
              color: remainingSec <= 5 ? pgDanger : const Color(0xFFCC8800),
              fontWeight: FontWeight.w600,
            )),
        ],
        const SizedBox(height: 10),
        TextField(controller: _ctrl,
          decoration: const InputDecoration(
            hintText: 'antwort (leer = autonom weiter)',
            isDense: true,
            contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          )),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: OutlinedButton(
            onPressed: () => widget.onAnswer(''),
            child: const Text('autonom weiter'),
          )),
          const SizedBox(width: 8),
          Expanded(flex: 2, child: ElevatedButton(
            onPressed: () => widget.onAnswer(_ctrl.text),
            child: const Text('antwort senden →'),
          )),
        ]),
      ]),
    );
  }
}
