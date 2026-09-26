(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DoLWorkbenchDiagnosticsCore = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_TEXT = 700;
  var MAX_ENTRIES = 1000;
  var STRUCTURED = '[结构化数据已省略]';
  var PATH = '[本地路径已省略]';
  var SECRET = '[敏感值已省略]';

  function isError(value) {
    return value instanceof Error || Object.prototype.toString.call(value) === '[object Error]';
  }

  function trimTrailingJson(text) {
    // Do not parse an unbounded console line. A JSON-looking suffix near the
    // visible diagnostic prefix is enough to identify the debug payload.
    if (text.length > 12000) {
      var largeMatch = /\s([\[{])/g;
      var large;
      while ((large = largeMatch.exec(text)) && large.index < 2000) {
        var largeStart = large.index + large[0].length - 1;
        var largeTail = text.slice(largeStart);
        if (/^[\[{]\s*(?:["']|[\[{]|-?\d|true\b|false\b|null\b)/.test(largeTail)) {
          return text.slice(0, largeStart).replace(/\s+$/, '');
        }
      }
      return text;
    }
    var match = /(?:\r?\n|\s)([\[{])/.exec(text);
    var start = match ? match.index + match[0].length - 1 : -1;
    while (start >= 0) {
      var tail = text.slice(start);
      try {
        JSON.parse(tail);
        return text.slice(0, start).replace(/\s+$/, '');
      } catch (_) {
        var next = text.indexOf('\n{', start + 1);
        if (next < 0) break;
        start = next + 1;
      }
    }
    return text;
  }

  function removeUrlParts(text) {
    return text.replace(/https?:\/\/[^\s"'<>]+/gi, function (url) {
      var cut = url.search(/[?#]/);
      return cut >= 0 ? url.slice(0, cut) : url;
    });
  }

  function removeLocalPaths(text) {
    var result = text.replace(/(["'])(?:file:\/\/|[A-Za-z]:[\\/]|\\\\)[\s\S]*?\1/g, PATH);
    result = result.replace(/file:\/\/[^\s"'<>]+/gi, PATH);
    result = result.replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>]+/g, function (match) {
      // The drive-path pattern can begin at the final letter of an URL scheme
      // (for example, the "p:" in "http://"). Preserve such URLs after their
      // query and hash have already been removed.
      return /^[A-Za-z]:\/\//.test(match) ? match : PATH;
    });
    return result;
  }

  function redactSecrets(text) {
    var key = '(?:api[_-]?(?:key|token)|access[_-]?token|auth(?:entication)?|password|passwd|secret|token|密钥|密码|令牌)';
    var assignment = new RegExp('(["\\\']?' + key + '["\\\']?\\s*[:=]\\s*)(["\\\']?)([^,;\\s}\\]]+)', 'gi');
    return text.replace(assignment, function (match, prefix, quote, value) {
      return value.indexOf(SECRET.slice(0, -1)) === 0 ? match : prefix + SECRET;
    });
  }

  function sanitize(value) {
    var text;
    if (typeof value === 'string') {
      text = value;
      if (/^\s*[\[{][\s\S]*[\]}]\s*$/.test(text)) {
        try { JSON.parse(text); return STRUCTURED; } catch (_) { /* keep ordinary text */ }
      }
    } else if (isError(value)) {
      text = value.message || String(value);
    } else {
      return STRUCTURED;
    }
    text = trimTrailingJson(String(text));
    text = removeUrlParts(text);
    text = removeLocalPaths(text);
    text = redactSecrets(text);
    text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
    text = text.trim();
    return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT - 1) + '…' : text;
  }

  function sourceLabel(value) {
    var result = sanitize(value);
    return result === STRUCTURED || !result ? '未知来源' : result.slice(0, 200);
  }

  function timeValue(value) {
    if (typeof value === 'number' || typeof value === 'string') return String(value);
    return value == null ? '' : sanitize(value);
  }

  function timeRank(value) {
    var numeric = Number(value);
    if (isFinite(numeric) && value !== '') return numeric;
    var clock = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(String(value));
    if (clock) return ((Number(clock[1]) * 60 + Number(clock[2])) * 60 + Number(clock[3])) * 1000 + Number((clock[4] || '').padEnd(3, '0') || 0);
    var parsed = Date.parse(value);
    return isNaN(parsed) ? 0 : parsed;
  }

  function isPatchSummary(message, source) {
    var count = '(?:\\[\\s*\\d+\\s*\\]|\\d+)';
    return /do_patch\s*\(\)\s*done\s*:/i.test(message) ||
      new RegExp('\\b(?:okCount|errorCount|failedCount|failureCount|patchCount|appliedCount|skippedCount)\\b\\s*[:=]\\s*' + count, 'i').test(message) ||
      /(?:补丁|模组|插件).*(?:成功|失败|错误|数量)\s*[:=]?\s*\d+/i.test(message);
  }

  function hasPositivePatchCount(message) {
    var match = /\b(?:errorCount|failedCount|failureCount)\b\s*[:=]\s*(?:\[\s*)?(\d+)/i.exec(message);
    return !!(match && Number(match[1]) > 0);
  }

  function classify(level, message, source) {
    var combined = message + ' ' + source;
    var summary = isPatchSummary(message, source);
    if (summary) {
      var chineseFailureCount = /(?:失败|错误|异常)\s*[:=]\s*(?:\[\s*)?(\d+)/.exec(message);
      if (hasPositivePatchCount(message) || (chineseFailureCount && Number(chineseFailureCount[1]) > 0) ||
          (!chineseFailureCount && /失败|错误|异常/i.test(message))) return 'patch-failure';
      return 'patch-summary';
    }
    var patchContext = /TweeReplacer|ReplacePatcher|do_patch|补丁/i.test(message);
    if (/findString|cannot\s+find|未找到/i.test(message) ||
        (patchContext && /fail|error|exception|失败|错误|异常|无法/i.test(message))) {
      return 'patch-failure';
    }
    if (/runtime|exception|typeerror|referenceerror|undefined|null|运行时/i.test(combined)) return 'runtime';
    if (level === 'warn') return 'warning';
    if (level === 'info') return 'patch-summary';
    return 'error';
  }

  function group(entries, limit) {
    var cap = typeof limit === 'number' && limit >= 0 ? Math.floor(limit) : 150;
    var list = Array.isArray(entries) ? entries.slice(-MAX_ENTRIES) : [];
    var map = Object.create(null);
    list.forEach(function (entry, index) {
      if (!entry || (entry.level !== 'error' && entry.level !== 'warn' && entry.level !== 'info')) return;
      var level = entry.level;
      var message = sanitize(entry.message);
      var source = sourceLabel(entry.source);
      if (level === 'info' && !isPatchSummary(message, source)) return;
      var key = level + '\u0000' + source + '\u0000' + message;
      var time = timeValue(entry.time);
      var sequence = index + 1;
      if (!map[key]) {
        map[key] = { level: level, message: message, source: source, count: 0, firstTime: time, lastTime: time, kind: classify(level, message, source), _firstOrder: 0, _lastOrder: 0 };
      }
      var item = map[key];
      var rank = timeRank(time);
      var order = rank ? 1000000000000000 + rank : sequence;
      item.count += 1;
      if (!item._firstOrder || order < item._firstOrder) { item.firstTime = time; item._firstOrder = order; }
      if (!item._lastOrder || order >= item._lastOrder) { item.lastTime = time; item._lastOrder = order; }
    });
    return Object.keys(map).map(function (key) {
      var item = map[key];
      if (item.kind === 'patch-failure' && item.level === 'info') item.level = 'error';
      return item;
    }).sort(function (a, b) {
      return b._lastOrder - a._lastOrder;
    }).slice(0, cap).map(function (item) {
      delete item._firstOrder;
      delete item._lastOrder;
      return item;
    });
  }

  function makeReport(input) {
    input = input && typeof input === 'object' ? input : {};
    var lines = [
      'DoL 前端诊断报告',
      '生成时间：' + new Date().toISOString(),
      '范围：仅主动收集前端错误、警告、补丁摘要和模组冲突；不主动读取存档或剧情数据，原始对象调试内容会省略。',
      ''
    ];
    var groups = Array.isArray(input.groups) ? input.groups : [];
    if (groups.length) {
      lines.push('错误与日志分组：');
      groups.slice(0, 500).forEach(function (item) {
        if (!item) return;
        var level = sanitize(item.level);
        var message = sanitize(item.message);
        var source = sourceLabel(item.source);
        var count = Number(item.count) || 1;
        lines.push('[' + level + '] ' + message + '（来源：' + source + '，次数：' + count + '，类型：' + sanitize(item.kind) + '）');
      });
      lines.push('');
    }
    var mods = Array.isArray(input.mods) ? input.mods : [];
    if (mods.length) {
      lines.push('已记录模组：');
      mods.slice(0, 300).forEach(function (mod) {
        if (!mod) return;
        lines.push('- ' + sanitize(mod.name) + (mod.version == null ? '' : ' ' + sanitize(mod.version)));
      });
      lines.push('');
    }
    var conflicts = Array.isArray(input.conflicts) ? input.conflicts : [];
    if (conflicts.length) {
      lines.push('潜在修改重叠：以下条目表示多个模组修改了同一目标，不等于已经证明发生冲突或造成错误。');
      conflicts.slice(0, 300).forEach(function (conflict) {
        if (!conflict) return;
        var names = Array.isArray(conflict.mods) ? conflict.mods.slice(0, 30).map(sanitize).join('、') : '';
        lines.push('- 目标：' + sanitize(conflict.target) + '；模组：' + names);
      });
      lines.push('');
    }
    var notes = Array.isArray(input.notes) ? input.notes.map(sanitize).filter(function (note) { return note && note !== STRUCTURED; }).join('\n') : sanitize(input.notes);
    if (notes !== STRUCTURED && notes) lines.push('备注：' + notes);
    var report = lines.join('\n');
    return report.length > 60000 ? report.slice(0, 59999) + '…' : report;
  }

  return { sanitize: sanitize, group: group, makeReport: makeReport };
}));
