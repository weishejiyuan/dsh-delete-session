/**
 * Client half: a classic-script factory bundle. The browser module system
 * requires the bundle to call `window.__ModuleLoader__.load` synchronously on
 * load; everything else lives inside the factory and runs at materialize time.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-delete-session',
  factory: (require) => {
    const React = require('react')
    const { Tooltip, IconTrashOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')

    const LOCALE_NAMESPACE = 'deleteSession'
    const ROW_ACTION_SLOT = 'sidebar.workspaces.session.row.action'
    const DELETE_ENDPOINT = '/delete-session/api/delete'

    const messages = {
      zh: {
        'label.deletePermanently': '永久删除',
        deleted: '会话已永久删除',
      },
      en: {
        'label.deletePermanently': 'Delete permanently',
        deleted: 'Session deleted permanently',
      },
    }

    return {
      name: 'delete-session-client',
      inject: ['slots', 'locale', 'contextMenus'],
      apply(ctx) {
        ctx.locale.register(LOCALE_NAMESPACE, messages)
        const t = ctx.locale.bind(LOCALE_NAMESPACE)

        async function deleteSession(sessionId) {
          const response = await fetch(DELETE_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          })
          const result = await response.json()
          if (result?.ok === true && result.code === 'OK') ctx.contextMenus.notify(t('deleted'), true)
        }

        function DeleteSessionRowButton({ sessionId, t: translate }) {
          const label = translate('label.deletePermanently')
          return React.createElement(
            Tooltip,
            { label, side: 'bottom', align: 'end', delayMs: 500, portal: true },
            React.createElement(
              'button',
              {
                type: 'button',
                'aria-label': label,
                onClick: () => {
                  void deleteSession(sessionId)
                },
              },
              React.createElement(IconTrashOutlineRegular, { size: 14 }),
            ),
          )
        }

        ctx.slots.inject(ROW_ACTION_SLOT, () =>
          ctx.slots.register(
            { name: ROW_ACTION_SLOT, id: 'delete-session', order: 300, locale: LOCALE_NAMESPACE },
            DeleteSessionRowButton,
          ),
        )
      },
    }
  },
})
