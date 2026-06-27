// A tiny simply-typed lambda calculus (implication / arrow types only), written
// as pure, DOM-free functions so it can be unit-tested directly under node. The
// beta-game UI keeps a lambda *term* as its canonical model and derives the
// typing derivation (a proof) from it via `derive`. Because the canonical typing
// derivation of a beta-contractum is exactly the normalization of the redex's
// derivation, "reduce the term then re-derive" reproduces proof normalization
// with no separate normalization engine — that's the whole trick.

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

// terms
export const v = name => ({ kind: "var", name })
export const lam = (param, type, body) => ({ kind: "lam", param, type, body })
export const app = (fn, arg) => ({ kind: "app", fn, arg })

// types
export const base = name => ({ kind: "base", name })
export const arr = (from, to) => ({ kind: "arrow", from, to })

// ---------------------------------------------------------------------------
// Paths: a stable string id for every position in a term. Every traversal here
// (redex finding, reduction, derivation) descends with the SAME convention, so
// a given subterm gets the SAME path everywhere — that's how a redex in the term
// banner is matched to its →I/→E detour in the rendered proof.
// ---------------------------------------------------------------------------

export const ROOT = "r"
export const fnPath = p => p + "/f"
export const argPath = p => p + "/a"
export const bodyPath = p => p + "/b"
export const isRedex = t => t.kind === "app" && t.fn.kind === "lam"

// ---------------------------------------------------------------------------
// Free variables / fresh names (for capture-avoiding substitution)
// ---------------------------------------------------------------------------

