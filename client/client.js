/**
 * Client half: a classic-script factory bundle. The browser module system
 * requires the bundle to call `window.__ModuleLoader__.load` synchronously on
 * load; everything else lives inside the factory and runs at materialize time.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-delete-session',
  factory: (require) => {
    const React = require('react')
    const { Button, Modal, Tooltip, IconTrashOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')

    const LOCALE_NAMESPACE = 'deleteSession'
    const ROW_ACTION_SLOT = 'sidebar.workspaces.session.row.action'
    const OVERLAY_SLOT = 'shell.overlay'
    const DELETE_ENDPOINT = '/delete-session/api/delete'
    const DANGER_TEXT_COLOR = 'var(--dsw-alias-state-error-primary)'

    const messages = {
      zh: {
        'label.deletePermanently': '永久删除',
        'label.deleteCurrentDisabled': '不能删除当前会话',
        'confirm.title': '永久删除会话',
        'confirm.desc': '将永久删除「{title}」，此操作不可撤销。',
        'confirm.action': '永久删除',
        'confirm.pending': '正在删除…',
        cancel: '取消',
        deleted: '会话已永久删除',
        sessionActive: '会话正在运行，请先停止',
        sessionNotFound: '会话不存在，可能已被删除',
        deleteFailed: '删除失败',
      },
      en: {
        'label.deletePermanently': 'Delete permanently',
        'label.deleteCurrentDisabled': 'Cannot delete current session',
        'confirm.title': 'Delete session permanently',
        'confirm.desc': '「{title}」 will be deleted permanently. This cannot be undone.',
        'confirm.action': 'Delete permanently',
        'confirm.pending': 'Deleting…',
        cancel: 'Cancel',
        deleted: 'Session deleted permanently',
        sessionActive: 'Session is running; stop it first',
        sessionNotFound: 'Session not found; it may already be deleted',
        deleteFailed: 'Delete failed',
      },
    }

    /**
     * The shared delete-request store. Every entry (the row button now, the
     * session menu next) only records which Session the user asked to delete;
     * the `shell.overlay` dialog is the one place that acts on it, so no entry
     * can delete anything by itself. A factory-scope store also means the row
     * and the overlay see the same request across slot registrations.
     */
    const listeners = new Set()
    let deleteRequest = null

    function getSnapshot() {
      return deleteRequest
    }

    function subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }

    function publish() {
      for (const listener of [...listeners]) listener()
    }

    function openDeleteRequest({ sessionId, displayTitle }) {
      deleteRequest = { sessionId, displayTitle }
      publish()
    }

    function closeDeleteRequest() {
      if (deleteRequest === null) return
      deleteRequest = null
      publish()
    }

    /** `deleteFailed` is a prefix: the concrete reason follows it when known. */
    function withReason(label, reason) {
      const detail = typeof reason === 'string' ? reason.trim() : ''
      return detail === '' ? label : `${label} — ${detail}`
    }

    function messageOf(reason) {
      if (typeof reason?.message === 'string') return reason.message
      return String(reason)
    }

    /**
     * Maps a response onto the dialog line: the two refusal codes already name
     * the next step the user can take, everything else keeps the reason the
     * Host (or the network layer) reported.
     */
    function failureLine(result, translate) {
      switch (result?.code) {
        case 'SESSION_ACTIVE':
          return translate('sessionActive')
        case 'SESSION_NOT_FOUND':
          return translate('sessionNotFound')
        case 'DELETE_FAILED':
          return withReason(translate('deleteFailed'), result.message)
        default:
          return withReason(translate('deleteFailed'), result?.message)
      }
    }

    /** Resolves to `{ ok: true }` or `{ ok: false, message }` — never rejects. */
    async function postDelete(sessionId, translate) {
      try {
        const response = await fetch(DELETE_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        })
        const result = await response.json()
        if (result?.ok === true && result.code === 'OK') return { ok: true }
        return { ok: false, message: failureLine(result, translate) }
      } catch (reason) {
        return { ok: false, message: withReason(translate('deleteFailed'), messageOf(reason)) }
      }
    }

    return {
      name: 'delete-session-client',
      inject: ['slots', 'locale', 'contextMenus'],
      apply(ctx) {
        ctx.locale.register(LOCALE_NAMESPACE, messages)

        // One POST per in-flight window: a second confirm click while the first
        // request is on the wire sends nothing.
        let inFlight = null

        /** Re-renders on store changes; the snapshot itself is read at render. */
        function useDeleteRequest() {
          const [, setRevision] = React.useState(0)
          React.useEffect(() => subscribe(() => setRevision((revision) => revision + 1)), [])
          return getSnapshot()
        }

        /**
         * The `shell.overlay` entry: nothing while no deletion is pending,
         * otherwise one dialog per request. Keying the form by the Session lets
         * in-flight and error state die with the request they belong to.
         */
        function DeleteSessionConfirm({ t: translate }) {
          const request = useDeleteRequest()
          if (request === null) return null
          return React.createElement(DeleteSessionConfirmForm, {
            key: request.sessionId,
            request,
            t: translate,
          })
        }

        /** One request's dialog: cancelling is free, confirming is irreversible. */
        function DeleteSessionConfirmForm({ request, t: translate }) {
          const [deleting, setDeleting] = React.useState(false)
          const [failure, setFailure] = React.useState(null)

          const close = () => {
            if (deleting || inFlight !== null) return
            closeDeleteRequest()
          }

          const confirm = () => {
            if (deleting || inFlight !== null) return
            setDeleting(true)
            setFailure(null)
            inFlight = postDelete(request.sessionId, translate).then((outcome) => {
              inFlight = null
              setDeleting(false)
              if (outcome.ok) {
                closeDeleteRequest()
                ctx.contextMenus.notify(translate('deleted'), true)
                return
              }
              setFailure(outcome.message)
            })
          }

          const failureLineNode = failure === null
            ? null
            : React.createElement(
                'div',
                { role: 'alert', style: { color: DANGER_TEXT_COLOR } },
                failure,
              )

          return React.createElement(
            Modal,
            {
              open: true,
              onClose: close,
              closeLabel: translate('close'),
              title: translate('confirm.title'),
              description: translate('confirm.desc', { title: request.displayTitle }),
              footer: React.createElement(
                React.Fragment,
                null,
                React.createElement(
                  Button,
                  { variant: 'outline', disabled: deleting, onClick: close },
                  translate('cancel'),
                ),
                React.createElement(
                  Button,
                  {
                    variant: 'outline',
                    style: { color: DANGER_TEXT_COLOR },
                    disabled: deleting,
                    onClick: confirm,
                  },
                  translate(deleting ? 'confirm.pending' : 'confirm.action'),
                ),
              ),
            },
            failureLineNode,
          )
        }

        // `useSessions` / `usePanelInfo` are global standard props synthesized by
        // the slot machinery; the optional calls keep a host that omits them from
        // crashing the row — without them the row reads as an ordinary, enabled row.
        function DeleteSessionRowButton({ sessionId, displayTitle, t: translate, useSessions, usePanelInfo }) {
          const panelActive = usePanelInfo?.((info) => info.activePanelId !== null) === true
          const blank = useSessions?.((sessions) => sessions.byId[sessionId]?.blank === true) === true
          const currentSessionId = useSessions?.((sessions) =>
            panelActive
              ? undefined
              : Object.values(sessions.byId).find((row) => (row.retainedBy?.mainView ?? 0) > 0)?.id,
          )
          const running = useSessions?.((sessions) => sessions.byId[sessionId]?.running === true) === true

          if (blank) return null

          const isCurrent = currentSessionId !== undefined && currentSessionId === sessionId
          const disabled = isCurrent || running
          const label = translate(
            isCurrent ? 'label.deleteCurrentDisabled' : running ? 'sessionActive' : 'label.deletePermanently',
          )
          return React.createElement(
            Tooltip,
            { label, side: 'bottom', align: 'end', delayMs: 500, portal: true },
            React.createElement(
              'button',
              {
                type: 'button',
                'aria-label': label,
                disabled,
                style: {
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  color: 'inherit',
                  cursor: disabled ? 'default' : 'pointer',
                  opacity: disabled ? 0.4 : 1,
                },
                onClick: disabled
                  ? undefined
                  : () => {
                      openDeleteRequest({ sessionId, displayTitle })
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

        ctx.slots.inject(OVERLAY_SLOT, () =>
          ctx.slots.register(
            { name: OVERLAY_SLOT, id: 'delete-session.confirm', locale: LOCALE_NAMESPACE },
            DeleteSessionConfirm,
          ),
        )
      },
    }
  },
})
