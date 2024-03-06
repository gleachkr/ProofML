function mergeBoxes(box1, box2) {
  const leftEdge = Math.min(box1.x, box2.x)
  const bottomEdge = Math.min(box1.y, box2.y)
  return new DOMRect(
    leftEdge,
    bottomEdge,
    Math.max(box1.right - leftEdge, box2.right - leftEdge),
    Math.max(box1.top - bottomEdge, box2.top - bottomEdge),
  )
}

class Tree extends HTMLElement {

  constructor() {
    super()
    this.attachShadow({ mode: "open" })
  }

  connectedCallback() {
    if (!this.initialized) {
      this.styleSheet = document.createElement("style")

      this.forestSlot = document.createElement("slot")
      this.forestSlot.setAttribute("name", "forest")

      this.propositionSlot = document.createElement("slot")
      this.propositionSlot.setAttribute("name", "proposition")

      this.inferenceSlot = document.createElement("slot")
      this.inferenceSlot.setAttribute("name", "inference")

      this.node = document.createElement("div")
      this.node.id = "node"

      this.leftStrut = document.createElement("div")
      this.leftStrut.id = "left-strut"

      this.rightStrut = document.createElement("div")
      this.rightStrut.id = "right-strut"

      this.shadowRoot.appendChild(this.styleSheet)
      this.shadowRoot.appendChild(this.forestSlot)
      this.shadowRoot.appendChild(this.node)

      this.node.appendChild(this.leftStrut)
      this.node.appendChild(this.propositionSlot)
      this.node.appendChild(this.rightStrut)

      this.rightStrut.appendChild(this.inferenceSlot)
      this.inferenceOffsetX = 0
      this.inferenceOffsetY = 0

      this.listener = new ResizeObserver(() => {
        this.dispatchEvent(new Event("proofml-resize", { "bubbles": true }))
        this.adjustLabels()
      })

      this.propositionSlot.addEventListener("slotchange", () => {
        this.listener.disconnect()
        this.propositionSlot.assignedElements().forEach(elt => this.listener.observe(elt))
        this.adjustLabels()
      })

      this.addEventListener("proofml-resize", ev => {
        if (ev.target != this) {
          this.adjustLabels()
          ev.stopPropagation()
        }
      })

      this.initialized = true;
    }

    this.inForest = this.parentElement.tagName == "PROOF-FOREST"
    this.styleSheet.textContent = this.getStyleContent()
  }

  getPropClientRect() {
    return this.propositionSlot.assignedElements()
      .map(elt => elt.getBoundingClientRect())
      .reduce(mergeBoxes)
  }

  adjustLabels() {
    const stems = this.forestSlot.assignedElements()
      .map(elt => [...elt.children])
      .flat()
    const rootbox = this.getPropClientRect()
    if (stems.length == 0) {
      this.inferenceOffsetX = 0
    } else {
      const stembox = stems
        .map(elt => elt.getPropClientRect?.() || elt.getBoundingClientRect())
        .reduce(mergeBoxes)
      this.inferenceOffsetX = Math.max(0, stembox.right - rootbox.right)
    }

    const labels = this.inferenceSlot.assignedElements()
    if (labels.length == 0) {
      this.inferenceOffsetY = 0
    } else {
      const labelbox = labels
        .map(elt => elt.getPropClientRect?.() || elt.getBoundingClientRect())
        .reduce(mergeBoxes)
      this.inferenceOffsetY = rootbox.height - (labelbox.height / 2)
    }
    console.log(this.inferenceOffsetY)
    this.styleSheet.textContent = this.getStyleContent()
  }

  getStyleContent() {
    return `
    #node {
      display:grid;
      grid-template-columns: 1fr max-content 1fr;
    }

    ::slotted([slot=forest]) {
      display:flex;
      justify-content:space-around;
    }

    ::slotted([slot=proposition]) {
      padding: 0px 5px 0px 5px;
      margin-bottom: calc(-1 * var(--border-width-internal));
      border-top: var(--border-width-internal) solid var(--border-color-internal);
    }

    #left-strut, #right-strut {
      margin-bottom: calc(-1 * var(--border-width-internal));
      position:relative;
    }

    ${!this.inForest ? "" : ` ::slotted([slot=proposition]) {
      border-bottom: var(--border-width-internal) solid var(--border-color-internal);
    }`}

    :host {
      display:inline-flex;
      flex-direction:column;
      justify-content:end;
      --border-width-internal: var(--border-width, 1px);
      --border-color-internal: var(--border-color, black);
      --inference-size-internal: var(--inference-size, .6em);
      --kern-right-internal: var(--kern-right, 15px);
      --kern-left-internal: var(--kern-left, 15px);
    }

    ::slotted([slot=inference]) {
      position:absolute;
      bottom:${this.inferenceOffsetY}px;
      font-size: var(--inference-size-internal);
      left:${this.inferenceOffsetX}px;
      white-space: nowrap;
    }

    ${!this.inForest ? "" : `:host(:not(:first-child)) #left-strut {
      border-bottom: var(--border-width-internal) solid var(--border-color-internal);
      min-width: var(--kern-left-internal);
    }`}

    ${!this.inForest ? "" : `:host(:not(:last-child)) #right-strut {
      border-bottom: var(--border-width-internal) solid var(--border-color-internal);
      min-width: var(--kern-right-internal);
    }`}
  `}
}

class Forest extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: "open" })
  }

  connectedCallback() {
    if (!this.initialized) {
      this.setAttribute("slot", "forest")
      this.styleSheet = document.createElement("style")

      this.mainSlot = document.createElement("slot")

      this.shadowRoot.appendChild(this.styleSheet)
      this.shadowRoot.appendChild(this.mainSlot)

      this.styleSheet.textContent = `
      :host {
        display:flex;
        justify-content:space-around;
        --border-width-internal: var(--border-width, 1px);
        --border-color-internal: var(--border-color, black)
      }

      ::slotted(:not(proof-tree)) {
        border-bottom: var(--border-width-internal) solid var(--border-color-internal);
        margin-bottom: calc(-1 * var(--border-width-internal));
      }
      `

      this.initialized = true;
    }
  }
}

window.customElements.define("proof-tree", Tree)
window.customElements.define("proof-forest", Forest)
