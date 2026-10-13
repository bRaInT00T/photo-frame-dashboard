// To-Do: a Home Assistant to-do list, through frame-hub. Tap an item to check it off; completed
// items can be shown and unchecked. Changes go to Home Assistant (and on to Google Tasks etc.).
(function () {
  'use strict';
  var D = window.DATA;
  var V = { el: null, showDone: false };

  function dueLabel(s) {
    var d = s.length === 10 ? new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : new Date(s);
    var days = Math.round((App.dayStart(d) - App.dayStart(App.now())) / 864e5);
    if (days < 0) return { text: 'Overdue', late: true };
    if (days < 7) return { text: App.fmt.rel(d) };
    return { text: App.fmt.monthShort(d) + ' ' + d.getDate() };
  }

  function row(i) {
    var due = i.due && !i.done ? dueLabel(i.due) : null;
    return '<button class="td-row' + (i.done ? ' is-done' : '') + '" data-uid="' + App.esc(i.uid) + '">' +
      '<span class="td-check">' + (i.done ? App.icon('check', 22) : '') + '</span>' +
      '<span class="td-title">' + App.esc(i.title) + '</span>' +
      (due ? '<span class="td-due' + (due.late ? ' is-late' : '') + '">' + due.text + '</span>' : '') + '</button>';
  }

  function paint() {
    var t = D.todo;
    if (!t || !t.items) {
      V.el.innerHTML = '<div class="td"><div class="td-head"><h1 class="serif">To-Do</h1></div>' +
        '<p class="td-empty">' + (t ? 'Couldn’t load the list from Home Assistant. Retrying…' : 'No to-do list connected.') + '</p></div>';
      return;
    }
    var open = t.items.filter(function (i) { return !i.done; });
    var done = t.items.filter(function (i) { return i.done; });
    V.el.innerHTML = '<div class="td">' +
      '<div class="td-head"><h1 class="serif">' + App.esc(t.name) + '</h1>' +
      '<span class="td-count"><span class="num">' + open.length + '</span> to do</span>' +
      '<form class="td-add"><input name="item" placeholder="Add an item" maxlength="120" autocomplete="off"><button class="btn btn--solid">Add</button></form></div>' +
      '<div class="td-list">' + (open.length ? open.map(row).join('') : '<p class="td-empty">All done. Enjoy it.</p>') +
      (done.length ? '<button class="td-toggle" data-toggle-done>' + (V.showDone ? 'Hide' : 'Show') + ' completed · ' + done.length + '</button>' +
        (V.showDone ? done.slice(0, 40).map(row).join('') : '') : '') +
      '</div></div>';
  }

  function onClick(e) {
    var t;
    if (e.target.closest('[data-toggle-done]')) { V.showDone = !V.showDone; return paint(); }
    if ((t = e.target.closest('[data-uid]'))) {
      var list = D.todo, item = list.items.filter(function (i) { return i.uid === t.dataset.uid; })[0];
      if (!item || item.pending) return;
      item.done = !item.done;
      item.pending = true;
      paint();
      App.haCall(list.id, 'update_item', { uid: item.uid, status: item.done ? 'completed' : 'needs_action' }, function (ok) {
        item.pending = false;
        if (!ok) {
          item.done = !item.done;
          paint();
          App.toast('Couldn’t update <b>' + App.esc(item.title) + '</b>', { tone: 'error', icon: 'check' });
        }
      });
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    var input = V.el.querySelector('.td-add input'), text = input.value.trim();
    if (!text || !D.todo) return;
    input.value = '';
    input.blur();
    D.todo.items.unshift({ uid: 'pending-' + Date.now(), title: text, done: false, pending: true });
    paint();
    App.haCall(D.todo.id, 'add_item', { item: text }, function (ok) {
      if (!ok) App.toast('Couldn’t add <b>' + App.esc(text) + '</b>', { tone: 'error', icon: 'plus' });
    });
  }

  App.register('todo', {
    show: function (el) {
      if (!V.el) {
        V.el = el;
        el.addEventListener('click', onClick);
        el.addEventListener('submit', onSubmit);
      }
      // Don't wipe a half-typed item when fresh data arrives.
      if (document.activeElement && el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
      paint();
    }
  });
})();
