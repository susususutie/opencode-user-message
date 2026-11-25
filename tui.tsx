/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { SessionMessageUser } from "@opencode/client"
import type { Renderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js"
import { mockNodes } from "./mock"
import {
  fullTimeLabel,
  groupMessages,
  isUserMessage,
  timeLabel,
  toNode,
  type UserMessageNode,
} from "./timeline"

// 调试时改成 true，用 mock.ts 的数据查看不同时间段的真实展示效果。
const MOCK = false // 调试时改成 true

/** 会话消息分页的运行时能力；公开插件类型暂未列出，按可选处理。 */
interface MessagePager {
  loadMore?: (sessionID: string, options?: { all?: boolean }) => Promise<void>
}

/**
 * 宿主 scrollbox 的最小结构。插件不能直接持有 transcript 的 ref，
 * 只能从 renderer 树里找到它并按真实滚动状态计算当前锚点。
 */
interface TranscriptScrollBox {
  readonly isDestroyed: boolean
  readonly scrollTop: number
  readonly scrollHeight: number
  readonly viewport: {
    readonly y: number
    readonly width: number
    readonly height: number
    on(event: "resize", handler: () => void): void
    off(event: "resize", handler: () => void): void
  }
  readonly content: {
    on(event: "resize", handler: () => void): void
    off(event: "resize", handler: () => void): void
  }
  readonly verticalScrollBar: {
    on(event: "change", handler: () => void): void
    off(event: "change", handler: () => void): void
  }
  getChildren(): Renderable[]
}

function isTranscriptScrollBox(node: Renderable): node is Renderable & TranscriptScrollBox {
  const candidate = node as unknown as Partial<TranscriptScrollBox>
  return (
    typeof candidate.scrollTop === "number" &&
    typeof candidate.scrollHeight === "number" &&
    typeof (node as unknown as { scrollTo?: unknown }).scrollTo === "function" &&
    !!candidate.viewport &&
    typeof candidate.viewport.y === "number" &&
    typeof candidate.viewport.width === "number" &&
    typeof candidate.viewport.height === "number" &&
    !!candidate.verticalScrollBar &&
    typeof candidate.verticalScrollBar.on === "function" &&
    !!candidate.content &&
    typeof candidate.content.on === "function"
  )
}

/** 用户消息行 id 就是消息 id；纯附件消息的 part 行 id 形如 session-part:<id>:<part>。 */
function rowMessageID(child: Renderable, userIDs: Set<string>) {
  const id = child.id
  if (!id) return undefined
  if (userIDs.has(id)) return id
  const prefix = "session-part:"
  if (!id.startsWith(prefix)) return undefined
  const rest = id.slice(prefix.length)
  const messageID = rest.slice(0, rest.indexOf(":"))
  return userIDs.has(messageID) ? messageID : undefined
}

function isTranscriptRow(child: Renderable, userIDs: Set<string>) {
  const id = child.id
  return !!id && (id.startsWith("session-part:") || userIDs.has(id))
}

function containsTranscriptRow(node: Renderable, userIDs: Set<string>, depth = 0): boolean {
  for (const child of node.getChildren()) {
    if (isTranscriptRow(child, userIDs)) return true
    if (depth < 2 && containsTranscriptRow(child, userIDs, depth + 1)) return true
  }
  return false
}

function findTranscriptScrollBox(root: Renderable, userIDs: Set<string>): TranscriptScrollBox | undefined {
  const pending = [root]
  let best: TranscriptScrollBox | undefined
  let bestArea = -1
  while (pending.length > 0) {
    const node = pending.pop()!
    if (node.isDestroyed) continue
    if (isTranscriptScrollBox(node) && containsTranscriptRow(node, userIDs)) {
      const area = node.viewport.width * node.viewport.height
      if (area > bestArea) {
        best = node
        bestArea = area
      }
    }
    pending.push(...node.getChildren())
  }
  return best
}

function currentMessageID(
  box: TranscriptScrollBox,
  userIDs: Set<string>,
  ordered: readonly UserMessageNode[],
) {
  const top = box.viewport.y
  const bottom = top + box.viewport.height
  let above: string | undefined
  let below: string | undefined
  for (const child of box.getChildren()) {
    if (child.isDestroyed || child.height <= 0) continue
    const id = rowMessageID(child, userIDs)
    if (!id) continue
    if (child.y <= top + 1) above = id
    else if (!below && child.y < bottom) below = id
  }
  if (above) return above
  if (below) return below
  // 最新一轮的回复很长时，用户消息行可能已被虚拟化滚出画面；停在底部就高亮最后一条。
  const atBottom = box.scrollTop + box.viewport.height >= box.scrollHeight - 1
  return atBottom ? (ordered.at(-1)?.id ?? "") : ""
}

export function UserMessageSidebar(props: { context: Plugin.Context; sessionID: string; mock?: boolean }) {
  const theme = props.context.theme
  const [view, updateView] = props.context.storage.store("view", { initial: { open: true } })
  const [order, updateOrder] = props.context.storage.store("order", { initial: { newest: false } })
  const [pool, setPool] = createSignal<Map<string, UserMessageNode>>(new Map())
  const [current, setCurrent] = createSignal("")
  const useMock = () => props.mock ?? MOCK

  const realNodes = createMemo(() =>
    [...pool().values()].sort((a, b) => a.created - b.created || a.id.localeCompare(b.id)),
  )
  const realIDs = createMemo(() => new Set(realNodes().map((node) => node.id)))
  // MOCK 只影响展示，真实数据和滚动锚点始终按会话计算。
  const nodes = createMemo(() => (useMock() ? mockNodes(Date.now()) : realNodes()))
  const newest = createMemo(() => order.newest !== false)
  // shortcut: 分组在消息变化时计算，TUI 跨零点长开时日期标签要等下一条消息才刷新
  const groups = createMemo(() => groupMessages(nodes(), Date.now(), newest() ? "newest" : "oldest"))

  const hostUsers = (sessionID: string) => {
    try {
      return (props.context.data.session.message.list(sessionID) ?? []).filter(isUserMessage)
    } catch {
      return [] as SessionMessageUser[]
    }
  }

  const mergeNodes = (updates: readonly UserMessageNode[]) => {
    setPool((previous) => {
      let next: Map<string, UserMessageNode> | undefined
      for (const node of updates) {
        const existing = previous.get(node.id)
        if (
          existing &&
          existing.created === node.created &&
          existing.summary === node.summary &&
          existing.navigable === node.navigable
        ) {
          continue
        }
        next ??= new Map(previous)
        next.set(node.id, node)
      }
      return next ?? previous
    })
  }

  let generation = 0
  let fetching = false
  let queued = false
  let controller: AbortController | undefined
  let lastLocalCount = 0

  const mergeLocal = (sessionID: string, detectDrop = true) => {
    const users = hostUsers(sessionID)
    const dropped = detectDrop && users.length < lastLocalCount
    lastLocalCount = users.length
    mergeNodes(users.map(toNode))
    if (dropped) void fetchAll(sessionID)
  }

  const fetchPage = async (sessionID: string, cursor: string | undefined, signal: AbortSignal) => {
    const base = cursor
      ? { sessionID, limit: 200, cursor }
      : { sessionID, limit: 200, order: "desc" as const }
    try {
      // 当前 API 支持只取用户消息；旧宿主不认识 type 时退回全量并在本地过滤。
      return await props.context.client.message.list({ ...base, type: "user" as const }, { signal })
    } catch (error) {
      if (signal.aborted) return undefined
      return props.context.client.message.list(base, { signal }).catch(() => undefined)
    }
  }

  async function fetchAll(sessionID: string) {
    if (fetching) {
      queued = true
      return
    }
    fetching = true
    const mine = ++generation
    controller = new AbortController()
    const signal = controller.signal
    const collected = new Map<string, UserMessageNode>()
    const seen = new Set<string>()
    let cursor: string | undefined
    let complete = false
    try {
      for (let page = 0; page < 100; page++) {
        const response = await fetchPage(sessionID, cursor, signal)
        if (!response) break
        let fresh = 0
        for (const message of response.data) {
          if (!isUserMessage(message) || seen.has(message.id)) continue
          seen.add(message.id)
          fresh++
          collected.set(message.id, toNode(message))
        }
        const next = response.cursor.next ?? undefined
        if (!next) {
          complete = true
          break
        }
        if (fresh === 0) break
        cursor = next
      }
      if (mine !== generation || props.sessionID !== sessionID) return
      if (complete) {
        setPool(new Map(collected))
        mergeLocal(sessionID, false)
      } else if (collected.size > 0) {
        mergeNodes([...collected.values()])
      }
    } finally {
      if (mine === generation) {
        fetching = false
        if (queued) {
          queued = false
          void fetchAll(sessionID)
        }
      }
    }
  }

  // ---- 滚动定位高亮：从 renderer 树里找到 transcript scrollbox，订阅真实滚动状态 ----

  let attached: TranscriptScrollBox | undefined
  let detachListeners: (() => void) | undefined
  let findTimer: ReturnType<typeof setTimeout> | undefined
  let updateTimer: ReturnType<typeof setTimeout> | undefined
  let findAttempts = 0

  const detachScroll = () => {
    detachListeners?.()
    detachListeners = undefined
    attached = undefined
  }

  const updateCurrent = () => {
    if (useMock()) {
      setCurrent("")
      return
    }
    if (!attached || attached.isDestroyed) {
      detachScroll()
      attachScroll()
      return
    }
    const ids = realIDs()
    if (ids.size === 0) {
      setCurrent("")
      return
    }
    setCurrent(currentMessageID(attached, ids, realNodes()))
  }

  const scheduleUpdate = () => {
    if (updateTimer) return
    updateTimer = setTimeout(() => {
      updateTimer = undefined
      updateCurrent()
    }, 16)
  }

  const scheduleFind = () => {
    if (findTimer) return
    findTimer = setTimeout(() => {
      findTimer = undefined
      if (findAttempts++ > 50) return
      attachScroll()
    }, 200)
  }

  function attachScroll() {
    if (attached) return
    const ids = realIDs()
    if (ids.size === 0) return
    const box = findTranscriptScrollBox(props.context.renderer.root, ids)
    if (!box) {
      scheduleFind()
      return
    }
    attached = box
    const handler = scheduleUpdate
    box.verticalScrollBar.on("change", handler)
    box.viewport.on("resize", handler)
    box.content.on("resize", handler)
    detachListeners = () => {
      box.verticalScrollBar.off("change", handler)
      box.viewport.off("resize", handler)
      box.content.off("resize", handler)
    }
    scheduleUpdate()
  }

  const reset = (sessionID: string) => {
    generation++
    controller?.abort()
    controller = undefined
    fetching = false
    queued = false
    lastLocalCount = 0
    detachScroll()
    setPool(new Map())
    setCurrent("")
    mergeLocal(sessionID, false)
    void fetchAll(sessionID)
  }

  createEffect(() => {
    const sessionID = props.sessionID
    untrack(() => reset(sessionID))
  })

  const stop = props.context.data.listen(({ details }) => {
    const type = details?.type
    if (typeof type !== "string" || !type.startsWith("session.")) return
    if (type.startsWith("session.revert.")) {
      void fetchAll(props.sessionID)
      return
    }
    mergeLocal(props.sessionID)
  })

  createEffect(() => {
    realIDs()
    untrack(() => {
      findAttempts = 0
      if (!attached || attached.isDestroyed) {
        detachScroll()
        attachScroll()
      }
    })
  })

  const toggle = () => {
    if (nodes().length <= 2) return
    void updateView((draft) => {
      draft.open = !draft.open
    }).catch((error) => console.error("Failed to persist User Message sidebar state", error))
  }

  const toggleOrder = () => {
    const next = !newest()
    void updateOrder((draft) => {
      draft.newest = next
    }).catch((error) => console.error("Failed to persist user message order", error))
    props.context.ui.toast.show({
      message: next ? "Newest first · labels above" : "Oldest first · labels below",
    })
  }

  let jumping = false

  const waitForRow = (id: string, timeout = 5000) =>
    new Promise<boolean>((resolve) => {
      const deadline = Date.now() + timeout
      const tick = () => {
        try {
          if (props.context.renderer.root.findDescendantById(id)) return resolve(true)
        } catch { }
        if (Date.now() >= deadline) return resolve(false)
        setTimeout(tick, 16)
      }
      tick()
    })

  const warn = (message: string) => {
    props.context.ui.toast.show({ message, variant: "warning" })
  }

  const jump = async (node: UserMessageNode) => {
    if (useMock() || jumping) return
    jumping = true
    const sessionID = props.sessionID
    try {
      let hosts = hostUsers(sessionID)
      if (!hosts.some((message) => message.id === node.id)) {
        const pager = props.context.data.session.message as unknown as MessagePager
        if (!pager.loadMore) {
          warn("This message is not loaded in the transcript yet")
          return
        }
        for (let attempt = 0; attempt < 3 && !hosts.some((message) => message.id === node.id); attempt++) {
          try {
            await pager.loadMore(sessionID, { all: true })
          } catch {
            break
          }
          if (props.sessionID !== sessionID) return
          hosts = hostUsers(sessionID)
        }
      }
      if (props.sessionID !== sessionID) return
      if (!hosts.some((message) => message.id === node.id)) {
        warn("This message could not be loaded")
        return
      }
      const targets = hosts.filter((message) => message.text.trim().length > 0)
      const index = hosts.findIndex((message) => message.id === node.id)
      if (index < 0) return
      const steps = hosts.slice(index + 1).filter((message) => message.text.trim().length > 0).length
      const landing = targets[targets.length - 1 - steps]
      if (!landing) {
        warn("This message has no text to anchor to")
        return
      }
      props.context.keymap.dispatch("session.messages_last_user")
      if (!(await waitForRow(landing.id))) {
        warn("The transcript row is not ready to jump to")
        return
      }
      if (props.sessionID !== sessionID) return
      for (let step = 0; step < steps; step++) {
        props.context.keymap.dispatch("session.message.user.previous")
      }
      setCurrent(landing.id)
    } catch (error) {
      warn(error instanceof Error ? error.message : "Unable to jump to this message")
    } finally {
      jumping = false
    }
  }

  onCleanup(() => {
    stop()
    controller?.abort()
    detachScroll()
    if (findTimer) clearTimeout(findTimer)
    if (updateTimer) clearTimeout(updateTimer)
  })

  return (
    <Show when={nodes().length > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={toggle}>
          <Show when={nodes().length > 2}>
            <text fg={theme.text.base}>{view.open ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme.text.base}>
            <b>User Message</b>
            <Show when={!view.open || nodes().length > 9}>
              <span style={{ fg: theme.text.muted }}> ({nodes().length})</span>
            </Show>
          </text>
          <box flexGrow={1} />
          <Show when={view.open && nodes().length > 2}>
            <text
              flexShrink={0}
              fg={theme.text.muted}
              onMouseDown={(event) => {
                event.stopPropagation()
                toggleOrder()
              }}
            >
              {newest() ? "↓" : "↑"}
            </text>
          </Show>
        </box>
        <Show when={nodes().length <= 2 || view.open}>
          <For each={groups()}>
            {(group) => (
              <box>
                <Show when={groups().length > 1 && newest() && !group.today}>
                  <box flexDirection="row" gap={1} minWidth={0}>
                    <text flexShrink={0} fg={theme.text.faint}>
                      ──
                    </text>
                    <text fg={theme.text.muted} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
                      {group.label}
                    </text>
                  </box>
                </Show>
                <For each={group.nodes}>
                  {(node) => (
                    <box flexDirection="row" gap={1} minWidth={0} onMouseUp={() => void jump(node)}>
                      <text
                        flexShrink={0}
                        fg={current() === node.id ? theme.text.feedback.success.base : theme.text.muted}
                      >
                        •
                      </text>
                      <text
                        fg={current() === node.id ? theme.text.feedback.success.base : theme.text.base}
                        wrapMode="none"
                        truncate
                        flexGrow={1}
                        flexShrink={1}
                        minWidth={0}
                      >
                        <Show when={current() === node.id} fallback={node.summary}>
                          <b>{node.summary}</b>
                        </Show>
                      </text>
                      <text
                        fg={current() === node.id ? theme.text.feedback.success.base : theme.text.muted}
                        wrapMode="none"
                        flexShrink={0}
                      >
                        {group.old ? fullTimeLabel(node.created) : timeLabel(node.created)}
                      </text>
                    </box>
                  )}
                </For>
                <Show when={groups().length > 1 && !newest() && !group.today}>
                  <box flexDirection="row" gap={1} minWidth={0}>
                    <text flexShrink={0} fg={theme.text.faint}>
                      ──
                    </text>
                    <text fg={theme.text.muted} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
                      {group.label}
                    </text>
                  </box>
                </Show>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "user-message",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <UserMessageSidebar context={context} sessionID={props.sessionID} />,
    })
  },
})
