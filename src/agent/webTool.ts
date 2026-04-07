// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

export interface WebFetchResult {
  url: string
  status: number
  title: string
  text: string
  truncated: boolean
}

export interface WebSearchResult {
  query: string
  results: Array<{ title: string; url: string; snippet: string }>
}

function stripHtml(html: string): string {
  // Remove script/style blocks entirely
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '')
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '')
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '')
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '')

  // Replace block elements with newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, '\n')
  text = text.replace(/<br\s*\/?>/gi, '\n')

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, ' ')

  // Decode common entities
  text = text.replace(/&amp;/g, '&')
  text = text.replace(/&lt;/g, '<')
  text = text.replace(/&gt;/g, '>')
  text = text.replace(/&quot;/g, '"')
  text = text.replace(/&#39;/g, "'")
  text = text.replace(/&nbsp;/g, ' ')

  // Clean whitespace
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match?.[1]?.trim() ?? ''
}

export async function webFetch(url: string, maxChars = 15000): Promise<WebFetchResult> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'HexCLI/0.1 (AI coding agent)',
      'Accept': 'text/html,application/json,text/plain',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
  })

  const contentType = response.headers.get('content-type') ?? ''
  const raw = await response.text()

  let text: string
  if (contentType.includes('application/json')) {
    try {
      text = JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      text = raw
    }
  } else if (contentType.includes('text/html')) {
    text = stripHtml(raw)
  } else {
    text = raw
  }

  const truncated = text.length > maxChars
  if (truncated) {
    text = text.slice(0, maxChars) + '\n\n[truncated]'
  }

  return {
    url,
    status: response.status,
    title: extractTitle(raw),
    text,
    truncated,
  }
}

export async function webSearch(query: string, maxResults = 5): Promise<WebSearchResult> {
  // Use DuckDuckGo HTML search (no API key needed)
  const encoded = encodeURIComponent(query)
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
    headers: {
      'User-Agent': 'HexCLI/0.1 (AI coding agent)',
    },
    signal: AbortSignal.timeout(10000),
  })

  const html = await response.text()
  const results: Array<{ title: string; url: string; snippet: string }> = []

  // Parse DuckDuckGo HTML results
  const resultBlocks = html.match(/<a class="result__a"[\s\S]*?<\/a>[\s\S]*?<a class="result__snippet"[\s\S]*?<\/a>/gi) ?? []

  for (const block of resultBlocks.slice(0, maxResults)) {
    const titleMatch = block.match(/<a class="result__a"[^>]*>([\s\S]*?)<\/a>/i)
    const urlMatch = block.match(/href="([^"]*?)"/i)
    const snippetMatch = block.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)

    if (titleMatch && urlMatch) {
      let url = urlMatch[1] ?? ''
      // DuckDuckGo wraps URLs in a redirect
      const uddg = url.match(/uddg=([^&]+)/)
      if (uddg) url = decodeURIComponent(uddg[1] ?? '')

      results.push({
        title: stripHtml(titleMatch[1] ?? ''),
        url,
        snippet: stripHtml(snippetMatch?.[1] ?? ''),
      })
    }
  }

  return { query, results }
}

// Tool executor for the agent
export async function executeWebTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case 'web_fetch': {
      const url = input['url'] as string
      if (!url) return 'ERROR: url is required'
      try {
        const result = await webFetch(url)
        return `[${result.status}] ${result.title}\n\n${result.text}`
      } catch (err) {
        return `ERROR: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'web_search': {
      const query = input['query'] as string
      if (!query) return 'ERROR: query is required'
      try {
        const result = await webSearch(query)
        if (result.results.length === 0) return 'No results found.'
        return result.results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
          .join('\n\n')
      } catch (err) {
        return `ERROR: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    default:
      return `ERROR: Unknown web tool: ${name}`
  }
}
