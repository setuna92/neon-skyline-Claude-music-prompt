import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // LAN HTTPS(自己署名証明書)はスマホでのPWA動作確認用のオプトイン設定。
  // 既定はプレーンHTTP(自動プレビュー/自分のブラウザどちらでも証明書警告なしで開ける)。
  // スマホ確認時は `npm run dev -- --mode lan-https` で有効化する。
  // (環境変数ではなくVite CLIのmode引数を使うのは、cmd.exe経由でset連結した
  //  環境変数が子プロセスに渡らない環境があったため、より確実なこちらに統一している)
  const useHttps = mode === 'lan-https'

  return {
    server: {
      ...(useHttps
        ? {
            https: {
              key: fs.readFileSync('./新しいフォルダー/192.168.11.9-key.pem'),
              cert: fs.readFileSync('./新しいフォルダー/192.168.11.9.pem'),
            },
          }
        : {}),
      host: true,
      port: process.env.PORT ? Number(process.env.PORT) : 5173,
    },

    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      hookTimeout: 5000,
      testTimeout: 5000,
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'AI音楽プロンプトジェネレーター',
          short_name: '音楽プロンプト',
          description: 'キーワードから音楽生成AI向けプロンプトを自動生成するローカルファーストPWA',
          theme_color: '#0a0e27',
          background_color: '#0a0e27',
          display: 'standalone',
          start_url: '/',
          lang: 'ja',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
        },
      }),
    ],
  }
})
