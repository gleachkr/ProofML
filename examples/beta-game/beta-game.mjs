// β-reduction game — the term is the canonical model; the typing derivation (the
// proof) is derived from it on every render. Clicking a redex β-reduces the term
// and the re-derived proof is exactly the normalized one. See lambda.mjs.
//
// Class components only: the htm/preact bundle behind the `preact` importmap
// exports no hooks. KaTeX is imported as an ESM module so it's ready before the
// first render (no reliance on a deferred global).

import { html, render, Component } from "preact"
import katex from "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.mjs"

import {
  PUZZLES, ROOT, fnPath, argPath, bodyPath, leftPath, rightPath, scrutPath, termPath,
  redexes, reduceAt, derive, typeToString,
} from "./lambda.mjs"

// ---------------------------------------------------------------------------
// Tex — renders a KaTeX string into a <span> imperatively. No preact children,
// so preact never fights the innerHTML; redrawn on every update. Synchronous,
// so ProofML's ResizeObserver measures the right size immediately.
// ---------------------------------------------------------------------------
class Tex extends Component {
  draw() {
    if (this.base) this.base.innerHTML = katex.renderToString(this.props.tex, { throwOnError: false })
  }
  componentDidMount() { this.draw() }
  componentDidUpdate() { this.draw() }
  render() { return html`<span class=${this.props.class || ""}></span>` }
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------
class Game extends Component {
  constructor() {
    super()
    const puzzle = PUZZLES[0]
    // view: "terms" shows judgements (term : type); "props" shows just the
    // formulas — a pure natural-deduction proof, where the [A]¹ discharge
    // brackets do all the disambiguation work.
    this.state = { puzzleId: puzzle.id, term: puzzle.term, history: [], view: "terms" }
  }

  puzzle() { return PUZZLES.find(p => p.id === this.state.puzzleId) }

  // --- edit ops ---
  reduce(id) {
    this.flashPath = id   // tint what the step rewrote, once the new proof is in
    this.setState(s => ({ term: reduceAt(s.term, id), history: [...s.history, s.term] }))
  }

  // After a reduction the re-derived proof appears instantly; briefly tint the
  // subtree at the rewritten position (the contractum — including any grafted
  // copies of the argument, which land inside it) so the change is followable.
  componentDidUpdate() {
    if (!this.flashPath) return
    const el = this.figureEl?.querySelector(`[data-path="${this.flashPath}"]`)
    this.flashPath = null
    el?.animate(
      [{ background: "#ffe9b0" }, { background: "rgba(255,233,176,0)" }],
      { duration: 900, easing: "ease-out" },
    )
  }
  back() { this.setState(s => s.history.length ? { term: s.history[s.history.length - 1], history: s.history.slice(0, -1) } : null) }
  reset() { this.setState(() => ({ term: this.puzzle().term, history: [] })) }
  pick(id) { const p = PUZZLES.find(p => p.id === id); this.setState({ puzzleId: id, term: p.term, history: [] }) }

