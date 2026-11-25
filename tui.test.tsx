/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import type { SessionMessageUser } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { testRender } from "@opentui/solid"
import { createStore, produce } from "solid-js/store"
import { UserMessageSidebar } from "./tui"
import { dateLabel, fullTimeLabel } from "./timeline"

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

test("hides the today header at the top in newest first mode", async () => {
  const recent = today(10, 24)
  const old = new Date()
  old.setDate(old.getDate() - 9)
  old.setHours(8, 30, 0, 0)
  const app = await render([message("old", old.getTime(), "very old question"), message("new", recent, "recent question")], true, true)

  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("── 7 days ago")
    expect(frame).not.toContain(`── ${dateLabel(recent)}`)
    expect(frame).toContain(fullTimeLabel(old.getTime()))
    expect(frame).toContain("10:24")
  } finally {
    app.renderer.destroy()
  }
})

test("hides the today footer at the bottom in oldest first mode", async () => {
  const recent = today(10, 24)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(9, 12, 0, 0)
  const app = await render([
    message("yesterday", yesterday.getTime(), "yesterday question"),
    message("today", recent, "today question"),
  ])

  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain(`── ${dateLabel(yesterday.getTime())}`)
    expect(frame).not.toContain(`── ${dateLabel(recent)}`)
  } finally {
    app.renderer.destroy()
  }
})

test("shows the header when the top group is not today", async () => {
  const recent = new Date()
  recent.setDate(recent.getDate() - 1)
  recent.setHours(10, 24, 0, 0)
  const old = new Date()
  old.setDate(old.getDate() - 9)
  old.setHours(8, 30, 0, 0)
  const app = await render([message("old", old.getTime(), "very old question"), message("new", recent.getTime(), "recent question")], true, true)

  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain(`── ${dateLabel(recent.getTime())}`)
    expect(frame).toContain("── 7 days ago")
  } finally {
    app.renderer.destroy()
  }
})

test("never shows a group label when there is only one group", async () => {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  date.setHours(9, 0, 0, 0)
  const app = await render([
    message("a", date.getTime(), "ONE"),
    message("b", date.getTime() + 60_000, "TWO"),
    message("c", date.getTime() + 120_000, "THREE"),
  ])

  try {
    let frame = app.captureCharFrame()
    expect(frame).toContain("↑")
    expect(frame).not.toContain(`── ${dateLabel(date.getTime())}`)

    await app.mockMouse.click(41, 0)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await app.renderOnce()
    frame = app.captureCharFrame()
    expect(frame).toContain("↓")
    expect(frame).not.toContain(`── ${dateLabel(date.getTime())}`)
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
    expect(frame).toContain("↑")
    expect(frame.indexOf("OLDEST")).toBeLessThan(frame.indexOf("LATEST"))

    await app.mockMouse.click(41, 0)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await app.renderOnce()
    frame = app.captureCharFrame()
    expect(frame).toContain("↓")
    expect(frame.indexOf("LATEST")).toBeLessThan(frame.indexOf("OLDEST"))
  } finally {
    app.renderer.destroy()
  }
})
