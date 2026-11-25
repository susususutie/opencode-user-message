import { expect, test } from "bun:test"
import { mockNodes } from "./mock"
import { groupMessages } from "./timeline"

test("mock data covers recent days, the seven day edge and the old bucket", () => {
  const now = new Date(2026, 10, 25, 12, 0, 0, 0).getTime()
  const nodes = mockNodes(now)

  expect(nodes.length).toBeGreaterThan(9)
  expect(nodes.every((node, index) => index === 0 || nodes[index - 1]!.created <= node.created)).toBe(true)

  const groups = groupMessages(nodes, now)
  expect(groups[0]?.old).toBe(true)
  expect(groups[0]?.label).toBe("7 days ago")
  expect(groups.at(-1)?.today).toBe(true)
  expect(groups.length).toBeGreaterThan(4)
  expect(groups.some((group) => !group.old && group.label === "18/11")).toBe(true)

  const newestFirst = groupMessages(nodes, now, "newest")
  expect(newestFirst[0]?.today).toBe(true)
  expect(newestFirst.at(-1)?.old).toBe(true)

  expect(nodes.some((node) => node.summary === "[attachment ×2]")).toBe(true)
  expect(nodes.some((node) => node.summary === "(empty message)")).toBe(true)
  expect(nodes.some((node) => node.summary.startsWith("第一行摘要"))).toBe(true)
})
