// A small typed lambda calculus with implication (→), conjunction (∧, products)
// and disjunction (∨, sums), written as pure, DOM-free functions so it can be
// unit-tested directly under node. The beta-game UI keeps a term as its canonical
// model and derives the typing derivation (a proof) from it via `derive`. Every
// connective's reduction rule is an intro-under-elim *detour*:
//
//   →:  (λx.t) u                       → t[u/x]          (→I under →E)
//   ∧:  fst ⟨t,u⟩ → t,  snd ⟨t,u⟩ → u                    (∧I under ∧E)
//   ∨:  case (inl t) of inl x⇒u | inr y⇒v → u[t/x]       (∨I under ∨E)
//
// so re-deriving a contractum reproduces proof normalization with no separate
// normalization engine. Two flavours of step are modelled:
//
//   • principal reductions (above) — an introduction met by its own elimination.
//   • commuting conversions — an elimination *stuck* on a ∨E, i.e. whose major
//     premise is itself a `case`. The elimination is pushed into both branches,
//     unblocking the principal redexes hiding inside. With sums in the calculus
//     these are *required*: principal reductions alone do NOT reach normal form
//     (e.g. `fst (case s of inl x ⇒ ⟨a,b⟩ | inr y ⇒ ⟨c,d⟩)` has no principal
//     redex yet is plainly not normal). We still omit η.

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

// terms
export const v = name => ({ kind: "var", name })
export const lam = (param, type, body) => ({ kind: "lam", param, type, body })
export const app = (fn, arg) => ({ kind: "app", fn, arg })
export const pair = (left, right) => ({ kind: "pair", left, right })
export const fst = arg => ({ kind: "fst", arg })
export const snd = arg => ({ kind: "snd", arg })
// inl t : A ∨ B with t:A and `other` = B (the right side); inr is the mirror.
export const inl = (term, other) => ({ kind: "inl", term, other })
export const inr = (term, other) => ({ kind: "inr", term, other })
// case scrut of inl xl ⇒ bodyL | inr yr ⇒ bodyR  (xl binds in bodyL, yr in bodyR)
export const caseOf = (scrut, xl, bodyL, yr, bodyR) => ({ kind: "case", scrut, xl, bodyL, yr, bodyR })

// types
export const base = name => ({ kind: "base", name })
export const arr = (from, to) => ({ kind: "arrow", from, to })
export const prod = (left, right) => ({ kind: "prod", left, right })
export const sum = (left, right) => ({ kind: "sum", left, right })

// ---------------------------------------------------------------------------
// Paths: a stable string id for every position in a term. Every traversal here
// (redex finding, reduction, derivation, the term renderer) descends with the
// SAME convention, so a given subterm gets the SAME path everywhere — that's how
// a redex in the term banner is matched to its detour in the rendered proof.
// ---------------------------------------------------------------------------

export const ROOT = "r"
export const fnPath = p => p + "/f"
export const argPath = p => p + "/a"
export const bodyPath = p => p + "/b"
export const leftPath = p => p + "/0"
export const rightPath = p => p + "/1"
export const scrutPath = p => p + "/s"
export const termPath = p => p + "/t"

// ---------------------------------------------------------------------------
// Free variables / fresh names (for capture-avoiding substitution)
// ---------------------------------------------------------------------------

const union = (a, b) => new Set([...a, ...b])

export function freeVars(t) {
  switch (t.kind) {
    case "var": return new Set([t.name])
    case "app": return union(freeVars(t.fn), freeVars(t.arg))
    case "lam": { const s = freeVars(t.body); s.delete(t.param); return s }
    case "pair": return union(freeVars(t.left), freeVars(t.right))
    case "fst": case "snd": return freeVars(t.arg)
    case "inl": case "inr": return freeVars(t.term)
    case "case": {
      const l = freeVars(t.bodyL); l.delete(t.xl)
      const r = freeVars(t.bodyR); r.delete(t.yr)
      return union(freeVars(t.scrut), union(l, r))
    }
  }
}

