// A free-form ProofML proof editor.
//
// Architecture (see plan): a canonical JS proof *model* lives in Preact state;
// ProofML custom elements are the *render target*; edits mutate the model;
// export serializes the model back to clean, recoverable ProofML HTML.
//
// We use Preact *class components* on the project's existing htm/preact bundle
// (mapped to bare `preact` via the importmap). That bundle exports html/render/
// Component but NO hooks, and pulling hooks from another URL would load a second
// preact instance and break — so class components keep us on one dependency.

import { html, render, Component } from "preact"

// ---------------------------------------------------------------- model ------
// Globally-unique ids. A per-session counter would reset on reload and collide
// with ids already persisted in localStorage — and duplicate ids collide as
// preact keys, entangling two distinct nodes into one. randomUUID never collides.
const uid = () => crypto.randomUUID()

// Re-key a loaded tree: persisted state may carry stale or duplicate ids (e.g.
// saved before ids were unique), so assign fresh ids on load to heal it.
const reId = n => ({ ...n, id: uid(), premises: n.premises.map(reId) })

// A node. Leaf = no rule and no premises (renders as a bare proof-proposition).
const node = (prop = "", rule = null, premises = []) =>
  ({ id: uid(), prop, rule, premises, collapsed: false })

const isLeaf = n => n.premises.length === 0 && n.rule == null
// the open frontier of a subtree: every leaf reachable above it
const frontier = n => (n.premises.length ? n.premises.flatMap(frontier) : [n])

// Replace the node with id `id` everywhere in `nodes` by fn(node). Returning
// null deletes it. Works on the top-level roots array too (roots are nodes).
function editNode(nodes, id, fn) {
  const out = []
  for (const n of nodes) {
    if (n.id === id) { const r = fn(n); if (r) out.push(r); continue }
    out.push({ ...n, premises: editNode(n.premises, id, fn) })
  }
  return out
}
function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = findNode(n.premises, id); if (hit) return hit
  }
  return null
}
// true if `id` is `n` or anywhere in its subtree (used to block cyclic drops)
const contains = (n, id) => n.id === id || n.premises.some(p => contains(p, id))
// pull the node with `id` out of the forest, returning [forestWithout, removedNode]
function extract(nodes, id) {
  let removed = null
  const rec = ns => {
    const out = []
    for (const n of ns) {
      if (n.id === id) { removed = n; continue }
      out.push({ ...n, premises: rec(n.premises) })
    }
    return out
  }
  return [rec(nodes), removed]
}

// ------------------------------------------------ model -> ProofML HTML ------
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
function toProofML(n, pad = "") {
  if (isLeaf(n)) return `${pad}<proof-proposition>${esc(n.prop)}</proof-proposition>`
  const kids = n.premises.map(p => toProofML(p, pad + "    ")).join("\n")
  const rule = n.rule ? `\n${pad}  <div slot="inference">${esc(n.rule)}</div>` : ""
  return `${pad}<proof-tree>\n${pad}  <proof-forest>\n${kids}\n${pad}  </proof-forest>\n` +
    `${pad}  <proof-proposition>${esc(n.prop)}</proof-proposition>${rule}\n${pad}</proof-tree>`
}

const STORE = "proofml-editor"

// --------------------------------------- caret-safe editable formula --------
// Re-rendering a contenteditable node on every keystroke resets the caret. So
// this component renders the editable element ONCE and manages its text purely
// imperatively via the ref (this.base): we sync textContent only when the model
// value changes from outside AND the element isn't focused, and we never let
// preact diff the editable children (shouldComponentUpdate always returns false).
class Formula extends Component {
  componentDidMount() { this.sync() }
  sync() {
    const v = this.props.value ?? ""
    if (this.base && this.base.textContent !== v && document.activeElement !== this.base)
      this.base.textContent = v
  }
  shouldComponentUpdate() { this.sync(); return false }
  render() {
    const p = this.props
    return html`<span
      class=${"fx " + (p.class || "")}
      contenteditable spellcheck=${false} autocorrect="off" autocapitalize="off" draggable=${false}
      data-ph=${p.placeholder || "?"}
      onInput=${e => p.onInput(e.target.textContent)}
      onFocus=${p.onFocus}
      onClick=${e => { e.stopPropagation(); p.onFocus && p.onFocus() }}></span>`
  }
}

