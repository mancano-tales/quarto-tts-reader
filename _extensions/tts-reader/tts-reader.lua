--[[
  tts-reader — read-aloud player for Quarto HTML documents
  MIT License. https://github.com/mancano-tales/quarto-tts-reader

  Loads the player's JS/CSS into HTML output, and only when explicitly enabled.

  Two guards, both deliberate:

    1. `is_format("html:js")` — the `:js` suffix restricts this to HTML formats
       that actually support JavaScript, so nothing reaches PDF, DOCX, or the
       plain-HTML targets where the player could not run anyway.

    2. `tts-reader-enabled`, defaulting to FALSE — the player is a drafting aid,
       not something to ship. Opt in per render (`-M tts-reader-enabled=true`)
       or per document; a normal publish stays clean by default.
]]

local function is_enabled(meta)
  local flag = meta['tts-reader-enabled']
  if flag == nil then return false end
  -- Booleans arrive as pandoc.Bool; -M on the command line arrives as a string.
  -- stringify handles both, so we do not have to care which one this is.
  local value = pandoc.utils.stringify(flag):lower()
  return value == 'true' or value == 'yes' or value == '1'
end

function Pandoc(doc)
  if not quarto.doc.is_format('html:js') then return doc end
  if not is_enabled(doc.meta) then return doc end

  quarto.doc.add_html_dependency({
    name = 'tts-reader',
    version = '1.0.0',
    scripts = { { path = 'tts-reader.js', attribs = { defer = 'true' } } },
    stylesheets = { 'tts-reader.css' }
  })

  return doc
end
