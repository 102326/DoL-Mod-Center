/* DoLModCenter 1.0 - bounded, DOM-only README renderer. */
(function (root) {
  'use strict';

  var MAX_INPUT = 256 * 1024;
  var MAX_LINES = 4000;
  var MAX_NODES = 12000;
  var MAX_DEPTH = 24;

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

  function inline(parent, source, state, depth) {
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
      if (source[i] === '`') {
        var codeEnd = paired('`', '`');
        if (codeEnd >= 0) { flush(); var code = add(parent, 'code', source.slice(i + 1, codeEnd), 'dmc-md-inline-code', state); i = codeEnd + 1; continue; }
      }
      if (source.slice(i, i + 2) === '![') {
        var imageEnd = source.indexOf(']', i + 2);
        var imageClose = imageEnd >= 0 && source[imageEnd + 1] === '(' ? source.indexOf(')', imageEnd + 2) : -1;
        if (imageClose > imageEnd) {
          flush();
          add(parent, 'span', '[图片: ' + source.slice(i + 2, imageEnd) + ']', 'dmc-md-image-placeholder', state);
          i = imageClose + 1;
          continue;
        }
      }
      if (source[i] === '[') {
        var linkEnd = source.indexOf(']', i + 1);
        var linkClose = linkEnd >= 0 && source[linkEnd + 1] === '(' ? source.indexOf(')', linkEnd + 2) : -1;
        if (linkClose > linkEnd) {
          flush();
          var link = add(parent, 'span', source.slice(i + 1, linkEnd), 'dmc-md-link', state);
          if (link) text(link, ' (' + source.slice(linkEnd + 2, linkClose) + ')', state);
          i = linkClose + 1;
          continue;
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
            if (styled) inline(styled, source.slice(i + mark[0].length, markEnd), state, depth + 1);
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

  function render(container, source) {
    if (!container || !container.ownerDocument) throw new TypeError('container must be a DOM element');
    var input = String(source == null ? '' : source);
    var truncated = input.length > MAX_INPUT;
    if (truncated) input = input.slice(0, MAX_INPUT);
    var lines = input.replace(/\r\n?/g, '\n').split('\n').slice(0, MAX_LINES);
    while (container.firstChild) container.removeChild(container.firstChild);
    var state = { nodes: 0, truncated: truncated || lines.length >= MAX_LINES };
    blocks(container, lines, state, 0);
    if (state.truncated) {
      var notice = container.ownerDocument.createElement('p');
      notice.className = 'dmc-md-truncated';
      notice.textContent = '[README 已截断]';
      container.appendChild(notice);
      state.nodes += 1;
    }
    return { nodes: state.nodes, truncated: state.truncated };
  }

  root.DMCMarkdown = { render: render, limits: { maxInput: MAX_INPUT, maxLines: MAX_LINES, maxNodes: MAX_NODES, maxDepth: MAX_DEPTH } };
}(typeof window !== 'undefined' ? window : this));
