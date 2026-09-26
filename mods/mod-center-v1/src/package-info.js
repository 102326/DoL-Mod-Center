/* Bounded, declaration-only package classification and resource display. */
(function (root) {
  'use strict';
  const MAX_SCAN = 100000, MAX_FILES = 200, MAX_TYPE = 80;
  const GROUPS = [
    ['imgFileList', '图片'],
    ['tweeFileList', '文本段落'],
    ['styleFileList', '样式'],
    ['scriptFileList', '脚本'],
    ['scriptFileList_preload', '预加载脚本'],
    ['scriptFileList_earlyload', '早期加载脚本'],
    ['scriptFileList_inject_early', '注入早期脚本'],
    ['additionFile', '附加资料'],
    ['replacePatchList', '补丁']
  ];
  const DOC_FILE = /^(?:README|说明|LICENSE|COPYING|CHANGELOG)(?:\.(?:md|txt|markdown))?$/i;
  const pathValue = value => typeof value === 'string' && value.length > 0 && value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(value) && !value.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(value) &&
    !value.split('/').some(part => part === '' || part === '.' || part === '..');
  function declaredFiles(value) {
    const malformed = !(typeof value === 'undefined' || typeof value === 'string' || Array.isArray(value));
    const values = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
    const seen = new Set(), result = [], limit = Math.min(values.length, MAX_SCAN);
    for (let i = 0; i < limit; i++) {
      const item = values[i];
      if (!pathValue(item)) { return {files: result.slice(0, MAX_FILES), count: result.length, malformed: true}; }
      if (!seen.has(item)) { seen.add(item); result.push(item); }
    }
    return {files: result.slice(0, MAX_FILES), count: result.length, malformed: malformed || values.length>MAX_SCAN};
  }
  function addonEntries(boot) {
    if (typeof boot?.addonPlugin === 'undefined') return {items: [], malformed: false};
    if (!Array.isArray(boot.addonPlugin)) return {items: [], malformed: true};
    return {items: boot.addonPlugin, malformed: boot.addonPlugin.some(item => !item || typeof item !== 'object')};
  }
  function describe(boot) {
    boot = boot && typeof boot === 'object' ? boot : {};
    let malformed = false;
    const groups = GROUPS.map(([key, label]) => {
      const found = declaredFiles(boot[key]);
      malformed ||= found.malformed;
      return {key, label, files: found.files, count: found.count};
    }).filter(group => group.count > 0);
    const count = key => groups.find(group => group.key === key)?.count || 0;
    const images = count('imgFileList') > 0, css = count('styleFileList') > 0;
    const text = count('tweeFileList') > 0;
    const code = count('scriptFileList') + count('scriptFileList_preload') + count('scriptFileList_earlyload') + count('scriptFileList_inject_early') > 0;
    const patches = count('replacePatchList') > 0;
    const addons = addonEntries(boot); malformed ||= addons.malformed;
    const validAddons=addons.items.filter(item=>item && typeof item==='object' && !Array.isArray(item));
    const supplemental = count('additionFile') > 0;
    const additions=typeof boot.additionFile==='string'?[boot.additionFile]:Array.isArray(boot.additionFile)?boot.additionFile:[];
    const additionDocsOnly=additions.length<=MAX_SCAN && additions.every(file=>typeof file==='string' && DOC_FILE.test(file.split('/').pop()));
    const otherContent = code || patches || (!additionDocsOnly && supplemental);
    const allowedAddons = new Set(['ImageLoaderAddon', 'BeautySelectorAddon']);
    const hasUnknownAddon = validAddons.some(item => !allowedAddons.has(item.addonName));
    const knownSelector = validAddons.some(item => item.addonName === 'BeautySelectorAddon');
    for (const item of validAddons) {
      if (Object.prototype.hasOwnProperty.call(item, 'params') && (!item.params || typeof item.params !== 'object' || (Array.isArray(item.params) && !(item.addonName==='ImageLoaderAddon' && item.params.length===0)))) malformed = true;
      if (item.addonName==='BeautySelectorAddon' && item.params?.imgFileList !== undefined) {
        const found = declaredFiles(item.params.imgFileList); malformed ||= found.malformed;
        if (found.count) groups.push({key: 'addonPlugin.params.imgFileList', label: '插件图片' + (typeof item.params.type === 'string' && item.params.type ? ' · ' + item.params.type.slice(0, MAX_TYPE) : ''), files: found.files, count: found.count});
      }
      if(item.addonName==='BeautySelectorAddon' && Array.isArray(item.params?.types)){
        for(const t of item.params.types.slice(0,200)){
          if(!t || typeof t.type!=='string'){malformed=true;continue;}
          const files=[t.imgFileListFile,t.imgDir].filter(x=>x!==undefined);const found=declaredFiles(files);malformed ||= found.malformed;
          if(found.count)groups.push({key:'addonPlugin.params.types',label:'图层资源入口 · '+t.type.slice(0,80),files:found.files,count:found.count});
        }
        if(item.params.types.length>200)malformed=true;
      }
      if (item.params?.type !== undefined && typeof item.params.type !== 'string') malformed = true;
    }
    let label = '模组 / 未分类';
    if (knownSelector && !code && !text && !patches && additionDocsOnly && !hasUnknownAddon && groups.some(group => group.key.startsWith('addonPlugin.params.'))) label = '美化图包';
    else if (hasUnknownAddon || otherContent || (text && (images || css))) label = '内容模组' + (images ? ' · 含图片' : '');
    else if (images) label = '图片包';
    else if (css) label = '样式包';
    else if (text) label = '文本内容包';
    const beauty = !malformed && !code && !text && !patches && (additionDocsOnly || !supplemental) && !hasUnknownAddon && (images || css || label === '美化图包');
    const declaredType = typeof boot.type === 'string' ? boot.type.slice(0, MAX_TYPE) : '';
    return {label, beauty, groups, declaredType};
  }
  function node(doc, tag, text, cls) {
    const item = doc.createElement(tag);
    if (text !== undefined) item.textContent = String(text);
    if (cls) item.className = cls;
    return item;
  }
  function render(target, boot) {
    if (!target || typeof target.appendChild !== 'function') return null;
    const doc = target.ownerDocument || root.document;
    if (!doc || typeof doc.createElement !== 'function') return null;
    const info = describe(boot), section = node(doc, 'section', undefined, 'dmc-package-resources');
    section.setAttribute('aria-label', '包内资源声明');
    section.appendChild(node(doc, 'h4', '包内资源声明'));
    section.appendChild(node(doc, 'p', info.label + (info.declaredType ? ' · 声明类型：' + info.declaredType : ''), 'dmc-muted'));
    section.appendChild(node(doc, 'p', '包内资源随所属模组管理，声明不等于文件存在；分类不代表已验证兼容。', 'dmc-muted'));
    if (!info.groups.length) section.appendChild(node(doc, 'p', '包内没有可识别的资源声明。', 'dmc-muted'));
    for (const group of info.groups) {
      const details = node(doc, 'details'), summary = node(doc, 'summary', group.label + '（' + group.count + '）');
      details.appendChild(summary);
      const list = node(doc, 'ul');
      group.files.forEach(file => list.appendChild(node(doc, 'li', file)));
      details.appendChild(list);
      if (group.count > group.files.length) details.appendChild(node(doc, 'p', '仅显示前 ' + MAX_FILES + ' 项。', 'dmc-muted'));
      section.appendChild(details);
    }
    target.appendChild(section);
    return section;
  }
  root.DMCPackage = {describe, render, MAX_SCAN, MAX_FILES};
})(window);
