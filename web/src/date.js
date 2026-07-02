// 本地日期 key（YYYY-MM-DD），用于日历筛选按「哪一天」分组卡片
export function dateKey(iso) {
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
