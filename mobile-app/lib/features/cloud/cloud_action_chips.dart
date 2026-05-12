import 'package:flutter/material.dart';
import '../../theme.dart';

/// Toggle-chip für target-group-picker (in_progress | next).
class CloudTargetChip extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback onTap;
  const CloudTargetChip({super.key, required this.label, required this.active, required this.onTap});

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: active ? pgInk : pgPaper,
        border: Border.all(color: pgInk, width: 1.2),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(label, style: TextStyle(
        color: active ? pgPaper : pgInk,
        fontFamily: 'monospace', fontSize: 10,
      )),
    ),
  );
}

/// Kompakter action-button für vorschlag/bug-rows (akzeptieren/ablehnen).
class CloudMiniBtn extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  final bool primary;
  const CloudMiniBtn({super.key, required this.label, required this.onTap, this.primary = false});

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: primary ? pgInk : pgPaper,
        border: Border.all(color: pgInk, width: 1.5),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(label, style: TextStyle(
        color: primary ? pgPaper : pgInk,
        fontSize: 11,
        fontWeight: FontWeight.w500,
      )),
    ),
  );
}
