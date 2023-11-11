import { computePosition, autoUpdate } from 'https://cdn.jsdelivr.net/npm/@floating-ui/dom@1.5.3/+esm';

class Root extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: "open" })
  }

  connectedCallback() {
    if (!this.initialized) {
      const stylesheet = document.createElement("style")
      stylesheet.textContent = `

        :host {
          font-size: var(--proofml-font-size, 1em);
          font-family: var(--proofml-font-family, serif);
        }

        .forest {
          display: flex;
          flex-wrap: nowrap;
          flex-direction: row;
          justify-content: center;
          align-items: flex-end;
        }

        .tree {
          display: inline-flex;
          flex-wrap: nowrap;
          flex-direction: column;
        }

        .tree {
        }

        .inference {
          color: var(--proofml-color, black);
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

      this.nodeSlot = document.createElement("slot")
      this.nodeSlot.setAttribute("name", "node")

      this.forestSlot = document.createElement("slot")
      this.forestSlot.setAttribute("name", "forest")

      //TODO cleanup on disconnectedCallback
      this.nodeSlot.addEventListener("slotchange", () => this.updateForestWidth())

      this.shadowRoot.appendChild(stylesheet)
      this.shadowRoot.appendChild(this.forestSlot)
      this.shadowRoot.appendChild(this.nodeSlot)
      this.initialized = true
    }
  }

  updateForestWidth() {
    this.forestSlot.assignedElements().forEach(el => 
      el.getChildTrees().forEach(tree => 
        tree.getNode().updateStyle()
      )
    )
  }

  // get the forest that this tree is in, if any
  getForest() {
    return this.parentElement?.tagName === "PROOF-FOREST"
      ? this.parentElement
      : null
  }

  // get the child node
  getNode() {
    return this.nodeSlot.assignedElements()[0]
  }

  // get the next adjacent tree
  getNextTree() {
    let next = this.nextElementSibling
    while (next) {
      if (next.tagName === "PROOF-TREE") return next
      next = next.nextElementSibling
    }
    return false
  }

  // get the previous adjacent tree
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

    // the observer repositions the label and recalculates whether the right and
    // left padding should be underlined when new trees appear in the forest
    // containing this node
    this.mutationObserver = new MutationObserver(() => {
      this.updateStyle()
      this.updateLabel()
    })

    this.addEventListener("refresh", () => {
      console.log("change!")
      this.updateStyle()
    })
  }

  connectedCallback() {

    if (!this.initialized) {

      this.className = "node"
      this.setAttribute("slot", "node")

      this.stylesheet = document.createElement("style")

      const rightSpace = document.createElement("div")
      rightSpace.className = "right-space"

      this.content = document.createElement("div")
      const contentSlot = document.createElement("slot")
      this.content.className = "content"
      this.content.appendChild(contentSlot)

      const leftSpace = document.createElement("div")
      leftSpace.className = "left-space"

      this.shadowRoot.appendChild(this.stylesheet)
      this.shadowRoot.appendChild(leftSpace)
      this.shadowRoot.appendChild(this.content)
      this.shadowRoot.appendChild(rightSpace)

      this.initialized = true
    }

    const forest = this.getTree().getForest()

    if (forest) this.mutationObserver.observe(this.getTree().getForest(), {
      childList: true
    })

    this.updateStyle()
    this.updateLabel()

  }

  disconnectedCallback() {
    this.mutationObserver.disconnect()
  }

  getContentWidth() {
    return this.content.getBoundingClientRect().width
  }

  updateLabel() {
    const noNextTree = !this.getTree().getNextTree()
    const consumer = this.getConsumer()
    const content = this.content

    if (consumer && noNextTree) {
      this.release = autoUpdate(content, consumer, () => 
        computePosition(content, consumer, { placement: 'right'})
        .then(({x,y}) => {
          Object.assign(consumer.style, {
            left: `${x}px`,
            top: `calc(${y}px + 1em)`,
            height: `min-content`
          })
      })
      )
    } else {
      // release listeners if we're not the label anchor anymore
      this.release?.()
    }
  }

  updateStyle() {
    const myForest = this.getTree().getForest()
    const myNextTree = this.getTree().getNextTree()
    const myPrevTree = this.getTree().getPrevTree()
    const mySiblings = myForest?.getChildTrees()
    const myConsequence = myForest?.getParentTree().getNode()
    const myShare = myConsequence ? myConsequence.getContentWidth() / mySiblings.length : 0;

    // TODO: make this configurable for just one forest (not cascading) with
    // a forest attribute.
    const borderStyle = "var(--proofml-border, 1px solid black)"

    // TODO: there's got to be a better way than overwriting the whole
    // stylesheet content.
    this.stylesheet.textContent = `
      .left-space, .right-space {
        flex-grow:1;
        min-width:1em;
      }

      .right-space {
        border-bottom: ${myNextTree ? borderStyle : "none" };
        position:relative;
        padding-left: var(--proofml-kern-left,0);
      }

      .left-space {
        border-bottom: ${myPrevTree ? borderStyle : "none" };
        position: relative;
        padding-right: var(--proofml-kern-right,0);
      }

      .content {
        line-height:1.3;
        display: flex;
        flex-wrap: nowrap;
        flex-direction: row;
        justify-content: center;
        color: var(--proofml-color, black);
        border-bottom: ${myForest ? borderStyle : "none"};
        min-width: max(2em,${myShare}px);
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
    this.style.position = "absolute"
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

  getChildTrees() {
    return [...this.children].filter(el => el.tagName === "PROOF-TREE")
  }

  getParentTree() { 
    return this.parentElement?.tagName === "PROOF-TREE"
      ? this.parentElement
      : null
  }
}

const registry = window.customElements
registry.define("proof-forest", Forest)
registry.define("proof-tree", Tree)
registry.define("proof-root", Root)
registry.define("proof-tree-inference", Inference)
registry.define("proof-tree-node", Node)
