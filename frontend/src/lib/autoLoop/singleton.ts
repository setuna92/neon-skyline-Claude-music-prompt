import { AutoLoopOrchestrator } from './orchestrator'

// AutoLoopPanel はタブ切り替えでアンマウント/再マウントされるが、Auto-Loopは
// バックグラウンドで動き続けるべきものなので、コンポーネントのライフサイクルとは
// 切り離したモジュールレベルのシングルトンとして保持する。
let instance: AutoLoopOrchestrator | null = null

export function getAutoLoopOrchestrator(): AutoLoopOrchestrator {
  if (!instance) {
    instance = new AutoLoopOrchestrator()
  }
  return instance
}
