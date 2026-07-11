export async function loadCards() {
  const res = await fetch('/api/cards')
  if (!res.ok) throw new Error(`加载失败: ${res.status}`)
  return res.json()
}

export async function saveCards(cards) {
  const res = await fetch('/api/cards', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cards }),
  })
  if (!res.ok) throw new Error(`保存失败: ${res.status}`)
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

export async function getSettings() {
  const res = await fetch('/api/settings')
  if (!res.ok) throw new Error(`加载设置失败: ${res.status}`)
  return res.json()
}

export async function saveApiKey(deepseekApiKey) {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deepseekApiKey }),
  })
  if (!res.ok) throw new Error(`保存失败: ${res.status}`)
  return res.json()
}

export async function saveAsrApiKey(siliconflowApiKey) {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ siliconflowApiKey }),
  })
  if (!res.ok) throw new Error(`保存失败: ${res.status}`)
  return res.json()
}

export async function transcribeAudio(blob) {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'content-type': blob.type || 'audio/webm' },
    body: blob,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `转写失败: ${res.status}`)
  return data.text
}

export async function correctVoiceText(text, context = '') {
  const res = await fetch('/api/voice-correct', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, context }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `纠错失败: ${res.status}`)
  return data.text
}

export async function polishText(text) {
  const res = await fetch('/api/polish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `整理失败: ${res.status}`)
  return data.text
}
