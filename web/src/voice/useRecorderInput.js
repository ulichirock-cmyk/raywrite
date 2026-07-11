import { ref } from 'vue'
import { transcribeAudio } from '../api'

// MediaRecorder 录音 → 云端 ASR 转写。给没有浏览器内置语音识别的环境用
// （Electron 壳、Firefox）：没有实时转写（interim 恒为空串），录完整段停止后
// 一次性送 /api/transcribe，busy 表示「录完了、转写还在路上」。
// 接口形状与 useVoiceInput 对齐，由 useDictation 统一调度。
export function useRecorderInput() {
  const recording = ref(false)
  const busy = ref(false)
  const interim = ref('')
  const finals = ref('')
  const error = ref('')

  let recorder = null
  let stream = null
  let chunks = []
  let discard = false

  function pickMime() {
    for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
      if (MediaRecorder.isTypeSupported(t)) return t
    }
    return ''
  }

  function releaseStream() {
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
  }

  async function start() {
    if (recording.value || busy.value) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      error.value = '当前环境不支持录音'
      return
    }
    error.value = ''
    finals.value = ''
    discard = false
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      error.value =
        e?.name === 'NotAllowedError'
          ? '麦克风权限被拒绝（Windows 需在 隐私设置→麦克风 里允许桌面应用）'
          : e?.name === 'NotFoundError'
            ? '没有检测到麦克风'
            : `无法访问麦克风：${e?.message || e}`
      return
    }
    chunks = []
    const mimeType = pickMime()
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    } catch (e) {
      error.value = `无法开始录音：${e?.message || e}`
      releaseStream()
      return
    }
    recorder.ondataavailable = (e) => {
      if (e.data?.size) chunks.push(e.data)
    }
    recorder.start(250) // 分片收集，取消时不至于攒着一个大 blob
    recording.value = true
  }

  function stop() {
    if (!recording.value || !recorder) return Promise.resolve('')
    recording.value = false
    const rec = recorder
    recorder = null
    return new Promise((resolve) => {
      rec.onstop = async () => {
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
        chunks = []
        releaseStream()
        // 容器头也占体积，太小说明基本没录到声音，别白跑一趟 API
        if (discard || blob.size < 2000) return resolve('')
        busy.value = true
        try {
          const text = (await transcribeAudio(blob)).trim()
          finals.value = text
          resolve(text)
        } catch (e) {
          console.error(e)
          error.value = `语音转写失败：${e?.message || e}`
          resolve('')
        } finally {
          busy.value = false
        }
      }
      try {
        rec.stop()
      } catch {
        releaseStream()
        resolve('')
      }
    })
  }

  function cancel() {
    discard = true
    stop()
  }

  return { recording, busy, interim, finals, error, start, stop, cancel }
}