// a name like `x` not clashing with anything in `avoid`: x, x', x'', …
function freshName(base, avoid) {
  let name = base
  while (avoid.has(name)) name += "'"
  return name
}

// ---------------------------------------------------------------------------
// Capture-avoiding substitution  t[name := replacement]
// ---------------------------------------------------------------------------

// substitute under a binder, α-renaming it if it would capture a free var of `rep`
function substBinder(binder, body, name, rep) {
  if (binder === name) return [binder, body]                 // shadowed: stop
  if (freeVars(rep).has(binder)) {                           // would capture: α-rename
    const fresh = freshName(binder, new Set([...freeVars(rep), ...freeVars(body), name]))
    return [fresh, subst(subst(body, binder, v(fresh)), name, rep)]
  }
  return [binder, subst(body, name, rep)]
}

export function subst(t, name, rep) {
  switch (t.kind) {
    case "var": return t.name === name ? rep : t
    case "app": return app(subst(t.fn, name, rep), subst(t.arg, name, rep))
    case "lam": { const [p, b] = substBinder(t.param, t.body, name, rep); return lam(p, t.type, b) }
    case "pair": return pair(subst(t.left, name, rep), subst(t.right, name, rep))
    case "fst": return fst(subst(t.arg, name, rep))
    case "snd": return snd(subst(t.arg, name, rep))
    case "inl": return inl(subst(t.term, name, rep), t.other)
    case "inr": return inr(subst(t.term, name, rep), t.other)
    case "case": {
      const [xl, bL] = substBinder(t.xl, t.bodyL, name, rep)
      const [yr, bR] = substBinder(t.yr, t.bodyR, name, rep)
      return caseOf(subst(t.scrut, name, rep), xl, bL, yr, bR)
    }
  }
}

// ---------------------------------------------------------------------------
// Redexes and reduction
// ---------------------------------------------------------------------------

export const isRedex = t =>
  (t.kind === "app" && t.fn.kind === "lam") ||
  (t.kind === "fst" && t.arg.kind === "pair") ||
  (t.kind === "snd" && t.arg.kind === "pair") ||
  (t.kind === "case" && (t.scrut.kind === "inl" || t.scrut.kind === "inr"))

// A commuting (permutative) conversion: an elimination whose principal premise
// is a `case` (∨E). fst/snd of a case, a case applied as a function, and a case
// scrutinising a case all "commute" — the outer elimination is duplicated into
// both branches of the inner case. Disjoint from isRedex (there the principal
// premise is an introduction, here it is a ∨E).
export const isCommuting = t =>
  ((t.kind === "fst" || t.kind === "snd") && t.arg.kind === "case") ||
  (t.kind === "app" && t.fn.kind === "case") ||
  (t.kind === "case" && t.scrut.kind === "case")

// which kind of reducible position `t` is, if any — the term banner and the
// proof both colour the two flavours differently off this.
export const redexKindOf = t =>
  isRedex(t) ? "principal" : isCommuting(t) ? "commuting" : null

// every redex in `t`, as { id, term, kind }, in a stable left-to-right traversal
export function redexes(t, path = ROOT, out = []) {
  if (isRedex(t)) out.push({ id: path, term: t, kind: "principal" })
  else if (isCommuting(t)) out.push({ id: path, term: t, kind: "commuting" })
  switch (t.kind) {
    case "app": redexes(t.fn, fnPath(path), out); redexes(t.arg, argPath(path), out); break
    case "lam": redexes(t.body, bodyPath(path), out); break
    case "pair": redexes(t.left, leftPath(path), out); redexes(t.right, rightPath(path), out); break
    case "fst": case "snd": redexes(t.arg, argPath(path), out); break
    case "inl": case "inr": redexes(t.term, termPath(path), out); break
    case "case":
      redexes(t.scrut, scrutPath(path), out)
      redexes(t.bodyL, leftPath(path), out)
      redexes(t.bodyR, rightPath(path), out)
      break
  }
  return out
}

