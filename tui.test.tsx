/** @jsxImportSource @opentui/solid */
import { expect, setSystemTime, test } from "bun:test"
import { RGBA } from "@opentui/core"
import type { SessionMessageUser } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { testRender } from "@opentui/solid"
import { createStore, produce } from "solid-js/store"
import { UserMessageSidebar } from "./tui"
import { timestamp } from "./timeline"

const color = RGBA.fromInts(220, 220, 220)

function message(id: string, created: number, text: string): SessionMessageUser {
  return { id, type: "user", text, time: { created } }
}

function context(messages: SessionMessageUser[], open = true, newest = false) {
  const [view, setView] = createStore({ open })
  const [order, setOrder] = createStore({ newest })
  const updateView = (mutation: (draft: { open: boolean }) => void) => {
    setView(produce(mutation))
    return Promise.resolve()
  }
  const updateOrder = (mutation: (draft: { newest: boolean }) => void) => {
    setOrder(produce(mutation))
    return Promise.resolve()
  }
  return {
    theme: {
      text: { base: color, muted: color, faint: color, feedback: { success: { base: color } } },
      hue: { accent: { 200: color } },
    },
    storage: {
      store: (key: string) => (key === "order" ? [order, updateOrder] : [view, updateView]),
    },
    data: {
      session: {
        message: {
          list: () => messages,
        },
      },
      listen: () => () => {},
    },
    client: {
      message: {
        list: async () => ({ data: messages, cursor: {} }),
      },
    },
    renderer: {
      root: { isDestroyed: false, getChildren: () => [] },
    },
    ui: {
      toast: { show: () => {} },
    },
  } as unknown as Plugin.Context
}

async function render(messages: SessionMessageUser[], open = true, newest = false) {
  const app = await testRender(
    () => <UserMessageSidebar context={context(messages, open, newest)} sessionID="session" mock={false} />,
    {
      width: 42,
      height: 40,
    },
  )
  await app.renderOnce()
  return app
}

const today = (hour: number, minute: number) => {
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  return date.getTime()
}

const datePart = (created: number) => {
  const date = new Date(created)
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

/** 捕获宿主的会话事件回调，让测试能在追加消息后主动触发增量合并。 */
function liveContext(messages: SessionMessageUser[]) {
  const base = context(messages)
  let listener: ((event: { details?: { type?: string } }) => void) | undefined
  const ctx = {
    ...base,
    data: {
      ...base.data,
      listen: (handler: (event: { details?: { type?: string } }) => void) => {
        listener = handler
        return () => {}
      },
    },
  } as unknown as Plugin.Context
  return {
    ctx,
    push: (message: SessionMessageUser) => {
      messages.push(message)
      listener?.({ details: { type: "session.message.created" } })
    },
  }
}

test("renders user messages without a count while expanded and small", async () => {
  const app = await render([message("a", today(9, 12), "first question"), message("b", today(10, 23), "second")])

  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("User Message")
    expect(frame).not.toContain("User Message (2)")
    expect(frame).toContain("first question")
    expect(frame).toContain("09:12")
    expect(frame).toContain("second")
    expect(frame).toContain("10:23")
  } finally {
    app.renderer.destroy()
  }
})

test("shows the count while expanded when there are more than nine messages", async () => {
  const messages = Array.from({ length: 10 }, (_, index) =>
    message(`m${index}`, today(9, index), `question ${index + 1}`),
  )
  const app = await render(messages)

  try {
    expect(app.captureCharFrame()).toContain("User Message (10)")
  } finally {
    app.renderer.destroy()
  }
})

test("shows the count while collapsed", async () => {
  const app = await render(
    [
      message("a", today(9, 12), "first question"),
      message("b", today(10, 23), "second"),
      message("c", today(11, 5), "third"),
    ],
    false,
  )

  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("User Message (3)")
    expect(frame).not.toContain("first question")
  } finally {
    app.renderer.destroy()
  }
})

test("shows time for today and a date for older messages", async () => {
  const recent = today(10, 24)
  const older = new Date()
  older.setDate(older.getDate() - 2)
  older.setHours(8, 30, 0, 0)
  const app = await render([message("old", older.getTime(), "older question"), message("new", recent, "recent question")])

  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain(timestamp(older.getTime(), Date.now()))
    expect(frame).toContain("10:24")
    expect(frame).not.toContain(`${datePart(recent)} 10:24`)
    expect(frame).not.toContain("──")
  } finally {
    app.renderer.destroy()
  }
})

test("toggles the order from the title arrow", async () => {
  const latest = today(10, 24)
  const middle = new Date()
  middle.setDate(middle.getDate() - 2)
  middle.setHours(9, 15, 0, 0)
  const oldest = new Date()
  oldest.setDate(oldest.getDate() - 9)
  oldest.setHours(8, 30, 0, 0)
  const app = await render([
    message("latest", latest, "LATEST"),
    message("middle", middle.getTime(), "MIDDLE"),
    message("oldest", oldest.getTime(), "OLDEST"),
  ])

  try {
    let frame = app.captureCharFrame()
    expect(frame).toContain("↓")
    expect(frame.indexOf("OLDEST")).toBeLessThan(frame.indexOf("LATEST"))

    // 点击箭头左侧的留白，验证扩大的点击区域也能切换顺序。
    await app.mockMouse.click(39, 0)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await app.renderOnce()
    frame = app.captureCharFrame()
    expect(frame).toContain("↑")
    expect(frame.indexOf("LATEST")).toBeLessThan(frame.indexOf("OLDEST"))
  } finally {
    app.renderer.destroy()
  }
})

test("refreshes today labels when a new message arrives after midnight", async () => {
  const messages = [message("before", new Date(2026, 10, 25, 23, 50).getTime(), "before midnight")]
  const { ctx, push } = liveContext(messages)

  setSystemTime(new Date(2026, 10, 25, 23, 55))
  const app = await testRender(() => <UserMessageSidebar context={ctx} sessionID="session" mock={false} />, {
    width: 42,
    height: 20,
  })

  try {
    await app.renderOnce()
    let frame = app.captureCharFrame()
    expect(frame).toContain("23:50")
    expect(frame).not.toContain("11-25 23:50")

    setSystemTime(new Date(2026, 10, 26, 0, 5))
    push(message("after", new Date(2026, 10, 26, 0, 1).getTime(), "after midnight"))
    await new Promise((resolve) => setTimeout(resolve, 20))
    await app.renderOnce()

    frame = app.captureCharFrame()
    expect(frame).toContain("11-25 23:50")
    expect(frame).toContain("00:01")
  } finally {
    app.renderer.destroy()
    setSystemTime()
  }
})
