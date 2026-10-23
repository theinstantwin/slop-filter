/**
 * Appends Slop Filter actions to LinkedIn's own ··· menu.
 *
 * The menu is PORTALED — it renders outside the post element, and only when
 * opened. So we watch the document for it rather than querying the post.
 * Video posts render their own [role="menu"] for subtitle settings, so the
 * real menu is identified by its item text — via dom.isPostMenu, the single
 * source of truth for that check (see dom.js header).
 *
 * As a content script, dom.js loads before this file and exposes `dom` as a
 * global. Under Node (tests), it is required directly. Guarded the same way
 * dom.js guards its own module.exports.
 */

const dom = typeof module !== 'undefined' ? require('./dom.js') : window.dom;

const MENU_MARKER = 'data-sf-menu';

/**
 * LinkedIn does not close its menu when one of OUR items is clicked — it
 * only knows about its own. Measured live (2026-09-01): a synthetic Escape
 * keydown bubbled from inside the menu closes it, so every item that acts
 * in place sends one after its handler. Allow-filter skips this: it reloads
 * the page, and reload wins any race with the close animation.
 */
function closeMenu(item) {
  const win = item.ownerDocument.defaultView;
  if (!win || !win.KeyboardEvent) return;
  item.dispatchEvent(new win.KeyboardEvent('keydown', {
    key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true,
  }));
}

/**
 * Geometry matches LinkedIn's own rows, measured live 2026-09-01: 48px
 * min-height, label text starting 48px from the menu's left edge (their
 * 24px icon plus gutters — we have no icon, so the padding carries it),
 * 600 14px label at rgba(0,0,0,.75). Before this the items were flush-left
 * at 14px with no hover state, and read as a different app bolted onto the
 * bottom of the menu.
 */
const ITEM_STYLE =
  'display:flex;flex-direction:column;justify-content:center;min-height:48px;' +
  'padding:6px 16px 6px 48px;box-sizing:border-box;cursor:pointer;' +
  'font:600 14px/1.25 -apple-system,system-ui,sans-serif;color:rgba(0,0,0,.75)';

function makeItem(doc, label, sub, onClick, { closes = true } = {}) {
  const item = doc.createElement('div');
  item.setAttribute('role', 'menuitem');
  item.setAttribute('tabindex', '0');
  item.dataset.sfItem = 'true';
  item.style.cssText = ITEM_STYLE;
  item.textContent = label;
  if (sub) {
    const s = doc.createElement('div');
    s.style.cssText = 'font-weight:400;font-size:12px;line-height:1.3;color:rgba(0,0,0,.6);margin-top:2px';
    s.textContent = sub;
    item.appendChild(s);
  }
  item.addEventListener('mouseenter', () => { item.style.background = 'rgba(0,0,0,.08)'; });
  item.addEventListener('mouseleave', () => { item.style.background = ''; });
  item.addEventListener('click', e => {
    onClick(e);
    if (closes) closeMenu(item);
  });
  item.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click(); }
  });
  return item;
}

function decorate(menu, ctx, handlers) {
  if (menu.hasAttribute(MENU_MARKER)) return;
  menu.setAttribute(MENU_MARKER, 'true');
  const doc = menu.ownerDocument;

  const divider = doc.createElement('div');
  divider.dataset.sfItem = 'true';
  divider.style.cssText =
    'border-top:1px solid rgba(0,0,0,.08);margin:4px 0;padding:10px 16px 4px 48px;' +
    'font:600 9.5px "SF Mono",ui-monospace,Menlo,monospace;letter-spacing:.09em;' +
    'text-transform:uppercase;color:#07729B';
  divider.textContent = 'Slop Filter';
  menu.appendChild(divider);

  if (ctx.author) {
    menu.appendChild(makeItem(doc, `Mute ${ctx.author}`,
      'Hide every post from this person',
      () => handlers.onMute?.(ctx.author)));
  }
  menu.appendChild(makeItem(doc, 'Read anyway',
    'Keep the post, drop the flag',
    () => handlers.onReadAnyway?.()));
  for (const name of ctx.filterNames || []) {
    // Short enough to stay on one line at LinkedIn's 256px menu width.
    menu.appendChild(makeItem(doc, `Allow ${name}`,
      'Turn this filter off everywhere',
      () => handlers.onAllowFilter?.(name),
      { closes: false }));
  }
}

function attachMenuWatcher(handlers = {}) {
  const getContext = handlers.getContext || (() => ({ author: null, filterNames: [] }));

  const scan = nodes => {
    for (const node of nodes) {
      if (node.nodeType !== 1) continue;
      const menus = dom.isPostMenu(node)
        ? [node]
        : Array.from(node.querySelectorAll(dom.SEL.openMenu) || []).filter(dom.isPostMenu);
      for (const menu of menus) decorate(menu, getContext(), handlers);
    }
  };

  const observer = new MutationObserver(muts => {
    for (const mut of muts) scan(mut.addedNodes);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scan([document.body]);
  return observer;
}

if (typeof module !== 'undefined') {
  module.exports = { attachMenuWatcher, MENU_MARKER };
}
