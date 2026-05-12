// Members-Screen · multi-user schicht 2 UI.
// Listet die mitglieder des aktiven projekts. Owner darf einladen & entfernen.
// Nutzt die endpoints aus server.js:
//   GET    /api/projects/:id/members
//   POST   /api/projects/:id/members        { email, role }
//   DELETE /api/projects/:id/members/:userId
//
// Stil: sketchy B&W, angelehnt an _IdeaTile / _RuleTile.

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../theme.dart';
import '../../sync_client.dart';

class MembersScreen extends StatefulWidget {
  final String projectId;
  const MembersScreen({super.key, required this.projectId});
  @override
  State<MembersScreen> createState() => _MembersScreenState();
}

class _MembersScreenState extends State<MembersScreen> {
  List<Map<String, dynamic>>? _members;
  String? _myUserId;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
  }

  Future<void> _refresh() async {
    final client = SyncClientScope.of(context, listen: false);
    final token = client.authToken;
    final server = client.serverUrl;
    if (token == null || server == null) {
      setState(() { _loading = false; _error = 'nicht eingeloggt'; });
      return;
    }
    setState(() { _loading = true; _error = null; });
    try {
      // /api/auth/me — liefert userId für „bist du selbst owner?" check
      try {
        final me = await http.get(
          Uri.parse('$server/api/auth/me'),
          headers: {'authorization': 'Bearer $token'},
        ).timeout(const Duration(seconds: 5));
        if (me.statusCode == 200) {
          final data = jsonDecode(me.body);
          _myUserId = (data['user'] as Map?)?['id']?.toString();
        } else {
          _myUserId = null; // vermutlich pair-token
        }
      } catch (_) { _myUserId = null; }

      final r = await http.get(
        Uri.parse('$server/api/projects/${widget.projectId}/members'),
        headers: {'authorization': 'Bearer $token'},
      ).timeout(const Duration(seconds: 5));
      if (r.statusCode != 200) {
        final msg = _extractError(r.body, 'fehler ${r.statusCode}');
        setState(() { _loading = false; _error = msg; _members = null; });
        return;
      }
      final data = jsonDecode(r.body);
      final list = (data['members'] as List? ?? const []).cast<Map>();
      setState(() {
        _members = list.map((e) => e.cast<String, dynamic>()).toList();
        _loading = false;
      });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  String _extractError(String body, String fallback) {
    try { return (jsonDecode(body)['error'] ?? fallback).toString(); }
    catch (_) { return fallback; }
  }

  Future<void> _invite() async {
    final ctrl = TextEditingController();
    String role = 'member';
    final ok = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: pgPaper,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (sheetCtx) {
        return StatefulBuilder(
          builder: (_, setSheet) => Padding(
            padding: EdgeInsets.fromLTRB(20, 14, 20, MediaQuery.of(sheetCtx).viewInsets.bottom + 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const PgEyebrow('mitglied einladen'),
                const SizedBox(height: 10),
                TextField(
                  controller: ctrl,
                  autofocus: true,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(hintText: 'email des accounts'),
                ),
                const SizedBox(height: 12),
                const PgEyebrow('rolle'),
                const SizedBox(height: 6),
                Wrap(spacing: 8, children: [
                  for (final r in const ['owner', 'member', 'viewer'])
                    InkWell(
                      onTap: () => setSheet(() => role = r),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: role == r ? pgInk : pgPaper,
                          border: Border.all(color: pgInk, width: 1.5),
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Text(r, style: TextStyle(
                          color: role == r ? pgPaper : pgInk,
                          fontFamily: 'monospace', fontSize: 11,
                        )),
                      ),
                    ),
                ]),
                const SizedBox(height: 18),
                Row(children: [
                  Expanded(child: OutlinedButton(
                    onPressed: () => Navigator.pop(sheetCtx, false),
                    child: const Text('abbrechen'),
                  )),
                  const SizedBox(width: 10),
                  Expanded(child: ElevatedButton(
                    onPressed: () => Navigator.pop(sheetCtx, true),
                    child: const Text('einladen'),
                  )),
                ]),
              ],
            ),
          ),
        );
      },
    );
    if (ok != true) return;
    final email = ctrl.text.trim();
    if (email.isEmpty) return;
    final client = SyncClientScope.of(context, listen: false);
    final token = client.authToken;
    final server = client.serverUrl;
    try {
      final r = await http.post(
        Uri.parse('$server/api/projects/${widget.projectId}/members'),
        headers: {'authorization': 'Bearer $token', 'content-type': 'application/json'},
        body: jsonEncode({'email': email, 'role': role}),
      ).timeout(const Duration(seconds: 5));
      if (r.statusCode != 201) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(_extractError(r.body, 'fehler ${r.statusCode}')),
        ));
        return;
      }
      await _refresh();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _removeMember(Map<String, dynamic> m) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: pgPaper,
        title: const Text('entfernen?'),
        content: Text('${m['email'] ?? m['userId']} aus dem projekt entfernen?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('abbrechen')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: pgDanger),
            child: const Text('entfernen'),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    final client = SyncClientScope.of(context, listen: false);
    final token = client.authToken;
    final server = client.serverUrl;
    try {
      final r = await http.delete(
        Uri.parse('$server/api/projects/${widget.projectId}/members/${m['userId']}'),
        headers: {'authorization': 'Bearer $token'},
      ).timeout(const Duration(seconds: 5));
      if (r.statusCode != 200) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(_extractError(r.body, 'fehler ${r.statusCode}')),
        ));
        return;
      }
      await _refresh();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  bool get _amOwner {
    if (_myUserId == null || _members == null) return false;
    final me = _members!.firstWhere(
      (m) => m['userId'] == _myUserId,
      orElse: () => const <String, dynamic>{},
    );
    return me['role'] == 'owner';
  }

  Future<void> _downloadArchive() async {
    final client = SyncClientScope.of(context, listen: false);
    final url = client.serverUrl;
    if (url == null) return;
    try {
      final r = await http.post(
        Uri.parse('$url/api/projects/${widget.projectId}/archive'),
        headers: client.authHeader,
      ).timeout(const Duration(seconds: 60));
      final data = jsonDecode(r.body);
      if (r.statusCode != 200) throw Exception(data['error'] ?? 'fehler');
      final full = '$url${data['url']}';
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('archiv bereit: ${(data['size'] / 1024 / 1024).toStringAsFixed(1)} MB · open browser'),
        action: SnackBarAction(label: 'kopieren', onPressed: () {
          // url-clipboard ist im default-build nicht da; user soll teilen können
        }),
      ));
      // Open in external browser
      // Note: package_url_launcher would be cleaner; aktuell zeigen wir die URL im snackbar
      debugPrint('archive url: $full');
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: pgPaper,
      appBar: AppBar(
        backgroundColor: pgPaper,
        elevation: 0,
        iconTheme: const IconThemeData(color: pgInk),
        title: const Text('mitglieder', style: TextStyle(color: pgInk, fontSize: 16)),
        actions: [
          IconButton(
            tooltip: 'projekt-archiv (.zip) erstellen',
            icon: const Icon(Icons.archive_outlined, color: pgInk),
            onPressed: _loading ? null : _downloadArchive,
          ),
          IconButton(
            tooltip: 'aktualisieren',
            icon: const Icon(Icons.refresh, color: pgInk),
            onPressed: _loading ? null : _refresh,
          ),
        ],
      ),
      body: _buildBody(),
      floatingActionButton: _amOwner ? FloatingActionButton(
        onPressed: _invite,
        backgroundColor: pgInk,
        foregroundColor: pgPaper,
        elevation: 0,
        shape: const CircleBorder(side: BorderSide(color: pgInk, width: 2)),
        child: const Icon(Icons.person_add_alt_1),
      ) : null,
    );
  }

  Widget _buildBody() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: pgInk));
    if (_error != null) {
      return Center(child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.error_outline, size: 48, color: pgInkFaint),
          const SizedBox(height: 12),
          Text(_error!, textAlign: TextAlign.center,
            style: const TextStyle(color: pgDanger, fontSize: 13)),
          const SizedBox(height: 16),
          OutlinedButton(onPressed: _refresh, child: const Text('erneut versuchen')),
        ]),
      ));
    }
    final ms = _members ?? const [];
    if (ms.isEmpty) {
      return const Center(child: Padding(
        padding: EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.group_outlined, size: 48, color: pgInkFaint),
          SizedBox(height: 12),
          Text(
            'keine mitglieder.\nNutze pair-token oder lade einen account-user ein.',
            textAlign: TextAlign.center,
            style: TextStyle(color: pgInkSoft, fontSize: 13, height: 1.5),
          ),
        ]),
      ));
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
      itemCount: ms.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (_, i) => _MemberTile(
        member: ms[i],
        isMe: ms[i]['userId'] == _myUserId,
        canRemove: _amOwner && ms[i]['userId'] != _myUserId,
        onRemove: () => _removeMember(ms[i]),
      ),
    );
  }
}

class _MemberTile extends StatelessWidget {
  final Map<String, dynamic> member;
  final bool isMe;
  final bool canRemove;
  final VoidCallback onRemove;
  const _MemberTile({
    required this.member,
    required this.isMe,
    required this.canRemove,
    required this.onRemove,
  });
  @override
  Widget build(BuildContext context) {
    final role = (member['role'] ?? '').toString();
    final email = (member['email'] ?? member['userId'] ?? '?').toString();
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
      decoration: BoxDecoration(
        color: pgPaper,
        border: Border.all(color: pgInk, width: 2),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Expanded(child: Text(email,
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 13.5, fontWeight: FontWeight.w600))),
                if (isMe) const Padding(
                  padding: EdgeInsets.only(left: 6),
                  child: PgChip('du'),
                ),
              ]),
              const SizedBox(height: 4),
              PgChip(role, solid: role == 'owner'),
            ],
          ),
        ),
        if (canRemove)
          IconButton(
            tooltip: 'entfernen',
            icon: const Icon(Icons.close, color: pgDanger, size: 18),
            onPressed: onRemove,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
          ),
      ]),
    );
  }
}
