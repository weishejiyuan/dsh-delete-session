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
    const CONTEXT_MENU_ICON_SLOT = 'contextMenu.icon'
    // The menu id and the icon key are deliberately the same string in two
    // different namespaces: the keyed icon slot only knows the latter.
    const SESSION_MENU_ID = 'session.delete'
    const SESSION_MENU_ICON_KEY = 'session.delete'
    const DELETE_ENDPOINT = '/delete-session/api/delete'
    const DANGER_TEXT_COLOR = 'var(--dsw-alias-state-error-primary)'

    const messages = {
      zh: {
        'label.deletePermanently': '永久删除',
        'confirm.title': '永久删除会话',
        'confirm.desc': '将永久删除「{title}」，此操作不可撤销。',
        'confirm.action': '永久删除',
        'confirm.pending': '正在删除…',
        cancel: '取消',
        close: '关闭',
        deleted: '会话已永久删除',
        sessionActive: '会话正在运行，请先停止',
        sessionNotFound: '会话不存在，可能已被删除',
        deleteFailed: '删除失败',
      },
      en: {
        'label.deletePermanently': 'Delete permanently',
        'confirm.title': 'Delete session permanently',
        'confirm.desc': '「{title}」 will be deleted permanently. This cannot be undone.',
        'confirm.action': 'Delete permanently',
        'confirm.pending': 'Deleting…',
        cancel: 'Cancel',
        close: 'Close',
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
        // The four pre-flight guards (METHOD_NOT_ALLOWED / REJECTED /
        // NOT_FOUND / INVALID_SESSION_ID) answer the same way on purpose: the
        // failure label plus whatever reason the Host attached, and the label
        // alone when it attached none.
        default:
          return withReason(translate('deleteFailed'), result?.message)
      }
    }

    /**
     * Reads the body only when it is a JSON object. A proxy, gateway or crash
     * page can answer with HTML instead of the endpoint's contract; parser
     * internals mean nothing to the user, so the caller reports the HTTP status
     * instead and this returns `undefined`.
     */
    async function readJsonObject(response) {
      try {
        const body = await response.json()
        return body !== null && typeof body === 'object' ? body : undefined
      } catch {
        return undefined
      }
    }

    /** Resolves to `{ ok: true }` or `{ ok: false, message }` — never rejects. */
    async function postDelete(sessionId, translate) {
      let response
      try {
        response = await fetch(DELETE_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        })
      } catch (reason) {
        return { ok: false, message: withReason(translate('deleteFailed'), messageOf(reason)) }
      }

      const result = await readJsonObject(response)
      if (result === undefined) {
        return { ok: false, message: withReason(translate('deleteFailed'), `HTTP ${response.status}`) }
      }
      if (result.ok === true && result.code === 'OK') return { ok: true, code: result.code }
      return { ok: false, code: result.code, message: failureLine(result, translate) }
    }


    /**
     * Single source of the visibility matrix: a blank row hides, a running
     * Session disables, everything else is an ordinary row. The row button and
     * the Session menu both read it, so the two entries cannot drift apart.
     *
     * `retainedBy.mainView` deliberately takes no part: the official
     * `archiveSession` only refuses active Sessions, and disabling the Session
     * open in the main view would make the last remaining Session undeletable.
     */
    function visibilityOf(row) {
      if (row === undefined || row.blank === true) {
        return { show: false, disabled: false, labelKey: 'label.deletePermanently' }
      }
      const running = row.running === true
      return {
        show: true,
        disabled: running,
        labelKey: running ? 'sessionActive' : 'label.deletePermanently',
      }
    }

    return {
      name: 'delete-session-client',
      inject: ['slots', 'locale', 'contextMenus', 'sessions'],
      apply(ctx) {
        // `effect` ties the dictionaries to the plugin's lifetime: unloading the
        // plugin revokes them instead of leaving the namespace behind.
        ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, messages), 'delete-session: locale')
        const translate = ctx.locale.bind(LOCALE_NAMESPACE)

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
              // The Host relays `api-session/removed`, so a ghost row this late is
              // already being dropped by the Session store; only report the reason.
              setFailure(outcome.message)
            })
          }

          // The dialog's body line: progress while the request is in flight,
          // the failure reason after it. Confirming clears the previous failure,
          // so the two never coexist. Progress gets its own `role="status"` line
          // (like the official archive dialog) instead of hijacking the button
          // label — the button keeps naming the action it performs.
          const bodyLine = deleting
            ? React.createElement('div', { role: 'status' }, translate('confirm.pending'))
            : failure === null
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
                    // The official dialog styles `.deleteAction:not(:disabled)`,
                    // so the danger colour must not survive into the disabled
                    // state.
                    style: deleting ? undefined : { color: DANGER_TEXT_COLOR },
                    disabled: deleting,
                    onClick: confirm,
                  },
                  translate('confirm.action'),
                ),
              ),
            },
            bodyLine,
          )
        }

        // `useSessions` is a global standard prop synthesized by the slot
        // machinery; the call stays unconditional so the hook order is fixed. A
        // host that omits it leaves the row without data — the matrix has no
        // rule for that, so the row stays an ordinary, enabled row instead of
        // crashing the sidebar or silently losing its entry.
        function DeleteSessionRowButton({ sessionId, displayTitle, t: translate, useSessions }) {
          const row = useSessions?.((sessions) => sessions.byId[sessionId]) ?? {}
          const { show, disabled, labelKey } = visibilityOf(row)

          if (!show) return null

          const label = translate(labelKey)
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

        /**
         * The second entry point: the Session menu resolves the same visibility
         * matrix as the row button. A hidden row has no directory to delete, so
         * it returns no action at all instead of a disabled one.
         */
        function resolveSessionDelete(target) {
          const row = ctx.sessions.list.getSnapshot().byId[target.sessionId]
          const { show, disabled, labelKey } = visibilityOf(row)
          if (!show) return []
          return [{
            id: 'delete',
            label: translate(labelKey),
            icon: { key: SESSION_MENU_ICON_KEY },
            danger: true,
            separatorBefore: true,
            ...(disabled ? { disabled: true } : {}),
            run: () => {
              openDeleteRequest({ sessionId: target.sessionId, displayTitle: target.displayTitle })
            },
          }]
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

        ctx.slots.inject(CONTEXT_MENU_ICON_SLOT, () =>
          ctx.slots.register(
            { name: CONTEXT_MENU_ICON_SLOT, key: SESSION_MENU_ICON_KEY },
            IconTrashOutlineRegular,
          ),
        )

        ctx.effect(() => ctx.contextMenus.register({
          id: SESSION_MENU_ID,
          target: 'session',
          order: 700,
          observe: () => [ctx.sessions.list, ctx.locale],
          resolve: resolveSessionDelete,
        }), 'delete-session: session menu')
      },
    }
  },
})