  // a click in the proof that missed a detour formula: shake the derivation
  // (the only feedback — there are no hints to which formula is the detour)
  wrongPick() {
    this.figureEl?.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(-5px)" }, { transform: "translateX(5px)" },
       { transform: "translateX(-4px)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" }],
      { duration: 300, easing: "ease-in-out" },
    )
  }

  // --- the term banner: a non-interactive read-out of the current term (the
  // reduction is driven from the proof now), recursive so parenthesization holds ---
  termView(node, path) { return this.termContent(node, path) }
  termContent(node, path) {
    switch (node.kind) {
      case "var":
        return node.name
      case "lam":
        return html`λ${node.param}:${typeToString(node.type)}.${this.termView(node.body, bodyPath(path))}`
      case "app":
        return html`${this.fnView(node.fn, fnPath(path))}<span class="sp"> </span>${this.atomView(node.arg, argPath(path))}`
      case "pair":
        return html`<span class="paren">⟨</span>${this.termView(node.left, leftPath(path))}, ${this.termView(node.right, rightPath(path))}<span class="paren">⟩</span>`
      case "fst":
        return html`<span class="kw">fst</span> ${this.atomView(node.arg, argPath(path))}`
      case "snd":
        return html`<span class="kw">snd</span> ${this.atomView(node.arg, argPath(path))}`
      case "inl":
        return html`<span class="kw">inl</span> ${this.atomView(node.term, termPath(path))}`
      case "inr":
        return html`<span class="kw">inr</span> ${this.atomView(node.term, termPath(path))}`
      case "case":
        return html`<span class="kw">case</span> ${this.fnView(node.scrut, scrutPath(path))} <span class="kw">of</span> <span class="kw">inl</span> ${node.xl} ⇒ ${this.termView(node.bodyL, leftPath(path))} <span class="paren">|</span> <span class="kw">inr</span> ${node.yr} ⇒ ${this.termView(node.bodyR, rightPath(path))}`
    }
  }
  fnView(node, path) {   // function position: λ and case need parens; the rest stay bare
    return (node.kind === "lam" || node.kind === "case")
      ? html`<span class="paren">(</span>${this.termView(node, path)}<span class="paren">)</span>`
      : this.termView(node, path)
  }
  atomView(node, path) {  // argument/prefix-operand: anything but a var or a (bracketed) pair gets parens
    return (node.kind === "var" || node.kind === "pair")
      ? this.termView(node, path)
      : html`<span class="paren">(</span>${this.termView(node, path)}<span class="paren">)</span>`
  }

  // --- the typing derivation, as ProofML ---
  // Every conclusion formula is a click target (a neutral hover affordance, styled
  // in CSS, signals this without giving the answer away). A node tagged `cutId` is
  // a major premise whose conclusion is a detour formula: clicking it fires the
  // step. Any other formula (or a miss) bubbles to the figure and shakes — there is
  // no highlight saying which one is the detour. That's the puzzle.
  // the judgement tex for a node under the current view; a leaf discharged by an
  // →I/∨E below is bracketed and labelled to match that rule: [x : A]¹ / [A]¹
  texFor(node) {
    const base = this.state.view === "props" ? node.judgement.propTex : node.judgement.tex
    return node.dischargeIndex ? `[${base}]^{${node.dischargeIndex}}` : base
  }

  view(node) {
    if (node.premises.length === 0)                       // a leaf assumption (var)
      return html`<proof-proposition key=${node.path} data-path=${node.path}><${Tex} tex=${this.texFor(node)} /></proof-proposition>`

    const onProp = node.cutId
      ? e => { e.stopPropagation(); this.reduce(node.cutId) }
      : null
    const label = node.rule === "→I" || node.rule === "∨E"
      ? html`${node.rule}<sup>${node.dischargeLabel}</sup>`
      : node.rule
    return html`<proof-tree key=${node.path} data-path=${node.path}>
      <proof-forest>${node.premises.map(p => this.view(p))}</proof-forest>
      <proof-proposition onClick=${onProp}><${Tex} tex=${this.texFor(node)} /></proof-proposition>
      <div slot="inference" class="rule">${label}</div>
    </proof-tree>`
  }

  render() {
    const puzzle = this.puzzle()
    const term = this.state.term
    const deriv = derive(puzzle.ctx, term)
    const rs = redexes(term)
    const normal = rs.length === 0
    const steps = this.state.history.length

    return html`
      <div class="wrap">
        <header>
          <h1>reduction <span class="eq">=</span> proof normalization</h1>
          <p class="lede">A typed λ-term's typing derivation <em>is</em> a proof, and reduction is the removal of <em>detours</em>. A detour is a formula <strong>introduced and then immediately eliminated</strong> — a <em>maximal formula</em>, like an <code>→I</code> whose conclusion is the major premise of an <code>→E</code>. With sums there's also the <span class="comm-key">stuck</span> case: an elimination resting on a <span class="comm-key">∨E</span>, cleared by a commuting conversion. <strong>Your move:</strong> hunt the detour <em>in the proof</em> and click the formula it turns on — the one on the inference line just under the elimination that consumes it. Right formula, the step fires; wrong one, the proof shakes. The term up top is just a live read-out — and you can switch the proof to <em>propositions</em> only, where the bracketed assumptions <code>[A]¹</code> and their rule labels do all the bookkeeping.</p>
        </header>

        <nav class="puzzles">
          ${PUZZLES.map(p => html`<button class=${"pz" + (p.id === puzzle.id ? " on" : "")} onClick=${() => this.pick(p.id)}>${p.name}</button>`)}
        </nav>
        <p class="blurb">${puzzle.blurb}</p>

        <div class="term">${this.termView(term, ROOT)}</div>

        <div class="status">
          ${normal
            ? html`<span class="win">✓ normal form — ${steps} step${steps === 1 ? "" : "s"} 🎉</span>`
            : html`<span class="hint">${rs.length} detour${rs.length === 1 ? "" : "s"} left — click the formula under its elimination</span>`}
          <span class="spacer"></span>
          <span class="viewpick">
            <button class=${this.state.view === "terms" ? "on" : ""} onClick=${() => this.setState({ view: "terms" })}>terms</button><button class=${this.state.view === "props" ? "on" : ""} onClick=${() => this.setState({ view: "props" })}>propositions</button>
          </span>
          <button onClick=${() => this.back()} disabled=${steps === 0}>↶ step back</button>
          <button onClick=${() => this.reset()} disabled=${steps === 0}>reset</button>
        </div>

        <figure class="derivation" ref=${el => this.figureEl = el} onClick=${() => this.wrongPick()}>${this.view(deriv)}</figure>
      </div>`
  }
}

render(html`<${Game} />`, document.getElementById("app"))
