// DOM-only leaf: reconcile trusted host output while retaining live element state.
// Keys belong to siblings and must be unique. No editor/domain model lives here.
const key = node => node.nodeType === 1 ? node.getAttribute('data-key') : null;
const same = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName && key(a) === key(b);
function patch(node, next) {
  if (node.nodeType !== 1) {
    if (node.nodeValue !== next.nodeValue) node.nodeValue = next.nodeValue;
    return;
  }
  // An open details element is user state unless the model explicitly sets open.
  for (const attr of [...node.attributes]) {
    if (!next.hasAttribute(attr.name) && !(node.localName === 'details' && attr.name === 'open')) node.removeAttribute(attr.name);
  }
  for (const attr of next.attributes) if (node.getAttribute(attr.name) !== attr.value) node.setAttribute(attr.name, attr.value);
  reconcile(node, next);
}
function reconcile(parent, next) {
  const keyed = new Map([...parent.childNodes].filter(n => key(n) !== null).map(n => [key(n), n]));
  let cursor = parent.firstChild;
  for (const wanted of [...next.childNodes]) {
    const candidate = key(wanted) !== null ? keyed.get(key(wanted)) : cursor;
    if (candidate && same(candidate, wanted)) {
      if (candidate !== cursor) parent.insertBefore(candidate, cursor);
      patch(candidate, wanted);
      cursor = candidate.nextSibling;
    } else {
      parent.insertBefore(wanted.cloneNode(true), cursor);
    }
  }
  while (cursor) { const obsolete = cursor; cursor = cursor.nextSibling; obsolete.remove(); }
}
export function patchHTML(root, html) {
  const active = root.getRootNode().activeElement;
  const retainedFocus = active && root.contains(active) ? active : null;
  const template = root.ownerDocument.createElement('template');
  template.innerHTML = html;
  reconcile(root, template.content);
  if (retainedFocus?.isConnected && root.getRootNode().activeElement !== retainedFocus) retainedFocus.focus({preventScroll:true});
}