export const isNormal = t => redexes(t).length === 0

// contract exactly the step at `id` (principal reduction or commuting
// conversion); returns a fresh term, original untouched
export function reduceAt(t, id, path = ROOT) {
  if (path === id) {
    if (isRedex(t)) {
      switch (t.kind) {
        case "app": return subst(t.fn.body, t.fn.param, t.arg)
        case "fst": return t.arg.left
        case "snd": return t.arg.right
        case "case": return t.scrut.kind === "inl"
          ? subst(t.bodyL, t.xl, t.scrut.term)
          : subst(t.bodyR, t.yr, t.scrut.term)
      }
    }
    if (isCommuting(t)) return commute(t)
  }
  switch (t.kind) {
    case "app": return app(reduceAt(t.fn, id, fnPath(path)), reduceAt(t.arg, id, argPath(path)))
    case "lam": return lam(t.param, t.type, reduceAt(t.body, id, bodyPath(path)))
    case "pair": return pair(reduceAt(t.left, id, leftPath(path)), reduceAt(t.right, id, rightPath(path)))
    case "fst": return fst(reduceAt(t.arg, id, argPath(path)))
    case "snd": return snd(reduceAt(t.arg, id, argPath(path)))
    case "inl": return inl(reduceAt(t.term, id, termPath(path)), t.other)
    case "inr": return inr(reduceAt(t.term, id, termPath(path)), t.other)
    case "case": return caseOf(
      reduceAt(t.scrut, id, scrutPath(path)), t.xl,
      reduceAt(t.bodyL, id, leftPath(path)), t.yr,
      reduceAt(t.bodyR, id, rightPath(path)))
    default: return t
  }
}

// Push the outer elimination of a commuting redex into both branches of its
// inner `case`. `c` is that inner case; `rebuild` re-wraps a branch body in the
// outer elimination; `extraFV` are the free variables the rebuild injects into a
// branch (so a branch binder capturing one must be α-renamed first).
function commute(t) {
  let c, rebuild, extraFV
  switch (t.kind) {
    case "fst": c = t.arg; rebuild = b => fst(b); extraFV = new Set(); break
    case "snd": c = t.arg; rebuild = b => snd(b); extraFV = new Set(); break
    case "app": c = t.fn; rebuild = b => app(b, t.arg); extraFV = freeVars(t.arg); break
    case "case": {
      c = t.scrut
      rebuild = b => caseOf(b, t.xl, t.bodyL, t.yr, t.bodyR)
      const l = freeVars(t.bodyL); l.delete(t.xl)
      const r = freeVars(t.bodyR); r.delete(t.yr)
      extraFV = union(l, r)
      break
    }
  }
  const [xl, bL] = avoidCapture(c.xl, c.bodyL, extraFV)
  const [yr, bR] = avoidCapture(c.yr, c.bodyR, extraFV)
  return caseOf(c.scrut, xl, rebuild(bL), yr, rebuild(bR))
}

// α-rename `binder` (and its uses in `body`) to a fresh name when it would
// capture one of `avoid`; otherwise leave the branch untouched.
function avoidCapture(binder, body, avoid) {
  if (!avoid.has(binder)) return [binder, body]
  const fresh = freshName(binder, union(avoid, freeVars(body)))
  return [fresh, subst(body, binder, v(fresh))]
}

// ---------------------------------------------------------------------------
// Pretty-printing — plain string and KaTeX (tex). Type precedence (loose→tight):
// → (1, right-assoc) < ∨ (2) < ∧ (3) < atom (4). Terms: λ and case bind loosely
// and extend right; application and the prefix forms (fst/snd/inl/inr) bind tight.
// ---------------------------------------------------------------------------

