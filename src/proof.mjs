import { computePosition, autoUpdate } from 'https://cdn.jsdelivr.net/npm/@floating-ui/dom@1.5.3/+esm';

const role = {
  container: Symbol("container"),
  node: Symbol("node"),
}

class Tree extends HTMLElement {

  constructor() {
    super()
    this.attachShadow({ mode: "open" })
  }

  connectedCallback() {
    if (!this.initialized) {
      this.className = "tree"
      this.style.display = "inline-flex"
      this.style.flexWrap = "nowrap"
      this.style.flexDirection = "column"
      this.style.fontSize = "var(--proofml-font-size, 1em)"
      this.style.fontFamily = "var(--proofml-font-family, serif)"

      this.nodeSlot = document.createElement("slot")
      this.nodeSlot.setAttribute("name", "node")

      this.defaultForest = document.createElement("proof-forest")

      this.defaultNode = document.createElement("proof-tree-proposition")
      this.defaultNode.innerHTML = "&nbsp;" // might be able to avoid this with CSS
      this.defaultForest.appendChild(this.defaultNode)

      this.forestSlot = document.createElement("slot")
      this.forestSlot.setAttribute("name", "forest")
      this.forestSlot.appendChild(this.defaultForest)

      this.inferenceSlot = document.createElement("slot")
      this.inferenceSlot.setAttribute("name", "inference")

      this.nodeSlot.addEventListener("slotchange", () => this.updateForestWidth())
      this.inferenceSlot.addEventListener("slotchange", elt => this.updateInference(elt))

      this.shadowRoot.appendChild(this.forestSlot)
      this.shadowRoot.appendChild(this.nodeSlot)
      this.shadowRoot.appendChild(this.inferenceSlot)
      this.initialized = true
    }
  }

  get role() { return role.node }

  updateForestWidth() {
    this.forestSlot.assignedElements().forEach(el => 
      el.getChildNodes().forEach(node=> node.updateStyle())
    )
    this.defaultNode.updateStyle()
  }

  updateInference(elt) {
    if (elt.target.assignedNodes().length > 1) {
      console.error("WARNING: Multiple inferences attached to proof tree", this)
    }
    this.inference = elt.target.assignedNodes()[0]
    this.forestSlot.assignedElements().forEach(el => 
      el.getChildNodes().forEach(node => node.updateLabel())
    )
    this.defaultNode.updateLabel()
  }

  updateStyle() {
    this.getNode().updateStyle()
  }

  updateLabel() {
    this.getNode().updateLabel()
  }

  getInference() {
    return this.inference
  }

  // get the forest that this tree is in, if any
  getContainer() {
    return (this.parentElement?.role === role.container)
      ? this.parentElement
      : null
  }

  // get the child node
  getNode() {
    return this.nodeSlot.assignedElements()[0]
  }

  // get the next adjacent tree
  getNextNode() {
    let next = this.nextElementSibling
    while (next) {
      if (next.role === role.node) return next
      next = next.nextElementSibling
    }
    return false
  }

  // get the previous adjacent tree
  getPrevNode() {
    let next = this.previousElementSibling
    while (next) {
      if (next.role === role.node) return next
      next = next.previousElementSibling
    }
    return false
  }
}

