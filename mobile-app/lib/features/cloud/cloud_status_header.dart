import 'package:flutter/material.dart';
import '../../theme.dart';

/// Clean cloud-code header (mobile · spiegelt desktop cc-header + cc-stats).
/// Zeigt status, kosten/tokens, aktuelle aufgabe, claude-api-limit-banner.
class CloudStatusHeader extends StatelessWidget {
  final bool ccRunning;
  final Map<String, dynamic>? budget;
  final List<Map<String, dynamic>> inProgress;
  final bool limitHit;
  final String? limitResetText;
  final VoidCallback onToggle;
  // Optionale activity-stats für die 4 kleinen cards. Backward-compat: leer.
  final List<Map<String, dynamic>>? activity;
  const CloudStatusHeader({
    super.key,
    required this.ccRunning,
    required this.budget,
    required this.inProgress,
    required this.limitHit,
    required this.limitResetText,
    required this.onToggle,
    this.activity,
  });

  int _count(String type) =>
      (activity ?? const []).where((e) => e['type'] == type).length;

  @override
  Widget build(BuildContext context) {
    final checks = _count('check');
    final writes = _count('write');
    final warnings = _count('warn');
    final cost = (budget?['totalCostUsd'] as num? ?? 0).toDouble();
    final tIn = (budget?['totalTokensIn'] as num? ?? 0).toInt();
    final tOut = (budget?['totalTokensOut'] as num? ?? 0).toInt();

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      // Header-Box: titel + status + controls
      Container(
        padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
        decoration: BoxDecoration(
          color: pgPaper,
          border: Border.all(color: pgInk, width: 2),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(children: [
          Expanded(child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('cloud-code',
                  style: TextStyle(
                      fontSize: 18, fontWeight: FontWeight.w700, color: pgInk, height: 1.1)),
              const SizedBox(height: 4),
              Row(children: [
                Container(
                  width: 8, height: 8,
                  decoration: BoxDecoration(
                    color: ccRunning ? pgInk : pgInkFaint, shape: BoxShape.circle),
                ),
                const SizedBox(width: 6),
                Flexible(child: Text(
                  ccRunning ? 'auto-pump aktiv' : 'pausiert',
                  style: const TextStyle(
                      fontFamily: 'monospace', fontSize: 11, color: pgInkSoft),
                  overflow: TextOverflow.ellipsis,
                )),
              ]),
            ],
          )),
          const SizedBox(width: 8),
          InkWell(
            onTap: onToggle,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: ccRunning ? pgPaper : pgInk,
                border: Border.all(color: pgInk, width: 1.5),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Text(
                ccRunning ? 'pause' : '▶ start',
                style: TextStyle(
                  fontFamily: 'monospace', fontSize: 11, fontWeight: FontWeight.w600,
                  color: ccRunning ? pgInk : pgPaper),
              ),
            ),
          ),
        ]),
      ),

      // Stats-grid: 4 cards 2×2 — kompakt für mobile screens
      const SizedBox(height: 10),
      Row(children: [
        Expanded(child: _StatCard(label: 'checks', value: '$checks', accent: checks > 0)),
        const SizedBox(width: 8),
        Expanded(child: _StatCard(label: 'writes', value: '$writes')),
      ]),
      const SizedBox(height: 8),
      Row(children: [
        Expanded(child: _StatCard(
          label: 'warnings', value: '$warnings',
          warning: warnings > 0,
          sub: warnings > 0 ? 'blocker offen' : 'alles klar')),
        const SizedBox(width: 8),
        Expanded(child: _StatCard(
          label: 'kosten', value: '\$${cost.toStringAsFixed(2)}',
          sub: '${(tIn/1000).toStringAsFixed(1)}k·${(tOut/1000).toStringAsFixed(1)}k')),
      ]),

      // Aktuelle aufgabe — sichtbar wenn in_progress vorhanden
      if (inProgress.isNotEmpty) ...[
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
          decoration: const BoxDecoration(
            color: Color(0x07000000),
            border: Border(left: BorderSide(color: pgInk, width: 3)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('NÄCHSTE AUFGABE', style: TextStyle(
                fontFamily: 'monospace', fontSize: 9, color: pgInkFaint, letterSpacing: 1.2)),
              const SizedBox(height: 2),
              Text(inProgress.first['title']?.toString() ?? '?',
                style: const TextStyle(fontSize: 13.5, color: pgInk, fontWeight: FontWeight.w600, height: 1.3),
                maxLines: 2, overflow: TextOverflow.ellipsis),
            ],
          ),
        ),
      ],

      // API-limit-banner (unverändert)
      if (limitHit) ...[
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: const Color(0xFFFFF3E0),
            border: Border.all(color: const Color(0xFFCC8800), width: 1.5),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Row(children: [
            const Icon(Icons.warning_amber_rounded,
              size: 18, color: Color(0xFFCC8800)),
            const SizedBox(width: 8),
            Expanded(child: Text(
              limitResetText != null
                ? 'claude-api limit erreicht · setzt fort um $limitResetText'
                : 'claude-api limit erreicht · weitere runs schlagen fehl',
              style: const TextStyle(fontSize: 12, height: 1.4),
            )),
          ]),
        ),
      ],
    ]);
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final String? sub;
  final bool accent;
  // M7 · warning-variant: gelb-akzent für „blocker offen"-codierung
  final bool warning;
  const _StatCard({
    required this.label, required this.value, this.sub,
    this.accent = false, this.warning = false,
  });
  @override
  Widget build(BuildContext context) {
    // Warning override: gelb-card mit dunklerem text (a11y-contrast > 4.5:1)
    final bgColor = warning ? const Color(0xFFFFF3E0) : pgPaper;
    final borderColor = warning ? const Color(0xFFCC8800) : (accent ? pgInk : pgInkFaint);
    final borderW = warning || accent ? 2.0 : 1.5;
    final valueColor = warning ? const Color(0xFF8A5500) : pgInk;
    final labelColor = warning ? const Color(0xFFCC8800) : pgInkFaint;
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
      decoration: BoxDecoration(
        color: bgColor,
        border: Border.all(color: borderColor, width: borderW),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label.toUpperCase(), style: TextStyle(
            fontFamily: 'monospace', fontSize: 9, color: labelColor, letterSpacing: 1.2)),
          const SizedBox(height: 2),
          Text(value, style: TextStyle(
            fontFamily: 'monospace', fontSize: 16, fontWeight: FontWeight.w700, color: valueColor, height: 1.1)),
          if (sub != null) ...[
            const SizedBox(height: 1),
            Text(sub!, style: TextStyle(
              fontFamily: 'monospace', fontSize: 9.5,
              color: warning ? const Color(0xFF8A5500) : pgInkSoft), maxLines: 1, overflow: TextOverflow.ellipsis),
          ],
        ],
      ),
    );
  }
}
