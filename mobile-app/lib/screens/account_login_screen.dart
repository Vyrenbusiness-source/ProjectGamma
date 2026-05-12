// Account-Login-Screen · multi-user schicht 1+2.
// Alternative zum QR-/Code-pairing: email + passwort → user-token.
// Server-URL muss bekannt sein (vom desktop oder per LAN-discovery).
//
// Toggle „registrieren / einloggen" oben. Erster registrierter user wird
// server-seitig OWNER aller bestehenden projekte (bootstrap).

import 'package:flutter/material.dart';
import '../theme.dart';
import '../sync_client.dart';

class AccountLoginScreen extends StatefulWidget {
  const AccountLoginScreen({super.key});
  @override
  State<AccountLoginScreen> createState() => _AccountLoginScreenState();
}

class _AccountLoginScreenState extends State<AccountLoginScreen> {
  final _server = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _device = TextEditingController();
  bool _isRegister = false;
  bool _busy = false;
  bool _discovering = false;
  String? _error;

  @override
  void dispose() {
    _server.dispose();
    _email.dispose();
    _password.dispose();
    _device.dispose();
    super.dispose();
  }

  Future<void> _discover() async {
    setState(() { _discovering = true; _error = null; });
    final url = await SyncClient.discoverServer();
    if (!mounted) return;
    if (url != null) {
      _server.text = url;
      setState(() => _discovering = false);
    } else {
      setState(() {
        _discovering = false;
        _error = 'kein server gefunden. trag die IP manuell ein.';
      });
    }
  }

  Future<void> _submit() async {
    setState(() { _busy = true; _error = null; });
    final client = SyncClientScope.of(context, listen: false);
    try {
      final email = _email.text.trim();
      final pw = _password.text;
      if (email.isEmpty) throw Exception('email fehlt');
      if (pw.length < 8) throw Exception('passwort muss mind. 8 zeichen sein');
      var server = _server.text.trim();
      if (!server.startsWith('http')) throw Exception('server-url muss mit http(s):// beginnen');
      // USB-fallback wie in pairing_screen: localhost wenn LAN unreachable
      if (!await SyncClient.testServer(server)) {
        final uri = Uri.tryParse(server);
        final port = uri?.port ?? 7892;
        final fb = 'http://localhost:$port';
        if (fb != server && await SyncClient.testServer(fb)) {
          server = fb;
          if (mounted) setState(() => _server.text = server);
        } else {
          throw Exception('server nicht erreichbar unter $server');
        }
      }
      if (_isRegister) {
        await client.registerAccount(
          serverUrl: server, email: email, password: pw,
          deviceName: _device.text.trim().isEmpty ? email : _device.text.trim(),
        );
      } else {
        await client.loginWithAccount(
          serverUrl: server, email: email, password: pw,
          deviceName: _device.text.trim().isEmpty ? email : _device.text.trim(),
        );
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    return Scaffold(
      backgroundColor: pgPaper,
      appBar: AppBar(
        backgroundColor: pgPaper,
        elevation: 0,
        iconTheme: const IconThemeData(color: pgInk),
        title: const Text('account', style: TextStyle(color: pgInk, fontSize: 16)),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(24, mq.padding.top, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Toggle Register/Login als sketchy chip-pair
              Row(children: [
                _ToggleChip(
                  label: 'einloggen',
                  selected: !_isRegister,
                  onTap: () => setState(() => _isRegister = false),
                ),
                const SizedBox(width: 8),
                _ToggleChip(
                  label: 'registrieren',
                  selected: _isRegister,
                  onTap: () => setState(() => _isRegister = true),
                ),
              ]),
              const SizedBox(height: 24),

              const PgEyebrow('server-url'),
              const SizedBox(height: 6),
              TextField(
                controller: _server,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
                decoration: const InputDecoration(hintText: 'http://192.168.x.x:7892'),
                autocorrect: false,
                keyboardType: TextInputType.url,
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _discovering ? null : _discover,
                icon: _discovering
                    ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(color: pgInk, strokeWidth: 2))
                    : const Icon(Icons.search, size: 16),
                label: const Text('server suchen'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: pgInk,
                  side: const BorderSide(color: pgInk, width: 1.5),
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
              ),
              const SizedBox(height: 20),

              const PgEyebrow('email'),
              const SizedBox(height: 6),
              TextField(
                controller: _email,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 14),
                decoration: const InputDecoration(hintText: 'du@example.com'),
                autocorrect: false,
                keyboardType: TextInputType.emailAddress,
              ),
              const SizedBox(height: 16),

              const PgEyebrow('passwort'),
              const SizedBox(height: 6),
              TextField(
                controller: _password,
                obscureText: true,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 14),
                decoration: const InputDecoration(hintText: 'mind. 8 zeichen'),
              ),
              const SizedBox(height: 16),

              const PgEyebrow('gerätename'),
              const SizedBox(height: 6),
              TextField(
                controller: _device,
                decoration: const InputDecoration(hintText: 'z.B. samsung-s20'),
              ),
              const SizedBox(height: 24),

              if (_error != null) ...[
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    border: Border.all(color: pgDanger, width: 1.5),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(_error!, style: const TextStyle(color: pgDanger, fontSize: 13)),
                ),
                const SizedBox(height: 14),
              ],

              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _busy ? null : _submit,
                  child: _busy
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: pgPaper, strokeWidth: 2))
                      : Text(_isRegister ? 'account anlegen →' : 'einloggen →'),
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'hinweis: der allererste registrierte account wird automatisch '
                'owner aller bestehenden projekte. weitere accounts starten leer '
                'und müssen von einem owner eingeladen werden (im projekt-screen).',
                style: TextStyle(color: pgInkFaint, fontSize: 11, height: 1.55),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ToggleChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _ToggleChip({
    required this.label, required this.selected, required this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? pgInk : pgPaper,
          border: Border.all(color: pgInk, width: 1.5),
          borderRadius: BorderRadius.circular(18),
        ),
        child: Text(label, style: TextStyle(
          color: selected ? pgPaper : pgInk,
          fontFamily: 'monospace',
          fontSize: 12,
          fontWeight: FontWeight.w600,
        )),
      ),
    );
  }
}
