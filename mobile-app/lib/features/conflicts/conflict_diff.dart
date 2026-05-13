/// Pure-dart side-by-side-diff helper für das conflict-modal.
///
/// Erzeugt aligned rows (lokal | remote) per zeilen-LCS, ohne Flutter-
/// imports — testbar pur. Spiegelt die JS-logik in
/// desktop-app/conflict_diff.js, damit beide apps das gleiche
/// rendering-modell teilen (gerätesynchrones verhalten).
library;

enum DiffKind { equal, remove, add, change }

/// Eine aligned diff-zeile fürs side-by-side-rendering.
/// [left] ist `null` für add-only-zeilen, [right] für remove-only-zeilen.
class DiffRow {
  const DiffRow({required this.kind, this.left, this.right});
  final DiffKind kind;
  final String? left;
  final String? right;
}

/// Splittet text in zeilen (akzeptiert `\n` und `\r\n`).
/// Leerer/null input → leere liste.
List<String> splitLines(String? text) {
  if (text == null || text.isEmpty) return const [];
  return text.split(RegExp(r'\r?\n'));
}

List<List<int>> _lcsMatrix(List<String> a, List<String> b) {
  final dp = List.generate(
    a.length + 1,
    (_) => List.filled(b.length + 1, 0),
  );
  for (var i = 0; i < a.length; i++) {
    for (var j = 0; j < b.length; j++) {
      if (a[i] == b[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        final up = dp[i + 1][j];
        final left = dp[i][j + 1];
        dp[i + 1][j + 1] = up > left ? up : left;
      }
    }
  }
  return dp;
}

/// Liefert aligned diff-zeilen für side-by-side rendering.
/// Benachbarte remove+add werden zu einer `change`-zeile gepaart.
List<DiffRow> computeSideBySide(String local, String remote) {
  final a = splitLines(local);
  final b = splitLines(remote);
  if (a.isEmpty && b.isEmpty) return const [];
  final dp = _lcsMatrix(a, b);
  final ops = <DiffRow>[];
  var i = a.length;
  var j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] == b[j - 1]) {
      ops.add(DiffRow(kind: DiffKind.equal, left: a[i - 1], right: b[j - 1]));
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.add(DiffRow(kind: DiffKind.remove, left: a[i - 1]));
      i--;
    } else {
      ops.add(DiffRow(kind: DiffKind.add, right: b[j - 1]));
      j--;
    }
  }
  while (i > 0) {
    ops.add(DiffRow(kind: DiffKind.remove, left: a[i - 1]));
    i--;
  }
  while (j > 0) {
    ops.add(DiffRow(kind: DiffKind.add, right: b[j - 1]));
    j--;
  }
  final reversed = ops.reversed.toList();
  return _pairChanges(reversed);
}

List<DiffRow> _pairChanges(List<DiffRow> ops) {
  final rows = <DiffRow>[];
  for (var k = 0; k < ops.length; k++) {
    final cur = ops[k];
    final next = k + 1 < ops.length ? ops[k + 1] : null;
    if (next != null &&
        cur.kind == DiffKind.remove &&
        next.kind == DiffKind.add) {
      rows.add(DiffRow(
        kind: DiffKind.change,
        left: cur.left,
        right: next.right,
      ));
      k++;
    } else if (next != null &&
        cur.kind == DiffKind.add &&
        next.kind == DiffKind.remove) {
      rows.add(DiffRow(
        kind: DiffKind.change,
        left: next.left,
        right: cur.right,
      ));
      k++;
    } else {
      rows.add(cur);
    }
  }
  return rows;
}

/// Schnell-check: enthält das diff überhaupt eine änderung?
bool hasChanges(List<DiffRow> rows) =>
    rows.any((r) => r.kind != DiffKind.equal);
