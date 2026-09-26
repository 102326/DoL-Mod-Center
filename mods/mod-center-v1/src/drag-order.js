(function (root) {
  'use strict';
  if (root.DMCDrag) return;

  function bind(list, options) {
    options = options || {};
    if (!list || typeof list.addEventListener !== 'function') throw new TypeError('DMCDrag.bind requires a list element');
    const onDrop = typeof options.onDrop === 'function' ? options.onDrop : function () {};
    const onAnnounce = typeof options.onAnnounce === 'function' ? options.onAnnounce : function () {};
    const state = {active:false,keyboard:false,ending:false,pointerId:null,card:null,name:'',targetIndex:-1,originalIndex:-1,pointerX:0,pointerY:0,frame:0,startX:0,startY:0,offsetX:0,offsetY:0,originalChildren:[],placeholder:null,ghost:null,reduced:false,styleSnapshots:new Map(),flipFrames:[],animations:new Map()};

    function cards(){return Array.prototype.filter.call(list.children,function(n){return n.matches&&n.matches('.dmc-card[data-order-name]');});}
    function handleFor(card){return card&&card.querySelector?card.querySelector('.dmc-drag-handle'):null;}
    function isDisabled(handle){return !handle||handle.disabled||handle.getAttribute('aria-disabled')==='true'||handle.dataset.locked==='1';}
    function announce(text){try{onAnnounce(String(text));}catch(_){}}
    function setNumber(card,index){
      if(!card)return;
      card.dataset.dmcOrderIndex=String(index+1);
      Array.prototype.forEach.call(card.querySelectorAll('.next-index,.dmc-order-number,.dmc-order-index'),function(node){node.textContent=String(index+1);node.setAttribute('data-dmc-order-index',String(index+1));});
      const handle=handleFor(card);if(handle)handle.setAttribute('aria-posinset',String(index+1));
    }
    function renumber(){cards().forEach(setNumber);}
    function stopFrame(){if(state.frame)root.cancelAnimationFrame(state.frame);state.frame=0;state.flipFrames.forEach(function(frame){root.cancelAnimationFrame(frame);});state.flipFrames=[];state.animations.forEach(function(a){a.cancel();});state.animations.clear();}
    function contentScroller(){return list.closest&&(list.closest('.dmc-content')||list.parentElement);}
    function capturePointer(){const h=handleFor(state.card);if(state.pointerId!==null&&h&&h.setPointerCapture){try{h.setPointerCapture(state.pointerId);}catch(_) {}}}
    function releasePointer(){const h=handleFor(state.card);if(state.pointerId!==null&&h&&h.hasPointerCapture&&h.hasPointerCapture(state.pointerId)){try{h.releasePointerCapture(state.pointerId);}catch(_) {}}}
    function moveGhost(x,y){if(state.ghost){state.ghost.style.left=Math.round(x-state.offsetX)+'px';state.ghost.style.top=Math.round(y-state.offsetY)+'px';}}
    function makeGhost(){
      const rect=state.card.getBoundingClientRect(),ghost=state.card.cloneNode(true);
      ghost.classList.remove('dmc-dragging');ghost.classList.add('dmc-drag-ghost');ghost.setAttribute('aria-hidden','true');ghost.setAttribute('inert','');ghost.removeAttribute('id');
      Array.prototype.forEach.call(ghost.querySelectorAll('[id]'),function(n){n.removeAttribute('id');});
      Array.prototype.forEach.call(ghost.querySelectorAll('button,input,select,textarea,a,[tabindex]'),function(n){n.setAttribute('tabindex','-1');n.setAttribute('aria-hidden','true');});
      ghost.style.width=rect.width+'px';ghost.style.height=rect.height+'px';ghost.style.left=rect.left+'px';ghost.style.top=rect.top+'px';(list.closest('.dmc-next')||document.body).appendChild(ghost);state.ghost=ghost;state.offsetX=state.startX-rect.left;state.offsetY=state.startY-rect.top;
    }
    function removeVisuals(){if(state.ghost&&state.ghost.parentNode)state.ghost.parentNode.removeChild(state.ghost);if(state.placeholder&&state.placeholder.parentNode)state.placeholder.parentNode.removeChild(state.placeholder);state.ghost=null;state.placeholder=null;}
    function restore(){removeVisuals();state.originalChildren.forEach(function(child){list.appendChild(child);});state.styleSnapshots.forEach(function(style,card){card.style.transform=style.transform;card.style.transition=style.transition;card.style.visibility=style.visibility;card.style.opacity=style.opacity;});state.styleSnapshots.clear();renumber();}
    function clearGrabbed(){if(!state.card)return;state.card.classList.remove('dmc-dragging');const h=handleFor(state.card);if(h)h.setAttribute('aria-grabbed','false');}
    function targetFromY(y){const current=cards().filter(function(card){return card!==state.card;});let index=current.length;for(let i=0;i<current.length;i+=1){const r=current[i].getBoundingClientRect();let dy=0;try{dy=new DOMMatrixReadOnly(getComputedStyle(current[i]).transform).m42;}catch(_){}if(y<r.top-dy+r.height/2){index=i;break;}}return index;}
    function flip(before){
      state.animations.forEach(function(a){a.cancel();});state.animations.clear();
      if(state.reduced)return;
      cards().forEach(function(card){const old=before.get(card);if(!old||!card.animate)return;const now=card.getBoundingClientRect(),dx=old.left-now.left,dy=old.top-now.top;if(!dx&&!dy)return;const animation=card.animate([{transform:'translate('+dx+'px,'+dy+'px)'},{transform:'translate(0,0)'}],{duration:180,easing:'cubic-bezier(.2,.75,.25,1)'});state.animations.set(card,animation);animation.onfinish=function(){if(state.animations.get(card)===animation)state.animations.delete(card);};});
    }
    function insertAt(index){
      if(!state.card)return;
      const current=cards().filter(function(card){return card!==state.card;}),clamped=Math.max(0,Math.min(index,current.length));if(clamped===state.targetIndex){if(state.ghost)moveGhost(state.pointerX,state.pointerY);return;}const before=new Map(current.map(function(card){return [card,card.getBoundingClientRect()];}));
      if(clamped===current.length)list.appendChild(state.card);else list.insertBefore(state.card,current[clamped]);
      state.targetIndex=clamped;renumber();if(state.ghost)setNumber(state.ghost,clamped);flip(before);if(state.ghost)moveGhost(state.pointerX,state.pointerY);
      const h=handleFor(state.card);if(state.keyboard&&h&&document.activeElement!==h){try{h.focus({preventScroll:true});}catch(_){try{h.focus();}catch(__){}}}if(!state.keyboard)capturePointer();
    }
    function autoScroll(){
      if(!state.active)return;
      const scroller=contentScroller();
      if(scroller&&scroller.scrollHeight>scroller.clientHeight){const r=scroller.getBoundingClientRect(),edge=Math.min(72,Math.max(36,r.height*.18));let amount=0;if(state.pointerY<r.top+edge)amount=-Math.ceil((r.top+edge-state.pointerY)/4);else if(state.pointerY>r.bottom-edge)amount=Math.ceil((state.pointerY-(r.bottom-edge))/4);amount=Math.max(-12,Math.min(12,amount));if(amount){scroller.scrollTop+=amount;insertAt(targetFromY(state.pointerY));}}
      state.frame=root.requestAnimationFrame(autoScroll);
    }
    function finish(commit){
      if(!state.active)return false;
      state.ending=true;stopFrame();const droppedName=state.name,droppedIndex=state.targetIndex,changed=droppedIndex!==state.originalIndex;
      releasePointer();clearGrabbed();restore();state.active=false;state.keyboard=false;state.pointerId=null;state.card=null;state.name='';state.targetIndex=-1;state.originalIndex=-1;state.ending=false;
      if(commit&&changed&&droppedIndex>=0){announce('正在保存“'+droppedName+'”的新位置。');onDrop(droppedName,droppedIndex);}else if(commit)announce('位置没有改变。');else announce('已取消移动。');return true;
    }
    function begin(card,keyboard,event){
      const h=handleFor(card);if(state.active||isDisabled(h))return false;const before=cards(),index=before.indexOf(card);if(index<0)return false;
      state.active=true;state.keyboard=!!keyboard;state.pointerId=keyboard?null:event.pointerId;state.card=card;state.name=card.dataset.orderName||'';state.targetIndex=index;state.originalIndex=index;state.originalChildren=Array.prototype.slice.call(list.childNodes);if(keyboard){state.startX=event.clientX||0;state.startY=event.clientY||0;}state.pointerX=state.startX;state.pointerY=state.startY;state.reduced=!!(root.matchMedia&&root.matchMedia('(prefers-reduced-motion: reduce)').matches);card.classList.add('dmc-dragging');h.setAttribute('aria-grabbed','true');
      if(!keyboard){state.styleSnapshots.set(card,{transform:card.style.transform,transition:card.style.transition,visibility:card.style.visibility,opacity:card.style.opacity});makeGhost();card.style.opacity='0';capturePointer();state.frame=root.requestAnimationFrame(autoScroll);}
      announce('已抓取“'+state.name+'”，可用方向键选择位置。');return true;
    }
    function pointerDown(event){
      if(event.isPrimary===false||state.active||state.pointerId!==null||(event.button!==undefined&&event.button!==0))return;
      const h=event.target.closest&&event.target.closest('.dmc-drag-handle');if(!h||!list.contains(h)||isDisabled(h))return;const card=h.closest('.dmc-card[data-order-name]');if(!card||!list.contains(card))return;
      state.startX=event.clientX||0;state.startY=event.clientY||0;state.pointerY=state.startY;state.pointerX=state.startX;state.pointerId=event.pointerId;state.card=card;state.name=card.dataset.orderName||'';try{h.setPointerCapture(event.pointerId);}catch(_){}
    }
    function pointerMove(event){
      if(state.active){if(state.pointerId!==event.pointerId)return;state.pointerX=event.clientX;state.pointerY=event.clientY;moveGhost(event.clientX,event.clientY);insertAt(targetFromY(event.clientY));event.preventDefault();return;}
      if(!state.card||state.pointerId!==event.pointerId)return;if(Math.hypot((event.clientX||0)-state.startX,(event.clientY||0)-state.startY)<5)return;const card=state.card;state.card=null;begin(card,false,event);state.pointerX=event.clientX;state.pointerY=event.clientY;moveGhost(event.clientX,event.clientY);insertAt(targetFromY(event.clientY));event.preventDefault();
    }
    function pointerUp(event){if(!state.active){if(state.pointerId===event.pointerId){releasePointer();state.pointerId=null;state.card=null;state.name='';}return;}if(state.pointerId===event.pointerId)finish(true);}
    function lostPointerCapture(event){if(state.active&&!state.ending&&state.pointerId===event.pointerId)finish(false);}
    function keyDown(event){
      if(state.active&&event.key==='Escape'){event.preventDefault();event.stopPropagation();finish(false);return;}
      const h=event.target.closest&&event.target.closest('.dmc-drag-handle');if(!h||!list.contains(h)||isDisabled(h))return;const card=h.closest('.dmc-card[data-order-name]');if(!card)return;
      if(!state.active&&(event.key===' '||event.key==='Enter')){event.preventDefault();begin(card,true,event);return;}if(!state.active||state.card!==card||!state.keyboard)return;
      if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();insertAt(state.targetIndex+(event.key==='ArrowUp'?-1:1));announce('“'+state.name+'”位置：'+(state.targetIndex+1));}else if(event.key==='Enter'||event.key===' '){event.preventDefault();finish(true);}
    }
    list.addEventListener('pointerdown',pointerDown);list.addEventListener('pointermove',pointerMove);list.addEventListener('pointerup',pointerUp);
    function pointerCancel(event){if(state.active)finish(false);else if(state.pointerId===event.pointerId){releasePointer();state.pointerId=null;state.card=null;state.name='';}}
    list.addEventListener('pointercancel',pointerCancel);list.addEventListener('lostpointercapture',lostPointerCapture);list.addEventListener('keydown',keyDown);
    return {cancel:function(){return finish(false);},isActive:function(){return !!state.active;},destroy:function(){stopFrame();if(state.active){releasePointer();clearGrabbed();restore();}else {releasePointer();removeVisuals();}list.removeEventListener('pointerdown',pointerDown);list.removeEventListener('pointermove',pointerMove);list.removeEventListener('pointerup',pointerUp);list.removeEventListener('pointercancel',pointerCancel);list.removeEventListener('lostpointercapture',lostPointerCapture);list.removeEventListener('keydown',keyDown);state.active=false;state.card=null;state.pointerId=null;renumber();}};
  }
  root.DMCDrag={bind:bind};
})(window);
