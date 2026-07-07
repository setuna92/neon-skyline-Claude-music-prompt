import { SmartGenerationLoop } from './smartGenerationLoop'

// AutoLoopOrchestratorと同様、タブ切り替えでパネルがアンマウントされても
// バックグラウンドで動き続けるよう、モジュールレベルのシングルトンとして保持する。
let instance: SmartGenerationLoop | null = null

export function getSmartGenerationLoop(): SmartGenerationLoop {
  if (!instance) {
    instance = new SmartGenerationLoop()
  }
  return instance
}
