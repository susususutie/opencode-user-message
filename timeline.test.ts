import { describe, expect, test } from "bun:test"
import { summary, timestamp, toNode } from "./timeline"

const local = (year: number, month: number, day: number, hour = 12, minute = 0) =>
  new Date(year, month - 1, day, hour, minute, 0, 0).getTime()

describe("summary", () => {
  test("uses the first non-empty line and collapses whitespace", () => {
    expect(summary("\n  first   line \n second line")).toBe("first line")
  })

  test("falls back to attachments and empty messages", () => {
    expect(summary("", 2)).toBe("[attachment ×2]")
    expect(summary("   ")).toBe("(empty message)")
  })
})

describe("message nodes", () => {
  test("keeps only the fields the sidebar needs", () => {
    const created = local(2026, 11, 25, 9, 5)
    expect(
      toNode({
        id: "msg_1",
        type: "user",
        text: "  first line\nsecond",
        files: [],
        time: { created },
      }),
    ).toEqual({ id: "msg_1", created, summary: "first line", navigable: true })
  })

  test("attachment-only messages are not navigable", () => {
    expect(
      toNode({
        id: "msg_2",
        type: "user",
        text: " ",
        files: [{ mime: "image/png" } as never, { mime: "image/png" } as never],
        time: { created: local(2026, 11, 25) },
      }),
    ).toMatchObject({ summary: "[attachment ×2]", navigable: false })
  })
})

describe("timestamps", () => {
  test("shows time only for today and MM-DD HH:mm for other days", () => {
    const now = local(2026, 11, 25, 15, 30)
    expect(timestamp(local(2026, 11, 25, 9, 5), now)).toBe("09:05")
    expect(timestamp(local(2026, 11, 24, 23, 59), now)).toBe("11-24 23:59")
  })

  test("pads month, day, hour and minute", () => {
    expect(timestamp(local(2026, 1, 5, 9, 5), local(2026, 11, 25))).toBe("01-05 09:05")
  })

  test("treats the same month and day in another year as a different day", () => {
    expect(timestamp(local(2025, 11, 25, 9, 5), local(2026, 11, 25, 9, 5))).toBe("11-25 09:05")
  })
})
