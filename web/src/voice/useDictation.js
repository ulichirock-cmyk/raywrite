import { computed, ref, shallowRef } from 'vue'
import { useVoiceInput, voiceSupported } from './useVoiceInput'
import { useRecorderInput } from './useRecorderInput'
import { settings } from '../settingsStore'

// 听写统一入口：两个引擎二选一——浏览器内置识别（有实时转写，Chrome/Edge 独占）
// 或 录音 + 云端 ASR（哪儿都能跑，Electron 主要靠它）。按设置选，auto 时看环境：
// Electron 壳（preload 注入 window.agentText）里内置识别没有语音服务，直接走云端。
export function useDictation() {
  const speech = useVoiceInput()
  const recorder = useRecorderInput()
  const active = shallowRef(null)
  const localError = ref('')
  const isElectron = typeof window !== 'undefined' && Boolean(window.agentText)

  function pick() {
    if (settings.voiceEngine === 'browser') return speech
    if (settings.voiceEngine === 'api') return recorder
    return voiceSupported && !isElectron ? speech : recorder
  }

  function start(lang) {
    localError.value = ''
    let eng = pick()
    if (eng === speech && !voiceSupported) {
      if (settings.voiceEngine === 'browser') {
        localError.value = '此浏览器没有内置语音识别，请在设置里改用「云端 API」引擎，或换 Chrome/Edge'
        return
      }
      eng = recorder
    }
    active.value = eng
    eng.start(lang)
  }

  return {
    recording: computed(() => Boolean(active.value?.recording.value)),
    // busy = 录音已停、云端转写还在路上（内置识别引擎没有这个阶段）
    busy: computed(() => Boolean(active.value?.busy?.value)),
    interim: computed(() => active.value?.interim.value || ''),
    finals: computed(() => active.value?.finals.value || ''),
    error: computed(() => localError.value || active.value?.error.value || ''),
    start,
    stop: () => active.value?.stop() ?? Promise.resolve(''),
    cancel: () => active.value?.cancel(),
  }
}
