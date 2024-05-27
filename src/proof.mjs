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

      this.propWrapper = document.createElement("div")
      this.propWrapper.id = "prop-wrapper"

      this.shadowRoot.appendChild(this.styleSheet)
      this.shadowRoot.appendChild(this.forestSlot)
      this.shadowRoot.appendChild(this.node)

      this.node.appendChild(this.leftStrut)
      this.node.appendChild(this.propWrapper)
      this.node.appendChild(this.rightStrut)

      this.propWrapper.appendChild(this.propositionSlot)

      this.rightStrut.appendChild(this.inferenceSlot)
      this.inferenceOffsetX = 0
      this.inferenceOffsetY = 0

      this.listener = new ResizeObserver(() => {
        this.dispatchEvent(new Event("proofml-resize", { "bubbles": true }))
        this.handleResize()
      })

      this.propositionSlot.addEventListener("slotchange", () => {
        this.listener.disconnect()
        this.propositionSlot.assignedElements().forEach(elt => this.listener.observe(elt))
        this.handleResize()
      })

      this.addEventListener("proofml-resize", ev => {
        if (ev.target != this) {
          this.handleResize()
          ev.stopPropagation()
        }
      })

      this.addEventListener("proofml-forest-child-change", ev => {
        this.styleSheet.textContent = this.getStyleContent()
        ev.stopPropagation()
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

  isForestInhabited() {
    return this.forestSlot.assignedElements()
      .map(elt => [...elt.children])
      .flat()
      .length > 0
  }

  adjustLabels() {
    //needed to compensate for CSS scaling. This assumes scaling is uniform.
    const scalefactor = this.offsetWidth / this.getBoundingClientRect().width

    const stems = this.forestSlot.assignedElements()
      .map(elt => [...elt.children])
      .flat()

    const rootbox = this.propWrapper.getBoundingClientRect()

    const offsetToProp = this.getPropClientRect().right - rootbox.right

    if (stems.length == 0) {
      this.inferenceOffsetX = offsetToProp
    } else {
      const stembox = stems
        .map(elt => elt.propWrapper?.getBoundingClientRect() || elt.getBoundingClientRect())
        .reduce(mergeBoxes)
      this.inferenceOffsetX = Math.max(offsetToProp, stembox.right - rootbox.right) * scalefactor
    }

    const labels = this.inferenceSlot.assignedElements()
    if (labels.length == 0) {
      this.inferenceOffsetY = 0
    } else {
      const labelbox = labels
        .map(elt => elt.getBoundingClientRect()).reduce(mergeBoxes)
      this.inferenceOffsetY = (rootbox.height - (labelbox.height / 2)) * scalefactor
    }
  }

  computeNodeMin() {
    const scalefactor = this.offsetWidth / this.getBoundingClientRect().width
    const error = Math.abs(this.propBelow - Math.floor(scalefactor * this.getPropClientRect().width))
    //making sure the update is big enough prevents resize thrashing
    if (isNaN(error) || error > 5) {
      this.propBelow = Math.floor(scalefactor * this.getPropClientRect().width)
    }
  }

  handleResize() {
    console.log('resize')
    this.adjustLabels()
    this.computeNodeMin()
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
      --prop-below:${this.propBelow}px;
    }

    ::slotted([slot=proposition]) {
      ${this.isForestInhabited() ? "" : "border-top: var(--border-width-internal-original) solid var(--border-color-internal);"}
    }

    #prop-wrapper {
      ${this.inForest ? "border-bottom: var(--border-width-internal) solid var(--border-color-internal);" : ""}
      min-width: calc(var(--prop-below) / var(--forest-count));
      display:flex;
      justify-content: center;
    }

    #left-strut, #right-strut {
      position:relative;
    }

    :host {
      display:inline-flex;
      flex-direction:column;
      justify-content:end;
      --border-width-internal: calc(var(--border-width-internal-original) * var(--hide-border, 1));
      --border-width-internal-original: var(--border-width, 1px);
      --border-color-internal: var(--border-color, black);
      --inference-size-internal: var(--inference-size, .6em);
      --kern-right-internal: var(--kern-right, 25px);
      --kern-left-internal: var(--kern-left, 25px);
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
        --hide-border:1;
        --border-width-internal: calc(var(--hide-border) * var(--border-width, 1px));
        --border-color-internal: var(--border-color, black);
        --foreign-spacing-internal: var(--foreign-spacing,15px)
      }

      ::slotted(proof-proposition) {
        padding: 0px 5px 0px 5px;
        border-bottom: var(--border-width-internal) solid var(--border-color-internal);
        min-width: calc(var(--prop-below) / var(--forest-count));
        display:flex;
        padding-right:var(--foreign-spacing-internal);
        padding-left:var(--foreign-spacing-internal);
        flex-direction:column-reverse;
        justify-content: end;
        align-items:center;
      }

      ::slotted(proof-proposition:first-child) {
        padding-left:0px;
        margin-left:calc(2*var(--foreign-spacing-internal));
      }

      ::slotted(proof-proposition:last-child) {
        padding-right:0px;
        margin-right:calc(2*var(--foreign-spacing-internal));
      }
      `

      this.listener = new ResizeObserver(() => {
        this.dispatchEvent(new Event("proofml-resize", { "bubbles": true }))
      })

      this.mainSlot.addEventListener("slotchange", () => {
        this.dispatchEvent(new Event("proofml-forest-child-change", { "bubbles": true }))
        this.listener.disconnect()
        const elts = this.mainSlot.assignedElements()
        this.style.setProperty("--forest-count",elts.length)
        elts.forEach(
          elt => this.listener.observe(elt)
        )
      })
      this.initialized = true;
    }
  }
}

class Inference extends HTMLElement {
  connectedCallback() {
    if (!this.initialized) {
      this.setAttribute("slot", "inference")
      this.initialized = true
    }
  }
}

class Proposition extends HTMLElement {
  connectedCallback() {
    if (this.parentElement.tagName == "PROOF-TREE") {
      this.setAttribute("slot", "proposition")
    } else {
      this.removeAttribute("slot")
    }
  }
}

window.customElements.define("proof-tree", Tree)
window.customElements.define("proof-proposition", Proposition)
window.customElements.define("proof-inference", Inference)
window.customElements.define("proof-forest", Forest)
