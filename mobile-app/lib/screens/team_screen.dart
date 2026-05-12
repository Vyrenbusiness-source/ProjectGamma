// TeamScreen · projekt-chat + notizen + termine. Spiegelt desktop team_panel.
// Server filtert per session → user sehen nur projekte/messages die sie
// dürfen. Author wird server-seitig aus session-ctx gesetzt, kein spoofing.

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import '../theme.dart';
import '../sync_client.dart';

class TeamScreen extends StatefulWidget {
  const TeamScreen({super.key});
  @override
  State<TeamScreen> createState() => _TeamScreenState();
}

class _TeamScreenState extends State<TeamScreen> {
  int _tab = 0; // 0=chat 1=notes 2=appointments

  @override
  Widget build(BuildContext context) {
    final client = SyncClientScope.of(context);
    final p = client.activeProject;
    if (p == null) return const Center(child: Text('kein projekt'));
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
          child: Row(children: [
            _TabChip(label: 'chat', selected: _tab == 0, onTap: () => setState(() => _tab = 0)),
            const SizedBox(width: 8),
            _TabChip(label: 'notizen', selected: _tab == 1, onTap: () => setState(() => _tab = 1)),
            const SizedBox(width: 8),
            _TabChip(label: 'termine', selected: _tab == 2, onTap: () => setState(() => _tab = 2)),
          ]),
        ),
        Expanded(
          child: switch (_tab) {
            1 => _NotesView(project: p),
            2 => _AppointmentsView(project: p),
            _ => _ChatView(project: p),
          },
        ),
      ],
    );
  }
}

class _TabChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _TabChip({required this.label, required this.selected, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? pgInk : pgPaper,
          border: Border.all(color: pgInk, width: 1.5),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Text(label, style: TextStyle(
          color: selected ? pgPaper : pgInk,
          fontFamily: 'monospace', fontSize: 12, fontWeight: FontWeight.w600,
        )),
      ),
    );
  }
}

String _relTime(int? ts) {
  if (ts == null) return '—';
  final s = (DateTime.now().millisecondsSinceEpoch - ts) ~/ 1000;
  if (s < 5) return 'jetzt';
  if (s < 60) return '${s}s';
  if (s < 3600) return '${s ~/ 60}m';
  if (s < 86400) return '${s ~/ 3600}h';
  return '${s ~/ 86400}d';
}

String _authorLabel(Map<String, dynamic> m) {
  final email = m['authorEmail'];
  if (email is String && email.isNotEmpty) return email;
  final author = (m['author'] ?? '').toString();
  if (author.startsWith('device:')) return author.substring(7);
  return author.isEmpty ? '?' : author;
}

// ─── CHAT ────────────────────────────────────────────────────
class _ChatView extends StatefulWidget {
  final Map<String, dynamic> project;
  const _ChatView({required this.project});
  @override
  State<_ChatView> createState() => _ChatViewState();
}

class _ChatViewState extends State<_ChatView> {
  final _ctrl = TextEditingController();
  final _scroll = ScrollController();
  int _lastLen = -1;

