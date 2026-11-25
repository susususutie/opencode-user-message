import type { SessionMessageInfo, SessionMessageUser } from "@opencode/client"

/** 侧栏只保留渲染和定位所需的字段，不复制完整消息与附件数据。 */
export interface UserMessageNode {
  readonly id: string
  readonly created: number
  readonly summary: string
  /** 宿主导航只认非空文本，纯附件消息无法成为落点。 */
  readonly navigable: boolean
}

/** 一个日期分组的显示数据。old 表示“7 天以前”合并组，today 表示本地当天。 */
export interface MessageGroup {
  readonly key: string
  readonly label: string
  readonly old: boolean
  readonly today: boolean
  readonly nodes: UserMessageNode[]
}

export type MessageOrder = "newest" | "oldest"

const DAY = 86_400_000

export function pad(value: number) {
  return value.toString().padStart(2, "0")
}

function startOfDay(created: number) {
  const date = new Date(created)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** 按本地自然日计算相差天数；DST 用 round 吸收 23/25 小时的一天。 */
export function daysAgo(now: number, created: number) {
  return Math.round((startOfDay(now) - startOfDay(created)) / DAY)
}

export function dateKey(created: number) {
  const date = new Date(created)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 日期分隔行使用 DD/MM。 */
export function dateLabel(created: number) {
  const date = new Date(created)
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`
}

/** 当天消息只显示 24 小时制时分。 */
export function timeLabel(created: number) {
  const date = new Date(created)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 7 天以前的合并组里每行补上日期。 */
export function fullTimeLabel(created: number) {
  return `${dateLabel(created)} ${timeLabel(created)}`
}

/** 首个非空行作为摘要；纯附件和空消息给出可读占位。 */
export function summary(text: string, files = 0) {
  const line = text
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.length > 0)
  if (line) return line.replace(/\s+/g, " ")
  if (files > 0) return `[attachment ×${files}]`
  return "(empty message)"
}

export function isUserMessage(message: SessionMessageInfo): message is SessionMessageUser {
  return message.type === "user"
}

export function toNode(message: SessionMessageUser): UserMessageNode {
  const text = message.text.trim()
  return {
    id: message.id,
    created: message.time.created,
    summary: summary(message.text, message.files?.length ?? 0),
    navigable: text.length > 0,
  }
}

/** 按指定顺序分组；7 天以前合并为单组，其余按本地自然日分组。 */
export function groupMessages(
  nodes: readonly UserMessageNode[],
  now: number,
  order: MessageOrder = "oldest",
): MessageGroup[] {
  const sorted = [...nodes].sort((a, b) =>
    order === "newest"
      ? b.created - a.created || b.id.localeCompare(a.id)
      : a.created - b.created || a.id.localeCompare(b.id),
  )
  const groups: MessageGroup[] = []
  for (const node of sorted) {
    if (daysAgo(now, node.created) > 7) {
      const last = groups.at(-1)
      if (last?.old) last.nodes.push(node)
      else groups.push({ key: "old", label: "7 days ago", old: true, today: false, nodes: [node] })
      continue
    }
    const key = dateKey(node.created)
    const last = groups.at(-1)
    if (last && !last.old && last.key === key) last.nodes.push(node)
    else
      groups.push({
        key,
        label: dateLabel(node.created),
        old: false,
        today: daysAgo(now, node.created) === 0,
        nodes: [node],
      })
  }
  return groups
}