// types — `min` is the precedence above which this node must be parenthesized
function typeStr(ty, min = 0) {
  let out, prec
  switch (ty.kind) {
    case "base": return ty.name
    case "arrow": prec = 1; out = `${typeStr(ty.from, 2)} → ${typeStr(ty.to, 1)}`; break
    case "sum": prec = 2; out = `${typeStr(ty.left, 2)} ∨ ${typeStr(ty.right, 3)}`; break
    case "prod": prec = 3; out = `${typeStr(ty.left, 3)} ∧ ${typeStr(ty.right, 4)}`; break
  }
  return prec < min ? `(${out})` : out
}
export const typeToString = ty => typeStr(ty)

// a variable/base name as tex, turning a trailing digit run into a subscript
function texName(name) {
  const m = /^([^\d]+)(\d+)$/.exec(name)
  return m ? `${m[1]}_{${m[2]}}` : name
}

function typeTex(ty, min = 0) {
  let out, prec
  switch (ty.kind) {
    case "base": return texName(ty.name)
    case "arrow": prec = 1; out = `${typeTex(ty.from, 2)} \\to ${typeTex(ty.to, 1)}`; break
    case "sum": prec = 2; out = `${typeTex(ty.left, 2)} \\lor ${typeTex(ty.right, 3)}`; break
    case "prod": prec = 3; out = `${typeTex(ty.left, 3)} \\land ${typeTex(ty.right, 4)}`; break
  }
  return prec < min ? `(${out})` : out
}
export const typeToTex = ty => typeTex(ty)

// terms (string)
export function termToString(t) {
  switch (t.kind) {
    case "var": return t.name
    case "lam": return `λ${t.param}:${typeToString(t.type)}.${termToString(t.body)}`
    case "app": return `${appLeftStr(t.fn)} ${atomStr(t.arg)}`
    case "pair": return `⟨${termToString(t.left)}, ${termToString(t.right)}⟩`
    case "fst": return `fst ${atomStr(t.arg)}`
    case "snd": return `snd ${atomStr(t.arg)}`
    case "inl": return `inl ${atomStr(t.term)}`
    case "inr": return `inr ${atomStr(t.term)}`
    case "case": return `case ${appLeftStr(t.scrut)} of inl ${t.xl} ⇒ ${termToString(t.bodyL)} | inr ${t.yr} ⇒ ${termToString(t.bodyR)}`
  }
}
const atomStr = t => t.kind === "var" ? t.name : t.kind === "pair" ? termToString(t) : `(${termToString(t)})`
const appLeftStr = t => (t.kind === "lam" || t.kind === "case") ? `(${termToString(t)})` : termToString(t)

// terms (tex)
export function termToTex(t) {
  switch (t.kind) {
    case "var": return texName(t.name)
    case "lam": return `\\lambda ${texName(t.param)}{:}${typeToTex(t.type)}.\\,${termToTex(t.body)}`
    case "app": return `${appLeftTex(t.fn)}\\;${atomTex(t.arg)}`
    case "pair": return `\\langle ${termToTex(t.left)}, ${termToTex(t.right)}\\rangle`
    case "fst": return `\\mathsf{fst}\\;${atomTex(t.arg)}`
    case "snd": return `\\mathsf{snd}\\;${atomTex(t.arg)}`
    case "inl": return `\\mathsf{inl}\\;${atomTex(t.term)}`
    case "inr": return `\\mathsf{inr}\\;${atomTex(t.term)}`
    case "case": return `\\mathsf{case}\\;${appLeftTex(t.scrut)}\\;\\mathsf{of}\\;\\mathsf{inl}\\,${texName(t.xl)}\\Rightarrow ${termToTex(t.bodyL)}\\mid \\mathsf{inr}\\,${texName(t.yr)}\\Rightarrow ${termToTex(t.bodyR)}`
  }
}
const atomTex = t => t.kind === "var" ? texName(t.name) : t.kind === "pair" ? termToTex(t) : `(${termToTex(t)})`
const appLeftTex = t => (t.kind === "lam" || t.kind === "case") ? `(${termToTex(t)})` : termToTex(t)