export function freeVars(t) {
  switch (t.kind) {
    case "var": return new Set([t.name])
    case "app": return new Set([...freeVars(t.fn), ...freeVars(t.arg)])
    case "lam": { const s = freeVars(t.body); s.delete(t.param); return s }
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

export function subst(t, name, replacement) {
  switch (t.kind) {
    case "var":
      return t.name === name ? replacement : t
    case "app":
      return app(subst(t.fn, name, replacement), subst(t.arg, name, replacement))
    case "lam": {
      if (t.param === name) return t                       // shadowed: stop
      const fvRep = freeVars(replacement)
      if (fvRep.has(t.param)) {                            // would capture: α-rename
        const fresh = freshName(t.param, new Set([...fvRep, ...freeVars(t.body), name]))
        const renamed = subst(t.body, t.param, v(fresh))
        return lam(fresh, t.type, subst(renamed, name, replacement))
      }
      return lam(t.param, t.type, subst(t.body, name, replacement))
    }
  }
}

// ---------------------------------------------------------------------------
// Redexes and reduction
// ---------------------------------------------------------------------------

// every β-redex in `t`, as { id, term }, in a stable left-to-right traversal
export function redexes(t, path = ROOT, out = []) {
  if (isRedex(t)) out.push({ id: path, term: t })
  switch (t.kind) {
    case "app": redexes(t.fn, fnPath(path), out); redexes(t.arg, argPath(path), out); break
    case "lam": redexes(t.body, bodyPath(path), out); break
  }
  return out
}

export const isNormal = t => redexes(t).length === 0

// contract exactly the redex at `id`; returns a fresh term, original untouched
export function reduceAt(t, id, path = ROOT) {
  if (path === id && isRedex(t)) return subst(t.fn.body, t.fn.param, t.arg)
  switch (t.kind) {
    case "app": return app(reduceAt(t.fn, id, fnPath(path)), reduceAt(t.arg, id, argPath(path)))
    case "lam": return lam(t.param, t.type, reduceAt(t.body, id, bodyPath(path)))
    default: return t
  }
}

// ---------------------------------------------------------------------------
// Pretty-printing — plain string and KaTeX (tex). λ binds loosely, application
// is left-associative and tighter; arrow types are right-associative.
// ---------------------------------------------------------------------------

export function typeToString(ty) {
  if (ty.kind === "base") return ty.name
  const l = ty.from.kind === "arrow" ? `(${typeToString(ty.from)})` : typeToString(ty.from)
  return `${l} → ${typeToString(ty.to)}`
}

export function termToString(t) {
  switch (t.kind) {
    case "var": return t.name
    case "lam": return `λ${t.param}:${typeToString(t.type)}.${termToString(t.body)}`
    case "app": return `${fnStr(t.fn)} ${argStr(t.arg)}`
  }
}
const fnStr = t => t.kind === "lam" ? `(${termToString(t)})` : termToString(t)         // app & var bare
const argStr = t => t.kind === "var" ? t.name : `(${termToString(t)})`                  // app & lam parenthesized

// a variable name as tex, turning a trailing digit run into a subscript (x1 → x_{1})
function texName(name) {
  const m = /^([^\d]+)(\d+)$/.exec(name)
  return m ? `${m[1]}_{${m[2]}}` : name
}

export function typeToTex(ty) {
  if (ty.kind === "base") return texName(ty.name)
  const l = ty.from.kind === "arrow" ? `(${typeToTex(ty.from)})` : typeToTex(ty.from)
  return `${l} \\to ${typeToTex(ty.to)}`
}

export function termToTex(t) {
  switch (t.kind) {
    case "var": return texName(t.name)
    case "lam": return `\\lambda ${texName(t.param)}{:}${typeToTex(t.type)}.\\,${termToTex(t.body)}`
    case "app": return `${fnTex(t.fn)}\\;${argTex(t.arg)}`
  }
}
const fnTex = t => t.kind === "lam" ? `(${termToTex(t)})` : termToTex(t)
const argTex = t => t.kind === "var" ? texName(t.name) : `(${termToTex(t)})`

// ---------------------------------------------------------------------------
// Typing derivation. ctx maps free-variable name → type. Each node carries its
// judgement as `term : type` (so the term is visible at every node and you watch
// reduction propagate through the proof). An →E node whose function premise is
// an →I is a detour: it gets `redexId` set to its path, flagging it clickable.
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
      return {
        path, rule: "→I", discharge: term.param, term, type,
        premises: [premise], judgement: judgement(term, type),
      }
    }
    case "app": {
      const fnD = derive(ctx, term.fn, fnPath(path))
      const argD = derive(ctx, term.arg, argPath(path))
      if (fnD.type.kind !== "arrow") throw new Error(`applying a non-function: ${termToString(term.fn)}`)
      const type = fnD.type.to
      return {
        path, rule: "→E", term, type,
        redexId: term.fn.kind === "lam" ? path : null,
        premises: [fnD, argD], judgement: judgement(term, type),
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Curated puzzles. ctx types any free variables so each term stays well-typed.
// ---------------------------------------------------------------------------

const A = base("A"), B = base("B")

export const PUZZLES = [
  {
    id: "identity",
    name: "Identity",
    blurb: "One detour. The →I/→E pair cancels and the proof shrinks by a step.",
    ctx: { y: A },
    term: app(lam("x", A, v("x")), v("y")),
  },
  {
    id: "constant",
    name: "K (discard)",
    blurb: "K throws its second argument away — watch normalization delete a whole branch of the proof.",
    ctx: { a: A, b: B },
    term: app(app(lam("x", A, lam("y", B, v("x"))), v("a")), v("b")),
  },
  {
    id: "duplication",
    name: "Double (copy)",
    blurb: "The argument is used twice, so its subderivation is grafted onto two leaves — normalization copies a branch.",
    ctx: { g: arr(A, A), z: A },
    term: app(app(lam("f", arr(A, A), lam("x", A, app(v("f"), app(v("f"), v("x"))))), v("g")), v("z")),
  },
  {
    id: "confluence",
    name: "Two redexes",
    blurb: "Two detours: reduce them in either order and you land on the same normal form (confluence).",
    ctx: { z: A },
    term: app(lam("x", A, v("x")), app(lam("y", A, v("y")), v("z"))),
  },
]
