import { ref } from 'vue'

// Web Speech API 封装（每张卡片一个实例）。浏览器全局同时只允许一路识别在跑，
// 所以模块级记录当前活跃实例，新的 start 会先把旧的取消掉，避免两张卡互相打架。
let activeSession = null

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null

// 识别引擎是浏览器提供的（Chrome/Edge 走云端服务）：localhost 属于安全上下文可用；
// Firefox 没实现；Electron 壳里缺少 Google API Key 会报 network/service 错误，
// 这些都在 onerror 里翻译成人话，不在这里预判。
export const voiceSupported = Boolean(SR)

export function useVoiceInput() {
  const recording = ref(false)
  const interim = ref('')
  const finals = ref('') // 已敲定的转写累积（一次录音会话内）
  const error = ref('')

  let rec = null
  let stopping = false
  let resolveStop = null

  function cleanup() {
    if (activeSession === session) activeSession = null
    rec = null
    recording.value = false
    interim.value = ''
    const done = resolveStop
    resolveStop = null
    if (done) done(finals.value)
  }

  function translateError(code) {
    if (code === 'not-allowed' || code === 'permission-denied') return '麦克风权限被拒绝，请在浏览器地址栏允许麦克风'
    if (code === 'audio-capture') return '没有检测到麦克风'
    if (code === 'network' || code === 'service-not-allowed')
      return '当前环境不支持语音识别，请在 Chrome / Edge 浏览器中打开本页使用'
    if (code === 'language-not-supported') return '识别服务不支持所选语言'
    return `语音识别出错：${code}`
  }

  function start(lang) {
    if (!SR || recording.value) return
    if (activeSession && activeSession !== session) activeSession.cancel()
    activeSession = session
    error.value = ''
    finals.value = ''
    interim.value = ''
    stopping = false
    recording.value = true

    rec = new SR()
    rec.lang = lang || 'zh-CN'
    rec.continuous = true
    rec.interimResults = true

    rec.onresult = (e) => {
      let interimBuf = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) {
          const piece = r[0].transcript
          // 拉丁词之间补空格，中文直接拼接（识别结果本身不带尾随空格）
          if (finals.value && /[A-Za-z0-9]$/.test(finals.value) && /^[A-Za-z0-9]/.test(piece.trimStart())) {
            finals.value += ' '
          }
          finals.value += piece
        } else {
          interimBuf += r[0].transcript
        }
      }
      interim.value = interimBuf
    }

    rec.onerror = (e) => {
      // no-speech / aborted 是正常静默或主动停止，不当成错误；其余的终止会话并提示
      if (e.error === 'no-speech' || e.error === 'aborted') return
      error.value = translateError(e.error)
      stopping = true
    }

    rec.onend = () => {
      // Chrome 静默几秒会自己 end：用户没喊停就无缝重启，做成「一直听着」的体验
      if (!stopping && recording.value) {
        try {
          rec.start()
          return
        } catch {}
      }
      cleanup()
    }

    try {
      rec.start()
    } catch (e) {
      error.value = String(e?.message || e)
      cleanup()
    }
  }

  // 停止并等最后一批 final 结果落定（rec.stop() 之后还会来一次 onresult 再 onend）
  function stop() {
    if (!recording.value || !rec) return Promise.resolve(finals.value)
    stopping = true
    return new Promise((resolve) => {
      resolveStop = resolve
      try {
        rec.stop()
      } catch {
        cleanup()
      }
    })
  }

  // 丢弃本次录音（不产出文本）
  function cancel() {
    if (!rec) return
    stopping = true
    finals.value = ''
    try {
      rec.abort()
    } catch {
      cleanup()
    }
  }

  const session = { recording, interim, finals, error, start, stop, cancel, supported: voiceSupported }
  return session
}
