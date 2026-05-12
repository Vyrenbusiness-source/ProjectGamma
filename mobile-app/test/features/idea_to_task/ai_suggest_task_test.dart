// TDD: heuristische KI-Vorschlaege fuer Idee->Aufgabe (1-Tap-Flow).
import 'package:flutter_test/flutter_test.dart';
import 'package:projectgamma_mobile/features/idea_to_task/ai_suggest_task.dart';

void main() {
  group('aiSuggestTask', () {
    test('leere oder whitespace-eingabe -> null', () {
      expect(aiSuggestTask(''), isNull);
      expect(aiSuggestTask('   '), isNull);
    });

    test('einfacher text -> title getrimmt + erstes zeichen gross', () {
      final s = aiSuggestTask('einkaufen morgen')!;
      expect(s.title, 'Einkaufen morgen');
      expect(s.meta, 'aus idee');
      expect(s.priority, 3);
    });

    test('hoch-keyword -> priority 4 + meta enthaelt "hoch"', () {
      final s = aiSuggestTask('DRINGEND backup machen')!;
      expect(s.priority, 4);
      expect(s.meta.toLowerCase(), contains('hoch'));
      expect(s.title.toLowerCase(), isNot(startsWith('dringend')));
    });

    test('niedrig-keyword -> priority 2', () {
      final s = aiSuggestTask('vielleicht mal die docs lesen')!;
      expect(s.priority, 2);
      expect(s.meta.toLowerCase(), contains('niedrig'));
    });

    test('langer text wird bei 80 zeichen gekuerzt', () {
      final long = 'a' * 200;
      final s = aiSuggestTask(long)!;
      expect(s.title.length, lessThanOrEqualTo(80));
    });

    test('toJson liefert title/meta/priority', () {
      final j = aiSuggestTask('foo bar')!.toJson();
      expect(j['title'], 'Foo bar');
      expect(j['meta'], 'aus idee');
      expect(j['priority'], 3);
    });
  });
}
