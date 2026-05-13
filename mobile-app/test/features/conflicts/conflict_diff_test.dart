import 'package:flutter_test/flutter_test.dart';
import 'package:projectgamma_mobile/features/conflicts/conflict_diff.dart';

void main() {
  test('splitLines: leer/null → []', () {
    expect(splitLines(''), isEmpty);
    expect(splitLines(null), isEmpty);
  });

  test('splitLines: mehrzeilig, akzeptiert \\r\\n', () {
    expect(splitLines('a\nb\nc'), ['a', 'b', 'c']);
    expect(splitLines('a\r\nb'), ['a', 'b']);
  });

  test('computeSideBySide: identisch → alle equal', () {
    final rows = computeSideBySide('a\nb', 'a\nb');
    expect(rows.length, 2);
    expect(rows.every((r) => r.kind == DiffKind.equal), isTrue);
  });

  test('computeSideBySide: einzeilige änderung → change', () {
    final rows = computeSideBySide('A', 'B');
    expect(rows.length, 1);
    expect(rows.first.kind, DiffKind.change);
    expect(rows.first.left, 'A');
    expect(rows.first.right, 'B');
  });

  test('computeSideBySide: zeile nur lokal → remove', () {
    final rows = computeSideBySide('a\nb', 'a');
    expect(rows[1].kind, DiffKind.remove);
    expect(rows[1].left, 'b');
    expect(rows[1].right, isNull);
  });

  test('computeSideBySide: zeile nur remote → add', () {
    final rows = computeSideBySide('a', 'a\nb');
    expect(rows[1].kind, DiffKind.add);
    expect(rows[1].right, 'b');
    expect(rows[1].left, isNull);
  });

  test('computeSideBySide: gemischt change+remove', () {
    final rows = computeSideBySide('erst\nalt\ndritt', 'erst\nneu');
    expect(rows[0].kind, DiffKind.equal);
    expect(rows[1].kind, DiffKind.change);
    expect(rows[1].left, 'alt');
    expect(rows[1].right, 'neu');
    expect(rows[2].kind, DiffKind.remove);
    expect(rows[2].left, 'dritt');
  });

  test('hasChanges', () {
    expect(hasChanges(computeSideBySide('x', 'x')), isFalse);
    expect(hasChanges(computeSideBySide('x', 'y')), isTrue);
  });

  test('computeSideBySide: beide leer → []', () {
    expect(computeSideBySide('', ''), isEmpty);
  });

  test('computeSideBySide: remote leer → alles remove', () {
    final rows = computeSideBySide('a\nb', '');
    expect(rows.length, 2);
    expect(rows.every((r) => r.kind == DiffKind.remove), isTrue);
  });
}
