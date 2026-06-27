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
  PUZZLES, ROOT, fnPath, argPath, bodyPath, isRedex,
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
    this.state = { puzzleId: puzzle.id, term: puzzle.term, history: [], hoverRedexId: null }
  }

  puzzle() { return PUZZLES.find(p => p.id === this.state.puzzleId) }

  // --- edit ops ---
  reduce(id) {
    this.setState(s => ({
      term: reduceAt(s.term, id),
      history: [...s.history, s.term],
      hoverRedexId: null,
    }))
  }
  back() { this.setState(s => s.history.length ? { term: s.history[s.history.length - 1], history: s.history.slice(0, -1), hoverRedexId: null } : null) }
  reset() { this.setState(s => ({ term: this.puzzle().term, history: [], hoverRedexId: null })) }
  pick(id) { const p = PUZZLES.find(p => p.id === id); this.setState({ puzzleId: id, term: p.term, history: [], hoverRedexId: null }) }
  hover(id) { this.setState({ hoverRedexId: id }) }

  // handlers shared by a redex span (term) and its detour node (proof)
  redexProps(id) {
    return {
      onClick: e => { e.stopPropagation(); this.reduce(id) },
      onMouseEnter: () => this.hover(id),
      onMouseLeave: () => this.hover(null),
    }
  }

  // --- interactive term banner (custom DOM, so subterms stay clickable) ---
  termView(node, path) {
    switch (node.kind) {
      case "var":
        return node.name
      case "lam":
        return html`λ${node.param}:${typeToString(node.type)}.${this.termView(node.body, bodyPath(path))}`
      case "app": {
        const inner = html`${this.fnView(node.fn, fnPath(path))}<span class="sp"> </span>${this.argView(node.arg, argPath(path))}`
        if (!isRedex(node)) return inner
        const hot = this.state.hoverRedexId === path
        return html`<span class=${"redex" + (hot ? " hot" : "")} ...${this.redexProps(path)}>${inner}</span>`
      }
    }
  }
  fnView(node, path) {   // function position: a λ needs parens; an application stays bare
    return node.kind === "lam"
      ? html`<span class="paren">(${this.termView(node, path)})</span>`
      : this.termView(node, path)
  }
  argView(node, path) {  // argument position: anything but a bare variable gets parens
    return node.kind === "var"
      ? node.name
      : html`<span class="paren">(${this.termView(node, path)})</span>`
  }

  // --- the typing derivation, as ProofML ---
  view(node) {
    if (node.premises.length === 0)                       // a leaf assumption (var)
      return html`<proof-proposition key=${node.path}><${Tex} tex=${node.judgement.tex} /></proof-proposition>`

    const detour = !!node.redexId
    const hot = detour && this.state.hoverRedexId === node.redexId
    const props = detour ? this.redexProps(node.redexId) : {}
    const label = node.rule === "→I"
      ? html`→I<sup>${node.discharge}</sup>`
      : node.rule
    return html`<proof-tree key=${node.path} class=${detour ? "detour" + (hot ? " hot" : "") : ""} ...${props}>
      <proof-forest>${node.premises.map(p => this.view(p))}</proof-forest>
      <proof-proposition><${Tex} tex=${node.judgement.tex} /></proof-proposition>
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
          <h1>β-reduction <span class="eq">=</span> proof normalization</h1>
          <p class="lede">${html`A typed λ-term's typing derivation `}<em>is</em>${html` a proof. A redex `}<code>(λx.t) u</code>${html` is an introduce-then-eliminate `}<em>detour</em>${html` (an →I sitting right under an →E); β-reducing it removes the detour — that's proof `}<em>normalization</em>${html`. Click a redex — in the term or in the proof — to take a step.`}</p>
        </header>

        <nav class="puzzles">
          ${PUZZLES.map(p => html`<button class=${"pz" + (p.id === puzzle.id ? " on" : "")} onClick=${() => this.pick(p.id)}>${p.name}</button>`)}
        </nav>
        <p class="blurb">${puzzle.blurb}</p>

        <div class="term" onMouseLeave=${() => this.hover(null)}>${this.termView(term, ROOT)}</div>

        <div class="status">
          ${normal
            ? html`<span class="win">✓ normal form — ${steps} step${steps === 1 ? "" : "s"} 🎉</span>`
            : html`<span class="hint">${rs.length} redex${rs.length === 1 ? "" : "es"} — click one to reduce</span>`}
          <span class="spacer"></span>
          <button onClick=${() => this.back()} disabled=${steps === 0}>↶ step back</button>
          <button onClick=${() => this.reset()} disabled=${steps === 0}>reset</button>
        </div>

        <figure class="derivation">${this.view(deriv)}</figure>
      </div>`
  }
}

render(html`<${Game} />`, document.getElementById("app"))