  @override
  void initState() {
    super.initState();
    // Bugfix: initial-scroll auf bottom NACH first build, sonst sieht user
    // alte messages oben statt aktuelle unten.
    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom(animated: false));
  }

  void _scrollToBottom({bool animated = true}) {
    if (!_scroll.hasClients) return;
    final target = _scroll.position.maxScrollExtent;
    if (animated) {
      _scroll.animateTo(target, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
    } else {
      _scroll.jumpTo(target);
    }
  }

  @override
  void didUpdateWidget(covariant _ChatView old) {
    super.didUpdateWidget(old);
    final n = ((widget.project['messages'] as List?) ?? const []).length;
    if (n != _lastLen) {
      _lastLen = n;
      WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
    }
  }

  @override
  void dispose() {
    _ctrl.dispose();
    _scroll.dispose();
    super.dispose();
  }

  bool _uploading = false;

  void _send() {
    final t = _ctrl.text.trim();
    if (t.isEmpty) return;
    final c = SyncClientScope.of(context, listen: false);
    c.mutate('ADD_MESSAGE', { 'projectId': widget.project['id'], 'message': { 'text': t }});
    _ctrl.clear();
  }

  Future<void> _attachImage() async {
    if (_uploading) return;
    final c = SyncClientScope.of(context, listen: false);
    final picker = ImagePicker();
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      backgroundColor: pgPaper,
      builder: (sheet) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(
            leading: const Icon(Icons.camera_alt, color: pgInk),
            title: const Text('foto aufnehmen'),
            onTap: () => Navigator.pop(sheet, ImageSource.camera),
          ),
          ListTile(
            leading: const Icon(Icons.photo_library, color: pgInk),
            title: const Text('aus galerie'),
            onTap: () => Navigator.pop(sheet, ImageSource.gallery),
          ),
        ]),
      ),
    );
    if (source == null) return;
    try {
      final img = await picker.pickImage(source: source, imageQuality: 78, maxWidth: 1600);
      if (img == null) return;
      setState(() => _uploading = true);
      final bytes = await img.readAsBytes();
      final url = '${c.serverUrl}/api/projects/${widget.project['id']}/attachments';
      final r = await http.post(
        Uri.parse(url),
        headers: { ...c.authHeader, 'content-type': 'application/json' },
        body: jsonEncode({
          'name': img.name,
          'contentType': 'image/jpeg',
          'base64': base64Encode(bytes),
        }),
      ).timeout(const Duration(seconds: 30));
      if (r.statusCode != 201) {
        throw Exception('upload fehlgeschlagen: ${r.statusCode}');
      }
      final data = jsonDecode(r.body) as Map<String, dynamic>;
      final caption = _ctrl.text.trim();
      c.mutate('ADD_MESSAGE', { 'projectId': widget.project['id'], 'message': {
        'text': caption.isEmpty ? '📷 ${img.name}' : caption,
        'attachment': { 'url': data['url'], 'name': data['name'], 'kind': data['kind'], 'size': data['size'] },
      }});
      _ctrl.clear();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = ((widget.project['messages'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Column(
      children: [
        Expanded(
          child: messages.isEmpty
            ? const Center(child: Padding(
              padding: EdgeInsets.all(24),
              child: Text('noch keine nachrichten. schreib was — alle team-mitglieder sehen es live.',
                textAlign: TextAlign.center,
                style: TextStyle(color: pgInkSoft, fontSize: 13, height: 1.5)),
            ))
            : ListView.builder(
              controller: _scroll,
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              itemCount: messages.length,
              itemBuilder: (_, i) => _MessageBubble(
                message: messages[i],
                projectId: widget.project['id'] as String,
              ),
            ),
        ),
        Container(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
          decoration: const BoxDecoration(
            color: pgPaper,
            border: Border(top: BorderSide(color: pgInk, width: 2)),
          ),
          child: SafeArea(
            top: false,
            child: Row(children: [
              IconButton(
                icon: _uploading
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(color: pgInk, strokeWidth: 2))
                  : const Icon(Icons.attach_file, color: pgInk, size: 22),
                tooltip: 'bild anhängen',
                onPressed: _uploading ? null : _attachImage,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
              ),
              const SizedBox(width: 4),
              Expanded(
                child: TextField(
                  controller: _ctrl,
                  maxLines: 4, minLines: 1,
                  textInputAction: TextInputAction.newline,
                  decoration: const InputDecoration(
                    hintText: 'nachricht an team…', isDense: true,
                    contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  ),
                ),
              ),
              const SizedBox(width: 6),
              ElevatedButton(
                onPressed: _send,
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: const Icon(Icons.send, size: 16),
              ),
            ]),
          ),
        ),
      ],
    );
  }
}

class _MessageBubble extends StatelessWidget {
  final Map<String, dynamic> message;
  final String projectId;
  const _MessageBubble({required this.message, required this.projectId});
  @override
  Widget build(BuildContext context) {
    // own/other-styling: eigene messages rechts (dunkel/inverted), andere links
    final c = SyncClientScope.of(context);
    final myEmail = c.userEmail ?? c.deviceName ?? '';
    final isOwn = _authorLabel(message) == myEmail && myEmail.isNotEmpty;
    final bg = isOwn ? pgInk : pgPaper;
    final fg = isOwn ? pgPaper : pgInk;
    final align = isOwn ? CrossAxisAlignment.end : CrossAxisAlignment.start;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(crossAxisAlignment: align, children: [
        ConstrainedBox(
          constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
          child: Container(
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
      decoration: BoxDecoration(
        color: bg,
        border: Border.all(color: pgInk, width: 1.5),
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(8),
          topRight: const Radius.circular(8),
          bottomLeft: Radius.circular(isOwn ? 8 : 2),
          bottomRight: Radius.circular(isOwn ? 2 : 8),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(child: Text(_authorLabel(message),
              style: TextStyle(fontFamily: 'monospace', fontSize: 10.5,
                color: isOwn ? pgPaper.withValues(alpha: 0.75) : pgInkSoft,
                fontWeight: FontWeight.w600))),
            Text(_relTime(message['ts'] as int?),
              style: TextStyle(fontFamily: 'monospace', fontSize: 10,
                color: isOwn ? pgPaper.withValues(alpha: 0.55) : pgInkFaint)),
            GestureDetector(
              onLongPress: () async {
                final ok = await showDialog<bool>(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    title: const Text('löschen?'),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('abbrechen')),
                      TextButton(onPressed: () => Navigator.pop(ctx, true),
                        style: TextButton.styleFrom(foregroundColor: pgDanger),
                        child: const Text('löschen')),
                    ],
                  ),
                );
                if (ok == true) {
                  SyncClientScope.of(context, listen: false).mutate(
                    'REMOVE_MESSAGE', { 'projectId': projectId, 'messageId': message['id'] });
                }
              },
              child: Padding(
                padding: const EdgeInsets.only(left: 4),
                child: Icon(Icons.more_horiz, size: 14,
                  color: isOwn ? pgPaper.withValues(alpha: 0.55) : pgInkFaint),
              ),
            ),
          ]),
          const SizedBox(height: 4),
          Text((message['text'] ?? '').toString(),
            style: TextStyle(fontSize: 14, height: 1.4, color: fg)),
          if (message['attachment'] is Map) ...[
            const SizedBox(height: 6),
            _AttachmentRender(
              attachment: (message['attachment'] as Map).cast<String, dynamic>(),
            ),
          ],
        ],
      ),
          ),
        ),
      ]),
    );
  }
}

