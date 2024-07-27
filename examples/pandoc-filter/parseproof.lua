table.append = function (self, ele) table.insert(self, #self + 1, ele) end

string.trim = function(self) return self:gsub("^%s*(.-)%s*$", "%1") end

table.contains = function (self, ele)
    for _,v in ipairs(self) do
        if v == ele then return true end
    end
    return false
end

local reader_options = pandoc.ReaderOptions({
    html_math_method = pandoc.ReaderOptions(PANDOC_READER_OPTIONS).html_math_method
})

local function to_pandoc(s)
    local doc = pandoc.read(s, "markdown", reader_options)
    return pandoc.Plain(doc.blocks[1].content)
end

local function render(tree, decorator)
    local children = {}
    local inference
    if tree.children and #tree.children > 0 then
        inference = tree.children[1].root.contents:match('---+([^%s-]*)')
        if inference then
            for _,child in ipairs(tree.children[1].children) do
                local childArray = render(child, decorator)
                for _,childArrayElt in ipairs(childArray) do
                    table.insert(children, childArrayElt)
                end
            end
        else
            children = render(tree.children[1], decorator)
        end
    end

    local rootContents = tree.root.contents:trim()
    if rootContents and rootContents ~= "" then
        rootContents = decorator(rootContents)
    end
    if #children == 0 and not inference then
        return {
            pandoc.RawBlock("html", "<proof-proposition>"),
            rootContents,
            pandoc.RawBlock("html", "</proof-proposition>"),
        }
    elseif not inference then
        table.insert(children, 1, pandoc.RawBlock("html", '<proof-tree><proof-forest style="--hide-border:0;">'))
        table.insert(children, pandoc.RawBlock("html", '</proof-forest>'))
        table.insert(children, pandoc.RawBlock("html", '<proof-proposition>'))
        table.insert(children, pandoc.Blocks(rootContents))
        table.insert(children, pandoc.RawBlock("html", '</proof-proposition>'))
        table.insert(children, pandoc.RawBlock("html", '</proof-tree>'))
        return children
    else
        table.insert(children, 1, pandoc.RawBlock("html", '<proof-tree><proof-forest>'))
        table.insert(children, pandoc.RawBlock("html", '</proof-forest>'))
        table.insert(children, pandoc.RawBlock("html", '<proof-proposition>'))
        table.insert(children, rootContents)
        table.insert(children, pandoc.RawBlock("html", '</proof-proposition>'))
        if inference:match("%S") then
            table.insert(children, pandoc.RawBlock('html', '<proof-inference>'))
            table.insert(children, to_pandoc(inference))
            table.insert(children, pandoc.RawBlock('html', '</proof-inference>'))
        end
        table.insert(children, pandoc.RawBlock("html", '</proof-tree>'))
        return children
    end
end

local function overlaps(r1,r2)
    return (r1.thestart < r2.theend) and (r1.theend > r2.thestart)
end

local function tabularize (p)
    local lines = {}
    for line in p:gmatch("(.-)\n") do
        table.append(lines,line)
    end
    local bounds = {}
    for k,v in ipairs(lines) do
        local spot = 0
        bounds[k] = {}
        while not (spot == nil) and not (spot > #v) and v:match("%S") do
            local thestart, theend = v:find("%s%s+%S",spot)
            if not (thestart == 1)  then
                if (spot == 0) then table.append(bounds[k], 1)
                elseif not (thestart == nil) then table.append(bounds[k], thestart) end
            end
            if not (theend == #v) then
                if (theend == nil) then table.append(bounds[k], #v); break
                else table.append(bounds[k], theend)
                end
            end
            spot = theend
        end
    end
    local ranges = {}
    for k,v in ipairs(bounds) do
        ranges[k] = {}
        for i,_ in ipairs(v) do
            if (i % 2 == 1) then
                local contents = lines[k]:sub(v[i], v[i+1])
                local prefix = lines[k]:sub(1,v[i])
                table.append(ranges[k], {
                    thestart = pandoc.text.len(prefix),
                    contents = contents,
                    theend = pandoc.text.len(contents) + pandoc.text.len(prefix)
                })
            end
        end
    end
    local forest = {}
    for _,v in ipairs(ranges) do
    --for each layer of ranges
        local next = {}
        for _,r2 in ipairs(v) do
            --and each range in that layer, we construct a new tree
            local nexttree = { root = r2, children = {}, status = "ready" }
            table.append(next, nexttree)
            for _,tree in ipairs(forest) do
                --we go over the trees constructed so far, and see which have roots that overlap the range
                if (tree.status == "ready") then
                    if overlaps(tree.root, nexttree.root) then
                        table.append(nexttree.children, tree) --and if there's overlap, we make it a child of the new tree
                        tree.status = "planted" -- we also mark the tree as planted so it doesn't end up the child of more than one tree
                    end
                end
            end
        end
        for _,tree in ipairs(forest) do
            if not (tree.status == "planted") then
                tree.status = "complete"
                table.append(next, tree) -- if a tree doesn't get planted, we let it fall through to the next layer
            end
        end
        forest = next
    end
    return forest
end

function CodeBlock(el)
    if table.contains(el.classes,'proof') then
        local decorator
        if table.contains(el.classes, 'math') then
            decorator = function(x) return to_pandoc("$" .. x .. "$") end
        else
            decorator = to_pandoc
        end
        local forest = tabularize(el.text .. ' \n')
        local blocks = {}
        for _,v in ipairs(forest) do
            for _,block  in ipairs(render(v, decorator)) do
                table.append(blocks,block)
            end
        end
        return pandoc.Blocks(blocks)
    else
        return el
    end
end
