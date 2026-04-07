// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import httpProxy from 'http-proxy'
import { WebSocketServer, type WebSocket } from 'ws'
import type { HexManifest, ManifestEntry } from './Manifest.ts'
import type { DictManager } from '../codec/dictionary/DictManager.ts'
import type { HexCodec } from '../codec/HexCodec.ts'

export interface HexIdPayload {
  hexId: string
  file: string
  line: number
  tagName: string
  className: string
}

export interface DevServerOptions {
  targetPort?: number       // if set, proxy this port. If not, serve files directly.
  hexPort: number
  serveDir?: string         // directory to serve static files from (when no targetPort)
  manifest: HexManifest
  dict: DictManager
  codec: HexCodec
  onPrompt: (hexIds: HexIdPayload[], prompt: string) => void
}

export class HexDevServer {
  private server: http.Server | null = null
  private proxy: httpProxy | null = null
  private wss: WebSocketServer | null = null
  private clients = new Set<WebSocket>()

  constructor(private opts: DevServerOptions) {}

  start(): void {
    const overlayDir = path.join(import.meta.dir, 'overlay')
    const isProxyMode = !!this.opts.targetPort
    const serveDir = this.opts.serveDir ?? process.cwd()

    if (isProxyMode) {
      this.proxy = httpProxy.createProxy({
        target: `http://localhost:${this.opts.targetPort}`,
      })
    }

    const MIME: Record<string, string> = {
      '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
      '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
    }

    this.server = http.createServer((req, res) => {
      const url = req.url ?? '/'

      // Serve overlay assets
      if (url === '/_hex/inspector.css') {
        res.setHeader('content-type', 'text/css')
        res.end(fs.readFileSync(path.join(overlayDir, 'inspector.css'), 'utf8'))
        return
      }
      if (url === '/_hex/inspector.js') {
        res.setHeader('content-type', 'application/javascript')
        res.end(fs.readFileSync(path.join(overlayDir, 'inspector.js'), 'utf8'))
        return
      }

      if (isProxyMode) {
        // Proxy mode: forward to target server
        if (req.headers.accept?.includes('text/html')) {
          this.proxyWithInjection(req, res)
        } else {
          this.proxy!.web(req, res, {}, () => {
            res.writeHead(502)
            res.end('Proxy error')
          })
        }
      } else {
        // Static file mode: serve files directly with overlay injection
        let filePath = path.join(serveDir, url === '/' ? 'index.html' : url)

        // If path is a directory, serve index.html from it
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, 'index.html')
        }

        if (!fs.existsSync(filePath)) {
          res.writeHead(404)
          res.end('Not found')
          return
        }

        const ext = path.extname(filePath)
        const contentType = MIME[ext] ?? 'application/octet-stream'
        let content = fs.readFileSync(filePath)

        // Inject overlay into HTML files
        if (ext === '.html' || ext === '.htm') {
          let html = content.toString('utf8')
          html = this.injectOverlay(html, url)
          res.setHeader('content-type', 'text/html')
          res.end(html)
          return
        }

        res.setHeader('content-type', contentType)
        res.end(content)
      }
    })

    this.wss = new WebSocketServer({ server: this.server })
    this.wss.on('connection', (ws) => {
      this.clients.add(ws)
      ws.on('close', () => this.clients.delete(ws))
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString())
          if (msg.type === 'prompt') {
            this.opts.onPrompt(msg.hexIds, msg.prompt)
          }
        } catch { /* invalid message */ }
      })
    })

    this.server.listen(this.opts.hexPort, () => {
      const mode = isProxyMode ? `proxying :${this.opts.targetPort}` : `serving ${serveDir}`
      console.log(`\u2B21 Hex Inspector: http://localhost:${this.opts.hexPort} (${mode})`)
    })
  }

  broadcast(msg: object): void {
    const json = JSON.stringify(msg)
    for (const client of this.clients) {
      try { client.send(json) } catch { /* client disconnected */ }
    }
  }

  private proxyWithInjection(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.proxy!.web(req, res, { selfHandleResponse: true })

    // Use once to avoid listener leak
    this.proxy!.once('proxyRes', (proxyResponse) => {
      const contentType = proxyResponse.headers['content-type'] ?? ''

      if (!contentType.includes('text/html')) {
        res.writeHead(proxyResponse.statusCode ?? 200, proxyResponse.headers)
        proxyResponse.pipe(res)
        return
      }

      const bodyChunks: Buffer[] = []
      proxyResponse.on('data', (chunk: Buffer) => bodyChunks.push(chunk))
      proxyResponse.on('end', () => {
        let html = Buffer.concat(bodyChunks).toString('utf8')
        html = this.injectOverlay(html, req.url)
        const headers = { ...proxyResponse.headers }
        headers['content-length'] = String(Buffer.byteLength(html))
        delete headers['content-encoding']
        res.writeHead(proxyResponse.statusCode ?? 200, headers)
        res.end(html)
      })
    })
  }

  private injectOverlay(html: string, reqPath?: string): string {
    const cssTag = '<link rel="stylesheet" href="/_hex/inspector.css">'
    const jsTag = `<script src="/_hex/inspector.js" data-hex-ws="${this.opts.hexPort}"></script>`

    // Inject data-hex-file and data-hex-line on every HTML element at serve time
    const fileName = reqPath === '/' || !reqPath ? 'index.html' : reqPath.replace(/^\//, '')
    let lineNum = 0
    html = html.replace(/\n/g, () => { lineNum++; return '\n' })

    // Reset and inject line numbers into opening tags
    lineNum = 0
    const lines = html.split('\n')
    const tagPattern = /(<(?:div|section|nav|header|footer|main|aside|article|p|span|h[1-6]|ul|ol|li|button|a|input|form|table|tr|td|th|img|label|select|textarea))([\s>])/gi
    const injected = lines.map((line, i) => {
      return line.replace(tagPattern, (match, tag, after) => {
        if (match.includes('data-hex-file')) return match
        return `${tag} data-hex-file="${fileName}" data-hex-line="${i + 1}"${after}`
      })
    }).join('\n')

    return injected
      .replace('</head>', `${cssTag}\n</head>`)
      .replace('</body>', `${jsTag}\n</body>`)
  }

  stop(): void {
    this.server?.close()
    this.wss?.close()
  }
}