class _AttachmentRender extends StatelessWidget {
  final Map<String, dynamic> attachment;
  const _AttachmentRender({required this.attachment});
  @override
  Widget build(BuildContext context) {
    final c = SyncClientScope.of(context);
    final url = (attachment['url'] ?? '').toString();
    if (url.isEmpty) return const SizedBox.shrink();
    final fullUrl = url.startsWith('http') ? url : '${c.serverUrl}$url';
    final kind = (attachment['kind'] ?? 'file').toString();
    final name = (attachment['name'] ?? 'datei').toString();
    if (kind == 'image') {
      return ClipRRect(
        borderRadius: BorderRadius.circular(6),
        child: Image.network(
          fullUrl,
          headers: c.authHeader,
          fit: BoxFit.cover,
          width: double.infinity,
          height: 220,
          errorBuilder: (_, __, ___) => Container(
            height: 60, color: const Color(0xFFEEEEEE),
            alignment: Alignment.center,
            child: Text('🖼 $name (laden fehlgeschlagen)', style: const TextStyle(fontSize: 11)),
          ),
          loadingBuilder: (_, child, p) =>
            p == null ? child : Container(height: 60, alignment: Alignment.center,
              child: const CircularProgressIndicator(color: pgInk)),
        ),
      );
    }
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: pgPaper,
        border: Border.all(color: pgInkFaint, width: 1.5),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(children: [
        const Icon(Icons.attach_file, size: 14, color: pgInkSoft),
        const SizedBox(width: 6),
        Expanded(child: Text('📎 $name',
          style: const TextStyle(fontSize: 12, color: pgInkSoft),
          overflow: TextOverflow.ellipsis)),
      ]),
    );
  }
}

