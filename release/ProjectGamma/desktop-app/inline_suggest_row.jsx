// Inline-Suggest-Row: KI-Vorschlag fuer Idee->Aufgabe als Ein-Tap-Akzept-Target.
// Pure-Wrapper um window.aiSuggestTask + sync.mutate; kein eigener State.
// Spiegelt mobile-app/lib/features/idea_to_task/inline_suggest_row.dart.
'use strict';

(function () {
  const { React } = window;
  if (!React) return;

  function InlineSuggestRow(props) {
    const { projectId, ideaId, ideaText, sync } = props;
    const suggest = window.aiSuggestTask
      ? window.aiSuggestTask(ideaText || '')
      : null;
    if (!suggest) return null;

    const onTap = () => {
      sync.mutate('CONVERT_IDEA', {
        projectId,
        ideaId,
        title: suggest.title,
        meta: suggest.meta,
        priority: suggest.priority,
      });
      sync.mutate('ADD_SYNC_LOG', {
        entry: {
          source: 'desktop',
          projectId,
          text:
            'idee „' + ideaText + '" → aufgabe (ki: ' + suggest.priority + ')',
        },
      });
    };

    return React.createElement(
      'button',
      {
        type: 'button',
        className: 'btn tiny inline-suggest',
        onClick: onTap,
        title: 'tap zum akzeptieren',
        style: {
          marginRight: 6,
          fontSize: 11,
          fontWeight: 600,
          maxWidth: 280,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
      },
      '✓ als aufgabe: „' + suggest.title + '" · prio ' + suggest.priority,
    );
  }

  window.InlineSuggestRow = InlineSuggestRow;
})();
