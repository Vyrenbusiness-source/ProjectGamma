/**
 * Snackbar-Panel + sync.mutate-Interceptor für Swipe-to-complete + Undo
 * (Desktop-App). Spiegelt Verhalten der Mobile-App.
 *
 * Public API (Window-Globals):
 *  - window.swipeUndoMount(sync): einmalig nach SyncClient-Init aufrufen.
 *    Wrapped sync.mutate so, dass undo-relevante Mutationen automatisch
 *    in den globalen UndoStack gepusht werden. Idempotent.
 *  - <UndoSnackbar/>: React-Komponente, die aktive Undo-Einträge anzeigt.
 *
 * Snackbar-TTL = 4s (gemäß Regel "undo-snackbar-ttl auf 4s standardisieren";
 * UndoStack default 5s gibt 1s Buffer gegen Race).
 */

(function () {
  if (!window.swipeUndo) {
    console.warn('[swipe_undo_panel] swipe_undo.js fehlt — abbruch');
    return;
  }

  const { UndoStack, inverseMutation } = window.swipeUndo;
  const SNACKBAR_TTL_MS = 4000;
  const STACK_TTL_MS = 5000;

  const stack = new UndoStack({ ttlMs: STACK_TTL_MS });
  window.__undoStack = stack;

  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());

  const labelFor = (type) => {
    switch (type) {
      case 'TOGGLE_TASK': return 'Aufgabe umgeschaltet';
      case 'DISMISS_IDEA': return 'Idee verworfen';
      case 'CONVERT_IDEA': return 'Idee in Aufgabe umgewandelt';
      case 'REACTIVATE_IDEA': return 'Idee reaktiviert';
      default: return 'Aktion';
    }
  };

  let mounted = false;
  window.swipeUndoMount = function (sync) {
    if (mounted || !sync || typeof sync.mutate !== 'function') return;
    mounted = true;
    const orig = sync.mutate.bind(sync);
    sync.mutate = function (type, payload, opts) {
      const isUndoDispatch = opts && opts.__fromUndo === true;
      const result = orig(type, payload);
      if (!isUndoDispatch && inverseMutation(type, payload)) {
        const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        stack.push({ id, label: labelFor(type), mutationType: type, payload: payload || {} });
        emit();
      }
      return result;
    };
    sync.__undoUnwrappedMutate = orig;
  };

  window.swipeUndoSubscribe = function (fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  window.UndoSnackbar = function UndoSnackbar() {
    const [, setTick] = React.useState(0);
    React.useEffect(() => window.swipeUndoSubscribe(() => setTick((x) => x + 1)), []);
    React.useEffect(() => {
      const t = setInterval(() => {
        const removed = stack.purgeExpired();
        if (removed > 0) setTick((x) => x + 1);
      }, 500);
      return () => clearInterval(t);
    }, []);

    const now = Date.now();
    const visible = stack.active.filter((e) => now - e.createdAt < SNACKBAR_TTL_MS);
    if (visible.length === 0) return null;

    const onUndo = (entry) => {
      const inv = inverseMutation(entry.mutationType, entry.payload);
      if (!inv) return;
      stack.consume(entry.id);
      const sync = window.__sync;
      if (sync && sync.__undoUnwrappedMutate) {
        sync.__undoUnwrappedMutate(inv.type, inv.payload);
      } else if (sync) {
        sync.mutate(inv.type, inv.payload, { __fromUndo: true });
      }
      emit();
    };

    const wrapStyle = {
      position: 'fixed', bottom: 70, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', flexDirection: 'column', gap: 8, zIndex: 220,
      pointerEvents: 'none',
    };
    const barStyle = {
      display: 'flex', gap: 12, alignItems: 'center',
      background: 'var(--ink)', color: 'var(--paper)',
      padding: '8px 14px', borderRadius: 22,
      fontFamily: '"JetBrains Mono", monospace', fontSize: 12,
      boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
      pointerEvents: 'auto',
    };
    return (
      <div style={wrapStyle} role="status" aria-live="polite">
        {visible.map((e) => (
          <div style={barStyle} key={e.id}>
            <span>{e.label}</span>
            <button className="btn tiny" onClick={() => onUndo(e)}>Rückgängig</button>
          </div>
        ))}
      </div>
    );
  };
})();