// ─── NOTES ───────────────────────────────────────────────────
class _NotesView extends StatelessWidget {
  final Map<String, dynamic> project;
  const _NotesView({required this.project});
  @override
  Widget build(BuildContext context) {
    final notes = ((project['notes'] as List?) ?? const []).cast<Map<String, dynamic>>();
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: notes.isEmpty
        ? const Center(child: Padding(
          padding: EdgeInsets.all(24),
          child: Text('keine notizen.', style: TextStyle(color: pgInkSoft, fontSize: 13)),
        ))
        : ListView.builder(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 90),
          itemCount: notes.length,
          itemBuilder: (_, i) => _NoteTile(note: notes[i], projectId: project['id'] as String),
        ),
      floatingActionButton: FloatingActionButton(
        backgroundColor: pgInk, foregroundColor: pgPaper, elevation: 0,
        shape: const CircleBorder(side: BorderSide(color: pgInk, width: 2)),
        onPressed: () => _openNoteEditor(context, project['id'] as String, null),
        child: const Icon(Icons.note_add_outlined),
      ),
    );
  }
}

class _NoteTile extends StatelessWidget {
  final Map<String, dynamic> note;
  final String projectId;
  const _NoteTile({required this.note, required this.projectId});
  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: pgPaper,
        border: Border.all(color: pgInk, width: 1.5),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(child: Text((note['title'] ?? '').toString().isNotEmpty
              ? note['title'].toString() : '(ohne titel)',
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700))),
            IconButton(icon: const Icon(Icons.edit, size: 16), padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              onPressed: () => _openNoteEditor(context, projectId, note)),
            IconButton(icon: const Icon(Icons.close, size: 16, color: pgDanger), padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              onPressed: () async {
                final ok = await showDialog<bool>(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    title: const Text('notiz löschen?'),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('abbrechen')),
                      TextButton(onPressed: () => Navigator.pop(ctx, true),
                        style: TextButton.styleFrom(foregroundColor: pgDanger),
                        child: const Text('löschen')),
                    ],
                  ),
                );
                if (ok == true) {
                  SyncClientScope.of(context, listen: false).mutate(
                    'REMOVE_NOTE', { 'projectId': projectId, 'noteId': note['id'] });
                }
              },
            ),
          ]),
          if ((note['body'] ?? '').toString().isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(note['body'].toString(), style: const TextStyle(fontSize: 13, height: 1.5)),
          ],
          const SizedBox(height: 6),
          Text('${_authorLabel(note)} · ${_relTime(note['updatedAt'] as int? ?? note['ts'] as int?)}',
            style: const TextStyle(fontFamily: 'monospace', fontSize: 10, color: pgInkFaint)),
        ],
      ),
    );
  }
}

void _openNoteEditor(BuildContext context, String projectId, Map<String, dynamic>? existing) {
  final title = TextEditingController(text: existing?['title']?.toString() ?? '');
  final body = TextEditingController(text: existing?['body']?.toString() ?? '');
  showModalBottomSheet(
    context: context, backgroundColor: pgPaper, isScrollControlled: true,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
    builder: (sheetCtx) => Padding(
      padding: EdgeInsets.fromLTRB(20, 14, 20, MediaQuery.of(sheetCtx).viewInsets.bottom + 20),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        PgEyebrow(existing == null ? 'neue notiz' : 'notiz bearbeiten'),
        const SizedBox(height: 8),
        TextField(controller: title, autofocus: existing == null,
          decoration: const InputDecoration(hintText: 'titel')),
        const SizedBox(height: 10),
        TextField(controller: body, maxLines: 8, minLines: 4,
          decoration: const InputDecoration(hintText: 'text (markdown ok)')),
        const SizedBox(height: 14),
        ElevatedButton(
          onPressed: () {
            final t = title.text.trim();
            final b = body.text;
            if (t.isEmpty && b.isEmpty) return;
            final c = SyncClientScope.of(sheetCtx, listen: false);
            if (existing == null) {
              c.mutate('ADD_NOTE', { 'projectId': projectId, 'note': { 'title': t, 'body': b }});
            } else {
              c.mutate('EDIT_NOTE', { 'projectId': projectId, 'noteId': existing['id'],
                'patch': { 'title': t, 'body': b }});
            }
            Navigator.pop(sheetCtx);
          },
          child: Text(existing == null ? 'anlegen' : 'speichern'),
        ),
      ]),
    ),
  );
}

