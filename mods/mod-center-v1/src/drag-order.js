(function (root) {
  'use strict';

  if (root.DMCDrag) return;

  /*
   * DOM-only reorder helper for the enabled-mod list.  It deliberately does
   * not know about the storage adapter: the caller receives the proposed
   * zero-based index and can show its normal confirmation before writing.
   */
  function bind(list, options) {
    options = options || {};
    if (!list || typeof list.addEventListener !== 'function') {
      throw new TypeError('DMCDrag.bind requires a list element');
    }
    const onDrop = typeof options.onDrop === 'function' ? options.onDrop : function () {};
    const onAnnounce = typeof options.onAnnounce === 'function' ? options.onAnnounce : function () {};
    const state = {
      active: false,
      keyboard: false,
      ending: false,
      pointerId: null,
      card: null,
      name: '',
      targetIndex: -1,
      pointerY: 0,
      frame: 0,
      startX: 0,
      startY: 0,
      originalChildren: [],
      originalCards: [],
      originalIndex: -1
    };

    function cards() {
      return Array.prototype.filter.call(list.children, function (node) {
        return node.matches && node.matches('.dmc-card[data-order-name]');
      });
    }

    function handleFor(card) {
      return card && card.querySelector ? card.querySelector('.dmc-drag-handle') : null;
    }

    function isDisabled(handle) {
      return !handle || handle.disabled || handle.getAttribute('aria-disabled') === 'true' || handle.dataset.locked === '1';
    }

    function announce(text) {
      try { onAnnounce(String(text)); } catch (_) {}
    }

    function restore() {
      state.originalChildren.forEach(function (child) { list.appendChild(child); });
    }

    function clearGrabbed() {
      if (!state.card) return;
      state.card.classList.remove('dmc-dragging');
      const handle = handleFor(state.card);
      if (handle) handle.setAttribute('aria-grabbed', 'false');
    }

    function stopFrame() {
      if (state.frame) root.cancelAnimationFrame(state.frame);
      state.frame = 0;
    }

    function releasePointer() {
      if (state.pointerId === null || !state.card) return;
      const handle = handleFor(state.card);
      if (handle && handle.hasPointerCapture && handle.hasPointerCapture(state.pointerId)) {
        try { handle.releasePointerCapture(state.pointerId); } catch (_) {}
      }
    }

    function capturePointer() {
      if (state.pointerId === null || !state.card) return;
      const handle = handleFor(state.card);
      if (handle && handle.setPointerCapture) {
        try { handle.setPointerCapture(state.pointerId); } catch (_) {}
      }
    }

    function contentScroller() {
      return list.closest && (list.closest('.dmc-content') || list.parentElement);
    }

    function autoScroll() {
      if (!state.active) return;
      const scroller = contentScroller();
      if (scroller && scroller.scrollHeight > scroller.clientHeight) {
        const rect = scroller.getBoundingClientRect();
        const edge = Math.min(72, Math.max(36, rect.height * 0.18));
        let amount = 0;
        if (state.pointerY < rect.top + edge) amount = -Math.ceil((rect.top + edge - state.pointerY) / 4);
        else if (state.pointerY > rect.bottom - edge) amount = Math.ceil((state.pointerY - (rect.bottom - edge)) / 4);
        amount = Math.max(-12, Math.min(12, amount));
        if (amount) {
          scroller.scrollTop += amount;
          insertAt(targetFromY(state.pointerY));
        }
      }
      state.frame = root.requestAnimationFrame(autoScroll);
    }

    function insertAt(index) {
      if (!state.card) return;
      const current = cards().filter(function (card) { return card !== state.card; });
      const clamped = Math.max(0, Math.min(index, current.length));
      if (clamped === current.length) list.appendChild(state.card);
      else list.insertBefore(state.card, current[clamped]);
      state.targetIndex = clamped;
      const handle = handleFor(state.card);
      if (handle) handle.setAttribute('aria-posinset', String(clamped + 1));
      if (state.keyboard && handle && document.activeElement !== handle) {
        try { handle.focus({preventScroll: true}); } catch (_) { try { handle.focus(); } catch (_) {} }
      }
      if (!state.keyboard) capturePointer();
    }

    function targetFromY(y) {
      const current = cards().filter(function (card) { return card !== state.card; });
      let index = current.length;
      for (let i = 0; i < current.length; i += 1) {
        const rect = current[i].getBoundingClientRect();
        if (y < rect.top + rect.height / 2) { index = i; break; }
      }
      return index;
    }

    function finish(commit) {
      if (!state.active) return;
      state.ending = true;
      stopFrame();
      const droppedName = state.name;
      const droppedIndex = state.targetIndex;
      const changed = droppedIndex !== state.originalIndex;
      const pointerId = state.pointerId;
      const handle = handleFor(state.card);
      if (pointerId !== null && handle && handle.hasPointerCapture && handle.hasPointerCapture(pointerId)) {
        try { handle.releasePointerCapture(pointerId); } catch (_) {}
      }
      clearGrabbed();
      restore();
      state.active = false;
      state.keyboard = false;
      state.pointerId = null;
      state.card = null;
      state.name = '';
      state.targetIndex = -1;
      state.ending = false;
      if (commit && changed && droppedIndex >= 0) {
        announce('正在保存“' + droppedName + '”的新位置。');
        onDrop(droppedName, droppedIndex);
      } else if (commit) {
        announce('位置没有改变。');
      } else {
        announce('已取消移动。');
      }
    }

    function begin(card, keyboard, event) {
      const handle = handleFor(card);
      if (state.active || isDisabled(handle)) return false;
      const before = cards();
      const index = before.indexOf(card);
      if (index < 0) return false;
      state.active = true;
      state.keyboard = !!keyboard;
      state.pointerId = keyboard ? null : event.pointerId;
      state.card = card;
      state.name = card.dataset.orderName || '';
      state.targetIndex = index;
      state.originalIndex = index;
      state.originalChildren = Array.prototype.slice.call(list.children);
      state.originalCards = before;
      state.startX = event.clientX || 0;
      state.startY = event.clientY || 0;
      state.pointerY = state.startY;
      card.classList.add('dmc-dragging');
      handle.setAttribute('aria-grabbed', 'true');
      if (!keyboard) {
        capturePointer();
        state.frame = root.requestAnimationFrame(autoScroll);
      }
      announce('已抓取“' + state.name + '”，可用方向键选择位置。');
      return true;
    }

    function pointerDown(event) {
      if (event.isPrimary === false || state.active || state.pointerId !== null) return;
      if (event.button !== undefined && event.button !== 0) return;
      const handle = event.target.closest && event.target.closest('.dmc-drag-handle');
      if (!handle || !list.contains(handle) || isDisabled(handle)) return;
      const card = handle.closest('.dmc-card[data-order-name]');
      if (!card || !list.contains(card)) return;
      state.startX = event.clientX || 0;
      state.startY = event.clientY || 0;
      state.pointerY = state.startY;
      state.pointerId = event.pointerId;
      state.card = card;
      state.name = card.dataset.orderName || '';
      try { handle.setPointerCapture(event.pointerId); } catch (_) {}
    }

    function pointerMove(event) {
      if (state.active) {
        if (state.pointerId !== event.pointerId) return;
        state.pointerY = event.clientY;
        insertAt(targetFromY(event.clientY));
        event.preventDefault();
        return;
      }
      if (!state.card || state.pointerId !== event.pointerId) return;
      const dx = (event.clientX || 0) - state.startX;
      const dy = (event.clientY || 0) - state.startY;
      if (Math.hypot(dx, dy) < 5) return;
      const card = state.card;
      state.card = null;
      begin(card, false, event);
      state.pointerY = event.clientY;
      insertAt(targetFromY(event.clientY));
      event.preventDefault();
    }

    function pointerUp(event) {
      if (!state.active) {
        if (state.pointerId === event.pointerId) { releasePointer(); state.pointerId = null; state.card = null; state.name = ''; }
        return;
      }
      if (state.pointerId !== event.pointerId) return;
      finish(true);
    }

    function lostPointerCapture(event) {
      if (state.active && !state.ending && state.pointerId === event.pointerId) finish(false);
    }

    function keyDown(event) {
      if (state.active && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
        return;
      }
      const handle = event.target.closest && event.target.closest('.dmc-drag-handle');
      if (!handle || !list.contains(handle) || isDisabled(handle)) return;
      const card = handle.closest('.dmc-card[data-order-name]');
      if (!card) return;
      if (!state.active && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        begin(card, true, event);
        return;
      }
      if (!state.active || state.card !== card || !state.keyboard) return;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const delta = event.key === 'ArrowUp' ? -1 : 1;
        insertAt(state.targetIndex + delta);
        announce('“' + state.name + '”位置：' + (state.targetIndex + 1));
      } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); finish(true); }
    }

    list.addEventListener('pointerdown', pointerDown);
    list.addEventListener('pointermove', pointerMove);
    list.addEventListener('pointerup', pointerUp);
    function pointerCancel(event) {
      if (state.active) finish(false);
      else if (state.pointerId === event.pointerId) { releasePointer(); state.pointerId = null; state.card = null; state.name = ''; }
    }
    list.addEventListener('pointercancel', pointerCancel);
    list.addEventListener('lostpointercapture', lostPointerCapture);
    list.addEventListener('keydown', keyDown);

    return {
      destroy: function () {
        stopFrame();
        if (state.active) { releasePointer(); clearGrabbed(); restore(); }
        else if (state.pointerId !== null) releasePointer();
        list.removeEventListener('pointerdown', pointerDown);
        list.removeEventListener('pointermove', pointerMove);
        list.removeEventListener('pointerup', pointerUp);
        list.removeEventListener('pointercancel', pointerCancel);
        list.removeEventListener('lostpointercapture', lostPointerCapture);
        list.removeEventListener('keydown', keyDown);
        state.active = false;
        state.card = null;
        state.pointerId = null;
      }
    };
  }

  root.DMCDrag = { bind: bind };
})(window);