// ----------------------------------------------- export dialog (native) -----
// Wraps a native <dialog>: opened with showModal() so we get the top layer,
// ::backdrop, focus handling and Esc-to-close for free. Open/closed is driven
// by the `text` prop; closing (button, backdrop click, or Esc) calls onClose.
class ExportDialog extends Component {
  state = { copied: false }
  componentDidMount() { this.sync() }
  componentDidUpdate() { this.sync() }
  sync() {
    const d = this.base
    if (!d) return
    if (this.props.text != null && !d.open) {
      d.showModal() // leaves focus on the first button (copy); no text selected
    } else if (this.props.text == null && d.open) {
      d.close()
    }
  }
  copy = async () => {
    try {
      await navigator.clipboard.writeText(this.props.text || "")
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 1200)
    } catch {}
  }
  render({ text, onClose }, { copied }) {
    return html`<dialog class="export" onClose=${onClose}
      onClick=${e => { if (e.target === e.currentTarget) onClose() }}>
      <div class="sheet">
        <div class="row">
          <strong>ProofML</strong>
          <span class="meta">${(text || "").length} chars</span>
          <span class="spacer"></span>
          <button onClick=${this.copy}>${copied ? "copied ✓" : "copy"}</button>
          <button onClick=${onClose}>close</button>
        </div>
        <textarea readonly spellcheck=${false}>${text || ""}</textarea>
      </div>
    </dialog>`
  }
}

// ----------------------------------------------------------- the editor -----
class Editor extends Component {
  constructor() {
    super()
    // selectedPart tracks *what* about the selected node is selected: its
    // "prop" (conclusion / leaf) or its "rule" (the inference line). This lets
    // delete mean "delete this node" vs "delete just the inference" (below).
    this.state = { roots: [starter()], selectedId: null, selectedPart: "prop", exportText: null, dropTargetId: null }
    this.history = []
    this.dragId = null // id of the subtree currently being dragged
  }
  componentDidMount() {
    const saved = localStorage.getItem(STORE)
    if (saved) { try { this.setState({ roots: JSON.parse(saved).map(reId) }) } catch {} }
  }

  // structural edits go through commit() so they record undo history + autosave;
  // formula keystrokes use save() (no per-character undo spam).
  save(roots, extra = {}) {
    localStorage.setItem(STORE, JSON.stringify(roots))
    this.setState({ roots, ...extra })
  }
  commit(roots, extra = {}) {
    this.history.push(this.state.roots)
    this.save(roots, extra)
  }
  undo() { const prev = this.history.pop(); if (prev) this.save(prev, { selectedId: null, selectedPart: "prop" }) }

  select = (id, part = "prop") => this.setState({ selectedId: id, selectedPart: part })
  setProp = (id, prop) => this.save(editNode(this.state.roots, id, n => ({ ...n, prop })))
  setRule = (id, rule) => this.save(editNode(this.state.roots, id, n => ({ ...n, rule })))
  addPremise = id => this.commit(editNode(this.state.roots, id,
    n => ({ ...n, rule: n.rule == null ? "" : n.rule, premises: [...n.premises, node()] })))
  // Delete is context-sensitive: if the *rule* of an inference is selected,
  // remove only the inference — drop the rule line and everything feeding into
  // it, but keep the conclusion as a bare leaf. Otherwise delete the whole node.
  del = id => {
    const n = findNode(this.state.roots, id)
    if (this.state.selectedPart === "rule" && n && !isLeaf(n))
      return this.commit(editNode(this.state.roots, id,
        m => ({ ...m, rule: null, premises: [] })), { selectedId: id, selectedPart: "prop" })
    this.commit(editNode(this.state.roots, id, () => null), { selectedId: null, selectedPart: "prop" })
  }
  toggleCollapse = id => this.commit(editNode(this.state.roots, id, n => ({ ...n, collapsed: !n.collapsed })))
  newTree = () => this.commit([...this.state.roots, node()])
  attach = (holeId, rootId) => {
    const moved = this.state.roots.find(r => r.id === rootId)
    const without = this.state.roots.filter(r => r.id !== rootId)
    this.commit(editNode(without, holeId, () => moved), { selectedId: moved.id, selectedPart: "prop" })
  }
  openExport = () => this.setState({ exportText: this.state.roots.map(r => toProofML(r)).join("\n\n") })

