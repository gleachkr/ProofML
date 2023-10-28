const registry = window.customElements

class Root extends HTMLElement {
  connectedCallback() {
    this.attachShadow({ mode: "open" })
    const style = document.createElement("style")
    style.textContent = `
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
    this.shadowRoot.appendChild(style);
    [...this.children].map(child => this.shadowRoot.appendChild(child))
  }
}

class Tree extends HTMLElement {

  constructor() {
    super()
    this.attachShadow({ mode: "open" })
  }

  connectedCallback() {
    this.className = "tree"
    if (this.initialized) return 
    else this.initialized = true
    const style = document.createElement("style")
    console.log(this.parentElement.tagName)
    style.textContent = `
      .left-space, .right-space {
        flex-grow:1;
        min-width:.5em;
      }

      .right-space {
        border-bottom: ${this.nextElementSibling ? "1px solid black" : "none"};
        position:relative;
      }

      .left-space {
        border-bottom: ${this.previousElementSibling ? "1px solid black" : "none"};
      }

      .content {
        border-bottom: ${this.parentElement.tagName === "PROOF-ROOT" ?  "none" : "1px solid black"};
        padding:0 .5em 0 .5em;
      }

      .base {
        display: flex;
        flex-wrap: nowrap;
        flex-direction: row;
        justify-content: center;
      }

    `
    const leftSpace = document.createElement("div")
    leftSpace.className = "left-space"

    const content = document.createElement("div")
    content.className = "content"

    const rightSpace = document.createElement("div")
    rightSpace.className = "right-space"

    const base = document.createElement("div")
    base.className = "base"

    const nodeSlot = document.createElement("slot")
    nodeSlot.setAttribute("name","node")

    const inferenceSlot = document.createElement("slot")
    inferenceSlot.setAttribute("name","inference")

    const forestSlot = document.createElement("slot")
    forestSlot.setAttribute("name","forest")

    this.shadowRoot.appendChild(style)
    this.shadowRoot.appendChild(forestSlot)
    this.shadowRoot.appendChild(base)
    base.appendChild(leftSpace)
    base.appendChild(content)
    base.appendChild(rightSpace)
    rightSpace.appendChild(inferenceSlot)
    content.appendChild(nodeSlot)
  }
}

class Node extends HTMLElement {
  connectedCallback() {
    this.className = "node"
    this.setAttribute("slot","node")
  }
}

class Inference extends HTMLElement {
  connectedCallback() {
    this.className = "inference"
    this.setAttribute("slot","inference")
  }
}

class Forest extends HTMLElement {
  connectedCallback() {
    this.className = "forest"
    this.setAttribute("slot","forest")
  }
}

registry.define("proof-forest", Forest)
registry.define("proof-tree", Tree)
registry.define("proof-root", Root)
registry.define("proof-tree-inference", Inference)
registry.define("proof-tree-node", Node)
