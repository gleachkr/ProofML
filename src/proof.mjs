const registry = window.customElements

class Root extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: "open" })
  }

  connectedCallback() {
    if (!this.initialized) {
      const stylesheet = document.createElement("style")
      stylesheet.textContent = `
        .forest {
          display: flex;
          flex-wrap: nowrap;
          flex-direction: row;
          justify-content: center;
          align-items: flex-end;
        }

        .tree, :host {
          display: inline-flex;
          flex-wrap: nowrap;
          flex-direction: column;
        }

        .inference {
          position:absolute;
          bottom:-.5em;
          font-size:.6em;
          margin: 0 .5em 0 .5em;
        }
      `
      this.shadowRoot.appendChild(stylesheet);
      [...this.children].map(child => this.shadowRoot.appendChild(child))

      this.initialized = true
    }
  }
}

class Tree extends HTMLElement {

  constructor() {
    super()
    this.attachShadow({ mode: "open" })
  }

  connectedCallback() {
    if (!this.initialized) {
      this.className = "tree"

      const stylesheet = document.createElement("style")
      stylesheet.textContent = ``

      const nodeSlot = document.createElement("slot")
      nodeSlot.setAttribute("name", "node")

      const forestSlot = document.createElement("slot")
      forestSlot.setAttribute("name", "forest")

      this.shadowRoot.appendChild(stylesheet)
      this.shadowRoot.appendChild(forestSlot)
      this.shadowRoot.appendChild(nodeSlot)
      this.initialized = true
    }
  }

  // get the forest that this tree is in, if any
  getForest() {
    return this.parentElement?.tagName === "PROOF-FOREST"
      ? this.parentElement
      : null
  }

  getNextTree() {
    let next = this.nextElementSibling
    while (next) {
      if (next.tagName === "PROOF-TREE") return next
      next = next.nextElementSibling
    }
    return false
  }

  getPrevTree() {
    let next = this.previousElementSibling
    while (next) {
      if (next.tagName === "PROOF-TREE") return next
      next = next.previousElementSibling
    }
    return false
  }
}

class Node extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: "open" })
  }

  connectedCallback() {
    if (!this.initialized) {

      this.className = "node"
      this.setAttribute("slot", "node")

      this.stylesheet = document.createElement("style")

      this.rightLabel = document.createElement("div")
      this.rightLabel.className = "label"
      const rightSpace = document.createElement("div")
      rightSpace.className = "right-space"
      rightSpace.appendChild(this.rightLabel)

      const content = document.createElement("div")
      const contentSlot = document.createElement("slot")
      content.className = "content"
      content.appendChild(contentSlot)

      this.leftLabel = document.createElement("div")
      this.leftLabel.className = "label"
      const leftSpace = document.createElement("div")
      leftSpace.className = "left-space"
      leftSpace.appendChild(this.leftLabel)

      this.shadowRoot.appendChild(this.stylesheet)
      this.shadowRoot.appendChild(leftSpace)
      this.shadowRoot.appendChild(content)
      this.shadowRoot.appendChild(rightSpace)

      this.initialized = true
    }

    this.updateStyle()
    this.updateLabel()

  }

  //TODO: connect to mutation observer on proof-forest
  updateLabel() {
    const noNextTree = !this.getTree().getNextTree()

    if (this.getConsumer() && noNextTree) {
      this.rightLabel.innerText = this.getConsumer().innerText
    }
  }

  //TODO: connect to mutation observer on proof-forest
  updateStyle() {
    const inForest = this.getTree().getForest()
    const noNextTree = !this.getTree().getNextTree()
    const noPrevTree = !this.getTree().getPrevTree()

    this.stylesheet.textContent = `
      .left-space, .right-space {
        flex-grow:1;
        min-width:.5em;
      }

      .right-space {
        border-bottom: ${noNextTree ? "none" : "1px solid black"};
        position:relative;
      }

      .left-space {
        border-bottom: ${noPrevTree ? "none" : "1px solid black"};
        position: relative;
      }

      .right-space .label {
        position:absolute;
        font-size: .7em;
        bottom: -.6em;
        padding-left: .5em;
      }

      .content {
        border-bottom: ${inForest ? "1px solid black" : "none"};
        padding:0 .5em 0 .5em;
      }

      :host {
        display: flex;
        flex-wrap: nowrap;
        flex-direction: row;
        justify-content: center;
      }
    `
  }

  // get the proof tree housing this node, if any
  getTree() {
    return this.parentElement?.tagName === "PROOF-TREE"
      ? this.parentElement
      : null
  }

  // get the inference that is consuming this node
  getConsumer() {
    return this.getTree()?.getForest()?.getInference()
  }
}

class Inference extends HTMLElement {
  connectedCallback() {
    this.className = "inference"
    this.setAttribute("slot", "inference")
    this.style.display = "none"
  }
}

class Forest extends HTMLElement {
  connectedCallback() {
    this.className = "forest"
    this.setAttribute("slot", "forest")
    const inferences = [...this.children].filter(el => el.tagName === "PROOF-TREE-INFERENCE")
    if (inferences.length > 1) console.error("WARNING: Multiple inferences attached to proof forest", this)
    this.inference = inferences[0]
  }

  getInference() {
    return this.inference
  }
}

registry.define("proof-forest", Forest)
registry.define("proof-tree", Tree)
registry.define("proof-root", Root)
registry.define("proof-tree-inference", Inference)
registry.define("proof-tree-node", Node)
