import 'package:flutter/material.dart';
import '../../theme.dart';

/// Eingabe-box mit prompt, an-claude-button, stop-button + bild-anhang.
/// State (controller, _busy, _err, _pendingAttach) wird vom parent gehalten.
class CloudPromptBox extends StatelessWidget {
  final TextEditingController controller;
  final bool busy;
  final String? error;
  final VoidCallback onRun;
  final VoidCallback onStop;
  // Optional: image-attach support
  final VoidCallback? onAttach;
  final bool uploadingAttach;
  final List<Map<String, dynamic>> attachments; // [{name, url, kind}]
  final void Function(int index)? onRemoveAttach;

  const CloudPromptBox({
    super.key,
    required this.controller,
    required this.busy,
    required this.error,
    required this.onRun,
    required this.onStop,
    this.onAttach,
    this.uploadingAttach = false,
    this.attachments = const [],
    this.onRemoveAttach,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: pgInk, width: 2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (attachments.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 0),
            child: Wrap(spacing: 6, runSpacing: 6, children: [
              for (int i = 0; i < attachments.length; i++)
                _AttachChip(
                  attachment: attachments[i],
                  onRemove: onRemoveAttach == null ? null : () => onRemoveAttach!(i),
                ),
            ]),
          ),
        TextField(
          controller: controller,
          maxLines: 3, minLines: 2,
          decoration: const InputDecoration(
            hintText: 'was soll claude tun? (leer = nächster task)',
            border: InputBorder.none,
            contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          ),
        ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 6),
            child: Text('⚠ $error',
              style: const TextStyle(color: pgDanger, fontSize: 11)),
          ),
        Container(
          decoration: const BoxDecoration(
            border: Border(top: BorderSide(color: pgInk, width: 1.5)),
          ),
          child: Row(children: [
            if (onAttach != null)
              IconButton(
                tooltip: 'bild anhängen',
                onPressed: (busy || uploadingAttach) ? null : onAttach,
                icon: uploadingAttach
                  ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(color: pgInk, strokeWidth: 2))
                  : const Icon(Icons.attach_file, size: 18, color: pgInk),
                padding: const EdgeInsets.symmetric(horizontal: 12),
              ),
            if (onAttach != null) Container(width: 1.5, color: pgInk, height: 36),
            Expanded(child: TextButton.icon(
              onPressed: busy ? null : onRun,
              icon: const Icon(Icons.bolt, size: 16, color: pgInk),
              label: Text(busy ? 'startet…' : 'an claude',
                style: const TextStyle(
                  color: pgInk, fontSize: 13, fontWeight: FontWeight.w500)),
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 12)),
            )),
            Container(width: 1.5, color: pgInk, height: 36),
            TextButton.icon(
              onPressed: onStop,
              icon: const Icon(Icons.stop, size: 16, color: pgDanger),
              label: const Text('stop',
                style: TextStyle(color: pgDanger, fontSize: 13)),
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12)),
            ),
          ]),
        ),
      ]),
    );
  }
}

class _AttachChip extends StatelessWidget {
  final Map<String, dynamic> attachment;
  final VoidCallback? onRemove;
  const _AttachChip({required this.attachment, this.onRemove});
  @override
  Widget build(BuildContext context) {
    final name = (attachment['name'] ?? 'datei').toString();
    final kind = (attachment['kind'] ?? 'file').toString();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: pgPaper,
        border: Border.all(color: pgInk, width: 1.5),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Text(kind == 'image' ? '🖼' : '📎', style: const TextStyle(fontSize: 12)),
        const SizedBox(width: 4),
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 120),
          child: Text(name,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: pgInk)),
        ),
        if (onRemove != null) ...[
          const SizedBox(width: 4),
          InkWell(onTap: onRemove,
            child: const Icon(Icons.close, size: 13, color: pgInkFaint)),
        ],
      ]),
    );
  }
}
