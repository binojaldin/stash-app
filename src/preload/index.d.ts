import type { StashAPI } from './index'

declare global {
  interface Window {
    api: StashAPI
  }
}
