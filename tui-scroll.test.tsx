/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA, TextAttributes, type CapturedFrame, type ScrollBoxRenderable } from "@opentui/core"
import type { SessionMessageUser } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { testRender, useRenderer } from "@opentui/solid"
import { createStore, produce } from "solid-js/store"
import { UserMessageSidebar } from "./tui"

const base = RGBA.fromInts(200, 200, 200)
const muted = RGBA.fromInts(120, 120, 120)
const accent = RGBA.fromInts(220, 80, 80)
const success = RGBA.fromInts(80, 200, 80)

function message(id: string, created: number, text: string): SessionMessageUser {
  return { id, type: "user", text, time: { created } }
}

function context(messages: SessionMessageUser[]) {
  const [view, setView] = createStore({ open: true })
  const [order, setOrder] = createStore({ newest: true })
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
      text: { base, muted, faint: muted, feedback: { success: { base: success } } },
      hue: { accent: { 200: accent } },
    },
    storage: {
      store: (key: string) => (key === "order" ? [order, updateOrder] : [view, updateView]),
    },
    data: { session: { message: { list: () => messages } }, listen: () => () => {} },
    client: { message: { list: async () => ({ data: messages, cursor: {} }) } },
    renderer: undefined,
    ui: { toast: { show: () => {} } },
  } as unknown as Plugin.Context
}

const same = (left: RGBA, right: RGBA) =>
  left.r === right.r && left.g === right.g && left.b === right.b && left.a === right.a

const successText = (frame: CapturedFrame) =>
  frame.lines.flatMap((line) => line.spans).filter((span) => same(span.fg, success)).map((span) => span.text)

const boldText = (frame: CapturedFrame) =>
  frame.lines
    .flatMap((line) => line.spans)
    .filter((span) => (span.attributes & TextAttributes.BOLD) !== 0)
    .map((span) => span.text)

test("highlights the user message at the top of the transcript", async () => {
  const messages = [message("msg_a", Date.now(), "message a"), message("msg_b", Date.now() + 1, "message b")]
  const ctx = context(messages)
  let scroll: ScrollBoxRenderable | undefined

  const app = await testRender(
    () => {
      const renderer = useRenderer()
      ;(ctx as unknown as { renderer: unknown }).renderer = renderer
      return (
        <box flexDirection="row">
          <box width={30} height={8}>
            <scrollbox ref={(element) => (scroll = element as ScrollBoxRenderable)} width={30} height={6}>
              <box id="msg_a" height={1}>
                <text>message a</text>
              </box>
              <box height={1}>
                <text>filler 1</text>
              </box>
              <box height={1}>
                <text>filler 2</text>
              </box>
              <box height={1}>
                <text>filler 3</text>
              </box>
              <box height={1}>
                <text>filler 4</text>
              </box>
              <box height={1}>
                <text>filler 5</text>
              </box>
              <box height={1}>
                <text>filler 6</text>
              </box>
              <box id="msg_b" height={1}>
                <text>message b</text>
              </box>
              <box height={1}>
                <text>filler 7</text>
              </box>
              <box height={1}>
                <text>filler 8</text>
              </box>
              <box height={1}>
                <text>filler 9</text>
              </box>
              <box height={1}>
                <text>filler 10</text>
              </box>
              <box height={1}>
                <text>filler 11</text>
              </box>
              <box height={1}>
                <text>filler 12</text>
              </box>
            </scrollbox>
          </box>
          <box width={40}>
            <UserMessageSidebar context={ctx} sessionID="session" mock={false} />
          </box>
        </box>
      )
    },
    { width: 72, height: 12 },
  )

  try {
    await app.waitFor(() => !!scroll)
    await app.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 60))
    await app.renderOnce()
    expect(boldText(app.captureSpans()).some((text) => text.includes("message a"))).toBe(true)
    expect(successText(app.captureSpans()).filter((text) => text.includes("•"))).toHaveLength(1)

    scroll!.scrollTo(6)
    await new Promise((resolve) => setTimeout(resolve, 60))
    await app.renderOnce()
    const frame = app.captureSpans()
    expect(boldText(frame).some((text) => text.includes("message b"))).toBe(true)
    expect(boldText(frame).some((text) => text.includes("message a"))).toBe(false)
    expect(successText(frame).filter((text) => text.includes("•"))).toHaveLength(1)
  } finally {
    app.renderer.destroy()
  }
})
