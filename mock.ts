import { summary, type UserMessageNode } from "./timeline"

interface MockSpec {
  readonly daysAgo: number
  /** 仅 daysAgo 为 0 时使用：相对当前时间往前多少分钟，避免生成未来时间。 */
  readonly minutesAgo?: number
  readonly hour?: number
  readonly minute?: number
  readonly text: string
  readonly files?: number
}

/** 覆盖今天、最近几天、7 天边界和 7 天以前的各种情况。 */
const SPECS: readonly MockSpec[] = [
  { daysAgo: 0, minutesAgo: 3, text: "实际使用发现了两个问题：1. 侧栏太靠下；2. 数量显示规则不符合预期" },
  { daysAgo: 0, minutesAgo: 18, text: "继续" },
  { daysAgo: 0, minutesAgo: 42, text: "这个 OpenTUI 和 OpenCode 的版本关系是什么？" },
  { daysAgo: 0, minutesAgo: 95, text: "先看下 diff，再决定是否合并。" },
  { daysAgo: 0, minutesAgo: 180, text: "", files: 2 },
  { daysAgo: 0, minutesAgo: 260, text: "" },
  { daysAgo: 1, hour: 9, minute: 12, text: "昨天的第一条消息" },
  { daysAgo: 1, hour: 14, minute: 40, text: "昨天的第二条消息，内容稍长一些，用来看截断效果" },
  { daysAgo: 1, hour: 18, minute: 5, text: "昨天最后一条" },
  { daysAgo: 2, hour: 10, minute: 20, text: "两天前：检查 MCP 侧栏的对齐" },
  { daysAgo: 2, hour: 16, minute: 45, text: "两天前：继续调整样式" },
  { daysAgo: 3, hour: 11, minute: 5, text: "三天前：确认日期分组逻辑" },
  { daysAgo: 3, hour: 20, minute: 30, text: "第一行摘要\n第二行内容不应该出现在侧栏" },
  { daysAgo: 5, hour: 15, minute: 30, text: "五天前：测试 7 天边界" },
  { daysAgo: 7, hour: 9, minute: 25, text: "七天前：仍然按日分组" },
  { daysAgo: 7, hour: 17, minute: 10, text: "七天前的下午消息" },
  { daysAgo: 8, hour: 9, minute: 40, text: "八天前：进入 7 days ago 分组" },
  { daysAgo: 8, hour: 13, minute: 15, text: "English message to check mixed-width alignment" },
  { daysAgo: 10, hour: 10, minute: 0, text: "十天前：检查老分组里的日期显示" },
  { daysAgo: 14, hour: 16, minute: 20, text: "两周前：这条消息很长，用来检查侧栏在窄宽度下的截断效果，应该只占一行" },
  { daysAgo: 21, hour: 11, minute: 11, text: "三周前：侧栏窄宽度截断" },
  { daysAgo: 30, hour: 8, minute: 45, text: "", files: 1 },
  { daysAgo: 45, hour: 9, minute: 5, text: "四十五天前：最早的一条消息" },
]

export function mockNodes(now = Date.now()): UserMessageNode[] {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const startOfDay = start.getTime()
  const nodes = SPECS.map((spec, index) => {
    const created =
      spec.daysAgo === 0
        ? Math.max(startOfDay, now - (spec.minutesAgo ?? 0) * 60_000)
        : (() => {
            const date = new Date(now)
            date.setDate(date.getDate() - spec.daysAgo)
            date.setHours(spec.hour ?? 12, spec.minute ?? 0, 0, 0)
            return date.getTime()
          })()
    return {
      id: `mock-${index.toString().padStart(2, "0")}`,
      created,
      summary: summary(spec.text, spec.files ?? 0),
      navigable: spec.text.trim().length > 0,
    }
  })
  return nodes.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
}
