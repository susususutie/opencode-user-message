import { expect, test } from "bun:test"
import { mockNodes } from "./mock"
import { timestamp } from "./timeline"

test("mock data covers today, cross-day timestamps and attachment summaries", () => {
  const now = new Date(2026, 10, 25, 12, 0, 0, 0).getTime()
  const nodes = mockNodes(now)

  expect(nodes.length).toBeGreaterThan(9)
  expect(nodes.every((node, index) => index === 0 || nodes[index - 1]!.created <= node.created)).toBe(true)

  const labels = nodes.map((node) => timestamp(node.created, now))
  expect(labels.some((label) => /^\d{2}:\d{2}$/.test(label))).toBe(true)
  expect(labels.some((label) => /^\d{2}-\d{2} \d{2}:\d{2}$/.test(label))).toBe(true)

  expect(nodes.some((node) => node.summary === "[attachment ×2]")).toBe(true)
  expect(nodes.some((node) => node.summary === "(empty message)")).toBe(true)
  expect(nodes.some((node) => node.summary.startsWith("第一行摘要"))).toBe(true)
})
