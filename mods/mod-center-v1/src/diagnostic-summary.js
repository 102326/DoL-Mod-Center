(function(root){
 'use strict';
 const categories=[['dependency','依赖缺失',/not found mod|need mod.*not find|缺少.*前置/i],['version','版本不符',/not satisfies|版本不符/i],['patch','补丁失败',/cannot find findString|errorCount:\[?[1-9]|补丁.*失败/i],['storage','存储异常',/QuotaExceeded|InvalidStateError|TransactionInactive|AbortError|indexeddb.*(?:error|fail)|存储.*(?:失败|异常)/i],['runtime','运行时报错',/TypeError|ReferenceError|SyntaxError|errors? within widget|bad evaluation|bad conditional|运行时/i]];
 function summarize(groups){const counts=Object.fromEntries(categories.map(([id])=>[id,0]));counts.other=0;for(const g of (groups||[])){const message=String(g.message||''),match=categories.find(([, , re])=>re.test(message));if(match)counts[match[0]]++;else if(g.level==='error'||g.level==='warn'||g.level==='warning')counts.other++;}return counts;}
 function render(host,groups){const e=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;},counts=summarize(groups),box=e('section','');box.className='dwb-card';box.append(e('h3','错误摘要'),e('p','按日志内容分组计数；类别识别不是根因判定。已确认的是日志所报告的现象，相关模组仍需逐项核对。'));for(const [id,label] of [...categories,['other','其他错误／警告']])box.append(e('p',label+'：'+counts[id]+' 组'));host.append(box);}
 root.DMCSummary={summarize,render};
})(window);
