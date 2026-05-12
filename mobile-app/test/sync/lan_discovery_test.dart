// TDD: LAN-Discovery mit Concurrency-Limit + Cancel-on-First-Hit.
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:projectgamma_mobile/sync/lan_discovery.dart';

void main() {
  group('discoverServerWith', () {
    test('respektiert Concurrency-Limit (max N parallel)', () async {
      final candidates = List.generate(60, (i) => 'http://10.0.0.$i:7892');
      var inFlight = 0;
      var maxInFlight = 0;
      Future<bool> probe(String url) async {
        inFlight++;
        if (inFlight > maxInFlight) maxInFlight = inFlight;
        await Future<void>.delayed(const Duration(milliseconds: 5));
        inFlight--;
        return false;
      }

      final result = await discoverServerWith(
        candidates: candidates,
        probe: probe,
        concurrency: 8,
      );

      expect(result, isNull);
      expect(maxInFlight, lessThanOrEqualTo(8),
          reason: 'darf nicht mehr als concurrency parallel probes haben');
    });

    test('bricht weitere Probes ab nach erstem Treffer', () async {
      final candidates = List.generate(100, (i) => 'http://10.0.0.$i:7892');
      var probeCount = 0;
      Future<bool> probe(String url) async {
        probeCount++;
        await Future<void>.delayed(const Duration(milliseconds: 5));
        return url == 'http://10.0.0.3:7892';
      }

      final result = await discoverServerWith(
        candidates: candidates,
        probe: probe,
        concurrency: 4,
      );

      expect(result, 'http://10.0.0.3:7892');
      // Nach dem Treffer dürfen nur die bereits laufenden Probes (≤ concurrency)
      // nachlaufen — nicht alle 100.
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(probeCount, lessThan(20),
          reason: 'nach Treffer keine weiteren Probes starten');
    });

    test('liefert null wenn kein Kandidat erreichbar', () async {
      final result = await discoverServerWith(
        candidates: const ['http://a', 'http://b'],
        probe: (_) async => false,
        concurrency: 2,
      );
      expect(result, isNull);
    });

    test('onTry wird nur für tatsächlich gestartete Probes aufgerufen', () async {
      final tried = <String>[];
      final candidates = List.generate(50, (i) => 'http://x.$i');
      final result = await discoverServerWith(
        candidates: candidates,
        probe: (url) async => url == 'http://x.0',
        concurrency: 3,
        onTry: tried.add,
      );
      expect(result, 'http://x.0');
      expect(tried.length, lessThan(50));
    });
  });
}
