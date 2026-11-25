import { describe, expect, test } from "bun:test"
import {
  dateLabel,
  daysAgo,
  fullTimeLabel,
  groupMessages,
  summary,
  timeLabel,
  toNode,
  type UserMessageNode,
} from "./timeline"

const local = (year: number, month: number, day: number, hour = 12, minute = 0) =>
  new Date(year, month - 1, day, hour, minute, 0, 0).getTime()

const node = (id: string, created: number, text = "hello"): UserMessageNode => ({
  id,
  created,
  summary: summary(text),
  navigable: text.trim().length > 0,
})

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

describe("time grouping", () => {
  test("formats 24 hour time and DD/MM dates with zero padding", () => {
    const created = local(2026, 11, 5, 9, 5)
    expect(dateLabel(created)).toBe("05/11")
    expect(timeLabel(created)).toBe("09:05")
    expect(fullTimeLabel(created)).toBe("05/11 09:05")
  })

  test("counts calendar days across the seven day boundary", () => {
    const now = local(2026, 11, 25)
    expect(daysAgo(now, local(2026, 11, 18, 23, 59))).toBe(7)
    expect(daysAgo(now, local(2026, 11, 17, 23, 59))).toBe(8)
  })

  test("keeps one day as a single group", () => {
    const now = local(2026, 11, 25)
    const groups = groupMessages([node("a", local(2026, 11, 25, 9)), node("b", local(2026, 11, 25, 10))], now)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.label).toBe("25/11")
    expect(groups[0]?.old).toBe(false)
    expect(groups[0]?.today).toBe(true)
    expect(groups[0]?.nodes.map((item) => item.id)).toEqual(["a", "b"])
  })

  test("groups recent days by date and older messages into one bucket, newest first", () => {
    const now = local(2026, 11, 25)
    const groups = groupMessages(
      [
        node("oldest", local(2026, 11, 1)),
        node("old", local(2026, 11, 17, 23, 59)),
        node("seven", local(2026, 11, 18, 8)),
        node("today", local(2026, 11, 25, 10)),
        node("later", local(2026, 11, 25, 11)),
      ],
      now,
      "newest",
    )

    expect(groups.map((group) => group.label)).toEqual(["25/11", "18/11", "7 days ago"])
    expect(groups[0]?.today).toBe(true)
    expect(groups[0]?.nodes.map((item) => item.id)).toEqual(["later", "today"])
    expect(groups[1]?.nodes.map((item) => item.id)).toEqual(["seven"])
    expect(groups[2]?.old).toBe(true)
    expect(groups[2]?.nodes.map((item) => item.id)).toEqual(["old", "oldest"])
    expect(timeLabel(groups[0]!.nodes[0]!.created)).toBe("11:00")
    expect(fullTimeLabel(groups[2]!.nodes[0]!.created)).toBe("17/11 23:59")
  })

  test("reverses groups and rows for oldest first", () => {
    const now = local(2026, 11, 25)
    const groups = groupMessages(
      [
        node("oldest", local(2026, 11, 1)),
        node("old", local(2026, 11, 17, 23, 59)),
        node("seven", local(2026, 11, 18, 8)),
        node("today", local(2026, 11, 25, 10)),
        node("later", local(2026, 11, 25, 11)),
      ],
      now,
      "oldest",
    )

    expect(groups.map((group) => group.label)).toEqual(["7 days ago", "18/11", "25/11"])
    expect(groups[0]?.old).toBe(true)
    expect(groups[0]?.nodes.map((item) => item.id)).toEqual(["oldest", "old"])
    expect(groups[2]?.today).toBe(true)
    expect(groups[2]?.nodes.map((item) => item.id)).toEqual(["today", "later"])
  })
})
