export async function loadCards() {
  const res = await fetch('/api/cards')
  if (!res.ok) throw new Error(`加载失败: ${res.status}`)
  return res.json()
}

export async function saveCards(cards) {
  await fetch('/api/cards', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cards }),
  })
}

export function saveCardsBeacon(cards) {
  const blob = new Blob([JSON.stringify({ cards })], { type: 'application/json' })
  navigator.sendBeacon('/api/cards', blob)
}

export async function uploadFile(file) {
  const res = await fetch(`/api/upload?name=${encodeURIComponent(file.name || '')}`, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!res.ok) throw new Error(`上传失败: ${res.status}`)
  return res.json()
}