// ─── APPOINTMENTS ───────────────────────────────────────────
class _AppointmentsView extends StatelessWidget {
  final Map<String, dynamic> project;
  const _AppointmentsView({required this.project});
  @override
  Widget build(BuildContext context) {
    final list = ((project['appointments'] as List?) ?? const []).cast<Map<String, dynamic>>().toList();
    list.sort((a, b) {
      final ad = DateTime.tryParse((a['when'] ?? '').toString())?.millisecondsSinceEpoch ?? 0;
      final bd = DateTime.tryParse((b['when'] ?? '').toString())?.millisecondsSinceEpoch ?? 0;
      return ad.compareTo(bd);
    });
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: list.isEmpty
        ? const Center(child: Padding(
          padding: EdgeInsets.all(24),
          child: Text('keine termine.', style: TextStyle(color: pgInkSoft, fontSize: 13)),
        ))
        : ListView.builder(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 90),
          itemCount: list.length,
          itemBuilder: (_, i) => _ApptTile(appt: list[i], projectId: project['id'] as String),
        ),
      floatingActionButton: FloatingActionButton(
        backgroundColor: pgInk, foregroundColor: pgPaper, elevation: 0,
        shape: const CircleBorder(side: BorderSide(color: pgInk, width: 2)),
        onPressed: () => _openApptEditor(context, project['id'] as String, null),
        child: const Icon(Icons.calendar_today),
      ),
    );
  }
}

class _ApptTile extends StatelessWidget {
  final Map<String, dynamic> appt;
  final String projectId;
  const _ApptTile({required this.appt, required this.projectId});
  @override
  Widget build(BuildContext context) {
    final c = SyncClientScope.of(context);
    // Bugfix (audit): RSVP gegen echte email vergleichen (account-flow) oder
    // gerätename als fallback (pair-flow). Verhindert dass „samsung" für RSVP
    // verwendet wird statt der echten user-identität.
    final myEmail = c.userEmail ?? c.deviceName ?? '';
    final attendees = ((appt['attendees'] as List?) ?? const []).map((e) => e.toString()).toList();
    final iAmIn = attendees.contains(myEmail);
    DateTime? when;
    try { when = DateTime.parse((appt['when'] ?? '').toString()); } catch (_) {}
    final dur = (appt['durationMin'] is num) ? (appt['durationMin'] as num).toInt() : 30;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
      decoration: BoxDecoration(
        color: pgPaper,
        border: Border.all(color: pgInk, width: 1.5),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(child: Text((appt['title'] ?? '').toString(),
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700))),
            PgChip('$dur min'),
          ]),
          const SizedBox(height: 6),
          Text(when == null ? '—' : '📅 ${when.toLocal().toString().substring(0, 16)}',
            style: const TextStyle(fontSize: 12, fontFamily: 'monospace', color: pgInkSoft)),
          if ((appt['notes'] ?? '').toString().isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(appt['notes'].toString(), style: const TextStyle(fontSize: 12.5, height: 1.4)),
          ],
          const SizedBox(height: 6),
          Text('von ${_authorLabel(appt)} · ${attendees.length} zusagen',
            style: const TextStyle(fontFamily: 'monospace', fontSize: 10, color: pgInkFaint)),
          const SizedBox(height: 6),
          Row(children: [
            if (myEmail.isNotEmpty)
              _ActChip(label: iAmIn ? '✓ zusage' : 'zusagen',
                primary: iAmIn,
                onTap: () => c.mutate('TOGGLE_APPOINTMENT_RSVP',
                  { 'projectId': projectId, 'appointmentId': appt['id'], 'attendee': myEmail })),
            const SizedBox(width: 6),
            _ActChip(label: '✎', onTap: () => _openApptEditor(context, projectId, appt)),
            const SizedBox(width: 6),
            _ActChip(label: '×', danger: true, onTap: () async {
              final ok = await showDialog<bool>(
                context: context,
                builder: (ctx) => AlertDialog(
                  title: const Text('termin löschen?'),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('abbrechen')),
                    TextButton(onPressed: () => Navigator.pop(ctx, true),
                      style: TextButton.styleFrom(foregroundColor: pgDanger),
                      child: const Text('löschen')),
                  ],
                ),
              );
              if (ok == true) c.mutate('REMOVE_APPOINTMENT', { 'projectId': projectId, 'appointmentId': appt['id'] });
            }),
          ]),
        ],
      ),
    );
  }
}

