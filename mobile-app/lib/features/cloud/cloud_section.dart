import 'package:flutter/material.dart';
import '../../theme.dart';

/// Collapsable section mit label, badge-count und optional trailing-action.
class CloudSection extends StatelessWidget {
  final String label;
  final int count;
  final bool open;
  final VoidCallback onTap;
  final Widget child;
  final Widget? trailing;
  const CloudSection({
    super.key,
    required this.label,
    required this.count,
    required this.open,
    required this.onTap,
    required this.child,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        border: Border.all(color: pgInk, width: 1.5),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(children: [
        InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
            child: Row(children: [
              Icon(open ? Icons.keyboard_arrow_down : Icons.keyboard_arrow_right,
                size: 18, color: pgInkSoft),
              const SizedBox(width: 4),
              Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
              const SizedBox(width: 6),
              if (count > 0) Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                decoration: BoxDecoration(
                  color: pgInk,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text('$count', style: const TextStyle(
                  color: pgPaper, fontSize: 9.5,
                  fontFamily: 'monospace', fontWeight: FontWeight.w500,
                )),
              ),
              const Spacer(),
              if (trailing != null) trailing!,
            ]),
          ),
        ),
        if (open)
          Container(
            decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: pgInkFaint, width: 1)),
            ),
            padding: const EdgeInsets.fromLTRB(10, 6, 10, 8),
            child: child,
          ),
      ]),
    );
  }
}

/// Empty-state-zeile für leere section-inhalte.
class CloudEmpty extends StatelessWidget {
  final String text;
  const CloudEmpty(this.text, {super.key});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: Text(text, style: const TextStyle(
      color: pgInkFaint, fontSize: 11.5, fontStyle: FontStyle.italic)),
  );
}
