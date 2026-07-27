--[[
  tts-reader — read-aloud player for Quarto HTML documents
  MIT License. https://github.com/mancano-tales/quarto-tts-reader

  Loads the player's JS/CSS into HTML output, unless explicitly switched off.

  One guard and one switch, both deliberate:

    1. `is_format("html:js")` — the `:js` suffix restricts this to HTML formats
       that actually support JavaScript, so nothing reaches PDF, DOCX, or the
       plain-HTML targets where the player could not run anyway. This one is a
       guard and must never be relaxed to plain `html`.

    2. `tts-reader-enabled`, defaulting to TRUE since v2.0.0 — the opt-in is
       registering the filter at all, so listing it in `filters:` is taken as
       meaning it. The flag is the kill switch: `tts-reader-enabled: false` in
       the document, or `-M tts-reader-enabled=false` on the publish command.
       It is the ONLY way to opt out of a registered filter, so it must keep
       working; never remove it, and keep it failing OPEN (anything that is not
       false/no/0 enables) so a typo cannot silently kill the player.
]]

local function is_enabled(meta)
  local flag = meta['tts-reader-enabled']
  if flag == nil then return true end
  -- Booleans arrive as pandoc.Bool; -M on the command line arrives as a string.
  -- stringify handles both, so we do not have to care which one this is.
  local value = pandoc.utils.stringify(flag):lower()
  return value ~= 'false' and value ~= 'no' and value ~= '0'
end

function Pandoc(doc)
  if not quarto.doc.is_format('html:js') then return doc end
  if not is_enabled(doc.meta) then return doc end

  quarto.doc.add_html_dependency({
    name = 'tts-reader',
    version = '2.2.0',
    scripts = { { path = 'tts-reader.js', attribs = { defer = 'true' } } },
    stylesheets = { 'tts-reader.css' }
  })

  return doc
end
