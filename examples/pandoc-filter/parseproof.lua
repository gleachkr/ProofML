table.append = function (self, ele) table.insert(self, #self + 1, ele) end

string.trim = function(self) return self:gsub("^%s*(.-)%s*$", "%1") end

local writer_options = pandoc.WriterOptions({
    html_math_method = pandoc.WriterOptions(PANDOC_WRITER_OPTIONS).html_math_method
})

local reader_options = pandoc.ReaderOptions({
    html_math_method = pandoc.ReaderOptions(PANDOC_READER_OPTIONS).html_math_method
})

local function to_pandoc(s)
    local html = pandoc.write(pandoc.read(s, "markdown", reader_options),"html",writer_options)
    html = html:match("<p>(.*)</p>") or html
    return html
end

local function render(tree)
    local children = ""
    local rule = ""
    if tree.children and #tree.children > 0 then
        local inference = tree.children[1].root.contents:match('---+([^%s-]*)')
        if inference then
            for _,child in ipairs(tree.children[1].children) do
                children = children .. render(child)
                rule = inference
            end
        else
            children = render(tree.children[1])
        end
    end
    if not (children == "") then
        children = "<proof-forest>" .. children .. "</proof-forest>"
    end
    local rootContents = tree.root.contents:trim()
    local prop = '<div slot="proposition">' .. to_pandoc(rootContents) .. '</div>'
    if rule:match("%S") then
        rule = '<div slot="inference">' .. to_pandoc(rule) .. '</div>'
    end
    return "<proof-tree>\n" .. children .. prop .. rule .. "</proof-tree>\n"
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
    if el.classes[1] == 'proof' then
        local forest = tabularize(el.text .. ' \n')
        local blocks = {}
        for _,v in ipairs(forest) do
            table.append(blocks, pandoc.RawBlock("html", render(v)))
        end
        return pandoc.Blocks(blocks)
    else
        return el
    end
end