class _ActChip extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  final bool primary;
  final bool danger;
  const _ActChip({required this.label, required this.onTap, this.primary = false, this.danger = false});
  @override
  Widget build(BuildContext context) {
    final fg = primary ? pgPaper : (danger ? pgDanger : pgInk);
    final bg = primary ? pgInk : pgPaper;
    final border = danger ? pgDanger : pgInk;
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: bg, border: Border.all(color: border, width: 1.5),
          borderRadius: BorderRadius.circular(11),
        ),
        child: Text(label, style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w500)),
      ),
    );
  }
}

void _openApptEditor(BuildContext context, String projectId, Map<String, dynamic>? existing) {
  final title = TextEditingController(text: existing?['title']?.toString() ?? '');
  final notes = TextEditingController(text: existing?['notes']?.toString() ?? '');
  DateTime when = existing != null
    ? (DateTime.tryParse((existing['when'] ?? '').toString()) ?? DateTime.now().add(const Duration(hours: 1)))
    : DateTime.now().add(const Duration(hours: 1));
  int dur = (existing != null && existing['durationMin'] is num)
    ? (existing['durationMin'] as num).toInt() : 30;

  showModalBottomSheet(
    context: context, backgroundColor: pgPaper, isScrollControlled: true,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
    builder: (sheetCtx) => StatefulBuilder(
      builder: (_, setSheet) => Padding(
        padding: EdgeInsets.fromLTRB(20, 14, 20, MediaQuery.of(sheetCtx).viewInsets.bottom + 20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          PgEyebrow(existing == null ? 'neuer termin' : 'termin bearbeiten'),
          const SizedBox(height: 8),
          TextField(controller: title, autofocus: existing == null,
            decoration: const InputDecoration(hintText: 'titel')),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(
              child: OutlinedButton.icon(
                icon: const Icon(Icons.calendar_today, size: 16, color: pgInk),
                label: Text(when.toLocal().toString().substring(0, 16),
                  style: const TextStyle(color: pgInk, fontFamily: 'monospace', fontSize: 12)),
                onPressed: () async {
                  final d = await showDatePicker(context: sheetCtx, initialDate: when,
                    firstDate: DateTime.now().subtract(const Duration(days: 30)),
                    lastDate: DateTime.now().add(const Duration(days: 365 * 2)));
                  if (d == null) return;
                  final t = await showTimePicker(context: sheetCtx, initialTime: TimeOfDay.fromDateTime(when));
                  if (t == null) return;
                  setSheet(() => when = DateTime(d.year, d.month, d.day, t.hour, t.minute));
                },
              ),
            ),
            const SizedBox(width: 8),
            SizedBox(
              width: 90,
              child: TextField(
                style: const TextStyle(fontFamily: 'monospace'),
                decoration: const InputDecoration(suffixText: 'min', isDense: true),
                keyboardType: TextInputType.number,
                controller: TextEditingController(text: dur.toString()),
                onChanged: (v) => dur = int.tryParse(v) ?? 30,
              ),
            ),
          ]),
          const SizedBox(height: 10),
          TextField(controller: notes, maxLines: 3, minLines: 2,
            decoration: const InputDecoration(hintText: 'notizen (optional)')),
          const SizedBox(height: 14),
          ElevatedButton(
            onPressed: () {
              final t = title.text.trim();
              if (t.isEmpty) return;
              final c = SyncClientScope.of(sheetCtx, listen: false);
              if (existing == null) {
                c.mutate('ADD_APPOINTMENT', { 'projectId': projectId,
                  'appointment': { 'title': t, 'when': when.toIso8601String(),
                    'durationMin': dur, 'notes': notes.text }});
              } else {
                c.mutate('EDIT_APPOINTMENT', { 'projectId': projectId,
                  'appointmentId': existing['id'],
                  'patch': { 'title': t, 'when': when.toIso8601String(),
                    'durationMin': dur, 'notes': notes.text }});
              }
              Navigator.pop(sheetCtx);
            },
            child: Text(existing == null ? 'anlegen' : 'speichern'),
          ),
        ]),
      ),
    ),
  );
}
