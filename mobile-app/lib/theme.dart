// Sketchy B&W Theme · matches Desktop-App. Hell + Dunkel-Variante.
import 'package:flutter/material.dart';

const pgPaper    = Color(0xFFFAF8F3);
const pgPaper2   = Color(0xFFF4F1E9);
const pgInk      = Color(0xFF1A1A1A);
const pgInkSoft  = Color(0xFF555555);
const pgInkFaint = Color(0xFF999999);
const pgBg       = Color(0xFFEFECE4);
const pgDanger   = Color(0xFFCC3333);


ThemeData pgTheme() {
  const base = TextStyle(color: pgInk, fontFamily: 'Inter');
  return ThemeData(
    useMaterial3: false,
    scaffoldBackgroundColor: pgPaper,
    primaryColor: pgInk,
    canvasColor: pgPaper,
    fontFamily: 'Inter',
    textTheme: TextTheme(
      headlineLarge: base.copyWith(fontSize: 28, fontWeight: FontWeight.w600, height: 1.1),
      headlineMedium: base.copyWith(fontSize: 22, fontWeight: FontWeight.w600, height: 1.15),
      titleLarge: base.copyWith(fontSize: 18, fontWeight: FontWeight.w600),
      titleMedium: base.copyWith(fontSize: 15, fontWeight: FontWeight.w500),
      bodyLarge: base.copyWith(fontSize: 15, height: 1.4),
      bodyMedium: base.copyWith(fontSize: 14, height: 1.4),
      bodySmall: base.copyWith(fontSize: 12, color: pgInkSoft, height: 1.4),
      labelMedium: base.copyWith(fontSize: 11, color: pgInkSoft, letterSpacing: 1.2, fontWeight: FontWeight.w500),
    ),
    colorScheme: const ColorScheme.light(
      primary: pgInk,
      onPrimary: pgPaper,
      surface: pgPaper,
      onSurface: pgInk,
      error: pgDanger,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: pgPaper,
      foregroundColor: pgInk,
      elevation: 0,
      systemOverlayStyle: null,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: pgPaper,
      hintStyle: const TextStyle(color: pgInkFaint),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: pgInk, width: 2),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: pgInk, width: 2),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: pgInk, width: 2.5),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: pgInk,
        foregroundColor: pgPaper,
        elevation: 0,
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontWeight: FontWeight.w500, fontSize: 15),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: pgInk,
        side: const BorderSide(color: pgInk, width: 2),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    dividerTheme: const DividerThemeData(color: pgInkFaint, thickness: 1, space: 16),
  );
}

class PgBox extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final bool dashed;
  const PgBox({super.key, required this.child, this.padding, this.dashed = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding ?? const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: pgPaper,
        border: Border.all(color: pgInk, width: 2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: child,
    );
  }
}

class PgEyebrow extends StatelessWidget {
  final String text;
  const PgEyebrow(this.text, {super.key});
  @override
  Widget build(BuildContext context) {
    return Text(
      '// ${text.toUpperCase()}',
      style: const TextStyle(
        fontFamily: 'monospace',
        fontSize: 10,
        letterSpacing: 1.4,
        color: pgInkSoft,
        fontWeight: FontWeight.w500,
      ),
    );
  }
}

class PgChip extends StatelessWidget {
  final String text;
  final bool solid;
  const PgChip(this.text, {super.key, this.solid = false});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 2),
      constraints: const BoxConstraints(maxWidth: 220),
      decoration: BoxDecoration(
        color: solid ? pgInk : pgPaper,
        border: Border.all(color: pgInk, width: 1.5),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        text,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          fontFamily: 'monospace',
          fontSize: 10,
          color: solid ? pgPaper : pgInkSoft,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}

class PgCcDot extends StatelessWidget {
  final String text;
  final bool live;
  const PgCcDot(this.text, {super.key, this.live = false});
  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 8, height: 8, decoration: const BoxDecoration(color: pgInk, shape: BoxShape.circle)),
        const SizedBox(width: 6),
        Text(text, style: const TextStyle(fontFamily: 'monospace', fontSize: 10, color: pgInkSoft)),
      ],
    );
  }
}