  // --- drag-and-drop reparenting ---
  // can the dragged subtree be dropped on target `id`? not onto itself or any of
  // its own descendants (that would make a cycle).
  canDrop(id) {
    const d = this.dragId
    if (!d || d === id) return false
    const dn = findNode(this.state.roots, d)
    return !!dn && !contains(dn, id)
  }
  // move the dragged subtree to be a premise of `targetId`, or a new root if null
  reparent(dragId, targetId) {
    const dn = dragId && findNode(this.state.roots, dragId)
    if (!dn || dragId === targetId || (targetId && contains(dn, targetId))) return
    const [without, moved] = extract(this.state.roots, dragId)
    if (!moved) return
    const next = targetId == null
      ? [...without, moved]
      : editNode(without, targetId, n =>
          ({ ...n, rule: n.rule == null ? "" : n.rule, premises: [...n.premises, moved] }))
    this.commit(next, { selectedId: dragId, selectedPart: "prop", dropTargetId: null })
  }
  onDragOver = (e, id) => {
    if (!this.canDrop(id)) return
    e.preventDefault(); e.stopPropagation()
    e.dataTransfer.dropEffect = "move"
    if (this.state.dropTargetId !== id) this.setState({ dropTargetId: id })
  }
  onDragLeave = (e, id) => { if (this.state.dropTargetId === id) this.setState({ dropTargetId: null }) }
  onDrop = (e, id) => {
    e.preventDefault(); e.stopPropagation()
    const d = this.dragId
    this.setState({ dropTargetId: null })
    if (d) this.reparent(d, id)
  }

  // Drag image: a lightweight plain-DOM proxy (frontier over a line over the
  // conclusion), appended to <body>. We can't snapshot the live proof-tree:
  // Chromium won't render a slot-distributed element as a drag image, so NESTED
  // subtrees (premises projected into a parent's forest slot) came out as a
  // generic icon while root trees worked. A plain element outside any shadow tree
  // snapshots reliably for both.
  makeGhost(n) {
    if (this._ghost) this._ghost.remove()
    const g = document.createElement("div")
    g.className = "drag-ghost"
    if (n.premises.length) {
      const row = document.createElement("div")
      row.className = "dg-row"
      row.textContent = frontier(n).map(l => l.prop || "?").join("   ")
      // a full-width inference line; the ⋮ rides it (absolutely positioned, so it
      // doesn't shift the centering of premises/conclusion) only when internal
      // steps are elided (depth >= 2) — mirrors the collapsed-tree view
      const line = document.createElement("div")
      line.className = "dg-line"
      if (n.premises.some(p => !isLeaf(p))) {
        const dots = document.createElement("span")
        dots.className = "dg-dots"
        dots.textContent = "⋮"
        line.appendChild(dots)
      }
      const concl = document.createElement("div")
      concl.className = "dg-concl"
      concl.textContent = n.prop || "?"
      g.append(row, line, concl)
    } else {
      g.textContent = n.prop || "?"
    }
    document.body.appendChild(g)
    this._ghost = g
    return g
  }
  clearGhost() { if (this._ghost) { this._ghost.remove(); this._ghost = null } }

  // a small drag handle that starts a subtree drag (shown on hover/selection)
  grip(n) {
    return html`<span class="grip" draggable=${true} title="drag to reparent"
      onClick=${e => e.stopPropagation()}
      onDragStart=${e => {
        this.dragId = n.id
        e.dataTransfer.effectAllowed = "move"
        try { e.dataTransfer.setData("text/plain", n.id) } catch {}
        try { e.dataTransfer.setDragImage(this.makeGhost(n), 14, 12) } catch {}
      }}
      onDragEnd=${() => { this.dragId = null; this.clearGhost(); if (this.state.dropTargetId) this.setState({ dropTargetId: null }) }}>⠿</span>`
  }
  formula(n, isRule = false) {
    const val = isRule ? n.rule : n.prop
    const set = isRule ? v => this.setRule(n.id, v) : v => this.setProp(n.id, v)
    return html`<${Formula} value=${val} class=${isRule ? "rule" : ""} placeholder=${isRule ? "rule" : "?"}
      onInput=${set} onFocus=${() => this.select(n.id, isRule ? "rule" : "prop")} />`
  }
  // the draggable + droppable conclusion/leaf proposition for node `n`
  prop(n) {
    const selClass = n.id === this.state.selectedId ? " sel" : ""
    const dropClass = this.state.dropTargetId === n.id ? " drop-target" : ""
    return html`<proof-proposition key=${n.id} class=${"np" + selClass + dropClass}
        onClick=${e => { e.stopPropagation(); this.select(n.id, "prop") }}
        onDragOver=${e => this.onDragOver(e, n.id)}
        onDragLeave=${e => this.onDragLeave(e, n.id)}
        onDrop=${e => this.onDrop(e, n.id)}>
      ${this.grip(n)}${this.formula(n)}
    </proof-proposition>`
  }