class Proposition extends HTMLElement {
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
  }

  connectedCallback() {

    if (!this.initialized) {

      this.className = "node"
      this.setAttribute("slot", "node")

      this.stylesheet = document.createElement("style")

      const leftSpace = document.createElement("div")
      leftSpace.className = "left-space"

      this.content = document.createElement("div")
      this.contentFrame = document.createElement("div")
      const contentSlot = document.createElement("slot")
      this.contentFrame.className = "content-frame"
      this.content.className = "content"
      this.content.appendChild(contentSlot)
      this.contentFrame.appendChild(this.content)
      
      const rightSpace = document.createElement("div")
      rightSpace.className = "right-space"

      this.shadowRoot.appendChild(this.stylesheet)
      this.shadowRoot.appendChild(leftSpace)
      this.shadowRoot.appendChild(this.contentFrame)
      this.shadowRoot.appendChild(rightSpace)

      this.initialized = true
    }

    const forest = this.getContainer()

    if (forest) {
      this.mutationObserver.observe(forest, {
        childList: true
      })
    }

    //this needs a tick, during initialization, to let everything get slotted
    //properly
    setTimeout(() => {
      // But that means we need to update, because something might have
      // happened before the tick was up
      this.updateStyle()
      this.updateLabel()
      if (forest?.getConsequence()) {
        this.mutationObserver.observe(forest.getConsequence(), {
          childList: true,
          characterData: true,
          subtree:true,
        })
      }
     }, 0)
     this.updateStyle()
     this.updateLabel()
  }

  disconnectedCallback() {
    this.mutationObserver.disconnect()
  }

  getContentWidth() {
    return this.content.getBoundingClientRect().width
  }

  getNextNode() {
    if (this.parentElement.role === role.node) {
      return this.parentElement.getNextNode()
    } else {
      let next = this.nextElementSibling
      while (next) {
        if (next.role === role.node) return next
        next = next.nextElementSibling
      }
      return null
    }
  }

  getPrevNode() {
    if (this.parentElement.role === role.node) {
      return this.parentElement.getPrevNode()
    } else {
      let prev = this.previousElementSibling
      while (prev) {
        if (prev.role === role.node) return prev
        prev = prev.previousElementSibling
      }
      return null
    }
  }

  get role() { return role.node }

  updateLabel() {
    const noNextTree = !this.getNextNode()
    const consumer = this.getConsumer()
    const {x,y} = this.getBoundingClientRect(this.contentFrame)
    const isPositioned = x != 0 || y != 0;

    //release any old listeners
    this.release?.()

    if (consumer && noNextTree && isPositioned) {
      this.release = autoUpdate(this.contentFrame, consumer, () => 
        computePosition(this.contentFrame, consumer, { placement: 'right'})
        .then(({x,y}) => {
          const {height} = this.getBoundingClientRect(this.contentFrame)
          Object.assign(consumer.style, {
            left: `${x}px`,
            top: `${Math.floor(y + (height/2))}px`,
            height: `min-content`
          })
      })
      )
    }  
  }

  updateStyle() {
    const myForest = this.getContainer()
    const myNextTree = this.getNextNode()
    const myPrevTree = this.getPrevNode()
    const mySiblings = myForest?.getChildNodes()
    const myConsequence = myForest?.getConsequence()
    const myShare = myConsequence ? myConsequence.getContentWidth() / mySiblings.length : 0;

    // TODO: make this configurable for just one forest (not cascading) with
    // a forest attribute.
    const borderStyle = "var(--proofml-border, 1px solid black)"

    // Should do this in a more targeted way.
    this.stylesheet.textContent = `
      .left-space, .right-space {
        flex-grow:1;
        min-width:1em;
        position:relative;
      }

      .right-space {
        border-bottom: ${myNextTree ? borderStyle : "none" };
        padding-left: var(--proofml-kern-left,0);
      }

      .left-space {
        border-bottom: ${myPrevTree ? borderStyle : "none" };
        padding-right: var(--proofml-kern-right,0);
      }

      .content-frame {
        line-height:1.3;
        color: var(--proofml-color, black);
        border-bottom: ${myForest ? borderStyle : "none"};
        min-width: max(2em,${myShare}px);
      }

      :host, .content-frame {
        display: flex;
        flex-wrap: nowrap;
        flex-direction: row;
        justify-content: center;
      }
    `
  }

  // get the proof tree housing this node, if any
  getContainer() {
    if (this.parentElement?.role === role.container) {
      return this.parentElement
    } else if (this.parentElement?.role === role.node) {
      return this.parentElement.getContainer()
    } else {
      return null
    }
  }

  // get the inference that is consuming this node
  getConsumer() {
    return this.getContainer()?.getInference()
  }
}

class Inference extends HTMLElement {
  connectedCallback() {
    this.className = "inference"
    this.setAttribute("slot", "inference")
    this.style.position = "absolute"
    this.style.color = "var(--proofml-color, black)"
    this.style.fontSize = ".6em"
    this.style.margin = "0 .5em 0 .5em"
  }
}

class Forest extends HTMLElement {
  connectedCallback() {
    this.className = "forest"
    this.setAttribute("slot", "forest")
    this.style.display = "flex"
    this.style.flexWrap = "nowrap"
    this.style.flexDirection = "row"
    this.style.justifyContent = "center"
    this.style.alignItems = "flex-end"
  }

  get role() { return role.container }

  getInference() {
    // If we're sitting inside a tree, we get the inference from that:
    if (this.parentElement.role === role.node) {
      return this.getParentNode().getInference()
    }
    // If we're sitting inside a slot, we get the inference from a sibling slot
    if (this.parentElement.tagName === "SLOT") {
      return [...this.parentElement.parentNode.children]
        .find(elt => elt.name === "inference")?.assignedNodes()[0]
    }
    return null
  }

  getConsequence() {
    // If we're sitting inside a tree, we get the consequence from that
    if (this.parentElement.role === role.node) {
      return this.getParentNode().getNode()
    }
    // If we're sitting inside a slot, we get the consequence from a sibling slot
    if (this.parentElement.tagName === "SLOT") {
      return [...this.parentElement.parentNode.children]
        .find(elt => elt.name === "node")?.assignedNodes()[0]
    }
    return null
  }

  getChildNodes() {
    return [...this.children].filter(el => el.role === role.node)
  }

  getParentNode() { 
    if (this.parentElement.role === role.node) {
      return this.parentElement
    }
    return null
  }
}

const registry = window.customElements
registry.define("proof-forest", Forest)
registry.define("proof-tree", Tree)
registry.define("proof-tree-inference", Inference)
registry.define("proof-tree-proposition", Proposition)
