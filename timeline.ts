import type { SessionMessageInfo, SessionMessageUser } from "@opencode/client"

/** 侧栏只保留渲染和定位所需的字段，不复制完整消息与附件数据。 */
export interface UserMessageNode {
  readonly id: string
  readonly created: number
  readonly summary: string
  /** 宿主导航只认非空文本，纯附件消息无法成为落点。 */
  readonly navigable: boolean
}

export function pad(value: number) {
  return value.toString().padStart(2, "0")
}

/** 当天只显示时分，其他日期补上 MM-DD；now 由侧栏在新增消息时刷新。 */
export function timestamp(created: number, now: number) {
  const date = new Date(created)
  const current = new Date(now)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const today =
    date.getFullYear() === current.getFullYear() &&
    date.getMonth() === current.getMonth() &&
    date.getDate() === current.getDate()
  return today ? time : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`
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
