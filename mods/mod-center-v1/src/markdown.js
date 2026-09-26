/* DoLModCenter 1.0 - bounded, DOM-only README renderer. */
(function (root) {
  'use strict';

  var MAX_INPUT = 256 * 1024;
  var MAX_LINES = 4000;
  var MAX_NODES = 12000;
  var MAX_DEPTH = 24;
  var MAX_SCANS = 2000000;

  function add(parent, tag, text, className, state) {
    if (!parent || !parent.ownerDocument) { state.truncated = true; return null; }
    if (state.nodes >= MAX_NODES - 1) { state.truncated = true; return null; }
    var node = parent.ownerDocument.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    parent.appendChild(node);
    state.nodes += 1;
    return node;
  }

  function text(parent, value, state) {
    if (!value) return;
    if (!parent || !parent.ownerDocument) { state.truncated = true; return; }
    if (state.nodes >= MAX_NODES - 1) { state.truncated = true; return; }
    var node = parent.ownerDocument.createTextNode(value);
    parent.appendChild(node);
    state.nodes += 1;
  }

  function referenceKey(value) {
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function safeWebUrl(value) {
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) return '';
    try {
      var url = new URL(value);
      return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : '';
    } catch (_) { return ''; }
  }

  function closing(source, start, open, close, state) {
    var level = 0;
    for (var j = start; j < source.length; j += 1) {
      if (++state.scans > MAX_SCANS) { state.truncated = true; return -1; }
      if (source[j] === '\\') { j += 1; continue; }
      if (source[j] === open) level += 1;
      if (source[j] === close && --level === 0) return j;
    }
    return -1;
  }

  function target(source, end, references, label, state) {
    if (source[end + 1] === '(') {
      var close = closing(source, end + 1, '(', ')', state);
      if (close < 0) return null;
      var raw = source.slice(end + 2, close).trim();
      var match = raw.match(/^<([^>]+)>(?:\s+.*)?$/) || raw.match(/^(\S+?)(?:\s+[\"'][^\n]*[\"'])?$/);
      return match ? { url: match[1], end: close + 1 } : null;
    }
    if (source[end + 1] === '[') {
      var refEnd = closing(source, end + 1, '[', ']', state);
      if (refEnd < 0) return null;
      var id = source.slice(end + 2, refEnd) || label;
      return references[referenceKey(id)] ? { url: references[referenceKey(id)], end: refEnd + 1 } : null;
    }
    return references[referenceKey(label)] ? { url: references[referenceKey(label)], end: end + 1 } : null;
  }

  function image(parent, alt, url, state, inLink) {
    var caption = alt.trim() || '图片';
    var safe = safeWebUrl(url);
    if (!safe || inLink) {
      var badge = add(parent, 'span', caption, 'dmc-md-image-placeholder', state);
      if (badge) badge.title = safe ? '图片：' + safe : '包内或不支持的图片路径：' + url;
      return;
    }
    var button = add(parent, 'button', '查看图片：' + caption, 'dmc-md-image-load', state);
    if (!button) return;
    button.type = 'button';
    button.title = '点击后从外部加载图片：' + safe;
    button.addEventListener('click', function () {
      var picture = button.ownerDocument.createElement('img');
      picture.className = 'dmc-md-image';
      picture.alt = caption;
      picture.loading = 'lazy';
      picture.decoding = 'async';
      picture.referrerPolicy = 'no-referrer';
      picture.addEventListener('error', function () {
        if (picture.parentNode) picture.parentNode.replaceChild(button, picture);
        button.textContent = '图片加载失败，重试：' + caption;
      }, { once: true });
      button.parentNode.replaceChild(picture, button);
      picture.src = safe;
    });
  }

  function link(parent, label, url, state, depth) {
    var safe = safeWebUrl(url);
    var node = add(parent, safe ? 'a' : 'span', undefined, safe ? 'dmc-md-link' : 'dmc-md-local-link', state);
    if (!node) return;
    if (safe) {
      node.href = safe;
      node.target = '_blank';
      node.rel = 'noopener noreferrer nofollow';
      node.referrerPolicy = 'no-referrer';
    } else {
      node.title = '包内或不支持的链接路径：' + url;
    }
    inline(node, label, state, depth + 1, true);
  }

  function inline(parent, source, state, depth, inLink) {
    depth = depth || 0;
    if (!parent || !parent.ownerDocument) { state.truncated = true; return; }
    if (depth > MAX_DEPTH) { text(parent, source, state); state.truncated = true; return; }
    var i = 0;
    var plain = '';
    function flush() { text(parent, plain, state); plain = ''; }
    function paired(open, close) {
      var end = source.indexOf(close, i + open.length);
      return end > i + open.length ? end : -1;
    }
    while (i < source.length && state.nodes < MAX_NODES) {
      if (state.scans > MAX_SCANS) { text(parent, source.slice(i), state); break; }
      if (source[i] === '`') {
        var codeEnd = paired('`', '`');
        if (codeEnd >= 0) { flush(); var code = add(parent, 'code', source.slice(i + 1, codeEnd), 'dmc-md-inline-code', state); i = codeEnd + 1; continue; }
      }
      var isImage = source.slice(i, i + 2) === '![';
      if (isImage || source[i] === '[') {
        var open = i + (isImage ? 1 : 0);
        var end = closing(source, open, '[', ']', state);
        if (end >= 0) {
          var label = source.slice(open + 1, end);
          var destination = target(source, end, state.references, label, state);
          if (destination) {
            flush();
            if (isImage) image(parent, label, destination.url, state, inLink);
            else if (!inLink) link(parent, label, destination.url, state, depth);
            else inline(parent, label, state, depth + 1, true);
            i = destination.end;
            continue;
          }
        }
      }
      var matched = false;
      var marks = [['**', '**', 'strong'], ['__', '__', 'strong'], ['*', '*', 'em'], ['_', '_', 'em']];
      for (var m = 0; m < marks.length; m += 1) {
        var mark = marks[m];
        if (source.slice(i, i + mark[0].length) === mark[0]) {
          var markEnd = paired(mark[0], mark[1]);
          if (markEnd >= 0) {
            flush();
            var styled = add(parent, mark[2], undefined, 'dmc-md-' + mark[2], state);
            if (styled) inline(styled, source.slice(i + mark[0].length, markEnd), state, depth + 1, inLink);
            i = markEnd + mark[1].length;
            matched = true;
            break;
          }
        }
      }
      if (matched) continue;
      plain += source[i];
      i += 1;
    }
    flush();
  }

  function isBlockStart(lines, index) {
    var line = lines[index] || '';
    return /^\s*```/.test(line) || /^\s{0,3}#{1,6}\s+/.test(line) || /^\s{0,3}(?:[-*_]\s*){3,}$/.test(line) || /^\s*>/.test(line) || /^\s*[-+*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line);
  }

  function isTableStart(lines, index) {
    var line = lines[index] || '';
    return index + 1 < lines.length && line.indexOf('|') >= 0 && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
  }

  function blocks(parent, lines, state, depth) {
    depth = depth || 0;
    if (!parent || !parent.ownerDocument) { state.truncated = true; return; }
    if (depth > MAX_DEPTH) {
      var fallback = add(parent, 'p', undefined, 'dmc-md-paragraph', state);
      if (fallback) inline(fallback, lines.join('\n'), state, 0);
      state.truncated = true;
      return;
    }
    var i = 0;
    while (i < lines.length && state.nodes < MAX_NODES - 1) {
      var line = lines[i];
      if (!line.trim()) { i += 1; continue; }
      var fence = line.match(/^\s*```\s*([^\s`]*)\s*$/);
      if (fence) {
        var codeLines = []; i += 1;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { codeLines.push(lines[i]); i += 1; }
        if (i < lines.length) i += 1;
        var pre = add(parent, 'pre', undefined, 'dmc-md-code-block', state);
        if (pre) { var codeNode = add(pre, 'code', codeLines.join('\n'), fence[1] ? 'language-' + fence[1].replace(/[^A-Za-z0-9_-]/g, '') : '', state); }
        continue;
      }
      var heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) { var h = add(parent, 'h' + heading[1].length, undefined, 'dmc-md-heading', state); if (h) inline(h, heading[2], state); i += 1; continue; }
      if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)) { add(parent, 'hr', undefined, 'dmc-md-rule', state); i += 1; continue; }
      if (/^\s*>/.test(line)) {
        var quote = add(parent, 'blockquote', undefined, 'dmc-md-quote', state); var quoted = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { quoted.push(lines[i].replace(/^\s*>\s?/, '')); i += 1; }
        if (quote) blocks(quote, quoted, state, depth + 1); continue;
      }
      var ul = line.match(/^\s*[-+*]\s+(.+)$/); var ol = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (ul || ol) {
        var list = add(parent, ol ? 'ol' : 'ul', undefined, 'dmc-md-list', state);
        while (i < lines.length) {
          var item = lines[i].match(ol ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-+*]\s+(.+)$/);
          if (!item) break;
          var li = add(list, 'li', undefined, 'dmc-md-list-item', state); if (li) inline(li, item[1], state); i += 1;
        }
        continue;
      }
      if (i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1]) && line.indexOf('|') >= 0) {
        var table = add(parent, 'table', undefined, 'dmc-md-table', state); var thead = add(table, 'thead', undefined, '', state); var tr = add(thead, 'tr', undefined, '', state);
        splitCells(line).forEach(function (cell) { var th = add(tr, 'th', undefined, '', state); if (th) inline(th, cell, state); });
        var tbody = add(table, 'tbody', undefined, '', state); i += 2;
        while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim()) { var row = add(tbody, 'tr', undefined, '', state); splitCells(lines[i]).forEach(function (cell) { var td = add(row, 'td', undefined, '', state); if (td) inline(td, cell, state); }); i += 1; }
        continue;
      }
      var paragraph = [line]; i += 1;
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i) && !isTableStart(lines, i)) { paragraph.push(lines[i]); i += 1; }
      var p = add(parent, 'p', undefined, 'dmc-md-paragraph', state); if (p) inline(p, paragraph.join('\n'), state);
    }
  }

  function splitCells(line) {
    var value = line.trim();
    if (value[0] === '|') value = value.slice(1);
    if (value[value.length - 1] === '|') value = value.slice(0, -1);
    return value.split('|').map(function (cell) { return cell.trim(); });
  }

  function collectReferences(lines) {
    var references = Object.create(null);
    var visible = [];
    var fenced = false;
    var count = 0;
    lines.forEach(function (line) {
      if (/^\s*```/.test(line)) { fenced = !fenced; visible.push(line); return; }
      if (!fenced) {
        var match = line.match(/^\s{0,3}\[([^\]\n]+)\]:\s*(?:<([^>]+)>|(\S+))(?:\s+(?:\"[^\"]*\"|'[^']*'|\([^)]*\)))?\s*$/);
        if (match && count < 1024) {
          var key = referenceKey(match[1]);
          if (key && !Object.prototype.hasOwnProperty.call(references, key)) {
            references[key] = match[2] || match[3];
            count += 1;
          }
          return;
        }
      }
      visible.push(line);
    });
    return { references: references, lines: visible };
  }

  function render(container, source) {
    if (!container || !container.ownerDocument) throw new TypeError('container must be a DOM element');
    var input = String(source == null ? '' : source);
    var truncated = input.length > MAX_INPUT;
    if (truncated) input = input.slice(0, MAX_INPUT);
    var lines = input.replace(/\r\n?/g, '\n').split('\n').slice(0, MAX_LINES);
    var extracted = collectReferences(lines);
    while (container.firstChild) container.removeChild(container.firstChild);
    var state = { nodes: 0, scans: 0, truncated: truncated || lines.length >= MAX_LINES, references: extracted.references };
    blocks(container, extracted.lines, state, 0);
    if (state.truncated) {
      var notice = container.ownerDocument.createElement('p');
      notice.className = 'dmc-md-truncated';
      notice.textContent = '[README 已截断]';
      container.appendChild(notice);
      state.nodes += 1;
    }
    return { nodes: state.nodes, truncated: state.truncated };
  }

  root.DMCMarkdown = { render: render, limits: { maxInput: MAX_INPUT, maxLines: MAX_LINES, maxNodes: MAX_NODES, maxDepth: MAX_DEPTH, maxScans: MAX_SCANS } };
}(typeof window !== 'undefined' ? window : this));
