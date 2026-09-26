/* Local documentation only. Never evaluates HTML, SugarCube macros or remote content. */
(function (root) {
  'use strict';
  const LIMIT = 256 * 1024;
  const node = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  function safeUrl(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return null;
    try {
      const u = new URL(value);
      if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
      if (/\.(zip|7z|rar|apk|exe|msi|save)(?:$|[?#])/i.test(u.href) || /\/releases\/download\//i.test(u.pathname)) return null;
      return u.href;
    } catch (_) { return null; }
  }
  function links(boot) {
    const result = [], seen = new Set();
    for (const [field, label] of [['homepage','作者主页'], ['website','项目页面'], ['repository','源码页面'], ['wiki','Wiki 资料']]) {
      const value = boot?.[field], url = safeUrl(typeof value === 'object' ? value?.url : value);
      if (url && !seen.has(url)) { seen.add(url); result.push({label: label + '（包内声明）', url}); }
    }
    result.push({label:'DoL 中文 Wiki 模组列表（公共目录）',url:'https://degreesoflewditycn.miraheze.org/wiki/%E6%A8%A1%E7%BB%84%E5%88%97%E8%A1%A8'});
    return result;
  }
  function render(target, info) {
    const boot = info.bootJson || {};
    const outer=target;outer.replaceChildren();
    const grid=node('div',undefined,'dmc-info-grid'),summary=node('section',undefined,'dmc-info-summary'),reading=node('section',undefined,'dmc-info-reading');
    grid.append(summary,reading);outer.append(grid);target=summary;
    target.append(node('h4', String(info.name || boot.name || '模组资料')));
    target.append(node('p', '版本：' + String(info.version || boot.version || '未声明') + (info.size === undefined ? '' : ' · 包大小：' + info.size + ' 字节')));
    const authors = Array.isArray(boot.author) ? boot.author.filter(x => typeof x === 'string').slice(0,20).join('、') : typeof boot.author === 'string' ? boot.author : '';
    target.append(node('p', '作者：' + (authors.slice(0,2000) || '包内未声明')));
    if (typeof boot.description === 'string') target.append(node('p', boot.description.slice(0,8000)));
    const dependencies = Array.isArray(boot.dependenceInfo) ? boot.dependenceInfo.slice(0,200) : [];
    target.append(node('h4','依赖声明'));
    const list = node('ul');
    for (const dep of dependencies) if (dep && typeof dep.modName === 'string') list.append(node('li', dep.modName + ' ' + String(dep.version ?? '')));
    target.append(list.childNodes.length ? list : node('p','包内未声明依赖。'));
    root.DMCPackage?.render(target,boot);
    target=reading;target.append(node('h4','包内 README'));
    if (info.readme?.text !== undefined) {
      const markdown=/\.(md|markdown)$/i.test(info.readme.path);
      target.append(node('p', info.readme.path + (markdown ? ' · Markdown 阅读模式' : ' · 纯文本'), 'dmc-muted'));
      const document=node('div',undefined,'dmc-readme dmc-markdown');
      if(markdown && root.DMCMarkdown)root.DMCMarkdown.render(document,info.readme.text);
      else document.append(node('pre',info.readme.text));
      target.append(document);
      if(markdown){const source=node('details',undefined,'dmc-readme-source');source.append(node('summary','查看 README 原文'),node('pre',info.readme.text,'dmc-json'));target.append(source);}
    } else target.append(node('p', info.readme?.message || '此包没有可读取的 README。', 'dmc-muted'));
    target=summary;target.append(node('h4','外部资料'));
    target.append(node('p','链接由你主动打开；包内声明未经核验，Wiki 目录不代表本模组有对应条目或已经兼容。此处不抓取资料、不下载或安装模组。','dmc-muted'));
    const external = node('div', undefined, 'dmc-reference-links');
    for (const item of links(boot)) {
      const a = node('a', item.label + '\n' + item.url);
      a.href = item.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.referrerPolicy = 'no-referrer';
      // Cordova needs its external-browser bridge; never navigate the game WebView.
      a.addEventListener('click', e => {
        if (root.cordova) {
          e.preventDefault();
          if (typeof root.cordova.InAppBrowser?.open === 'function') root.cordova.InAppBrowser.open(item.url, '_system');
          else {
            let note = external.querySelector('.dmc-external-note');
            if (!note) { note = node('p', undefined, 'dmc-external-note'); external.append(note); }
            note.textContent = '当前 APK 没有外部浏览器接口，请复制上方地址到浏览器打开。';
          }
        }
      });
      external.append(a);
    }
    target.append(external);
    const raw = node('details'); raw.append(node('summary','原始元数据'),node('pre',JSON.stringify(boot,null,2),'dmc-json')); target.append(raw);
  }
  root.DMCModInfo = {render, safeUrl, links, LIMIT};
})(window);