// ---------------------------------------------------------------------------
// Typing derivation. ctx maps free-variable name → type. Each node carries its
// judgement as `term : type`. A detour node (an elimination sitting directly on
// the matching introduction) gets `redexId` set to its path, flagging it clickable.
// ---------------------------------------------------------------------------

const judgement = (term, type) => ({
  tex: `${termToTex(term)} : ${typeToTex(type)}`,
  text: `${termToString(term)} : ${typeToString(type)}`,
})

export function derive(ctx, term, path = ROOT) {
  switch (term.kind) {
    case "var": {
      const type = ctx[term.name]
      if (!type) throw new Error(`unbound variable: ${term.name}`)
      return { path, rule: "var", term, type, premises: [], judgement: judgement(term, type) }
    }
    case "lam": {
      const premise = derive({ ...ctx, [term.param]: term.type }, term.body, bodyPath(path))
      const type = arr(term.type, premise.type)
      return { path, rule: "→I", discharge: term.param, term, type, premises: [premise], judgement: judgement(term, type) }
    }
    case "app": {
      const fnD = derive(ctx, term.fn, fnPath(path))
      const argD = derive(ctx, term.arg, argPath(path))
      if (fnD.type.kind !== "arrow") throw new Error(`applying a non-function: ${termToString(term.fn)}`)
      return {
        path, rule: "→E", term, type: fnD.type.to,
        redexId: redexKindOf(term) ? path : null, redexKind: redexKindOf(term),
        premises: [fnD, argD], judgement: judgement(term, fnD.type.to),
      }
    }
    case "pair": {
      const l = derive(ctx, term.left, leftPath(path))
      const r = derive(ctx, term.right, rightPath(path))
      const type = prod(l.type, r.type)
      return { path, rule: "∧I", term, type, premises: [l, r], judgement: judgement(term, type) }
    }
    case "fst": {
      const d = derive(ctx, term.arg, argPath(path))
      if (d.type.kind !== "prod") throw new Error("fst of a non-product")
      return {
        path, rule: "∧E₁", term, type: d.type.left,
        redexId: redexKindOf(term) ? path : null, redexKind: redexKindOf(term),
        premises: [d], judgement: judgement(term, d.type.left),
      }
    }
    case "snd": {
      const d = derive(ctx, term.arg, argPath(path))
      if (d.type.kind !== "prod") throw new Error("snd of a non-product")
      return {
        path, rule: "∧E₂", term, type: d.type.right,
        redexId: redexKindOf(term) ? path : null, redexKind: redexKindOf(term),
        premises: [d], judgement: judgement(term, d.type.right),
      }
    }
    case "inl": {
      const d = derive(ctx, term.term, termPath(path))
      const type = sum(d.type, term.other)
      return { path, rule: "∨I₁", term, type, premises: [d], judgement: judgement(term, type) }
    }
    case "inr": {
      const d = derive(ctx, term.term, termPath(path))
      const type = sum(term.other, d.type)
      return { path, rule: "∨I₂", term, type, premises: [d], judgement: judgement(term, type) }
    }
    case "case": {
      const s = derive(ctx, term.scrut, scrutPath(path))
      if (s.type.kind !== "sum") throw new Error("case on a non-sum")
      const l = derive({ ...ctx, [term.xl]: s.type.left }, term.bodyL, leftPath(path))
      const r = derive({ ...ctx, [term.yr]: s.type.right }, term.bodyR, rightPath(path))
      if (typeToString(l.type) !== typeToString(r.type)) throw new Error("case branches disagree on type")
      return {
        path, rule: "∨E", discharges: [term.xl, term.yr], term, type: l.type,
        redexId: redexKindOf(term) ? path : null, redexKind: redexKindOf(term),
        premises: [s, l, r], judgement: judgement(term, l.type),
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Curated puzzles. ctx types any free variables so each term stays well-typed.
// ---------------------------------------------------------------------------

const A = base("A"), B = base("B"), C = base("C"), D = base("D"), E = base("E")

export const PUZZLES = [
  {
    id: "identity", name: "Identity (→)",
    blurb: "One detour. The →I/→E pair cancels and the proof shrinks by a step.",
    ctx: { y: A },
    term: app(lam("x", A, v("x")), v("y")),
  },
  {
    id: "constant", name: "K (→)",
    blurb: "K throws its second argument away — watch normalization delete a whole branch of the proof.",
    ctx: { a: A, b: B },
    term: app(app(lam("x", A, lam("y", B, v("x"))), v("a")), v("b")),
  },
  {
    id: "duplication", name: "Double (→)",
    blurb: "The argument is used twice, so its subderivation is grafted onto two leaves — normalization copies a branch.",
    ctx: { g: arr(A, A), z: A },
    term: app(app(lam("f", arr(A, A), lam("x", A, app(v("f"), app(v("f"), v("x"))))), v("g")), v("z")),
  },
  {
    id: "confluence", name: "Two redexes (→)",
    blurb: "Two detours: reduce them in either order and you land on the same normal form (confluence).",
    ctx: { z: A },
    term: app(lam("x", A, v("x")), app(lam("y", A, v("y")), v("z"))),
  },
  {
    id: "projection", name: "Projection (∧)",
    blurb: "fst of a pair is a ∧I directly under a ∧E — the detour cancels, leaving just the first component.",
    ctx: { y: A, z: B },
    term: fst(pair(v("y"), v("z"))),
  },
  {
    id: "swap-prod", name: "Swap a pair (∧)",
    blurb: "A function that swaps a pair: one β-step, then two ∧-detours, reaching ⟨z, y⟩.",
    ctx: { y: A, z: B },
    term: app(lam("p", prod(A, B), pair(snd(v("p")), fst(v("p")))), pair(v("y"), v("z"))),
  },
  {
    id: "case", name: "Case on inl (∨)",
    blurb: "A case on inl is a ∨I under a ∨E. Reduction selects the left branch and plugs the value in.",
    ctx: { y: A, f: arr(A, C), g: arr(B, C) },
    term: caseOf(inl(v("y"), B), "x", app(v("f"), v("x")), "w", app(v("g"), v("w"))),
  },
  {
    id: "swap-sum", name: "Swap a sum (∨)",
    blurb: "A function swapping the sides of a disjunction, applied to inl y: β, then a ∨-detour, give inr y.",
    ctx: { y: A },
    term: app(lam("s", sum(A, B), caseOf(v("s"), "x", inr(v("x"), B), "w", inl(v("w"), A))), inl(v("y"), B)),
  },
  {
    id: "commute-fst", name: "Stuck fst (∨)",
    blurb: "No detour to remove — yet it isn't normal. fst is stuck on a ∨E. A commuting conversion (blue) pushes fst into both branches, exposing the ∧-detours hidden inside; then they cancel.",
    ctx: { s: sum(A, A), b: B },
    term: fst(caseOf(v("s"), "x", pair(v("x"), v("b")), "y", pair(v("y"), v("b")))),
  },
  {
    id: "commute-app", name: "Apply past a case (∨)",
    blurb: "A function chosen by a case, then applied. Nothing principal can fire until the application commutes past the ∨E into both branches.",
    ctx: { s: sum(arr(C, D), arr(C, D)), u: C },
    term: app(caseOf(v("s"), "x", v("x"), "y", v("y")), v("u")),
  },
  {
    id: "commute-case", name: "Case of a case (∨)",
    blurb: "A case scrutinising a case. The outer ∨E commutes into the inner branches, turning two stuck eliminations into ordinary ∨-detours that then fire.",
    ctx: { s: sum(A, A), f: arr(A, E), g: arr(A, E) },
    term: caseOf(
      caseOf(v("s"), "x", inl(v("x"), A), "y", inr(v("y"), A)),
      "a", app(v("f"), v("a")), "b", app(v("g"), v("b"))),
  },
]
