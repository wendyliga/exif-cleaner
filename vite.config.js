import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const DEFAULT_SITE_URL = 'https://exif-cleaner.wendyliga.com/'

function normalizeSiteUrl(value) {
  try {
    const url = new URL(value || DEFAULT_SITE_URL)
    url.pathname = url.pathname.replace(/\/?$/, '/')
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return DEFAULT_SITE_URL
  }
}

function siteMetadataPlugin() {
  return {
    name: 'site-metadata',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const siteUrl = normalizeSiteUrl(process.env.VITE_SITE_URL)
        const siteDomain = new URL(siteUrl).hostname
        const ogImageUrl = new URL('og-image.png', siteUrl).toString()

        return html
          .replaceAll('__SITE_URL__', siteUrl)
          .replaceAll('__SITE_DOMAIN__', siteDomain)
          .replaceAll('__OG_IMAGE_URL__', ogImageUrl)
      },
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [siteMetadataPlugin(), react()],
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
})
