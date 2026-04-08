// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli
(function() {
  'use strict'

  var hoveredEl = null
  var selectedEls = new Set()
  var ws = null
  var wsReady = false
  var inspecting = true

  // ===== DEVTOOLS CAPTURE =====
  var devtools = {
    console: [],    // { level, args, ts }
    network: [],    // { method, url, status, duration, size, ts }
    errors: [],     // { message, stack, ts }
    performance: {} // { memory, timing, entries }
  }
  var MAX_ENTRIES = 50

  // Console capture
  var origConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  }

  function captureConsole(level) {
    return function() {
      var args = Array.from(arguments).map(function(a) {
        try { return typeof a === 'object' ? JSON.stringify(a, null, 0).slice(0, 200) : String(a) }
        catch(e) { return String(a) }
      })
      devtools.console.push({ level: level, args: args.join(' '), ts: Date.now() })
      if (devtools.console.length > MAX_ENTRIES) devtools.console.shift()
      origConsole[level].apply(console, arguments)
    }
  }
  console.log = captureConsole('log')
  console.warn = captureConsole('warn')
  console.error = captureConsole('error')
  console.info = captureConsole('info')
  console.debug = captureConsole('debug')

  // Error capture
  window.addEventListener('error', function(e) {
    devtools.errors.push({
      message: e.message,
      stack: e.error ? e.error.stack?.slice(0, 300) : '',
      file: e.filename,
      line: e.lineno,
      col: e.colno,
      ts: Date.now()
    })
    if (devtools.errors.length > MAX_ENTRIES) devtools.errors.shift()
  })

  window.addEventListener('unhandledrejection', function(e) {
    devtools.errors.push({
      message: 'Unhandled Promise: ' + (e.reason?.message || String(e.reason)).slice(0, 200),
      stack: e.reason?.stack?.slice(0, 300) || '',
      ts: Date.now()
    })
    if (devtools.errors.length > MAX_ENTRIES) devtools.errors.shift()
  })

  // Network capture — wrap fetch
  var origFetch = window.fetch
  window.fetch = function(url, opts) {
    var method = (opts && opts.method) ? opts.method : 'GET'
    var reqUrl = typeof url === 'string' ? url : url.url
    var start = Date.now()

    return origFetch.apply(window, arguments).then(function(response) {
      var entry = {
        method: method,
        url: reqUrl.slice(0, 200),
        status: response.status,
        statusText: response.statusText,
        duration: Date.now() - start,
        ts: start
      }
      devtools.network.push(entry)
      if (devtools.network.length > MAX_ENTRIES) devtools.network.shift()
      return response
    }).catch(function(err) {
      devtools.network.push({
        method: method,
        url: reqUrl.slice(0, 200),
        status: 0,
        statusText: 'FAILED: ' + err.message,
        duration: Date.now() - start,
        ts: start
      })
      if (devtools.network.length > MAX_ENTRIES) devtools.network.shift()
      throw err
    })
  }

  // Network capture — wrap XMLHttpRequest
  var origXHROpen = XMLHttpRequest.prototype.open
  var origXHRSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function(method, url) {
    this._hex = { method: method, url: String(url).slice(0, 200), start: 0 }
    return origXHROpen.apply(this, arguments)
  }
  XMLHttpRequest.prototype.send = function() {
    if (this._hex) {
      this._hex.start = Date.now()
      var self = this
      this.addEventListener('loadend', function() {
        devtools.network.push({
          method: self._hex.method,
          url: self._hex.url,
          status: self.status,
          statusText: self.statusText,
          duration: Date.now() - self._hex.start,
          ts: self._hex.start
        })
        if (devtools.network.length > MAX_ENTRIES) devtools.network.shift()
      })
    }
    return origXHRSend.apply(this, arguments)
  }

  // Performance snapshot
  function getPerformanceSnapshot() {
    var perf = {}
    // Memory (Chrome only)
    if (performance.memory) {
      perf.memory = {
        usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
        totalMB: Math.round(performance.memory.totalJSHeapSize / 1048576),
        limitMB: Math.round(performance.memory.jsHeapSizeLimit / 1048576),
      }
    }
    // Page load timing
    var nav = performance.getEntriesByType('navigation')[0]
    if (nav) {
      perf.pageLoad = {
        domReady: Math.round(nav.domContentLoadedEventEnd),
        loadComplete: Math.round(nav.loadEventEnd),
        ttfb: Math.round(nav.responseStart - nav.requestStart),
      }
    }
    // Slow resources (>500ms)
    var resources = performance.getEntriesByType('resource')
    perf.slowResources = resources
      .filter(function(r) { return r.duration > 500 })
      .map(function(r) { return { name: r.name.split('/').pop(), duration: Math.round(r.duration), type: r.initiatorType } })
      .slice(0, 10)

    return perf
  }

  // Get devtools summary for AI context
  function getDevtoolsSummary() {
    devtools.performance = getPerformanceSnapshot()
    var parts = []

    if (devtools.errors.length > 0) {
      parts.push('ERRORS (' + devtools.errors.length + '):')
      devtools.errors.slice(-5).forEach(function(e) {
        parts.push('  ' + e.message + (e.file ? ' at ' + e.file + ':' + e.line : ''))
      })
    }

    if (devtools.console.length > 0) {
      var warns = devtools.console.filter(function(c) { return c.level === 'warn' || c.level === 'error' })
      if (warns.length > 0) {
        parts.push('CONSOLE WARNINGS (' + warns.length + '):')
        warns.slice(-5).forEach(function(c) { parts.push('  [' + c.level + '] ' + c.args.slice(0, 150)) })
      }
      parts.push('Console: ' + devtools.console.length + ' entries (' +
        devtools.console.filter(function(c) { return c.level === 'log' }).length + ' log, ' +
        warns.length + ' warn/error)')
    }

    if (devtools.network.length > 0) {
      var failed = devtools.network.filter(function(n) { return n.status >= 400 || n.status === 0 })
      if (failed.length > 0) {
        parts.push('FAILED REQUESTS:')
        failed.slice(-5).forEach(function(n) { parts.push('  ' + n.method + ' ' + n.url + ' → ' + n.status) })
      }
      parts.push('Network: ' + devtools.network.length + ' requests, ' + failed.length + ' failed')
    }

    var perf = devtools.performance
    if (perf.memory) parts.push('Memory: ' + perf.memory.usedMB + 'MB / ' + perf.memory.limitMB + 'MB')
    if (perf.pageLoad) parts.push('Page load: ' + perf.pageLoad.loadComplete + 'ms, TTFB: ' + perf.pageLoad.ttfb + 'ms')
    if (perf.slowResources && perf.slowResources.length > 0) {
      parts.push('Slow resources:')
      perf.slowResources.forEach(function(r) { parts.push('  ' + r.name + ' ' + r.duration + 'ms') })
    }

    return parts.length > 0 ? parts.join('\n') : 'No issues detected.'
  }

  function getSelector(el) {
    if (el.id) return '#' + el.id
    var parts = []
    while (el && el !== document.body && el !== document.documentElement) {
      var tag = el.tagName.toLowerCase()
      if (el.id) { parts.unshift('#' + el.id); break }
      var cls = el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().replace(/\s+/g, '.').replace(/hex-hover|hex-selected/g, '').replace(/\.+/g, '.').replace(/^\.|\.$/, '')
        : ''
      parts.unshift(tag + cls)
      el = el.parentElement
    }
    return parts.join(' > ')
  }

  // --- WebSocket ---
  function connect() {
    // Connect to the same host/port the page was loaded from
    var wsUrl = 'ws://' + location.host
    try {
      ws = new WebSocket(wsUrl)
    } catch(e) {
      setTimeout(connect, 2000)
      return
    }
    ws.onopen = function() {
      wsReady = true
      updateToggle()
    }
    ws.onclose = function() {
      wsReady = false
      updateToggle()
      setTimeout(connect, 2000)
    }
    ws.onerror = function() {
      wsReady = false
      updateToggle()
    }
    ws.onmessage = function(e) {
      try {
        var msg = JSON.parse(e.data)
        if (msg.type === 'agent-token') {
          if (msg.text === '\n\u2713 Done') { endStream(); addMessage('system', 'done') }
          else appendStream(msg.text)
        }
        if (msg.type === 'reload') {
          addMessage('system', 'reloading...')
          setTimeout(function() { location.reload() }, 500)
        }
      } catch(err) {}
    }
  }
  connect()

  // --- Styles ---
  var style = document.createElement('style')
  style.textContent = [
    '.hex-hover{outline:2px solid rgba(234,179,8,0.7)!important;outline-offset:2px}',
    '.hex-selected{outline:2px solid rgba(234,179,8,1)!important;outline-offset:2px;background:rgba(234,179,8,0.05)!important}',
    '#hex-label{position:fixed;background:rgba(234,179,8,0.9);color:#000;padding:2px 8px;border-radius:4px;font:11px monospace;pointer-events:none;z-index:99999;display:none}',
    // Draggable terminal panel
    '#hex-panel{position:fixed;bottom:16px;right:16px;width:420px;max-height:400px;background:#0f0f0f;border:1px solid rgba(234,179,8,0.3);border-radius:8px;z-index:99998;font:13px monospace;color:#ccc;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.5);overflow:hidden;resize:both;min-width:300px;min-height:200px}',
    '#hex-panel.collapsed{max-height:36px;min-height:36px;resize:none;overflow:hidden}',
    '#hex-titlebar{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#1a1a1a;cursor:move;user-select:none;flex-shrink:0;border-bottom:1px solid rgba(234,179,8,0.15)}',
    '#hex-titlebar span{color:#eab308;font-weight:700;font-size:13px}',
    '#hex-titlebar-btns{display:flex;gap:6px}',
    '#hex-titlebar-btns button{background:none;border:none;color:#666;cursor:pointer;font:12px monospace;padding:0 4px}',
    '#hex-titlebar-btns button:hover{color:#eab308}',
    '#hex-devtools{padding:6px 10px;border-top:1px solid rgba(234,179,8,0.1);font-size:11px;color:#777;max-height:80px;overflow-y:auto;flex-shrink:0}',
    '#hex-devtools .dt-err{color:#e55}',
    '#hex-devtools .dt-warn{color:#ea3}',
    '#hex-devtools .dt-net{color:#6a6}',
    '#hex-devtools .dt-perf{color:#68a}',
    '#hex-messages{flex:1;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:4px;scrollbar-width:thin;scrollbar-color:#333 transparent}',
    '#hex-messages::-webkit-scrollbar{width:4px}',
    '#hex-messages::-webkit-scrollbar-thumb{background:#333;border-radius:2px}',
    '.hex-msg-user{color:#eab308;font-weight:700}',
    '.hex-msg-ai{color:#ccc;white-space:pre-wrap;word-break:break-word}',
    '.hex-msg-tool{color:#666;font-size:11px}',
    '.hex-msg-system{color:#555;font-size:11px;font-style:italic}',
    '#hex-tags{display:flex;gap:3px;flex-wrap:wrap;padding:4px 10px;border-top:1px solid rgba(234,179,8,0.1);flex-shrink:0}',
    '#hex-tags:empty{display:none}',
    '#hex-input-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border-top:1px solid rgba(234,179,8,0.15);flex-shrink:0}',
    '.hex-tag{background:rgba(234,179,8,0.1);color:#eab308;border:1px solid rgba(234,179,8,0.25);border-radius:3px;padding:0 5px;font-size:11px;cursor:pointer;white-space:nowrap}',
    '.hex-tag:hover{background:rgba(234,179,8,0.25)}',
    '#hex-input{flex:1;background:none;border:none;outline:none;color:#fff;font:13px monospace;min-width:0}',
    '#hex-send{background:#eab308;color:#000;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;font:12px/1 monospace;font-weight:700;flex-shrink:0}',
    '#hex-send:hover{background:#facc15}',
    '#hex-toggle{position:fixed;bottom:12px;right:12px;width:36px;height:36px;background:#eab308;color:#000;border:none;border-radius:50%;font:16px monospace;cursor:pointer;z-index:99997;box-shadow:0 2px 8px rgba(0,0,0,.3);transition:opacity .15s}',
  ].join('\n')
  document.head.appendChild(style)

  // --- Toggle ---
  var toggle = document.createElement('button')
  toggle.id = 'hex-toggle'
  toggle.textContent = '\u2B21'
  toggle.title = 'Hex Inspector'
  function updateToggle() {
    toggle.style.opacity = inspecting ? '1' : '0.3'
    toggle.style.background = wsReady ? '#eab308' : '#666'
  }
  toggle.onclick = function(e) {
    e.stopPropagation()
    inspecting = !inspecting
    updateToggle()
    if (!inspecting) { clearSelection(); hideLabel() }
    else showPanel()
  }
  document.body.appendChild(toggle)
  updateToggle()

  // --- Hover ---
  document.addEventListener('mouseover', function(e) {
    if (!inspecting) return
    var el = e.target
    if (el === document.body || el === document.documentElement) return
    if (selectedEls.has(el)) return
    if (isHexUI(el)) return
    if (hoveredEl) hoveredEl.classList.remove('hex-hover')
    hoveredEl = el
    el.classList.add('hex-hover')
    showLabel(el, e.clientX, e.clientY)
  })

  document.addEventListener('mouseout', function() {
    if (hoveredEl && !selectedEls.has(hoveredEl)) hoveredEl.classList.remove('hex-hover')
    hideLabel()
  })

  // --- Click to select ---
  document.addEventListener('click', function(e) {
    if (!inspecting) return
    if (isHexUI(e.target)) return

    e.preventDefault()
    e.stopPropagation()

    var el = e.target
    // Toggle selection — click to add, click again to remove
    if (selectedEls.has(el)) {
      selectedEls.delete(el)
      el.classList.remove('hex-selected')
    } else {
      selectedEls.add(el)
      el.classList.add('hex-selected')
    }
    showPanel()
  }, true)

  function isHexUI(el) {
    while (el) {
      if (el.id === 'hex-panel' || el.id === 'hex-toggle' || el.id === 'hex-label') return true
      el = el.parentElement
    }
    return false
  }

  // --- Selection ---
  function clearSelection() {
    selectedEls.forEach(function(el) { el.classList.remove('hex-selected') })
    selectedEls.clear()
    updateTags()
  }

  function clearSelectionKeepBar() {
    selectedEls.forEach(function(el) { el.classList.remove('hex-selected') })
    selectedEls.clear()
  }

  // --- Draggable Terminal Panel ---
  var panel, inputEl, tagsEl, messagesEl
  var panelCollapsed = false

  function ensurePanel() {
    if (panel) return
    panel = document.createElement('div')
    panel.id = 'hex-panel'
    panel.innerHTML =
      '<div id="hex-titlebar">' +
        '<span>\u2B21 hex</span>' +
        '<div id="hex-titlebar-btns">' +
          '<button id="hex-btn-devtools" title="Devtools">D</button>' +
          '<button id="hex-btn-clear" title="Clear">C</button>' +
          '<button id="hex-btn-collapse" title="Collapse">\u2212</button>' +
        '</div>' +
      '</div>' +
      '<div id="hex-devtools" style="display:none"></div>' +
      '<div id="hex-messages"></div>' +
      '<div id="hex-tags"></div>' +
      '<div id="hex-input-row">' +
        '<input id="hex-input" placeholder="describe the change..." />' +
        '<button id="hex-send">\u2192</button>' +
      '</div>'
    document.body.appendChild(panel)

    inputEl = document.getElementById('hex-input')
    tagsEl = document.getElementById('hex-tags')
    messagesEl = document.getElementById('hex-messages')

    // Drag
    var titlebar = document.getElementById('hex-titlebar')
    var dragging = false, dx = 0, dy = 0
    titlebar.addEventListener('mousedown', function(e) {
      if (e.target.tagName === 'BUTTON') return
      dragging = true
      dx = e.clientX - panel.offsetLeft
      dy = e.clientY - panel.offsetTop
      panel.style.transition = 'none'
    })
    document.addEventListener('mousemove', function(e) {
      if (!dragging) return
      panel.style.left = (e.clientX - dx) + 'px'
      panel.style.top = (e.clientY - dy) + 'px'
      panel.style.right = 'auto'
      panel.style.bottom = 'auto'
    })
    document.addEventListener('mouseup', function() { dragging = false })

    // Collapse
    document.getElementById('hex-btn-collapse').addEventListener('click', function(e) {
      e.stopPropagation()
      panelCollapsed = !panelCollapsed
      panel.classList.toggle('collapsed', panelCollapsed)
      this.textContent = panelCollapsed ? '+' : '\u2212'
    })

    // Devtools panel toggle + live update
    var dtVisible = false
    var dtEl = document.getElementById('hex-devtools')
    var dtTimer = null
    document.getElementById('hex-btn-devtools').addEventListener('click', function(e) {
      e.stopPropagation()
      dtVisible = !dtVisible
      dtEl.style.display = dtVisible ? 'block' : 'none'
      if (dtVisible) {
        updateDevtoolsPanel()
        dtTimer = setInterval(updateDevtoolsPanel, 2000)
      } else if (dtTimer) {
        clearInterval(dtTimer)
      }
    })

    function updateDevtoolsPanel() {
      var perf = getPerformanceSnapshot()
      var html = ''
      if (devtools.errors.length > 0) {
        html += '<div class="dt-err">\u2717 ' + devtools.errors.length + ' errors</div>'
        devtools.errors.slice(-3).forEach(function(e) {
          html += '<div class="dt-err" style="padding-left:8px">' + e.message.slice(0, 80) + '</div>'
        })
      }
      var warns = devtools.console.filter(function(c) { return c.level === 'warn' || c.level === 'error' })
      html += '<div class="dt-warn">' + devtools.console.length + ' console, ' + warns.length + ' warn</div>'
      var failed = devtools.network.filter(function(n) { return n.status >= 400 || n.status === 0 })
      html += '<div class="dt-net">' + devtools.network.length + ' requests, ' + failed.length + ' failed</div>'
      if (perf.memory) html += '<div class="dt-perf">Mem: ' + perf.memory.usedMB + '/' + perf.memory.limitMB + 'MB</div>'
      if (perf.pageLoad) html += '<div class="dt-perf">Load: ' + perf.pageLoad.loadComplete + 'ms</div>'
      dtEl.innerHTML = html
    }

    // Clear messages
    document.getElementById('hex-btn-clear').addEventListener('click', function(e) {
      e.stopPropagation()
      messagesEl.innerHTML = ''
    })

    // Input events
    inputEl.addEventListener('keydown', function(e) {
      e.stopPropagation()
      if (e.key === 'Enter') { e.preventDefault(); doSend() }
      if (e.key === 'Escape') clearSelection()
    })
    inputEl.addEventListener('keyup', function(e) { e.stopPropagation() })
    inputEl.addEventListener('keypress', function(e) { e.stopPropagation() })

    document.getElementById('hex-send').addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation(); doSend()
    })

    addMessage('system', 'Click elements to select, then describe the change.')
  }

  function addMessage(type, text) {
    ensurePanel()
    var div = document.createElement('div')
    div.className = 'hex-msg-' + type
    if (type === 'user') div.textContent = '> ' + text
    else if (type === 'tool') div.textContent = '\u2713 ' + text
    else div.textContent = text
    messagesEl.appendChild(div)
    messagesEl.scrollTop = messagesEl.scrollHeight
    return div
  }

  // Streaming message that can be appended to
  var streamDiv = null
  function startStream() {
    streamDiv = addMessage('ai', '')
  }
  function appendStream(text) {
    if (!streamDiv) startStream()
    streamDiv.textContent += text
    messagesEl.scrollTop = messagesEl.scrollHeight
  }
  function endStream() { streamDiv = null }

  function showPanel() {
    ensurePanel()
    if (panelCollapsed) {
      panelCollapsed = false
      panel.classList.remove('collapsed')
      document.getElementById('hex-btn-collapse').textContent = '\u2212'
    }
    updateTags()
    setTimeout(function() { inputEl.focus() }, 50)
  }

  function updateTags() {
    if (!tagsEl) return
    tagsEl.innerHTML = ''
    selectedEls.forEach(function(el) {
      var t = document.createElement('span')
      t.className = 'hex-tag'
      var name = el.tagName.toLowerCase()
      if (el.id) name += '#' + el.id
      else if (el.className && typeof el.className === 'string') {
        var c = el.className.replace(/hex-\S+/g, '').trim().split(/\s+/)[0]
        if (c) name += '.' + c
      }
      t.textContent = name
      t.onclick = function(ev) {
        ev.stopPropagation()
        selectedEls.delete(el); el.classList.remove('hex-selected')
        updateTags()
      }
      tagsEl.appendChild(t)
    })
  }

  // --- Send ---
  function doSend() {
    var prompt = inputEl.value.trim()
    if (!prompt) return

    if (!wsReady) { addMessage('system', 'Not connected to hex.'); return }

    var hexIds = []
    selectedEls.forEach(function(el) {
      hexIds.push({
        hexId: getSelector(el),
        tagName: el.tagName.toLowerCase(),
        className: (el.className || '').toString().replace(/hex-\S+/g, '').trim(),
        text: (el.textContent || '').slice(0, 80).trim(),
        outerHTML: el.outerHTML.replace(/\s*data-hex-\w+="[^"]*"/g, '').slice(0, 300),
        file: el.getAttribute('data-hex-file') || '',
        line: parseInt(el.getAttribute('data-hex-line') || '0'),
      })
    })

    addMessage('user', prompt)

    try {
      ws.send(JSON.stringify({
        type: 'prompt',
        hexIds: hexIds,
        prompt: prompt,
        devtools: getDevtoolsSummary(),
      }))
      inputEl.value = ''
      startStream()
    } catch(e) {
      addMessage('system', 'Send failed: ' + e.message)
    }
  }

  // --- Label ---
  function showLabel(el, x, y) {
    var label = document.getElementById('hex-label')
    if (!label) { label = document.createElement('div'); label.id = 'hex-label'; document.body.appendChild(label) }
    var tag = el.tagName.toLowerCase()
    var id = el.id ? '#' + el.id : ''
    var cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.replace(/hex-\S+/g, '').trim().split(/\s+/).slice(0,2).join('.')
      : ''
    var hexFile = el.getAttribute('data-hex-file')
    var hexLine = el.getAttribute('data-hex-line')
    var loc = hexFile ? '  ' + hexFile + ':' + hexLine : '  ' + el.offsetWidth + '\u00D7' + el.offsetHeight
    label.textContent = tag + id + cls + loc
    label.style.left = Math.min(x + 12, window.innerWidth - 250) + 'px'
    label.style.top = (y - 28) + 'px'
    label.style.display = 'block'
  }

  function hideLabel() {
    var l = document.getElementById('hex-label')
    if (l) l.style.display = 'none'
  }

  function showToast(text) {
    var t = document.createElement('div')
    t.style.cssText = 'position:fixed;top:12px;right:12px;background:rgba(15,15,15,.95);color:#fff;padding:8px 16px;border-radius:6px;font:13px monospace;z-index:99999;border:1px solid rgba(234,179,8,.4);max-width:350px'
    t.textContent = text
    document.body.appendChild(t)
    setTimeout(function() { t.remove() }, 3500)
  }
})()