  render(_, { roots, selectedId, exportText }) {
    const sel = selectedId && findNode(roots, selectedId)
    return html`
      <div class="toolbar">${this.toolbar(sel)}</div>
      <div class="canvas" onClick=${() => this.select(null)}
        onDragOver=${e => { if (this.dragId) { e.preventDefault(); e.dataTransfer.dropEffect = "move" } }}
        onDrop=${e => { if (this.dragId) { e.preventDefault(); this.reparent(this.dragId, null) } }}>
        <div class="trees">
          ${roots.map(r => html`<figure class="standard-proof" key=${r.id}>${this.view(r)}</figure>`)}
        </div>
        ${roots.length === 0 ? html`<p class="empty">empty canvas — press “+ tree”.</p>` : null}
      </div>
      <${ExportDialog} text=${exportText} onClose=${() => this.setState({ exportText: null })} />`
  }

  toolbar(sel) {
    return html`
      <button onClick=${() => this.newTree()}>+ tree</button>
      <button onClick=${() => this.undo()} disabled=${!this.history.length}>undo</button>
      <button onClick=${() => this.openExport()}>export ProofML</button>
      <span class="sep"></span>
      ${sel ? html`
        <span class="lbl">node:</span>
        <button onClick=${() => this.addPremise(sel.id)}>+ premise</button>
        <button onClick=${() => this.toggleCollapse(sel.id)}>${sel.collapsed ? "expand" : "collapse"}</button>
        <button onClick=${() => this.del(sel.id)}>${
          this.state.selectedPart === "rule" && !isLeaf(sel) ? "delete rule" : "delete"}</button>
        ${isLeaf(sel) ? this.attachButtons(sel) : null}`
        : html`<span class="hint">click a formula to select a node</span>`}`
  }
  attachButtons(sel) {
    const containing = this.state.roots.find(r => findNode([r], sel.id))
    const others = this.state.roots.filter(r => r !== containing)
    if (!others.length) return null
    return html`<span class="lbl">attach root:</span>${others.map(r =>
      html`<button class="attach" onClick=${() => this.attach(sel.id, r.id)}>${r.prop || "(tree)"}</button>`)}`
  }
  // model node -> ProofML elements (+ editing chrome)
  view(n) {
    const selClass = n.id === this.state.selectedId ? " sel" : ""
    const pick = e => { e.stopPropagation(); this.select(n.id, "prop") }

    if (isLeaf(n)) return this.prop(n)

    if (n.collapsed) {
      return html`<proof-tree key=${n.id} class=${"collapsed" + selClass} onClick=${pick}>
        <proof-forest>
          ${frontier(n).map(l => html`<proof-proposition key=${l.id} class="ghost">${l.prop || "?"}</proof-proposition>`)}
        </proof-forest>
        ${this.prop(n)}
        <div slot="inference" class="dots" title="expand"
          onClick=${e => { e.stopPropagation(); this.toggleCollapse(n.id) }}>⋮</div>
      </proof-tree>`
    }
    return html`<proof-tree key=${n.id} class=${"pt" + selClass} onClick=${pick}>
      <proof-forest>${n.premises.map(p => this.view(p))}</proof-forest>
      ${this.prop(n)}
      <div slot="inference" class=${"rule-slot" + (selClass && this.state.selectedPart === "rule" ? " sel" : "")}
        onClick=${e => { e.stopPropagation(); this.select(n.id, "rule") }}>${this.formula(n, true)}</div>
    </proof-tree>`
  }
}

// a small starter proof so the canvas isn't empty on first load: B from A→B, A.
function starter() {
  return node("B", "→E", [node("A→B"), node("A")])
}

render(html`<${Editor} />`, document.getElementById("app"))
